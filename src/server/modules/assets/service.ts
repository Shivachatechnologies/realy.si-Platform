import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { VisualAssetScope } from "@/generated/prisma/enums";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { generateImage, type ImageSize } from "@/server/modules/integrations/services/images";
import { getSignedUrl, newObjectKey, putObject } from "@/server/modules/integrations/services/storage";
import { ASPECT_RATIOS, ASSET_SCOPES, STYLE_PRESETS, type AspectRatio, type AssetScope } from "./presets";

/**
 * Visual asset library. Reads need companies.read; generating, uploading, editing and deleting need brain.manage
 * (company knowledge & brand). Artwork is generated for real through the Integrations image service and stored through
 * the Integrations storage service; nothing is recorded unless a provider returned an image.
 */

const READ = "companies.read";
const MANAGE = "brain.manage";
const uuid = z.string().uuid();
const SIZE_OF: Record<AspectRatio, ImageSize> = { "1:1": "1024x1024", "3:2": "1536x1024", "2:3": "1024x1536" };
const DIMS: Record<AspectRatio, [number, number]> = { "1:1": [1024, 1024], "3:2": [1536, 1024], "2:3": [1024, 1536] };
const UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const UPLOAD_MAX = 8 * 1024 * 1024;

const scopeFields = {
  scopeType: z.enum(ASSET_SCOPES).default("BRAND"),
  scopeId: uuid.nullable().optional(),
};

export const generateInput = z.object({
  prompt: z.string().trim().min(3).max(1500),
  stylePreset: z.enum(STYLE_PRESETS).default("cinematic"),
  aspectRatio: z.enum(ASPECT_RATIOS).default("3:2"),
  count: z.number().int().min(1).max(4).default(1),
  title: z.string().trim().max(160).optional(),
  /** Regenerate / vary an existing asset (its prompt is reused when `prompt` is the same). */
  parentId: uuid.optional(),
  ...scopeFields,
});
export const uploadInput = z.object({
  title: z.string().trim().max(160).optional(),
  contentType: z.enum(UPLOAD_TYPES),
  dataBase64: z.string().min(16).max(Math.ceil((UPLOAD_MAX * 4) / 3) + 8),
  ...scopeFields,
});
export const updateInput = z.object({
  title: z.string().trim().max(160).nullable().optional(),
  /** Move / save the asset to a scope. */
  scopeType: z.enum(ASSET_SCOPES).optional(),
  scopeId: uuid.nullable().optional(),
  /** Make it the scope's chosen artwork (unpins the previous one). */
  pinned: z.boolean().optional(),
});
export const listParams = z.object({
  scopeType: z.enum(ASSET_SCOPES).optional(),
  scopeId: uuid.optional(),
  q: z.string().trim().max(200).optional(),
  cursor: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

const select = {
  id: true,
  scopeType: true,
  scopeId: true,
  kind: true,
  source: true,
  title: true,
  contentType: true,
  sizeBytes: true,
  prompt: true,
  stylePreset: true,
  aspectRatio: true,
  width: true,
  height: true,
  provider: true,
  model: true,
  parentId: true,
  pinned: true,
  createdAt: true,
} satisfies Prisma.VisualAssetSelect;
export type AssetRow = Prisma.VisualAssetGetPayload<{ select: typeof select }>;

/** The scoped record must exist inside the company (ids from the client are never trusted). */
async function assertScope(client: Tx | Db, companyId: string, scopeType: AssetScope, scopeId: string | null | undefined): Promise<string | null> {
  if (scopeType === "BRAND") return null;
  if (!scopeId) throw invalid("A scope record is required", { reason: "assets_scope_required" });
  const where = { id: scopeId, companyId };
  const found =
    scopeType === "DEPARTMENT"
      ? await client.department.findFirst({ where, select: { id: true } })
      : scopeType === "CAMPAIGN"
        ? await client.marketingCampaign.findFirst({ where, select: { id: true } })
        : scopeType === "PROJECT"
          ? await client.project.findFirst({ where, select: { id: true } })
          : scopeType === "AI_EMPLOYEE"
            ? await client.aiEmployee.findFirst({ where, select: { id: true } })
            : await client.graphEntity.findFirst({ where: { ...where, kind: "PRODUCT" }, select: { id: true } });
  if (!found) throw notFound("Scope record");
  return scopeId;
}

export async function listAssets(ctx: RequestContext, organizationId: string, companyId: string, raw: Record<string, unknown> = {}) {
  await requirePermission(ctx, READ, await companyChain(db(), organizationId, companyId));
  const p = listParams.parse(raw);
  const rows = await db().visualAsset.findMany({
    where: {
      organizationId,
      companyId,
      ...(p.scopeType ? { scopeType: p.scopeType } : {}),
      ...(p.scopeId ? { scopeId: p.scopeId } : {}),
      ...(p.q ? { OR: [{ title: { contains: p.q, mode: "insensitive" } }, { prompt: { contains: p.q, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: p.limit + 1,
    ...(p.cursor ? { cursor: { id: p.cursor }, skip: 1 } : {}),
    select,
  });
  const more = rows.length > p.limit;
  const data = more ? rows.slice(0, p.limit) : rows;
  return { data, nextCursor: more ? data[data.length - 1]!.id : null };
}

export async function scopeCounts(ctx: RequestContext, organizationId: string, companyId: string) {
  await requirePermission(ctx, READ, await companyChain(db(), organizationId, companyId));
  const rows = await db().visualAsset.groupBy({ by: ["scopeType"], where: { organizationId, companyId }, _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.scopeType, r._count._all])) as Partial<Record<VisualAssetScope, number>>;
}

export async function getAsset(ctx: RequestContext, organizationId: string, companyId: string, assetId: string) {
  await requirePermission(ctx, READ, await companyChain(db(), organizationId, companyId));
  if (!uuid.safeParse(assetId).success) throw notFound("Asset");
  const a = await db().visualAsset.findFirst({ where: { id: assetId, organizationId, companyId }, select });
  if (!a) throw notFound("Asset");
  return a;
}

/** The scope's artwork for <ScopeArtwork>: the pinned asset, else the newest image; null when none or not allowed. */
export async function scopeArtwork(ctx: RequestContext, organizationId: string, companyId: string, scopeType: AssetScope, scopeId: string | null) {
  const chain = await companyChain(db(), organizationId, companyId);
  if (!(await can(ctx, READ, chain))) return null;
  return db().visualAsset.findFirst({
    where: { organizationId, companyId, scopeType, scopeId: scopeType === "BRAND" ? null : scopeId, kind: "IMAGE" },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    select: { id: true, title: true, prompt: true, aspectRatio: true, width: true, height: true },
  });
}

/** Whether image generation can run: a connected image provider (the service tries OpenAI → Stability → Replicate). */
export async function imageProviderStatus(organizationId: string, companyId: string) {
  const conns = await db().integrationConnection.findMany({
    where: { organizationId, companyId, provider: { in: ["openai", "stability", "replicate"] }, status: { not: "DISCONNECTED" } },
    select: { provider: true, status: true },
  });
  return { connected: conns.map((c) => c.provider), any: conns.length > 0 };
}

function stylePrompt(preset: string, prompt: string, companyName: string) {
  const styles: Record<string, string> = {
    cinematic: "cinematic lighting, volumetric light, shallow depth of field, premium, high detail",
    editorial: "editorial photography, natural light, refined composition, magazine quality",
    isometric: "clean isometric 3D illustration, soft shadows, pastel gradients, minimal",
    abstract: "abstract generative art, flowing gradients, light trails, futuristic, no text",
    blueprint: "technical blueprint, fine linework, dark navy background, glowing cyan lines",
    product: "studio product shot, seamless backdrop, soft box lighting, photorealistic",
    illustration: "modern flat vector illustration, bold shapes, limited palette",
    portrait: "professional avatar portrait, friendly, futuristic AI persona, soft rim light",
  };
  return `${prompt.trim()}. Style: ${styles[preset] ?? styles.cinematic}. For the company "${companyName}". No text, no watermarks, no logos.`;
}

export async function generateAssets(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof generateInput>) {
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, MANAGE, chain);
  const input = generateInput.parse(raw);
  const company = await db().company.findFirst({ where: { id: companyId, organizationId }, select: { name: true } });
  if (!company) throw notFound("Company");
  let parent: { id: string; scopeType: AssetScope; scopeId: string | null } | null = null;
  if (input.parentId) {
    parent = await db().visualAsset.findFirst({ where: { id: input.parentId, organizationId, companyId }, select: { id: true, scopeType: true, scopeId: true } });
    if (!parent) throw notFound("Asset");
  }
  const scopeType = input.scopeType;
  const scopeId = await assertScope(db(), companyId, scopeType, input.scopeId);

  const result = await generateImage(organizationId, companyId, { prompt: stylePrompt(input.stylePreset, input.prompt, company.name), size: SIZE_OF[input.aspectRatio], n: input.count });
  if (!result.ok) {
    if (result.code === "not_connected") throw new AppError("not_configured", result.error, { reason: "assets_image_not_connected" });
    if (result.code === "rate_limited") throw new AppError("rate_limited", result.error, { reason: "assets_provider_rate_limited" });
    if (result.code === "invalid_input") throw invalid(result.error);
    throw new AppError("service_unavailable", result.error, { reason: "assets_provider_failed", provider: result.providerId, providerError: result.error });
  }
  const [w, h] = DIMS[input.aspectRatio];
  return transaction(async (tx) => {
    const created: AssetRow[] = [];
    for (const img of result.data.images) {
      created.push(
        await tx.visualAsset.create({
          data: {
            organizationId,
            companyId,
            scopeType,
            scopeId,
            kind: "IMAGE",
            source: "GENERATED",
            title: input.title ?? null,
            storageRef: img.ref,
            contentType: img.contentType,
            sizeBytes: img.size,
            prompt: input.prompt,
            stylePreset: input.stylePreset,
            aspectRatio: input.aspectRatio,
            width: w,
            height: h,
            provider: result.providerId,
            model: result.data.model,
            parentId: parent?.id ?? null,
            createdById: ctx.actor.id!,
          },
          select,
        }),
      );
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "assets.generated", resourceType: "visual_asset", resourceId: created[0]?.id ?? null, newValue: { count: created.length, scopeType, scopeId, provider: result.providerId, model: result.data.model } });
    return { assets: created, provider: result.providerId, model: result.data.model };
  });
}

export async function uploadAsset(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof uploadInput>) {
  await requirePermission(ctx, MANAGE, await companyChain(db(), organizationId, companyId));
  const input = uploadInput.parse(raw);
  const scopeId = await assertScope(db(), companyId, input.scopeType, input.scopeId);
  const bytes = new Uint8Array(Buffer.from(input.dataBase64, "base64"));
  if (!bytes.byteLength || bytes.byteLength > UPLOAD_MAX) throw new AppError("payload_too_large", "Image too large", { reason: "assets_upload_too_large" });
  if (!sniff(bytes, input.contentType)) throw invalid("File content does not match its type", { reason: "assets_upload_type" });
  const ext = input.contentType === "image/jpeg" ? "jpg" : input.contentType === "image/webp" ? "webp" : "png";
  const stored = await putObject(organizationId, companyId, { key: newObjectKey("visual-assets", ext), body: bytes, contentType: input.contentType });
  if (!stored.ok) throw new AppError("service_unavailable", stored.error, { reason: "assets_storage_failed" });
  return transaction(async (tx) => {
    const a = await tx.visualAsset.create({
      data: { organizationId, companyId, scopeType: input.scopeType, scopeId, kind: "IMAGE", source: "UPLOADED", title: input.title ?? null, storageRef: stored.data.ref, contentType: input.contentType, sizeBytes: bytes.byteLength, aspectRatio: "1:1", createdById: ctx.actor.id! },
      select,
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "assets.uploaded", resourceType: "visual_asset", resourceId: a.id, newValue: { scopeType: a.scopeType, scopeId: a.scopeId, size: a.sizeBytes } });
    return a;
  });
}

/** Magic-byte check for uploads (PNG, JPEG, WebP). */
function sniff(b: Uint8Array, type: (typeof UPLOAD_TYPES)[number]) {
  if (type === "image/png") return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (type === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8;
  return String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP";
}

export async function updateAsset(ctx: RequestContext, organizationId: string, companyId: string, assetId: string, raw: z.input<typeof updateInput>) {
  const input = updateInput.parse(raw);
  if (!uuid.safeParse(assetId).success) throw notFound("Asset");
  return transaction(async (tx) => {
    await requirePermission(ctx, MANAGE, await companyChain(tx, organizationId, companyId), tx);
    const cur = await tx.visualAsset.findFirst({ where: { id: assetId, organizationId, companyId }, select });
    if (!cur) throw notFound("Asset");
    const scopeType = input.scopeType ?? cur.scopeType;
    const scopeId = input.scopeType !== undefined || input.scopeId !== undefined ? await assertScope(tx, companyId, scopeType, input.scopeId ?? (input.scopeType ? null : cur.scopeId)) : cur.scopeId;
    const pinned = input.pinned ?? (scopeType !== cur.scopeType || scopeId !== cur.scopeId ? false : cur.pinned);
    if (pinned) await tx.visualAsset.updateMany({ where: { organizationId, companyId, scopeType, scopeId, pinned: true, id: { not: assetId } }, data: { pinned: false } });
    const next = await tx.visualAsset.update({
      where: { id: assetId },
      data: { ...(input.title !== undefined ? { title: input.title } : {}), scopeType, scopeId, pinned },
      select,
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "assets.updated", resourceType: "visual_asset", resourceId: assetId, oldValue: { title: cur.title, scopeType: cur.scopeType, scopeId: cur.scopeId, pinned: cur.pinned }, newValue: { title: next.title, scopeType, scopeId, pinned } });
    return next;
  });
}

export async function deleteAsset(ctx: RequestContext, organizationId: string, companyId: string, assetId: string) {
  if (!uuid.safeParse(assetId).success) throw notFound("Asset");
  return transaction(async (tx) => {
    await requirePermission(ctx, MANAGE, await companyChain(tx, organizationId, companyId), tx);
    const cur = await tx.visualAsset.findFirst({ where: { id: assetId, organizationId, companyId }, select: { id: true, storageRef: true, title: true } });
    if (!cur) throw notFound("Asset");
    await tx.visualAsset.updateMany({ where: { companyId, parentId: assetId }, data: { parentId: null } });
    await tx.visualAsset.delete({ where: { id: assetId } });
    // Database-backed bytes go with the last record using them; S3 objects stay in the company's bucket (its lifecycle rules apply).
    const shared = await tx.visualAsset.count({ where: { companyId, storageRef: cur.storageRef } });
    if (!shared && cur.storageRef.startsWith("db:")) await tx.integrationStoredObject.deleteMany({ where: { id: cur.storageRef.slice(3), companyId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "assets.deleted", resourceType: "visual_asset", resourceId: assetId, oldValue: { title: cur.title } });
    return { ok: true };
  });
}

export const attachInput = z.object({ scopeType: z.enum(ASSET_SCOPES), scopeId: uuid.nullable().optional() });

/**
 * Use an existing asset for another scope (AssetPicker): the scope gets its own pinned record pointing at the same
 * stored file (parent = the original), so the original keeps its own scope.
 */
export async function attachAsset(ctx: RequestContext, organizationId: string, companyId: string, assetId: string, raw: z.input<typeof attachInput>) {
  const input = attachInput.parse(raw);
  if (!uuid.safeParse(assetId).success) throw notFound("Asset");
  return transaction(async (tx) => {
    await requirePermission(ctx, MANAGE, await companyChain(tx, organizationId, companyId), tx);
    const src = await tx.visualAsset.findFirst({ where: { id: assetId, organizationId, companyId } });
    if (!src) throw notFound("Asset");
    const scopeId = await assertScope(tx, companyId, input.scopeType, input.scopeId);
    await tx.visualAsset.updateMany({ where: { organizationId, companyId, scopeType: input.scopeType, scopeId, pinned: true }, data: { pinned: false } });
    if (src.scopeType === input.scopeType && src.scopeId === scopeId) {
      return tx.visualAsset.update({ where: { id: src.id }, data: { pinned: true }, select });
    }
    const a = await tx.visualAsset.create({
      data: {
        organizationId,
        companyId,
        scopeType: input.scopeType,
        scopeId,
        kind: src.kind,
        source: src.source,
        title: src.title,
        storageRef: src.storageRef,
        contentType: src.contentType,
        sizeBytes: src.sizeBytes,
        prompt: src.prompt,
        stylePreset: src.stylePreset,
        aspectRatio: src.aspectRatio,
        width: src.width,
        height: src.height,
        provider: src.provider,
        model: src.model,
        parentId: src.id,
        pinned: true,
        createdById: ctx.actor.id!,
      },
      select,
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "assets.attached", resourceType: "visual_asset", resourceId: a.id, newValue: { from: src.id, scopeType: input.scopeType, scopeId } });
    return a;
  });
}

/** Bytes of an asset for the same-origin file route (the CSP only allows images from 'self'). */
export async function assetBytes(ctx: RequestContext, organizationId: string, companyId: string, assetId: string): Promise<{ body: Uint8Array; contentType: string; title: string | null }> {
  await requirePermission(ctx, READ, await companyChain(db(), organizationId, companyId));
  if (!uuid.safeParse(assetId).success) throw notFound("Asset");
  const a = await db().visualAsset.findFirst({ where: { id: assetId, organizationId, companyId }, select: { storageRef: true, contentType: true, title: true } });
  if (!a) throw notFound("Asset");
  if (a.storageRef.startsWith("db:")) {
    const o = await db().integrationStoredObject.findFirst({ where: { id: a.storageRef.slice(3), organizationId, companyId }, select: { data: true, contentType: true } });
    if (!o) throw notFound("Asset file");
    return { body: new Uint8Array(o.data), contentType: o.contentType, title: a.title };
  }
  const signed = await getSignedUrl(organizationId, companyId, a.storageRef, 300);
  if (!signed.ok) throw new AppError("service_unavailable", signed.error, { reason: "assets_storage_failed" });
  const res = await fetch(signed.data.url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new AppError("service_unavailable", `Storage returned ${res.status}`, { reason: "assets_storage_failed" });
  return { body: new Uint8Array(await res.arrayBuffer()), contentType: a.contentType, title: a.title };
}

/** Records the scope picker can attach artwork to (only those the viewer may see). */
export async function scopeOptions(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, READ, chain);
  const [canMk, canAi, canGraph, canProjects] = await Promise.all([can(ctx, "marketing.read", chain), can(ctx, "agents.read", chain), can(ctx, "graph.read", chain), can(ctx, "projects.read", chain)]);
  const where = { organizationId, companyId };
  const [departments, campaigns, projects, aiEmployees, products] = await Promise.all([
    db().department.findMany({ where: { ...where, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 }),
    canMk ? db().marketingCampaign.findMany({ where, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 200 }) : [],
    canProjects ? db().project.findMany({ where, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 200 }) : [],
    canAi ? db().aiEmployee.findMany({ where: { ...where, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 }) : [],
    canGraph ? db().graphEntity.findMany({ where: { ...where, kind: "PRODUCT" }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 }) : [],
  ]);
  return { DEPARTMENT: departments, CAMPAIGN: campaigns, PROJECT: projects, AI_EMPLOYEE: aiEmployees, PRODUCT: products } satisfies Partial<Record<AssetScope, { id: string; name: string }[]>>;
}
