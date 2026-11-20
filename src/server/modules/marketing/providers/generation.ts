// Uses integrations services when available (generateImage / startVideoJob) — thin adapters until the lead consolidates.
import type { ProviderConnection } from "../connections-bridge";
import { getMarketingConnection, isUsable } from "../connections-bridge";
import { bearer, call, cfg, download, ProviderError, str } from "./http";

type Conn = ProviderConnection & { accessToken: string };

export const IMAGE_PROVIDERS = ["openai", "stability"] as const;
export const VIDEO_PROVIDERS = ["runway", "replicate"] as const;
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

/** Estimated cost per generation in USD cents, used for autopilot budget caps (not a provider invoice). */
export const ESTIMATED_COST_CENTS: Record<ImageProvider | VideoProvider, number> = { openai: 5, stability: 4, runway: 60, replicate: 50 };

export interface GeneratedImage {
  provider: ImageProvider;
  bytes: Buffer;
  mimeType: string;
}

async function firstConnected<T extends string>(organizationId: string, companyId: string, keys: readonly T[], preferred?: string | null) {
  const order = preferred && (keys as readonly string[]).includes(preferred) ? [preferred as T, ...keys.filter((k) => k !== preferred)] : keys;
  for (const provider of order) {
    const conn = await getMarketingConnection(organizationId, companyId, provider);
    if (isUsable(conn)) return { provider, conn };
  }
  return null;
}

export const imageConnection = (o: string, c: string, preferred?: string | null) => firstConnected(o, c, IMAGE_PROVIDERS, preferred);
export const videoConnection = (o: string, c: string, preferred?: string | null) => firstConnected(o, c, VIDEO_PROVIDERS, preferred);

/** OpenAI sizes closest to the requested aspect ratio. */
function openAiSize(w: number, h: number) {
  const r = w / h;
  return r > 1.2 ? "1536x1024" : r < 0.83 ? "1024x1536" : "1024x1024";
}
function stabilityRatio(w: number, h: number) {
  const r = w / h;
  const options: [string, number][] = [["1:1", 1], ["16:9", 16 / 9], ["9:16", 9 / 16], ["4:5", 0.8], ["5:4", 1.25], ["3:2", 1.5], ["2:3", 2 / 3], ["21:9", 21 / 9]];
  return options.reduce((best, o) => (Math.abs(o[1] - r) < Math.abs(best[1] - r) ? o : best))[0];
}

export async function generateImage(organizationId: string, companyId: string, prompt: string, size: { width: number; height: number }, preferred?: string | null): Promise<GeneratedImage | null> {
  const found = await imageConnection(organizationId, companyId, preferred);
  if (!found) return null;
  const { provider, conn } = found;
  if (provider === "openai") {
    const res = await call(
      "https://api.openai.com/v1/images/generations",
      { method: "POST", headers: bearer(conn.accessToken, { "content-type": "application/json" }), body: JSON.stringify({ model: cfg(conn, "imageModel") ?? "gpt-image-1", prompt: prompt.slice(0, 4000), size: openAiSize(size.width, size.height), n: 1 }) },
      120_000,
    );
    const d = (res.json.data as { b64_json?: string; url?: string }[] | undefined)?.[0];
    if (d?.b64_json) return { provider, bytes: Buffer.from(d.b64_json, "base64"), mimeType: "image/png" };
    if (d?.url) return { provider, ...(await download(d.url)) };
    throw new ProviderError("provider_no_output");
  }
  return stabilityImage(conn, prompt, size);
}

async function stabilityImage(conn: Conn, prompt: string, size: { width: number; height: number }): Promise<GeneratedImage> {
  const fd = new FormData();
  fd.set("prompt", prompt.slice(0, 10_000));
  fd.set("aspect_ratio", stabilityRatio(size.width, size.height));
  fd.set("output_format", "png");
  let res: Response;
  try {
    res = await fetch(`https://api.stability.ai/v2beta/stable-image/generate/${cfg(conn, "model") ?? "core"}`, { method: "POST", headers: bearer(conn.accessToken, { accept: "image/*" }), body: fd, signal: AbortSignal.timeout(120_000) });
  } catch {
    throw new ProviderError("provider_unreachable");
  }
  if (res.status === 401 || res.status === 403) throw new ProviderError("provider_unauthorized", `HTTP ${res.status}`);
  if (res.status === 429) throw new ProviderError("provider_rate_limited", "HTTP 429");
  if (!res.ok) throw new ProviderError("provider_rejected", `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { provider: "stability", bytes: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? "image/png" };
}

// ── Video jobs (asynchronous) ──

export interface VideoJob {
  provider: VideoProvider;
  jobId: string;
}
export type VideoJobState = { status: "processing" } | { status: "succeeded"; url: string } | { status: "failed"; error: string };

const RUNWAY = "https://api.dev.runwayml.com/v1";
const runwayHeaders = (c: Conn) => bearer(c.accessToken, { "content-type": "application/json", "x-runway-version": "2024-11-06" });

export async function startVideoJob(organizationId: string, companyId: string, args: { prompt: string; imageUrl?: string | null; vertical: boolean; seconds?: number }, preferred?: string | null): Promise<VideoJob | null> {
  const found = await videoConnection(organizationId, companyId, preferred);
  if (!found) return null;
  const { provider, conn } = found;
  if (provider === "runway") {
    const ratio = args.vertical ? "720:1280" : "1280:720";
    const res = args.imageUrl
      ? await call(`${RUNWAY}/image_to_video`, { method: "POST", headers: runwayHeaders(conn), body: JSON.stringify({ model: cfg(conn, "model") ?? "gen4_turbo", promptImage: args.imageUrl, promptText: args.prompt.slice(0, 1000), ratio, duration: args.seconds && args.seconds > 5 ? 10 : 5 }) })
      : await call(`${RUNWAY}/text_to_video`, { method: "POST", headers: runwayHeaders(conn), body: JSON.stringify({ model: cfg(conn, "textModel") ?? "veo3", promptText: args.prompt.slice(0, 1000), ratio, duration: 8 }) });
    const id = str(res.json.id);
    if (!id) throw new ProviderError("provider_no_id");
    return { provider, jobId: id };
  }
  const model = cfg(conn, "videoModel") ?? "minimax/video-01";
  const res = await call(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: bearer(conn.accessToken, { "content-type": "application/json" }),
    body: JSON.stringify({ input: { prompt: args.prompt.slice(0, 2000), ...(args.imageUrl ? { first_frame_image: args.imageUrl } : {}) } }),
  });
  const id = str(res.json.id);
  if (!id) throw new ProviderError("provider_no_id");
  return { provider, jobId: id };
}

export async function pollVideoJob(organizationId: string, companyId: string, provider: string, jobId: string): Promise<VideoJobState> {
  const conn = await getMarketingConnection(organizationId, companyId, provider);
  if (!isUsable(conn)) return { status: "failed", error: "not_connected" };
  if (provider === "runway") {
    const res = await call(`${RUNWAY}/tasks/${encodeURIComponent(jobId)}`, { headers: runwayHeaders(conn) });
    const status = str(res.json.status);
    if (status === "SUCCEEDED") {
      const url = Array.isArray(res.json.output) ? str(res.json.output[0]) : null;
      return url ? { status: "succeeded", url } : { status: "failed", error: "provider_no_output" };
    }
    if (status === "FAILED" || status === "CANCELLED") return { status: "failed", error: String(res.json.failure ?? status).slice(0, 300) };
    return { status: "processing" };
  }
  const res = await call(`https://api.replicate.com/v1/predictions/${encodeURIComponent(jobId)}`, { headers: bearer(conn.accessToken) });
  const status = str(res.json.status);
  if (status === "succeeded") {
    const out = res.json.output;
    const url = typeof out === "string" ? out : Array.isArray(out) ? str(out[out.length - 1]) : null;
    return url ? { status: "succeeded", url } : { status: "failed", error: "provider_no_output" };
  }
  if (status === "failed" || status === "canceled") return { status: "failed", error: String(res.json.error ?? status).slice(0, 300) };
  return { status: "processing" };
}
