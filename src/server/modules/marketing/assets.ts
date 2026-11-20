import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { MarketingAssetKind } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { env } from "@/server/core/env";
import { AppError, conflict, invalid, notFound } from "@/server/core/errors";
import { hmacSha256, safeEqual } from "@/server/core/crypto";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { getSignedUrl, newObjectKey, putObject } from "@/server/modules/integrations/services/storage";
import { actorId, authorize, enumParam, isUuid, PAGE_SIZE, pageParam, param, requireOwned, uuid } from "./common";
import { loadBrandKit } from "./brand";
import { generateImage, IMAGE_PROVIDERS, imageConnection, pollVideoJob, startVideoJob, VIDEO_PROVIDERS, videoConnection } from "./providers/generation";
import { download, ProviderError } from "./providers/http";

export const ASSET_KINDS = ["IMAGE", "VIDEO", "LOGO", "DOCUMENT"] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/** Platform dimension presets (pixels). */
export const PRESETS = {
  instagram_square: { width: 1080, height: 1080 },
  instagram_portrait: { width: 1080, height: 1350 },
  story_reel: { width: 1080, height: 1920 },
  linkedin_post: { width: 1200, height: 627 },
  x_post: { width: 1600, height: 900 },
  facebook_post: { width: 1200, height: 630 },
  pinterest_pin: { width: 1000, height: 1500 },
  youtube_thumbnail: { width: 1280, height: 720 },
  blog_featured: { width: 1600, height: 900 },
  ad_square: { width: 1200, height: 1200 },
} as const;
export type PresetKey = keyof typeof PRESETS;
export const PRESET_KEYS = Object.keys(PRESETS) as PresetKey[];

/** Preset for a platform + format (autopilot). */
export function presetFor(platform: string, format: string): PresetKey {
  if (format === "reel" || format === "short" || platform === "TIKTOK") return "story_reel";
  const map: Record<string, PresetKey> = { INSTAGRAM: "instagram_portrait", LINKEDIN: "linkedin_post", X: "x_post", FACEBOOK: "facebook_post", PINTEREST: "pinterest_pin", YOUTUBE: "youtube_thumbnail", THREADS: "instagram_square" };
  return map[platform] ?? "instagram_square";
}

const overlay = z
  .object({
    headline: z.string().trim().max(120).optional(),
    subline: z.string().trim().max(200).optional(),
    position: z.enum(["top", "center", "bottom"]).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  })
  .strict();

export const uploadInput = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(ASSET_KINDS).default("IMAGE"),
  /** base64 file contents (≤ 10 MB) or an https URL to import. */
  dataBase64: z.string().max(14_500_000).optional(),
  url: z.string().trim().url().max(2000).refine((u) => /^https:\/\//i.test(u), "https only").optional(),
  mimeType: z.string().trim().max(100).regex(/^[\w.+-]+\/[\w.+-]+$/).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  campaignId: uuid.or(z.literal("")).nullable().optional(),
});
export const updateAssetInput = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  campaignId: uuid.or(z.literal("")).nullable().optional(),
  overlay: overlay.nullable().optional(),
});
/** Visual style presets appended to creative prompts. */
export const STYLE_PRESETS = {
  photo: "Photorealistic, natural light, shallow depth of field, editorial photography.",
  minimal: "Minimal flat design, generous whitespace, simple geometric shapes, two or three brand colors.",
  illustration: "Modern vector illustration, clean lines, friendly characters, brand palette.",
  bold: "Bold high-contrast graphic, strong typography space, vibrant brand colors, poster style.",
  product: "Studio product shot on a clean background, soft shadows, premium e-commerce look.",
  "3d": "Soft 3D render, clay materials, isometric composition, gentle lighting.",
  lifestyle: "Authentic lifestyle scene with diverse people using the product, candid, warm tones.",
} as const;
export type StyleKey = keyof typeof STYLE_PRESETS;
export const STYLE_KEYS = Object.keys(STYLE_PRESETS) as StyleKey[];

export const generateInput = z.object({
  style: z.enum(STYLE_KEYS as [StyleKey, ...StyleKey[]]).optional(),
  prompt: z.string().trim().min(3).max(3000),
  preset: z.enum(PRESET_KEYS as [PresetKey, ...PresetKey[]]).default("instagram_square"),
  variations: z.number().int().min(1).max(4).default(1),
  campaignId: uuid.or(z.literal("")).nullable().optional(),
  overlay: overlay.optional(),
  provider: z.enum(IMAGE_PROVIDERS).optional(),
  /** Regenerate / vary an existing asset (keeps the link). */
  parentId: uuid.optional(),
  useBrand: z.boolean().default(true),
});
export const videoInput = z.object({
  prompt: z.string().trim().min(3).max(2000),
  imageAssetId: uuid.optional(),
  vertical: z.boolean().default(true),
  seconds: z.number().int().min(4).max(10).optional(),
  campaignId: uuid.or(z.literal("")).nullable().optional(),
  provider: z.enum(VIDEO_PROVIDERS).optional(),
});

// ── Signed public URLs (platforms fetch media from these) ──

const assetKey = () => hmacSha256(Buffer.from(env().REALY_ENCRYPTION_KEY, "base64"), "realy:marketing:asset");
const assetSig = (id: string) => hmacSha256(assetKey(), id).toString("base64url").slice(0, 32);
export const verifyAssetSig = (id: string, sig: string | null) => isUuid(id) && !!sig && safeEqual(sig, assetSig(id));
const ext = (mime: string | null) => (mime?.includes("png") ? "png" : mime?.includes("jpeg") || mime?.includes("jpg") ? "jpg" : mime?.includes("webp") ? "webp" : mime?.includes("mp4") ? "mp4" : mime?.includes("quicktime") ? "mov" : "bin");

/** Public URL of an asset: stable signed Realy URL for stored files (row bytes or storage), else its external URL. */
export function assetPublicUrl(a: { id: string; url: string | null; mimeType: string | null; sizeBytes: number | null; hasData?: boolean; storageRef?: string | null }): string | null {
  if (a.hasData || a.sizeBytes || a.storageRef) return `${env().APP_URL.replace(/\/$/, "")}/api/public/marketing/assets/${a.id}/file.${ext(a.mimeType)}?sig=${assetSig(a.id)}`;
  return a.url;
}

// ── Storage (Integrations storage service: company S3 bucket or the bounded database fallback) ──

const CONTENT_TYPE_RE = /^[a-z]+\/[a-z0-9.+-]{1,100}$/i;

/**
 * Store asset bytes through the Integrations storage service. Returns the storage reference, or null when storage
 * refused the object (e.g. over the database fallback limit without a bucket) — the caller then keeps the bytes on the
 * asset row as before, so nothing is lost.
 */
async function storeAssetBytes(organizationId: string, companyId: string, bytes: Buffer, mimeType: string | null): Promise<string | null> {
  const contentType = mimeType && CONTENT_TYPE_RE.test(mimeType) ? mimeType.toLowerCase() : "application/octet-stream";
  const r = await putObject(organizationId, companyId, { key: newObjectKey("marketing-assets", ext(contentType)), body: new Uint8Array(bytes), contentType });
  if (r.ok) return r.data.ref;
  logger.warn({ companyId, code: r.code }, "marketing asset storage failed; keeping bytes on the asset");
  return null;
}

/** Short-lived signed URL of a storage-backed asset (previews, provider fetches), or null. */
export async function assetSignedUrl(a: { organizationId: string; companyId: string; storageRef: string | null }, expiresSeconds = 3600): Promise<string | null> {
  if (!a.storageRef) return null;
  const r = await getSignedUrl(a.organizationId, a.companyId, a.storageRef, expiresSeconds);
  return r.ok ? r.data.url : null;
}

/**
 * File behind the stable signed public URL (social platforms and CMSs fetch media from it, so it serves the bytes itself
 * on the app's own domain): row bytes for older assets, else the object fetched through a fresh signed storage URL.
 */
export async function publicAssetFile(id: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const a = await db().marketingAsset.findFirst({ where: { id, archivedAt: null, status: "READY" }, select: { organizationId: true, companyId: true, data: true, mimeType: true, storageRef: true } });
  if (!a) return null;
  const mimeType = a.mimeType ?? "application/octet-stream";
  if (a.data) return { bytes: Buffer.from(a.data), mimeType };
  const url = await assetSignedUrl(a, 600);
  const d = url ? await download(url, MAX_VIDEO_BYTES).catch(() => null) : null;
  return d ? { bytes: d.bytes, mimeType } : null;
}

/** Media bytes for uploads that need the file itself (YouTube, CMS featured images). */
export async function assetMedia(companyId: string, id: string): Promise<{ bytes: Buffer; mimeType: string; filename: string; url: string | null } | null> {
  const a = await db().marketingAsset.findFirst({ where: { id, companyId, status: "READY" } });
  if (!a) return null;
  const url = assetPublicUrl({ ...a, hasData: !!a.data });
  if (a.data) return { bytes: Buffer.from(a.data), mimeType: a.mimeType ?? "application/octet-stream", filename: `${a.name}.${ext(a.mimeType)}`, url };
  if (a.storageRef) {
    const signed = await assetSignedUrl(a);
    if (!signed) return null;
    const d = await download(signed, MAX_VIDEO_BYTES);
    return { bytes: d.bytes, mimeType: a.mimeType ?? d.mimeType, filename: `${a.name}.${ext(a.mimeType ?? d.mimeType)}`, url };
  }
  if (a.url) {
    const d = await download(a.url, MAX_VIDEO_BYTES);
    return { ...d, filename: `${a.name}.${ext(d.mimeType)}`, url: a.url };
  }
  return null;
}

const listSelect = {
  id: true,
  kind: true,
  status: true,
  name: true,
  mimeType: true,
  sizeBytes: true,
  url: true,
  width: true,
  height: true,
  preset: true,
  provider: true,
  prompt: true,
  overlay: true,
  tags: true,
  campaignId: true,
  parentId: true,
  error: true,
  storageRef: true,
  organizationId: true,
  companyId: true,
  createdAt: true,
} satisfies Prisma.MarketingAssetSelect;

export interface AssetFilters {
  q?: string;
  kind?: MarketingAssetKind;
  campaignId?: string;
  page: number;
}
export function parseAssetFilters(raw: Record<string, string | string[] | undefined>): AssetFilters {
  const campaignId = param(raw, "campaign");
  return { q: param(raw, "q"), kind: enumParam(raw, "kind", ASSET_KINDS), campaignId: isUuid(campaignId) ? campaignId : undefined, page: pageParam(raw) };
}

export async function listAssets(ctx: RequestContext, organizationId: string, companyId: string, f: AssetFilters = { page: 1 }) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const where: Prisma.MarketingAssetWhereInput = { organizationId, companyId, archivedAt: null };
  if (f.kind) where.kind = f.kind;
  if (f.campaignId) where.campaignId = f.campaignId;
  if (f.q) where.OR = [{ name: { contains: f.q, mode: "insensitive" } }, { prompt: { contains: f.q, mode: "insensitive" } }, { tags: { has: f.q } }];
  const [total, rows] = await Promise.all([
    db().marketingAsset.count({ where }),
    db().marketingAsset.findMany({ where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE, select: listSelect }),
  ]);
  // Previews use a short-lived signed storage URL directly; publicUrl stays the stable signed Realy URL (shareable, downloadable).
  const data = await Promise.all(rows.map(async (a) => ({ ...a, publicUrl: assetPublicUrl(a), previewUrl: (await assetSignedUrl(a)) ?? assetPublicUrl(a) })));
  return { total, pageSize: PAGE_SIZE, data };
}

export async function assetOptions(ctx: RequestContext, organizationId: string, companyId: string, kinds: MarketingAssetKind[] = ["IMAGE", "VIDEO", "LOGO"]) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const rows = await db().marketingAsset.findMany({ where: { organizationId, companyId, archivedAt: null, status: "READY", kind: { in: kinds } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, name: true, kind: true } });
  return rows;
}

export async function creativeStatus(organizationId: string, companyId: string) {
  const [image, video] = await Promise.all([imageConnection(organizationId, companyId), videoConnection(organizationId, companyId)]);
  return { image: image?.provider ?? null, video: video?.provider ?? null };
}

export async function uploadAsset(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof uploadInput>) {
  const input = uploadInput.parse(raw);
  if (!input.dataBase64 && !input.url) throw invalid("Choose a file or a URL", { reason: "marketing_asset_empty" });
  let bytes: Buffer | null = null;
  let mimeType = input.mimeType ?? null;
  if (input.dataBase64) {
    bytes = Buffer.from(input.dataBase64.replace(/^data:[^,]+,/, ""), "base64");
    if (!bytes.length) throw invalid("Empty file", { reason: "marketing_asset_empty" });
    if (bytes.length > MAX_UPLOAD_BYTES) throw invalid("File too large", { reason: "marketing_asset_too_large" });
  } else if (input.url) {
    try {
      const d = await download(input.url, MAX_UPLOAD_BYTES);
      bytes = d.bytes;
      mimeType = mimeType ?? d.mimeType;
    } catch (err) {
      throw invalid("The file could not be downloaded", { reason: err instanceof ProviderError && err.reason === "media_too_large" ? "marketing_asset_too_large" : "marketing_asset_download_failed" });
    }
  }
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const storageRef = bytes ? await storeAssetBytes(organizationId, companyId, bytes, mimeType) : null;
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const a = await tx.marketingAsset.create({
      data: {
        organizationId,
        companyId,
        kind: input.kind,
        name: input.name,
        mimeType,
        storageRef,
        data: bytes && !storageRef ? new Uint8Array(bytes) : null,
        sizeBytes: bytes?.length ?? null,
        url: bytes ? null : (input.url ?? null),
        tags: input.tags ?? [],
        campaignId: await requireOwned(tx, "marketingCampaign", companyId, input.campaignId || null, "Campaign"),
        createdById: actorId(ctx, organizationId),
      },
      select: listSelect,
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.asset.uploaded", resourceType: "marketing_asset", resourceId: a.id, newValue: { name: a.name, kind: a.kind, size: a.sizeBytes } });
    return { ...a, publicUrl: assetPublicUrl(a) };
  });
}

export async function updateAsset(ctx: RequestContext, organizationId: string, companyId: string, assetId: string, raw: z.input<typeof updateAssetInput>) {
  const input = updateAssetInput.parse(raw);
  if (!isUuid(assetId)) throw notFound("Asset");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const data: Prisma.MarketingAssetUncheckedUpdateManyInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.campaignId !== undefined) data.campaignId = await requireOwned(tx, "marketingCampaign", companyId, input.campaignId || null, "Campaign");
    if (input.overlay !== undefined) data.overlay = input.overlay ?? undefined;
    const { count } = await tx.marketingAsset.updateMany({ where: { id: assetId, organizationId, companyId, archivedAt: null }, data });
    if (!count) throw notFound("Asset");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.asset.updated", resourceType: "marketing_asset", resourceId: assetId, newValue: { name: input.name, tags: input.tags } });
    return { ok: true };
  });
}

export async function archiveAsset(ctx: RequestContext, organizationId: string, companyId: string, assetId: string) {
  if (!isUuid(assetId)) throw notFound("Asset");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingAsset.updateMany({ where: { id: assetId, organizationId, companyId, archivedAt: null }, data: { archivedAt: new Date() } });
    if (!count) throw notFound("Asset");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.asset.archived", resourceType: "marketing_asset", resourceId: assetId });
    return { ok: true };
  });
}

/** Brand context for creative prompts: colors, fonts, style and overlay space. */
export async function creativePrompt(companyId: string, prompt: string, ov?: z.infer<typeof overlay> | null, useBrand = true) {
  const kit = useBrand ? await loadBrandKit(db(), companyId) : null;
  const parts = [prompt];
  if (kit) {
    if (kit.colors.length) parts.push(`Use the brand palette: ${kit.colors.map((c) => `${c.name} ${c.hex}`).join(", ")}.`);
    if (kit.voiceTone) parts.push(`Visual mood consistent with the brand voice: ${kit.voiceTone}.`);
    parts.push(`Brand: ${kit.brandName}. Clean, professional composition; no fake logos or misspelled text.`);
  }
  if (ov?.headline) parts.push(`Leave clear negative space at the ${ov.position ?? "top"} for a text overlay; do not render text in the image.`);
  return parts.join(" ").slice(0, 3900);
}

/**
 * Generate creatives through the Integrations image service (OpenAI → Stability → Replicate; the preferred provider
 * first). Only images a provider returned are stored (through the storage service). Without a connected provider this fails with `marketing_image_not_connected`.
 */
export async function generateCreative(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof generateInput>) {
  const input = generateInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const conn = await imageConnection(organizationId, companyId, input.provider);
  if (!conn) throw new AppError("not_configured", "No image generation provider connected", { reason: "marketing_image_not_connected" });
  let parent: { id: string; prompt: string | null } | null = null;
  if (input.parentId) {
    parent = await db().marketingAsset.findFirst({ where: { id: input.parentId, organizationId, companyId }, select: { id: true, prompt: true } });
    if (!parent) throw notFound("Asset");
  }
  const size = PRESETS[input.preset];
  const prompt = await creativePrompt(companyId, input.style ? `${input.prompt} ${STYLE_PRESETS[input.style]}` : input.prompt, input.overlay, input.useBrand);
  const campaignId = await requireOwned(db() as never, "marketingCampaign", companyId, input.campaignId || null, "Campaign");
  const created: { id: string }[] = [];
  const errors: string[] = [];
  for (let i = 0; i < input.variations; i++) {
    try {
      const img = await generateImage(organizationId, companyId, input.variations > 1 ? `${prompt} (variation ${i + 1})` : prompt, size, input.provider);
      if (!img) throw new ProviderError("not_connected");
      const a = await db().marketingAsset.create({
        data: {
          organizationId,
          companyId,
          kind: "IMAGE",
          name: `${input.prompt.slice(0, 60)}${input.variations > 1 ? ` #${i + 1}` : ""}`,
          mimeType: img.mimeType,
          storageRef: img.stored.ref,
          sizeBytes: img.sizeBytes,
          width: size.width,
          height: size.height,
          preset: input.preset,
          provider: img.provider,
          prompt: input.prompt,
          tags: input.style ? [input.style] : [],
          overlay: input.overlay ?? undefined,
          campaignId,
          parentId: parent?.id ?? null,
          createdById: actorId(ctx, organizationId),
        },
        select: { id: true },
      });
      created.push(a);
    } catch (err) {
      errors.push(err instanceof ProviderError ? `${err.reason}${err.message !== err.reason ? `: ${err.message}` : ""}` : "provider_error");
    }
  }
  await transaction((tx) =>
    writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.asset.generated", resourceType: "marketing_asset", resourceId: created[0]?.id ?? companyId, newValue: { provider: conn.provider, created: created.length, errors } }),
  );
  if (!created.length) throw conflict(`The image provider did not return an image (${errors[0] ?? "unknown"})`, { reason: "marketing_generation_failed", detail: errors[0] });
  return { created: created.map((c) => c.id), errors, provider: conn.provider };
}

/** Start a video generation job (Integrations video service: Runway → Replicate); the asset stays PROCESSING until the worker confirms the output. */
export async function startVideo(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof videoInput>) {
  const input = videoInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const conn = await videoConnection(organizationId, companyId, input.provider);
  if (!conn) throw new AppError("not_configured", "No video generation provider connected", { reason: "marketing_video_not_connected" });
  let imageUrl: string | null = null;
  if (input.imageAssetId) {
    const img = await db().marketingAsset.findFirst({ where: { id: input.imageAssetId, organizationId, companyId, kind: { in: ["IMAGE", "LOGO"] }, status: "READY" } });
    if (!img) throw notFound("Asset");
    imageUrl = (await assetSignedUrl(img)) ?? assetPublicUrl({ ...img, hasData: !!img.data });
  }
  const prompt = await creativePrompt(companyId, input.prompt);
  let job;
  try {
    job = await startVideoJob(organizationId, companyId, { prompt, imageUrl, vertical: input.vertical, seconds: input.seconds }, input.provider);
  } catch (err) {
    throw conflict(`The video provider rejected the job (${err instanceof ProviderError ? err.message : "error"})`, { reason: "marketing_generation_failed" });
  }
  if (!job) throw new AppError("not_configured", "No video generation provider connected", { reason: "marketing_video_not_connected" });
  return transaction(async (tx) => {
    const a = await tx.marketingAsset.create({
      data: {
        organizationId,
        companyId,
        kind: "VIDEO",
        status: "PROCESSING",
        name: input.prompt.slice(0, 80),
        provider: job.provider,
        providerJobId: job.jobId,
        prompt: input.prompt,
        preset: input.vertical ? "story_reel" : "youtube_thumbnail",
        campaignId: await requireOwned(tx, "marketingCampaign", companyId, input.campaignId || null, "Campaign"),
        parentId: input.imageAssetId ?? null,
        createdById: actorId(ctx, organizationId),
      },
      select: listSelect,
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.asset.video_started", resourceType: "marketing_asset", resourceId: a.id, newValue: { provider: job.provider, jobId: job.jobId } });
    return a;
  });
}

/** Worker: poll PROCESSING video jobs; store the output (≤ 50 MB through storage, else its URL) only when the provider succeeded. */
export async function processVideoJobs(): Promise<number> {
  const jobs = await db().marketingAsset.findMany({ where: { status: "PROCESSING", providerJobId: { not: null } }, orderBy: { createdAt: "asc" }, take: 10 });
  let done = 0;
  for (const j of jobs) {
    try {
      const s = await pollVideoJob(j.organizationId, j.companyId, j.provider!, j.providerJobId!);
      if (s.status === "processing") {
        if (Date.now() - j.createdAt.getTime() > 6 * 3_600_000) await db().marketingAsset.update({ where: { id: j.id }, data: { status: "FAILED", error: "timeout" } });
        continue;
      }
      if (s.status === "failed") {
        await db().marketingAsset.update({ where: { id: j.id }, data: { status: "FAILED", error: s.error.slice(0, 500) } });
        continue;
      }
      // Keep the output: through the storage service, else (over the storage limit) on the row, else its provider URL.
      let data: Uint8Array<ArrayBuffer> | null = null;
      let storageRef: string | null = null;
      let size: number | null = null;
      let mimeType = "video/mp4";
      try {
        const d = await download(s.url, MAX_VIDEO_BYTES);
        mimeType = d.mimeType.startsWith("video/") ? d.mimeType : mimeType;
        size = d.bytes.length;
        storageRef = await storeAssetBytes(j.organizationId, j.companyId, d.bytes, mimeType);
        if (!storageRef) data = new Uint8Array(d.bytes);
      } catch {
        data = null;
      }
      await db().marketingAsset.update({ where: { id: j.id }, data: { status: "READY", data, storageRef, sizeBytes: size, mimeType, url: size ? null : s.url, error: null } });
      done++;
    } catch (err) {
      logger.warn({ assetId: j.id, reason: err instanceof ProviderError ? err.reason : "error" }, "video job poll failed");
    }
  }
  return done;
}
