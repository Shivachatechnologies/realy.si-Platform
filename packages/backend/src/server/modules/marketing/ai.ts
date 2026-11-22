import { z } from "zod";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { createTask, getTask } from "@/server/modules/agents/service";
import { authorize, isUuid } from "./common";
import { applyAiToContent, CONTENT_TYPES, createContent } from "./content";
import { addKeywords } from "./seo";
import { brandContextFor } from "./brand";
import { assertLimit, recordUsage } from "@/server/modules/entitlements/service";

/** AI work attached to marketing records (agent tasks with a subject). Outputs are applied only from completed tasks. */
export const AI_KINDS = ["content_draft", "content_meta", "seo_keywords", "seo_brief", "seo_report", "campaign_plan", "campaign_analysis", "campaign_content"] as const;
export type AiKind = (typeof AI_KINDS)[number];

export const aiRequestInput = z.object({
  kind: z.enum(AI_KINDS),
  /** Extra direction from the user (topic for briefs, tone, etc.). */
  note: z.string().trim().max(2000).optional(),
  /** Assign the work to this AI employee (same company, active, within budget) instead of the kind's default role. */
  aiEmployeeId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
});
export const applyInput = z.object({
  taskId: z.string().uuid(),
  target: z.enum(["body", "meta", "keywords", "content"]),
  contentType: z.enum(CONTENT_TYPES).optional(),
});

const SUBJECT: Record<AiKind, "marketing_content" | "seo_project" | "marketing_campaign"> = {
  content_draft: "marketing_content",
  content_meta: "marketing_content",
  seo_keywords: "seo_project",
  seo_brief: "seo_project",
  seo_report: "seo_project",
  campaign_plan: "marketing_campaign",
  campaign_analysis: "marketing_campaign",
  campaign_content: "marketing_campaign",
};

const extra = (note?: string) => (note ? `\n\nAdditional direction from the team: ${note}` : "");

export async function requestAi(ctx: RequestContext, organizationId: string, companyId: string, subjectId: string, raw: z.input<typeof aiRequestInput>, subjectType: string) {
  const input = aiRequestInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  if (!isUuid(subjectId) || SUBJECT[input.kind] !== subjectType) throw notFound("Record");
  let profile: string;
  let title: string;
  let instructions: string;
  if (subjectType === "marketing_content") {
    const c = await db().marketingContent.findFirst({ where: { id: subjectId, organizationId, companyId }, include: { campaign: { select: { name: true, code: true, objective: true } } } });
    if (!c) throw notFound("Content");
    const context = `Content item ${c.id}: type ${c.type}, title "${c.title}".${c.brief ? `\nBrief: ${c.brief}` : ""}${c.campaign ? `\nCampaign: ${c.campaign.name} (${c.campaign.code})${c.campaign.objective ? `, objective: ${c.campaign.objective}` : ""}.` : ""}${c.body ? `\nCurrent draft:\n${c.body.slice(0, 4000)}` : ""}`;
    if (input.kind === "content_draft") {
      profile = "content_writer";
      title = `Draft: ${c.title}`.slice(0, 200);
      instructions = `Write the ${c.type.toLowerCase().replace("_", " ")} content for this item, ready to publish. Respect the platform's length and style conventions (X: at most 280 characters; LinkedIn: at most 3000; Instagram caption: at most 2200). Ground product claims in the company's documents; never invent customers, numbers or results. Return ONLY the final content text — no preamble, no notes.\n\n${context}${extra(input.note)}`;
    } else {
      profile = "seo_specialist";
      title = `SEO meta: ${c.title}`.slice(0, 200);
      instructions = `Write SEO metadata for this content. Return ONLY a JSON object, no prose: {"metaTitle": string (30-60 characters), "metaDescription": string (70-160 characters), "keywords": string[] (3-10 search phrases), "slug": string (lowercase, hyphens)}.\n\n${context}${extra(input.note)}`;
    }
  } else if (subjectType === "seo_project") {
    const p = await db().seoProject.findFirst({
      where: { id: subjectId, organizationId, companyId },
      include: { keywords: { select: { keyword: true, currentRank: true }, take: 100 }, competitors: { select: { domain: true, notes: true } } },
    });
    if (!p) throw notFound("SEO project");
    const context = `SEO project ${p.id}: "${p.name}" for ${p.domain}.${p.keywords.length ? `\nExisting keywords: ${p.keywords.map((k) => k.keyword).join(", ")}.` : ""}${p.competitors.length ? `\nCompetitors: ${p.competitors.map((c) => c.domain).join(", ")}.` : ""}`;
    profile = "seo_specialist";
    if (input.kind === "seo_keywords") {
      title = `Keyword ideas: ${p.domain}`;
      instructions = `Suggest 15-30 new keyword ideas for this site, based on the company's products, customers and documents. Do not invent search volumes or difficulty scores. Return ONLY a JSON array, no prose: [{"keyword": string, "intent": "informational"|"navigational"|"commercial"|"transactional"}].\n\n${context}${extra(input.note)}`;
    } else if (input.kind === "seo_brief") {
      if (!input.note) throw invalid("Give a topic or keyword for the brief", { reason: "marketing_brief_topic_required" });
      title = `Content brief: ${input.note}`.slice(0, 200);
      instructions = `Write an SEO content brief for the topic/keyword "${input.note}": search intent, target and related keywords, suggested title and meta description, outline (H2/H3), key points to cover grounded in the company's documents, internal linking ideas, and competitor angles to beat.\n\n${context}`;
    } else {
      title = `SEO report: ${p.domain}`;
      instructions = `Use read_seo_project to load the project's keywords, rank history, competitors and audits, then write an SEO report: current visibility, rank movements, top technical/on-page issues from the audits, and a prioritized action plan. Use only the data the tools return; say plainly where data is missing.\n\n${context}${extra(input.note)}`;
    }
  } else {
    const c = await db().marketingCampaign.findFirst({ where: { id: subjectId, organizationId, companyId }, include: { segment: { select: { name: true } } } });
    if (!c) throw notFound("Campaign");
    const money = (m: bigint | null) => (m == null ? null : `${(Number(m) / 100).toFixed(2)} ${c.currency}`);
    const context = [
      `Campaign ${c.id}: "${c.name}" (code ${c.code}), status ${c.status}.`,
      c.objective ? `Objective: ${c.objective}` : null,
      c.description ? `Description: ${c.description}` : null,
      `Budget: ${money(c.budgetMinor)}${c.targetLeads ? `; target leads ${c.targetLeads}` : ""}${c.targetRevenueMinor ? `; target revenue ${money(c.targetRevenueMinor)}` : ""}.`,
      c.segment ? `Audience segment: ${c.segment.name}.` : "No audience segment is set.",
      c.channels.length ? `Channels: ${c.channels.join(", ")}.` : null,
      c.startDate || c.endDate ? `Dates: ${c.startDate?.toISOString().slice(0, 10) ?? "open"} – ${c.endDate?.toISOString().slice(0, 10) ?? "open"}.` : null,
    ]
      .filter(Boolean)
      .join("\n");
    if (input.kind === "campaign_content") {
      profile = "social_media_manager";
      title = `Campaign content: ${c.name}`.slice(0, 200);
      instructions = `Produce this campaign's content. Use read_campaign for what already exists, then: (1) propose content drafts linked to the campaign (create_content_draft with campaignId ${c.id}) for its channels; (2) for social posts that need visuals, propose images with generate_creative (campaignId ${c.id}) or reuse assets from search_media_library; (3) propose schedule_social_post for each post with campaignId ${c.id} and the matching assetIds — Instagram and TikTok need an image or video, Pinterest an image, YouTube a video. Every draft, image and post goes to a person for approval; a post is published only when the platform confirms it. Report exactly what you proposed and what is waiting.\n\n${context}${extra(input.note)}`;
    } else if (input.kind === "campaign_plan") {
      profile = "campaign_strategist";
      title = `Campaign plan: ${c.name}`.slice(0, 200);
      instructions = `Write a campaign plan: audience, positioning and key messages, channel mix with rationale, content calendar outline, budget split suggestion, KPIs and targets, and UTM conventions using the code ${c.code}. Ground claims in the company's documents.\n\n${context}${extra(input.note)}`;
    } else {
      profile = "marketing_analyst";
      title = `Campaign analysis: ${c.name}`.slice(0, 200);
      instructions = `Use read_campaign to load this campaign's real performance (spend, leads, won deals, content, posts, emails), then analyze it: what worked, what did not, ROI and CAC, and concrete recommendations. Use only numbers returned by the tools.\n\n${context}${extra(input.note)}`;
    }
  }
  const brand = await brandContextFor(companyId);
  if (brand) instructions = `${instructions}\n\n${brand}`;
  await assertLimit(ctx, organizationId, "content.generations.month", 1);
  const task = await createTask(ctx, organizationId, companyId, { ...(input.aiEmployeeId ? { aiEmployeeId: input.aiEmployeeId } : { profile: profile as never }), title, instructions, subject: { type: subjectType, id: subjectId } });
  await recordUsage(organizationId, "content.generations", 1, { companyId, idempotencyKey: task.id });
  return task;
}

/** Strict JSON extraction from model output (first JSON object/array, fenced or not). */
export function extractJson(output: string): unknown {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = (fenced ? fenced[1]! : output).trim();
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  const open = text[start]!;
  const end = text.lastIndexOf(open === "{" ? "}" : "]");
  if (end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function completedTask(ctx: RequestContext, organizationId: string, companyId: string, taskId: string, subjectType: string, subjectId: string) {
  const task = await getTask(ctx, organizationId, companyId, taskId);
  if (task.subjectType !== subjectType || task.subjectId !== subjectId) throw notFound("Task");
  if (task.status !== "COMPLETED" || !task.output?.trim()) throw conflict("The AI task has not completed", { reason: "marketing_ai_not_completed" });
  return task as typeof task & { output: string };
}

const unparseable = () => invalid("The AI output could not be read", { reason: "marketing_ai_output_unparseable" });

export async function applyToContent(ctx: RequestContext, organizationId: string, companyId: string, contentId: string, raw: z.input<typeof applyInput>) {
  const input = applyInput.parse(raw);
  const task = await completedTask(ctx, organizationId, companyId, input.taskId, "marketing_content", contentId);
  if (input.target === "body") return applyAiToContent(ctx, organizationId, companyId, contentId, { body: task.output.trim(), taskId: task.id });
  if (input.target !== "meta") throw invalid("Unsupported target");
  const parsed = z
    .object({ metaTitle: z.string().min(1), metaDescription: z.string().min(1), keywords: z.array(z.string()).optional() })
    .safeParse(extractJson(task.output));
  if (!parsed.success) throw unparseable();
  return applyAiToContent(ctx, organizationId, companyId, contentId, { ...parsed.data, keywords: parsed.data.keywords, taskId: task.id });
}

export async function applyToSeoProject(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof applyInput>) {
  const input = applyInput.parse(raw);
  const task = await completedTask(ctx, organizationId, companyId, input.taskId, "seo_project", projectId);
  if (input.target === "keywords") {
    const parsed = z.array(z.object({ keyword: z.string().trim().min(1).max(200), intent: z.string().optional() })).safeParse(extractJson(task.output));
    if (!parsed.success || !parsed.data.length) throw unparseable();
    const intents = ["informational", "navigational", "commercial", "transactional"] as const;
    return addKeywords(
      ctx,
      organizationId,
      companyId,
      projectId,
      parsed.data.slice(0, 200).map((k) => ({ keyword: k.keyword, intent: (intents as readonly string[]).includes(k.intent ?? "") ? (k.intent as (typeof intents)[number]) : null })),
      "ai",
    );
  }
  if (input.target === "content") {
    // Brief → new content item carrying the brief.
    return createContent(ctx, organizationId, companyId, { type: input.contentType ?? "BLOG", title: task.title.replace(/^Content brief:\s*/, "").slice(0, 250), brief: task.output.slice(0, 5000) });
  }
  throw invalid("Unsupported target");
}

/**
 * The AI employees working on a campaign: everyone with an AI task on it (assigned from the campaign page, by the
 * creative → social hand-off or by Run my marketing), with their latest task. Tenant-scoped, bounded.
 */
export async function campaignTeam(ctx: RequestContext, organizationId: string, companyId: string, campaignId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  if (!isUuid(campaignId)) return [];
  const tasks = await db().agentTask.findMany({
    where: { organizationId, companyId, subjectType: "marketing_campaign", subjectId: campaignId, aiEmployeeId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, aiEmployeeId: true, status: true, title: true, createdAt: true },
  });
  const latest = new Map<string, (typeof tasks)[number]>();
  for (const t of tasks) if (!latest.has(t.aiEmployeeId!)) latest.set(t.aiEmployeeId!, t);
  if (!latest.size) return [];
  const people = await db().aiEmployee.findMany({ where: { organizationId, companyId, id: { in: [...latest.keys()] } }, select: { id: true, name: true, jobTitle: true, department: true, status: true } });
  return people.map((p) => ({ ...p, task: latest.get(p.id)!, tasks: tasks.filter((t) => t.aiEmployeeId === p.id).length }));
}

/** Active AI employees that can be assigned to marketing work (marketing department first). */
export async function assignableEmployees(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const rows = await db().aiEmployee.findMany({ where: { organizationId, companyId, archivedAt: null, status: "ACTIVE" }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true, jobTitle: true, department: true } });
  return [...rows.filter((r) => r.department === "marketing"), ...rows.filter((r) => r.department !== "marketing")];
}
