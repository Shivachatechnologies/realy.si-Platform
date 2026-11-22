import "server-only";
import { db } from "@/server/core/db";
import { isDoNotCall } from "@/server/modules/voice/service";
import { providerFetch } from "../client";
import type { Connection } from "../connections";
import { ProviderError } from "../providers";
import { providerWebhookUrl } from "../provider-webhooks";
import { recordUsage } from "../usage";
import { ensureOk, errorText, str, usableConnection, type ServiceResult } from "./common";

/**
 * Telephony adapters: Twilio Voice (numbers, outbound calls with status + recording callbacks, call lookup, recordings,
 * hang-up) and the SIP-trunk configuration entry. The Twilio Voice connection is used when connected, otherwise the
 * Twilio (SMS) connection's credentials. Callers own consent and autonomy (calls are external actions: SUPERVISED);
 * this adapter still refuses numbers on the company's do-not-call list.
 */

const TWILIO = "https://api.twilio.com/2010-04-01";
type Conn = Connection & { accessToken: string };

export async function twilioVoiceConnection(organizationId: string, companyId: string): Promise<Conn | null> {
  // Telephony runs only on the platform's Twilio Voice account (platform-managed), never the company's messaging account.
  return usableConnection(organizationId, companyId, "twilio_voice");
}

function accountBase(conn: Conn) {
  const sid = str(conn.config.accountSid);
  if (!sid || !/^AC[a-f0-9]{32}$/.test(sid)) throw new ProviderError("Twilio account SID missing", 401);
  return `${TWILIO}/Accounts/${sid}`;
}

const notConnected = <T>(): ServiceResult<T> => ({ ok: false, code: "not_connected", error: "Telephony is not available on the platform yet", providerId: null, attempts: [{ providerId: "twilio_voice", outcome: "not_connected" }] });
const fail = <T>(conn: Conn, err: unknown): ServiceResult<T> => ({ ok: false, code: err instanceof ProviderError && err.status === 429 ? "rate_limited" : "provider_error", error: errorText(err), providerId: conn.provider, attempts: [{ providerId: conn.provider, outcome: "error", error: errorText(err) }] });
const okRes = <T>(conn: Conn, data: T): ServiceResult<T> => ({ ok: true, data, providerId: conn.provider, attempts: [{ providerId: conn.provider, outcome: "ok" }] });

export interface VoiceNumber {
  sid: string;
  number: string;
  label: string | null;
  voiceUrl: string | null;
}

export async function listTwilioVoiceNumbers(organizationId: string, companyId: string): Promise<ServiceResult<VoiceNumber[]>> {
  const conn = await twilioVoiceConnection(organizationId, companyId);
  if (!conn) return notConnected();
  try {
    const res = await providerFetch<{ incoming_phone_numbers?: { sid: string; phone_number: string; friendly_name?: string; voice_url?: string; capabilities?: { voice?: boolean } }[] }>(conn, `${accountBase(conn)}/IncomingPhoneNumbers.json?PageSize=100`, { retries: 2 });
    ensureOk(res, "Twilio numbers");
    return okRes(
      conn,
      (res.data?.incoming_phone_numbers ?? []).filter((n) => n.capabilities?.voice !== false).map((n) => ({ sid: n.sid, number: n.phone_number, label: n.friendly_name ?? null, voiceUrl: n.voice_url ?? null })),
    );
  } catch (err) {
    return fail(conn, err);
  }
}

export interface PlaceTwilioCallInput {
  to: string;
  /** Caller id (one of the account's numbers); defaults to the connection's from number / active number. */
  from?: string;
  /** TwiML for the call (must include the AI disclosure when an AI speaks), or a URL returning TwiML. */
  twiml?: string;
  url?: string;
  record?: boolean;
  /** Seconds before an unanswered call is abandoned (default 30). */
  timeoutSeconds?: number;
}

export interface TwilioCall {
  callSid: string;
  status: string;
  to: string;
  from: string;
  durationSeconds: number | null;
}

const E164 = /^\+[1-9]\d{6,14}$/;

/** Place an outbound call. Status and recording callbacks go to the connection's verified provider-webhook URL. */
export async function placeTwilioCall(organizationId: string, companyId: string, input: PlaceTwilioCallInput): Promise<ServiceResult<TwilioCall>> {
  if (!E164.test(input.to)) return { ok: false, code: "invalid_input", error: "Number must be in E.164 format (+15551234567)", providerId: null, attempts: [] };
  if (!input.twiml && !input.url) return { ok: false, code: "invalid_input", error: "Provide TwiML or a TwiML URL", providerId: null, attempts: [] };
  if (input.url && !/^https:\/\//.test(input.url)) return { ok: false, code: "invalid_input", error: "TwiML URL must be HTTPS", providerId: null, attempts: [] };
  if (input.twiml && input.twiml.length > 4000) return { ok: false, code: "invalid_input", error: "TwiML is too long (max 4000 characters)", providerId: null, attempts: [] };
  if (await isDoNotCall(db(), companyId, input.to)) return { ok: false, code: "invalid_input", error: "This number is on the do-not-call list", providerId: null, attempts: [] };
  const conn = await twilioVoiceConnection(organizationId, companyId);
  if (!conn) return notConnected();
  // Platform account: a caller number is accepted only when it is one of this company's numbers; otherwise the
  // platform's default caller id is used.
  const own = await db().voicePhoneNumber.findMany({ where: { organizationId, companyId, source: "TWILIO", releasedAt: null }, select: { number: true } });
  const from = (input.from && E164.test(input.from) && own.some((n) => n.number === input.from) ? input.from : null) ?? str(conn.config.fromNumber);
  if (!from) return { ok: false, code: "invalid_input", error: "No caller number: get a number in the call center first", providerId: conn.provider, attempts: [] };
  // Platform connections have no connection row for provider webhooks; call status is tracked by the call center.
  const callback = conn.platform ? null : providerWebhookUrl(conn.provider, conn.id);
  const form: Record<string, string> = {
    To: input.to,
    From: from,
    ...(callback ? { StatusCallback: callback, StatusCallbackMethod: "POST" } : {}),
    Timeout: String(Math.min(Math.max(5, input.timeoutSeconds ?? 30), 120)),
    ...(input.twiml ? { Twiml: input.twiml } : { Url: input.url! }),
  };
  const body = new URLSearchParams(form);
  if (callback) for (const e of ["initiated", "ringing", "answered", "completed"]) body.append("StatusCallbackEvent", e);
  if (input.record) {
    body.set("Record", "true");
    if (callback) {
      body.set("RecordingStatusCallback", callback);
      body.set("RecordingStatusCallbackMethod", "POST");
    }
  }
  try {
    const res = await providerFetch<{ sid?: string; status?: string; to?: string; from?: string }>(conn, `${accountBase(conn)}/Calls.json`, {
      raw: body.toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
      // Never retry a call creation: a retry after a timeout could dial the customer twice.
      retries: 0,
      timeoutMs: 20_000,
    });
    ensureOk(res, "Twilio call");
    if (!res.data?.sid) throw new ProviderError("Twilio returned no call SID");
    await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: conn.provider, operation: "voice.call_started", units: 1, estimatedCostMicros: null, status: "SUCCEEDED", meta: { callSid: res.data.sid } });
    return okRes(conn, { callSid: res.data.sid, status: res.data.status ?? "queued", to: res.data.to ?? input.to, from: res.data.from ?? from, durationSeconds: null });
  } catch (err) {
    await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: conn.provider, operation: "voice.call_started", units: 0, estimatedCostMicros: 0, status: "FAILED", error: errorText(err) });
    return fail(conn, err);
  }
}

export async function getTwilioCall(organizationId: string, companyId: string, callSid: string): Promise<ServiceResult<TwilioCall>> {
  if (!/^CA[a-f0-9]{32}$/.test(callSid)) return { ok: false, code: "invalid_input", error: "Invalid call SID", providerId: null, attempts: [] };
  const conn = await twilioVoiceConnection(organizationId, companyId);
  if (!conn) return notConnected();
  try {
    const res = await providerFetch<{ sid: string; status?: string; to?: string; from?: string; duration?: string | null }>(conn, `${accountBase(conn)}/Calls/${callSid}.json`, { retries: 2 });
    ensureOk(res, "Twilio call lookup");
    const d = res.data;
    return okRes(conn, { callSid: d.sid, status: d.status ?? "unknown", to: d.to ?? "", from: d.from ?? "", durationSeconds: d.duration ? Number(d.duration) || 0 : null });
  } catch (err) {
    return fail(conn, err);
  }
}

/** End a call in progress (Twilio Status=completed). */
export async function hangUpTwilioCall(organizationId: string, companyId: string, callSid: string): Promise<ServiceResult<{ status: string }>> {
  if (!/^CA[a-f0-9]{32}$/.test(callSid)) return { ok: false, code: "invalid_input", error: "Invalid call SID", providerId: null, attempts: [] };
  const conn = await twilioVoiceConnection(organizationId, companyId);
  if (!conn) return notConnected();
  try {
    const res = await providerFetch<{ status?: string }>(conn, `${accountBase(conn)}/Calls/${callSid}.json`, { form: { Status: "completed" }, retries: 1 });
    ensureOk(res, "Twilio hang up");
    return okRes(conn, { status: res.data?.status ?? "completed" });
  } catch (err) {
    return fail(conn, err);
  }
}

export interface TwilioRecording {
  sid: string;
  callSid: string | null;
  durationSeconds: number;
  createdAt: string | null;
}

export async function listTwilioRecordings(organizationId: string, companyId: string, opts: { callSid?: string } = {}): Promise<ServiceResult<TwilioRecording[]>> {
  const conn = await twilioVoiceConnection(organizationId, companyId);
  if (!conn) return notConnected();
  try {
    const qs = new URLSearchParams({ PageSize: "50", ...(opts.callSid && /^CA[a-f0-9]{32}$/.test(opts.callSid) ? { CallSid: opts.callSid } : {}) });
    const res = await providerFetch<{ recordings?: { sid: string; call_sid?: string; duration?: string; date_created?: string }[] }>(conn, `${accountBase(conn)}/Recordings.json?${qs}`, { retries: 2 });
    ensureOk(res, "Twilio recordings");
    return okRes(conn, (res.data?.recordings ?? []).map((r) => ({ sid: r.sid, callSid: r.call_sid ?? null, durationSeconds: Number(r.duration ?? 0) || 0, createdAt: r.date_created ?? null })));
  } catch (err) {
    return fail(conn, err);
  }
}

/** Download a recording's audio (MP3) with the account credentials (recordings are private by default). */
export async function fetchTwilioRecordingAudio(organizationId: string, companyId: string, recordingSid: string): Promise<ServiceResult<{ audio: Uint8Array; contentType: string }>> {
  if (!/^RE[a-f0-9]{32}$/.test(recordingSid)) return { ok: false, code: "invalid_input", error: "Invalid recording SID", providerId: null, attempts: [] };
  const conn = await twilioVoiceConnection(organizationId, companyId);
  if (!conn) return notConnected();
  try {
    const res = await providerFetch(conn, `${accountBase(conn)}/Recordings/${recordingSid}.mp3`, { binary: true, headers: { accept: "audio/mpeg" }, retries: 2, timeoutMs: 60_000 });
    ensureOk(res, "Twilio recording download");
    if (!res.bytes) throw new ProviderError("Twilio returned no audio");
    return okRes(conn, { audio: res.bytes, contentType: "audio/mpeg" });
  } catch (err) {
    return fail(conn, err);
  }
}

export interface SipTrunkTarget {
  uri: string;
  host: string;
  username: string;
  password: string;
  transport: "udp" | "tcp" | "tls";
  callerId: string | null;
}

/** The company's SIP trunk (server-side only: includes the password) for a voice platform that dials over SIP. */
export async function sipTrunkTarget(organizationId: string, companyId: string): Promise<SipTrunkTarget | null> {
  const conn = await usableConnection(organizationId, companyId, "sip_trunk");
  const host = conn ? str(conn.config.sipDomain) : null;
  const username = conn ? str(conn.config.username) : null;
  if (!conn || !host || !username) return null;
  const transport = conn.config.transport === "tcp" || conn.config.transport === "tls" ? conn.config.transport : "udp";
  return { uri: `sip:${username}@${host}${transport === "udp" ? "" : `;transport=${transport}`}`, host, username, password: conn.accessToken, transport, callerId: str(conn.config.callerId) };
}
