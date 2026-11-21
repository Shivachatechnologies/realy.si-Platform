import "server-only";
import { providerFetch } from "../client";
import { FLAT_COST_MICROS, recordUsage } from "../usage";
import { ensureOk, errorText, str, withFallback, type ServiceResult } from "./common";
import type { Transcript, TranscribeInput } from "./elevenlabs";

/**
 * Deepgram adapter: pre-recorded speech to text (/v1/listen). Synchronous for files up to a few minutes; pass
 * `callbackUrl` (the connection's provider-webhook URL) for long files — the result then arrives as a provider event.
 */

const API = "https://api.deepgram.com/v1";

export async function deepgramTranscribe(
  organizationId: string,
  companyId: string,
  input: TranscribeInput & { model?: string; callbackUrl?: string },
): Promise<ServiceResult<Transcript & { requestId: string | null; queued: boolean }>> {
  if (!input.url && !input.audio?.byteLength) return { ok: false, code: "invalid_input", error: "Provide an audio URL or file", providerId: null, attempts: [] };
  if (input.url && !/^https:\/\//.test(input.url)) return { ok: false, code: "invalid_input", error: "Audio URL must be HTTPS", providerId: null, attempts: [] };
  return withFallback(organizationId, companyId, ["deepgram"], async (conn) => {
    const model = (input.model && /^[a-z0-9.-]{2,40}$/.test(input.model) ? input.model : null) ?? str(conn.config.model) ?? "nova-3";
    const qs = new URLSearchParams({ model, smart_format: "true", punctuate: "true" });
    if (input.languageCode && /^[a-z]{2}(-[A-Z]{2})?$/.test(input.languageCode)) qs.set("language", input.languageCode);
    else qs.set("detect_language", "true");
    if (input.diarize) qs.set("diarize", "true");
    if (input.callbackUrl && /^https:\/\//.test(input.callbackUrl)) qs.set("callback", input.callbackUrl);
    try {
      const res = await providerFetch<{
        request_id?: string;
        metadata?: { request_id?: string; duration?: number };
        results?: { channels?: { detected_language?: string; alternatives?: { transcript?: string; words?: { word?: string; punctuated_word?: string; start?: number; end?: number; speaker?: number }[] }[] }[] };
      }>(conn, `${API}/listen?${qs}`, input.url ? { json: { url: input.url }, timeoutMs: 300_000, retries: 1 } : { raw: input.audio!, headers: { "content-type": input.contentType ?? "application/octet-stream" }, timeoutMs: 300_000, retries: 1 });
      ensureOk(res, "Deepgram transcription");
      const requestId = res.data?.metadata?.request_id ?? res.data?.request_id ?? null;
      if (qs.has("callback")) {
        await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "deepgram", operation: "stt.transcribe", units: 0, unit: "second", estimatedCostMicros: null, status: "SUCCEEDED", meta: { model, requestId, queued: true } });
        return { text: "", languageCode: null, durationSeconds: null, words: [], estimatedCostMicros: null, requestId, queued: true };
      }
      const ch = res.data?.results?.channels?.[0];
      const alt = ch?.alternatives?.[0];
      const duration = typeof res.data?.metadata?.duration === "number" ? Math.ceil(res.data.metadata.duration) : null;
      const cost = duration ? FLAT_COST_MICROS["deepgram.stt_second"]! * duration : null;
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "deepgram", operation: "stt.transcribe", units: duration ?? 0, unit: "second", estimatedCostMicros: cost, status: "SUCCEEDED", meta: { model, requestId } });
      return {
        text: alt?.transcript ?? "",
        languageCode: ch?.detected_language ?? input.languageCode ?? null,
        durationSeconds: duration,
        words: (alt?.words ?? []).map((w) => ({ text: w.punctuated_word ?? w.word ?? "", start: w.start ?? 0, end: w.end ?? 0, speaker: typeof w.speaker === "number" ? String(w.speaker) : null })),
        estimatedCostMicros: cost,
        requestId,
        queued: false,
      };
    } catch (err) {
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "deepgram", operation: "stt.transcribe", units: 0, unit: "second", estimatedCostMicros: 0, status: "FAILED", error: errorText(err), meta: { model } });
      throw err;
    }
  });
}
