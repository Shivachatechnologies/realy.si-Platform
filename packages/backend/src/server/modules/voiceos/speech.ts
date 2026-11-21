import "server-only";
import { z } from "zod";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { isIntegrationEnabled } from "@/server/core/platform-controls";
import { getConnection, type Connection } from "@/server/modules/integrations/connections";
import { providerFetch } from "@/server/modules/integrations/client";
import { ProviderError } from "@/server/modules/integrations/providers";
import { recordUsage as recordIntegrationUsage } from "@/server/modules/integrations/usage";
import { checkLimit, limitReachedError, recordUsage } from "@/server/modules/entitlements/service";
import { authorizeVoice, isUuid, readSettings, type VoiceScope } from "./access";
import {
  isVoiceLanguage,
  MAX_SPEAK_CHARS,
  MAX_UTTERANCE_SECONDS,
  personalityOf,
  STT_LANGUAGE,
  STT_PROVIDERS,
  TTS_PROVIDERS,
  type SttProvider,
  type TtsProvider,
  type VoiceLanguage,
} from "./catalog";

/**
 * Speech providers of Voice OS. Credentials come only from the company's integrations (getConnection) and every call
 * goes through providerFetch (rate limits, request log, health). No connection → the client uses the browser's own
 * speech engines and is told so; nothing is pretended. Provider speech is metered on voice.assistant.minutes.
 */

const SPEECH_PROVIDERS = ["openai", "elevenlabs", "deepgram"] as const;
const LIMIT_KEY = "voice.assistant.minutes.month" as const;

/** Connected speech providers of the company (no decryption; platform-disabled providers excluded). */
export async function connectedSpeechProviders(scope: VoiceScope): Promise<{ stt: SttProvider[]; tts: TtsProvider[] }> {
  const rows = await db().integrationConnection.findMany({
    where: { ...scope, provider: { in: [...SPEECH_PROVIDERS] }, status: { not: "DISCONNECTED" }, credentialsEnc: { not: null } },
    select: { provider: true },
  });
  const enabled: string[] = [];
  for (const r of rows) if (await isIntegrationEnabled(r.provider)) enabled.push(r.provider);
  return {
    stt: STT_PROVIDERS.filter((p) => enabled.includes(p)),
    tts: TTS_PROVIDERS.filter((p) => enabled.includes(p)),
  };
}

async function pickConnection<P extends string>(scope: VoiceScope, choice: string, order: readonly P[]): Promise<{ provider: P; conn: Connection } | null> {
  if (choice === "browser") return null;
  const candidates = choice === "auto" ? order : order.filter((p) => p === choice);
  for (const p of candidates) {
    const conn = await getConnection(scope.organizationId, scope.companyId, p);
    if (conn?.accessToken) return { provider: p, conn };
  }
  return null;
}

/** Headers for providers whose API key is not a Bearer token (sent with noAuth so the generic header is skipped). */
function keyHeaders(provider: string, token: string): Record<string, string> {
  if (provider === "elevenlabs") return { "xi-api-key": token };
  if (provider === "deepgram") return { authorization: `Token ${token}` };
  return {};
}

async function activeSession(scope: VoiceScope, userId: string, sessionId: string) {
  if (!isUuid(sessionId)) throw notFound("Voice session");
  const s = await db().voiceosSession.findFirst({ where: { ...scope, id: sessionId, userId }, select: { id: true, status: true, language: true, personality: true } });
  if (!s) throw notFound("Voice session");
  return s;
}

/** Refuse provider speech when the plan's voice minutes are used up (browser speech keeps working). */
async function assertMinutesLeft(organizationId: string) {
  const c = await checkLimit(organizationId, LIMIT_KEY, 1);
  if (!c.allowed) throw limitReachedError(c, organizationId);
}

/**
 * Add provider speech seconds to the session and record every newly started minute on the plan meter (idempotent
 * per session and minute, so retries never double count).
 */
export async function meterSpeech(scope: VoiceScope, sessionId: string, kind: "stt" | "tts", seconds: number): Promise<void> {
  const s = Math.max(1, Math.round(seconds));
  try {
    const row = await db().voiceosSession.update({
      where: { id: sessionId },
      data: kind === "stt" ? { sttSeconds: { increment: s }, lastActivityAt: new Date() } : { ttsSeconds: { increment: s }, lastActivityAt: new Date() },
      select: { sttSeconds: true, ttsSeconds: true, meteredMinutes: true },
    });
    const total = Math.ceil((row.sttSeconds + row.ttsSeconds) / 60);
    if (total <= row.meteredMinutes) return;
    const moved = await db().voiceosSession.updateMany({ where: { id: sessionId, meteredMinutes: row.meteredMinutes }, data: { meteredMinutes: total } });
    if (moved.count) await recordUsage(scope.organizationId, "voice.assistant.minutes", total - row.meteredMinutes, { companyId: scope.companyId, idempotencyKey: `${sessionId}:${total}` });
  } catch (err) {
    logger.warn({ sessionId, err: err instanceof Error ? err.message : String(err) }, "voice minutes not metered");
  }
}

function providerFailed(provider: string, err: unknown): AppError {
  const status = err instanceof ProviderError ? err.status : null;
  return new AppError("service_unavailable", `${provider} speech request failed`, {
    reason: status === 401 || status === 403 ? "voiceos_provider_rejected" : "voiceos_provider_failed",
    provider,
    status,
  });
}

// ───────────── Speech to text ─────────────

export const transcribeInput = z.object({
  sessionId: z.string().uuid(),
  /** Base64 audio of one phrase (MediaRecorder output). */
  audio: z.string().min(16).max(6_000_000),
  mimeType: z.string().max(80).regex(/^audio\/[a-z0-9.+-]+(;\s*codecs=[a-z0-9.,"' -]+)?$/i),
  durationMs: z.number().int().min(100).max(MAX_UTTERANCE_SECONDS * 1000),
  language: z.string().max(10).optional(),
});

function extOf(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mp4") || m.includes("aac") || m.includes("m4a")) return "mp4";
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  return "webm";
}

/**
 * Transcribe one recorded phrase with the company's speech-to-text provider. Returns provider "browser" with no
 * text when none is connected (the client then relies on the browser recogniser).
 */
export async function transcribe(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof transcribeInput>) {
  const input = transcribeInput.parse(raw);
  const scope = { organizationId, companyId };
  const { userId } = await authorizeVoice(ctx, organizationId, companyId);
  const session = await activeSession(scope, userId, input.sessionId);
  const settings = await readSettings(scope, userId);
  const picked = await pickConnection(scope, settings.sttProvider, STT_PROVIDERS);
  if (!picked) return { provider: "browser" as const, text: null, seconds: 0 };
  await assertMinutesLeft(organizationId);

  const bytes = Buffer.from(input.audio, "base64");
  if (bytes.byteLength < 200) throw new AppError("validation_error", "Recording is empty");
  if (bytes.byteLength > 4_500_000) throw new AppError("payload_too_large", "Recording is too long");
  const language: VoiceLanguage = isVoiceLanguage(input.language) ? input.language : isVoiceLanguage(session.language) ? session.language : "en-US";
  const code = STT_LANGUAGE[language];
  const mime = input.mimeType.split(";")[0]!.trim();
  const fileName = `utterance.${extOf(mime)}`;
  const { provider, conn } = picked;
  let text = "";
  let seconds = input.durationMs / 1000;
  try {
    if (provider === "openai") {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), fileName);
      form.append("model", typeof conn.config.transcribeModel === "string" ? conn.config.transcribeModel : "gpt-4o-mini-transcribe");
      form.append("language", code);
      form.append("response_format", "json");
      const res = await providerFetch<{ text?: string }>(conn, "https://api.openai.com/v1/audio/transcriptions", { raw: form, timeoutMs: 45_000, retries: 1 });
      if (!res.ok) throw new ProviderError(`api.openai.com responded ${res.status}`, res.status);
      text = res.data?.text ?? "";
    } else if (provider === "elevenlabs") {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), fileName);
      form.append("model_id", "scribe_v1");
      form.append("language_code", code);
      form.append("tag_audio_events", "false");
      const res = await providerFetch<{ text?: string }>(conn, "https://api.elevenlabs.io/v1/speech-to-text", { raw: form, noAuth: true, headers: keyHeaders(provider, conn.accessToken!), timeoutMs: 45_000, retries: 1 });
      if (!res.ok) throw new ProviderError(`api.elevenlabs.io responded ${res.status}`, res.status);
      text = res.data?.text ?? "";
    } else {
      const model = language === "en-US" || language === "de-DE" ? "nova-3" : "nova-2";
      const lang = language === "zh-CN" ? "zh-CN" : code;
      const url = `https://api.deepgram.com/v1/listen?model=${model}&smart_format=true&punctuate=true&language=${encodeURIComponent(lang)}`;
      const res = await providerFetch<{ metadata?: { duration?: number }; results?: { channels?: { alternatives?: { transcript?: string }[] }[] } }>(conn, url, {
        raw: new Uint8Array(bytes),
        noAuth: true,
        headers: { ...keyHeaders(provider, conn.accessToken!), "content-type": mime },
        timeoutMs: 45_000,
        retries: 1,
      });
      if (!res.ok) throw new ProviderError(`api.deepgram.com responded ${res.status}`, res.status);
      text = res.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
      if (typeof res.data?.metadata?.duration === "number") seconds = res.data.metadata.duration;
    }
  } catch (err) {
    await recordIntegrationUsage({ ...scope, connectionId: conn.id, provider, operation: "speech_to_text", units: Math.ceil(seconds), unit: "second", status: "FAILED", error: err instanceof Error ? err.message : null });
    throw providerFailed(provider, err);
  }
  seconds = Math.min(MAX_UTTERANCE_SECONDS, Math.max(0.5, seconds));
  await recordIntegrationUsage({ ...scope, connectionId: conn.id, provider, operation: "speech_to_text", units: Math.ceil(seconds), unit: "second", status: "SUCCEEDED" });
  await meterSpeech(scope, session.id, "stt", seconds);
  return { provider, text: text.trim(), seconds: Math.round(seconds * 10) / 10 };
}

// ───────────── Text to speech ─────────────

export const speakInput = z.object({
  sessionId: z.string().uuid(),
  text: z.string().trim().min(1).max(4000),
  personality: z.string().max(32).optional(),
  language: z.string().max(10).optional(),
});

function decodeSseAudio(body: string): Buffer {
  const parts: Buffer[] = [];
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const ev = JSON.parse(payload) as { type?: string; audio?: string };
      if (ev.type === "speech.audio.delta" && typeof ev.audio === "string") parts.push(Buffer.from(ev.audio, "base64"));
    } catch {
      /* ignore keep-alive or partial lines */
    }
  }
  return Buffer.concat(parts);
}

/**
 * Voice a reply with the company's text-to-speech provider (ElevenLabs, then OpenAI). Returns provider "browser"
 * without audio when none is connected (the client then speaks with speechSynthesis).
 */
export async function synthesize(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof speakInput>) {
  const input = speakInput.parse(raw);
  const scope = { organizationId, companyId };
  const { userId } = await authorizeVoice(ctx, organizationId, companyId);
  const session = await activeSession(scope, userId, input.sessionId);
  const settings = await readSettings(scope, userId);
  const picked = await pickConnection(scope, settings.ttsProvider, TTS_PROVIDERS);
  if (!picked) return { provider: "browser" as const, audio: null, format: null, sampleRate: null, seconds: 0 };
  await assertMinutesLeft(organizationId);
  const persona = personalityOf(input.personality ?? settings.personality ?? session.personality);
  const text = input.text.slice(0, MAX_SPEAK_CHARS);
  const { provider, conn } = picked;
  let audio: Buffer;
  let seconds = 0;
  let format: "mp3" | "pcm16";
  let sampleRate: number | null = null;
  try {
    if (provider === "elevenlabs") {
      const voiceId = typeof conn.config.voiceId === "string" && /^[A-Za-z0-9]{10,40}$/.test(conn.config.voiceId) ? conn.config.voiceId : persona.elevenVoiceId;
      const model = typeof conn.config.ttsModel === "string" && /^[a-z0-9_]{3,40}$/.test(conn.config.ttsModel) ? conn.config.ttsModel : "eleven_flash_v2_5";
      const res = await providerFetch<{ audio_base64?: string; alignment?: { character_end_times_seconds?: number[] } }>(
        conn,
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`,
        { json: { text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }, noAuth: true, headers: keyHeaders(provider, conn.accessToken!), timeoutMs: 45_000, retries: 1 },
      );
      if (!res.ok || !res.data?.audio_base64) throw new ProviderError(`api.elevenlabs.io responded ${res.status}`, res.status);
      audio = Buffer.from(res.data.audio_base64, "base64");
      const ends = res.data.alignment?.character_end_times_seconds ?? [];
      seconds = ends.length ? ends[ends.length - 1]! : audio.byteLength / 16_000; // 128 kbps
      format = "mp3";
    } else {
      const res = await providerFetch<string>(conn, "https://api.openai.com/v1/audio/speech", {
        json: { model: "gpt-4o-mini-tts", voice: persona.openaiVoice, input: text, instructions: persona.openaiStyle, response_format: "pcm", stream_format: "sse" },
        headers: { accept: "text/event-stream" },
        timeoutMs: 45_000,
        retries: 1,
      });
      if (!res.ok) throw new ProviderError(`api.openai.com responded ${res.status}`, res.status);
      audio = decodeSseAudio(typeof res.data === "string" ? res.data : res.text);
      if (!audio.byteLength) throw new ProviderError("api.openai.com returned no audio", 502);
      sampleRate = 24_000;
      seconds = audio.byteLength / (sampleRate * 2); // 16-bit mono PCM
      format = "pcm16";
    }
  } catch (err) {
    await recordIntegrationUsage({ ...scope, connectionId: conn.id, provider, operation: "text_to_speech", units: text.length, unit: "byte", status: "FAILED", error: err instanceof Error ? err.message : null });
    throw providerFailed(provider, err);
  }
  await recordIntegrationUsage({ ...scope, connectionId: conn.id, provider, operation: "text_to_speech", units: Math.ceil(seconds), unit: "second", status: "SUCCEEDED", meta: { chars: text.length } });
  await meterSpeech(scope, session.id, "tts", seconds);
  return { provider, audio: audio.toString("base64"), format, sampleRate, seconds: Math.round(seconds * 10) / 10 };
}

// ───────────── Connection tests (integrations/providers.ts testConnection) ─────────────

/** Verify an ElevenLabs or Deepgram API key with an authenticated read. */
export async function testSpeechConnection(provider: "elevenlabs" | "deepgram", token: string): Promise<{ account: string | null }> {
  const headers = { accept: "application/json", "user-agent": "Realy", ...keyHeaders(provider, token) };
  const url = provider === "elevenlabs" ? "https://api.elevenlabs.io/v1/models" : "https://api.deepgram.com/v1/projects";
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000), redirect: "manual" });
  if (!res.ok) throw new ProviderError(`${new URL(url).host} responded ${res.status}`, res.status);
  if (provider === "deepgram") {
    const body = (await res.json().catch(() => ({}))) as { projects?: { name?: string }[] };
    return { account: body.projects?.[0]?.name ? `Deepgram · ${body.projects[0].name}` : "Deepgram" };
  }
  return { account: "ElevenLabs" };
}
