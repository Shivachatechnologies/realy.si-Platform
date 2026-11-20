import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask, getTask } from "@/server/modules/agents/service";
import { actorId, authorize, uuid } from "./common";
import { extractJson } from "./ai";
import { brandContextFor } from "./brand";
import { createCampaign } from "./campaigns";
import { createContent } from "./content";
import { autopilotAction, createAutopilot, updateAutopilot } from "./autopilot";

/** Guided "Start here" journey: plain-language answers become a real campaign, AI strategy, drafts and an autopilot. */
export const JOURNEY_STEPS = 8;
export const PROMOTE = ["product", "service", "event", "brand", "offer"] as const;
export const OBJECTIVES = ["awareness", "leads", "sales", "traffic", "community"] as const;
export const PACES = ["gentle", "steady", "active"] as const;
const PACE_PER_DAY: Record<(typeof PACES)[number], number> = { gentle: 1, steady: 2, active: 3 };

export const answersInput = z.object({
  promote: z.enum(PROMOTE).optional(),
  offerName: z.string().trim().max(200).optional(),
  offerDescription: z.string().trim().max(2000).optional(),
  productId: uuid.or(z.literal("")).optional(),
  customers: z.string().trim().max(2000).optional(),
  regions: z.string().trim().max(300).optional(),
  objective: z.enum(OBJECTIVES).optional(),
  pace: z.enum(PACES).optional(),
  accountIds: z.array(uuid).max(20).optional(),
  autonomy: z.enum(["REVIEW_REQUIRED", "AUTO_PUBLISH"]).optional(),
});
export type JourneyAnswers = z.infer<typeof answersInput>;
export const journeyInput = z.object({ step: z.number().int().min(1).max(JOURNEY_STEPS).optional(), answers: answersInput.optional() });
export const journeyActionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("strategy") }),
  z.object({ action: z.literal("content_pack") }),
  z.object({ action: z.literal("apply_content"), taskId: z.string().uuid() }),
  z.object({ action: z.literal("launch") }),
  z.object({ action: z.literal("restart") }),
]);

const asAnswers = (v: Prisma.JsonValue): JourneyAnswers => {
  const p = answersInput.safeParse(v ?? {});
  return p.success ? p.data : {};
};

export async function getJourney(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const [j, products] = await Promise.all([
    db().marketingJourney.findUnique({ where: { companyId } }),
    db().graphEntity.findMany({ where: { organizationId, companyId, kind: "PRODUCT" }, orderBy: { name: "asc" }, take: 100, select: { id: true, name: true, description: true } }),
  ]);
  const taskIds = [j?.strategyTaskId].filter((x): x is string => !!x);
  const tasks = taskIds.length ? await db().agentTask.findMany({ where: { id: { in: taskIds } }, select: { id: true, status: true, output: true, title: true } }) : [];
  const packTask = j ? await db().agentTask.findFirst({ where: { companyId, subjectType: "marketing_journey", subjectId: j.id, title: { startsWith: "Content pack" } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, output: true } }) : null;
  const drafts = j?.campaignId
    ? await db().marketingContent.findMany({ where: { companyId, campaignId: j.campaignId, archivedAt: null }, orderBy: { createdAt: "asc" }, take: 30, include: { featuredAsset: { select: { id: true, url: true, mimeType: true, sizeBytes: true } } } })
    : [];
  return {
    journey: j ? { ...j, answers: asAnswers(j.answers) } : null,
    products,
    strategy: tasks.find((t) => t.id === j?.strategyTaskId) ?? null,
    pack: packTask,
    drafts,
  };
}

export async function saveJourney(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof journeyInput>) {
  const input = journeyInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const cur = await tx.marketingJourney.findUnique({ where: { companyId } });
    const answers = { ...(cur ? asAnswers(cur.answers) : {}), ...(input.answers ?? {}) };
    if (answers.productId) {
      const p = await tx.graphEntity.findFirst({ where: { id: answers.productId, organizationId, companyId, kind: "PRODUCT" }, select: { name: true, description: true } });
      if (!p) throw invalid("Unknown product", { reason: "marketing_journey_product" });
      answers.offerName ||= p.name;
      answers.offerDescription ||= p.description ?? undefined;
    }
    const by = actorId(ctx, organizationId);
    const j = await tx.marketingJourney.upsert({
      where: { companyId },
      create: { organizationId, companyId, step: input.step ?? 1, answers, updatedById: by },
      update: { ...(input.step ? { step: input.step } : {}), answers, updatedById: by },
    });
    return { ...j, answers };
  });
}

function brief(a: JourneyAnswers) {
  return [
    `What we promote: ${a.promote ?? "product"} — ${a.offerName ?? "(unnamed)"}${a.offerDescription ? `: ${a.offerDescription}` : ""}`,
    a.customers ? `Customers: ${a.customers}` : null,
    a.regions ? `Regions: ${a.regions}` : null,
    `Objective: ${a.objective ?? "awareness"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const OBJECTIVE_TEXT: Record<(typeof OBJECTIVES)[number], string> = {
  awareness: "Get known by more of the right people",
  leads: "Get more enquiries and leads",
  sales: "Sell more",
  traffic: "Bring more visitors to the website",
  community: "Build an engaged community",
};

export async function journeyAction(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof journeyActionInput>) {
  const input = journeyActionInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const j = await db().marketingJourney.findUnique({ where: { companyId } });
  if (!j && input.action !== "restart") throw conflict("Answer the first questions first", { reason: "marketing_journey_incomplete" });
  const a = j ? asAnswers(j.answers) : {};
  const brand = await brandContextFor(companyId);

  if (input.action === "restart") {
    if (j) await db().marketingJourney.update({ where: { id: j.id }, data: { step: 1, answers: {}, strategyTaskId: null, completedAt: null } });
    return { ok: true };
  }
  if (input.action === "strategy") {
    if (!a.offerName || !a.objective) throw invalid("Tell us what to promote and your goal", { reason: "marketing_journey_incomplete" });
    let campaignId = j!.campaignId;
    if (!campaignId) {
      const c = await createCampaign(ctx, organizationId, companyId, { name: `${a.offerName}`.slice(0, 200), objective: OBJECTIVE_TEXT[a.objective], description: brief(a).slice(0, 5000) });
      campaignId = c.id;
    }
    const task = await createTask(ctx, organizationId, companyId, {
      profile: "cmo",
      title: `Marketing strategy: ${a.offerName}`.slice(0, 200),
      instructions: `Create a simple, practical marketing strategy a non-expert can follow, for this brief:\n${brief(a)}\n\nWrite in plain language with short sections: 1) Who we talk to and what they care about, 2) The main message (one sentence) and 3 supporting points, 3) Which channels and why (LinkedIn, Instagram, Facebook, X, TikTok, YouTube, email, website/blog), 4) A 4-week plan with weekly themes, 5) How we will measure success (2-3 numbers to watch). Ground product claims in the company's documents; never invent customers or results.\n\n${brand}`.slice(0, 8000),
      subject: { type: "marketing_journey", id: j!.id },
    });
    await db().marketingJourney.update({ where: { id: j!.id }, data: { strategyTaskId: task.id, campaignId, step: Math.max(j!.step, 5) } });
    return { taskId: task.id, campaignId };
  }
  if (input.action === "content_pack") {
    const strategy = j!.strategyTaskId ? await db().agentTask.findUnique({ where: { id: j!.strategyTaskId }, select: { status: true, output: true } }) : null;
    const task = await createTask(ctx, organizationId, companyId, {
      profile: "social_media_manager",
      title: `Content pack: ${a.offerName ?? "launch"}`.slice(0, 200),
      instructions: `Write the first week of ready-to-publish posts for this brief:\n${brief(a)}\n${strategy?.status === "COMPLETED" && strategy.output ? `\nStrategy:\n${strategy.output.slice(0, 3000)}\n` : ""}
Create exactly one post for each platform: LINKEDIN (≤ 1300 chars), X (≤ 260 chars), INSTAGRAM (caption ≤ 1500 chars, up to 10 hashtags), FACEBOOK, YOUTUBE_SCRIPT (title line, then description and a 30-60 s script), TIKTOK_SCRIPT (hook, scenes, on-screen text, CTA). Each with a clear call to action. Never invent numbers or customers.
Return ONLY a JSON object, no prose: {"items":[{"type": "LINKEDIN"|"X"|"INSTAGRAM"|"FACEBOOK"|"YOUTUBE_SCRIPT"|"TIKTOK_SCRIPT", "title": string, "body": string, "imagePrompt": string}]}\n\n${brand}`.slice(0, 8000),
      subject: { type: "marketing_journey", id: j!.id },
    });
    await db().marketingJourney.update({ where: { id: j!.id }, data: { step: Math.max(j!.step, 6) } });
    return { taskId: task.id };
  }
  if (input.action === "apply_content") {
    const task = await getTask(ctx, organizationId, companyId, input.taskId);
    if (task.subjectType !== "marketing_journey" || task.subjectId !== j!.id) throw conflict("Unknown task", { reason: "marketing_ai_not_completed" });
    if (task.status !== "COMPLETED" || !task.output) throw conflict("The AI task has not completed", { reason: "marketing_ai_not_completed" });
    const parsed = z
      .object({ items: z.array(z.object({ type: z.enum(["LINKEDIN", "X", "INSTAGRAM", "FACEBOOK", "YOUTUBE_SCRIPT", "TIKTOK_SCRIPT"]), title: z.string().min(1).max(250), body: z.string().min(1).max(20_000), imagePrompt: z.string().max(2000).optional() })).min(1).max(20) })
      .safeParse(extractJson(task.output));
    if (!parsed.success) throw invalid("The AI output could not be read", { reason: "marketing_ai_output_unparseable" });
    const done = await db().marketingContent.count({ where: { companyId, campaignId: j!.campaignId, brief: { startsWith: `journey:${task.id}` } } });
    if (done) return { created: 0 };
    let n = 0;
    for (const it of parsed.data.items) {
      await createContent(ctx, organizationId, companyId, { type: it.type, title: it.title, body: it.body, brief: `journey:${task.id}${it.imagePrompt ? `\nImage idea: ${it.imagePrompt}` : ""}`.slice(0, 5000), campaignId: j!.campaignId });
      n++;
    }
    return { created: n };
  }
  // launch: plain-language schedule → a real autopilot (review required by default).
  if (!a.pace || !a.accountIds?.length) throw invalid("Choose how often to post and where", { reason: "marketing_journey_incomplete" });
  const accounts = await db().marketingSocialAccount.findMany({ where: { companyId, id: { in: a.accountIds }, archivedAt: null }, select: { id: true, provider: true } });
  const cadence = Object.fromEntries([...new Set(accounts.map((x) => x.provider))].map((p) => [p, PACE_PER_DAY[a.pace!]]));
  const company = await db().company.findUnique({ where: { id: companyId }, select: { timezone: true, baseCurrency: true } });
  const fields = {
    name: `${a.offerName ?? "Marketing"} autopilot`.slice(0, 120),
    objective: `${OBJECTIVE_TEXT[a.objective ?? "awareness"]}: ${a.offerName ?? ""}${a.offerDescription ? ` — ${a.offerDescription}` : ""}`.slice(0, 1000),
    audience: a.customers,
    regions: a.regions ? a.regions.split(",").map((r) => r.trim()).filter(Boolean).slice(0, 20) : [],
    cadence,
    accountIds: accounts.map((x) => x.id),
    timezone: company?.timezone ?? "UTC",
    autonomy: a.autonomy ?? "REVIEW_REQUIRED",
    currency: company?.baseCurrency ?? "USD",
    campaignId: j!.campaignId ?? undefined,
  } as const;
  let autopilotId = j!.autopilotId;
  if (autopilotId) await updateAutopilot(ctx, organizationId, companyId, autopilotId, fields);
  else autopilotId = (await createAutopilot(ctx, organizationId, companyId, fields)).id;
  const r = await autopilotAction(ctx, organizationId, companyId, autopilotId, { action: "activate" });
  await transaction(async (tx) => {
    await tx.marketingJourney.update({ where: { id: j!.id }, data: { autopilotId, step: 8, completedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.journey.launched", resourceType: "marketing_autopilot", resourceId: autopilotId! });
  });
  return { autopilotId, planned: r.planned };
}
