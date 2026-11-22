import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { VoiceCallStatus } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { systemContext } from "@/server/core/context";
import { AppError, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { getControls, isModuleEnabled, isOrganizationSuspended } from "@/server/core/platform-controls";
import { writeAudit } from "@/server/modules/audit/service";
import { getConnection } from "@/server/modules/integrations/connections";
import { ProviderError } from "@/server/modules/integrations/providers";
import { requestTool } from "@/server/modules/tools/gateway";
import { actorId, authorize, calleeTimeZone, companyTwilioNumbers, TWILIO_VOICE, inWindow, isUuid, LIVE_STATUSES, maskNumber, nextWindowStart, OUTCOMES, PROVIDER_KEY, toE164, uuid } from "./common";
import { placeCall } from "./providers";
import { sealControlUrl, twilioCallerId, twilioPlaceCall } from "./telephony";
import { emitVoiceEvent, ensureSettings, isDoNotCall, providerLabel } from "./service";
import { assertFeature, assertLimit, checkLimit, hasFeature } from "@/server/modules/entitlements/service";

/**
 * Calls of the phone team. Outbound calls are requested by a person (CRM call button, /voice) or by an AI employee
 * (place_voice_call) and always go through the tool gateway: SUPERVISED + HIGH, so a person approves each call (or a
 * campaign as a whole) unless the founder granted autonomy for it. An approved call is dialled only inside the calling
 * window of the callee's time zone, never to a do-not-call number, only while the platform's kill switches allow AI
 * work, and only when the provider accepts it — otherwise the call says why it was not placed.
 */

export const requestCallInput = z
  .object({
    agentId: uuid,
    numberId: uuid.optional(),
    leadId: uuid.optional(),
    contactId: uuid.optional(),
    /** Manual number (international format) when calling someone not in the CRM. */
    phone: z.string().trim().max(40).optional(),
    name: z.string().trim().max(120).optional(),
    purpose: z.string().trim().min(3).max(1000),
  })
  .strict()
  .refine((v) => [v.leadId, v.contactId, v.phone].filter(Boolean).length === 1, { message: "Pick exactly one lead, contact or phone number" });

export interface CallSubject {
  leadId: string | null;
  contactId: string | null;
  name: string | null;
  phone: string;
  tags: string[];
}

/** Resolve the person to call inside the company; the number must be international and not on the do-not-call list. */
export async function resolveSubject(organizationId: string, companyId: string, r: { leadId?: string; contactId?: string; phone?: string; name?: string }): Promise<CallSubject> {
  const base = { organizationId, companyId, archivedAt: null };
  let s: Omit<CallSubject, "phone"> & { phone: string | null };
  if (r.leadId) {
    const l = await db().lead.findFirst({ where: { ...base, id: r.leadId }, select: { id: true, name: true, phone: true, tags: true } });
    if (!l) throw notFound("Lead");
    s = { leadId: l.id, contactId: null, name: l.name, phone: l.phone, tags: l.tags };
  } else if (r.contactId) {
    const c = await db().contact.findFirst({ where: { ...base, id: r.contactId }, select: { id: true, firstName: true, lastName: true, phone: true, tags: true } });
    if (!c) throw notFound("Contact");
    s = { leadId: null, contactId: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" "), phone: c.phone, tags: c.tags };
  } else {
    s = { leadId: null, contactId: null, name: r.name || null, phone: r.phone ?? null, tags: [] };
  }
  const phone = toE164(s.phone);
  if (!phone) throw invalid(s.phone ? "The phone number must be in international format (+country code…)" : "This record has no phone number", { reason: s.phone ? "voice_number_invalid" : "voice_number_missing" });
  if (await isDoNotCall(db(), companyId, phone, s)) throw invalid("This number is on the do-not-call list", { reason: "voice_do_not_call" });
  return { ...s, phone };
}

async function requireCallableAgent(organizationId: string, companyId: string, agentId: string, numberId?: string) {
  const agent = await db().voiceAgent.findFirst({ where: { id: agentId, organizationId, companyId, archivedAt: null } });
  if (!agent) throw notFound("Agent");
  if (agent.syncStatus !== "SYNCED" || !agent.externalAgentId) throw invalid("Sync the agent with the provider first", { reason: "voice_agent_not_synced" });
  const number = await db().voicePhoneNumber.findFirst({
    where: { organizationId, companyId, provider: agent.provider, releasedAt: null, ...(numberId ? { id: numberId } : {}) },
    orderBy: { createdAt: "asc" },
  });
  if (!number) throw invalid("Add a phone number for this provider first", { reason: "voice_no_number" });
  return { agent, number };
}

/** Request an outbound call: the call is recorded as awaiting approval and an approval request is filed. */
export async function requestCall(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof requestCallInput>) {
  const input = requestCallInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "communication.post");
  await assertFeature(ctx, organizationId, "feature.voice_agent");
  await assertLimit(ctx, organizationId, "voice.minutes.month", 1);
  const { agent, number } = await requireCallableAgent(organizationId, companyId, input.agentId, input.numberId);
  const subject = await resolveSubject(organizationId, companyId, input);
  const call = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const c = await tx.voiceCall.create({
      data: {
        organizationId,
        companyId,
        direction: "OUTBOUND",
        status: "AWAITING_APPROVAL",
        provider: agent.provider,
        agentId: agent.id,
        numberId: number.id,
        toNumber: subject.phone,
        fromNumber: number.number,
        leadId: subject.leadId,
        contactId: subject.contactId,
        subjectName: subject.name,
        purpose: input.purpose,
        requestedById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voice.call.requested", resourceType: "voice_call", resourceId: c.id, newValue: { to: maskNumber(subject.phone), agent: agent.name, leadId: subject.leadId, contactId: subject.contactId } });
    return c;
  });
  return fileCallApproval(ctx, organizationId, companyId, call.id, "voice_caller", null, { label: `${subject.name ?? "unknown"} (${maskNumber(subject.phone)})`, purpose: input.purpose });
}

/** Send an existing AWAITING_APPROVAL call through the tool gateway (approval, or direct execution with autonomy). */
export async function fileCallApproval(ctx: RequestContext, organizationId: string, companyId: string, callId: string, profileKey: string, taskId: string | null = null, display: { label?: string; purpose?: string } = {}) {
  const r = await requestTool("place_voice_call", { callId, ...display }, { ctx, organizationId, companyId, allowedTools: ["place_voice_call"], profileKey, taskId });
  if (r.status === "approval_requested") {
    await db().voiceCall.update({ where: { id: callId }, data: { approvalId: r.approvalId } });
    return { callId, status: "AWAITING_APPROVAL" as const, approvalId: r.approvalId };
  }
  const c = await db().voiceCall.findUniqueOrThrow({ where: { id: callId }, select: { status: true, blockedReason: true, scheduledFor: true } });
  return { callId, status: c.status, approvalId: null, blockedReason: c.blockedReason, scheduledFor: c.scheduledFor };
}

/** Create a call for an AI employee's approved place_voice_call (input without a pre-created call). */
export async function createApprovedCall(ctx: RequestContext, organizationId: string, companyId: string, input: { agentId?: string; leadId?: string; contactId?: string; purpose: string }) {
  await assertFeature(ctx, organizationId, "feature.voice_agent");
  await assertLimit(ctx, organizationId, "voice.minutes.month", 1);
  let agentId = input.agentId;
  if (!agentId) {
    const a = await db().voiceAgent.findFirst({ where: { organizationId, companyId, archivedAt: null, syncStatus: "SYNCED", goal: { not: "RECEPTIONIST" } }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!a) throw invalid("No synced voice agent is set up for outbound calls", { reason: "voice_agent_not_synced" });
    agentId = a.id;
  }
  const { agent, number } = await requireCallableAgent(organizationId, companyId, agentId);
  const subject = await resolveSubject(organizationId, companyId, input);
  return db().voiceCall.create({
    data: {
      organizationId,
      companyId,
      direction: "OUTBOUND",
      status: "SCHEDULED",
      provider: agent.provider,
      agentId: agent.id,
      numberId: number.id,
      toNumber: subject.phone,
      fromNumber: number.number,
      leadId: subject.leadId,
      contactId: subject.contactId,
      subjectName: subject.name,
      purpose: input.purpose,
      requestedById: actorId(ctx, organizationId),
      requestedByProfile: "ai",
      scheduledFor: new Date(),
    },
  });
}

/** Why AI calling is off right now (platform kill switches, module, suspension), or null. */
export async function callingBlocked(organizationId: string): Promise<string | null> {
  const c = await getControls();
  if (c.maintenanceMode) return "platform_maintenance";
  if (c.readOnlyMode) return "platform_read_only";
  if (!c.aiWorkforceEnabled) return "ai_workforce_disabled";
  if (c.aiExecutionPaused) return "ai_execution_paused";
  if (!(await isModuleEnabled(organizationId, "comms"))) return "module_disabled";
  if (await isOrganizationSuspended(organizationId)) return "organization_suspended";
  return null;
}

/**
 * Approved: dial now when inside the calling window, else schedule for the window's next opening. Used by the
 * place_voice_call tool after approval and by the dialer job.
 */
export async function approveAndDial(organizationId: string, companyId: string, callId: string): Promise<{ status: VoiceCallStatus; detail: string }> {
  const call = await db().voiceCall.findFirst({ where: { id: callId, organizationId, companyId } });
  if (!call) throw notFound("Call");
  if (call.status === "CANCELLED" || call.status === "BLOCKED" || call.status === "REJECTED") return { status: call.status, detail: `The call was ${call.status.toLowerCase()} before it was approved; nothing was dialled.` };
  if (call.status !== "AWAITING_APPROVAL" && call.status !== "SCHEDULED") return { status: call.status, detail: `The call is already ${call.status.toLowerCase()}.` };
  // A callback approved ahead of its time waits for it (the dialer job picks it up then).
  const later = call.scheduledFor && call.scheduledFor.getTime() > Date.now() + 60_000 ? call.scheduledFor : null;
  if (call.status === "AWAITING_APPROVAL") await db().voiceCall.updateMany({ where: { id: callId, status: "AWAITING_APPROVAL" }, data: { status: "SCHEDULED", scheduledFor: later ?? new Date() } });
  if (later) return { status: "SCHEDULED", detail: `Approved; the call is scheduled for ${later.toISOString()}.` };
  return dialCall(callId);
}

const block = async (callId: string, reason: string, status: VoiceCallStatus = "BLOCKED") => {
  await db().voiceCall.update({ where: { id: callId }, data: { status, blockedReason: reason } });
  return { status, detail: `Not placed: ${reason.replace(/_/g, " ")}.` };
};

/** Dial one SCHEDULED call if every rule allows it right now. Claims the call first so it is dialled once. */
export async function dialCall(callId: string): Promise<{ status: VoiceCallStatus; detail: string }> {
  const call = await db().voiceCall.findUnique({ where: { id: callId }, include: { agent: true, number: true, campaign: { select: { status: true, maxConcurrent: true } } } });
  if (!call || call.status !== "SCHEDULED") return { status: call?.status ?? "CANCELLED", detail: "Nothing to dial." };
  const { organizationId, companyId } = call;
  if (call.campaign && call.campaign.status !== "RUNNING") return { status: "SCHEDULED", detail: "The campaign is not running." };
  const blocked = await callingBlocked(organizationId);
  if (blocked) return { status: "SCHEDULED", detail: `Waiting: ${blocked.replace(/_/g, " ")}.` };
  // Plan (background dialer, no user ctx): never throw; the call is blocked with the reason instead.
  if (!(await hasFeature(organizationId, "feature.voice_agent")) || !(await checkLimit(organizationId, "voice.minutes.month", 1)).allowed) return block(callId, "plan_limit_reached");
  if (!call.agent || call.agent.archivedAt || !call.agent.externalAgentId || call.agent.syncStatus !== "SYNCED") return block(callId, "agent_not_ready");
  const settingsRow = await ensureSettings(db(), organizationId, companyId);
  const viaTwilio = settingsRow.telephony === "TWILIO";
  if (!viaTwilio && (!call.number || call.number.releasedAt)) return block(callId, "number_released");
  const lead = call.leadId ? await db().lead.findFirst({ where: { id: call.leadId, companyId }, select: { tags: true } }) : null;
  const contact = call.contactId ? await db().contact.findFirst({ where: { id: call.contactId, companyId }, select: { tags: true } }) : null;
  if (await isDoNotCall(db(), companyId, call.toNumber, lead ?? contact ?? undefined)) return block(callId, "do_not_call");

  const [settings, company] = await Promise.all([ensureSettings(db(), organizationId, companyId), db().company.findFirst({ where: { id: companyId }, select: { name: true, timezone: true } })]);
  const window = { startMin: settings.callingStartMin, endMin: settings.callingEndMin, days: settings.callingDays };
  const { tz } = calleeTimeZone(call.toNumber, company?.timezone ?? "UTC");
  const now = new Date();
  if (!inWindow(now, tz, window)) {
    const next = nextWindowStart(now, tz, window);
    if (!next) return block(callId, "no_calling_window");
    await db().voiceCall.update({ where: { id: callId }, data: { scheduledFor: next } });
    return { status: "SCHEDULED", detail: `Outside calling hours in ${tz}; scheduled for ${next.toISOString()}.` };
  }
  const live = await db().voiceCall.count({ where: { companyId, status: { in: [...LIVE_STATUSES] } } });
  const campaignLive = call.campaignId && call.campaign?.maxConcurrent ? await db().voiceCall.count({ where: { campaignId: call.campaignId, status: { in: [...LIVE_STATUSES] } } }) : 0;
  if (live >= settings.maxConcurrent || (call.campaign?.maxConcurrent && campaignLive >= call.campaign.maxConcurrent)) {
    await db().voiceCall.update({ where: { id: callId }, data: { scheduledFor: new Date(now.getTime() + 2 * 60_000) } });
    return { status: "SCHEDULED", detail: "Other calls are in progress; retrying in two minutes." };
  }
  if (viaTwilio) return dialViaTwilio(call, settings, company?.name ?? "");
  const conn = await getConnection(organizationId, companyId, PROVIDER_KEY[call.agent.provider]);
  if (!conn?.accessToken) return block(callId, "credential_required");
  if (!call.number) return block(callId, "number_released");

  // Claim: only one dialer places this call.
  const claimed = await db().voiceCall.updateMany({ where: { id: callId, status: "SCHEDULED" }, data: { status: "QUEUED", blockedReason: null } });
  if (!claimed.count) return { status: "QUEUED", detail: "Already being dialled." };
  try {
    const placed = await placeCall(call.agent.provider, conn, {
      agentExternalId: call.agent.externalAgentId,
      numberExternalId: call.number.externalId,
      to: call.toNumber,
      customerName: call.subjectName,
      variables: { customer_name: call.subjectName ?? "unknown", call_purpose: (call.purpose ?? "").slice(0, 1000), company_name: company?.name ?? "" },
      metadata: { realyCallId: call.id, realyCompanyId: companyId },
    });
    await transaction(async (tx) => {
      await tx.voiceCall.update({ where: { id: callId }, data: { externalCallId: placed.externalCallId, status: "QUEUED", error: null, telephony: "PROVIDER", ...(placed.controlUrl ? { controlUrlEnc: sealControlUrl(companyId, placed.controlUrl) } : {}) } });
      await writeAudit(tx, systemContext(), { category: "TENANT", organizationId, action: "voice.call.placed", resourceType: "voice_call", resourceId: callId, newValue: { provider: call.agent!.provider, to: maskNumber(call.toNumber) } });
      await emitVoiceEvent(tx, systemContext(), "voice.call_placed", { organizationId, companyId, entityType: "voice_call", entityId: callId, data: { direction: "OUTBOUND", leadId: call.leadId, contactId: call.contactId } });
    });
    return { status: "QUEUED", detail: `${providerLabel(call.agent.provider)} accepted the call to ${maskNumber(call.toNumber)}.` };
  } catch (err) {
    const message = (err instanceof ProviderError || err instanceof Error ? err.message : "call failed").slice(0, 300);
    await db().voiceCall.update({ where: { id: callId }, data: { status: "FAILED", error: message } });
    logger.warn({ callId, err: message }, "voice call was not placed");
    return { status: "FAILED", detail: `The provider did not accept the call: ${message}` };
  }
}

type DialableCall = Prisma.VoiceCallGetPayload<{ include: { agent: true; number: true; campaign: { select: { status: true; maxConcurrent: true } } } }>;

/**
 * Place a call through the company's Twilio account; the TwiML fetched on answer bridges it to the AI agent
 * (twilio.ts). The call record carries Twilio's CallSid until the AI provider (Retell) registers its own id.
 */
async function dialViaTwilio(call: DialableCall, settings: Awaited<ReturnType<typeof ensureSettings>>, companyName: string): Promise<{ status: VoiceCallStatus; detail: string }> {
  void companyName;
  const { organizationId, companyId } = call;
  const conn = await getConnection(organizationId, companyId, TWILIO_VOICE);
  if (!conn?.accessToken) return block(call.id, "credential_required");
  // Platform account: a configured caller id is used only when it is one of this company's numbers.
  const own = await companyTwilioNumbers(organizationId, companyId);
  const configured = settings.twilioFromNumber && own.has(settings.twilioFromNumber) ? settings.twilioFromNumber : null;
  const from = call.number && !call.number.releasedAt && call.number.source === "TWILIO" ? call.number.number : twilioCallerId(conn, configured);
  if (!from) return block(call.id, "twilio_caller_id_missing");
  const ready = settings.bridgeMode === "PROVIDER_SIP" ? call.agent?.provider === "RETELL" || !!settings.bridgeSipUri : settings.bridgeMode === "CUSTOM_SIP" ? !!settings.bridgeSipUri : !!settings.mediaStreamUrl;
  if (!ready) return block(call.id, "bridge_not_configured");
  const claimed = await db().voiceCall.updateMany({ where: { id: call.id, status: "SCHEDULED" }, data: { status: "QUEUED", blockedReason: null } });
  if (!claimed.count) return { status: "QUEUED", detail: "Already being dialled." };
  try {
    const placed = await twilioPlaceCall(conn, { to: call.toNumber, from, webhookKey: settings.webhookKey, callId: call.id, maxDurationSec: settings.maxDurationSec });
    await transaction(async (tx) => {
      await tx.voiceCall.update({ where: { id: call.id }, data: { telephony: "TWILIO", telephonySid: placed.sid, externalCallId: placed.sid, fromNumber: from, status: "QUEUED", error: null } });
      await writeAudit(tx, systemContext(), { category: "TENANT", organizationId, action: "voice.call.placed", resourceType: "voice_call", resourceId: call.id, newValue: { provider: "TWILIO", ai: call.agent?.provider ?? null, to: maskNumber(call.toNumber) } });
      await emitVoiceEvent(tx, systemContext(), "voice.call_placed", { organizationId, companyId, entityType: "voice_call", entityId: call.id, data: { direction: "OUTBOUND", leadId: call.leadId, contactId: call.contactId } });
    });
    return { status: "QUEUED", detail: `Twilio accepted the call to ${maskNumber(call.toNumber)}.` };
  } catch (err) {
    const message = (err instanceof Error ? err.message : "call failed").slice(0, 300);
    await db().voiceCall.update({ where: { id: call.id }, data: { status: "FAILED", error: message } });
    logger.warn({ callId: call.id, err: message }, "voice call was not placed through Twilio");
    return { status: "FAILED", detail: `Twilio did not accept the call: ${message}` };
  }
}

/** Worker: dial calls whose time has come (bounded per run). */
export async function dialDueCalls(): Promise<number> {
  const due = await db().voiceCall.findMany({ where: { status: "SCHEDULED", OR: [{ scheduledFor: null }, { scheduledFor: { lte: new Date() } }] }, orderBy: { scheduledFor: "asc" }, take: 50, select: { id: true } });
  let placed = 0;
  for (const c of due) {
    try {
      const r = await dialCall(c.id);
      if (r.status === "QUEUED") placed++;
    } catch (err) {
      logger.warn({ callId: c.id, err: err instanceof Error ? err.message : err }, "voice dialer failed for a call");
    }
  }
  return placed;
}

export async function cancelCall(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Call");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const { count } = await tx.voiceCall.updateMany({ where: { id, organizationId, companyId, status: { in: ["AWAITING_APPROVAL", "SCHEDULED"] } }, data: { status: "CANCELLED", blockedReason: "cancelled" } });
    if (!count) throw new AppError("conflict", "Only calls that were not dialled yet can be cancelled", { reason: "voice_call_not_cancellable" });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voice.call.cancelled", resourceType: "voice_call", resourceId: id });
    return { ok: true };
  });
}

// ───────────── Reads ─────────────

export const CALL_VIEWS = ["all", "live", "pending", "past", "inbound", "outbound"] as const;
export type CallView = (typeof CALL_VIEWS)[number];

export interface CallFilters {
  view?: CallView;
  outcome?: string;
  agentId?: string;
  leadId?: string;
  contactId?: string;
  campaignId?: string;
  page?: number;
}

export function parseCallFilters(raw: Record<string, string | string[] | undefined>): CallFilters {
  const one = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
  const view = one("view");
  const outcome = one("outcome");
  return {
    view: (CALL_VIEWS as readonly string[]).includes(view ?? "") ? (view as CallView) : "all",
    outcome: (OUTCOMES as readonly string[]).includes(outcome ?? "") ? outcome : undefined,
    agentId: isUuid(one("agent")) ? one("agent") : undefined,
    campaignId: isUuid(one("campaign")) ? one("campaign") : undefined,
    page: Math.max(1, Math.min(500, Number(one("page")) || 1)),
  };
}

const PAGE = 25;

export async function listCalls(ctx: RequestContext, organizationId: string, companyId: string, f: CallFilters = {}) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const where: Prisma.VoiceCallWhereInput = {
    organizationId,
    companyId,
    ...(f.view === "live" ? { status: { in: [...LIVE_STATUSES] } } : {}),
    ...(f.view === "pending" ? { status: { in: ["AWAITING_APPROVAL", "SCHEDULED"] } } : {}),
    ...(f.view === "past" ? { status: { in: ["ENDED", "FAILED", "BLOCKED", "CANCELLED", "REJECTED"] } } : {}),
    ...(f.view === "inbound" ? { direction: "INBOUND" } : {}),
    ...(f.view === "outbound" ? { direction: "OUTBOUND" } : {}),
    ...(f.outcome ? { outcome: f.outcome as (typeof OUTCOMES)[number] } : {}),
    ...(f.agentId ? { agentId: f.agentId } : {}),
    ...(f.leadId ? { leadId: f.leadId } : {}),
    ...(f.contactId ? { contactId: f.contactId } : {}),
    ...(f.campaignId ? { campaignId: f.campaignId } : {}),
  };
  const page = f.page ?? 1;
  const [total, rows] = await Promise.all([
    db().voiceCall.count({ where }),
    db().voiceCall.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      select: {
        id: true,
        direction: true,
        status: true,
        provider: true,
        toNumber: true,
        fromNumber: true,
        subjectName: true,
        leadId: true,
        contactId: true,
        outcome: true,
        sentiment: true,
        durationSec: true,
        summary: true,
        costMinor: true,
        costCurrency: true,
        scheduledFor: true,
        startedAt: true,
        createdAt: true,
        blockedReason: true,
        approvalId: true,
        agent: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
      },
    }),
  ]);
  return { rows, total, page, pageSize: PAGE };
}

export async function getCall(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  if (!isUuid(id)) throw notFound("Call");
  const c = await db().voiceCall.findFirst({
    where: { id, organizationId, companyId },
    include: { agent: { select: { id: true, name: true, goal: true, language: true } }, number: { select: { id: true, number: true, label: true } }, campaign: { select: { id: true, name: true } } },
  });
  if (!c) throw notFound("Call");
  const requester = c.requestedById ? await db().user.findFirst({ where: { id: c.requestedById }, select: { name: true } }) : null;
  return { ...c, requesterName: requester?.name ?? null };
}

/** Calls of a CRM lead or contact (for the call button panel on CRM pages). */
export async function subjectCalls(ctx: RequestContext, organizationId: string, companyId: string, subject: { leadId?: string; contactId?: string }, take = 5) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  if (!subject.leadId && !subject.contactId) return [];
  return db().voiceCall.findMany({
    where: { organizationId, companyId, ...(subject.leadId ? { leadId: subject.leadId } : { contactId: subject.contactId }) },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, status: true, direction: true, outcome: true, sentiment: true, summary: true, durationSec: true, createdAt: true, scheduledFor: true, blockedReason: true },
  });
}

/** Worker: calls whose approval was rejected or expired never run; mark them so (and their campaigns). */
export async function reconcileApprovals(): Promise<number> {
  const waiting = await db().voiceCall.findMany({ where: { status: "AWAITING_APPROVAL", approvalId: { not: null } }, select: { id: true, approvalId: true }, take: 500 });
  const campaigns = await db().voiceCampaign.findMany({ where: { status: "AWAITING_APPROVAL", approvalId: { not: null } }, select: { id: true, approvalId: true }, take: 200 });
  const ids = [...waiting.map((w) => w.approvalId!), ...campaigns.map((c) => c.approvalId!)];
  if (!ids.length) return 0;
  const closed = await db().approval.findMany({ where: { id: { in: ids }, status: { in: ["REJECTED", "EXPIRED", "FAILED"] } }, select: { id: true, status: true } });
  if (!closed.length) return 0;
  const closedIds = new Set(closed.map((c) => c.id));
  let n = 0;
  const callIds = waiting.filter((w) => closedIds.has(w.approvalId!)).map((w) => w.id);
  if (callIds.length) n += (await db().voiceCall.updateMany({ where: { id: { in: callIds }, status: "AWAITING_APPROVAL" }, data: { status: "REJECTED", blockedReason: "approval_rejected" } })).count;
  for (const c of campaigns.filter((x) => closedIds.has(x.approvalId!))) {
    await db().voiceCampaign.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
    n += (await db().voiceCall.updateMany({ where: { campaignId: c.id, status: "AWAITING_APPROVAL" }, data: { status: "REJECTED", blockedReason: "approval_rejected" } })).count;
  }
  return n;
}

/** Worker: calls the provider never finished reporting are marked failed after 3 hours (status unknown). */
export async function expireStuckCalls(): Promise<number> {
  const cutoff = new Date(Date.now() - 3 * 3_600_000);
  const { count } = await db().voiceCall.updateMany({
    where: { status: { in: [...LIVE_STATUSES] }, updatedAt: { lt: cutoff } },
    data: { status: "FAILED", error: "The provider never reported the end of this call" },
  });
  return count;
}


/**
 * Stream a call's provider-hosted recording through Realy (the page's CSP only allows same-origin media). The URL came
 * from a signature-verified provider webhook; only public https hosts are fetched.
 */
export async function recordingResponse(ctx: RequestContext, organizationId: string, companyId: string, id: string, range: string | null): Promise<Response> {
  const c = await getCall(ctx, organizationId, companyId, id);
  if (!c.recordingUrl) throw notFound("Recording");
  const u = new URL(c.recordingUrl);
  if (u.protocol !== "https:" || /^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(u.hostname) || u.hostname.endsWith(".internal") || u.hostname.endsWith(".local")) throw notFound("Recording");
  const reqHeaders: Record<string, string> = range && /^bytes=\d*-\d*$/.test(range) ? { range } : {};
  // Twilio recordings may require the account's credentials (HTTP Basic) when media authentication is on.
  if (u.hostname === "api.twilio.com") {
    const tw = await getConnection(organizationId, companyId, TWILIO_VOICE);
    const sid = typeof tw?.config.accountSid === "string" ? tw.config.accountSid : null;
    if (tw?.accessToken && sid && u.pathname.startsWith(`/2010-04-01/Accounts/${sid}/`)) reqHeaders.authorization = `Basic ${Buffer.from(`${sid}:${tw.accessToken}`).toString("base64")}`;
    else throw notFound("Recording");
  }
  const res = await fetch(u, { headers: reqHeaders, signal: AbortSignal.timeout(30_000), redirect: "follow" });
  if (!res.ok && res.status !== 206) throw new AppError("service_unavailable", "The provider did not return the recording", { reason: "voice_recording_unavailable" });
  const type = res.headers.get("content-type") ?? "audio/wav";
  const headers: Record<string, string> = { "content-type": /^audio\/|^application\/octet-stream/.test(type) ? type : "audio/wav", "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  for (const h of ["content-length", "content-range", "accept-ranges"]) {
    const v = res.headers.get(h);
    if (v) headers[h] = v;
  }
  return new Response(res.body, { status: res.status, headers });
}
