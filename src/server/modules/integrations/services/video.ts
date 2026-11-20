import "server-only";
import { providerFetch } from "../client";
import { FLAT_COST_MICROS, recordUsage } from "../usage";
import { ensureOk, errorText, str, usableConnection, withFallback, type ServiceResult } from "./common";

/**
 * Asynchronous video generation: Runway → Replicate. startVideoJob returns a job id "<provider>:<id>"; pollVideoJob
 * reports the provider's real status and output URLs (provider-hosted, short-lived: download them to keep them).
 */

export const VIDEO_PROVIDERS = ["runway", "replicate"] as const;

export interface StartVideoInput {
  prompt: string;
  /** Optional first frame (HTTPS URL or data URI); Runway uses image-to-video when given. */
  imageUrl?: string;
  durationSeconds?: 5 | 8 | 10;
  ratio?: "1280:720" | "720:1280" | "960:960";
  /** Model override (Runway model name, or Replicate "owner/name"). */
  model?: string;
  providers?: readonly (typeof VIDEO_PROVIDERS)[number][];
}

export type VideoJobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";

export interface VideoJob {
  jobId: string;
  status: VideoJobStatus;
  outputUrls: string[];
  error: string | null;
  progress: number | null;
  /** startVideoJob only: estimated cost in micro-USD (same value as its usage record); null when unknown. */
  estimatedCostMicros?: number | null;
}

const RUNWAY = "https://api.dev.runwayml.com/v1";

export async function startVideoJob(organizationId: string, companyId: string, input: StartVideoInput): Promise<ServiceResult<VideoJob>> {
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > 1000) return { ok: false, code: "invalid_input", error: prompt ? "Prompt is too long (max 1000)" : "Prompt is empty", providerId: null, attempts: [] };
  if (input.imageUrl && !/^(https:\/\/|data:image\/)/.test(input.imageUrl)) return { ok: false, code: "invalid_input", error: "Image must be an HTTPS URL or data URI", providerId: null, attempts: [] };
  const duration = input.durationSeconds ?? 5;
  const ratio = input.ratio ?? "1280:720";

  return withFallback(organizationId, companyId, input.providers ?? VIDEO_PROVIDERS, async (conn) => {
    let model = "";
    try {
      let id: string;
      if (conn.provider === "runway") {
        const custom = input.model && /^[a-z0-9._-]{2,40}$/.test(input.model) ? input.model : null;
        const res = input.imageUrl
          ? await providerFetch<{ id?: string }>(conn, `${RUNWAY}/image_to_video`, { json: { model: (model = custom ?? "gen4_turbo"), promptImage: input.imageUrl, promptText: prompt, ratio, duration }, retries: 1, timeoutMs: 30_000 })
          : await providerFetch<{ id?: string }>(conn, `${RUNWAY}/text_to_video`, { json: { model: (model = custom ?? "veo3.1_fast"), promptText: prompt, ratio, duration: duration === 10 ? 8 : duration }, retries: 1, timeoutMs: 30_000 });
        ensureOk(res, "Runway task");
        if (!res.data?.id) throw new Error("Runway returned no task id");
        id = res.data.id;
      } else {
        model = input.model && /^[a-z0-9_.-]{1,64}\/[a-z0-9_.-]{1,64}$/.test(input.model) ? input.model : (str(conn.config.videoModel) ?? "minimax/video-01");
        const res = await providerFetch<{ id?: string }>(conn, `https://api.replicate.com/v1/models/${model}/predictions`, {
          json: { input: { prompt, ...(input.imageUrl ? { first_frame_image: input.imageUrl } : {}) } },
          retries: 1,
          timeoutMs: 30_000,
        });
        ensureOk(res, "Replicate prediction");
        if (!res.data?.id) throw new Error("Replicate returned no prediction id");
        id = res.data.id;
      }
      const est = conn.provider === "runway" ? FLAT_COST_MICROS["runway.second"]! * duration : null;
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: conn.provider, operation: "video.start", units: duration, unit: "second", estimatedCostMicros: est, status: "SUCCEEDED", meta: { model, jobId: id } });
      return { jobId: `${conn.provider}:${id}`, status: "PENDING" as const, outputUrls: [], error: null, progress: null, estimatedCostMicros: est };
    } catch (err) {
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: conn.provider, operation: "video.start", units: 0, unit: "second", estimatedCostMicros: 0, status: "FAILED", error: errorText(err), meta: { model } });
      throw err;
    }
  });
}

const RUNWAY_STATUS: Record<string, VideoJobStatus> = { PENDING: "PENDING", THROTTLED: "PENDING", RUNNING: "RUNNING", SUCCEEDED: "SUCCEEDED", FAILED: "FAILED", CANCELLED: "CANCELED" };
const REPLICATE_STATUS: Record<string, VideoJobStatus> = { starting: "PENDING", processing: "RUNNING", succeeded: "SUCCEEDED", failed: "FAILED", canceled: "CANCELED" };

export async function pollVideoJob(organizationId: string, companyId: string, jobId: string): Promise<ServiceResult<VideoJob>> {
  const m = /^(runway|replicate):([A-Za-z0-9_-]{4,100})$/.exec(jobId);
  if (!m) return { ok: false, code: "invalid_input", error: "Unknown job id", providerId: null, attempts: [] };
  const [, provider, id] = m as unknown as [string, "runway" | "replicate", string];
  const conn = await usableConnection(organizationId, companyId, provider);
  if (!conn) return { ok: false, code: "not_connected", error: `${provider} is not connected`, providerId: provider, attempts: [{ providerId: provider, outcome: "not_connected" }] };
  try {
    if (provider === "runway") {
      const res = await providerFetch<{ status?: string; output?: string[]; failure?: string; progress?: number }>(conn, `${RUNWAY}/tasks/${encodeURIComponent(id)}`, { retries: 2 });
      ensureOk(res, "Runway task status");
      const d = res.data ?? {};
      return { ok: true, providerId: provider, attempts: [{ providerId: provider, outcome: "ok" }], data: { jobId, status: RUNWAY_STATUS[d.status ?? ""] ?? "PENDING", outputUrls: d.output ?? [], error: d.failure ?? null, progress: typeof d.progress === "number" ? d.progress : null } };
    }
    const res = await providerFetch<{ status?: string; output?: string[] | string | null; error?: unknown }>(conn, `https://api.replicate.com/v1/predictions/${encodeURIComponent(id)}`, { retries: 2 });
    ensureOk(res, "Replicate prediction status");
    const d = res.data ?? {};
    const out = Array.isArray(d.output) ? d.output : d.output ? [d.output] : [];
    return { ok: true, providerId: provider, attempts: [{ providerId: provider, outcome: "ok" }], data: { jobId, status: REPLICATE_STATUS[d.status ?? ""] ?? "PENDING", outputUrls: out, error: d.error ? String(d.error).slice(0, 300) : null, progress: null } };
  } catch (err) {
    return { ok: false, code: "provider_error", error: errorText(err), providerId: provider, attempts: [{ providerId: provider, outcome: "error", error: errorText(err) }] };
  }
}
