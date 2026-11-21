import "server-only";
import type { VoiceBridgeMode, VoiceProvider } from "@/generated/prisma/enums";
import { env } from "@/server/core/env";
import { AppError } from "@/server/core/errors";
import { decryptSecret, encryptSecret } from "@/server/core/crypto";
import type { Connection } from "@/server/modules/integrations/connections";
import { providerFetch } from "@/server/modules/integrations/client";
import { ProviderError } from "@/server/modules/integrations/providers";
import { num, obj, str, toE164 } from "./common";
import { placeCall as placeAiCall, safeVapiControlUrl, type PlaceCallInput } from "./providers";

export { safeVapiControlUrl };

/**
 * Telephony provider abstraction of the phone team. A call has two layers:
 *   - the AI voice provider (Vapi / Retell) that runs the conversation, and
 *   - the telephony leg that reaches the phone network: the AI provider's own numbers, or the company's Twilio account
 *     (Programmable Voice) bridged to the AI agent over SIP (Retell register-phone-call, any SIP URI such as a Vapi SIP
 *     number) or Twilio Media Streams to a websocket bridge the company operates.
 * Live controls go to whichever layer can perform them; anything a layer cannot do is reported as not supported —
 * never simulated. `CAPABILITIES` is the honest matrix the UI shows.
 *
 * When the integrations module ships a first-class Twilio Voice provider, `twilioLeg` is the only place to switch to it;
 * until then the company's existing "twilio" connection (account SID + auth token) is used through providerFetch.
 */

export const TELEPHONY_KEYS = ["vapi", "retell", "twilio"] as const;
export type TelephonyKey = (typeof TELEPHONY_KEYS)[number];
export const CAPABILITY_KEYS = ["placeCall", "endCall", "transfer", "humanTakeover", "mute", "hold", "liveTranscript", "liveEvents", "recording", "cost"] as const;
export type Capability = (typeof CAPABILITY_KEYS)[number];
export type Support = "yes" | "partial" | "no";

/**
 * What each layer really supports (provider public APIs):
 *   Vapi   — POST /call; live control through the call's monitor.controlUrl (end-call, transfer, mute-assistant) once the
 *            agent is synced with controls enabled; transcript + status server messages; recording; cost per call.
 *   Retell — POST /v2/create-phone-call; no public API to end, transfer or mute a live call (only the agent's own
 *            tools); call_started/ended/analyzed events, transcript_updated when enabled on the agent; recording; cost.
 *   Twilio — Calls API; end (Status=completed) and transfer/takeover (redirect the live call with new TwiML); no mute or
 *            hold for a bridged <Dial> (needs a conference); status callbacks; real-time transcription; dual-channel
 *            recording; price after the call.
 */
export const CAPABILITIES: Record<TelephonyKey, Record<Capability, Support>> = {
  vapi: { placeCall: "yes", endCall: "yes", transfer: "yes", humanTakeover: "yes", mute: "yes", hold: "no", liveTranscript: "yes", liveEvents: "yes", recording: "yes", cost: "yes" },
  retell: { placeCall: "yes", endCall: "no", transfer: "no", humanTakeover: "no", mute: "no", hold: "no", liveTranscript: "partial", liveEvents: "yes", recording: "yes", cost: "yes" },
  twilio: { placeCall: "yes", endCall: "yes", transfer: "yes", humanTakeover: "yes", mute: "no", hold: "no", liveTranscript: "yes", liveEvents: "yes", recording: "yes", cost: "yes" },
};

export type ControlAction = "end" | "transfer" | "takeover" | "mute" | "unmute" | "hold" | "unhold";
const ACTION_CAPABILITY: Record<ControlAction, Capability> = { end: "endCall", transfer: "transfer", takeover: "humanTakeover", mute: "mute", unmute: "mute", hold: "hold", unhold: "hold" };

export interface LiveCallRef {
  provider: VoiceProvider | null;
  externalCallId: string | null;
  telephony: "PROVIDER" | "TWILIO" | null;
  telephonySid: string | null;
  controlUrl: string | null;
}

/** The layer that performs live controls for a call (Twilio leg first: it owns the phone connection). */
export function controlLayer(c: LiveCallRef): TelephonyKey | null {
  if (c.telephony === "TWILIO" && c.telephonySid) return "twilio";
  if (c.provider === "VAPI") return "vapi";
  if (c.provider === "RETELL") return "retell";
  return null;
}

/** Capabilities of a specific call (Vapi controls also need the control URL, i.e. an agent synced with controls). */
export function callCapabilities(c: LiveCallRef): Record<Capability, Support> & { layer: TelephonyKey | null } {
  const layer = controlLayer(c);
  if (!layer) return { layer, ...Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, "no"])) } as Record<Capability, Support> & { layer: null };
  const base = { ...CAPABILITIES[layer] };
  if (layer === "vapi" && !c.controlUrl) for (const k of ["endCall", "transfer", "humanTakeover", "mute"] as const) base[k] = "no";
  return { layer, ...base };
}

export function supports(c: LiveCallRef, action: ControlAction): boolean {
  return callCapabilities(c)[ACTION_CAPABILITY[action]] === "yes";
}

export const notSupported = (layer: TelephonyKey | null, action: ControlAction) =>
  new AppError("not_available", `${layer ? LAYER_LABEL[layer] : "This call's provider"} does not support "${action}" on a live call`, { reason: "voice_control_not_supported" });

export const LAYER_LABEL: Record<TelephonyKey, string> = { vapi: "Vapi", retell: "Retell AI", twilio: "Twilio" };

// ───────────── Secrets bound to the company ─────────────

const controlPurpose = (companyId: string) => `voice.control-url:${companyId}`;
const sipPurpose = (companyId: string) => `voice.sip-password:${companyId}`;
export const sealControlUrl = (companyId: string, url: string) => encryptSecret(url, controlPurpose(companyId));
export const sealSipPassword = (companyId: string, pw: string) => encryptSecret(pw, sipPurpose(companyId));
function open(enc: string | null, purpose: string): string | null {
  if (!enc) return null;
  try {
    return decryptSecret(enc, purpose);
  } catch {
    return null;
  }
}
export const openControlUrl = (companyId: string, enc: string | null) => open(enc, controlPurpose(companyId));
export const openSipPassword = (companyId: string, enc: string | null) => open(enc, sipPurpose(companyId));

// ───────────── Vapi live control ─────────────

async function vapiControl(controlUrl: string, body: Record<string, unknown>) {
  const res = await fetch(controlUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!res.ok) throw new ProviderError(`Vapi control: HTTP ${res.status}`, res.status);
}

// ───────────── Twilio leg ─────────────

const TWILIO = "https://api.twilio.com/2010-04-01";
const twilioAccount = (conn: Connection) => {
  const sid = str(conn.config.accountSid);
  if (!sid || !/^AC[a-f0-9]{32}$/.test(sid) || !conn.accessToken) throw new ProviderError("Twilio credentials missing", 401);
  return `${TWILIO}/Accounts/${sid}`;
};

async function twilioPost(conn: Connection, url: string, params: [string, string][]) {
  const res = await providerFetch(conn, url, { method: "POST", raw: new URLSearchParams(params).toString(), headers: { "content-type": "application/x-www-form-urlencoded" }, retries: 0, timeoutMs: 20_000 });
  if (!res.ok) throw new ProviderError(`Twilio: ${str(obj(res.data).message) ?? `HTTP ${res.status}`}`.slice(0, 240), res.status);
  return obj(res.data);
}

/** Public Twilio webhook URL of this company (each event its own path; signatures cover the exact URL). */
export function twilioHookUrl(webhookKey: string, event: "inbound" | "outbound" | "status" | "recording" | "transcription", query?: Record<string, string>) {
  const q = query && Object.keys(query).length ? `?${new URLSearchParams(query).toString()}` : "";
  return `${env().APP_URL.replace(/\/+$/, "")}/api/v1/webhooks/voice/twilio/${webhookKey}/${event}${q}`;
}

/** Twilio outbound call whose TwiML (fetched on answer) bridges to the AI agent. */
export async function twilioPlaceCall(conn: Connection, c: { to: string; from: string; webhookKey: string; callId: string; maxDurationSec: number }) {
  const r = await twilioPost(conn, `${twilioAccount(conn)}/Calls.json`, [
    ["To", c.to],
    ["From", c.from],
    ["Url", twilioHookUrl(c.webhookKey, "outbound", { call: c.callId })],
    ["Method", "POST"],
    ["StatusCallback", twilioHookUrl(c.webhookKey, "status", { call: c.callId })],
    ["StatusCallbackMethod", "POST"],
    ["StatusCallbackEvent", "initiated"],
    ["StatusCallbackEvent", "ringing"],
    ["StatusCallbackEvent", "answered"],
    ["StatusCallbackEvent", "completed"],
    ["Timeout", "30"],
    ["TimeLimit", String(Math.max(60, Math.min(14_400, c.maxDurationSec + 60)))],
  ]);
  const sid = str(r.sid);
  if (!sid) throw new ProviderError("Twilio returned no call SID");
  return { sid, status: str(r.status) };
}

export async function twilioEndCall(conn: Connection, sid: string) {
  await twilioPost(conn, `${twilioAccount(conn)}/Calls/${encodeURIComponent(sid)}.json`, [["Status", "completed"]]);
}

/** Redirect the live call: the AI bridge ends and the caller is connected to `number` (a person). */
export async function twilioTransfer(conn: Connection, sid: string, number: string, message: string | null, callerId: string | null) {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Say>${xml(message)}</Say>` : ""}<Dial${callerId ? ` callerId="${xml(callerId)}"` : ""}>${xml(number)}</Dial></Response>`;
  await twilioPost(conn, `${twilioAccount(conn)}/Calls/${encodeURIComponent(sid)}.json`, [["Twiml", twiml]]);
}

/** Final price of a Twilio call in USD cents (null while Twilio has not priced it yet). */
export async function twilioCallCost(conn: Connection, sid: string): Promise<{ cents: number; currency: string } | null> {
  const res = await providerFetch(conn, `${twilioAccount(conn)}/Calls/${encodeURIComponent(sid)}.json`, { timeoutMs: 15_000 });
  if (!res.ok) return null;
  const d = obj(res.data);
  const price = num(d.price);
  if (price === null) return null;
  return { cents: Math.round(Math.abs(price) * 100), currency: (str(d.price_unit) ?? "USD").toUpperCase().slice(0, 3) };
}

// ───────────── AI provider extras (registration for SIP bridging, cost) ─────────────

const RETELL = "https://api.retellai.com";
const VAPI = "https://api.vapi.ai";

/** Retell custom telephony: register the call, then dial sip:<call_id>@sip.retellai.com. */
export async function retellRegisterCall(conn: Connection, c: { agentExternalId: string; from: string; to: string; direction: "inbound" | "outbound"; metadata: Record<string, string>; variables: Record<string, string> }) {
  const res = await providerFetch(conn, `${RETELL}/v2/register-phone-call`, {
    method: "POST",
    retries: 0,
    timeoutMs: 15_000,
    json: { agent_id: c.agentExternalId, from_number: c.from, to_number: c.to, direction: c.direction, metadata: c.metadata, retell_llm_dynamic_variables: c.variables },
  });
  const id = str(obj(res.data).call_id);
  if (!res.ok || !id) throw new ProviderError(`Retell register-phone-call: ${str(obj(res.data).message) ?? `HTTP ${res.status}`}`.slice(0, 240), res.status);
  return { callId: id, sipUri: `sip:${id}@sip.retellai.com` };
}

/** Provider-reported cost of a finished call in USD cents (null when not reported yet). */
export async function aiCallCost(provider: VoiceProvider, conn: Connection, externalCallId: string): Promise<number | null> {
  if (provider === "VAPI") {
    const res = await providerFetch(conn, `${VAPI}/call/${encodeURIComponent(externalCallId)}`, { timeoutMs: 15_000 });
    const c = res.ok ? num(obj(res.data).cost) : null;
    return c !== null ? Math.round(c * 100) : null;
  }
  const res = await providerFetch(conn, `${RETELL}/v2/get-call/${encodeURIComponent(externalCallId)}`, { timeoutMs: 15_000 });
  const c = res.ok ? num(obj(obj(res.data).call_cost).combined_cost) : null;
  return c !== null ? Math.round(c) : null;
}

// ───────────── TwiML ─────────────

export const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

export interface BridgeSpec {
  mode: VoiceBridgeMode;
  /** PROVIDER_SIP: the registered SIP URI; CUSTOM_SIP: the configured URI. */
  sipUri: string | null;
  sipUsername: string | null;
  sipPassword: string | null;
  mediaStreamUrl: string | null;
  /** Spoken before bridging when the AI endpoint is not known to disclose itself (custom SIP / media streams). */
  disclosure: string | null;
  language: string;
  record: boolean;
  liveTranscription: boolean;
  webhookKey: string;
  callId: string;
  maxDurationSec: number;
}

/** TwiML that connects the live call to the AI agent, with real-time transcription and optional dual recording. */
export function bridgeTwiml(b: BridgeSpec): string {
  const lang = /^[a-z]{2}-[A-Z]{2}$/.test(b.language) ? b.language : "en-US";
  const parts: string[] = [];
  if (b.liveTranscription) {
    parts.push(
      `<Start><Transcription statusCallbackUrl="${xml(twilioHookUrl(b.webhookKey, "transcription", { call: b.callId }))}" statusCallbackMethod="POST" track="both_tracks" languageCode="${lang}" partialResults="false"/></Start>`,
    );
  }
  if (b.disclosure) parts.push(`<Say language="${lang}">${xml(b.disclosure)}</Say>`);
  if (b.mode === "MEDIA_STREAM") {
    if (!b.mediaStreamUrl) return unavailableTwiml(lang);
    parts.push(`<Connect><Stream url="${xml(b.mediaStreamUrl)}"><Parameter name="realyCallId" value="${xml(b.callId)}"/></Stream></Connect>`);
  } else {
    if (!b.sipUri) return unavailableTwiml(lang);
    const rec = b.record ? ` record="record-from-answer-dual" recordingStatusCallback="${xml(twilioHookUrl(b.webhookKey, "recording", { call: b.callId }))}" recordingStatusCallbackMethod="POST"` : "";
    const auth = b.sipUsername && b.sipPassword ? ` username="${xml(b.sipUsername)}" password="${xml(b.sipPassword)}"` : "";
    parts.push(`<Dial answerOnBridge="true" timeLimit="${Math.max(60, b.maxDurationSec)}"${rec}><Sip${auth}>${xml(b.sipUri)}</Sip></Dial>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${parts.join("")}</Response>`;
}

export function unavailableTwiml(language = "en-US", text = "Sorry, nobody can take your call right now. Please try again later."): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="${xml(language)}">${xml(text)}</Say><Hangup/></Response>`;
}

export const emptyTwiml = () => `<?xml version="1.0" encoding="UTF-8"?><Response/>`;

/** Valid generic SIP URI (sip: or sips:, user@host, optional ;params). */
export const isSipUri = (v: string) => /^sips?:[A-Za-z0-9._~%+\-]+@[A-Za-z0-9.\-]+(:\d{2,5})?(;[A-Za-z0-9=._\-]+)*$/.test(v);
export const isWss = (v: string) => /^wss:\/\/[A-Za-z0-9.\-]+(:\d{2,5})?(\/[^\s"<>]*)?$/.test(v);

// ───────────── Provider objects (the abstraction the dialer and the live center use) ─────────────

export interface ControlContext {
  ref: LiveCallRef;
  /** Connection of the layer (Twilio, Vapi or Retell). */
  conn: Connection | null;
  callerId: string | null;
}

export interface TelephonyProvider {
  key: TelephonyKey;
  capabilities: Record<Capability, Support>;
  placeCall(conn: Connection, input: PlaceCallInput & { provider: VoiceProvider }): Promise<{ externalCallId: string; status: string | null; controlUrl: string | null }>;
  endCall(c: ControlContext): Promise<void>;
  transfer(c: ControlContext, number: string, message: string | null): Promise<void>;
  mute(c: ControlContext, on: boolean): Promise<void>;
  hold(c: ControlContext, on: boolean): Promise<void>;
  cost(conn: Connection, externalId: string): Promise<number | null>;
}

const unsupported = (key: TelephonyKey, action: ControlAction) => async () => {
  throw notSupported(key, action);
};

const vapiControlUrl = (c: ControlContext) => {
  if (!c.ref.controlUrl) throw notSupported("vapi", "end");
  return c.ref.controlUrl;
};

export const TELEPHONY: Record<TelephonyKey, TelephonyProvider> = {
  vapi: {
    key: "vapi",
    capabilities: CAPABILITIES.vapi,
    placeCall: (conn, i) => placeAiCall("VAPI", conn, i),
    endCall: (c) => vapiControl(vapiControlUrl(c), { type: "end-call" }),
    transfer: (c, number, message) => vapiControl(vapiControlUrl(c), { type: "transfer", destination: { type: "number", number }, ...(message ? { content: message } : {}) }),
    mute: (c, on) => vapiControl(vapiControlUrl(c), { type: "control", control: on ? "mute-assistant" : "unmute-assistant" }),
    hold: unsupported("vapi", "hold"),
    cost: (conn, id) => aiCallCost("VAPI", conn, id),
  },
  retell: {
    key: "retell",
    capabilities: CAPABILITIES.retell,
    placeCall: (conn, i) => placeAiCall("RETELL", conn, i),
    endCall: unsupported("retell", "end"),
    transfer: unsupported("retell", "transfer"),
    mute: unsupported("retell", "mute"),
    hold: unsupported("retell", "hold"),
    cost: (conn, id) => aiCallCost("RETELL", conn, id),
  },
  twilio: {
    key: "twilio",
    capabilities: CAPABILITIES.twilio,
    // Twilio calls are placed by the dialer with twilioPlaceCall (the bridge needs the company's webhook key).
    placeCall: async () => {
      throw new AppError("not_available", "Twilio calls are placed through the dialer", { reason: "voice_control_not_supported" });
    },
    endCall: async (c) => {
      if (!c.conn || !c.ref.telephonySid) throw notSupported("twilio", "end");
      await twilioEndCall(c.conn, c.ref.telephonySid);
    },
    transfer: async (c, number, message) => {
      if (!c.conn || !c.ref.telephonySid) throw notSupported("twilio", "transfer");
      await twilioTransfer(c.conn, c.ref.telephonySid, number, message, c.callerId);
    },
    mute: unsupported("twilio", "mute"),
    hold: unsupported("twilio", "hold"),
    cost: async (conn, sid) => (await twilioCallCost(conn, sid))?.cents ?? null,
  },
};

/** Twilio caller id: the configured number, else the connection's fromNumber (when it is a phone number). */
export function twilioCallerId(conn: Connection | null, configured: string | null): string | null {
  return toE164(configured) ?? toE164(str(conn?.config.fromNumber));
}
