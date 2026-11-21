import "server-only";
import { providerFetch } from "../client";
import { recordUsage } from "../usage";
import { ensureOk, errorText, str, withFallback, type ServiceResult } from "./common";
import { newObjectKey, putObject, type StoredObject } from "./storage";

/**
 * Text-to-speech for voiceovers with provider fallback ElevenLabs → OpenAI. ElevenLabs' `with-timestamps` endpoint
 * returns character timings (exact captions); OpenAI TTS returns audio only, so its word timings are ESTIMATED from the
 * speaking rate and flagged as such. Audio is stored through the storage service; nothing is returned unless a provider
 * produced audio.
 *
 * Integrations catalog entry needed: `elevenlabs` (api_key; fields apiKey (secret), voiceId, model). Auth header is
 * `xi-api-key` (sent here explicitly, so providers.ts needs no change).
 */

export const VOICEOVER_PROVIDERS = ["elevenlabs", "openai"] as const;
export type VoiceoverProvider = (typeof VOICEOVER_PROVIDERS)[number];

export interface VoiceoverInput {
  text: string;
  /** ElevenLabs voice id or OpenAI voice name. */
  voice?: string | null;
  /** Delivery instructions (OpenAI gpt-4o-mini-tts only), e.g. "warm, upbeat, confident". */
  instructions?: string | null;
  providers?: readonly VoiceoverProvider[];
}

export interface WordTiming {
  text: string;
  start: number;
  end: number;
}

export interface Voiceover {
  audio: StoredObject;
  model: string;
  voice: string;
  durationSeconds: number;
  words: WordTiming[];
  /** "provider": timings reported by the provider; "estimated": derived from the speaking rate. */
  timing: "provider" | "estimated";
  estimatedCostMicros: number | null;
}

/** List-price estimates (micro-USD per character). */
const COST_PER_CHAR: Record<VoiceoverProvider, number> = { elevenlabs: 180, openai: 15 };
const ELEVEN_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";
const OPENAI_VOICES = new Set(["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"]);
const WORDS_PER_SECOND = 2.6;

/** Character alignment → word timings. */
export function wordsFromAlignment(chars: string[], starts: number[], ends: number[]): WordTiming[] {
  const words: WordTiming[] = [];
  let cur: WordTiming | null = null;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i] ?? "";
    if (/\s/.test(c)) {
      if (cur) words.push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = { text: c, start: starts[i] ?? 0, end: ends[i] ?? starts[i] ?? 0 };
    else {
      cur.text += c;
      cur.end = ends[i] ?? cur.end;
    }
  }
  if (cur) words.push(cur);
  return words;
}

/** Evenly spread word timings at a typical speaking rate (used when the provider reports none). */
export function estimateWordTimings(text: string, totalSeconds?: number): WordTiming[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const total = totalSeconds && totalSeconds > 0 ? totalSeconds : tokens.length / WORDS_PER_SECOND;
  const weights = tokens.map((w) => Math.max(1, w.replace(/[^\p{L}\p{N}]/gu, "").length) + (/[.,!?;:]$/.test(w) ? 3 : 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  return tokens.map((w, i) => {
    const d = (weights[i]! / sum) * total;
    const out = { text: w, start: Number(t.toFixed(3)), end: Number((t + d).toFixed(3)) };
    t += d;
    return out;
  });
}

/** Concatenate base64 audio chunks of an OpenAI `stream_format: "sse"` speech response. */
function audioFromSse(body: string): { bytes: Uint8Array; usageTokens: number } {
  const chunks: Buffer[] = [];
  let usageTokens = 0;
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const ev = JSON.parse(payload) as { type?: string; audio?: string; usage?: { total_tokens?: number } };
      if (ev.type === "speech.audio.delta" && ev.audio) chunks.push(Buffer.from(ev.audio, "base64"));
      if (ev.type === "speech.audio.done" && ev.usage?.total_tokens) usageTokens = ev.usage.total_tokens;
    } catch {
      // ignore malformed lines
    }
  }
  return { bytes: new Uint8Array(Buffer.concat(chunks)), usageTokens };
}

export async function generateVoiceover(organizationId: string, companyId: string, input: VoiceoverInput): Promise<ServiceResult<Voiceover>> {
  const text = input.text.replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, code: "invalid_input", error: "Script is empty", providerId: null, attempts: [] };
  if (text.length > 4096) return { ok: false, code: "invalid_input", error: "Script is too long for one voiceover (max 4096 characters)", providerId: null, attempts: [] };

  return withFallback(organizationId, companyId, input.providers ?? VOICEOVER_PROVIDERS, async (conn) => {
    const provider = conn.provider as VoiceoverProvider;
    const est = COST_PER_CHAR[provider] * text.length;
    let model = "";
    let voice = "";
    try {
      let bytes: Uint8Array;
      let words: WordTiming[];
      let timing: Voiceover["timing"];
      if (provider === "elevenlabs") {
        voice = input.voice && /^[A-Za-z0-9]{8,40}$/.test(input.voice) ? input.voice : (str(conn.config.voiceId) ?? ELEVEN_DEFAULT_VOICE);
        model = str(conn.config.model) ?? "eleven_multilingual_v2";
        const res = await providerFetch<{ audio_base64?: string; alignment?: { characters?: string[]; character_start_times_seconds?: number[]; character_end_times_seconds?: number[] } }>(
          conn,
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=mp3_44100_128`,
          { json: { text, model_id: model }, noAuth: true, headers: { "xi-api-key": conn.accessToken }, timeoutMs: 180_000, retries: 1, costCents: est / 10_000 },
        );
        ensureOk(res, "ElevenLabs text-to-speech");
        if (!res.data?.audio_base64) throw new Error("ElevenLabs returned no audio");
        bytes = new Uint8Array(Buffer.from(res.data.audio_base64, "base64"));
        const a = res.data.alignment;
        words = a?.characters?.length ? wordsFromAlignment(a.characters, a.character_start_times_seconds ?? [], a.character_end_times_seconds ?? []) : estimateWordTimings(text);
        timing = a?.characters?.length ? "provider" : "estimated";
      } else {
        voice = input.voice && OPENAI_VOICES.has(input.voice) ? input.voice : "alloy";
        model = "gpt-4o-mini-tts";
        const res = await providerFetch<string>(conn, "https://api.openai.com/v1/audio/speech", {
          json: { model, input: text, voice, response_format: "mp3", stream_format: "sse", ...(input.instructions ? { instructions: input.instructions.slice(0, 500) } : {}) },
          headers: { accept: "text/event-stream" },
          timeoutMs: 180_000,
          retries: 1,
          costCents: est / 10_000,
        });
        ensureOk(res, "OpenAI text-to-speech");
        const parsed = audioFromSse(typeof res.data === "string" ? res.data : res.text);
        if (!parsed.bytes.length) throw new Error("OpenAI returned no audio");
        bytes = parsed.bytes;
        words = estimateWordTimings(text);
        timing = "estimated";
      }
      const stored = await putObject(organizationId, companyId, { key: newObjectKey("creative-voiceovers", "mp3"), body: bytes, contentType: "audio/mpeg" });
      if (!stored.ok) throw new Error(`voiceover generated but could not be stored: ${stored.error}`);
      const durationSeconds = words.length ? words[words.length - 1]!.end : text.split(/\s+/).length / WORDS_PER_SECOND;
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider, operation: "voice.tts", units: text.length, unit: "request", estimatedCostMicros: est, status: "SUCCEEDED", meta: { model, voice, characters: text.length } });
      return { audio: stored.data, model, voice, durationSeconds: Number(durationSeconds.toFixed(2)), words, timing, estimatedCostMicros: est };
    } catch (err) {
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider, operation: "voice.tts", units: 0, unit: "request", estimatedCostMicros: 0, status: "FAILED", error: errorText(err), meta: { model, voice } });
      throw err;
    }
  });
}
