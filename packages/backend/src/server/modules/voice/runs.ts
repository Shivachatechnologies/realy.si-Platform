import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { VoiceRunTargetStatus } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { requestTool } from "@/server/modules/tools/gateway";
import { assertFeature } from "@/server/modules/entitlements/service";
import { suppressionFor } from "@/server/modules/crm/suppression";
import { updateLead } from "@/server/modules/crm/service";
import { actorId, authorize, isUuid, LIVE_STATUSES, maskNumber, toE164, uuid } from "./common";
import { isDoNotCall } from "./service";

/**
 * Autonomous calling campaign ("Call 100 qualified leads and book demos"):
 *   1. eligibility   CRM leads matching the criteria; skipped (with the reason) when the number is missing/invalid, on the
 *                    do-not-call list, email-suppressed, unsubscribed, without a consent record (when required), called
 *                    recently, or already queued
 *   2. prioritise    explainable score (lead score, label, stage, value, time since last contact)
 *   3. brief         per-lead context compiled from CRM records only (nothing invented) → the agent's call purpose
 *   4. execute       one approval for the whole run (start_calling_campaign, SUPERVISED + HIGH) → a VoiceCampaign the
 *                    dialer works through within calling hours, at the run's concurrency, re-checking do-not-call
 *   5. qualify/book  post-call processing (outcomes.ts) logs the call on the CRM, books agreed meetings through CRM
 *                    meetings and creates follow-ups; this module marks qualified leads in the CRM and rolls targets up
 *   6. report        when the campaign finishes: real counts, cost and cost per meeting; the requester is notified
 */

export const RUN_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL"] as const;
export const SKIP_REASONS = ["no_number", "invalid_number", "do_not_call", "suppressed", "unsubscribed", "no_consent_record", "recently_called", "call_pending", "duplicate_number", "over_limit"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export const runCriteria = z
  .object({
    stages: z.array(z.enum(RUN_STAGES)).min(1).max(4).default(["QUALIFIED"]),
    minScore: z.number().int().min(0).max(100).optional(),
    labels: z.array(z.enum(["HOT", "WARM", "NURTURE"])).max(3).default([]),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
    qualifiedOnly: z.boolean().default(false),
    maxCalls: z.number().int().min(1).max(200).default(100),
    cooldownDays: z.number().int().min(0).max(90).default(14),
    /** recorded_only: call only leads with a recorded consent basis (prospecting consent, or an opt-in tag). */
    consent: z.enum(["lawful_basis", "recorded_only"]).default("lawful_basis"),
  })
  .strict();

export const planRunInput = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    goal: z.string().trim().min(3).max(500),
    agentId: uuid.optional(),
    numberId: uuid.optional(),
    purpose: z.string().trim().min(3).max(600),
    maxConcurrent: z.number().int().min(1).max(10).optional(),
    criteria: runCriteria.partial().optional(),
  })
  .strict();

const LABEL_BONUS: Record<string, number> = { HOT: 20, WARM: 10, NURTURE: 0 };
const STAGE_BONUS: Record<string, number> = { NEW: 0, CONTACTED: 5, QUALIFIED: 10, PROPOSAL: 15 };
const CONSENT_TAGS = ["consent", "opt-in", "opted-in", "optin"];
const SUPPRESSING = ["unsubscribed", "complaint", "do_not_contact", "competitor"];
const DAY = 86_400_000;

async function pickAgentAndNumber(organizationId: string, companyId: string, agentId?: string, numberId?: string) {
  const agent = await db().voiceAgent.findFirst({
    where: { organizationId, companyId, archivedAt: null, syncStatus: "SYNCED", ...(agentId ? { id: agentId } : { goal: { not: "RECEPTIONIST" } }) },
    orderBy: { createdAt: "asc" },
  });
  if (!agent) throw invalid(agentId ? "Sync the agent with the provider first" : "Set up and sync an outbound voice agent first", { reason: "voice_agent_not_synced" });
  const number = await db().voicePhoneNumber.findFirst({ where: { organizationId, companyId, releasedAt: null, ...(numberId ? { id: numberId } : { provider: agent.provider }) }, orderBy: { createdAt: "asc" } });
  if (!number) throw invalid("Add a phone number first", { reason: "voice_no_number" });
  if (number.provider !== agent.provider) throw invalid("The agent and the number must be on the same provider", { reason: "voice_provider_mismatch" });
  return { agent, number };
}

const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : "");

/** Plan a run: eligibility, prioritisation and briefs. Nothing is called; the run waits to be started (approval). */
export async function planRun(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof planRunInput>, opts: { profile?: string | null } = {}) {
  const input = planRunInput.parse(raw);
  const c = runCriteria.parse(input.criteria ?? {});
  await authorize(ctx, organizationId, companyId, "communication.post");
  await assertFeature(ctx, organizationId, "feature.voice_agent");
  const { agent, number } = await pickAgentAndNumber(organizationId, companyId, input.agentId, input.numberId);
  const leads = await db().lead.findMany({
    where: {
      organizationId,
      companyId,
      archivedAt: null,
      mergedIntoId: null,
      convertedAt: null,
      stage: { in: c.stages },
      ...(c.minScore !== undefined ? { score: { gte: c.minScore } } : {}),
      ...(c.labels.length ? { scoreLabel: { in: c.labels } } : {}),
      ...(c.tags.length ? { tags: { hasSome: c.tags } } : {}),
      ...(c.qualifiedOnly ? { qualified: true } : {}),
    },
    orderBy: [{ score: "desc" }, { createdAt: "asc" }],
    take: Math.min(600, c.maxCalls * 3),
    select: { id: true, name: true, email: true, phone: true, account: true, source: true, notes: true, stage: true, score: true, scoreLabel: true, valueMinor: true, currency: true, lastContactedAt: true, tags: true, budget: true, authority: true, need: true, timeline: true, qualified: true },
  });
  const ids = leads.map((l) => l.id);
  const since = new Date(Date.now() - c.cooldownDays * DAY);
  const [recentCalls, prospects, activities, followUps] = await Promise.all([
    db().voiceCall.findMany({
      where: { organizationId, companyId, leadId: { in: ids }, status: { notIn: ["CANCELLED", "REJECTED", "BLOCKED"] } },
      orderBy: { createdAt: "desc" },
      select: { leadId: true, status: true, outcome: true, summary: true, createdAt: true },
      take: 2000,
    }),
    db().crmProspectPerson.findMany({ where: { companyId, leadId: { in: ids } }, select: { leadId: true, consentBasis: true, unsubscribedAt: true } }),
    db().leadActivity.findMany({ where: { organizationId, companyId, leadId: { in: ids }, occurredAt: { gte: new Date(Date.now() - 120 * DAY) } }, orderBy: { occurredAt: "desc" }, select: { leadId: true, type: true, summary: true, occurredAt: true }, take: 3000 }),
    db().leadFollowUp.findMany({ where: { organizationId, companyId, leadId: { in: ids }, completedAt: null }, select: { leadId: true, note: true, dueAt: true }, take: 2000 }),
  ]);
  const by = <T extends { leadId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) if (r.leadId) m.set(r.leadId, [...(m.get(r.leadId) ?? []), r]);
    return m;
  };
  const callsBy = by(recentCalls);
  const prospectBy = by(prospects);
  const actsBy = by(activities);
  const fuBy = by(followUps);

  const skipped = new Map<SkipReason, number>();
  const targets: Prisma.VoiceCallingTargetCreateManyInput[] = [];
  const eligible: (Prisma.VoiceCallingTargetCreateManyInput & { priority: number })[] = [];
  const seen = new Set<string>();
  const skip = (lead: (typeof leads)[number], reason: SkipReason, phone: string | null) => {
    skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
    if (targets.length < 500) targets.push({ organizationId, companyId, runId: "", leadId: lead.id, name: lead.name, phone, status: "SKIPPED", skipReason: reason });
  };
  for (const lead of leads) {
    if (!lead.phone) {
      skip(lead, "no_number", null);
      continue;
    }
    const phone = toE164(lead.phone);
    if (!phone) {
      skip(lead, "invalid_number", null);
      continue;
    }
    if (await isDoNotCall(db(), companyId, phone, lead)) {
      skip(lead, "do_not_call", phone);
      continue;
    }
    const p = prospectBy.get(lead.id) ?? [];
    if (p.some((x) => x.unsubscribedAt)) {
      skip(lead, "unsubscribed", phone);
      continue;
    }
    if (lead.email) {
      const hit = await suppressionFor(db(), companyId, lead.email);
      if (hit && SUPPRESSING.includes(hit.reason)) {
        skip(lead, "suppressed", phone);
        continue;
      }
    }
    const consentRecorded = p.some((x) => !!x.consentBasis) || lead.tags.some((t) => CONSENT_TAGS.includes(t.toLowerCase()));
    if (c.consent === "recorded_only" && !consentRecorded) {
      skip(lead, "no_consent_record", phone);
      continue;
    }
    const calls = callsBy.get(lead.id) ?? [];
    if (calls.some((x) => ["AWAITING_APPROVAL", "SCHEDULED", ...LIVE_STATUSES].includes(x.status))) {
      skip(lead, "call_pending", phone);
      continue;
    }
    if (c.cooldownDays > 0 && calls.some((x) => x.createdAt >= since)) {
      skip(lead, "recently_called", phone);
      continue;
    }
    if (seen.has(phone)) {
      skip(lead, "duplicate_number", phone);
      continue;
    }
    seen.add(phone);

    // Priority (0–100) with plain reasons.
    const reasons: string[] = [`score:${lead.score}`];
    let priority = lead.score * 0.6;
    if (LABEL_BONUS[lead.scoreLabel]) reasons.push(`label:${lead.scoreLabel}`);
    priority += LABEL_BONUS[lead.scoreLabel] ?? 0;
    if (STAGE_BONUS[lead.stage]) reasons.push(`stage:${lead.stage}`);
    priority += STAGE_BONUS[lead.stage] ?? 0;
    if (lead.valueMinor && lead.valueMinor > BigInt(0)) {
      priority += 5;
      reasons.push("has_value");
    }
    const quiet = !lead.lastContactedAt || lead.lastContactedAt.getTime() < Date.now() - 30 * DAY;
    if (quiet) {
      priority += 5;
      reasons.push("quiet_30d");
    }
    if (consentRecorded) reasons.push("consent_recorded");

    // Brief: CRM facts only.
    const acts = (actsBy.get(lead.id) ?? []).slice(0, 3);
    const lastCall = calls.find((x) => x.status === "ENDED");
    const fus = (fuBy.get(lead.id) ?? []).slice(0, 2);
    const brief = [
      `${lead.name}${lead.account ? ` (${lead.account})` : ""} · stage ${lead.stage.toLowerCase()} · score ${lead.score} (${lead.scoreLabel.toLowerCase()})${lead.source ? ` · source ${lead.source}` : ""}`,
      [lead.need && `Need: ${clip(lead.need, 140)}`, lead.budget && `Budget: ${clip(lead.budget, 80)}`, lead.authority && `Authority: ${clip(lead.authority, 80)}`, lead.timeline && `Timeline: ${clip(lead.timeline, 80)}`].filter(Boolean).join(" · "),
      lead.notes ? `Notes: ${clip(lead.notes, 200)}` : "",
      acts.length ? `Recent: ${acts.map((a) => `${a.occurredAt.toISOString().slice(0, 10)} ${a.type.toLowerCase()} — ${clip(a.summary, 90)}`).join("; ")}` : "No recorded activity in the last 120 days.",
      lastCall ? `Last AI call ${lastCall.createdAt.toISOString().slice(0, 10)}: ${lastCall.outcome?.toLowerCase().replace(/_/g, " ") ?? "no outcome"}${lastCall.summary ? ` — ${clip(lastCall.summary, 120)}` : ""}` : "",
      fus.length ? `Open follow-ups: ${fus.map((f) => clip(f.note, 80)).join("; ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    eligible.push({ organizationId, companyId, runId: "", leadId: lead.id, name: lead.name, phone, priority: Math.max(0, Math.min(100, Math.round(priority))), reasons, brief, status: "ELIGIBLE" });
  }
  eligible.sort((a, b) => b.priority - a.priority);
  const chosen = eligible.slice(0, c.maxCalls);
  for (const e of eligible.slice(c.maxCalls)) {
    skipped.set("over_limit", (skipped.get("over_limit") ?? 0) + 1);
    if (targets.length < 500) targets.push({ ...e, status: "SKIPPED", skipReason: "over_limit", brief: null });
  }
  const eligibility = { considered: leads.length, eligible: chosen.length, skipped: Object.fromEntries(skipped) };
  const name = input.name ?? `Calls: ${input.goal}`.slice(0, 120);
  const run = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const r = await tx.voiceCallingRun.create({
      data: {
        organizationId,
        companyId,
        name,
        goal: input.goal,
        criteria: c as unknown as Prisma.InputJsonValue,
        agentId: agent.id,
        numberId: number.id,
        purpose: input.purpose,
        maxConcurrent: input.maxConcurrent ?? null,
        eligibility: eligibility as unknown as Prisma.InputJsonValue,
        requestedById: actorId(ctx, organizationId),
        requestedByProfile: opts.profile ?? null,
      },
    });
    const all = [...chosen, ...targets].map((t) => ({ ...t, runId: r.id }));
    if (all.length) await tx.voiceCallingTarget.createMany({ data: all });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voice.run.planned", resourceType: "voice_calling_run", resourceId: r.id, newValue: { goal: input.goal, ...eligibility } });
    return r;
  });
  return { runId: run.id, name, eligibility };
}

/** File the run's single approval (or run it right away when the founder granted autonomy for it). */
export async function requestRunStart(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  await authorize(ctx, organizationId, companyId, "communication.post");
  if (!isUuid(runId)) throw notFound("Calling run");
  const run = await db().voiceCallingRun.findFirst({ where: { id: runId, organizationId, companyId } });
  if (!run) throw notFound("Calling run");
  if (run.status !== "PLANNED") throw conflict(`This run is ${run.status.toLowerCase().replace(/_/g, " ")}`, { reason: "voice_run_state" });
  const people = await db().voiceCallingTarget.count({ where: { runId, status: "ELIGIBLE" } });
  if (!people) throw invalid("Nobody in this run can be called", { reason: "voice_campaign_empty" });
  const r = await requestTool("start_calling_campaign", { runId, name: run.name, people }, { ctx, organizationId, companyId, allowedTools: ["start_calling_campaign"], profileKey: "voice_caller", taskId: null });
  if (r.status === "approval_requested") {
    await db().voiceCallingRun.update({ where: { id: runId }, data: { status: "AWAITING_APPROVAL", approvalId: r.approvalId } });
    return { runId, status: "AWAITING_APPROVAL" as const, approvalId: r.approvalId };
  }
  const after = await db().voiceCallingRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true } });
  return { runId, status: after.status, approvalId: null };
}

/**
 * Approved (start_calling_campaign): create the campaign and its calls in priority order. Targets are re-checked against
 * the do-not-call list now; the dialer re-checks again right before each call.
 */
export async function executeRun(ctx: RequestContext, organizationId: string, companyId: string, runId: string): Promise<{ started: boolean; detail: string; campaignId: string | null }> {
  const run = await db().voiceCallingRun.findFirst({ where: { id: runId, organizationId, companyId } });
  if (!run) throw notFound("Calling run");
  if (run.status !== "PLANNED" && run.status !== "AWAITING_APPROVAL") return { started: false, detail: `The run is ${run.status.toLowerCase()}; nothing changed.`, campaignId: run.campaignId };
  const { agent, number } = await pickAgentAndNumber(organizationId, companyId, run.agentId, run.numberId).catch((err) => {
    throw err instanceof AppError ? err : invalid("The run's agent or number is no longer available", { reason: "voice_agent_not_synced" });
  });
  const targets = await db().voiceCallingTarget.findMany({ where: { runId, status: "ELIGIBLE" }, orderBy: { priority: "desc" } });
  const callable: typeof targets = [];
  for (const t of targets) {
    if (!t.phone || (await isDoNotCall(db(), companyId, t.phone))) {
      await db().voiceCallingTarget.update({ where: { id: t.id }, data: { status: "SKIPPED", skipReason: "do_not_call" } });
      continue;
    }
    callable.push(t);
  }
  if (!callable.length) {
    await db().voiceCallingRun.update({ where: { id: runId }, data: { status: "CANCELLED", completedAt: new Date(), summary: "Nobody could be called when the run started." } });
    return { started: false, detail: "Nobody in this run can be called any more (do-not-call).", campaignId: null };
  }
  const now = Date.now();
  const campaignId = await transaction(async (tx) => {
    const camp = await tx.voiceCampaign.create({
      data: { organizationId, companyId, name: run.name, agentId: agent.id, numberId: number.id, purpose: run.purpose, status: "RUNNING", startedAt: new Date(), maxConcurrent: run.maxConcurrent, approvalId: run.approvalId, createdById: run.requestedById },
    });
    let rank = 0;
    for (const t of callable) {
      const purpose = `${run.purpose}\n\nContext (from the CRM):\n${t.brief ?? ""}`.slice(0, 1000);
      const call = await tx.voiceCall.create({
        data: {
          organizationId,
          companyId,
          direction: "OUTBOUND",
          status: "SCHEDULED",
          provider: agent.provider,
          agentId: agent.id,
          numberId: number.id,
          campaignId: camp.id,
          toNumber: t.phone!,
          fromNumber: number.number,
          leadId: t.leadId,
          contactId: t.contactId,
          subjectName: t.name,
          purpose,
          requestedById: run.requestedById,
          requestedByProfile: run.requestedByProfile,
          // The dialer takes due calls oldest-first: one second apart keeps the priority order.
          scheduledFor: new Date(now + rank++ * 1000),
        },
      });
      await tx.voiceCallingTarget.update({ where: { id: t.id }, data: { status: "SCHEDULED", callId: call.id } });
    }
    await tx.voiceCallingRun.update({ where: { id: runId }, data: { status: "RUNNING", campaignId: camp.id, startedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voice.run.started", resourceType: "voice_calling_run", resourceId: runId, newValue: { campaignId: camp.id, calls: callable.length } });
    return camp.id;
  });
  return { started: true, detail: `Calling run "${run.name}" started: ${callable.length} calls scheduled in priority order within calling hours (${maskNumber(number.number)}).`, campaignId };
}

export async function cancelRun(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  if (!isUuid(runId)) throw notFound("Calling run");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const run = await tx.voiceCallingRun.findFirst({ where: { id: runId, organizationId, companyId } });
    if (!run) throw notFound("Calling run");
    if (!["PLANNED", "AWAITING_APPROVAL", "RUNNING"].includes(run.status)) throw conflict("This run is already finished", { reason: "voice_run_state" });
    if (run.campaignId) {
      await tx.voiceCampaign.update({ where: { id: run.campaignId }, data: { status: "CANCELLED", completedAt: new Date() } });
      await tx.voiceCall.updateMany({ where: { campaignId: run.campaignId, status: { in: ["AWAITING_APPROVAL", "SCHEDULED"] } }, data: { status: "CANCELLED", blockedReason: "campaign_cancelled" } });
    }
    await tx.voiceCallingRun.update({ where: { id: runId }, data: { status: "CANCELLED", completedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voice.run.cancelled", resourceType: "voice_calling_run", resourceId: runId });
    return { ok: true };
  });
}

// ───────────── Reads ─────────────

export async function listRuns(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const rows = await db().voiceCallingRun.findMany({ where: { organizationId, companyId }, orderBy: { createdAt: "desc" }, take: 50 });
  const counts = await db().voiceCallingTarget.groupBy({ by: ["runId", "status"], where: { runId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
  return rows.map((r) => ({ ...r, stages: Object.fromEntries(counts.filter((c) => c.runId === r.id).map((c) => [c.status, c._count._all])) as Partial<Record<VoiceRunTargetStatus, number>> }));
}

export async function getRun(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  if (!isUuid(runId)) throw notFound("Calling run");
  const run = await db().voiceCallingRun.findFirst({ where: { id: runId, organizationId, companyId } });
  if (!run) throw notFound("Calling run");
  const [targets, agent] = await Promise.all([
    db().voiceCallingTarget.findMany({ where: { runId }, orderBy: [{ status: "asc" }, { priority: "desc" }], take: 700 }),
    db().voiceAgent.findFirst({ where: { id: run.agentId, companyId }, select: { id: true, name: true } }),
  ]);
  return { ...run, agent, targets: targets.map((t) => ({ ...t, phone: t.phone ? maskNumber(t.phone) : null })) };
}

// ───────────── Roll-up ─────────────

const QUALIFYING = ["INTERESTED", "MEETING_REQUESTED", "MEETING_BOOKED", "CALLBACK_REQUESTED", "PAYMENT_PROMISED"];

/** After a call is processed: move its run target forward (and mark a qualified lead in the CRM). */
export async function syncRunTargetForCall(callId: string): Promise<void> {
  const call = await db().voiceCall.findUnique({ where: { id: callId }, select: { id: true, organizationId: true, companyId: true, status: true, outcome: true, analysis: true, results: true, retryOfId: true, leadId: true } });
  if (!call) return;
  let target = await db().voiceCallingTarget.findFirst({ where: { callId: call.id } });
  // A retry / callback carries on the original call's target.
  for (let prev = call.retryOfId, hops = 0; !target && prev && hops < 5; hops++) {
    target = await db().voiceCallingTarget.findFirst({ where: { callId: prev } });
    if (target) await db().voiceCallingTarget.update({ where: { id: target.id }, data: { callId: call.id } });
    else prev = (await db().voiceCall.findUnique({ where: { id: prev }, select: { retryOfId: true } }))?.retryOfId ?? null;
  }
  if (!target) return;
  const results = (Array.isArray(call.results) ? call.results : []) as { type?: string; id?: string }[];
  const meeting = results.find((r) => r.type === "crm_meeting");
  const followUps = results.filter((r) => r.type === "lead_follow_up" || r.type === "crm_follow_up").length;
  const a = call.analysis && typeof call.analysis === "object" && !Array.isArray(call.analysis) ? (call.analysis as Record<string, unknown>) : {};
  let status: VoiceRunTargetStatus;
  if (meeting || call.outcome === "MEETING_BOOKED") status = "MEETING_BOOKED";
  else if (QUALIFYING.includes(call.outcome ?? "") || a.qualified === true) status = "QUALIFIED";
  else if (call.outcome === "NO_ANSWER" || call.outcome === "VOICEMAIL") status = "NO_ANSWER";
  else if (call.status === "FAILED") status = "FAILED";
  else if (call.status === "ENDED") status = "NOT_QUALIFIED";
  else status = "CALLING";
  await db().voiceCallingTarget.update({ where: { id: target.id }, data: { status, meetingId: meeting?.id ?? target.meetingId, followUps: target.followUps + followUps } });
  if ((status === "QUALIFIED" || status === "MEETING_BOOKED") && target.leadId) {
    await updateLead(systemContext(), call.organizationId, call.companyId, target.leadId, { qualified: true }).catch((err) => logger.info({ callId, err: err instanceof Error ? err.message : err }, "voice run: lead qualification skipped"));
  }
}

/** Real numbers of a run: calls, connections, conversations, qualified, meetings, follow-ups and cost. */
export async function runReport(organizationId: string, companyId: string, runId: string) {
  const run = await db().voiceCallingRun.findFirst({ where: { id: runId, organizationId, companyId } });
  if (!run) throw notFound("Calling run");
  const calls = run.campaignId
    ? await db().voiceCall.findMany({ where: { campaignId: run.campaignId }, select: { status: true, outcome: true, durationSec: true, externalCallId: true, costMinor: true, telephonyCostMinor: true, costCurrency: true } })
    : [];
  const stages = await db().voiceCallingTarget.groupBy({ by: ["status"], where: { runId }, _count: { _all: true } });
  const n = (s: VoiceRunTargetStatus) => stages.find((x) => x.status === s)?._count._all ?? 0;
  const placed = calls.filter((c) => c.externalCallId).length;
  const connected = calls.filter((c) => c.status === "ENDED" && (c.durationSec ?? 0) > 0 && c.outcome !== "NO_ANSWER" && c.outcome !== "VOICEMAIL").length;
  const conversations = calls.filter((c) => c.status === "ENDED" && (c.durationSec ?? 0) >= 30 && c.outcome !== "VOICEMAIL").length;
  const cost = calls.reduce((s, c) => s + (c.costMinor ?? BigInt(0)) + (c.telephonyCostMinor ?? BigInt(0)), BigInt(0));
  const meetings = n("MEETING_BOOKED");
  const followUps = (await db().voiceCallingTarget.aggregate({ where: { runId }, _sum: { followUps: true } }))._sum.followUps ?? 0;
  return {
    eligibility: run.eligibility,
    calls: calls.length,
    placed,
    connected,
    connectRate: placed ? Math.round((connected / placed) * 100) : null,
    conversations,
    qualified: n("QUALIFIED") + meetings,
    meetings,
    noAnswer: n("NO_ANSWER"),
    notQualified: n("NOT_QUALIFIED"),
    failed: n("FAILED"),
    followUps,
    costMinor: cost.toString(),
    currency: calls[0]?.costCurrency ?? "USD",
    costPerMeetingMinor: meetings ? (cost / BigInt(meetings)).toString() : null,
  };
}

/** Worker: refresh running runs; when their campaign is over, write the report and tell the requester. */
export async function advanceRuns(): Promise<number> {
  const running = await db().voiceCallingRun.findMany({ where: { status: "RUNNING" }, take: 50, select: { id: true, organizationId: true, companyId: true, campaignId: true, name: true, requestedById: true } });
  let n = 0;
  for (const r of running) {
    try {
      // Targets whose call ended but whose processing never synced them (e.g. processed before this run existed).
      const stale = await db().voiceCallingTarget.findMany({ where: { runId: r.id, status: { in: ["SCHEDULED", "CALLING"] }, callId: { not: null } }, select: { callId: true }, take: 100 });
      for (const t of stale) {
        const c = await db().voiceCall.findUnique({ where: { id: t.callId! }, select: { status: true, processedAt: true } });
        if (c && (LIVE_STATUSES as readonly string[]).includes(c.status)) await db().voiceCallingTarget.updateMany({ where: { callId: t.callId, status: "SCHEDULED" }, data: { status: "CALLING" } });
        else if (c && (c.processedAt || ["FAILED", "BLOCKED", "CANCELLED"].includes(c.status))) await syncRunTargetForCall(t.callId!);
      }
      const camp = r.campaignId ? await db().voiceCampaign.findUnique({ where: { id: r.campaignId }, select: { status: true } }) : null;
      if (camp && (camp.status === "COMPLETED" || camp.status === "CANCELLED")) {
        const report = await runReport(r.organizationId, r.companyId, r.id);
        const summary = `${report.placed} calls placed, ${report.connected} connected${report.connectRate !== null ? ` (${report.connectRate}%)` : ""}, ${report.conversations} conversations, ${report.qualified} qualified, ${report.meetings} meetings booked, ${report.followUps} follow-ups created.`;
        await transaction(async (tx) => {
          await tx.voiceCallingRun.update({ where: { id: r.id }, data: { status: camp.status === "COMPLETED" ? "COMPLETED" : "CANCELLED", completedAt: new Date(), report: report as unknown as Prisma.InputJsonValue, summary } });
          await writeAudit(tx, systemContext(), { category: "TENANT", organizationId: r.organizationId, action: "voice.run.completed", resourceType: "voice_calling_run", resourceId: r.id, newValue: { ...report } });
          if (r.requestedById !== r.organizationId) await notifyUsers(tx, r.organizationId, [r.requestedById], "voice.run_completed", { companyId: r.companyId, title: `${r.name}: ${summary}`.slice(0, 200), href: `/voice/campaigns/runs/${r.id}` });
        });
        n++;
      }
    } catch (err) {
      logger.warn({ runId: r.id, err: err instanceof Error ? err.message : err }, "voice run advance failed");
    }
  }
  // Runs whose approval was rejected or expired never start.
  const waiting = await db().voiceCallingRun.findMany({ where: { status: "AWAITING_APPROVAL", approvalId: { not: null } }, select: { id: true, approvalId: true }, take: 100 });
  if (waiting.length) {
    const closed = await db().approval.findMany({ where: { id: { in: waiting.map((w) => w.approvalId!) }, status: { in: ["REJECTED", "EXPIRED", "FAILED"] } }, select: { id: true } });
    const ids = new Set(closed.map((c) => c.id));
    for (const w of waiting.filter((x) => ids.has(x.approvalId!))) {
      await db().voiceCallingRun.update({ where: { id: w.id }, data: { status: "CANCELLED", completedAt: new Date(), summary: "The approval was rejected or expired; nobody was called." } });
      n++;
    }
  }
  return n;
}
