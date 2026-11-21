import "server-only";
import type { VoiceAgent, VoiceSettings } from "@/generated/prisma/client";
import { db, Prisma } from "@/server/core/db";
import { env } from "@/server/core/env";
import { dispatchJob, MODULE_JOBS_QUEUE } from "@/server/core/jobs";
import { logger } from "@/server/core/logger";
import { consume } from "@/server/core/rate-limit";
import { getConnection, type Connection } from "@/server/modules/integrations/connections";
import { verifyTwilioSignature } from "@/server/modules/integrations/services/whatsapp";
import { recordUsage } from "@/server/modules/entitlements/service";
import { isUuid, last10, toE164, type TranscriptLine } from "./common";
import { callingBlocked } from "./calls";
import { storeTranscriptLines } from "./live";
import { processCall } from "./outcomes";
import { bridgeTwiml, emptyTwiml, openSipPassword, retellRegisterCall, unavailableTwiml, type BridgeSpec } from "./telephony";

/**
 * Twilio Programmable Voice webhooks: POST /api/v1/webhooks/voice/twilio/{webhookKey}/{event}
 *   inbound        a call to the company's Twilio number → TwiML bridging it to the AI agent
 *   outbound       TwiML for a call Realy placed through Twilio (fetched when the callee answers)
 *   status         call progress (initiated / ringing / answered / completed, busy, no-answer, failed)
 *   recording      dual-channel recording ready (kept only when the company records calls)
 *   transcription  Twilio real-time transcription turns (live transcript)
 * Authentic only when X-Twilio-Signature verifies (HMAC-SHA1 of the exact URL + sorted form fields with the company's
 * auth token). Every call is recorded only from what Twilio reports.
 */

export const TWILIO_EVENTS = ["inbound", "outbound", "status", "recording", "transcription"] as const;
export type TwilioEvent = (typeof TWILIO_EVENTS)[number];
const LIMIT = { name: "voice-twilio-webhook", limit: 900, windowMs: 60_000 };

export interface TwilioHookResult {
  status: number;
  twiml: string;
}

const DISCLOSURE: Record<string, [string, string]> = {
  en: ["This call is answered by an AI assistant.", "This call is answered by an AI assistant and recorded."],
  de: ["Dieser Anruf wird von einem KI-Assistenten entgegengenommen.", "Dieser Anruf wird von einem KI-Assistenten entgegengenommen und aufgezeichnet."],
  hi: ["इस कॉल का उत्तर एक एआई सहायक दे रहा है।", "इस कॉल का उत्तर एक एआई सहायक दे रहा है और इसे रिकॉर्ड किया जा रहा है।"],
  zh: ["本通话由 AI 助手接听。", "本通话由 AI 助手接听并录音。"],
  ar: ["يتم الرد على هذه المكالمة بواسطة مساعد ذكاء اصطناعي.", "يتم الرد على هذه المكالمة بواسطة مساعد ذكاء اصطناعي ويتم تسجيلها."],
};
const disclosure = (language: string, recorded: boolean) => (DISCLOSURE[language.split("-")[0]!] ?? DISCLOSURE.en!)[recorded ? 1 : 0];

export async function handleTwilioVoiceHook(key: string, event: string, search: string, params: Record<string, string>, signature: string | null): Promise<TwilioHookResult> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(key) || !(TWILIO_EVENTS as readonly string[]).includes(event)) return { status: 404, twiml: emptyTwiml() };
  const rl = await consume(LIMIT, key);
  if (!rl.allowed) return { status: 429, twiml: emptyTwiml() };
  const settings = await db().voiceSettings.findUnique({ where: { webhookKey: key } });
  if (!settings) return { status: 404, twiml: emptyTwiml() };
  const conn = await getConnection(settings.organizationId, settings.companyId, "twilio");
  const url = `${env().APP_URL.replace(/\/+$/, "")}/api/v1/webhooks/voice/twilio/${key}/${event}${search}`;
  if (!conn?.accessToken || !verifyTwilioSignature(conn.accessToken, url, params, signature)) return { status: 403, twiml: emptyTwiml() };
  const callParam = new URLSearchParams(search.replace(/^\?/, "")).get("call");
  const ev = event as TwilioEvent;
  if (ev === "inbound") return inbound(settings, conn, params);
  if (ev === "outbound") return outbound(settings, conn, params, callParam);
  if (ev === "status") return status(settings, params, callParam);
  if (ev === "recording") return recording(settings, params, callParam);
  return transcription(settings, params, callParam);
}

async function findCall(companyId: string, sid: string | undefined, callParam: string | null) {
  if (callParam && isUuid(callParam)) {
    const c = await db().voiceCall.findFirst({ where: { id: callParam, companyId } });
    if (c && (!sid || !c.telephonySid || c.telephonySid === sid)) return c;
  }
  return sid ? db().voiceCall.findFirst({ where: { companyId, telephonySid: sid } }) : null;
}

/** Bridge spec for a call: Retell is registered for SIP; other modes use the configured SIP URI or media stream. */
async function bridgeFor(settings: VoiceSettings, agent: Pick<VoiceAgent, "provider" | "externalAgentId" | "language"> | null, call: { id: string; from: string; to: string; direction: "inbound" | "outbound"; variables: Record<string, string> }) {
  const base: Omit<BridgeSpec, "mode" | "sipUri" | "disclosure"> = {
    sipUsername: settings.sipUsername,
    sipPassword: openSipPassword(settings.companyId, settings.sipPasswordEnc),
    mediaStreamUrl: settings.mediaStreamUrl,
    language: agent?.language ?? "en-US",
    record: settings.recordCalls,
    liveTranscription: settings.liveTranscription,
    webhookKey: settings.webhookKey,
    callId: call.id,
    maxDurationSec: settings.maxDurationSec,
  };
  if (settings.bridgeMode === "PROVIDER_SIP" && agent?.provider === "RETELL" && agent.externalAgentId) {
    const retell = await getConnection(settings.organizationId, settings.companyId, "retell");
    if (!retell?.accessToken) return { spec: null, externalCallId: null, error: "credential_required" };
    const r = await retellRegisterCall(retell, { agentExternalId: agent.externalAgentId, from: call.from, to: call.to, direction: call.direction, metadata: { realyCallId: call.id, realyCompanyId: settings.companyId }, variables: call.variables });
    return { spec: { ...base, mode: "PROVIDER_SIP" as const, sipUri: r.sipUri, disclosure: null }, externalCallId: r.callId, error: null };
  }
  const mode = settings.bridgeMode === "MEDIA_STREAM" ? "MEDIA_STREAM" : "CUSTOM_SIP";
  const ready = mode === "MEDIA_STREAM" ? !!settings.mediaStreamUrl : !!settings.bridgeSipUri;
  if (!ready) return { spec: null, externalCallId: null, error: "bridge_not_configured" };
  return { spec: { ...base, mode, sipUri: settings.bridgeSipUri, disclosure: disclosure(base.language, settings.recordCalls) } as BridgeSpec, externalCallId: null, error: null };
}

async function matchCaller(organizationId: string, companyId: string, phone: string | null) {
  if (!phone) return { leadId: null, contactId: null, subjectName: null };
  const digits = last10(phone);
  const contact = await db().contact.findFirst({ where: { organizationId, companyId, archivedAt: null, phoneNormalized: digits }, select: { id: true, firstName: true, lastName: true } });
  if (contact) return { leadId: null, contactId: contact.id, subjectName: [contact.firstName, contact.lastName].filter(Boolean).join(" ") };
  const lead = await db().lead.findFirst({ where: { organizationId, companyId, archivedAt: null, phoneNormalized: digits }, select: { id: true, name: true } });
  return lead ? { leadId: lead.id, contactId: null, subjectName: lead.name } : { leadId: null, contactId: null, subjectName: null };
}

async function inbound(settings: VoiceSettings, conn: Connection, p: Record<string, string>): Promise<TwilioHookResult> {
  const { organizationId, companyId } = settings;
  const sid = p.CallSid;
  const to = toE164(p.To);
  const from = toE164(p.From);
  if (!sid || !to) return { status: 400, twiml: unavailableTwiml() };
  void conn;
  const number = await db().voicePhoneNumber.findFirst({ where: { organizationId, companyId, number: to, releasedAt: null }, select: { id: true, inboundAgentId: true } });
  if (!number && toE164(settings.twilioFromNumber) !== to) return { status: 200, twiml: unavailableTwiml() };
  const agent =
    (number?.inboundAgentId ? await db().voiceAgent.findFirst({ where: { id: number.inboundAgentId, companyId, archivedAt: null } }) : null) ??
    (await db().voiceAgent.findFirst({ where: { organizationId, companyId, archivedAt: null, syncStatus: "SYNCED", goal: "RECEPTIONIST" }, orderBy: { createdAt: "asc" } }));
  const existing = await db().voiceCall.findFirst({ where: { companyId, telephonySid: sid } });
  const who = await matchCaller(organizationId, companyId, from);
  let call = existing;
  if (!call) {
    try {
      call = await db().voiceCall.create({
        data: { organizationId, companyId, direction: "INBOUND", status: "RINGING", provider: agent?.provider ?? null, externalCallId: sid, telephony: "TWILIO", telephonySid: sid, agentId: agent?.id ?? null, numberId: number?.id ?? null, toNumber: to, fromNumber: from, ...who, startedAt: new Date() },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") call = await db().voiceCall.findFirst({ where: { companyId, telephonySid: sid } });
      else throw err;
    }
  }
  if (!call) return { status: 200, twiml: unavailableTwiml() };
  const blocked = await callingBlocked(organizationId);
  if (blocked || !agent) {
    await db().voiceCall.update({ where: { id: call.id }, data: { status: "FAILED", error: blocked ? `AI calling is off: ${blocked.replace(/_/g, " ")}` : "No AI receptionist is assigned to this number" } });
    return { status: 200, twiml: unavailableTwiml(agent?.language ?? "en-US") };
  }
  try {
    const b = await bridgeFor(settings, agent, { id: call.id, from: from ?? "", to, direction: "inbound", variables: { customer_name: who.subjectName ?? "unknown", call_purpose: "inbound call", company_name: "" } });
    if (!b.spec) {
      await db().voiceCall.update({ where: { id: call.id }, data: { status: "FAILED", error: `Twilio bridge not ready: ${b.error}` } });
      return { status: 200, twiml: unavailableTwiml(agent.language) };
    }
    if (b.externalCallId) await db().voiceCall.update({ where: { id: call.id }, data: { externalCallId: b.externalCallId, provider: "RETELL" } });
    return { status: 200, twiml: bridgeTwiml(b.spec) };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 240) : "bridge failed";
    await db().voiceCall.update({ where: { id: call.id }, data: { status: "FAILED", error: message } });
    logger.warn({ callId: call.id, err: message }, "voice twilio inbound bridge failed");
    return { status: 200, twiml: unavailableTwiml(agent.language) };
  }
}

async function outbound(settings: VoiceSettings, conn: Connection, p: Record<string, string>, callParam: string | null): Promise<TwilioHookResult> {
  void conn;
  const call = await findCall(settings.companyId, p.CallSid, callParam);
  if (!call || call.direction !== "OUTBOUND") return { status: 200, twiml: unavailableTwiml() };
  const agent = call.agentId ? await db().voiceAgent.findFirst({ where: { id: call.agentId, companyId: settings.companyId } }) : null;
  const company = await db().company.findFirst({ where: { id: settings.companyId }, select: { name: true } });
  try {
    const b = await bridgeFor(settings, agent, {
      id: call.id,
      from: call.fromNumber ?? "",
      to: call.toNumber,
      direction: "outbound",
      variables: { customer_name: call.subjectName ?? "unknown", call_purpose: (call.purpose ?? "").slice(0, 1000), company_name: company?.name ?? "" },
    });
    if (!b.spec) {
      await db().voiceCall.update({ where: { id: call.id }, data: { error: `Twilio bridge not ready: ${b.error}` } });
      return { status: 200, twiml: unavailableTwiml(agent?.language ?? "en-US", "Sorry, we cannot connect this call right now. Goodbye.") };
    }
    await db().voiceCall.update({ where: { id: call.id }, data: { status: "IN_PROGRESS", startedAt: call.startedAt ?? new Date(), ...(b.externalCallId ? { externalCallId: b.externalCallId, provider: "RETELL" } : {}) } });
    return { status: 200, twiml: bridgeTwiml(b.spec) };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 240) : "bridge failed";
    await db().voiceCall.update({ where: { id: call.id }, data: { error: message } });
    return { status: 200, twiml: unavailableTwiml(agent?.language ?? "en-US", "Sorry, we cannot connect this call right now. Goodbye.") };
  }
}

const STATUS: Record<string, "QUEUED" | "RINGING" | "IN_PROGRESS" | "ENDED" | "FAILED"> = {
  queued: "QUEUED",
  initiated: "QUEUED",
  ringing: "RINGING",
  "in-progress": "IN_PROGRESS",
  answered: "IN_PROGRESS",
  completed: "ENDED",
  busy: "ENDED",
  "no-answer": "ENDED",
  failed: "FAILED",
  canceled: "FAILED",
};
const RANK: Record<string, number> = { SCHEDULED: 0, QUEUED: 1, RINGING: 2, IN_PROGRESS: 3, ENDED: 4, FAILED: 4 };

async function status(settings: VoiceSettings, p: Record<string, string>, callParam: string | null): Promise<TwilioHookResult> {
  const call = await findCall(settings.companyId, p.CallSid, callParam);
  if (!call) return { status: 200, twiml: emptyTwiml() };
  const raw = (p.CallStatus ?? "").toLowerCase();
  const next = STATUS[raw];
  if (!next) return { status: 200, twiml: emptyTwiml() };
  const terminal = next === "ENDED" || next === "FAILED";
  if (!terminal && (RANK[call.status] ?? 0) >= (RANK[next] ?? 0)) return { status: 200, twiml: emptyTwiml() };
  if (call.status === "ENDED" || call.status === "FAILED") {
    // Already finished (e.g. by the AI provider's events): only fill in what is missing.
    const d = Number(p.CallDuration);
    if (call.durationSec === null && Number.isFinite(d)) await db().voiceCall.update({ where: { id: call.id }, data: { durationSec: Math.round(d) } });
    return { status: 200, twiml: emptyTwiml() };
  }
  const duration = Number(p.CallDuration);
  const noAnswer = raw === "busy" || raw === "no-answer";
  const twilioOnly = call.externalCallId === call.telephonySid;
  const data: Prisma.VoiceCallUpdateInput = { status: next, ...(!call.telephonySid && p.CallSid ? { telephonySid: p.CallSid } : {}) };
  if (next === "IN_PROGRESS" && !call.startedAt) data.startedAt = new Date();
  if (terminal) {
    data.endedAt = new Date();
    data.controlUrlEnc = null;
    if (Number.isFinite(duration)) data.durationSec = Math.round(duration);
    data.endedReason = `twilio:${raw}`;
    if (noAnswer) data.outcome = "NO_ANSWER";
    if (next === "FAILED") data.error = `Twilio reported the call ${raw}`;
    if (twilioOnly) {
      const lines = await db().voiceTranscriptLine.findMany({ where: { callId: call.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1000, select: { role: true, text: true, atSec: true } });
      const transcript: TranscriptLine[] = lines.map((l) => ({ role: l.role === "caller" ? "caller" : "agent", text: l.text, ...(l.atSec !== null ? { at: l.atSec } : {}) }));
      if (transcript.length && (!Array.isArray(call.transcript) || !call.transcript.length)) data.transcript = transcript as unknown as Prisma.InputJsonValue;
    }
  }
  await db().voiceCall.update({ where: { id: call.id }, data });
  if (terminal) {
    const seconds = Number.isFinite(duration) ? Math.round(duration) : 0;
    if (seconds > 0) await recordUsage(settings.organizationId, "voice.minutes", Math.ceil(seconds / 60), { companyId: settings.companyId, idempotencyKey: call.id });
    // Calls without an AI provider report (custom SIP, media streams, unanswered) are processed from Twilio's data.
    if (twilioOnly) {
      const queued = await dispatchJob(MODULE_JOBS_QUEUE, "comms.voice-process-call", { callId: call.id }, { jobId: `voice-process_${call.id}`, organizationId: settings.organizationId });
      if (!queued) await processCall(call.id).catch((err) => logger.warn({ callId: call.id, err: err instanceof Error ? err.message : err }, "voice post-call processing failed"));
    }
  }
  return { status: 200, twiml: emptyTwiml() };
}

async function recording(settings: VoiceSettings, p: Record<string, string>, callParam: string | null): Promise<TwilioHookResult> {
  if (!settings.recordCalls || (p.RecordingStatus && p.RecordingStatus !== "completed")) return { status: 200, twiml: emptyTwiml() };
  const call = await findCall(settings.companyId, p.CallSid, callParam);
  const url = p.RecordingUrl;
  if (call && url && /^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/AC[a-f0-9]{32}\/Recordings\/RE[a-f0-9]{32}$/.test(url) && !call.recordingUrl) {
    await db().voiceCall.update({ where: { id: call.id }, data: { recordingUrl: `${url}.mp3` } });
  }
  return { status: 200, twiml: emptyTwiml() };
}

async function transcription(settings: VoiceSettings, p: Record<string, string>, callParam: string | null): Promise<TwilioHookResult> {
  if (p.TranscriptionEvent !== "transcription-content" || (p.Final && p.Final !== "true")) return { status: 200, twiml: emptyTwiml() };
  const call = await findCall(settings.companyId, p.CallSid, callParam);
  if (!call) return { status: 200, twiml: emptyTwiml() };
  let text = "";
  try {
    const d = JSON.parse(p.TranscriptionData ?? "{}") as { transcript?: unknown };
    text = typeof d.transcript === "string" ? d.transcript.trim() : "";
  } catch {
    text = "";
  }
  if (!text) return { status: 200, twiml: emptyTwiml() };
  const caller = p.Track === "inbound_track";
  const role = caller ? "caller" : call.takenOverAt ? "human" : "agent";
  const atSec = call.startedAt ? Math.max(0, Math.round((Date.now() - call.startedAt.getTime()) / 1000)) : null;
  await storeTranscriptLines(settings.organizationId, settings.companyId, call.id, "twilio", [{ role, text, atSec, key: `t:${p.SequenceId ?? `${p.Track}:${Date.now()}`}` }]);
  return { status: 200, twiml: emptyTwiml() };
}
