import "server-only";
import { createHmac } from "node:crypto";
import { providerFetch } from "../client";
import { recordUsage } from "../usage";
import { ensureOk, errorText, str, usableConnection, withFallback, type ServiceResult } from "./common";
import { pollVideoJob, startVideoJob } from "./video";

/**
 * Video production adapters for the creative pipeline:
 *  - scene clips: Runway, Replicate (through ./video.ts), Luma Dream Machine and Kling (public REST APIs);
 *  - server-side rendering of an edit timeline: Shotstack and Creatomate render APIs.
 * Every call is asynchronous: start → "<provider>:<id>" job id → poll for the provider's real status. A clip or a render
 * is finished ONLY when the provider reports success with an output URL.
 *
 * Integrations catalog entries needed (owner of catalog.ts/providers.ts): `luma` (api_key, Bearer), `kling` (api_key
 * = secret key + config accessKey; JWT signed here), `shotstack` (api_key, header x-api-key sent here; config
 * environment "v1" | "stage"), `creatomate` (api_key, Bearer). Adapters listed as "awaiting_docs" are not callable.
 */

export type ClipAspect = "9:16" | "1:1" | "16:9";

export const CLIP_ADAPTERS = {
  runway: { status: "implemented" },
  luma: { status: "implemented" },
  kling: { status: "implemented" },
  replicate: { status: "implemented" },
  pika: { status: "awaiting_docs" },
} as const;
export const RENDER_ADAPTERS = { shotstack: { status: "implemented" }, creatomate: { status: "implemented" } } as const;

export const CLIP_PROVIDERS = ["runway", "luma", "kling", "replicate"] as const;
export type ClipProvider = (typeof CLIP_PROVIDERS)[number];
export const RENDER_PROVIDERS = ["shotstack", "creatomate"] as const;
export type RenderProvider = (typeof RENDER_PROVIDERS)[number];

export type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
export interface ProviderJob {
  jobId: string;
  provider: string;
  status: JobStatus;
  outputUrls: string[];
  error: string | null;
  estimatedCostMicros?: number | null;
}

/** Estimates in micro-USD per output second (public list prices at default settings); unknown → null. */
const CLIP_COST_PER_SECOND: Partial<Record<ClipProvider, number>> = { runway: 50_000, luma: 140_000, kling: 70_000 };
const RENDER_COST_PER_SECOND: Partial<Record<RenderProvider, number>> = { shotstack: 5_000 };

const fail = <T>(code: "invalid_input" | "not_connected" | "provider_error", error: string, providerId: string | null = null): ServiceResult<T> => ({
  ok: false,
  code,
  error,
  providerId,
  attempts: providerId ? [{ providerId, outcome: code === "not_connected" ? "not_connected" : "error", error }] : [],
});

// ───────────── Kling auth (JWT HS256 from access key + secret key) ─────────────

const b64url = (v: Buffer | string) => Buffer.from(v).toString("base64url");
function klingJwt(accessKey: string, secretKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 }));
  const sig = createHmac("sha256", secretKey).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
const KLING_HOSTS = new Set(["api-singapore.klingai.com", "api.klingai.com"]);
const klingBase = (config: Record<string, unknown>) => {
  const h = str(config.host) ?? str(config.baseUrl);
  return `https://${h && KLING_HOSTS.has(h) ? h : "api-singapore.klingai.com"}`;
};

// ───────────── Scene clips ─────────────

export interface StartClipInput {
  prompt: string;
  /** First frame (HTTPS URL): image-to-video where the provider supports it. */
  imageUrl?: string | null;
  aspect: ClipAspect;
  seconds?: number;
  providers?: readonly ClipProvider[];
}

const RUNWAY_RATIO: Record<ClipAspect, "720:1280" | "1280:720" | "960:960"> = { "9:16": "720:1280", "16:9": "1280:720", "1:1": "960:960" };

export async function startSceneClip(organizationId: string, companyId: string, input: StartClipInput): Promise<ServiceResult<ProviderJob>> {
  const prompt = input.prompt.replace(/\s+/g, " ").trim().slice(0, 1000);
  if (prompt.length < 3) return fail("invalid_input", "Shot description is empty");
  if (input.imageUrl && !/^https:\/\//.test(input.imageUrl)) return fail("invalid_input", "First frame must be an HTTPS URL");
  const seconds = (input.seconds ?? 5) > 6 ? 10 : 5;

  return withFallback(organizationId, companyId, input.providers ?? CLIP_PROVIDERS, async (conn) => {
    const provider = conn.provider as ClipProvider;
    if (provider === "runway" || provider === "replicate") {
      const r = await startVideoJob(organizationId, companyId, { prompt, imageUrl: input.imageUrl ?? undefined, durationSeconds: seconds, ratio: RUNWAY_RATIO[input.aspect], providers: [provider] });
      if (!r.ok) throw new Error(r.error);
      return { jobId: r.data.jobId, provider, status: "PENDING" as const, outputUrls: [], error: null, estimatedCostMicros: r.data.estimatedCostMicros ?? null };
    }
    const est = CLIP_COST_PER_SECOND[provider] != null ? CLIP_COST_PER_SECOND[provider]! * seconds : null;
    let model = "";
    try {
      let jobId: string;
      if (provider === "luma") {
        model = str(conn.config.model) ?? "ray-2";
        const res = await providerFetch<{ id?: string }>(conn, "https://api.lumalabs.ai/dream-machine/v1/generations", {
          json: { prompt, model, aspect_ratio: input.aspect, duration: `${seconds === 10 ? 9 : 5}s`, resolution: "720p", ...(input.imageUrl ? { keyframes: { frame0: { type: "image", url: input.imageUrl } } } : {}) },
          timeoutMs: 30_000,
          retries: 1,
          costCents: est === null ? undefined : est / 10_000,
        });
        ensureOk(res, "Luma generation");
        if (!res.data?.id) throw new Error("Luma returned no generation id");
        jobId = `luma:${res.data.id}`;
      } else {
        const accessKey = str(conn.config.accessKey);
        if (!accessKey) throw new Error("Kling needs its access key (connection settings)");
        model = str(conn.config.model) ?? "kling-v1-6";
        const kind = input.imageUrl ? "image2video" : "text2video";
        const res = await providerFetch<{ code?: number; message?: string; data?: { task_id?: string } }>(conn, `${klingBase(conn.config)}/v1/videos/${kind}`, {
          json: { model_name: model, prompt, duration: String(seconds), aspect_ratio: input.aspect, mode: "std", ...(input.imageUrl ? { image: input.imageUrl } : {}) },
          noAuth: true,
          headers: { authorization: `Bearer ${klingJwt(accessKey, conn.accessToken)}` },
          timeoutMs: 30_000,
          retries: 1,
          costCents: est === null ? undefined : est / 10_000,
        });
        ensureOk(res, "Kling task");
        if (res.data?.code !== 0 || !res.data.data?.task_id) throw new Error(`Kling rejected the task${res.data?.message ? `: ${res.data.message.slice(0, 160)}` : ""}`);
        jobId = `kling:${kind === "image2video" ? "i" : "t"}:${res.data.data.task_id}`;
      }
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider, operation: "video.start", units: seconds, unit: "second", estimatedCostMicros: est, status: "SUCCEEDED", meta: { model, jobId } });
      return { jobId, provider, status: "PENDING" as const, outputUrls: [], error: null, estimatedCostMicros: est };
    } catch (err) {
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider, operation: "video.start", units: 0, unit: "second", estimatedCostMicros: 0, status: "FAILED", error: errorText(err), meta: { model } });
      throw err;
    }
  });
}

const LUMA_STATUS: Record<string, JobStatus> = { queued: "PENDING", dreaming: "RUNNING", completed: "SUCCEEDED", failed: "FAILED" };
const KLING_STATUS: Record<string, JobStatus> = { submitted: "PENDING", processing: "RUNNING", succeed: "SUCCEEDED", failed: "FAILED" };

export async function pollSceneClip(organizationId: string, companyId: string, jobId: string): Promise<ServiceResult<ProviderJob>> {
  if (/^(runway|replicate):/.test(jobId)) {
    const r = await pollVideoJob(organizationId, companyId, jobId);
    if (!r.ok) return r;
    return { ...r, data: { jobId, provider: r.providerId, status: r.data.status, outputUrls: r.data.outputUrls, error: r.data.error } };
  }
  const m = /^(luma|kling):(?:(t|i):)?([A-Za-z0-9_-]{4,120})$/.exec(jobId);
  if (!m) return fail("invalid_input", "Unknown job id");
  const provider = m[1] as "luma" | "kling";
  const id = m[3]!;
  const conn = await usableConnection(organizationId, companyId, provider);
  if (!conn) return fail("not_connected", `${provider} is not connected`, provider);
  try {
    if (provider === "luma") {
      const res = await providerFetch<{ state?: string; assets?: { video?: string }; failure_reason?: string }>(conn, `https://api.lumalabs.ai/dream-machine/v1/generations/${encodeURIComponent(id)}`, { retries: 2 });
      ensureOk(res, "Luma generation status");
      const d = res.data ?? {};
      const status = LUMA_STATUS[d.state ?? ""] ?? "PENDING";
      return { ok: true, providerId: provider, attempts: [{ providerId: provider, outcome: "ok" }], data: { jobId, provider, status, outputUrls: status === "SUCCEEDED" && d.assets?.video ? [d.assets.video] : [], error: d.failure_reason ?? null } };
    }
    const accessKey = str(conn.config.accessKey);
    if (!accessKey) return fail("not_connected", "Kling needs its access key", provider);
    const kind = m[2] === "i" ? "image2video" : "text2video";
    const res = await providerFetch<{ code?: number; message?: string; data?: { task_status?: string; task_status_msg?: string; task_result?: { videos?: { url?: string }[] } } }>(
      conn,
      `${klingBase(conn.config)}/v1/videos/${kind}/${encodeURIComponent(id)}`,
      { noAuth: true, headers: { authorization: `Bearer ${klingJwt(accessKey, conn.accessToken)}` }, retries: 2 },
    );
    ensureOk(res, "Kling task status");
    const d = res.data?.data ?? {};
    const status = KLING_STATUS[d.task_status ?? ""] ?? "PENDING";
    const urls = (d.task_result?.videos ?? []).map((v) => v.url).filter((u): u is string => !!u);
    return { ok: true, providerId: provider, attempts: [{ providerId: provider, outcome: "ok" }], data: { jobId, provider, status, outputUrls: status === "SUCCEEDED" ? urls : [], error: status === "FAILED" ? (d.task_status_msg ?? "failed") : null } };
  } catch (err) {
    return fail("provider_error", errorText(err), provider);
  }
}

// ───────────── Rendering (edit timeline → finished video) ─────────────

export interface RenderTimeline {
  aspect: ClipAspect;
  width: number;
  height: number;
  /** Visual track, played in order. URLs must be publicly fetchable (signed) for the render provider. */
  clips: { type: "image" | "video"; src: string; start: number; length: number }[];
  voiceover?: { src: string; length: number } | null;
  music?: { src: string; volume: number } | null;
  /** Burned-in captions. */
  captions?: { text: string; start: number; end: number }[];
  duration: number;
}

export async function startRender(organizationId: string, companyId: string, timeline: RenderTimeline, providers: readonly RenderProvider[] = RENDER_PROVIDERS): Promise<ServiceResult<ProviderJob>> {
  if (!timeline.clips.length) return fail("invalid_input", "The timeline has no clips");
  if (timeline.clips.some((c) => !/^https:\/\//.test(c.src))) return fail("invalid_input", "Every clip needs an HTTPS URL");
  return withFallback(organizationId, companyId, providers, async (conn) => {
    const provider = conn.provider as RenderProvider;
    const est = RENDER_COST_PER_SECOND[provider] != null ? Math.round(RENDER_COST_PER_SECOND[provider]! * timeline.duration) : null;
    try {
      let jobId: string;
      if (provider === "shotstack") {
        const env = str(conn.config.environment) === "stage" ? "stage" : "v1";
        const visuals = timeline.clips.map((c) => ({
          asset: c.type === "video" ? { type: "video", src: c.src, volume: 0 } : { type: "image", src: c.src },
          start: Number(c.start.toFixed(3)),
          length: Number(c.length.toFixed(3)),
          fit: "cover",
          ...(c.type === "image" ? { effect: "zoomInSlow" } : {}),
          transition: { in: "fade", out: "fade" },
        }));
        const captions = (timeline.captions ?? []).map((c) => ({ asset: { type: "title", text: c.text, style: "subtitle", size: "small", position: "bottom" }, start: Number(c.start.toFixed(3)), length: Number(Math.max(0.3, c.end - c.start).toFixed(3)) }));
        const tracks = [
          ...(captions.length ? [{ clips: captions }] : []),
          { clips: visuals },
          ...(timeline.voiceover ? [{ clips: [{ asset: { type: "audio", src: timeline.voiceover.src, volume: 1 }, start: 0, length: Number(timeline.voiceover.length.toFixed(3)) }] }] : []),
        ];
        const res = await providerFetch<{ success?: boolean; message?: string; response?: { id?: string } }>(conn, `https://api.shotstack.io/edit/${env}/render`, {
          json: {
            timeline: { background: "#000000", tracks, ...(timeline.music ? { soundtrack: { src: timeline.music.src, effect: "fadeOut", volume: timeline.music.volume } } : {}) },
            output: { format: "mp4", resolution: "hd", aspectRatio: timeline.aspect },
          },
          noAuth: true,
          headers: { "x-api-key": conn.accessToken },
          timeoutMs: 30_000,
          retries: 1,
          costCents: est === null ? undefined : est / 10_000,
        });
        ensureOk(res, "Shotstack render");
        if (!res.data?.response?.id) throw new Error(`Shotstack returned no render id${res.data?.message ? `: ${res.data.message}` : ""}`);
        jobId = `shotstack:${env}:${res.data.response.id}`;
      } else {
        const elements: Record<string, unknown>[] = timeline.clips.map((c) => ({ type: c.type, track: 1, source: c.src, duration: Number(c.length.toFixed(3)), ...(c.type === "video" ? { volume: "0%" } : { animations: [{ type: "scale", start_scale: "100%", end_scale: "110%", easing: "linear" }] }) }));
        if (timeline.voiceover) elements.push({ type: "audio", track: 2, time: 0, source: timeline.voiceover.src });
        if (timeline.music) elements.push({ type: "audio", track: 3, time: 0, duration: Number(timeline.duration.toFixed(3)), source: timeline.music.src, volume: `${Math.round(timeline.music.volume * 100)}%`, audio_fade_out: 2 });
        for (const c of timeline.captions ?? []) {
          elements.push({ type: "text", track: 4, time: Number(c.start.toFixed(3)), duration: Number(Math.max(0.3, c.end - c.start).toFixed(3)), text: c.text, y: "84%", width: "88%", x_alignment: "50%", font_weight: "700", font_size: "6 vmin", fill_color: "#ffffff", stroke_color: "#000000", stroke_width: "1 vmin" });
        }
        const res = await providerFetch<{ id?: string; status?: string }[] | { error?: string }>(conn, "https://api.creatomate.com/v1/renders", {
          json: { source: { output_format: "mp4", width: timeline.width, height: timeline.height, elements } },
          timeoutMs: 30_000,
          retries: 1,
          costCents: est === null ? undefined : est / 10_000,
        });
        ensureOk(res, "Creatomate render");
        const first = Array.isArray(res.data) ? res.data[0] : null;
        if (!first?.id) throw new Error("Creatomate returned no render id");
        jobId = `creatomate:${first.id}`;
      }
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider, operation: "video.render", units: Math.ceil(timeline.duration), unit: "second", estimatedCostMicros: est, status: "SUCCEEDED", meta: { jobId, aspect: timeline.aspect } });
      return { jobId, provider, status: "PENDING" as const, outputUrls: [], error: null, estimatedCostMicros: est };
    } catch (err) {
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider, operation: "video.render", units: 0, unit: "second", estimatedCostMicros: 0, status: "FAILED", error: errorText(err), meta: { aspect: timeline.aspect } });
      throw err;
    }
  });
}

const SHOTSTACK_STATUS: Record<string, JobStatus> = { queued: "PENDING", fetching: "RUNNING", preprocessing: "RUNNING", rendering: "RUNNING", saving: "RUNNING", done: "SUCCEEDED", failed: "FAILED" };
const CREATOMATE_STATUS: Record<string, JobStatus> = { planned: "PENDING", waiting: "PENDING", transcribing: "RUNNING", rendering: "RUNNING", succeeded: "SUCCEEDED", failed: "FAILED" };

export async function pollRender(organizationId: string, companyId: string, jobId: string): Promise<ServiceResult<ProviderJob>> {
  const m = /^(shotstack):(v1|stage):([A-Za-z0-9-]{8,80})$|^(creatomate):([A-Za-z0-9-]{8,80})$/.exec(jobId);
  if (!m) return fail("invalid_input", "Unknown render job id");
  const provider = (m[1] ?? m[4]) as RenderProvider;
  const conn = await usableConnection(organizationId, companyId, provider);
  if (!conn) return fail("not_connected", `${provider} is not connected`, provider);
  try {
    if (provider === "shotstack") {
      const res = await providerFetch<{ response?: { status?: string; url?: string; error?: string } }>(conn, `https://api.shotstack.io/edit/${m[2]}/render/${encodeURIComponent(m[3]!)}`, { noAuth: true, headers: { "x-api-key": conn.accessToken }, retries: 2 });
      ensureOk(res, "Shotstack render status");
      const d = res.data?.response ?? {};
      const status = SHOTSTACK_STATUS[d.status ?? ""] ?? "PENDING";
      return { ok: true, providerId: provider, attempts: [{ providerId: provider, outcome: "ok" }], data: { jobId, provider, status, outputUrls: status === "SUCCEEDED" && d.url ? [d.url] : [], error: status === "FAILED" ? (d.error ?? "render failed") : null } };
    }
    const res = await providerFetch<{ status?: string; url?: string; error_message?: string }>(conn, `https://api.creatomate.com/v1/renders/${encodeURIComponent(m[5]!)}`, { retries: 2 });
    ensureOk(res, "Creatomate render status");
    const d = res.data ?? {};
    const status = CREATOMATE_STATUS[d.status ?? ""] ?? "PENDING";
    return { ok: true, providerId: provider, attempts: [{ providerId: provider, outcome: "ok" }], data: { jobId, provider, status, outputUrls: status === "SUCCEEDED" && d.url ? [d.url] : [], error: status === "FAILED" ? (d.error_message ?? "render failed") : null } };
  } catch (err) {
    return fail("provider_error", errorText(err), provider);
  }
}

/** First connected provider among `keys` (status panels). */
export async function connectedProviders(organizationId: string, companyId: string, keys: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const k of keys) if (await usableConnection(organizationId, companyId, k)) out.push(k);
  return out;
}
