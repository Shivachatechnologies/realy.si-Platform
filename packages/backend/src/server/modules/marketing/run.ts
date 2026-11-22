import { z } from "zod";
import type { MarketingRun, Prisma } from "@/generated/prisma/client";
import type { MarketingRunAutonomy, MarketingRunStatus, MarketingSocialProvider } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { AppError, conflict, isAppError, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { getControls, isModuleEnabled } from "@/server/core/platform-controls";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { createTask } from "@/server/modules/agents/service";
import { isCompanyAiPaused } from "./ai-pause";
import { platformKeyOptions } from "./provider-keys";
import { RESEARCH_PROVIDERS } from "@/server/modules/integrations/services/research";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { can } from "@/server/modules/rbac/service";
import { authorize, isUuid, money, uuid } from "./common";
import { extractJson } from "./ai";
import { brandContextFor } from "./brand";
import { createResearchReport, researchConnection } from "./research-reports";
import { createPlan, draftPlanWithAi, planAction, planChannels, planObjectives } from "./plans";
import { setCampaignStatus } from "./campaigns";
import { autopilotAction, createAutopilot, updateAutopilot } from "./autopilot";
import { applyArticle, publishContent, seoAction } from "./seo-autopilot";
import { contentWorkflow } from "./content";
import { createSegment } from "./segments";
import { createEmailCampaign, emailCampaignAction, emailDeliveryReady } from "./email";
import { decideOptimization } from "./optimizations";
import { getMarketingConnection, isUsable } from "./connections-bridge";
import { CMS_PROVIDERS } from "./providers/cms";

/**
 * "Run my marketing": one persisted run that drives the whole department without a person in the loop except where
 * the founder kept approval. Research (real web sources) → AI strategy plan → founder approval (or automatic under
 * FULL_AUTOPILOT) → campaign + one autopilot per social channel (which fills the content calendar, writes, designs,
 * schedules and publishes through the provider APIs) → SEO articles to the connected CMS or the Realy blog → newsletters
 * to consented CRM contacts → metrics (pulled by the social/ads/search/email jobs) → optimizations, low-risk ones
 * applied per autonomy. Spend changes always wait for a person. Every step is appended to the run log.
 */

export const RUN_STATUSES = ["RESEARCHING", "PLANNING", "AWAITING_APPROVAL", "LAUNCHING", "RUNNING", "BLOCKED", "PAUSED", "COMPLETED", "CANCELLED", "FAILED"] as const satisfies readonly MarketingRunStatus[];
export const RUN_AUTONOMY = ["REVIEW_EVERYTHING", "APPROVE_PLAN", "FULL_AUTOPILOT"] as const satisfies readonly MarketingRunAutonomy[];
export const LIVE_STATUSES: MarketingRunStatus[] = ["RESEARCHING", "PLANNING", "AWAITING_APPROVAL", "LAUNCHING", "RUNNING"];
const OPEN_STATUSES: MarketingRunStatus[] = [...LIVE_STATUSES, "BLOCKED", "PAUSED"];
export const RUN_STEPS = ["research", "plan", "approval", "campaign", "autopilot", "seo", "newsletter", "ads", "optimize", "complete", "control"] as const;
export type RunStep = (typeof RUN_STEPS)[number];
export type RunOutcome = "done" | "waiting" | "blocked" | "failed" | "skipped";
export const RUN_SUBJECT = "marketing_run";
/** Optimizations that never move money: applied by themselves when the run's autonomy allows. */
const LOW_RISK_OPTIMIZATIONS = ["retry_failed_post", "autopilot_windows", "shift_cadence"];
const SOCIAL_CHANNEL: Partial<Record<string, MarketingSocialProvider>> = { linkedin: "LINKEDIN", x: "X", instagram: "INSTAGRAM", facebook: "FACEBOOK" };

export const runInput = z.object({
  productIds: z.array(uuid).max(10).default([]),
  audience: z.string().trim().max(2000).optional(),
  regions: z.string().trim().max(300).optional(),
  competitors: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  budget: money.or(z.literal("")).default(""),
  periodDays: z.union([z.literal(30), z.literal(60), z.literal(90)]).default(30),
  autonomy: z.enum(RUN_AUTONOMY).default("APPROVE_PLAN"),
  note: z.string().trim().max(2000).optional(),
});
export type RunInputs = z.infer<typeof runInput>;
export const runActionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("retry") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("set_autonomy"), autonomy: z.enum(RUN_AUTONOMY) }),
]);

export interface RunLogEntry {
  at: string;
  step: RunStep;
  outcome: RunOutcome;
  detail: string;
  href?: string;
}
export interface RunArtifact {
  kind: "article" | "newsletter";
  taskId: string;
  contentId?: string;
  emailCampaignId?: string;
  state: "writing" | "in_review" | "awaiting_approval" | "published" | "scheduled" | "failed";
  url?: string | null;
  error?: string | null;
  at: string;
}

const asLog = (v: Prisma.JsonValue): RunLogEntry[] => (Array.isArray(v) ? (v as unknown as RunLogEntry[]).filter((e) => e && typeof e.step === "string") : []);
const asArtifacts = (v: Prisma.JsonValue): RunArtifact[] => (Array.isArray(v) ? (v as unknown as RunArtifact[]).filter((a) => a && typeof a.taskId === "string") : []);
export const runInputs = (v: Prisma.JsonValue): RunInputs => {
  const p = runInput.safeParse(v ?? {});
  return p.success ? p.data : runInput.parse({});
};
const errText = (err: unknown) => (isAppError(err) ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err)).slice(0, 400);
const sys = () => systemContext();
const entry = (step: RunStep, outcome: RunOutcome, detail: string, href?: string): RunLogEntry => ({ at: new Date().toISOString(), step, outcome, detail: detail.slice(0, 500), ...(href ? { href } : {}) });

/** Append log entries (newest last, capped) and update fields in one write. Repeated identical entries are skipped. */
async function save(run: Pick<MarketingRun, "id" | "log">, entries: RunLogEntry[], data: Prisma.MarketingRunUncheckedUpdateInput = {}) {
  const log = asLog(run.log);
  for (const e of entries) {
    const last = [...log].reverse().find((x) => x.step === e.step);
    if (last && last.outcome === e.outcome && last.detail === e.detail) continue;
    log.push(e);
  }
  const updated = await db().marketingRun.update({ where: { id: run.id }, data: { ...data, log: log.slice(-200) as unknown as Prisma.InputJsonValue, lastTickAt: new Date() } });
  run.log = updated.log;
  return updated;
}

/** Platform policy can lower the founder's choice: an autonomy ceiling below "full" or "approval for writes" forces review. */
async function effectiveAutonomy(run: Pick<MarketingRun, "autonomy">): Promise<MarketingRunAutonomy> {
  const c = await getControls();
  if (c.aiAutonomyCeiling !== "full" || c.aiRequireApprovalForWrites) return "REVIEW_EVERYTHING";
  return run.autonomy;
}
const autopilotAutonomy = (a: MarketingRunAutonomy) => (a === "REVIEW_EVERYTHING" ? "REVIEW_REQUIRED" : "AUTO_PUBLISH");

// ───────────── Reads ─────────────

export async function listRuns(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  return db().marketingRun.findMany({ where: { organizationId, companyId }, orderBy: { createdAt: "desc" }, take: 20 });
}

/** The newest run with live counts read from the records it created (nothing is cached or estimated). */
export async function runOverview(ctx: RequestContext, organizationId: string, companyId: string, runId?: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const run = runId
    ? isUuid(runId)
      ? await db().marketingRun.findFirst({ where: { id: runId, organizationId, companyId } })
      : null
    : await db().marketingRun.findFirst({ where: { organizationId, companyId }, orderBy: { createdAt: "desc" } });
  if (!run) return null;
  const w = { organizationId, companyId };
  const now = new Date();
  const campaignId = run.campaignId;
  const [research, plan, campaign, autopilots, itemStages, scheduledSlots, posts, published, metricsAgg, metricsFresh, emails, emailStats, optimizations, assets] = await Promise.all([
    run.researchIds.length ? db().marketingResearchReport.findMany({ where: { ...w, id: { in: run.researchIds } }, select: { id: true, kind: true, title: true, status: true, error: true } }) : [],
    run.planId ? db().marketingPlan.findFirst({ where: { ...w, id: run.planId }, select: { id: true, name: true, status: true, periodStart: true, periodEnd: true, objectives: true, channels: true, budgetMinor: true, currency: true, draftError: true, reviewNote: true, aiDraft: true } }) : null,
    campaignId ? db().marketingCampaign.findFirst({ where: { ...w, id: campaignId }, select: { id: true, name: true, code: true, status: true } }) : null,
    run.autopilotIds.length ? db().marketingAutopilot.findMany({ where: { ...w, id: { in: run.autopilotIds } }, select: { id: true, name: true, status: true, autonomy: true, cadence: true, lastPlannedAt: true, archivedAt: true } }) : [],
    run.autopilotIds.length ? db().marketingAutopilotItem.groupBy({ by: ["stage"], where: { companyId, autopilotId: { in: run.autopilotIds } }, _count: { _all: true } }) : [],
    run.autopilotIds.length ? db().marketingAutopilotItem.count({ where: { companyId, autopilotId: { in: run.autopilotIds }, slotAt: { gte: now }, stage: { notIn: ["REJECTED", "FAILED"] } } }) : 0,
    campaignId ? db().marketingSocialPost.count({ where: { ...w, campaignId, status: "SCHEDULED" } }) : 0,
    campaignId
      ? db().marketingSocialPostTarget.findMany({ where: { ...w, status: "PUBLISHED", post: { campaignId } }, orderBy: { publishedAt: "desc" }, take: 8, select: { id: true, providerUrl: true, publishedAt: true, impressions: true, likes: true, comments: true, shares: true, clicks: true, metricsAt: true, account: { select: { provider: true, name: true } } } })
      : [],
    campaignId ? db().marketingSocialPostTarget.aggregate({ where: { ...w, status: "PUBLISHED", post: { campaignId } }, _count: { _all: true }, _sum: { impressions: true, reach: true, likes: true, comments: true, shares: true, clicks: true } }) : null,
    campaignId ? db().marketingSocialPostTarget.count({ where: { ...w, status: "PUBLISHED", post: { campaignId }, metricsAt: { not: null } } }) : 0,
    campaignId ? db().marketingEmailCampaign.findMany({ where: { ...w, campaignId }, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, name: true, status: true, scheduledAt: true } }) : [],
    campaignId
      ? Promise.all([
          db().marketingEmailSend.count({ where: { ...w, status: "SENT", emailCampaign: { campaignId } } }),
          db().marketingEmailSend.count({ where: { ...w, status: "SENT", openedAt: { not: null }, emailCampaign: { campaignId } } }),
          db().marketingEmailSend.count({ where: { ...w, status: "SENT", clickedAt: { not: null }, emailCampaign: { campaignId } } }),
        ])
      : [0, 0, 0],
    db().marketingOptimization.groupBy({ by: ["status"], where: { ...w, createdAt: { gte: run.createdAt } }, _count: { _all: true } }),
    campaignId ? db().marketingAsset.count({ where: { ...w, campaignId, status: "READY", kind: { in: ["IMAGE", "VIDEO"] } } }) : 0,
  ]);
  const [leads, won, spend] = campaign
    ? await Promise.all([
        db().lead.count({ where: { ...w, source: { equals: campaign.code, mode: "insensitive" }, createdAt: { gte: run.createdAt }, mergedIntoId: null } }),
        db().lead.count({ where: { ...w, source: { equals: campaign.code, mode: "insensitive" }, stage: "WON", createdAt: { gte: run.createdAt } } }),
        db().marketingSpend.aggregate({ where: { ...w, campaignId: campaign.id }, _sum: { amountMinor: true } }),
      ])
    : [0, 0, null];
  const stage = Object.fromEntries(itemStages.map((s) => [s.stage, s._count._all])) as Record<string, number>;
  const s = metricsAgg?._sum;
  const spendMinor = spend?._sum.amountMinor ?? 0n;
  const articles = asArtifacts(run.artifacts).filter((a) => a.kind === "article");
  const newsletters = asArtifacts(run.artifacts).filter((a) => a.kind === "newsletter");
  return {
    run: { ...run, inputs: runInputs(run.inputs), log: asLog(run.log), artifacts: asArtifacts(run.artifacts) },
    research,
    plan: plan ? { ...plan, objectives: planObjectives(plan.objectives), channels: planChannels(plan.channels), hasDraft: !!plan.aiDraft, aiDraft: undefined } : null,
    campaign,
    autopilots,
    counts: {
      ideas: (stage.IDEA ?? 0) + (stage.RESEARCH ?? 0),
      drafting: (stage.DRAFT ?? 0) + (stage.AI_REVIEW ?? 0),
      ready: stage.READY ?? 0,
      scheduled: (stage.SCHEDULED ?? 0) + posts,
      calendarSlots: scheduledSlots,
      published: metricsAgg?._count._all ?? 0,
      failed: stage.FAILED ?? 0,
      creatives: assets,
      withMetrics: metricsFresh,
      impressions: s?.impressions ?? 0,
      reach: s?.reach ?? 0,
      engagement: (s?.likes ?? 0) + (s?.comments ?? 0) + (s?.shares ?? 0) + (s?.clicks ?? 0),
      articles: articles.length,
      articlesPublished: articles.filter((a) => a.state === "published").length,
      newsletters: newsletters.length,
      emailsSent: emailStats[0],
      emailsOpened: emailStats[1],
      emailsClicked: emailStats[2],
      optimizationsProposed: optimizations.find((o) => o.status === "PROPOSED")?._count._all ?? 0,
      optimizationsApplied: optimizations.find((o) => o.status === "APPLIED")?._count._all ?? 0,
      leads,
      won,
      spendMinor,
      cplMinor: leads ? spendMinor / BigInt(leads) : null,
    },
    recentPosts: published,
    emails,
  };
}

// ───────────── Start / actions ─────────────

export async function startRun(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof runInput>) {
  const input = runInput.parse(raw);
  const chain = await authorize(ctx, organizationId, companyId, "marketing.manage");
  // The run starts AI tasks in the background: only people who may run agents can start one.
  if (!(await can(ctx, "agents.run", chain))) throw new AppError("forbidden", "Running AI agents is not allowed for you", { reason: "marketing_run_agents_forbidden" });
  if (!ctx.actor.id) throw new AppError("unauthenticated", "Sign in required");
  const [company, products, strategy] = await Promise.all([
    db().company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { name: true } }),
    input.productIds.length ? db().graphEntity.findMany({ where: { organizationId, companyId, kind: "PRODUCT", id: { in: input.productIds } }, select: { id: true, name: true, description: true } }) : [],
    db().companyStrategy.findUnique({ where: { companyId }, select: { mission: true } }),
  ]);
  if (products.length !== input.productIds.length) throw notFound("Product");
  const offer = products.length ? products.map((p) => p.name).join(", ") : company.name;
  const run = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const open = await tx.marketingRun.findFirst({ where: { organizationId, companyId, status: { in: OPEN_STATUSES } }, select: { id: true } });
    if (open) throw conflict("Your marketing is already running — pause or cancel it first", { reason: "marketing_run_active", runId: open.id });
    const r = await tx.marketingRun.create({
      data: { organizationId, companyId, autonomy: input.autonomy, inputs: input as unknown as Prisma.InputJsonValue, createdById: ctx.actor.id!, log: [entry("research", "waiting", `Researching the market for ${offer}`)] as unknown as Prisma.InputJsonValue },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.run.started", resourceType: "marketing_run", resourceId: r.id, newValue: { autonomy: input.autonomy, periodDays: input.periodDays, products: products.map((p) => p.id) } });
    return r;
  });

  // Research the market and the audience (and competitors when named) from real web sources.
  const context = [products.map((p) => `${p.name}${p.description ? `: ${p.description}` : ""}`).join("\n"), strategy?.mission ? `Mission: ${strategy.mission}` : "", input.audience ? `Ideal customers: ${input.audience}` : ""].filter(Boolean).join("\n").slice(0, 1800);
  const kinds = ["MARKET", "AUDIENCE", ...(input.competitors.length ? (["COMPETITOR"] as const) : [])] as const;
  const results = await Promise.allSettled(
    kinds.map((kind) => createResearchReport(ctx, organizationId, companyId, { kind, subject: offer.slice(0, 200), region: input.regions || undefined, competitors: kind === "COMPETITOR" ? input.competitors : [], notes: [context, input.note].filter(Boolean).join("\n").slice(0, 2000) || undefined })),
  );
  const reports = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const log: RunLogEntry[] = [];
  if (reports.length && reports.every((r) => r.status === "CREDENTIAL_REQUIRED")) log.push(entry("research", "blocked", "No web research provider is connected — the plan will be drafted from your company brain and stated assumptions", "/integrations"));
  for (const r of results) if (r.status === "rejected") log.push(entry("research", "failed", errText(r.reason)));
  return save(run, log, { researchIds: reports.map((r) => r.id) });
}

export async function runAction(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof runActionInput>) {
  const input = runActionInput.parse(raw);
  if (!isUuid(id)) throw notFound("Marketing run");
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const run = await db().marketingRun.findFirst({ where: { id, organizationId, companyId } });
  if (!run) throw notFound("Marketing run");
  const bad = () => conflict(`Cannot ${input.action} a ${run.status.toLowerCase()} run`, { reason: "marketing_invalid_transition" });
  let data: Prisma.MarketingRunUncheckedUpdateInput = {};
  let detail = "";
  switch (input.action) {
    case "pause":
      if (!LIVE_STATUSES.includes(run.status) && run.status !== "BLOCKED") throw bad();
      for (const apId of run.autopilotIds) await autopilotAction(ctx, organizationId, companyId, apId, { action: "pause" }).catch(() => null);
      data = { status: "PAUSED" };
      detail = "Paused by a person — autopilots stopped planning new posts";
      break;
    case "resume":
    case "retry": {
      if (input.action === "resume" ? run.status !== "PAUSED" : run.status !== "BLOCKED" && run.status !== "FAILED") throw bad();
      const status = await resumeStatus(run);
      if (status === "RUNNING") for (const apId of run.autopilotIds) await autopilotAction(ctx, organizationId, companyId, apId, { action: "activate" }).catch(() => null);
      data = { status, blockedReason: null, error: null, lastTickAt: null };
      detail = input.action === "resume" ? "Resumed by a person" : "Retry requested";
      break;
    }
    case "cancel":
      if (!OPEN_STATUSES.includes(run.status)) throw bad();
      for (const apId of run.autopilotIds) await autopilotAction(ctx, organizationId, companyId, apId, { action: "pause" }).catch(() => null);
      data = { status: "CANCELLED", completedAt: new Date() };
      detail = "Cancelled by a person — autopilots paused; already scheduled posts stay in the social queue";
      break;
    case "set_autonomy":
      if (!OPEN_STATUSES.includes(run.status)) throw bad();
      for (const apId of run.autopilotIds) await updateAutopilot(ctx, organizationId, companyId, apId, { autonomy: autopilotAutonomy(input.autonomy) }).catch(() => null);
      data = { autonomy: input.autonomy };
      detail = `Autonomy set to ${input.autonomy}`;
      break;
  }
  const updated = await save(run, [entry("control", "done", detail)], data);
  await transaction((tx) => writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `marketing.run.${input.action}`, resourceType: "marketing_run", resourceId: id, oldValue: { status: run.status, autonomy: run.autonomy }, newValue: { status: updated.status, autonomy: updated.autonomy } }));
  return updated;
}

/** Where a paused / blocked run continues, judged from the records it already has. */
async function resumeStatus(run: MarketingRun): Promise<MarketingRunStatus> {
  if (!run.planId) return "RESEARCHING";
  const plan = await db().marketingPlan.findFirst({ where: { id: run.planId, companyId: run.companyId }, select: { status: true, aiDraft: true, draftError: true } });
  if (!plan || plan.status === "ARCHIVED") return "RESEARCHING";
  if (plan.status === "DRAFT") {
    if (plan.draftError || !plan.aiDraft) await db().marketingPlan.update({ where: { id: run.planId }, data: { draftTaskId: null, draftError: null } });
    return "PLANNING";
  }
  if (plan.status === "IN_REVIEW") return "AWAITING_APPROVAL";
  if (!run.campaignId || !run.autopilotIds.length) return "LAUNCHING";
  return "RUNNING";
}

// ───────────── Engine ─────────────

async function blocked(run: MarketingRun, step: RunStep, reason: string, href?: string) {
  await save(run, [entry(step, "blocked", reason, href)], { status: "BLOCKED", blockedReason: reason.slice(0, 300) });
  const users = await transaction((tx) => usersWithPermission(tx, run.organizationId, run.companyId, "marketing.manage"));
  await transaction((tx) => notifyUsers(tx, run.organizationId, [run.createdById, ...users].slice(0, 25), "marketing.run_blocked", { companyId: run.companyId, title: reason.slice(0, 160), href: "/marketing/run" }));
}

async function stepResearch(run: MarketingRun) {
  const reports = await db().marketingResearchReport.findMany({ where: { id: { in: run.researchIds }, companyId: run.companyId }, select: { id: true, status: true, title: true } });
  const running = reports.filter((r) => r.status === "RESEARCHING" || r.status === "SYNTHESIZING");
  if (running.length && Date.now() - run.createdAt.getTime() < 45 * 60_000) return;
  const usable = reports.filter((r) => r.status === "READY" || r.status === "SOURCES_ONLY");
  const log: RunLogEntry[] = [entry("research", usable.length ? "done" : "skipped", usable.length ? `${usable.length} research report(s) ready` : "No research report finished — planning from the company brain", "/marketing/intelligence")];
  if (!aiConfigured()) return blocked(run, "plan", "AI is not configured on this platform, so the strategy cannot be drafted");
  const inputs = runInputs(run.inputs);
  const company = await db().company.findUniqueOrThrow({ where: { id: run.companyId }, select: { name: true, timezone: true } });
  const start = new Date();
  const end = new Date(start.getTime() + (inputs.periodDays - 1) * 86_400_000);
  const ctx = sys();
  const plan = await createPlan(ctx, run.organizationId, run.companyId, {
    name: `${company.name} · ${inputs.periodDays}-day marketing`.slice(0, 160),
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
    audience: inputs.audience,
    budget: inputs.budget,
    researchIds: usable.map((r) => r.id),
  });
  // The founder who started the run owns the plan (notifications, "created by").
  await db().marketingPlan.update({ where: { id: plan.id }, data: { createdById: run.createdById } });
  await draftPlanWithAi(ctx, run.organizationId, run.companyId, plan.id, { note: [inputs.note, inputs.audience ? `Ideal customers: ${inputs.audience}` : "", inputs.regions ? `Regions: ${inputs.regions}` : ""].filter(Boolean).join("\n").slice(0, 2000) || undefined });
  log.push(entry("plan", "waiting", "The CMO AI is drafting the strategy plan", `/marketing/strategy/${plan.id}`));
  await save(run, log, { status: "PLANNING", planId: plan.id });
}

async function stepPlanning(run: MarketingRun) {
  const plan = await db().marketingPlan.findFirst({ where: { id: run.planId!, companyId: run.companyId } });
  if (!plan || plan.status === "ARCHIVED") return save(run, [entry("plan", "failed", "The plan was archived")], { status: "CANCELLED", completedAt: new Date() });
  if (plan.status !== "DRAFT") return save(run, [], { status: plan.status === "IN_REVIEW" ? "AWAITING_APPROVAL" : "LAUNCHING" });
  const ctx = sys();
  if (!plan.aiDraft) {
    if (plan.draftError) return blocked(run, "plan", `The AI could not draft the plan (${plan.draftError}) — retry or edit the plan yourself`, `/marketing/strategy/${plan.id}`);
    if (!plan.draftTaskId) {
      await draftPlanWithAi(ctx, run.organizationId, run.companyId, plan.id, {});
      return save(run, [entry("plan", "waiting", "The CMO AI is drafting the strategy plan", `/marketing/strategy/${plan.id}`)]);
    }
    if (Date.now() - plan.updatedAt.getTime() > 3 * 3_600_000) return blocked(run, "plan", "The strategy draft is taking unusually long — retry", `/marketing/strategy/${plan.id}`);
    return;
  }
  await planAction(ctx, run.organizationId, run.companyId, plan.id, { action: "apply_ai_draft" });
  const applied = await db().marketingPlan.findUniqueOrThrow({ where: { id: plan.id } });
  if (!planObjectives(applied.objectives).length || !planChannels(applied.channels).length) return blocked(run, "plan", "The AI draft has no objectives or channels — complete the plan, then retry", `/marketing/strategy/${plan.id}`);
  await planAction(ctx, run.organizationId, run.companyId, plan.id, { action: "submit" });
  const log = [entry("plan", "done", `Strategy drafted: ${planChannels(applied.channels).length} channel(s), ${planObjectives(applied.objectives).length} objective(s)`, `/marketing/strategy/${plan.id}`)];
  if ((await effectiveAutonomy(run)) === "FULL_AUTOPILOT") {
    await planAction(ctx, run.organizationId, run.companyId, plan.id, { action: "approve" });
    log.push(entry("approval", "done", "Approved automatically (full autopilot was granted)"));
    return save(run, log, { status: "LAUNCHING" });
  }
  log.push(entry("approval", "waiting", "Waiting for your approval of the plan", `/marketing/strategy/${plan.id}`));
  return save(run, log, { status: "AWAITING_APPROVAL" });
}

async function stepApproval(run: MarketingRun) {
  const plan = await db().marketingPlan.findFirst({ where: { id: run.planId!, companyId: run.companyId }, select: { status: true, reviewNote: true } });
  if (!plan || plan.status === "ARCHIVED") return save(run, [entry("approval", "failed", "The plan was archived — run cancelled")], { status: "CANCELLED", completedAt: new Date() });
  if (plan.status === "APPROVED" || plan.status === "ACTIVE") return save(run, [entry("approval", "done", "Plan approved")], { status: "LAUNCHING" });
  if (plan.status === "DRAFT" && plan.reviewNote) return save(run, [entry("approval", "waiting", `Changes requested: ${plan.reviewNote} — resubmit the plan to continue`, `/marketing/strategy/${run.planId}`)]);
  return save(run, []);
}

/** "3 posts per week" → posts per day for the autopilot (at least 1 on a chosen channel). */
export function perDayFrom(cadence: string): number {
  const c = cadence.toLowerCase();
  const n = Number(c.match(/\d+(?:\.\d+)?/)?.[0] ?? "1") || 1;
  if (/day|daily|täglich|يوم|天|दिन/.test(c)) return Math.min(5, Math.max(1, Math.round(n)));
  if (/month|monat|شهر|月|माह|महीन/.test(c)) return 1;
  return Math.min(5, Math.max(1, Math.round(n / 7)));
}
function intervalDays(cadence: string | undefined, fallback: number) {
  const c = (cadence ?? "").toLowerCase();
  const n = Number(c.match(/\d+/)?.[0] ?? "1") || 1;
  if (/month|monat|شهر|月|माह|महीन/.test(c)) return Math.max(7, Math.round(30 / n));
  if (/week|woche|أسبوع|周|सप्ताह|हफ्ते/.test(c)) return Math.max(1, Math.round(7 / n));
  return fallback;
}

async function cmsTarget(organizationId: string, companyId: string): Promise<(typeof CMS_PROVIDERS)[number] | "realy"> {
  for (const p of CMS_PROVIDERS) if (isUsable(await getMarketingConnection(organizationId, companyId, p).catch(() => null))) return p;
  return "realy";
}

async function stepLaunch(run: MarketingRun) {
  const ctx = sys();
  const { organizationId, companyId } = run;
  const plan = await db().marketingPlan.findFirstOrThrow({ where: { id: run.planId!, companyId } });
  const channels = planChannels(plan.channels);
  const autonomy = await effectiveAutonomy(run);
  const log: RunLogEntry[] = [];
  const data: Prisma.MarketingRunUncheckedUpdateInput = { status: "RUNNING" };

  // 1. Campaign (UTM code = lead source for attribution), switched live.
  let campaignId = plan.campaignId;
  if (!campaignId) campaignId = (await planAction(ctx, organizationId, companyId, plan.id, { action: "create_campaign" })).campaignId;
  const campaign = await db().marketingCampaign.findUniqueOrThrow({ where: { id: campaignId! }, select: { status: true, code: true, name: true } });
  if (campaign.status === "DRAFT" || campaign.status === "PLANNED" || campaign.status === "PAUSED") await setCampaignStatus(ctx, organizationId, companyId, campaignId!, { status: "ACTIVE" });
  data.campaignId = campaignId;
  log.push(entry("campaign", "done", `Campaign "${campaign.name}" is live (tracking code ${campaign.code})`, `/marketing/campaigns/${campaignId}`));

  // 2. One autopilot per social channel with connected accounts: it plans the content calendar, writes, designs,
  //    schedules and publishes; review per the run's autonomy.
  const company = await db().company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true, baseCurrency: true } });
  const pillars = (plan.messaging ?? "").split("\n").map((l) => l.replace(/^[-*•\d.\s]+/, "").trim()).filter(Boolean).map((l) => l.slice(0, 120)).slice(0, 20);
  const objective = (planObjectives(plan.objectives).map((o) => o.label || `${o.metric} ${o.target}`).join(" · ") || plan.positioning || plan.name).slice(0, 1000);
  const autopilotIds = [...run.autopilotIds];
  const existing = autopilotIds.length ? await db().marketingAutopilot.findMany({ where: { id: { in: autopilotIds } }, select: { name: true } }) : [];
  for (const ch of channels) {
    const provider = SOCIAL_CHANNEL[ch.channel];
    if (!provider) continue;
    const name = `${plan.name.slice(0, 90)} · ${provider}`.slice(0, 120);
    if (existing.some((e) => e.name === name)) continue;
    const accounts = await db().marketingSocialAccount.findMany({ where: { companyId, provider, archivedAt: null }, select: { id: true }, take: 20 });
    if (!accounts.length) {
      log.push(entry("autopilot", "blocked", `No ${provider} account is connected — ${provider} posts are not planned until you connect one`, "/marketing/social"));
      continue;
    }
    const ap = await createAutopilot(ctx, organizationId, companyId, {
      name,
      objective: objective.length >= 3 ? objective : `Grow ${provider} presence`,
      audience: plan.audience ?? undefined,
      pillars,
      cadence: { [provider]: perDayFrom(ch.cadence) },
      accountIds: accounts.map((a) => a.id),
      timezone: company.timezone || "UTC",
      autonomy: autopilotAutonomy(autonomy),
      currency: company.baseCurrency,
      campaignId: campaignId!,
      ownerId: run.createdById,
    });
    await db().marketingAutopilot.update({ where: { id: ap.id }, data: { createdById: run.createdById } });
    const r = await autopilotAction(ctx, organizationId, companyId, ap.id, { action: "activate" });
    autopilotIds.push(ap.id);
    log.push(entry("autopilot", "done", `${provider} autopilot live: ${perDayFrom(ch.cadence)}/day, ${r.planned} calendar slot(s) planned, ${autonomy === "REVIEW_EVERYTHING" ? "you review each post" : "posts publish by themselves"}`, `/marketing/autopilot/${ap.id}`));
  }
  data.autopilotIds = autopilotIds;

  // 3. Blog / SEO articles.
  const seoCh = channels.find((c) => c.channel === "seo" || c.channel === "content");
  if (seoCh) {
    const project = await db().seoProject.findFirst({ where: { organizationId, companyId, archivedAt: null, keywords: { some: {} } }, orderBy: { createdAt: "asc" }, select: { id: true, domain: true } });
    if (!project) log.push(entry("seo", "blocked", "Add an SEO project with keywords so articles can be written for them", "/marketing/seo"));
    else {
      const target = await cmsTarget(organizationId, companyId);
      data.seoProjectId = project.id;
      data.nextArticleAt = new Date();
      log.push(entry("seo", "done", `Articles for ${project.domain} every ${intervalDays(seoCh.cadence, 7)} day(s), published to ${target === "realy" ? "your Realy blog" : target}`, `/marketing/seo/${project.id}`));
    }
  }

  // 4. Newsletters to consented contacts (unsubscribe + suppression are enforced by the mailer).
  const emailCh = channels.find((c) => c.channel === "email");
  if (emailCh) {
    data.nextNewsletterAt = new Date();
    if (!(await emailDeliveryReady(organizationId, companyId))) log.push(entry("newsletter", "blocked", "No email sending provider is ready — newsletters are drafted but not sent until one is connected", "/integrations"));
    else log.push(entry("newsletter", "done", `Newsletter every ${intervalDays(emailCh.cadence, 14)} day(s) to contacts who gave marketing consent`, "/marketing/email"));
  }

  // 5. Paid ads stay under the Ads page; budget changes always need a person.
  if (channels.some((c) => c.channel === "google_ads" || c.channel === "meta_ads")) {
    const ads = await db().marketingAdAccount.count({ where: { organizationId, companyId } });
    log.push(ads ? entry("ads", "done", `${ads} ad account(s) synced hourly; budget changes always wait for your approval`, "/marketing/ads") : entry("ads", "blocked", "Connect an ad account to track paid results", "/marketing/ads"));
  }
  if (!autopilotIds.length && !data.seoProjectId && !data.nextNewsletterAt) return blocked(run, "autopilot", "None of the plan's channels can run yet — connect a social account, an SEO project or an email provider, then retry", "/integrations");
  await save(run, log, data);
}

const newsletterSchema = z.object({ subject: z.string().trim().min(3).max(250), body: z.string().trim().min(50).max(50_000) });

async function consentSegment(run: MarketingRun) {
  const seg = await db().marketingSegment.findFirst({ where: { companyId: run.companyId, consentOnly: true, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (seg) return seg.id;
  const s = await createSegment(sys(), run.organizationId, run.companyId, { name: "Newsletter (consented contacts)", description: "Created by Run my marketing: every contact who gave marketing consent.", kind: "DYNAMIC", consentOnly: true });
  await db().marketingSegment.update({ where: { id: s.id }, data: { createdById: run.createdById } });
  return s.id;
}

/** Articles and newsletters: start the next one when due, carry finished AI tasks through review / publish. */
async function stepArtifacts(run: MarketingRun, autonomy: MarketingRunAutonomy) {
  const ctx = sys();
  const { organizationId, companyId } = run;
  const artifacts = asArtifacts(run.artifacts);
  const log: RunLogEntry[] = [];
  const data: Prisma.MarketingRunUncheckedUpdateInput = {};
  const plan = run.planId ? await db().marketingPlan.findFirst({ where: { id: run.planId, companyId }, select: { channels: true } }) : null;
  const channels = plan ? planChannels(plan.channels) : [];
  const now = Date.now();

  for (const a of artifacts) {
    try {
      if (a.kind === "article" && a.contentId && (a.state === "writing" || a.state === "in_review")) {
        if (a.state === "writing") {
          const task = await db().agentTask.findUnique({ where: { id: a.taskId }, select: { status: true } });
          if (!task || task.status === "QUEUED" || task.status === "RUNNING") continue;
          if (task.status !== "COMPLETED") {
            Object.assign(a, { state: "failed", error: task.status });
            continue;
          }
          await applyArticle(ctx, organizationId, companyId, a.contentId, { taskId: a.taskId });
          await contentWorkflow(ctx, organizationId, companyId, a.contentId, { action: "submit", comment: "Written by Run my marketing" });
          a.state = "in_review";
          if (autonomy !== "REVIEW_EVERYTHING") await contentWorkflow(ctx, organizationId, companyId, a.contentId, { action: "approve", comment: `Approved automatically (autonomy ${autonomy})` });
        }
        const c = await db().marketingContent.findFirst({ where: { id: a.contentId, companyId }, select: { status: true, title: true, publishedUrl: true } });
        if (!c) continue;
        if (c.status === "APPROVED") {
          const target = await cmsTarget(organizationId, companyId);
          const pub = await publishContent(ctx, organizationId, companyId, a.contentId, { target });
          Object.assign(a, { state: "published", url: pub && "url" in pub ? pub.url : null });
          log.push(entry("seo", "done", `Article published to ${target === "realy" ? "your Realy blog" : target}: ${c.title}`, `/marketing/content/${a.contentId}`));
        } else if (c.status === "PUBLISHED") Object.assign(a, { state: "published", url: c.publishedUrl });
      } else if (a.kind === "newsletter" && a.state === "writing") {
        const task = await db().agentTask.findUnique({ where: { id: a.taskId }, select: { status: true, output: true } });
        if (!task || task.status === "QUEUED" || task.status === "RUNNING") continue;
        const parsed = task.status === "COMPLETED" && task.output ? newsletterSchema.safeParse(extractJson(task.output)) : null;
        if (!parsed?.success) {
          Object.assign(a, { state: "failed", error: task.status === "COMPLETED" ? "ai_output_unparseable" : task.status });
          continue;
        }
        const segmentId = await consentSegment(run);
        const ec = await createEmailCampaign(ctx, organizationId, companyId, { name: `Newsletter · ${new Date().toISOString().slice(0, 10)}`, subject: parsed.data.subject, body: parsed.data.body, segmentId, campaignId: run.campaignId });
        await db().marketingEmailCampaign.update({ where: { id: ec.id }, data: { createdById: run.createdById } });
        a.emailCampaignId = ec.id;
        if (autonomy === "FULL_AUTOPILOT" && (await emailDeliveryReady(organizationId, companyId))) {
          await emailCampaignAction(ctx, organizationId, companyId, ec.id, { action: "schedule", scheduledAt: new Date(now + 2 * 3_600_000).toISOString() });
          a.state = "scheduled";
          log.push(entry("newsletter", "done", `Newsletter "${parsed.data.subject}" scheduled to consented contacts`, `/marketing/email/${ec.id}`));
        } else {
          a.state = "awaiting_approval";
          log.push(entry("newsletter", "waiting", `Newsletter "${parsed.data.subject}" is ready — review and send it`, `/marketing/email/${ec.id}`));
          await transaction((tx) => notifyUsers(tx, organizationId, [run.createdById], "marketing.run_newsletter_ready", { companyId, title: parsed.data.subject, href: `/marketing/email/${ec.id}` }));
        }
      } else if (a.kind === "newsletter" && a.state === "awaiting_approval" && a.emailCampaignId) {
        const ec = await db().marketingEmailCampaign.findFirst({ where: { id: a.emailCampaignId, companyId }, select: { status: true } });
        if (ec && ec.status !== "DRAFT") a.state = ec.status === "FAILED" || ec.status === "CANCELLED" ? "failed" : "scheduled";
      }
    } catch (err) {
      Object.assign(a, { state: "failed", error: errText(err) });
      log.push(entry(a.kind === "article" ? "seo" : "newsletter", "failed", errText(err)));
    }
  }

  // Next article.
  const seoCh = channels.find((c) => c.channel === "seo" || c.channel === "content");
  if (run.seoProjectId && run.nextArticleAt && run.nextArticleAt.getTime() <= now && !artifacts.some((a) => a.kind === "article" && a.state === "writing")) {
    const used = new Set((await db().marketingContent.findMany({ where: { companyId, seoProjectId: run.seoProjectId, archivedAt: null }, select: { keywords: true }, orderBy: { createdAt: "desc" }, take: 1000 })).flatMap((c) => c.keywords.slice(0, 1).map((k) => k.toLowerCase())));
    const kw = (await db().seoKeyword.findMany({ where: { projectId: run.seoProjectId }, orderBy: { createdAt: "asc" }, select: { keyword: true }, take: 500 })).find((k) => !used.has(k.keyword.toLowerCase()));
    if (!kw) log.push(entry("seo", "waiting", "Every keyword of the SEO project has an article — add keywords for more", `/marketing/seo/${run.seoProjectId}`));
    else {
      try {
        const r = await seoAction(ctx, organizationId, companyId, run.seoProjectId, { action: "article", keyword: kw.keyword });
        const taskId = "taskId" in r && typeof r.taskId === "string" ? r.taskId : null;
        if ("contentId" in r && taskId) {
          await db().marketingContent.update({ where: { id: r.contentId }, data: { campaignId: run.campaignId, createdById: run.createdById } });
          artifacts.push({ kind: "article", taskId, contentId: r.contentId, state: "writing", at: new Date().toISOString() });
          log.push(entry("seo", "waiting", `Writing an article for "${kw.keyword}"`, `/marketing/content/${r.contentId}`));
        }
      } catch (err) {
        log.push(entry("seo", "failed", errText(err)));
      }
    }
    data.nextArticleAt = new Date(now + intervalDays(seoCh?.cadence, 7) * 86_400_000);
  }

  // Next newsletter.
  const emailCh = channels.find((c) => c.channel === "email");
  if (run.nextNewsletterAt && run.nextNewsletterAt.getTime() <= now && !artifacts.some((a) => a.kind === "newsletter" && (a.state === "writing" || a.state === "awaiting_approval"))) {
    try {
      const [plan2, recent, brand] = await Promise.all([
        db().marketingPlan.findFirst({ where: { id: run.planId!, companyId }, select: { positioning: true, messaging: true, audience: true } }),
        db().marketingContent.findMany({ where: { companyId, status: "PUBLISHED", publishedUrl: { not: null }, publishedAt: { gte: new Date(now - 30 * 86_400_000) } }, orderBy: { publishedAt: "desc" }, take: 5, select: { title: true, publishedUrl: true } }),
        brandContextFor(companyId),
      ]);
      const task = await createTask(ctx, organizationId, companyId, {
        profile: "content_writer",
        title: `Newsletter draft (${new Date().toISOString().slice(0, 10)})`,
        instructions: `Write this period's email newsletter for the company's contacts who opted in to marketing.
Positioning: ${plan2?.positioning ?? "(see company documents)"}
Key messages: ${plan2?.messaging ?? ""}
Audience: ${plan2?.audience ?? ""}
${recent.length ? `Link to these recently published articles where relevant:\n${recent.map((r) => `- ${r.title}: ${r.publishedUrl}`).join("\n")}` : ""}
Plain, friendly, useful; 150-400 words; one clear call to action; you may use the merge tag {{firstName}}. Never invent offers, prices, numbers or customers — ground facts in the company's documents. Do not add an unsubscribe line (it is added automatically).
Return ONLY valid JSON: {"subject": string (max 80 chars), "body": string (plain text with blank lines between paragraphs)}

${brand}`.slice(0, 8000),
        subject: { type: RUN_SUBJECT, id: run.id },
      });
      artifacts.push({ kind: "newsletter", taskId: task.id, state: "writing", at: new Date().toISOString() });
      log.push(entry("newsletter", "waiting", "Writing the next newsletter"));
    } catch (err) {
      log.push(entry("newsletter", "failed", errText(err)));
    }
    data.nextNewsletterAt = new Date(now + intervalDays(emailCh?.cadence, 14) * 86_400_000);
  }
  data.artifacts = artifacts.slice(-100) as unknown as Prisma.InputJsonValue;
  return { log, data };
}

/** Low-risk optimizations apply by themselves under APPROVE_PLAN / FULL_AUTOPILOT; spend changes always wait. */
async function stepOptimize(run: MarketingRun, autonomy: MarketingRunAutonomy): Promise<RunLogEntry[]> {
  if (autonomy === "REVIEW_EVERYTHING") return [];
  const proposals = await db().marketingOptimization.findMany({ where: { organizationId: run.organizationId, companyId: run.companyId, status: "PROPOSED", kind: { in: LOW_RISK_OPTIMIZATIONS } }, orderBy: { createdAt: "asc" }, take: 10, select: { id: true, title: true } });
  const log: RunLogEntry[] = [];
  for (const p of proposals) {
    try {
      const r = await decideOptimization(sys(), run.organizationId, run.companyId, p.id, { decision: "approve", note: `Applied automatically by Run my marketing (autonomy ${autonomy})` });
      log.push(entry("optimize", r.status === "APPLIED" ? "done" : "failed", `${r.status === "APPLIED" ? "Applied" : "Could not apply"}: ${p.title}${r.error ? ` — ${r.error}` : ""}`, "/marketing/optimize"));
    } catch (err) {
      log.push(entry("optimize", "failed", `${p.title}: ${errText(err)}`, "/marketing/optimize"));
    }
  }
  return log;
}

async function stepRunning(run: MarketingRun) {
  const plan = run.planId ? await db().marketingPlan.findFirst({ where: { id: run.planId, companyId: run.companyId }, select: { periodEnd: true, status: true } }) : null;
  if (plan && plan.periodEnd.getTime() + 86_400_000 < Date.now()) {
    for (const apId of run.autopilotIds) await autopilotAction(sys(), run.organizationId, run.companyId, apId, { action: "pause" }).catch(() => null);
    await save(run, [entry("complete", "done", "The plan period ended — autopilots paused. Start a new run to plan the next period.")], { status: "COMPLETED", completedAt: new Date() });
    await transaction(async (tx) => {
      await notifyUsers(tx, run.organizationId, [run.createdById], "marketing.run_completed", { companyId: run.companyId, title: "Marketing period completed", href: "/marketing/run" });
      await emitDomainEvent(tx, sys(), "marketing.run_completed", { organizationId: run.organizationId, companyId: run.companyId, entityType: "marketing_run", entityId: run.id, data: { planId: run.planId } });
    });
    return;
  }
  // Keep the autopilots aligned with the run's (possibly platform-lowered) autonomy.
  const autonomy = await effectiveAutonomy(run);
  if (run.autopilotIds.length) await db().marketingAutopilot.updateMany({ where: { id: { in: run.autopilotIds }, companyId: run.companyId, archivedAt: null }, data: { autonomy: autopilotAutonomy(autonomy) } });
  const { log, data } = await stepArtifacts(run, autonomy);
  log.push(...(await stepOptimize(run, autonomy)));
  await save(run, log, data);
}

/** Advance one run by one stage (idempotent: every stage re-reads the records it depends on). */
export async function tickRun(runId: string): Promise<void> {
  const run = await db().marketingRun.findUnique({ where: { id: runId } });
  if (!run || !LIVE_STATUSES.includes(run.status)) return;
  if (!(await isModuleEnabled(run.organizationId, "marketing"))) return;
  // "Pause all AI" (/autonomy): the run waits where it is — no research, plan drafts, launches, artifacts or
  // auto-applied optimizations — and continues from the same stage once a person resumes AI.
  if (await isCompanyAiPaused(run.organizationId, run.companyId)) {
    await save(run, [entry("control", "waiting", "All AI in this company is paused (Autonomy) — the run continues when AI is resumed", "/autonomy")]);
    return;
  }
  const creator = await db().membership.findFirst({ where: { organizationId: run.organizationId, userId: run.createdById }, select: { id: true } });
  if (!creator) return blocked(run, "control", "The person who started this run is no longer a member — start a new run");
  try {
    switch (run.status) {
      case "RESEARCHING":
        return await stepResearch(run);
      case "PLANNING":
        return void (await stepPlanning(run));
      case "AWAITING_APPROVAL":
        return void (await stepApproval(run));
      case "LAUNCHING":
        return await stepLaunch(run);
      case "RUNNING":
        return await stepRunning(run);
    }
  } catch (err) {
    logger.warn({ runId, status: run.status, err: errText(err) }, "marketing run step failed");
    if (run.status === "RUNNING") await save(run, [entry("control", "failed", errText(err))]);
    else await blocked(run, run.status === "LAUNCHING" ? "autopilot" : run.status === "RESEARCHING" ? "research" : "plan", errText(err));
  }
}

/** Worker: advance every live run (at most every 90 s per run). */
export async function runMarketingRuns(): Promise<number> {
  const due = await db().marketingRun.findMany({ where: { status: { in: LIVE_STATUSES }, OR: [{ lastTickAt: null }, { lastTickAt: { lt: new Date(Date.now() - 90_000) } }] }, orderBy: { lastTickAt: { sort: "asc", nulls: "first" } }, take: 25, select: { id: true } });
  for (const r of due) await tickRun(r.id);
  return due.length;
}

/** What the run can use right now (guided setup): every item links to where it is connected. */
export async function runReadiness(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const [research, accounts, email, cms, seo, products] = await Promise.all([
    researchConnection(organizationId, companyId).catch(() => null),
    db().marketingSocialAccount.groupBy({ by: ["provider"], where: { organizationId, companyId, archivedAt: null }, _count: { _all: true } }),
    emailDeliveryReady(organizationId, companyId).catch(() => false),
    cmsTarget(organizationId, companyId),
    db().seoProject.count({ where: { organizationId, companyId, archivedAt: null, keywords: { some: {} } } }),
    db().graphEntity.findMany({ where: { organizationId, companyId, kind: "PRODUCT" }, orderBy: { name: "asc" }, take: 50, select: { id: true, name: true } }),
  ]);
  return {
    ai: aiConfigured(),
    /** "Pause all AI" is on: runs and autopilots wait until a person resumes AI in Autonomy. */
    aiPaused: await isCompanyAiPaused(organizationId, companyId),
    research,
    /** Platform keys that would enable web research (names only), when no research provider is available. */
    researchKeys: research ? [] : platformKeyOptions(RESEARCH_PROVIDERS),
    social: accounts.map((a) => ({ provider: a.provider, accounts: a._count._all })),
    email: !!email,
    cms,
    seoProjects: seo,
    products,
  };
}
