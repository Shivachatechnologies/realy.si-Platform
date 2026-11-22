import "server-only";
import { providerFetch } from "../client";
import { FLAT_COST_MICROS, recordUsage } from "../usage";
import { klingBase } from "../providers";
import { ensureOk, errorText, spendBlocked, str, usableConnection, withFallback, type ServiceResult } from "./common";

/**
 * Asynchronous video generation: Runway → Replicate → Luma Dream Machine → Kling. startVideoJob returns a job id "<provider>:<id>"; pollVideoJob
 * reports the provider's real status and output URLs (provider-hosted, short-lived: download them to keep them).
 */

export const VIDEO_PROVIDERS = ["runway", "replicate", "luma", "kling"] as const;

export interface StartVideoInput {
  prompt: string;
  /** Optional first frame (HTTPS URL or data URI); Runway uses image-to-video when given. */
  imageUrl?: string;
  durationSeconds?: 5 | 8 | 10;
  ratio?: "1280:720" | "720:1280" | "960:960";
  /** Model override (Runway model name, or Replicate "owner/name"). */
  model?: string;
  providers?: readonly (typeof VIDEO_PROVIDERS)[number][];
  /** Provider callback URL (the connection's provider-webhook URL) for Luma / Kling completion callbacks. */
  callbackUrl?: string;
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
const LUMA = "https://api.lumalabs.ai/dream-machine/v1";
const ASPECT: Record<string, string> = { "1280:720": "16:9", "720:1280": "9:16", "960:960": "1:1" };

/** Kling answers HTTP 200 with a non-zero `code` on failure. */
function klingOk(res: { ok: boolean; status: number; data: unknown }, what: string) {
  ensureOk(res, what);
  const d = (res.data ?? {}) as { code?: number; message?: string };
  if (typeof d.code === "number" && d.code !== 0) throw new Error(`${what} failed (${d.code}: ${String(d.message ?? "").slice(0, 160)})`);
}

export async function startVideoJob(organizationId: string, companyId: string, input: StartVideoInput): Promise<ServiceResult<VideoJob>> {
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > 1000) return { ok: false, code: "invalid_input", error: prompt ? "Prompt is too long (max 1000)" : "Prompt is empty", providerId: null, attempts: [] };
  if (input.imageUrl && !/^(https:\/\/|data:image\/)/.test(input.imageUrl)) return { ok: false, code: "invalid_input", error: "Image must be an HTTPS URL or data URI", providerId: null, attempts: [] };
  const duration = input.durationSeconds ?? 5;
  const ratio = input.ratio ?? "1280:720";

  const blocked = await spendBlocked(organizationId, companyId);
  if (blocked) return blocked;

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
      } else if (conn.provider === "luma") {
        model = (input.model && /^ray-[a-z0-9.-]{1,20}$/.test(input.model) ? input.model : null) ?? str(conn.config.videoModel) ?? "ray-2";
        const callback = input.callbackUrl && /^https:\/\//.test(input.callbackUrl) ? input.callbackUrl : undefined;
        const res = await providerFetch<{ id?: string }>(conn, `${LUMA}/generations`, {
          json: {
            prompt,
            model,
            aspect_ratio: ASPECT[ratio] ?? "16:9",
            duration: duration >= 8 ? "9s" : "5s",
            resolution: "720p",
            ...(input.imageUrl?.startsWith("https://") ? { keyframes: { frame0: { type: "image", url: input.imageUrl } } } : {}),
            ...(callback ? { callback_url: callback } : {}),
          },
          retries: 1,
          timeoutMs: 30_000,
        });
        ensureOk(res, "Luma generation");
        if (!res.data?.id) throw new Error("Luma returned no generation id");
        id = res.data.id;
      } else if (conn.provider === "kling") {
        model = input.model && /^kling-v[0-9a-z.-]{1,20}$/.test(input.model) ? input.model : "kling-v2-1";
        const callback = input.callbackUrl && /^https:\/\//.test(input.callbackUrl) ? input.callbackUrl : undefined;
        const image = input.imageUrl?.startsWith("https://") ? input.imageUrl : input.imageUrl?.replace(/^data:image\/[a-z]+;base64,/, "");
        const path = image ? "image2video" : "text2video";
        const res = await providerFetch<{ code?: number; message?: string; data?: { task_id?: string } }>(conn, `${klingBase(conn.config)}/v1/videos/${path}`, {
          json: { model_name: model, prompt, duration: duration >= 8 ? "10" : "5", mode: "std", ...(image ? { image } : { aspect_ratio: ASPECT[ratio] ?? "16:9" }), ...(callback ? { callback_url: callback } : {}) },
          retries: 1,
          timeoutMs: 30_000,
        });
        klingOk(res, "Kling task");
        if (!res.data?.data?.task_id) throw new Error("Kling returned no task id");
        // The poll endpoint depends on the task type.
        id = `${path === "image2video" ? "i" : "t"}${res.data.data.task_id}`;
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
      const billed = conn.provider === "luma" ? (duration >= 8 ? 9 : 5) : conn.provider === "kling" ? (duration >= 8 ? 10 : 5) : duration;
      const est = conn.provider === "replicate" ? null : FLAT_COST_MICROS[`${conn.provider}.second`]! * billed;
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
const LUMA_STATUS: Record<string, VideoJobStatus> = { queued: "PENDING", dreaming: "RUNNING", completed: "SUCCEEDED", failed: "FAILED" };
const KLING_STATUS: Record<string, VideoJobStatus> = { submitted: "PENDING", processing: "RUNNING", succeed: "SUCCEEDED", failed: "FAILED" };

export async function pollVideoJob(organizationId: string, companyId: string, jobId: string): Promise<ServiceResult<VideoJob>> {
  const m = /^(runway|replicate|luma|kling):([A-Za-z0-9_-]{4,100})$/.exec(jobId);
  if (!m) return { ok: false, code: "invalid_input", error: "Unknown job id", providerId: null, attempts: [] };
  const [, provider, id] = m as unknown as [string, "runway" | "replicate" | "luma" | "kling", string];
  const conn = await usableConnection(organizationId, companyId, provider);
  if (!conn) return { ok: false, code: "not_connected", error: `${provider} is not connected`, providerId: provider, attempts: [{ providerId: provider, outcome: "not_connected" }] };
  try {
    if (provider === "runway") {
      const res = await providerFetch<{ status?: string; output?: string[]; failure?: string; progress?: number }>(conn, `${RUNWAY}/tasks/${encodeURIComponent(id)}`, { retries: 2 });
      ensureOk(res, "Runway task status");
      const d = res.data ?? {};
      return { ok: true, providerId: provider, attempts: [{ providerId: provider, outcome: "ok" }], data: { jobId, status: RUNWAY_STATUS[d.status ?? ""] ?? "PENDING", outputUrls: d.output ?? [], error: d.failure ?? null, progress: typeof d.progress === "number" ? d.progress : null } };
    }
    if (provider === "luma") {
      const res = await providerFetch<{ state?: string; failure_reason?: string | null; assets?: { video?: string | null } | null }>(conn, `${LUMA}/generations/${encodeURIComponent(id)}`, { retries: 2 });
      ensureOk(res, "Luma generation status");
      const d = res.data ?? {};
      return { ok: true, providerId: provider, attempts: [{ providerId: provider, outcome: "ok" }], data: { jobId, status: LUMA_STATUS[d.state ?? ""] ?? "PENDING", outputUrls: d.assets?.video ? [d.assets.video] : [], error: d.failure_reason ?? null, progress: null } };
    }
    if (provider === "kling") {
      const path = id.startsWith("i") ? "image2video" : "text2video";
      const res = await providerFetch<{ code?: number; message?: string; data?: { task_status?: string; task_status_msg?: string; task_result?: { videos?: { url?: string }[] } } }>(conn, `${klingBase(conn.config)}/v1/videos/${path}/${encodeURIComponent(id.slice(1))}`, { retries: 2 });
      klingOk(res, "Kling task status");
      const d = res.data?.data ?? {};
      const urls = (d.task_result?.videos ?? []).map((v) => v.url).filter((u): u is string => !!u);
      return { ok: true, providerId: provider, attempts: [{ providerId: provider, outcome: "ok" }], data: { jobId, status: KLING_STATUS[d.task_status ?? ""] ?? "PENDING", outputUrls: urls, error: d.task_status === "failed" ? (d.task_status_msg ?? "failed") : null, progress: null } };
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
