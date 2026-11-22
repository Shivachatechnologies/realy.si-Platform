import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { db } from "@/server/core/db";
import { agentTaskQueue } from "@/server/core/jobs";
import { createOrganization } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { setModelForTests } from "@/server/modules/agents/runtime";
import { MARKETING_TOOLS } from "@/server/modules/marketing/ai-tools";
import { advanceItem } from "@/server/modules/marketing/autopilot";
import { heldAutopilotPostIds, pausedCompanyIds } from "@/server/modules/marketing/ai-pause";
import { processDuePosts } from "@/server/modules/marketing/social";
import { tickRun } from "@/server/modules/marketing/run";
import { campaignTeam, requestAi } from "@/server/modules/marketing/ai";
import { createCampaign } from "@/server/modules/marketing/campaigns";
import { createTask, processAgentTask } from "@/server/modules/agents/service";
import { decideApproval, listApprovals } from "@/server/modules/approvals/service";
import { makeUser, resetDb } from "../helpers";

beforeAll(resetDb);
afterEach(() => setModelForTests(null));
afterAll(async () => {
  await agentTaskQueue().obliterate({ force: true });
});

/** A model that is "configured" for createTask; tasks are never processed in these tests. */
const configureModel = () =>
  setModelForTests(async () => ({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "ok", citations: null }] }) as unknown as BetaMessage);

async function setup() {
  const owner = await makeUser();
  const org = await createOrganization(owner.ctx, { name: `G2 ${Math.random()}` });
  const company = await createCompany(owner.ctx, org.id, { name: "Media Co" });
  const base = { organizationId: org.id, companyId: company.id, createdById: owner.user.id };
  const [ig, li, yt] = await Promise.all([
    db().marketingSocialAccount.create({ data: { ...base, provider: "INSTAGRAM", name: "IG main" } }),
    db().marketingSocialAccount.create({ data: { ...base, provider: "LINKEDIN", name: "LI page" } }),
    db().marketingSocialAccount.create({ data: { ...base, provider: "YOUTUBE", name: "YT channel" } }),
  ]);
  const image = await db().marketingAsset.create({ data: { ...base, kind: "IMAGE", status: "READY", name: "Hero", url: "https://cdn.example.com/hero.png", mimeType: "image/png" } });
  const x = { ctx: owner.ctx, organizationId: org.id, companyId: company.id };
  return { owner, org, company, base, ig, li, yt, image, x };
}

const tool = (name: string) => MARKETING_TOOLS[name]!;
const at = () => new Date(Date.now() + 3_600_000).toISOString();

describe("schedule_social_post with creative media (B12)", () => {
  it("refuses media-only platforms without media and explains exactly what is missing; nothing is queued", async () => {
    const { x, ig, li, company } = await setup();
    const out = await tool("schedule_social_post").execute(tool("schedule_social_post").input.parse({ title: "Launch", text: "We launched", accountIds: [ig.id, li.id], scheduledAt: at() }), x);
    expect(out.content).toMatch(/^Not scheduled: IG main \(INSTAGRAM\) needs an image or video/);
    expect(await db().marketingSocialPost.count({ where: { companyId: company.id } })).toBe(0);
  });

  it("queues a text-only post to a text platform", async () => {
    const { x, li, company } = await setup();
    const out = await tool("schedule_social_post").execute(tool("schedule_social_post").input.parse({ title: "Text", text: "Only text", accountIds: [li.id], scheduledAt: at() }), x);
    expect(out.content).toMatch(/Queued post/);
    expect(await db().marketingSocialPostTarget.count({ where: { companyId: company.id } })).toBe(1);
  });

  it("attaches a READY media library asset and queues the post (not published)", async () => {
    const { x, ig, li, image, company } = await setup();
    const out = await tool("schedule_social_post").execute(tool("schedule_social_post").input.parse({ title: "Launch", text: "We launched", accountIds: [ig.id, li.id], scheduledAt: at(), assetIds: [image.id] }), x);
    expect(out.content).toMatch(/Queued post/);
    expect(out.content).toMatch(/not published yet/);
    const post = await db().marketingSocialPost.findFirstOrThrow({ where: { companyId: company.id }, include: { targets: true } });
    expect(post).toMatchObject({ status: "SCHEDULED", mediaAssetId: image.id });
    expect(post.targets.map((t) => t.status)).toEqual(["PENDING", "PENDING"]);
  });

  it("resolves creative studio asset ids, rejects images for YouTube and foreign / unready assets", async () => {
    const { x, yt, ig, image, base, company } = await setup();
    const studio = await db().creativeAsset.create({ data: { ...base, kind: "IMAGE", name: "Studio hero", marketingAssetId: image.id } });
    const ok = await tool("schedule_social_post").execute(tool("schedule_social_post").input.parse({ title: "Studio", text: "From the studio", accountIds: [ig.id], scheduledAt: at(), assetIds: [studio.id] }), x);
    expect(ok.content).toMatch(/Queued post/);
    expect((await db().marketingSocialPost.findFirstOrThrow({ where: { companyId: company.id } })).mediaAssetId).toBe(image.id);

    const yt1 = await tool("schedule_social_post").execute(tool("schedule_social_post").input.parse({ title: "YT", text: "Video", accountIds: [yt.id], scheduledAt: at(), assetIds: [image.id] }), x);
    expect(yt1.content).toMatch(/YT channel \(YOUTUBE\) needs a video from the media library/);

    const processing = await db().marketingAsset.create({ data: { ...base, kind: "VIDEO", status: "PROCESSING", name: "Rendering" } });
    expect((await tool("schedule_social_post").execute(tool("schedule_social_post").input.parse({ title: "V", text: "v", accountIds: [yt.id], scheduledAt: at(), assetIds: [processing.id] }), x)).content).toMatch(/is processing/);

    const other = await setup();
    const foreign = await tool("schedule_social_post").execute(tool("schedule_social_post").input.parse({ title: "F", text: "f", accountIds: [ig.id], scheduledAt: at(), assetIds: [other.image.id] }), x);
    expect(foreign.content).toMatch(/is not an image or video in this company's media library/);
    expect(() => tool("schedule_social_post").input.parse({ title: "B", text: "b", accountIds: [ig.id], scheduledAt: at(), assetIds: [image.id], mediaUrl: "https://x.example/a.png" })).toThrow();
  });
});

describe("creative → social media manager hand-off (B12 chain)", () => {
  it("starts a social_media_manager task with the asset ids; refused while all AI is paused", async () => {
    const { x, image, ig, org, company } = await setup();
    configureModel();
    const out = await tool("handoff_creative_to_social").execute(tool("handoff_creative_to_social").input.parse({ assetIds: [image.id], brief: "Launch week", accountIds: [ig.id] }), x);
    expect(out.content).toMatch(/Handed 1 asset\(s\) to the social media manager as task/);
    const task = await db().agentTask.findFirstOrThrow({ where: { companyId: company.id, profile: "social_media_manager" } });
    expect(task.instructions).toContain(`assetId=${image.id}`);
    expect(task.instructions).toContain("IG main (INSTAGRAM)");

    await db().autonomySettings.create({ data: { organizationId: org.id, companyId: company.id, paused: true } });
    const paused = await tool("handoff_creative_to_social").execute(tool("handoff_creative_to_social").input.parse({ assetIds: [image.id], brief: "Again" }), x);
    expect(paused.content).toMatch(/^Not handed off: All AI in this company is paused/);
  });
});

describe("campaign lifecycle: assign AI employees", () => {
  it("assigns campaign work to a chosen AI employee and lists the campaign's AI team", async () => {
    const { owner, org, company } = await setup();
    configureModel();
    const campaign = await createCampaign(owner.ctx, org.id, company.id, { name: "Spring launch", objective: "200 leads", channels: ["linkedin"], budget: "1000" });
    const emp = await db().aiEmployee.create({ data: { organizationId: org.id, companyId: company.id, name: "Sam Social", initials: "SS", profileKey: "social_media_manager", department: "marketing", createdById: owner.user.id } });
    const task = await requestAi(owner.ctx, org.id, company.id, campaign.id, { kind: "campaign_content", aiEmployeeId: emp.id }, "marketing_campaign");
    expect(task).toMatchObject({ aiEmployeeId: emp.id, subjectType: "marketing_campaign", subjectId: campaign.id });
    expect((await db().agentTask.findUniqueOrThrow({ where: { id: task.id } })).instructions).toContain("Budget: 1000.00");
    const team = await campaignTeam(owner.ctx, org.id, company.id, campaign.id);
    expect(team).toEqual([expect.objectContaining({ id: emp.id, name: "Sam Social", tasks: 1 })]);
    const other = await setup();
    expect(await campaignTeam(other.owner.ctx, other.org.id, other.company.id, campaign.id)).toEqual([]);
  });
});

describe("company kill switch in marketing loops (B5)", () => {
  it("holds autopilot self-scheduled posts, keeps person-scheduled posts publishing, and pauses runs and items", async () => {
    const { org, company, base, li } = await setup();
    await db().autonomySettings.create({ data: { organizationId: org.id, companyId: company.id, paused: true } });
    expect((await pausedCompanyIds()).has(company.id)).toBe(true);

    const due = new Date(Date.now() - 60_000);
    const mk = (title: string) => db().marketingSocialPost.create({ data: { ...base, title, text: title, status: "SCHEDULED", scheduledAt: due, targets: { create: [{ organizationId: org.id, accountId: li.id }] } } });
    const [aiPost, humanPost, approvedPost] = await Promise.all([mk("autopilot"), mk("person"), mk("approved")]);
    const ap = await db().marketingAutopilot.create({ data: { ...base, name: "AP", objective: "Grow" } });
    await db().marketingAutopilotItem.create({ data: { organizationId: org.id, companyId: company.id, autopilotId: ap.id, platform: "LINKEDIN", slotAt: due, stage: "SCHEDULED", postId: aiPost.id } });
    await db().marketingAutopilotItem.create({ data: { organizationId: org.id, companyId: company.id, autopilotId: ap.id, platform: "LINKEDIN", slotAt: new Date(due.getTime() + 1000), stage: "SCHEDULED", postId: approvedPost.id, approvedAt: new Date() } });
    expect(await heldAutopilotPostIds(new Set([company.id]))).toEqual([aiPost.id]);

    await processDuePosts();
    const status = async (id: string) => (await db().marketingSocialPost.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(aiPost.id)).toBe("SCHEDULED"); // held while paused
    expect(await status(humanPost.id)).toBe("FAILED"); // processed: LinkedIn is not connected → failed, never faked
    expect(await status(approvedPost.id)).toBe("FAILED");

    // An autopilot item that is not human-approved does not advance while paused.
    const idea = await db().marketingAutopilotItem.create({ data: { organizationId: org.id, companyId: company.id, autopilotId: ap.id, platform: "LINKEDIN", slotAt: new Date(Date.now() + 86_400_000), stage: "RESEARCH", topic: "x" } });
    await advanceItem(idea.id);
    expect((await db().marketingAutopilotItem.findUniqueOrThrow({ where: { id: idea.id } })).stage).toBe("RESEARCH");

    // A marketing run waits at its stage and says why.
    const run = await db().marketingRun.create({ data: { organizationId: org.id, companyId: company.id, createdById: base.createdById, status: "RESEARCHING" } });
    await tickRun(run.id);
    const after = await db().marketingRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.status).toBe("RESEARCHING");
    expect(JSON.stringify(after.log)).toContain("All AI in this company is paused");

    // Resumed: the held post is processed again.
    await db().autonomySettings.update({ where: { companyId: company.id }, data: { paused: false } });
    await processDuePosts();
    expect(await status(aiPost.id)).toBe("FAILED");
  });
});

describe("flow: social media manager proposes a post with creative media → approval → queue → provider result", () => {
  it("the AI's post with an image waits for approval, is queued on approval, and is marked FAILED (not published) without a connection", async () => {
    const { owner, org, company, ig, image } = await setup();
    let n = 0;
    setModelForTests(async () => {
      n++;
      const base = { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 1 } };
      return (n === 1
        ? { ...base, stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "schedule_social_post", input: { title: "Launch", text: "Launch day", accountIds: [ig.id], scheduledAt: new Date(Date.now() - 1000).toISOString(), assetIds: [image.id] } }] }
        : { ...base, stop_reason: "end_turn", content: [{ type: "text", text: "Proposed one post for approval.", citations: null }] }) as unknown as BetaMessage;
    });
    const task = await createTask(owner.ctx, org.id, company.id, { profile: "social_media_manager", title: "Post launch", instructions: "x" });
    expect(await processAgentTask(task.id, `${task.id}_1`, { finalAttempt: true })).toBe("completed");
    expect(await db().marketingSocialPost.count({ where: { companyId: company.id } })).toBe(0); // nothing before approval
    const [req] = await listApprovals(owner.ctx, org.id, company.id, { status: "PENDING" });
    expect(req).toMatchObject({ tool: "schedule_social_post" });
    expect(req!.summary).toContain(`with media asset ${image.id}`);
    expect(await decideApproval(owner.ctx, org.id, company.id, req!.id, { decision: "approve" })).toMatchObject({ status: "EXECUTED" });
    const post = await db().marketingSocialPost.findFirstOrThrow({ where: { companyId: company.id } });
    expect(post).toMatchObject({ status: "SCHEDULED", mediaAssetId: image.id });
    await processDuePosts();
    const after = await db().marketingSocialPost.findUniqueOrThrow({ where: { id: post.id }, include: { targets: true } });
    expect(after.status).toBe("FAILED");
    expect(after.targets[0]).toMatchObject({ status: "FAILED", error: "not_connected", providerPostId: null });
  });
});
