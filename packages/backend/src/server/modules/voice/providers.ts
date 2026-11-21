import "server-only";
import type { VoiceProvider } from "@/generated/prisma/enums";
import { env } from "@/server/core/env";
import { hmacSha256, safeEqual } from "@/server/core/crypto";
import type { Connection } from "@/server/modules/integrations/connections";
import { providerFetch, type ProviderRequest } from "@/server/modules/integrations/client";
import { ProviderError } from "@/server/modules/integrations/providers";
import { analysisJsonSchema, retellAnalysisFields } from "./knowledge";
import { arr, num, obj, str, toE164, type TranscriptLine } from "./common";

/**
 * Voice provider adapters (public REST APIs, credentials from the Integrations module):
 *   Vapi      https://api.vapi.ai   — assistants (POST/PATCH /assistant), outbound calls (POST /call), phone numbers
 *             (GET/POST/PATCH /phone-number; free Vapi numbers or Twilio numbers imported with the company's Twilio
 *             credentials). Webhooks ("server messages") carry the shared secret we set in the assistant's server
 *             headers (x-vapi-secret), compared in constant time.
 *   Retell AI https://api.retellai.com — Retell LLM + agent (create/update-retell-llm, create/update-agent), outbound
 *             calls (POST /v2/create-phone-call), numbers (list/create/update-phone-number). Webhooks are signed with
 *             the API key: x-retell-signature "v=<ms>,d=<hex HMAC-SHA256(apiKey, body + ms)>" (5-minute tolerance).
 *   Twilio    numbers to import into Vapi (AvailablePhoneNumbers / IncomingPhoneNumbers).
 * Nothing here records a call as placed: callers persist only what the provider accepted.
 */

const VAPI = "https://api.vapi.ai";
const RETELL = "https://api.retellai.com";
const TWILIO = "https://api.twilio.com/2010-04-01";

export const webhookUrl = (provider: VoiceProvider, webhookKey: string) => `${env().APP_URL.replace(/\/$/, "")}/api/v1/webhooks/voice/${provider === "VAPI" ? "vapi" : "retell"}/${webhookKey}`;

async function call<T = Record<string, unknown>>(conn: Connection, url: string, req: ProviderRequest = {}): Promise<T> {
  const res = await providerFetch<T>(conn, url, { timeoutMs: 20_000, ...req });
  if (!res.ok) {
    const d = obj(res.data);
    const msg = str(d.message) ?? (Array.isArray(d.message) ? (d.message as unknown[]).map(String).join("; ") : null) ?? str(d.error) ?? str(d.error_message) ?? `HTTP ${res.status}`;
    throw new ProviderError(`${new URL(url).host}: ${msg.slice(0, 240)}`, res.status);
  }
  return res.data;
}

// ───────────── Connection test (used by integrations/providers.ts testConnection) ─────────────

export async function testVoiceConnection(provider: "vapi" | "retell", token: string): Promise<{ account: string | null; extra?: Record<string, unknown> }> {
  const url = provider === "vapi" ? `${VAPI}/phone-number?limit=100` : `${RETELL}/list-phone-numbers`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401 || res.status === 403) throw new ProviderError(`${provider === "vapi" ? "Vapi" : "Retell"} rejected the API key`, res.status);
  if (!res.ok) throw new ProviderError(`${provider === "vapi" ? "Vapi" : "Retell"} responded ${res.status}`, res.status);
  const data = (await res.json().catch(() => [])) as unknown;
  const count = arr(data).length;
  return { account: `${provider === "vapi" ? "Vapi" : "Retell AI"} · ${count} number${count === 1 ? "" : "s"}` };
}

// ───────────── Agents ─────────────

export interface AgentSpec {
  name: string;
  language: string;
  voiceId: string | null;
  firstMessage: string;
  systemPrompt: string;
  maxDurationSec: number;
  recordCalls: boolean;
  webhookUrl: string;
  /** Vapi only: secret sent back in x-vapi-secret. */
  webhookSecret: string | null;
  metadata: Record<string, string>;
}

function vapiTranscriber(language: string) {
  const code = language.split("-")[0]!;
  if (code === "ar") return { provider: "azure", language: "ar-AE" };
  return { provider: "deepgram", model: "nova-2", language: code === "zh" ? "zh-CN" : code === "hi" ? "hi" : code };
}

function vapiAssistantBody(s: AgentSpec) {
  return {
    name: s.name.slice(0, 40),
    firstMessage: s.firstMessage,
    firstMessageMode: "assistant-speaks-first",
    model: { provider: "openai", model: "gpt-4o-mini", temperature: 0.4, messages: [{ role: "system", content: s.systemPrompt }] },
    voice: s.voiceId ? { provider: "vapi", voiceId: s.voiceId } : { provider: "vapi", voiceId: "Elliot" },
    transcriber: vapiTranscriber(s.language),
    maxDurationSeconds: s.maxDurationSec,
    endCallFunctionEnabled: true,
    artifactPlan: { recordingEnabled: s.recordCalls },
    analysisPlan: { summaryPlan: { enabled: true }, structuredDataPlan: { enabled: true, schema: analysisJsonSchema() } },
    serverMessages: ["status-update", "end-of-call-report", "transcript"],
    // Live call control (end, transfer to a person, mute the AI) through the call's monitor.controlUrl.
    monitorPlan: { listenEnabled: false, controlEnabled: true },
    server: { url: s.webhookUrl, timeoutSeconds: 20, headers: s.webhookSecret ? { "x-vapi-secret": s.webhookSecret } : {} },
    metadata: s.metadata,
  };
}

function retellLlmBody(s: AgentSpec) {
  return {
    model: "gpt-4o-mini",
    general_prompt: s.systemPrompt,
    begin_message: s.firstMessage,
    general_tools: [{ type: "end_call", name: "end_call", description: "End the call when the conversation is finished or the person asks to stop." }],
  };
}

function retellAgentBody(s: AgentSpec, llmId: string) {
  return {
    response_engine: { type: "retell-llm", llm_id: llmId },
    agent_name: s.name.slice(0, 60),
    voice_id: s.voiceId || "11labs-Adrian",
    language: s.language,
    webhook_url: s.webhookUrl,
    max_call_duration_ms: s.maxDurationSec * 1000,
    end_call_after_silence_ms: 30_000,
    post_call_analysis_data: retellAnalysisFields(),
    metadata: s.metadata,
  };
}

/** Create or update the agent on the provider; returns the provider ids. */
export async function upsertAgent(provider: VoiceProvider, conn: Connection, spec: AgentSpec, ids: { agentId: string | null; llmId: string | null }): Promise<{ agentId: string; llmId: string | null }> {
  if (provider === "VAPI") {
    const body = vapiAssistantBody(spec);
    const out = ids.agentId ? await call(conn, `${VAPI}/assistant/${encodeURIComponent(ids.agentId)}`, { method: "PATCH", json: body }) : await call(conn, `${VAPI}/assistant`, { method: "POST", json: body });
    const id = str(obj(out).id);
    if (!id) throw new ProviderError("Vapi returned no assistant id");
    return { agentId: id, llmId: null };
  }
  let llmId = ids.llmId;
  if (llmId) await call(conn, `${RETELL}/update-retell-llm/${encodeURIComponent(llmId)}`, { method: "PATCH", json: retellLlmBody(spec) });
  else llmId = str(obj(await call(conn, `${RETELL}/create-retell-llm`, { method: "POST", json: retellLlmBody(spec) })).llm_id);
  if (!llmId) throw new ProviderError("Retell returned no LLM id");
  const body = retellAgentBody(spec, llmId);
  const out = ids.agentId ? await call(conn, `${RETELL}/update-agent/${encodeURIComponent(ids.agentId)}`, { method: "PATCH", json: body }) : await call(conn, `${RETELL}/create-agent`, { method: "POST", json: body });
  const agentId = str(obj(out).agent_id) ?? ids.agentId;
  if (!agentId) throw new ProviderError("Retell returned no agent id");
  return { agentId, llmId };
}

// ───────────── Numbers ─────────────

export interface ProviderNumber {
  externalId: string;
  number: string;
  label: string | null;
  /** Provider id of the agent answering inbound calls. */
  inboundAgentExternalId: string | null;
}

export async function listNumbers(provider: VoiceProvider, conn: Connection): Promise<ProviderNumber[]> {
  if (provider === "VAPI") {
    const rows = arr(await call<unknown>(conn, `${VAPI}/phone-number?limit=100`));
    return rows
      .map(obj)
      .map((r) => ({ externalId: str(r.id) ?? "", number: toE164(str(r.number)) ?? "", label: str(r.name), inboundAgentExternalId: str(r.assistantId) }))
      .filter((r) => r.externalId && r.number);
  }
  const rows = arr(await call<unknown>(conn, `${RETELL}/list-phone-numbers`));
  return rows
    .map(obj)
    .map((r) => {
      const n = toE164(str(r.phone_number)) ?? "";
      return { externalId: n, number: n, label: str(r.nickname) ?? str(r.phone_number_pretty), inboundAgentExternalId: str(r.inbound_agent_id) };
    })
    .filter((r) => r.number);
}

/** Point a number's inbound calls at an agent (null detaches it). */
export async function assignInbound(provider: VoiceProvider, conn: Connection, externalNumberId: string, agentExternalId: string | null): Promise<void> {
  if (provider === "VAPI") {
    await call(conn, `${VAPI}/phone-number/${encodeURIComponent(externalNumberId)}`, { method: "PATCH", json: { assistantId: agentExternalId } });
    return;
  }
  await call(conn, `${RETELL}/update-phone-number/${encodeURIComponent(externalNumberId)}`, { method: "PATCH", json: { inbound_agent_id: agentExternalId } });
}

/** Buy a number on the provider itself (Retell: US/Canada area code; Vapi: free US number). */
export async function buyProviderNumber(provider: VoiceProvider, conn: Connection, areaCode: string, label: string | null): Promise<ProviderNumber> {
  if (provider === "VAPI") {
    const r = obj(await call(conn, `${VAPI}/phone-number`, { method: "POST", json: { provider: "vapi", numberDesiredAreaCode: areaCode, ...(label ? { name: label } : {}) } }));
    const id = str(r.id);
    const number = toE164(str(r.number));
    if (!id) throw new ProviderError("Vapi returned no phone number");
    return { externalId: id, number: number ?? "", label: str(r.name), inboundAgentExternalId: null };
  }
  const r = obj(await call(conn, `${RETELL}/create-phone-number`, { method: "POST", json: { area_code: Number(areaCode), ...(label ? { nickname: label } : {}) } }));
  const n = toE164(str(r.phone_number));
  if (!n) throw new ProviderError("Retell returned no phone number");
  return { externalId: n, number: n, label: str(r.nickname), inboundAgentExternalId: null };
}

/** Import a Twilio number into Vapi (Vapi then uses the company's Twilio account to place and receive calls). */
export async function importTwilioToVapi(vapi: Connection, twilio: Connection, number: string, label: string | null): Promise<ProviderNumber> {
  const sid = str(twilio.config.accountSid);
  if (!sid || !twilio.accessToken) throw new ProviderError("Twilio credentials missing", 401);
  const r = obj(await call(vapi, `${VAPI}/phone-number`, { method: "POST", json: { provider: "twilio", number, twilioAccountSid: sid, twilioAuthToken: twilio.accessToken, ...(label ? { name: label } : {}) } }));
  const id = str(r.id);
  if (!id) throw new ProviderError("Vapi returned no phone number id");
  return { externalId: id, number, label: str(r.name), inboundAgentExternalId: null };
}

export interface TwilioNumber {
  sid: string | null;
  number: string;
  label: string | null;
  locality: string | null;
}

const twilioBase = (twilio: Connection) => {
  const sid = str(twilio.config.accountSid);
  if (!sid || !/^AC[a-f0-9]{32}$/.test(sid)) throw new ProviderError("Twilio account SID missing", 401);
  return `${TWILIO}/Accounts/${sid}`;
};

/** Voice-capable numbers the company already owns on Twilio. */
export async function twilioOwnedNumbers(twilio: Connection): Promise<TwilioNumber[]> {
  const r = obj(await call(twilio, `${twilioBase(twilio)}/IncomingPhoneNumbers.json?PageSize=100`));
  return arr(r.incoming_phone_numbers)
    .map(obj)
    .filter((n) => obj(n.capabilities).voice !== false)
    .map((n) => ({ sid: str(n.sid), number: toE164(str(n.phone_number)) ?? "", label: str(n.friendly_name), locality: null }))
    .filter((n) => n.number);
}

/** Search numbers available to buy on Twilio (country ISO code, optional area code / contains). */
export async function twilioSearch(twilio: Connection, country: string, areaCode: string | null): Promise<TwilioNumber[]> {
  const q = new URLSearchParams({ VoiceEnabled: "true", PageSize: "10" });
  if (areaCode) q.set("AreaCode", areaCode);
  const r = obj(await call(twilio, `${twilioBase(twilio)}/AvailablePhoneNumbers/${encodeURIComponent(country)}/Local.json?${q}`));
  return arr(r.available_phone_numbers)
    .map(obj)
    .map((n) => ({ sid: null, number: toE164(str(n.phone_number)) ?? "", label: str(n.friendly_name), locality: [str(n.locality), str(n.region)].filter(Boolean).join(", ") || null }))
    .filter((n) => n.number);
}

/** Buy a number on Twilio (charged to the company's Twilio account). */
export async function twilioBuy(twilio: Connection, number: string, label: string | null): Promise<TwilioNumber> {
  const r = obj(await call(twilio, `${twilioBase(twilio)}/IncomingPhoneNumbers.json`, { method: "POST", form: { PhoneNumber: number, ...(label ? { FriendlyName: label } : {}) } }));
  const n = toE164(str(r.phone_number));
  if (!n) throw new ProviderError("Twilio returned no phone number");
  return { sid: str(r.sid), number: n, label: str(r.friendly_name), locality: null };
}

// ───────────── Calls ─────────────

export interface PlaceCallInput {
  agentExternalId: string;
  /** Vapi phone-number id, or the Retell E.164 caller id. */
  numberExternalId: string;
  to: string;
  customerName: string | null;
  variables: Record<string, string>;
  metadata: Record<string, string>;
}

/** Vapi control URLs are capability URLs on vapi.ai; anything else is refused (no request to arbitrary hosts). */
export function safeVapiControlUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && (u.hostname === "vapi.ai" || u.hostname.endsWith(".vapi.ai")) ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function placeCall(provider: VoiceProvider, conn: Connection, c: PlaceCallInput): Promise<{ externalCallId: string; status: string | null; controlUrl: string | null }> {
  if (provider === "VAPI") {
    const r = obj(
      await call(conn, `${VAPI}/call`, {
        method: "POST",
        retries: 0,
        json: {
          assistantId: c.agentExternalId,
          phoneNumberId: c.numberExternalId,
          customer: { number: c.to, ...(c.customerName ? { name: c.customerName.slice(0, 40) } : {}) },
          assistantOverrides: { variableValues: c.variables, metadata: c.metadata },
          metadata: c.metadata,
        },
      }),
    );
    const id = str(r.id);
    if (!id) throw new ProviderError("Vapi returned no call id");
    return { externalCallId: id, status: str(r.status), controlUrl: safeVapiControlUrl(obj(r.monitor).controlUrl) };
  }
  const r = obj(
    await call(conn, `${RETELL}/v2/create-phone-call`, {
      method: "POST",
      retries: 0,
      json: { from_number: c.numberExternalId, to_number: c.to, override_agent_id: c.agentExternalId, metadata: c.metadata, retell_llm_dynamic_variables: c.variables },
    }),
  );
  const id = str(r.call_id);
  if (!id) throw new ProviderError("Retell returned no call id");
  return { externalCallId: id, status: str(r.call_status), controlUrl: null };
}

// ───────────── Webhooks ─────────────

const RETELL_TOLERANCE_MS = 5 * 60_000;

/** Retell: x-retell-signature "v=<timestamp ms>,d=<hex HMAC-SHA256(apiKey, rawBody + timestamp)>". */
export function verifyRetellSignature(raw: string, header: string | null, apiKey: string, nowMs = Date.now()): boolean {
  const m = /^v=(\d+),d=([a-f0-9]+)$/i.exec(header?.trim() ?? "");
  if (!m) return false;
  const ts = Number(m[1]);
  if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > RETELL_TOLERANCE_MS) return false;
  return safeEqual(m[2]!.toLowerCase(), hmacSha256(apiKey, raw + m[1]).toString("hex"));
}

/** Vapi: the secret we configured is sent back verbatim in x-vapi-secret. */
export function verifyVapiSecret(header: string | null, secret: string): boolean {
  return !!header && safeEqual(header.trim(), secret);
}

export type CallPhase = "status" | "ended" | "analyzed";

export interface NormalizedEvent {
  phase: CallPhase;
  externalCallId: string;
  direction: "INBOUND" | "OUTBOUND" | null;
  status: "QUEUED" | "RINGING" | "IN_PROGRESS" | "ENDED" | null;
  customerNumber: string | null;
  companyNumber: string | null;
  numberExternalId: string | null;
  agentExternalId: string | null;
  realyCallId: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSec: number | null;
  endedReason: string | null;
  transcript: TranscriptLine[] | null;
  summary: string | null;
  analysis: Record<string, unknown> | null;
  providerSentiment: string | null;
  voicemail: boolean;
  noAnswer: boolean;
  failed: boolean;
  recordingUrl: string | null;
  /** USD cents. */
  costCents: number | null;
  /** Vapi live-control URL (monitor.controlUrl), when the agent has controls enabled. */
  controlUrl: string | null;
}

const date = (v: unknown): Date | null => {
  const n = num(v);
  const d = typeof v === "string" && !/^\d+$/.test(v) ? new Date(v) : n !== null ? new Date(n) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const https = (v: unknown) => {
  const s = str(v);
  return s && /^https:\/\/[^\s]{5,2000}$/.test(s) ? s : null;
};

const VAPI_STATUS: Record<string, NormalizedEvent["status"]> = { scheduled: "QUEUED", queued: "QUEUED", ringing: "RINGING", "in-progress": "IN_PROGRESS", forwarding: "IN_PROGRESS", ended: "ENDED" };

/** Vapi server message → normalized event (null for message types we do not use). */
export function parseVapi(body: unknown): NormalizedEvent | null {
  const m = obj(obj(body).message);
  const type = str(m.type);
  if (type !== "status-update" && type !== "end-of-call-report") return null;
  const c = obj(m.call);
  const id = str(c.id);
  if (!id) return null;
  const meta = { ...obj(c.metadata), ...obj(obj(c.assistantOverrides).metadata) };
  const callType = str(c.type);
  const artifact = obj(m.artifact);
  const analysis = obj(m.analysis);
  const ended = type === "end-of-call-report";
  const reason = str(m.endedReason) ?? str(c.endedReason);
  const messages = arr(artifact.messages).length ? arr(artifact.messages) : arr(m.messages);
  const transcript: TranscriptLine[] = messages
    .map(obj)
    .filter((x) => x.role === "bot" || x.role === "assistant" || x.role === "user")
    .map((x) => ({ role: (x.role === "user" ? "caller" : "agent") as TranscriptLine["role"], text: (str(x.message) ?? str(x.content) ?? "").slice(0, 4000), ...(num(x.secondsFromStart) !== null ? { at: Math.round(num(x.secondsFromStart)!) } : {}) }))
    .filter((x) => x.text);
  const startedAt = date(m.startedAt) ?? date(c.startedAt);
  const endedAt = date(m.endedAt) ?? date(c.endedAt);
  const cost = num(m.cost) ?? num(c.cost);
  return {
    phase: ended ? "analyzed" : "status",
    externalCallId: id,
    direction: callType === "inboundPhoneCall" ? "INBOUND" : callType === "outboundPhoneCall" ? "OUTBOUND" : null,
    status: ended ? "ENDED" : (VAPI_STATUS[str(m.status) ?? ""] ?? null),
    customerNumber: toE164(str(obj(c.customer).number) ?? str(obj(m.customer).number)),
    companyNumber: toE164(str(obj(m.phoneNumber).number)),
    numberExternalId: str(c.phoneNumberId) ?? str(obj(m.phoneNumber).id),
    agentExternalId: str(c.assistantId) ?? str(obj(m.assistant).id),
    realyCallId: str(meta.realyCallId),
    startedAt,
    endedAt,
    durationSec: num(m.durationSeconds) !== null ? Math.round(num(m.durationSeconds)!) : startedAt && endedAt ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)) : null,
    endedReason: reason,
    transcript: ended ? transcript : null,
    summary: ended ? (str(analysis.summary) ?? str(m.summary)) : null,
    analysis: ended ? obj(analysis.structuredData) : null,
    providerSentiment: null,
    voicemail: reason === "voicemail",
    noAnswer: !!reason && /did-not-answer|customer-busy|no-answer/.test(reason),
    failed: !!reason && /error|failed|could-not|invalid|twilio-failed|pipeline/.test(reason) && !/assistant-ended-call|customer-ended-call/.test(reason),
    recordingUrl: ended ? (https(artifact.recordingUrl) ?? https(m.recordingUrl) ?? https(obj(artifact.recording).stereoUrl)) : null,
    costCents: cost !== null ? Math.round(cost * 100) : null,
    controlUrl: safeVapiControlUrl(obj(c.monitor).controlUrl),
  };
}

/** Retell webhook → normalized event. */
export function parseRetell(body: unknown): NormalizedEvent | null {
  const b = obj(body);
  const event = str(b.event);
  if (event !== "call_started" && event !== "call_ended" && event !== "call_analyzed") return null;
  const c = obj(b.call);
  const id = str(c.call_id);
  if (!id) return null;
  const direction = str(c.direction) === "inbound" ? "INBOUND" : str(c.direction) === "outbound" ? "OUTBOUND" : null;
  const ca = obj(c.call_analysis);
  const reason = str(c.disconnection_reason);
  const startedAt = date(c.start_timestamp);
  const endedAt = date(c.end_timestamp);
  const done = event !== "call_started";
  const transcript: TranscriptLine[] = arr(c.transcript_object)
    .map(obj)
    .map((x) => {
      const words = arr(x.words).map(obj);
      const at = num(words[0]?.start);
      return { role: (x.role === "agent" ? "agent" : "caller") as TranscriptLine["role"], text: (str(x.content) ?? "").slice(0, 4000), ...(at !== null ? { at: Math.round(at) } : {}) };
    })
    .filter((x) => x.text);
  const cost = num(obj(c.call_cost).combined_cost);
  return {
    phase: event === "call_started" ? "status" : event === "call_ended" ? "ended" : "analyzed",
    externalCallId: id,
    direction,
    status: event === "call_started" ? "IN_PROGRESS" : "ENDED",
    customerNumber: toE164(direction === "INBOUND" ? str(c.from_number) : str(c.to_number)),
    companyNumber: toE164(direction === "INBOUND" ? str(c.to_number) : str(c.from_number)),
    numberExternalId: toE164(direction === "INBOUND" ? str(c.to_number) : str(c.from_number)),
    agentExternalId: str(c.agent_id),
    realyCallId: str(obj(c.metadata).realyCallId),
    startedAt,
    endedAt,
    durationSec: num(c.duration_ms) !== null ? Math.round(num(c.duration_ms)! / 1000) : startedAt && endedAt ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)) : null,
    endedReason: reason,
    transcript: done && transcript.length ? transcript : null,
    summary: event === "call_analyzed" ? str(ca.call_summary) : null,
    analysis: event === "call_analyzed" ? obj(ca.custom_analysis_data) : null,
    providerSentiment: event === "call_analyzed" ? str(ca.user_sentiment) : null,
    voicemail: ca.in_voicemail === true || reason === "voicemail_reached",
    noAnswer: !!reason && /dial_no_answer|dial_busy/.test(reason),
    failed: !!reason && /dial_failed|error|invalid_destination|telephony_provider/.test(reason),
    recordingUrl: done ? https(c.recording_url) : null,
    costCents: cost !== null ? Math.round(cost) : null,
    controlUrl: null,
  };
}

// ───────────── Live transcript events ─────────────

export interface LiveLine {
  role: "agent" | "caller";
  text: string;
  atSec: number | null;
  /** Stable per call: a redelivered event updates the same row. */
  key: string;
}

export interface LiveTranscriptEvent {
  externalCallId: string;
  realyCallId: string | null;
  lines: LiveLine[];
}

/**
 * Real-time transcript events: Vapi "transcript" messages (final turns only) and Retell "transcript_updated" (sent on
 * turn-taking when enabled on the agent; the last, still-open turn is skipped). Null for other events.
 */
export function parseLiveTranscript(provider: VoiceProvider, body: unknown): LiveTranscriptEvent | null {
  if (provider === "VAPI") {
    const m = obj(obj(body).message);
    if (str(m.type) !== "transcript" || str(m.transcriptType) !== "final") return null;
    const c = obj(m.call);
    const id = str(c.id);
    const text = str(m.transcript);
    if (!id || !text) return null;
    const role = str(m.role) === "user" ? "caller" : "agent";
    const ts = num(m.timestamp);
    const atSec = num(m.secondsFromStart);
    const key = `v:${role}:${ts ?? atSec ?? hashText(text)}`;
    return { externalCallId: id, realyCallId: str({ ...obj(c.metadata), ...obj(obj(c.assistantOverrides).metadata) }.realyCallId), lines: [{ role, text: text.slice(0, 4000), atSec: atSec !== null ? Math.round(atSec) : null, key }] };
  }
  const b = obj(body);
  if (str(b.event) !== "transcript_updated") return null;
  const c = obj(b.call);
  const id = str(c.call_id);
  if (!id) return null;
  const turns = arr(c.transcript_object).map(obj);
  const lines: LiveLine[] = turns.slice(0, Math.max(0, turns.length - 1)).map((x, i) => {
    const at = num(arr(x.words).map(obj)[0]?.start);
    return { role: x.role === "agent" ? "agent" : "caller", text: (str(x.content) ?? "").slice(0, 4000), atSec: at !== null ? Math.round(at) : null, key: `r:${i}` };
  });
  return { externalCallId: id, realyCallId: str(obj(c.metadata).realyCallId), lines: lines.filter((l) => l.text) };
}

function hashText(t: string): string {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (Math.imul(31, h) + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
