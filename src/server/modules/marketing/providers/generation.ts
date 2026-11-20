// Creative generation for marketing goes through the Integrations services: images → generateImage (OpenAI Images →
// Stability → Replicate, stored through the storage service), video → startVideoJob / pollVideoJob (Runway → Replicate).
// Those services keep the request log, rate limits, fallback and usage/cost records; this file adapts them for marketing.
import { db } from "@/server/core/db";
import { FLAT_COST_MICROS } from "@/server/modules/integrations/usage";
import { usableConnection } from "@/server/modules/integrations/services/common";
import { IMAGE_PROVIDERS, generateImage as integrationsGenerateImage, type ImageSize } from "@/server/modules/integrations/services/images";
import type { StoredObject } from "@/server/modules/integrations/services/storage";
import { pollVideoJob as integrationsPollVideoJob, startVideoJob as integrationsStartVideoJob, VIDEO_PROVIDERS } from "@/server/modules/integrations/services/video";
import { ProviderError, serviceError } from "./http";

export { IMAGE_PROVIDERS, VIDEO_PROVIDERS };
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

/** Provider order with the preferred one first. */
function ordered<T extends string>(keys: readonly T[], preferred?: string | null): T[] {
  return preferred && (keys as readonly string[]).includes(preferred) ? [preferred as T, ...keys.filter((k) => k !== preferred)] : [...keys];
}

async function firstConnected<T extends string>(organizationId: string, companyId: string, keys: readonly T[], preferred?: string | null): Promise<{ provider: T } | null> {
  for (const provider of ordered(keys, preferred)) {
    if (await usableConnection(organizationId, companyId, provider)) return { provider };
  }
  return null;
}

export const imageConnection = (o: string, c: string, preferred?: string | null) => firstConnected(o, c, IMAGE_PROVIDERS, preferred);
export const videoConnection = (o: string, c: string, preferred?: string | null) => firstConnected(o, c, VIDEO_PROVIDERS, preferred);

/** Supported image size closest to the requested aspect ratio. */
function imageSize(w: number, h: number): ImageSize {
  const r = w / h;
  return r > 1.2 ? "1536x1024" : r < 0.83 ? "1024x1536" : "1024x1024";
}

export interface GeneratedImage {
  provider: string;
  /** Stored through the Integrations storage service (S3 bucket or database fallback). */
  stored: StoredObject;
  mimeType: string;
  sizeBytes: number;
  /** Estimated cost of the call in micro-USD (from the Integrations usage record); null when unknown. */
  estimatedCostMicros: number | null;
}

/** One generated image, already stored. Null when no image provider is connected; throws ProviderError when all failed. */
export async function generateImage(organizationId: string, companyId: string, prompt: string, size: { width: number; height: number }, preferred?: string | null): Promise<GeneratedImage | null> {
  const r = await integrationsGenerateImage(organizationId, companyId, { prompt: prompt.slice(0, 4000), size: imageSize(size.width, size.height), n: 1, providers: ordered(IMAGE_PROVIDERS, preferred) });
  if (!r.ok) {
    if (r.code === "not_connected") return null;
    throw serviceError(r);
  }
  const stored = r.data.images[0];
  if (!stored) throw new ProviderError("provider_no_output");
  return { provider: r.providerId, stored, mimeType: stored.contentType, sizeBytes: stored.size, estimatedCostMicros: r.data.estimatedCostMicros };
}

// ── Video jobs (asynchronous) ──

export interface VideoJob {
  provider: VideoProvider;
  /** Provider job id (without the provider prefix). */
  jobId: string;
  estimatedCostMicros: number | null;
}
export type VideoJobState = { status: "processing" } | { status: "succeeded"; url: string } | { status: "failed"; error: string };

const duration = (seconds?: number): 5 | 8 | 10 => (seconds && seconds > 8 ? 10 : seconds && seconds > 5 ? 8 : 5);

export async function startVideoJob(organizationId: string, companyId: string, args: { prompt: string; imageUrl?: string | null; vertical: boolean; seconds?: number }, preferred?: string | null): Promise<VideoJob | null> {
  const r = await integrationsStartVideoJob(organizationId, companyId, {
    prompt: args.prompt.slice(0, 1000),
    ...(args.imageUrl ? { imageUrl: args.imageUrl } : {}),
    durationSeconds: duration(args.seconds),
    ratio: args.vertical ? "720:1280" : "1280:720",
    providers: ordered(VIDEO_PROVIDERS, preferred),
  });
  if (!r.ok) {
    if (r.code === "not_connected") return null;
    throw serviceError(r);
  }
  const [provider, ...rest] = r.data.jobId.split(":");
  return { provider: provider as VideoProvider, jobId: rest.join(":"), estimatedCostMicros: r.data.estimatedCostMicros ?? null };
}

/** Provider status of a video job (`jobId` with or without the "<provider>:" prefix). */
export async function pollVideoJob(organizationId: string, companyId: string, provider: string, jobId: string): Promise<VideoJobState> {
  const r = await integrationsPollVideoJob(organizationId, companyId, jobId.includes(":") ? jobId : `${provider}:${jobId}`);
  if (!r.ok) {
    if (r.code === "not_connected" || r.code === "invalid_input") return { status: "failed", error: r.code === "not_connected" ? "not_connected" : r.error };
    throw serviceError(r);
  }
  const d = r.data;
  if (d.status === "SUCCEEDED") {
    const url = d.outputUrls[d.outputUrls.length - 1];
    return url ? { status: "succeeded", url } : { status: "failed", error: "provider_no_output" };
  }
  if (d.status === "FAILED" || d.status === "CANCELED") return { status: "failed", error: (d.error ?? d.status).slice(0, 300) };
  return { status: "processing" };
}

// ── Cost estimates (autopilot budget) ──

/**
 * Expected cost in micro-USD of one generation with `provider`: the average of the company's recent successful
 * Integrations usage records for that operation (real per-call estimates), else the list-price estimate, else null.
 */
export async function expectedCostMicros(organizationId: string, companyId: string, kind: "image" | "video", provider: string, videoSeconds = 5): Promise<number | null> {
  const operation = kind === "image" ? "images.generate" : "video.start";
  const recent = await db().integrationUsage.findMany({
    where: { organizationId, companyId, provider, operation, status: "SUCCEEDED", estimatedCostMicros: { not: null }, units: { gt: 0 } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { estimatedCostMicros: true, units: true },
  });
  if (recent.length) {
    const perUnit = recent.reduce((s, r) => s + r.estimatedCostMicros! / r.units, 0) / recent.length;
    return Math.ceil(perUnit * (kind === "image" ? 1 : videoSeconds));
  }
  if (kind === "image") return FLAT_COST_MICROS[`${provider}.image`] ?? null;
  return provider === "runway" ? (FLAT_COST_MICROS["runway.second"] ?? 0) * videoSeconds : null;
}

/** Micro-USD → minor units (cents) for budget caps, rounded up. */
export const microsToMinor = (micros: number) => Math.ceil(micros / 10_000);
