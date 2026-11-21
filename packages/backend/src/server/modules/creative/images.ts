import "server-only";
import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { assertLimit, recordUsage } from "@/server/modules/entitlements/service";
import { generateImage, IMAGE_PROVIDERS, type ImageSize } from "@/server/modules/integrations/services/images";
import { editImage, upscaleImage } from "@/server/modules/integrations/services/image-edit";
import type { StoredObject } from "@/server/modules/integrations/services/storage";
import { assetMedia } from "@/server/modules/marketing/assets";
import { actorId, authorize, buildImagePrompt, emitCreativeEvent, isUuid, serviceFailure, toBig, uuid } from "./common";
import { CATEGORY_PRESET, IMAGE_CATEGORIES, IMAGE_STYLES, PLATFORM_PRESET_KEYS, PLATFORM_PRESETS, type ImageCategory, type PlatformPreset } from "./presets";

/**
 * Image studio: brand-aware generation (batch variants), regenerate, edit (OpenAI image edits), upscale (Stability)
 * with a version chain per asset. Every image is a real provider output stored through the storage service, saved in
 * the marketing media library (so marketing can publish it) with studio metadata and its estimated cost. Plan metering:
 * `image.generations.month` per output image (+ the API spend cap inside providerFetch).
 */

export const generateImagesInput = z.object({
  prompt: z.string().trim().min(3).max(3000),
  category: z.enum(IMAGE_CATEGORIES).default("social"),
  style: z.enum(IMAGE_STYLES).nullable().optional(),
  preset: z.enum(PLATFORM_PRESET_KEYS as [PlatformPreset, ...PlatformPreset[]]).optional(),
  variants: z.number().int().min(1).max(4).default(1),
  useBrand: z.boolean().default(true),
  textSpace: z.enum(["top", "center", "bottom"]).nullable().optional(),
  provider: z.enum(IMAGE_PROVIDERS).optional(),
  campaignId: uuid.nullable().optional(),
  folderId: uuid.nullable().optional(),
  templateId: uuid.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  name: z.string().trim().max(160).optional(),
});
export const regenerateInput = z.object({ prompt: z.string().trim().min(3).max(3000).optional(), provider: z.enum(IMAGE_PROVIDERS).optional() });
export const editInput = z.object({ instruction: z.string().trim().min(3).max(2000) });

/** Supported generator size closest to a pixel preset. */
export function sizeFor(width: number, height: number): ImageSize {
  const r = width / height;
  return r > 1.2 ? "1536x1024" : r < 0.83 ? "1024x1536" : "1024x1024";
}

async function ownedRef(model: "marketingCampaign" | "creativeFolder" | "creativeTemplate", organizationId: string, companyId: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  if (!isUuid(id)) throw notFound("Record");
  const where = { id, organizationId, companyId };
  const row =
    model === "marketingCampaign"
      ? await db().marketingCampaign.findFirst({ where, select: { id: true } })
      : model === "creativeFolder"
        ? await db().creativeFolder.findFirst({ where, select: { id: true } })
        : await db().creativeTemplate.findFirst({ where, select: { id: true } });
  if (!row) throw notFound(model === "marketingCampaign" ? "Campaign" : model === "creativeFolder" ? "Folder" : "Template");
  return id;
}

export interface SaveVisual {
  stored: StoredObject;
  kind: "IMAGE" | "VIDEO";
  name: string;
  prompt: string | null;
  provider: string | null;
  model: string | null;
  width: number | null;
  height: number | null;
  preset: string | null;
  category: string | null;
  role?: string | null;
  costMicros: number | null;
  operation: string;
  campaignId?: string | null;
  folderId?: string | null;
  templateId?: string | null;
  projectId?: string | null;
  sceneId?: string | null;
  tags?: string[];
  parent?: { id: string; rootId: string | null; version: number } | null;
}

/** Store a produced visual in the marketing library + studio metadata (one transaction). Returns the studio asset id. */
export async function saveVisual(ctx: RequestContext, organizationId: string, companyId: string, v: SaveVisual): Promise<{ id: string; marketingAssetId: string }> {
  return transaction(async (tx) => {
    let version = 1;
    let rootId: string | null = null;
    if (v.parent) {
      rootId = v.parent.rootId ?? v.parent.id;
      const last = await tx.creativeAsset.findFirst({ where: { companyId, OR: [{ id: rootId }, { rootId }] }, orderBy: { version: "desc" }, select: { version: true } });
      version = (last?.version ?? v.parent.version) + 1;
    }
    const m = await tx.marketingAsset.create({
      data: {
        organizationId,
        companyId,
        kind: v.kind,
        status: "READY",
        name: v.name.slice(0, 200),
        mimeType: v.stored.contentType,
        storageRef: v.stored.ref,
        sizeBytes: v.stored.size,
        width: v.width,
        height: v.height,
        preset: v.preset,
        provider: v.provider,
        prompt: v.prompt?.slice(0, 3000) ?? null,
        tags: v.tags ?? [],
        campaignId: v.campaignId ?? null,
        createdById: actorId(ctx, organizationId),
      },
      select: { id: true },
    });
    const a = await tx.creativeAsset.create({
      data: {
        organizationId,
        companyId,
        kind: v.kind,
        name: v.name.slice(0, 200),
        marketingAssetId: m.id,
        mimeType: v.stored.contentType,
        sizeBytes: v.stored.size,
        category: v.category,
        role: v.role ?? null,
        preset: v.preset,
        width: v.width,
        height: v.height,
        prompt: v.prompt?.slice(0, 3000) ?? null,
        provider: v.provider,
        model: v.model,
        tags: v.tags ?? [],
        folderId: v.folderId ?? null,
        projectId: v.projectId ?? null,
        sceneId: v.sceneId ?? null,
        campaignId: v.campaignId ?? null,
        templateId: v.templateId ?? null,
        rootId,
        parentId: v.parent?.id ?? null,
        version,
        operation: v.operation,
        costMicros: toBig(v.costMicros),
        createdById: actorId(ctx, organizationId),
      },
      select: { id: true },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `creative.asset.${v.operation}`, resourceType: "creative_asset", resourceId: a.id, newValue: { kind: v.kind, provider: v.provider, version, costMicros: v.costMicros } });
    await emitCreativeEvent(tx, ctx, "creative.asset_created", { organizationId, companyId, entityType: "creative_asset", entityId: a.id, data: { kind: v.kind, operation: v.operation, provider: v.provider, projectId: v.projectId ?? null } });
    return { id: a.id, marketingAssetId: m.id };
  });
}

/** Generate a batch of on-brand images. Only images a provider returned are saved; plan metering per saved image. */
export async function generateImages(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof generateImagesInput>, extra: { projectId?: string | null; sceneId?: string | null; role?: string | null } = {}) {
  const input = generateImagesInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  await assertLimit(ctx, organizationId, "image.generations.month", input.variants);
  const [campaignId, folderId, templateId] = await Promise.all([
    ownedRef("marketingCampaign", organizationId, companyId, input.campaignId),
    ownedRef("creativeFolder", organizationId, companyId, input.folderId),
    ownedRef("creativeTemplate", organizationId, companyId, input.templateId),
  ]);
  const presetKey: PlatformPreset = input.preset ?? CATEGORY_PRESET[input.category as ImageCategory];
  const preset = PLATFORM_PRESETS[presetKey];
  const { prompt } = await buildImagePrompt(db(), companyId, { prompt: input.prompt, category: input.category, style: input.style ?? null, useBrand: input.useBrand, textSpace: input.textSpace ?? null, aspect: preset.aspect });
  const providers = input.provider ? [input.provider, ...IMAGE_PROVIDERS.filter((p) => p !== input.provider)] : IMAGE_PROVIDERS;
  const r = await generateImage(organizationId, companyId, { prompt, size: sizeFor(preset.width, preset.height), n: input.variants, providers });
  if (!r.ok) throw serviceFailure(r, "Image generation", "creative_image");
  const unit = r.data.estimatedCostMicros === null ? null : r.data.estimatedCostMicros / Math.max(1, r.data.images.length);
  const created: string[] = [];
  const base = input.name || input.prompt.slice(0, 60);
  for (const [i, img] of r.data.images.entries()) {
    const saved = await saveVisual(ctx, organizationId, companyId, {
      stored: img,
      kind: "IMAGE",
      name: r.data.images.length > 1 ? `${base} · ${i + 1}` : base,
      prompt: input.prompt,
      provider: r.providerId,
      model: r.data.model,
      width: preset.width,
      height: preset.height,
      preset: presetKey,
      category: input.category,
      role: extra.role ?? null,
      costMicros: unit,
      operation: input.variants > 1 ? "variant" : "generate",
      campaignId,
      folderId,
      templateId,
      projectId: extra.projectId ?? null,
      sceneId: extra.sceneId ?? null,
      tags: input.tags,
    });
    await recordUsage(organizationId, "image.generations", 1, { companyId, idempotencyKey: saved.id });
    created.push(saved.id);
  }
  return { created, provider: r.providerId, model: r.data.model, estimatedCostMicros: r.data.estimatedCostMicros };
}

async function loadSource(organizationId: string, companyId: string, assetId: string) {
  if (!isUuid(assetId)) throw notFound("Asset");
  const a = await db().creativeAsset.findFirst({ where: { id: assetId, organizationId, companyId, archivedAt: null } });
  if (!a) throw notFound("Asset");
  if (a.kind !== "IMAGE" || !a.marketingAssetId) throw invalid("Only images can be changed this way", { reason: "creative_not_an_image" });
  return a;
}

const nextVersionFields = (a: Awaited<ReturnType<typeof loadSource>>) => ({
  parent: { id: a.id, rootId: a.rootId, version: a.version },
  campaignId: a.campaignId,
  folderId: a.folderId,
  templateId: a.templateId,
  projectId: a.projectId,
  sceneId: a.sceneId,
  tags: a.tags,
  category: a.category,
  role: a.role,
  preset: a.preset,
});

/** New version from the same (or a revised) prompt. */
export async function regenerateImage(ctx: RequestContext, organizationId: string, companyId: string, assetId: string, raw: z.input<typeof regenerateInput>) {
  const input = regenerateInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const a = await loadSource(organizationId, companyId, assetId);
  await assertLimit(ctx, organizationId, "image.generations.month", 1);
  const basePrompt = input.prompt ?? a.prompt ?? a.name;
  const presetKey = (a.preset && a.preset in PLATFORM_PRESETS ? a.preset : "instagram_square") as PlatformPreset;
  const preset = PLATFORM_PRESETS[presetKey];
  const { prompt } = await buildImagePrompt(db(), companyId, { prompt: basePrompt, category: (IMAGE_CATEGORIES as readonly string[]).includes(a.category ?? "") ? (a.category as ImageCategory) : null, aspect: preset.aspect });
  const providers = input.provider ? [input.provider, ...IMAGE_PROVIDERS.filter((p) => p !== input.provider)] : IMAGE_PROVIDERS;
  const r = await generateImage(organizationId, companyId, { prompt, size: sizeFor(preset.width, preset.height), n: 1, providers });
  if (!r.ok) throw serviceFailure(r, "Image generation", "creative_image");
  const img = r.data.images[0]!;
  const saved = await saveVisual(ctx, organizationId, companyId, { ...nextVersionFields(a), stored: img, kind: "IMAGE", name: a.name, prompt: basePrompt, provider: r.providerId, model: r.data.model, width: preset.width, height: preset.height, preset: presetKey, costMicros: r.data.estimatedCostMicros, operation: "regenerate" });
  await recordUsage(organizationId, "image.generations", 1, { companyId, idempotencyKey: saved.id });
  return { id: saved.id, provider: r.providerId };
}

/** Edit an image from an instruction (OpenAI image edits). Not connected → honest credential-required error. */
export async function editStudioImage(ctx: RequestContext, organizationId: string, companyId: string, assetId: string, raw: z.input<typeof editInput>) {
  const input = editInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const a = await loadSource(organizationId, companyId, assetId);
  await assertLimit(ctx, organizationId, "image.generations.month", 1);
  const media = await assetMedia(companyId, a.marketingAssetId!);
  if (!media) throw notFound("Asset file");
  const r = await editImage(organizationId, companyId, { bytes: new Uint8Array(media.bytes), contentType: media.mimeType, prompt: input.instruction, size: sizeFor(a.width ?? 1024, a.height ?? 1024) });
  if (!r.ok) throw serviceFailure(r, "Image edit", "creative_edit");
  const saved = await saveVisual(ctx, organizationId, companyId, { ...nextVersionFields(a), stored: r.data.image, kind: "IMAGE", name: a.name, prompt: `${a.prompt ?? ""}\n[edit] ${input.instruction}`.trim(), provider: r.providerId, model: r.data.model, width: a.width, height: a.height, costMicros: r.data.estimatedCostMicros, operation: "edit" });
  await recordUsage(organizationId, "image.generations", 1, { companyId, idempotencyKey: saved.id });
  return { id: saved.id, provider: r.providerId };
}

/** 4× upscale (Stability fast upscaler). */
export async function upscaleStudioImage(ctx: RequestContext, organizationId: string, companyId: string, assetId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const a = await loadSource(organizationId, companyId, assetId);
  await assertLimit(ctx, organizationId, "image.generations.month", 1);
  const media = await assetMedia(companyId, a.marketingAssetId!);
  if (!media) throw notFound("Asset file");
  const r = await upscaleImage(organizationId, companyId, { bytes: new Uint8Array(media.bytes), contentType: media.mimeType });
  if (!r.ok) throw serviceFailure(r, "Upscale", "creative_upscale");
  const saved = await saveVisual(ctx, organizationId, companyId, { ...nextVersionFields(a), stored: r.data.image, kind: "IMAGE", name: `${a.name} (4×)`, prompt: a.prompt, provider: r.providerId, model: r.data.model, width: null, height: null, costMicros: r.data.estimatedCostMicros, operation: "upscale" });
  await recordUsage(organizationId, "image.generations", 1, { companyId, idempotencyKey: saved.id });
  return { id: saved.id, provider: r.providerId };
}
