import "server-only";
import { providerFetch } from "../client";
import { ProviderError } from "../providers";
import { FLAT_COST_MICROS, recordUsage } from "../usage";
import { ensureOk, errorText, str, withFallback, type ServiceResult } from "./common";

/**
 * ElevenLabs adapter (raw provider calls; product features such as voiceovers build on it): voice library, text to
 * speech (returns the audio bytes) and Scribe speech to text. Usage is metered per character / audio second with
 * list-price estimates. Callers authorize their feature (and plan) first.
 */

const API = "https://api.elevenlabs.io";

export interface ElevenVoice {
  voiceId: string;
  name: string;
  category: string | null;
  previewUrl: string | null;
  labels: Record<string, string>;
}

export async function listElevenLabsVoices(organizationId: string, companyId: string, opts: { search?: string } = {}): Promise<ServiceResult<ElevenVoice[]>> {
  return withFallback(organizationId, companyId, ["elevenlabs"], async (conn) => {
    const qs = new URLSearchParams({ page_size: "100", ...(opts.search ? { search: opts.search.slice(0, 80) } : {}) });
    const res = await providerFetch<{ voices?: { voice_id: string; name?: string; category?: string; preview_url?: string; labels?: Record<string, string> }[] }>(conn, `${API}/v2/voices?${qs}`, { retries: 2 });
    ensureOk(res, "ElevenLabs voices");
    return (res.data?.voices ?? []).map((v) => ({ voiceId: v.voice_id, name: v.name ?? v.voice_id, category: v.category ?? null, previewUrl: v.preview_url ?? null, labels: v.labels ?? {} }));
  });
}

export interface SpeechInput {
  text: string;
  /** Defaults to the connection's default voice. */
  voiceId?: string;
  modelId?: string;
  /** ElevenLabs output format, e.g. "mp3_44100_128" (default) or "pcm_16000". */
  outputFormat?: string;
  languageCode?: string;
}

export interface SpeechAudio {
  audio: Uint8Array;
  contentType: string;
  characters: number;
  voiceId: string;
  modelId: string;
  estimatedCostMicros: number;
}

export async function elevenLabsSpeech(organizationId: string, companyId: string, input: SpeechInput): Promise<ServiceResult<SpeechAudio>> {
  const text = input.text.trim();
  if (!text) return { ok: false, code: "invalid_input", error: "Text is empty", providerId: null, attempts: [] };
  if (text.length > 10_000) return { ok: false, code: "invalid_input", error: "Text is too long (max 10,000 characters per request)", providerId: null, attempts: [] };
  return withFallback(organizationId, companyId, ["elevenlabs"], async (conn) => {
    const voiceId = (input.voiceId && /^[A-Za-z0-9]{10,40}$/.test(input.voiceId) ? input.voiceId : null) ?? str(conn.config.defaultVoiceId);
    if (!voiceId) throw new ProviderError("Choose a voice (or set a default voice on the ElevenLabs connection)", 400);
    const modelId = input.modelId && /^[a-z0-9_]{3,40}$/.test(input.modelId) ? input.modelId : "eleven_multilingual_v2";
    const format = input.outputFormat && /^[a-z0-9_]{3,30}$/.test(input.outputFormat) ? input.outputFormat : "mp3_44100_128";
    const cost = FLAT_COST_MICROS["elevenlabs.character"]! * text.length;
    try {
      const res = await providerFetch(conn, `${API}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${format}`, {
        json: { text, model_id: modelId, ...(input.languageCode && /^[a-z]{2}$/.test(input.languageCode) ? { language_code: input.languageCode } : {}) },
        headers: { accept: format.startsWith("pcm") ? "audio/pcm" : "audio/mpeg" },
        binary: true,
        timeoutMs: 120_000,
        retries: 1,
        costCents: cost / 10_000,
      });
      ensureOk(res, "ElevenLabs text to speech");
      if (!res.bytes?.byteLength) throw new Error("ElevenLabs returned no audio");
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "elevenlabs", operation: "tts.speech", units: text.length, unit: "request", estimatedCostMicros: cost, status: "SUCCEEDED", meta: { voiceId, modelId, characters: text.length, bytes: res.bytes.byteLength } });
      return { audio: res.bytes, contentType: res.headers?.get("content-type") ?? "audio/mpeg", characters: text.length, voiceId, modelId, estimatedCostMicros: cost };
    } catch (err) {
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "elevenlabs", operation: "tts.speech", units: 0, estimatedCostMicros: 0, status: "FAILED", error: errorText(err), meta: { voiceId, modelId } });
      throw err;
    }
  });
}

export interface TranscribeInput {
  /** Public HTTPS URL of the audio / video file, or the bytes themselves. */
  url?: string;
  audio?: Uint8Array;
  contentType?: string;
  languageCode?: string;
  diarize?: boolean;
}

export interface Transcript {
  text: string;
  languageCode: string | null;
  durationSeconds: number | null;
  words: { text: string; start: number; end: number; speaker: string | null }[];
  estimatedCostMicros: number | null;
}

/** Scribe speech to text (model scribe_v1). */
export async function elevenLabsTranscribe(organizationId: string, companyId: string, input: TranscribeInput): Promise<ServiceResult<Transcript>> {
  if (!input.url && !input.audio?.byteLength) return { ok: false, code: "invalid_input", error: "Provide an audio URL or file", providerId: null, attempts: [] };
  if (input.url && !/^https:\/\//.test(input.url)) return { ok: false, code: "invalid_input", error: "Audio URL must be HTTPS", providerId: null, attempts: [] };
  return withFallback(organizationId, companyId, ["elevenlabs"], async (conn) => {
    const form = new FormData();
    form.set("model_id", "scribe_v1");
    if (input.url) form.set("cloud_storage_url", input.url);
    else form.set("file", new Blob([input.audio! as BlobPart], { type: input.contentType ?? "application/octet-stream" }), "audio");
    if (input.languageCode && /^[a-z]{2,3}$/.test(input.languageCode)) form.set("language_code", input.languageCode);
    if (input.diarize) form.set("diarize", "true");
    try {
      const res = await providerFetch<{ text?: string; language_code?: string; words?: { text?: string; start?: number; end?: number; speaker_id?: string; type?: string }[] }>(conn, `${API}/v1/speech-to-text`, { raw: form, timeoutMs: 300_000, retries: 1 });
      ensureOk(res, "ElevenLabs speech to text");
      const words = (res.data?.words ?? []).filter((w) => w.type !== "spacing").map((w) => ({ text: w.text ?? "", start: w.start ?? 0, end: w.end ?? 0, speaker: w.speaker_id ?? null }));
      const duration = words.length ? Math.ceil(words[words.length - 1]!.end) : null;
      const cost = duration ? FLAT_COST_MICROS["elevenlabs.stt_second"]! * duration : null;
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "elevenlabs", operation: "stt.transcribe", units: duration ?? 0, unit: "second", estimatedCostMicros: cost, status: "SUCCEEDED", meta: { languageCode: res.data?.language_code ?? null } });
      return { text: res.data?.text ?? "", languageCode: res.data?.language_code ?? null, durationSeconds: duration, words, estimatedCostMicros: cost };
    } catch (err) {
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "elevenlabs", operation: "stt.transcribe", units: 0, unit: "second", estimatedCostMicros: 0, status: "FAILED", error: errorText(err) });
      throw err;
    }
  });
}
