import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { CreativeAssetKind } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { checkLimit } from "@/server/modules/entitlements/service";
import { getSignedUrl, newObjectKey, putObject } from "@/server/modules/integrations/services/storage";
import { reviewImage } from "@/server/modules/integrations/services/image-edit";
import { connectedProviders } from "@/server/modules/integrations/services/video-pipeline";
import { IMAGE_PROVIDERS } from "@/server/modules/integrations/services/images";
import { assetMedia } from "@/server/modules/marketing/assets";
import { loadBrandKit } from "@/server/modules/marketing/brand";
import { actorId, authorize, isUuid, json, marketingAssetsById, marketingAssetUrls, toBig, uuid } from "./common";
import { saveVisual } from "./images";
import { paletteReport, samplePng } from "./palette";
import { IMAGE_CATEGORIES, IMAGE_STYLES, PLATFORM_PRESET_KEYS, RENDER_PROVIDERS, SCENE_VIDEO_PROVIDERS, VOICE_PROVIDERS, type PlatformPreset } from "./presets";

/**
 * Studio media library: every studio asset (images and videos in the shared marketing library, plus audio, captions,
 * timelines and export manifests) with folders, tags, search, version history, templates, downloads, brand-consistency
 * checks, usage per campaign and the creative cost panel.
 */

export const ASSET_KINDS = ["IMAGE", "VIDEO", "AUDIO", "CAPTIONS", "TIMELINE", "DOCUMENT"] as const;
const PAGE = 36;

export const libraryFilters = z.object({
  q: z.string().trim().max(200).optional(),
  kind: z.enum(ASSET_KINDS).optional(),
  folderId: uuid.optional(),
  category: z.string().trim().max(40).optional(),
  campaignId: uuid.optional(),
  projectId: uuid.optional(),
  tag: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type LibraryFilters = z.infer<typeof libraryFilters>;
export function parseLibraryFilters(raw: Record<string, string | string[] | undefined>): LibraryFilters {
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v !== undefined && v !== ""));
  const r = libraryFilters.safeParse(flat);
  return r.success ? r.data : { page: 1 };
}

export const uploadInput = z.object({
  name: z.string().trim().min(1).max(160),
  mimeType: z.string().trim().regex(/^(image\/(png|jpeg|webp)|video\/(mp4|quicktime|webm)|audio\/(mpeg|wav|x-wav|aac|mp4|ogg))$/),
  dataBase64: z.string().min(16).max(21_000_000),
  category: z.string().trim().max(40).nullable().optional(),
  folderId: uuid.nullable().optional(),
  campaignId: uuid.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  /** Audio uploads: the person confirms they hold a license (music must be licensed). */
  licenseNote: z.string().trim().max(500).optional(),
});
export const updateAssetInput = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  folderId: uuid.nullable().optional(),
  campaignId: uuid.nullable().optional(),
  category: z.string().trim().max(40).nullable().optional(),
});
export const folderInput = z.object({ name: z.string().trim().min(1).max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional() });
export const templateInput = z.object({
  kind: z.enum(["IMAGE_SET", "VIDEO"]).default("IMAGE_SET"),
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(40),
  preset: z.enum(PLATFORM_PRESET_KEYS as [PlatformPreset, ...PlatformPreset[]]).nullable().optional(),
  style: z.enum(IMAGE_STYLES).nullable().optional(),
  prompt: z.string().trim().min(3).max(3000),
  outline: z.array(z.object({ title: z.string().trim().min(1).max(120), shot: z.string().trim().min(3).max(500), seconds: z.number().min(1).max(30) })).max(20).optional(),
});

async function ownedId(model: "creativeFolder" | "marketingCampaign", organizationId: string, companyId: string, id: string | null | undefined) {
  if (!id) return null;
  if (!isUuid(id)) throw notFound("Record");
  const where = { id, organizationId, companyId };
  const found = model === "creativeFolder" ? await db().creativeFolder.findFirst({ where, select: { id: true } }) : await db().marketingCampaign.findFirst({ where, select: { id: true } });
  if (!found) throw notFound(model === "creativeFolder" ? "Folder" : "Campaign");
  return id;
}

async function withFiles<T extends { marketingAssetId: string | null; storageRef: string | null; url: string | null }>(organizationId: string, companyId: string, rows: T[]) {
  const library = await marketingAssetsById(organizationId, companyId, rows.map((r) => r.marketingAssetId));
  return Promise.all(
    rows.map(async (r) => {
      const m = r.marketingAssetId ? library.get(r.marketingAssetId) : null;
      if (m) return { ...r, file: { ...(await marketingAssetUrls(m)), status: m.status as string } };
      if (r.storageRef) {
        const s = await getSignedUrl(organizationId, companyId, r.storageRef, 3600);
        return { ...r, file: { publicUrl: null, previewUrl: s.ok ? s.data.url : null, status: "READY" } };
      }
      return { ...r, file: r.url ? { publicUrl: r.url, previewUrl: r.url, status: "READY" } : null };
    }),
  );
}

export async function listLibrary(ctx: RequestContext, organizationId: string, companyId: string, f: LibraryFilters = { page: 1 }) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const where: Prisma.CreativeAssetWhereInput = { organizationId, companyId, archivedAt: null };
  if (f.kind) where.kind = f.kind as CreativeAssetKind;
  if (f.folderId) where.folderId = f.folderId;
  if (f.category) where.category = f.category;
  if (f.campaignId) where.campaignId = f.campaignId;
  if (f.projectId) where.projectId = f.projectId;
  if (f.tag) where.tags = { has: f.tag };
  if (f.q) where.OR = [{ name: { contains: f.q, mode: "insensitive" } }, { prompt: { contains: f.q, mode: "insensitive" } }, { tags: { has: f.q } }, { category: { equals: f.q, mode: "insensitive" } }];
  const [total, rows, folders] = await Promise.all([
    db().creativeAsset.count({ where }),
    db().creativeAsset.findMany({ where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * PAGE, take: PAGE }),
    db().creativeFolder.findMany({ where: { organizationId, companyId }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true }, take: 200 }),
  ]);
  const counts = await db().creativeAsset.groupBy({ by: ["folderId"], where: { organizationId, companyId, archivedAt: null, folderId: { not: null } }, _count: { _all: true } });
  const countOf = new Map(counts.map((c) => [c.folderId, c._count._all]));
  return { total, pageSize: PAGE, data: await withFiles(organizationId, companyId, rows), folders: folders.map((x) => ({ ...x, count: countOf.get(x.id) ?? 0 })) };
}

export async function getLibraryAsset(ctx: RequestContext, organizationId: string, companyId: string, assetId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  if (!isUuid(assetId)) throw notFound("Asset");
  const a = await db().creativeAsset.findFirst({ where: { id: assetId, organizationId, companyId } });
  if (!a) throw notFound("Asset");
  const root = a.rootId ?? a.id;
  const versions = await db().creativeAsset.findMany({ where: { organizationId, companyId, OR: [{ id: root }, { rootId: root }] }, orderBy: { version: "asc" } });
  const posts = a.marketingAssetId ? await db().marketingSocialPost.count({ where: { companyId, mediaAssetId: a.marketingAssetId } }) : 0;
  const [asset] = await withFiles(organizationId, companyId, [a]);
  return { asset: asset!, versions: await withFiles(organizationId, companyId, versions), usage: { posts } };
}

/** Signed download URL of any studio asset. */
export async function downloadUrl(ctx: RequestContext, organizationId: string, companyId: string, assetId: string): Promise<string> {
  const { asset } = await getLibraryAsset(ctx, organizationId, companyId, assetId);
  const url = asset.file?.previewUrl ?? asset.file?.publicUrl;
  if (!url) throw notFound("Asset file");
  return url;
}

export async function uploadToLibrary(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof uploadInput>) {
  const input = uploadInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const bytes = Buffer.from(input.dataBase64.replace(/^data:[^,]+,/, ""), "base64");
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw invalid("Files must be up to 15 MB", { reason: "creative_upload_size" });
  const isAudio = input.mimeType.startsWith("audio/");
  if (isAudio && !input.licenseNote) throw invalid("Confirm the license for this music", { reason: "creative_music_license_required" });
  const [folderId, campaignId] = await Promise.all([ownedId("creativeFolder", organizationId, companyId, input.folderId), ownedId("marketingCampaign", organizationId, companyId, input.campaignId)]);
  const ext = input.mimeType.split("/")[1]!.replace("quicktime", "mov").replace("mpeg", "mp3").replace("x-wav", "wav").replace("jpeg", "jpg");
  const stored = await putObject(organizationId, companyId, { key: newObjectKey("creative-uploads", ext), body: new Uint8Array(bytes), contentType: input.mimeType });
  if (!stored.ok) throw conflict(`The file could not be stored: ${stored.error}`, { reason: "creative_storage_failed" });
  if (!isAudio) {
    const saved = await saveVisual(ctx, organizationId, companyId, { stored: stored.data, kind: input.mimeType.startsWith("video/") ? "VIDEO" : "IMAGE", name: input.name, prompt: null, provider: null, model: null, width: null, height: null, preset: null, category: input.category ?? null, costMicros: null, operation: "upload", folderId, campaignId, tags: input.tags });
    return { id: saved.id };
  }
  return transaction(async (tx) => {
    const a = await tx.creativeAsset.create({
      data: { organizationId, companyId, kind: "AUDIO", name: input.name, storageRef: stored.data.ref, mimeType: input.mimeType, sizeBytes: stored.data.size, category: input.category ?? "music", folderId, campaignId, tags: input.tags ?? [], operation: "upload", license: json({ source: "upload", note: input.licenseNote, attestedById: ctx.actor.id, attestedAt: new Date().toISOString() }), createdById: actorId(ctx, organizationId) },
      select: { id: true },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "creative.asset.upload", resourceType: "creative_asset", resourceId: a.id, newValue: { kind: "AUDIO", size: stored.data.size } });
    return { id: a.id };
  });
}

export async function updateLibraryAsset(ctx: RequestContext, organizationId: string, companyId: string, assetId: string, raw: z.input<typeof updateAssetInput>) {
  const input = updateAssetInput.parse(raw);
  if (!isUuid(assetId)) throw notFound("Asset");
  const [folderId, campaignId] = await Promise.all([
    input.folderId === undefined ? undefined : ownedId("creativeFolder", organizationId, companyId, input.folderId),
    input.campaignId === undefined ? undefined : ownedId("marketingCampaign", organizationId, companyId, input.campaignId),
  ]);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const a = await tx.creativeAsset.findFirst({ where: { id: assetId, organizationId, companyId, archivedAt: null }, select: { marketingAssetId: true } });
    if (!a) throw notFound("Asset");
    const data: Prisma.CreativeAssetUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.category !== undefined) data.category = input.category;
    if (folderId !== undefined) data.folderId = folderId;
    if (campaignId !== undefined) data.campaignId = campaignId;
    await tx.creativeAsset.update({ where: { id: assetId }, data });
    if (a.marketingAssetId && (input.name !== undefined || input.tags !== undefined || campaignId !== undefined)) {
      await tx.marketingAsset.updateMany({ where: { id: a.marketingAssetId, companyId }, data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.tags !== undefined ? { tags: input.tags } : {}), ...(campaignId !== undefined ? { campaignId } : {}) } });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "creative.asset.updated", resourceType: "creative_asset", resourceId: assetId, newValue: input });
    return { ok: true };
  });
}

export async function archiveLibraryAsset(ctx: RequestContext, organizationId: string, companyId: string, assetId: string) {
  if (!isUuid(assetId)) throw notFound("Asset");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const a = await tx.creativeAsset.findFirst({ where: { id: assetId, organizationId, companyId, archivedAt: null }, select: { marketingAssetId: true } });
    if (!a) throw notFound("Asset");
    if (a.marketingAssetId) {
      const used = await tx.marketingSocialPost.count({ where: { companyId, mediaAssetId: a.marketingAssetId, status: { in: ["SCHEDULED", "PUBLISHING"] } } });
      if (used) throw conflict("This asset is used by a scheduled post", { reason: "creative_asset_in_use" });
      await tx.marketingAsset.updateMany({ where: { id: a.marketingAssetId, companyId }, data: { archivedAt: new Date() } });
    }
    await tx.creativeAsset.update({ where: { id: assetId }, data: { archivedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "creative.asset.archived", resourceType: "creative_asset", resourceId: assetId });
    return { ok: true };
  });
}

// ───────────── Folders & templates ─────────────

export async function createFolder(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof folderInput>) {
  const input = folderInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    if (await tx.creativeFolder.findFirst({ where: { companyId, name: input.name }, select: { id: true } })) throw conflict("A folder with this name exists", { reason: "creative_folder_taken" });
    const f = await tx.creativeFolder.create({ data: { organizationId, companyId, name: input.name, color: input.color ?? null, createdById: actorId(ctx, organizationId) }, select: { id: true } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "creative.folder.created", resourceType: "creative_folder", resourceId: f.id, newValue: input });
    return f;
  });
}

export async function deleteFolder(ctx: RequestContext, organizationId: string, companyId: string, folderId: string) {
  if (!isUuid(folderId)) throw notFound("Folder");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.creativeFolder.deleteMany({ where: { id: folderId, organizationId, companyId } });
    if (!count) throw notFound("Folder");
    await tx.creativeAsset.updateMany({ where: { companyId, folderId }, data: { folderId: null } });
    await tx.creativeProject.updateMany({ where: { companyId, folderId }, data: { folderId: null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "creative.folder.deleted", resourceType: "creative_folder", resourceId: folderId });
    return { ok: true };
  });
}

export async function listTemplates(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  return db().creativeTemplate.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { updatedAt: "desc" }, take: 100 });
}

export async function createTemplate(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof templateInput>) {
  const input = templateInput.parse(raw);
  if (input.kind === "IMAGE_SET" && !(IMAGE_CATEGORIES as readonly string[]).includes(input.category)) throw invalid("Unknown category", { reason: "creative_template_category" });
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const t = await tx.creativeTemplate.create({ data: { organizationId, companyId, kind: input.kind, name: input.name, category: input.category, preset: input.preset ?? null, style: input.style ?? null, prompt: input.prompt, structure: json(input.outline ? { outline: input.outline } : {}), createdById: actorId(ctx, organizationId) }, select: { id: true } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "creative.template.created", resourceType: "creative_template", resourceId: t.id, newValue: { name: input.name, kind: input.kind } });
    return t;
  });
}

export async function archiveTemplate(ctx: RequestContext, organizationId: string, companyId: string, templateId: string) {
  if (!isUuid(templateId)) throw notFound("Template");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.creativeTemplate.updateMany({ where: { id: templateId, organizationId, companyId, archivedAt: null }, data: { archivedAt: new Date() } });
    if (!count) throw notFound("Template");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "creative.template.archived", resourceType: "creative_template", resourceId: templateId });
    return { ok: true };
  });
}

// ───────────── Brand-consistency check ─────────────

export interface BrandCheck {
  score: number | null;
  palette: ReturnType<typeof paletteReport> | null;
  paletteNote: string | null;
  logo: { checked: boolean; reason?: string; logoVisible?: boolean | null; matchesReference?: boolean | null; textIssues?: string[]; offBrand?: string[] } ;
  checkedAt: string;
  costMicros: number | null;
}

/**
 * Palette: measured from the image pixels (PNG) against the brand kit colors. Logo & text: a vision model compares the
 * image with the brand logo (OpenAI, when connected). Missing inputs are reported, never guessed.
 */
export async function brandCheckAsset(ctx: RequestContext, organizationId: string, companyId: string, assetId: string): Promise<BrandCheck> {
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  if (!isUuid(assetId)) throw notFound("Asset");
  const a = await db().creativeAsset.findFirst({ where: { id: assetId, organizationId, companyId, archivedAt: null } });
  if (!a) throw notFound("Asset");
  if (a.kind !== "IMAGE" || !a.marketingAssetId) throw invalid("Brand checks work on images", { reason: "creative_not_an_image" });
  const kit = await loadBrandKit(db(), companyId);
  if (!kit) throw invalid("Set up the brand kit first", { reason: "creative_no_brand_kit" });
  const media = await assetMedia(companyId, a.marketingAssetId);
  if (!media) throw notFound("Asset file");
  let palette: BrandCheck["palette"] = null;
  let paletteNote: string | null = null;
  if (!kit.colors.length) paletteNote = "no_brand_colors";
  else {
    const pixels = media.mimeType.includes("png") ? samplePng(media.bytes) : null;
    if (!pixels) paletteNote = "format_not_supported";
    else palette = paletteReport(pixels, kit.colors);
  }
  let logo: BrandCheck["logo"] = { checked: false, reason: "no_logo" };
  let costMicros: number | null = null;
  const library = await marketingAssetsById(organizationId, companyId, [a.marketingAssetId]);
  const imageUrl = (await marketingAssetUrls(library.get(a.marketingAssetId)!)).previewUrl;
  if (kit.logoUrl && imageUrl && /^https:\/\//.test(kit.logoUrl)) {
    const r = await reviewImage(organizationId, companyId, {
      imageUrls: [imageUrl, kit.logoUrl],
      question: `Image 1 is a marketing creative for the brand "${kit.brandName}". Image 2 is the brand's official logo. Answer as JSON: {"logoVisible": boolean (is the official logo visible in image 1?), "matchesReference": boolean|null (if a logo is visible, does it match image 2 without distortion or wrong colors? null if none), "textIssues": string[] (misspelled, garbled or illegible text in image 1), "offBrand": string[] (elements clashing with a professional brand: fake logos, watermarks, competitor marks)}.`,
    });
    if (r.ok) {
      const ans = r.data.answer;
      const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 10).map((x) => x.slice(0, 200)) : []);
      logo = { checked: true, logoVisible: typeof ans.logoVisible === "boolean" ? ans.logoVisible : null, matchesReference: typeof ans.matchesReference === "boolean" ? ans.matchesReference : null, textIssues: list(ans.textIssues), offBrand: list(ans.offBrand) };
      costMicros = r.data.estimatedCostMicros;
    } else logo = { checked: false, reason: r.code === "not_connected" ? "vision_not_connected" : "vision_failed" };
  }
  // Score (0–100) from what was measured: palette coverage (60) + clean text/brand elements (40, when checked).
  const parts: { w: number; v: number }[] = [];
  if (palette) parts.push({ w: 60, v: Math.min(1, palette.brandCoverage / 0.6) * (palette.offPalette.length ? 0.8 : 1) });
  if (logo.checked) parts.push({ w: 40, v: (logo.textIssues?.length ? 0.5 : 1) * (logo.offBrand?.length ? 0.6 : 1) * (logo.logoVisible && logo.matchesReference === false ? 0.5 : 1) });
  const weight = parts.reduce((s, x) => s + x.w, 0);
  const score = weight ? Math.round((parts.reduce((s, x) => s + x.w * x.v, 0) / weight) * 100) : null;
  const result: BrandCheck = { score, palette, paletteNote, logo, checkedAt: new Date().toISOString(), costMicros };
  await transaction(async (tx) => {
    await tx.creativeAsset.update({ where: { id: assetId }, data: { brandCheck: json(result), ...(costMicros ? { costMicros: toBig(Number(a.costMicros ?? 0n) + costMicros) } : {}) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "creative.asset.brand_checked", resourceType: "creative_asset", resourceId: assetId, newValue: { score } });
  });
  return result;
}

// ───────────── Campaign usage & costs ─────────────

export async function campaignUsage(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const groups = await db().creativeAsset.groupBy({ by: ["campaignId"], where: { organizationId, companyId, archivedAt: null, campaignId: { not: null } }, _count: { _all: true }, _sum: { costMicros: true } });
  const ids = groups.map((g) => g.campaignId!).filter(Boolean);
  if (!ids.length) return [];
  const [campaigns, assets] = await Promise.all([
    db().marketingCampaign.findMany({ where: { id: { in: ids }, companyId }, select: { id: true, name: true } }),
    db().creativeAsset.findMany({ where: { organizationId, companyId, archivedAt: null, campaignId: { in: ids }, marketingAssetId: { not: null } }, select: { campaignId: true, marketingAssetId: true } }),
  ]);
  const posts = await db().marketingSocialPost.groupBy({ by: ["mediaAssetId"], where: { companyId, mediaAssetId: { in: assets.map((a) => a.marketingAssetId!) } }, _count: { _all: true } });
  const postsByAsset = new Map(posts.map((p) => [p.mediaAssetId, p._count._all]));
  const name = new Map(campaigns.map((c) => [c.id, c.name]));
  return groups
    .map((g) => ({
      campaignId: g.campaignId!,
      name: name.get(g.campaignId!) ?? "—",
      assets: g._count._all,
      costMicros: g._sum.costMicros ?? null,
      posts: assets.filter((a) => a.campaignId === g.campaignId).reduce((s, a) => s + (postsByAsset.get(a.marketingAssetId) ?? 0), 0),
    }))
    .sort((a, b) => b.assets - a.assets);
}

/** Creative spend (estimates) over a window + plan meters + which providers are connected. */
export async function studioOverview(ctx: RequestContext, organizationId: string, companyId: string, days = 30) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const since = new Date(Date.now() - days * 86_400_000);
  const [byProvider, byStep, counts, image, video, content, connected] = await Promise.all([
    db().creativeAsset.groupBy({ by: ["provider"], where: { organizationId, companyId, createdAt: { gte: since }, costMicros: { not: null } }, _sum: { costMicros: true }, _count: { _all: true } }),
    db().creativeStep.groupBy({ by: ["key"], where: { organizationId, companyId, updatedAt: { gte: since }, key: { in: ["research", "concept", "script", "hook", "storyboard", "assembly", "variants"] }, costMicros: { not: null } }, _sum: { costMicros: true } }),
    db().creativeAsset.groupBy({ by: ["kind"], where: { organizationId, companyId, archivedAt: null }, _count: { _all: true } }),
    checkLimit(organizationId, "image.generations.month", 0),
    checkLimit(organizationId, "video.generations.month", 0),
    checkLimit(organizationId, "content.generations.month", 0),
    connectedProviders(organizationId, companyId, [...new Set([...IMAGE_PROVIDERS, ...SCENE_VIDEO_PROVIDERS, ...VOICE_PROVIDERS, ...RENDER_PROVIDERS, "jamendo", "openai", "gemini"])]),
  ]);
  const assetSpend = byProvider.reduce((s, r) => s + (r._sum.costMicros ?? 0n), 0n);
  const stepSpend = byStep.reduce((s, r) => s + (r._sum.costMicros ?? 0n), 0n);
  return {
    days,
    spendMicros: assetSpend + stepSpend,
    byProvider: byProvider.map((r) => ({ provider: r.provider ?? "upload", costMicros: r._sum.costMicros ?? 0n, count: r._count._all })).sort((a, b) => Number(b.costMicros - a.costMicros)),
    byStep: byStep.map((r) => ({ step: r.key, costMicros: r._sum.costMicros ?? 0n })),
    counts: Object.fromEntries(counts.map((c) => [c.kind, c._count._all])) as Partial<Record<CreativeAssetKind, number>>,
    meters: { image: { used: image.used, limit: image.limit }, video: { used: video.used, limit: video.limit }, content: { used: content.used, limit: content.limit } },
    connected,
  };
}
