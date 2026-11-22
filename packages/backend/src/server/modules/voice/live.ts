import "server-only";
import { z } from "zod";
import type { VoiceProvider } from "@/generated/prisma/enums";
import { db, Prisma, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { getConnection, type Connection } from "@/server/modules/integrations/connections";
import { actorId, authorize, calleeTimeZone, companyTwilioNumbers, TWILIO_VOICE, inWindow, isUuid, LIVE_STATUSES, maskNumber, minutesLabel, OUTCOMES, PROVIDER_KEY, safeTz, toE164, type TranscriptLine } from "./common";
import { fileCallApproval } from "./calls";
import { ensureSettings, isDoNotCall } from "./service";
import type { LiveTranscriptEvent } from "./providers";
import { callCapabilities, controlLayer, notSupported, openControlUrl, supports, TELEPHONY, twilioCallerId, type ControlAction, type LiveCallRef, type TelephonyKey } from "./telephony";

/**
 * Live call center: what is on the phone right now (active, incoming, outgoing), what is queued, the incremental
 * transcript streamed by the providers, and the live controls each provider really supports. The browser polls the
 * lightweight board/transcript endpoints every ~2 s; nothing here invents activity — rows come from provider events.
 */

// ───────────── Incremental transcript ─────────────

export interface StoredLine {
  role: "agent" | "caller" | "human";
  text: string;
  atSec: number | null;
  key: string;
}

/** Store transcript lines of a call once each (a redelivered or grown turn updates its row). */
export async function storeTranscriptLines(organizationId: string, companyId: string, callId: string, source: "vapi" | "retell" | "twilio", lines: StoredLine[]): Promise<number> {
  let n = 0;
  for (const l of lines.slice(0, 200)) {
    if (!l.text.trim()) continue;
    await db().voiceTranscriptLine.upsert({
      where: { callId_dedupeKey: { callId, dedupeKey: l.key.slice(0, 200) } },
      create: { organizationId, companyId, callId, role: l.role, text: l.text.slice(0, 4000), atSec: l.atSec, source, dedupeKey: l.key.slice(0, 200) },
      update: { text: l.text.slice(0, 4000) },
    });
    n++;
  }
  return n;
}

/** Vapi / Retell real-time transcript event → rows on the matching call (calls placed outside Realy are ignored). */
export async function ingestLiveTranscript(organizationId: string, companyId: string, provider: VoiceProvider, ev: LiveTranscriptEvent): Promise<number> {
  let call = await db().voiceCall.findFirst({ where: { provider, externalCallId: ev.externalCallId, companyId }, select: { id: true } });
  if (!call && ev.realyCallId && isUuid(ev.realyCallId)) call = await db().voiceCall.findFirst({ where: { id: ev.realyCallId, companyId, organizationId }, select: { id: true } });
  if (!call) return 0;
  return storeTranscriptLines(organizationId, companyId, call.id, provider === "VAPI" ? "vapi" : "retell", ev.lines);
}

/** Lines of a call after `after` (ms epoch cursor); ended calls without live rows fall back to the final transcript. */
export async function transcriptSince(ctx: RequestContext, organizationId: string, companyId: string, callId: string, after: number | null) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  if (!isUuid(callId)) throw notFound("Call");
  const call = await db().voiceCall.findFirst({
    where: { id: callId, organizationId, companyId },
    select: { id: true, status: true, transcript: true, startedAt: true, durationSec: true, muted: true, transferredTo: true, takenOverAt: true, outcome: true, costMinor: true, telephonyCostMinor: true, costCurrency: true },
  });
  if (!call) throw notFound("Call");
  const rows = await db().voiceTranscriptLine.findMany({
    where: { callId, ...(after ? { createdAt: { gt: new Date(after) } } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 500,
    select: { id: true, role: true, text: true, atSec: true, createdAt: true },
  });
  let lines = rows.map((r) => ({ id: r.id, role: r.role, text: r.text, at: r.atSec, ts: r.createdAt.getTime() }));
  if (!after && !lines.length && !(LIVE_STATUSES as readonly string[]).includes(call.status)) {
    lines = (Array.isArray(call.transcript) ? (call.transcript as unknown as TranscriptLine[]) : []).map((l, i) => ({ id: `final-${i}`, role: l.role, text: l.text, at: l.at ?? null, ts: 0 }));
  }
  return {
    lines,
    cursor: rows.length ? rows[rows.length - 1]!.createdAt.getTime() : after,
    call: { status: call.status, startedAt: call.startedAt, durationSec: call.durationSec, muted: call.muted, transferredTo: call.transferredTo ? maskNumber(call.transferredTo) : null, takenOverAt: call.takenOverAt, outcome: call.outcome, costMinor: totalCost(call), costCurrency: call.costCurrency },
  };
}

const totalCost = (c: { costMinor: bigint | null; telephonyCostMinor: bigint | null }) => (c.costMinor === null && c.telephonyCostMinor === null ? null : (c.costMinor ?? BigInt(0)) + (c.telephonyCostMinor ?? BigInt(0)));

// ───────────── Board ─────────────

const refOf = (companyId: string, c: { provider: VoiceProvider | null; externalCallId: string | null; telephony: "PROVIDER" | "TWILIO" | null; telephonySid: string | null; controlUrlEnc: string | null }): LiveCallRef => ({
  provider: c.provider,
  externalCallId: c.externalCallId,
  telephony: c.telephony,
  telephonySid: c.telephonySid,
  controlUrl: openControlUrl(companyId, c.controlUrlEnc),
});

/** Everything the live call center shows, in one cheap query set (polled every ~2 s). */
export async function liveBoard(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const scope = { organizationId, companyId };
  const now = new Date();
  const [live, queued, awaiting, awaitingCount, settings, company, recent] = await Promise.all([
    db().voiceCall.findMany({
      where: { ...scope, status: { in: [...LIVE_STATUSES] } },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true, direction: true, status: true, provider: true, externalCallId: true, telephony: true, telephonySid: true, controlUrlEnc: true, toNumber: true, fromNumber: true, subjectName: true,
        leadId: true, contactId: true, purpose: true, startedAt: true, createdAt: true, costMinor: true, telephonyCostMinor: true, costCurrency: true, muted: true, transferredTo: true, takenOverAt: true, attempt: true,
        agent: { select: { id: true, name: true } }, campaign: { select: { id: true, name: true } },
      },
    }),
    db().voiceCall.findMany({
      where: { ...scope, status: "SCHEDULED" },
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
      take: 50,
      select: { id: true, toNumber: true, subjectName: true, scheduledFor: true, attempt: true, retryOfId: true, leadId: true, contactId: true, agent: { select: { name: true } }, campaign: { select: { id: true, name: true } } },
    }),
    db().voiceCall.findMany({ where: { ...scope, status: "AWAITING_APPROVAL" }, orderBy: { createdAt: "asc" }, take: 10, select: { id: true, toNumber: true, subjectName: true, createdAt: true, approvalId: true, campaign: { select: { name: true } } } }),
    db().voiceCall.count({ where: { ...scope, status: "AWAITING_APPROVAL" } }),
    ensureSettings(db(), organizationId, companyId),
    db().company.findFirst({ where: { id: companyId }, select: { timezone: true } }),
    db().voiceCall.findMany({
      where: { ...scope, status: { in: ["ENDED", "FAILED"] }, endedAt: { gte: new Date(now.getTime() - 30 * 60_000) } },
      orderBy: { endedAt: "desc" },
      take: 8,
      select: { id: true, direction: true, status: true, subjectName: true, toNumber: true, fromNumber: true, outcome: true, durationSec: true, endedAt: true, outcomeSetById: true },
    }),
  ]);
  const tz = safeTz(company?.timezone);
  const window = { startMin: settings.callingStartMin, endMin: settings.callingEndMin, days: settings.callingDays };
  const rows = live.map((c) => {
    const ref = refOf(companyId, c);
    const caps = callCapabilities(ref);
    const party = c.direction === "INBOUND" ? c.fromNumber : c.toNumber;
    return {
      id: c.id,
      lane: c.status === "IN_PROGRESS" ? ("active" as const) : c.direction === "INBOUND" ? ("incoming" as const) : ("outgoing" as const),
      direction: c.direction,
      status: c.status,
      provider: c.provider,
      telephony: c.telephony ?? "PROVIDER",
      person: c.subjectName,
      phone: party ? maskNumber(party) : null,
      leadId: c.leadId,
      contactId: c.contactId,
      purpose: c.purpose?.slice(0, 240) ?? null,
      agent: c.agent,
      campaign: c.campaign,
      startedAt: c.startedAt,
      createdAt: c.createdAt,
      costMinor: totalCost(c),
      costCurrency: c.costCurrency,
      muted: c.muted,
      transferredTo: c.transferredTo ? maskNumber(c.transferredTo) : null,
      takenOverAt: c.takenOverAt,
      attempt: c.attempt,
      capabilities: caps,
    };
  });
  return {
    now,
    calls: rows,
    counts: { active: rows.filter((r) => r.lane === "active").length, incoming: rows.filter((r) => r.lane === "incoming").length, outgoing: rows.filter((r) => r.lane === "outgoing").length, queued: queued.length, awaiting: awaitingCount },
    queue: queued.map((q) => ({ ...q, toNumber: maskNumber(q.toNumber), due: !q.scheduledFor || q.scheduledFor <= now })),
    awaiting: awaiting.map((a) => ({ ...a, toNumber: maskNumber(a.toNumber) })),
    recent: recent.map((r) => ({ ...r, toNumber: maskNumber(r.toNumber), fromNumber: r.fromNumber ? maskNumber(r.fromNumber) : null })),
    rules: {
      maxConcurrent: settings.maxConcurrent,
      window: `${minutesLabel(settings.callingStartMin)}–${minutesLabel(settings.callingEndMin)}`,
      days: settings.callingDays,
      timeZone: tz,
      openNow: inWindow(now, tz, window),
      telephony: settings.telephony,
      humanTransferNumber: settings.humanTransferNumber ? maskNumber(settings.humanTransferNumber) : null,
      retryMaxAttempts: settings.retryMaxAttempts,
      retryDelayMin: settings.retryDelayMin,
    },
  };
}

// ───────────── Live controls ─────────────

export const controlInput = z
  .object({
    action: z.enum(["end", "transfer", "takeover", "mute", "unmute", "hold", "unhold"]),
    /** Transfer target (international format); takeover uses the company's human transfer number when omitted. */
    number: z.string().trim().max(40).optional(),
  })
  .strict();

async function layerConnection(organizationId: string, companyId: string, layer: TelephonyKey): Promise<Connection | null> {
  // The "twilio" layer is the platform's Twilio Voice account (platform-managed twilio_voice).
  const conn = await getConnection(organizationId, companyId, layer === "twilio" ? TWILIO_VOICE : layer);
  return conn?.accessToken ? conn : null;
}

export async function controlCall(ctx: RequestContext, organizationId: string, companyId: string, callId: string, raw: z.input<typeof controlInput>) {
  const input = controlInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "communication.post");
  if (!isUuid(callId)) throw notFound("Call");
  const call = await db().voiceCall.findFirst({ where: { id: callId, organizationId, companyId } });
  if (!call) throw notFound("Call");
  if (!(LIVE_STATUSES as readonly string[]).includes(call.status)) throw conflict("This call is not live any more", { reason: "voice_call_not_live" });
  const ref = refOf(companyId, call);
  const layer = controlLayer(ref);
  const action = input.action as ControlAction;
  if (!layer || !supports(ref, action)) throw notSupported(layer, action);
  const settings = await ensureSettings(db(), organizationId, companyId);
  const conn = layer === "vapi" ? null : await layerConnection(organizationId, companyId, layer);
  if (layer === "twilio" && !conn) throw invalid("Telephony is not available on the platform right now", { reason: "voice_credential_required" });
  const provider = TELEPHONY[layer];
  // Platform account: a configured caller id is used only when it is one of this company's numbers.
  const own = layer === "twilio" ? await companyTwilioNumbers(organizationId, companyId) : new Set<string>();
  const cx = { ref, conn, callerId: layer === "twilio" ? twilioCallerId(conn, settings.twilioFromNumber && own.has(settings.twilioFromNumber) ? settings.twilioFromNumber : null) : null };
  let target: string | null = null;
  if (action === "transfer" || action === "takeover") {
    target = toE164(input.number ?? (action === "takeover" ? settings.humanTransferNumber : null));
    if (!target) throw invalid(action === "takeover" ? "Set the number of the person who takes calls over in phone settings" : "Enter the number in international format", { reason: action === "takeover" ? "voice_no_human_number" : "voice_number_invalid" });
  }
  const before = { muted: call.muted, transferredTo: call.transferredTo };
  try {
    if (action === "end") await provider.endCall(cx);
    else if (action === "mute" || action === "unmute") await provider.mute(cx, action === "mute");
    else if (action === "hold" || action === "unhold") await provider.hold(cx, action === "hold");
    else await provider.transfer(cx, target!, action === "takeover" ? "Connecting you to a member of our team now." : "Transferring your call now.");
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message.slice(0, 240) : "provider error";
    logger.warn({ callId, action, err: message }, "voice live control failed");
    throw new AppError("service_unavailable", `The provider did not accept the command: ${message}`, { reason: "voice_control_failed" });
  }
  return transaction(async (tx) => {
    const data =
      action === "mute" || action === "unmute"
        ? { muted: action === "mute" }
        : action === "transfer"
          ? { transferredTo: target }
          : action === "takeover"
            ? { transferredTo: target, takenOverAt: new Date(), takenOverById: actorId(ctx, organizationId) }
            : {};
    const u = await tx.voiceCall.update({ where: { id: callId }, data });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `voice.call.${action}`, resourceType: "voice_call", resourceId: callId, oldValue: { ...before, transferredTo: before.transferredTo ? maskNumber(before.transferredTo) : null }, newValue: { layer, ...(target ? { to: maskNumber(target) } : {}) } });
    return { ok: true, action, layer, muted: u.muted, transferredTo: u.transferredTo ? maskNumber(u.transferredTo) : null };
  });
}

// ───────────── Outcome, retry and callbacks ─────────────

export const outcomeInput = z.object({ outcome: z.enum(OUTCOMES), note: z.string().trim().max(1000).optional() }).strict();

/** A person sets (or corrects) the outcome. "Do not call" is honoured on the spot. */
export async function setCallOutcome(ctx: RequestContext, organizationId: string, companyId: string, callId: string, raw: z.input<typeof outcomeInput>) {
  const input = outcomeInput.parse(raw);
  if (!isUuid(callId)) throw notFound("Call");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const call = await tx.voiceCall.findFirst({ where: { id: callId, organizationId, companyId } });
    if (!call) throw notFound("Call");
    if (!["IN_PROGRESS", "ENDED", "FAILED"].includes(call.status)) throw conflict("Only calls that connected or ended have an outcome", { reason: "voice_outcome_state" });
    await tx.voiceCall.update({ where: { id: callId }, data: { outcome: input.outcome, outcomeSetById: actorId(ctx, organizationId), ...(input.note ? { summary: [call.summary, `Note: ${input.note}`].filter(Boolean).join("\n\n").slice(0, 5000) } : {}) } });
    const party = call.direction === "INBOUND" ? call.fromNumber : call.toNumber;
    if (input.outcome === "DO_NOT_CALL" && party) {
      await tx.voiceDoNotCall.upsert({ where: { companyId_phone: { companyId, phone: party } }, create: { organizationId, companyId, phone: party, source: "CALLER_REQUEST", reason: "Marked do-not-call in the live call center", callId, createdById: actorId(ctx, organizationId) }, update: {} });
      await tx.voiceCall.updateMany({ where: { companyId, toNumber: party, direction: "OUTBOUND", status: { in: ["AWAITING_APPROVAL", "SCHEDULED"] } }, data: { status: "BLOCKED", blockedReason: "do_not_call" } });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voice.call.outcome_set", resourceType: "voice_call", resourceId: callId, oldValue: { outcome: call.outcome }, newValue: { outcome: input.outcome } });
    return { ok: true, outcome: input.outcome };
  });
}

export const retryInput = z.object({ at: z.string().datetime({ offset: true }).optional(), purpose: z.string().trim().min(3).max(1000).optional() }).strict();

/** Call someone again (now or at a callback time). A new call is filed for approval like any other outbound call. */
export async function retryCall(ctx: RequestContext, organizationId: string, companyId: string, callId: string, raw: z.input<typeof retryInput>) {
  const input = retryInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "communication.post");
  if (!isUuid(callId)) throw notFound("Call");
  const call = await db().voiceCall.findFirst({ where: { id: callId, organizationId, companyId } });
  if (!call) throw notFound("Call");
  if (call.direction !== "OUTBOUND" && !call.fromNumber) throw invalid("The caller's number is unknown", { reason: "voice_number_missing" });
  if (!["ENDED", "FAILED", "BLOCKED", "CANCELLED", "REJECTED"].includes(call.status)) throw conflict("Wait until this call is over", { reason: "voice_call_not_finished" });
  const phone = call.direction === "OUTBOUND" ? call.toNumber : call.fromNumber!;
  const lead = call.leadId ? await db().lead.findFirst({ where: { id: call.leadId, companyId }, select: { tags: true } }) : null;
  const contact = call.contactId ? await db().contact.findFirst({ where: { id: call.contactId, companyId }, select: { tags: true } }) : null;
  if (await isDoNotCall(db(), companyId, phone, lead ?? contact ?? undefined)) throw invalid("This number is on the do-not-call list", { reason: "voice_do_not_call" });
  if (!call.agentId) throw invalid("Pick an agent for this call first", { reason: "voice_agent_not_synced" });
  const at = input.at ? new Date(input.at) : null;
  if (at && (at.getTime() < Date.now() - 60_000 || at.getTime() > Date.now() + 90 * 86_400_000)) throw invalid("Pick a time within the next 90 days", { reason: "voice_callback_time" });
  const purpose = input.purpose ?? `${at ? "Callback" : "Follow-up call"}: ${call.purpose ?? "continue the earlier conversation"}`.slice(0, 1000);
  const created = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const c = await tx.voiceCall.create({
      data: {
        organizationId, companyId, direction: "OUTBOUND", status: "AWAITING_APPROVAL", provider: call.provider, agentId: call.agentId, numberId: call.numberId,
        toNumber: phone, fromNumber: call.direction === "OUTBOUND" ? call.fromNumber : call.toNumber, leadId: call.leadId, contactId: call.contactId, subjectName: call.subjectName,
        purpose, requestedById: actorId(ctx, organizationId), scheduledFor: at, attempt: call.attempt + 1, retryOfId: call.id,
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: at ? "voice.call.callback_scheduled" : "voice.call.retry_requested", resourceType: "voice_call", resourceId: c.id, newValue: { retryOf: call.id, at } });
    return c;
  });
  return fileCallApproval(ctx, organizationId, companyId, created.id, "voice_caller", null, { label: `${call.subjectName ?? "unknown"} (${maskNumber(phone)})`, purpose });
}

/**
 * After a campaign call: unanswered calls are retried (settings.retryMaxAttempts, retryDelayMin apart) and a callback
 * the person asked for is scheduled at their time — both inside the approved campaign, both re-checked for
 * do-not-call and calling hours by the dialer. Returns the new call id, if any.
 */
export async function scheduleCampaignFollowUpCall(callId: string): Promise<string | null> {
  const call = await db().voiceCall.findUnique({ where: { id: callId }, include: { campaign: { select: { status: true } } } });
  if (!call || !call.campaignId || call.campaign?.status !== "RUNNING" || call.direction !== "OUTBOUND") return null;
  if (call.outcome === "DO_NOT_CALL" || call.outcome === "WRONG_NUMBER") return null;
  const settings = await ensureSettings(db(), call.organizationId, call.companyId);
  const a = call.analysis && typeof call.analysis === "object" && !Array.isArray(call.analysis) ? (call.analysis as Record<string, unknown>) : {};
  const unanswered = call.outcome === "NO_ANSWER" || call.outcome === "VOICEMAIL" || (call.status === "FAILED" && !call.durationSec);
  let at: Date | null = null;
  if (unanswered && call.attempt <= settings.retryMaxAttempts) at = new Date(Date.now() + settings.retryDelayMin * 60_000);
  if (!at && (call.outcome === "CALLBACK_REQUESTED" || a.callback_requested === true) && call.attempt <= 3) {
    const t = typeof a.callback_time === "string" ? new Date(a.callback_time) : null;
    if (t && !Number.isNaN(t.getTime()) && t.getTime() > Date.now() + 10 * 60_000 && t.getTime() < Date.now() + 30 * 86_400_000) at = t;
  }
  if (!at) return null;
  const existing = await db().voiceCall.findFirst({ where: { retryOfId: call.id }, select: { id: true } });
  if (existing) return null;
  const { tz } = calleeTimeZone(call.toNumber, (await db().company.findFirst({ where: { id: call.companyId }, select: { timezone: true } }))?.timezone ?? "UTC");
  const c = await db().voiceCall.create({
    data: {
      organizationId: call.organizationId, companyId: call.companyId, direction: "OUTBOUND", status: "SCHEDULED", provider: call.provider, agentId: call.agentId, numberId: call.numberId, campaignId: call.campaignId,
      toNumber: call.toNumber, fromNumber: call.fromNumber, leadId: call.leadId, contactId: call.contactId, subjectName: call.subjectName,
      purpose: call.purpose, requestedById: call.requestedById, requestedByProfile: call.requestedByProfile, scheduledFor: at, attempt: call.attempt + 1, retryOfId: call.id,
    },
  });
  logger.info({ callId: c.id, retryOf: call.id, at: at.toISOString(), tz }, "voice campaign follow-up call scheduled");
  return c.id;
}

// ───────────── Cost backfill ─────────────

/** Worker: fetch provider / Twilio prices of recently ended calls that did not report one in their events. */
export async function backfillCallCosts(): Promise<number> {
  const since = new Date(Date.now() - 2 * 86_400_000);
  const until = new Date(Date.now() - 2 * 60_000);
  const rows = await db().voiceCall.findMany({
    where: { status: "ENDED", endedAt: { gte: since, lte: until }, OR: [{ costMinor: null, externalCallId: { not: null }, provider: { not: null } }, { telephony: "TWILIO", telephonySid: { not: null }, telephonyCostMinor: null }] },
    take: 25,
    select: { id: true, organizationId: true, companyId: true, provider: true, externalCallId: true, telephony: true, telephonySid: true, costMinor: true, telephonyCostMinor: true },
  });
  let n = 0;
  for (const r of rows) {
    try {
      const data: Prisma.VoiceCallUpdateInput = {};
      if (r.costMinor === null && r.provider && r.externalCallId && !r.externalCallId.startsWith("CA")) {
        const conn = await layerConnection(r.organizationId, r.companyId, PROVIDER_KEY[r.provider]);
        const cents = conn ? await TELEPHONY[PROVIDER_KEY[r.provider]].cost(conn, r.externalCallId) : null;
        if (cents !== null) data.costMinor = BigInt(cents);
      }
      if (r.telephony === "TWILIO" && r.telephonySid && r.telephonyCostMinor === null) {
        const conn = await layerConnection(r.organizationId, r.companyId, "twilio");
        const cents = conn ? await TELEPHONY.twilio.cost(conn, r.telephonySid) : null;
        if (cents !== null) data.telephonyCostMinor = BigInt(cents);
      }
      if (Object.keys(data).length) {
        await db().voiceCall.update({ where: { id: r.id }, data });
        n++;
      }
    } catch (err) {
      logger.info({ callId: r.id, err: err instanceof Error ? err.message : err }, "voice cost backfill skipped");
    }
  }
  return n;
}
