import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { MarketingPlanStatus } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask } from "@/server/modules/agents/service";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { actorId, authorize, CHANNELS, day, isUuid, money, toDay, toMinor, uuid } from "./common";
import { GOAL_METRICS, unifiedAnalytics } from "./intelligence";
import { createCampaign } from "./campaigns";
import { learningsContext } from "./learning";
import { brandContextFor } from "./brand";
import { extractJson } from "./ai";
import { researchBrief, usableResearch } from "./research-reports";

/**
 * Marketing Strategy: plans with positioning, measurable objectives, channel selection and a budget split. AI drafts are
 * kept as a proposal (aiDraft) until a person applies them; approval turns the objectives into tracked marketing goals.
 */

export const PLAN_STATUSES = ["DRAFT", "IN_REVIEW", "APPROVED", "ACTIVE", "ARCHIVED"] as const satisfies readonly MarketingPlanStatus[];
export const PLAN_SUBJECT = "marketing_plan";
export const CHANNEL_ROLES = ["awareness", "consideration", "conversion", "retention"] as const;

const objective = z.object({ metric: z.enum(GOAL_METRICS), target: z.number().positive().max(1e12), label: z.string().trim().max(160).default("") });
const channelInput = z.object({
  channel: z.enum(CHANNELS),
  role: z.enum(CHANNEL_ROLES).default("awareness"),
  /** Major units. */
  budget: money.or(z.literal("")).default(""),
  cadence: z.string().trim().max(160).default(""),
  rationale: z.string().trim().max(1000).default(""),
});

export const planInput = z.object({
  name: z.string().trim().min(1).max(160),
  periodStart: day,
  periodEnd: day,
  positioning: z.string().trim().max(3000).optional(),
  audience: z.string().trim().max(3000).optional(),
  messaging: z.string().trim().max(3000).optional(),
  objectives: z.array(objective).max(12).default([]),
  channels: z.array(channelInput).max(CHANNELS.length).default([]),
  /** Total budget in major units. */
  budget: money.or(z.literal("")).default(""),
  researchIds: z.array(uuid).max(12).default([]),
});
export const updatePlanInput = planInput.partial();

export const planActionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit") }),
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("request_changes"), note: z.string().trim().min(1).max(2000) }),
  z.object({ action: z.literal("activate") }),
  z.object({ action: z.literal("archive") }),
  z.object({ action: z.literal("apply_ai_draft") }),
  z.object({ action: z.literal("create_campaign") }),
]);
export const planAiInput = z.object({ note: z.string().trim().max(2000).optional() });

export interface PlanChannel {
  channel: (typeof CHANNELS)[number];
  role: (typeof CHANNEL_ROLES)[number];
  budgetMinor: string;
  cadence: string;
  rationale: string;
}
export type PlanObjective = z.infer<typeof objective>;

export const planChannels = (v: Prisma.JsonValue): PlanChannel[] =>
  Array.isArray(v) ? (v as unknown as PlanChannel[]).filter((c) => c && (CHANNELS as readonly string[]).includes(c.channel)).map((c) => ({ ...c, budgetMinor: /^\d+$/.test(String(c.budgetMinor)) ? String(c.budgetMinor) : "0" })) : [];
export const planObjectives = (v: Prisma.JsonValue): PlanObjective[] => (Array.isArray(v) ? (v as unknown as PlanObjective[]).filter((o) => o && (GOAL_METRICS as readonly string[]).includes(o.metric) && typeof o.target === "number") : []);

const aiDraftSchema = z.object({
  positioning: z.string().max(3000).default(""),
  audience: z.string().max(3000).default(""),
  messaging: z.union([z.array(z.string().max(500)).max(12), z.string().max(3000)]).default([]),
  objectives: z.array(z.object({ metric: z.enum(GOAL_METRICS), target: z.number().positive().max(1e12), label: z.string().max(160).default("") })).max(12).default([]),
  channels: z
    .array(z.object({ channel: z.enum(CHANNELS), role: z.enum(CHANNEL_ROLES).catch("awareness"), budgetShare: z.number().min(0).max(1).default(0), cadence: z.string().max(160).default(""), rationale: z.string().max(1000).default("") }))
    .max(CHANNELS.length)
    .default([]),
  assumptions: z.array(z.string().max(500)).max(12).default([]),
});
export type PlanAiDraft = z.infer<typeof aiDraftSchema>;
export const parseAiDraft = (v: Prisma.JsonValue | null): PlanAiDraft | null => {
  if (!v) return null;
  const r = aiDraftSchema.safeParse(v);
  return r.success ? r.data : null;
};

function channelsData(channels: z.infer<typeof channelInput>[]): PlanChannel[] {
  const seen = new Set<string>();
  return channels
    .filter((c) => (seen.has(c.channel) ? false : (seen.add(c.channel), true)))
    .map((c) => ({ channel: c.channel, role: c.role, budgetMinor: String(toMinor(c.budget || null) ?? 0n), cadence: c.cadence, rationale: c.rationale }));
}

function checkPeriod(start: Date, end: Date) {
  if (end < start) throw invalid("The plan must end after it starts", { reason: "marketing_plan_period" });
  if (end.getTime() - start.getTime() > 3 * 366 * 86_400_000) throw invalid("A plan can cover at most three years", { reason: "marketing_plan_period" });
}

async function ownedResearch(organizationId: string, companyId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db().marketingResearchReport.findMany({ where: { id: { in: ids }, organizationId, companyId, archivedAt: null }, select: { id: true } });
  if (rows.length !== new Set(ids).size) throw notFound("Research report");
  return [...new Set(ids)];
}

export async function listPlans(ctx: RequestContext, organizationId: string, companyId: string, includeArchived = false) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  return db().marketingPlan.findMany({ where: { organizationId, companyId, ...(includeArchived ? {} : { status: { not: "ARCHIVED" } }) }, orderBy: [{ periodStart: "desc" }], take: 100 });
}

export async function getPlan(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  if (!isUuid(id)) throw notFound("Marketing plan");
  const p = await db().marketingPlan.findFirst({ where: { id, organizationId, companyId } });
  if (!p) throw notFound("Marketing plan");
  return p;
}

export async function createPlan(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof planInput>) {
  const input = planInput.parse(raw);
  const start = toDay(input.periodStart)!;
  const end = toDay(input.periodEnd)!;
  checkPeriod(start, end);
  const researchIds = await ownedResearch(organizationId, companyId, input.researchIds);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const company = await tx.company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { baseCurrency: true } });
    const p = await tx.marketingPlan.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        periodStart: start,
        periodEnd: end,
        positioning: input.positioning || null,
        audience: input.audience || null,
        messaging: input.messaging || null,
        objectives: input.objectives as Prisma.InputJsonValue,
        channels: channelsData(input.channels) as unknown as Prisma.InputJsonValue,
        budgetMinor: toMinor(input.budget || null) ?? 0n,
        currency: company.baseCurrency,
        researchIds,
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.plan.created", resourceType: "marketing_plan", resourceId: p.id, newValue: { name: p.name, periodStart: input.periodStart, periodEnd: input.periodEnd } });
    return p;
  });
}

export async function updatePlan(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updatePlanInput>) {
  const input = updatePlanInput.parse(raw);
  const current = await getPlan(ctx, organizationId, companyId, id);
  if (current.status !== "DRAFT") throw conflict("Only draft plans can be edited — request changes first", { reason: "marketing_plan_locked" });
  const start = input.periodStart ? toDay(input.periodStart)! : current.periodStart;
  const end = input.periodEnd ? toDay(input.periodEnd)! : current.periodEnd;
  checkPeriod(start, end);
  const researchIds = input.researchIds ? await ownedResearch(organizationId, companyId, input.researchIds) : undefined;
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingPlan.updateMany({
      where: { id, organizationId, companyId, status: "DRAFT" },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        periodStart: start,
        periodEnd: end,
        ...(input.positioning !== undefined ? { positioning: input.positioning || null } : {}),
        ...(input.audience !== undefined ? { audience: input.audience || null } : {}),
        ...(input.messaging !== undefined ? { messaging: input.messaging || null } : {}),
        ...(input.objectives ? { objectives: input.objectives as Prisma.InputJsonValue } : {}),
        ...(input.channels ? { channels: channelsData(input.channels) as unknown as Prisma.InputJsonValue } : {}),
        ...(input.budget !== undefined ? { budgetMinor: toMinor(input.budget || null) ?? 0n } : {}),
        ...(researchIds ? { researchIds } : {}),
      },
    });
    if (!count) throw conflict("The plan changed — reload", { reason: "marketing_plan_locked" });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.plan.updated", resourceType: "marketing_plan", resourceId: id, newValue: { ...input } });
    return tx.marketingPlan.findUniqueOrThrow({ where: { id } });
  });
}

/** Workflow: draft → in review → approved (goals created) → active (campaign) → archived. */
export async function planAction(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof planActionInput>) {
  const input = planActionInput.parse(raw);
  const p = await getPlan(ctx, organizationId, companyId, id);
  const bad = () => conflict(`Cannot ${input.action} a ${p.status} plan`, { reason: "marketing_invalid_transition" });

  if (input.action === "create_campaign") {
    if (p.status !== "APPROVED" && p.status !== "ACTIVE") throw bad();
    if (p.campaignId) throw conflict("A campaign was already created from this plan", { reason: "marketing_plan_campaign_exists" });
    const objectives = planObjectives(p.objectives);
    const leads = objectives.find((o) => o.metric === "leads");
    const campaign = await createCampaign(ctx, organizationId, companyId, {
      name: p.name.slice(0, 200),
      objective: (objectives.map((o) => o.label || `${o.metric} ${o.target}`).join(" · ") || p.positioning || "").slice(0, 500) || undefined,
      description: [p.positioning, p.messaging].filter(Boolean).join("\n\n").slice(0, 5000) || undefined,
      channels: planChannels(p.channels).map((c) => c.channel),
      targetLeads: leads ? Math.round(leads.target) : null,
      budget: p.budgetMinor > 0n ? (Number(p.budgetMinor) / 100).toFixed(2) : "",
      startDate: p.periodStart.toISOString().slice(0, 10),
      endDate: p.periodEnd.toISOString().slice(0, 10),
    });
    return transaction(async (tx) => {
      await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
      const updated = await tx.marketingPlan.update({ where: { id }, data: { campaignId: campaign.id, status: "ACTIVE" } });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.plan.campaign_created", resourceType: "marketing_plan", resourceId: id, newValue: { campaignId: campaign.id } });
      return updated;
    });
  }

  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    let data: Prisma.MarketingPlanUncheckedUpdateInput;
    switch (input.action) {
      case "submit": {
        if (p.status !== "DRAFT") throw bad();
        if (!planObjectives(p.objectives).length || !planChannels(p.channels).length) throw invalid("Add at least one objective and one channel first", { reason: "marketing_plan_incomplete" });
        data = { status: "IN_REVIEW", submittedAt: new Date(), reviewNote: null };
        const users = await usersWithPermission(tx, organizationId, companyId, "marketing.manage");
        await notifyUsers(tx, organizationId, users.filter((u) => u !== ctx.actor.id).slice(0, 25), "marketing.plan_review", { companyId, title: p.name, href: `/marketing/strategy/${p.id}` });
        break;
      }
      case "request_changes":
        if (p.status !== "IN_REVIEW") throw bad();
        data = { status: "DRAFT", reviewNote: input.note };
        await notifyUsers(tx, organizationId, [p.createdById], "marketing.plan_changes", { companyId, title: p.name, href: `/marketing/strategy/${p.id}` });
        break;
      case "approve": {
        if (p.status !== "IN_REVIEW") throw bad();
        // Objectives become tracked marketing goals for the plan period (progress is computed from real data).
        const goalIds: string[] = [];
        for (const o of planObjectives(p.objectives)) {
          const g = await tx.marketingGoal.create({ data: { organizationId, companyId, name: (o.label || `${p.name}: ${o.metric}`).slice(0, 160), metric: o.metric, target: o.target, startDate: p.periodStart, endDate: p.periodEnd, createdById: actorId(ctx, organizationId) } });
          goalIds.push(g.id);
        }
        data = { status: "APPROVED", approvedById: ctx.actor.id ?? null, approvedAt: new Date(), goalIds, reviewNote: null };
        await notifyUsers(tx, organizationId, [p.createdById], "marketing.plan_approved", { companyId, title: p.name, href: `/marketing/strategy/${p.id}` });
        break;
      }
      case "activate":
        if (p.status !== "APPROVED") throw bad();
        data = { status: "ACTIVE" };
        break;
      case "archive":
        if (p.status === "ARCHIVED") throw bad();
        data = { status: "ARCHIVED" };
        break;
      case "apply_ai_draft": {
        if (p.status !== "DRAFT") throw bad();
        const d = parseAiDraft(p.aiDraft);
        if (!d) throw conflict("There is no AI draft to apply", { reason: "marketing_plan_no_draft" });
        const total = Number(p.budgetMinor);
        const shareSum = d.channels.reduce((s, c) => s + c.budgetShare, 0) || 1;
        data = {
          positioning: d.positioning || p.positioning,
          audience: d.audience || p.audience,
          messaging: (Array.isArray(d.messaging) ? d.messaging.join("\n") : d.messaging) || p.messaging,
          objectives: d.objectives.length ? (d.objectives as Prisma.InputJsonValue) : (p.objectives as Prisma.InputJsonValue),
          channels: d.channels.length
            ? (d.channels.map((c) => ({ channel: c.channel, role: c.role, budgetMinor: String(Math.round((total * c.budgetShare) / shareSum)), cadence: c.cadence, rationale: c.rationale })) as unknown as Prisma.InputJsonValue)
            : (p.channels as Prisma.InputJsonValue),
        };
        break;
      }
    }
    const updated = await tx.marketingPlan.update({ where: { id }, data });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `marketing.plan.${input.action}`, resourceType: "marketing_plan", resourceId: id, oldValue: { status: p.status }, newValue: { status: updated.status } });
    return updated;
  });
}

/** Ask the CMO AI to draft the plan from research, real performance and learnings. The result is a proposal. */
export async function draftPlanWithAi(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof planAiInput>) {
  const input = planAiInput.parse(raw);
  const p = await getPlan(ctx, organizationId, companyId, id);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  if (p.status !== "DRAFT") throw conflict("Only draft plans can be drafted by AI", { reason: "marketing_plan_locked" });
  const now = new Date();
  const [research, analytics, learnings, brand] = await Promise.all([
    usableResearch(organizationId, companyId, p.researchIds.length ? p.researchIds : undefined, 6),
    unifiedAnalytics(organizationId, companyId, { from: new Date(now.getTime() - 90 * 86_400_000), to: now }),
    learningsContext(companyId),
    brandContextFor(companyId),
  ]);
  const perf = `Last 90 days (real data): ${analytics.kpis.leadsCreated} leads, ${analytics.kpis.newCustomers} new customers, spend ${(Number(analytics.totalSpendMinor) / 100).toFixed(2)} ${p.currency}, ${analytics.social.posts} social posts (${analytics.social.impressions} impressions, ${analytics.social.engagement} engagements), ${analytics.email.sent} emails sent (open rate ${analytics.email.openRate == null ? "n/a" : (analytics.email.openRate * 100).toFixed(1) + "%"}), ad spend ${(Number(analytics.ads.spendMinor) / 100).toFixed(2)} with ${analytics.ads.conversions} conversions. Best platforms: ${analytics.platforms.slice(0, 3).map((x) => x.provider).join(", ") || "none yet"}.`;
  const task = await createTask(ctx, organizationId, companyId, {
    profile: "cmo",
    title: `Marketing plan draft: ${p.name}`.slice(0, 200),
    instructions: `Draft the marketing plan "${p.name}" for ${p.periodStart.toISOString().slice(0, 10)} to ${p.periodEnd.toISOString().slice(0, 10)} with a total budget of ${(Number(p.budgetMinor) / 100).toFixed(2)} ${p.currency}.
Choose the channels (only from: ${CHANNELS.join(", ")}), give each a funnel role (${CHANNEL_ROLES.join(", ")}), a share of the budget (budgetShare 0-1, shares sum to 1), a realistic cadence and the reason. Set 2-5 measurable objectives using only these metrics: ${GOAL_METRICS.join(", ")}; targets must be realistic given the performance below (say so in assumptions when there is no history).
Ground everything in the research, the performance numbers and the company's documents — never invent facts. List every assumption you made.
${input.note ? `Direction from the person: ${input.note}\n` : ""}
Return ONLY valid JSON: { "positioning": string, "audience": string, "messaging": string[], "objectives": [{ "metric": string, "target": number, "label": string }], "channels": [{ "channel": string, "role": string, "budgetShare": number, "cadence": string, "rationale": string }], "assumptions": string[] }

${perf}
${learnings ? `\n${learnings}\n` : ""}
${research.length ? research.map((r) => researchBrief(r)).join("\n\n") : "No saved research reports — use read tools and web_research if needed, and state assumptions."}
${brand ? `\n${brand}` : ""}`.slice(0, 20_000),
    subject: { type: PLAN_SUBJECT, id: p.id },
  });
  await transaction(async (tx) => {
    await tx.marketingPlan.update({ where: { id }, data: { draftTaskId: task.id, draftError: null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.plan.ai_requested", resourceType: "marketing_plan", resourceId: id, newValue: { taskId: task.id } });
  });
  return task;
}

/** Worker: store a finished drafting task's JSON as the plan's AI draft (never overwrites the plan itself). */
export async function ingestPlanTask(planId: string, companyId: string, taskId: string): Promise<void> {
  const p = await db().marketingPlan.findFirst({ where: { id: planId, companyId, draftTaskId: taskId } });
  if (!p) return;
  const task = await db().agentTask.findUnique({ where: { id: taskId }, select: { status: true, output: true, errorCode: true } });
  if (!task || task.status === "QUEUED" || task.status === "RUNNING") return;
  if (task.status !== "COMPLETED" || !task.output) {
    await db().marketingPlan.update({ where: { id: p.id }, data: { draftError: (task.errorCode ?? task.status).slice(0, 200) } });
    return;
  }
  const parsed = aiDraftSchema.safeParse(extractJson(task.output));
  await db().marketingPlan.update({ where: { id: p.id }, data: parsed.success ? { aiDraft: parsed.data as Prisma.InputJsonValue, draftError: null } : { draftError: "ai_output_unparseable" } });
}
