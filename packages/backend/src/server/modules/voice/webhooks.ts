import "server-only";
import type { VoiceCallOutcome, VoiceProvider, VoiceSentiment } from "@/generated/prisma/enums";
import { db, Prisma } from "@/server/core/db";
import { dispatchJob, MODULE_JOBS_QUEUE } from "@/server/core/jobs";
import { logger } from "@/server/core/logger";
import { consume } from "@/server/core/rate-limit";
import { getConnection } from "@/server/modules/integrations/connections";
import { last10, obj, str } from "./common";
import { parseRetell, parseVapi, verifyRetellSignature, verifyVapiSecret, type NormalizedEvent } from "./providers";
import { readVapiSecret } from "./service";
import { processCall } from "./outcomes";
import { recordUsage } from "@/server/modules/entitlements/service";

/**
 * Provider webhooks: POST /api/v1/webhooks/voice/{vapi|retell}/{webhookKey}. The key identifies the company; the request
 * is authentic only when the provider's signature (Retell) or shared secret (Vapi) verifies over the raw body. Events
 * update the call (status, transcript, analysis, recording, cost); the final event triggers post-call processing.
 */

const LIMIT = { name: "voice-webhook", limit: 600, windowMs: 60_000 };

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

const OUTCOME_MAP: Record<string, VoiceCallOutcome> = {
  interested: "INTERESTED",
  not_interested: "NOT_INTERESTED",
  meeting_requested: "MEETING_REQUESTED",
  callback_requested: "CALLBACK_REQUESTED",
  support_issue: "SUPPORT_ISSUE",
  payment_promised: "PAYMENT_PROMISED",
  message_taken: "MESSAGE_TAKEN",
  wrong_number: "WRONG_NUMBER",
  do_not_call: "DO_NOT_CALL",
  other: "OTHER",
};

export function outcomeOf(ev: NormalizedEvent): VoiceCallOutcome | null {
  if (ev.voicemail) return "VOICEMAIL";
  if (ev.noAnswer) return "NO_ANSWER";
  const a = obj(ev.analysis);
  if (a.do_not_call === true) return "DO_NOT_CALL";
  return OUTCOME_MAP[str(a.outcome)?.toLowerCase() ?? ""] ?? null;
}

export function sentimentOf(ev: NormalizedEvent): VoiceSentiment | null {
  const s = (str(obj(ev.analysis).sentiment) ?? ev.providerSentiment ?? "").toLowerCase();
  return s === "positive" ? "POSITIVE" : s === "negative" ? "NEGATIVE" : s === "neutral" ? "NEUTRAL" : s ? "UNKNOWN" : null;
}

export async function receiveVoiceWebhook(providerSlug: string, key: string, raw: string, headers: Headers): Promise<WebhookResult> {
  const provider: VoiceProvider | null = providerSlug === "vapi" ? "VAPI" : providerSlug === "retell" ? "RETELL" : null;
  if (!provider || !/^[A-Za-z0-9_-]{16,64}$/.test(key)) return { status: 404, body: { error: { code: "not_found" } } };
  const rl = await consume(LIMIT, key);
  if (!rl.allowed) return { status: 429, body: { error: { code: "rate_limited" } } };
  const settings = await db().voiceSettings.findUnique({ where: { webhookKey: key } });
  if (!settings) return { status: 404, body: { error: { code: "not_found" } } };
  const { organizationId, companyId } = settings;

  if (provider === "VAPI") {
    const secret = readVapiSecret(companyId, settings.vapiSecretEnc);
    if (!secret || !verifyVapiSecret(headers.get("x-vapi-secret"), secret)) return { status: 401, body: { error: { code: "unauthenticated", message: "signature verification failed" } } };
  } else {
    const conn = await getConnection(organizationId, companyId, "retell");
    if (!conn?.accessToken || !verifyRetellSignature(raw, headers.get("x-retell-signature"), conn.accessToken)) return { status: 401, body: { error: { code: "unauthenticated", message: "signature verification failed" } } };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { status: 400, body: { error: { code: "validation_error", message: "invalid JSON" } } };
  }
  const ev = provider === "VAPI" ? parseVapi(body) : parseRetell(body);
  if (!ev) return { status: 200, body: { ok: true, ignored: true } };
  const callId = await applyEvent(organizationId, companyId, provider, ev, settings.recordCalls);
  if (callId && ev.phase === "analyzed") {
    const queued = await dispatchJob(MODULE_JOBS_QUEUE, "comms.voice-process-call", { callId }, { jobId: `voice-process_${callId}`, organizationId });
    if (!queued) await processCall(callId).catch((err) => logger.warn({ callId, err: err instanceof Error ? err.message : err }, "voice post-call processing failed"));
  }
  return { status: 200, body: { ok: true } };
}

/** Find or create the call for an event and record what the provider reported. */
async function applyEvent(organizationId: string, companyId: string, provider: VoiceProvider, ev: NormalizedEvent, recordCalls: boolean): Promise<string | null> {
  let call = await db().voiceCall.findFirst({ where: { provider, externalCallId: ev.externalCallId, companyId } });
  if (!call && ev.realyCallId && /^[0-9a-f-]{36}$/i.test(ev.realyCallId)) {
    call = await db().voiceCall.findFirst({ where: { id: ev.realyCallId, companyId, organizationId, externalCallId: null } });
    if (call) call = await db().voiceCall.update({ where: { id: call.id }, data: { externalCallId: ev.externalCallId } });
  }
  if (!call) {
    if (ev.direction !== "INBOUND") return null; // a call placed outside Realy
    call = await createInbound(organizationId, companyId, provider, ev);
    if (!call) return null;
  }
  const final = ev.phase !== "status";
  const terminal = call.status === "ENDED" || call.status === "FAILED";
  const RANK: Record<string, number> = { QUEUED: 1, RINGING: 2, IN_PROGRESS: 3, ENDED: 4 };
  const status = final
    ? ev.failed && !ev.durationSec
      ? "FAILED"
      : "ENDED"
    : terminal || !ev.status || (RANK[ev.status] ?? 0) < (RANK[call.status] ?? 0)
      ? call.status
      : ev.status;
  const outcome = final ? (outcomeOf(ev) ?? call.outcome) : call.outcome;
  const sentiment = final ? (sentimentOf(ev) ?? call.sentiment) : call.sentiment;
  await db().voiceCall.update({
    where: { id: call.id },
    data: {
      status,
      ...(ev.startedAt && !call.startedAt ? { startedAt: ev.startedAt } : {}),
      ...(!call.startedAt && !ev.startedAt && ev.status === "IN_PROGRESS" ? { startedAt: new Date() } : {}),
      ...(ev.endedAt ? { endedAt: ev.endedAt } : final && !call.endedAt ? { endedAt: new Date() } : {}),
      ...(ev.durationSec !== null ? { durationSec: ev.durationSec } : {}),
      ...(ev.endedReason ? { endedReason: ev.endedReason.slice(0, 120) } : {}),
      ...(ev.transcript?.length ? { transcript: ev.transcript as unknown as Prisma.InputJsonValue } : {}),
      ...(ev.summary ? { summary: ev.summary.slice(0, 5000) } : {}),
      ...(ev.analysis && Object.keys(ev.analysis).length ? { analysis: ev.analysis as Prisma.InputJsonValue } : {}),
      ...(outcome ? { outcome } : {}),
      ...(sentiment ? { sentiment } : {}),
      // Recordings stay on the provider; Realy links them only when recording is enabled for the company.
      ...(ev.recordingUrl && recordCalls ? { recordingUrl: ev.recordingUrl } : {}),
      ...(ev.costCents !== null ? { costMinor: BigInt(ev.costCents), costCurrency: "USD" } : {}),
      ...(final && ev.failed && !ev.durationSec ? { error: `Call failed: ${ev.endedReason ?? "unknown reason"}` } : {}),
    },
  });
  // Plan voice minutes at call end (idempotent per call; inbound calls count too).
  const seconds = ev.durationSec ?? call.durationSec ?? 0;
  if (final && seconds > 0) await recordUsage(organizationId, "voice.minutes", Math.ceil(seconds / 60), { companyId, idempotencyKey: call.id });
  return call.id;
}

/** An inbound call to one of the company's numbers: match the number, its agent and the caller in the CRM. */
async function createInbound(organizationId: string, companyId: string, provider: VoiceProvider, ev: NormalizedEvent) {
  const number = await db().voicePhoneNumber.findFirst({
    where: { organizationId, companyId, provider, OR: [...(ev.numberExternalId ? [{ externalId: ev.numberExternalId }] : []), ...(ev.companyNumber ? [{ number: ev.companyNumber }] : [])] },
  });
  if (!number) return null;
  const agent = ev.agentExternalId ? await db().voiceAgent.findFirst({ where: { organizationId, companyId, provider, externalAgentId: ev.agentExternalId }, select: { id: true } }) : null;
  let leadId: string | null = null;
  let contactId: string | null = null;
  let subjectName: string | null = null;
  if (ev.customerNumber) {
    const digits = last10(ev.customerNumber);
    const contact = await db().contact.findFirst({ where: { organizationId, companyId, archivedAt: null, phoneNormalized: digits }, select: { id: true, firstName: true, lastName: true } });
    if (contact) {
      contactId = contact.id;
      subjectName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
    } else {
      const lead = await db().lead.findFirst({ where: { organizationId, companyId, archivedAt: null, phoneNormalized: digits }, select: { id: true, name: true } });
      if (lead) {
        leadId = lead.id;
        subjectName = lead.name;
      }
    }
  }
  try {
    return await db().voiceCall.create({
      data: {
        organizationId,
        companyId,
        direction: "INBOUND",
        status: ev.status && ev.status !== "ENDED" ? ev.status : "IN_PROGRESS",
        provider,
        externalCallId: ev.externalCallId,
        agentId: agent?.id ?? number.inboundAgentId,
        numberId: number.id,
        toNumber: number.number,
        fromNumber: ev.customerNumber,
        leadId,
        contactId,
        subjectName,
        startedAt: ev.startedAt ?? new Date(),
      },
    });
  } catch (err) {
    // Two events of the same new call raced: the other one created it.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return db().voiceCall.findFirst({ where: { provider, externalCallId: ev.externalCallId, companyId } });
    throw err;
  }
}
