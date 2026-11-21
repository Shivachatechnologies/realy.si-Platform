import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, invalid, notFound } from "@/server/core/errors";
import { toJson } from "@/server/core/json";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { requireAnyPlatform } from "@/server/modules/admin/access";
import { resolveMediaUrls } from "./public";

/**
 * Website media library. Files are stored through the integrations storage service in the platform's own media
 * company (chosen once in Content → Media; its S3 connection when present, else the bounded database fallback), so
 * credentials stay in the integrations module. No media company configured → an honest "set up storage" state.
 */

export const MEDIA_TARGET_KEY = "cms:media";
const targetSchema = z.object({ organizationId: z.string().uuid(), companyId: z.string().uuid() });
const MANAGE = "platform.content.manage";
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/svg+xml"];
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;

export async function mediaTarget() {
  const row = await db().platformSetting.findUnique({ where: { key: MEDIA_TARGET_KEY } });
  const parsed = targetSchema.safeParse(row?.value);
  if (!parsed.success) return null;
  const company = await db().company.findFirst({ where: { id: parsed.data.companyId, organizationId: parsed.data.organizationId }, select: { id: true, name: true, organization: { select: { name: true } } } });
  return company ? { ...parsed.data, companyName: company.name, organizationName: company.organization.name } : null;
}

export async function listMedia(ctx: RequestContext) {
  await requireAnyPlatform(ctx, [MANAGE, "platform.controls.manage"]);
  const [rows, target] = await Promise.all([db().cmsMedia.findMany({ orderBy: { createdAt: "desc" }, take: 200 }), mediaTarget()]);
  const urls = await resolveMediaUrls(rows.map((r) => r.id));
  const storage = target ? await db().integrationConnection.findFirst({ where: { organizationId: target.organizationId, companyId: target.companyId, provider: "s3", status: "CONNECTED" }, select: { id: true } }).catch(() => null) : null;
  return {
    target,
    backend: target ? (storage ? "s3" : "db") : null,
    items: rows.map((r) => ({ id: r.id, ref: `media:${r.id}`, fileName: r.fileName, contentType: r.contentType, size: r.size, alt: r.alt, backend: r.backend, createdAt: r.createdAt, url: urls[`media:${r.id}`] ?? null })),
  };
}

export const mediaTargetInput = z.object({ companyId: z.string().uuid(), reason: z.string().trim().min(3).max(500) });

/** Choose the company whose storage holds website media (platform.content.manage). */
export async function setMediaTarget(ctx: RequestContext, raw: z.input<typeof mediaTargetInput>) {
  const input = mediaTargetInput.parse(raw);
  return transaction(async (tx) => {
    await requirePermission(ctx, MANAGE, platformChain(), tx);
    const company = await tx.company.findUnique({ where: { id: input.companyId }, select: { id: true, organizationId: true, deletedAt: true } });
    if (!company || company.deletedAt) throw notFound("Company");
    const value = toJson({ organizationId: company.organizationId, companyId: company.id }) as Prisma.InputJsonValue;
    await tx.platformSetting.upsert({ where: { key: MEDIA_TARGET_KEY }, create: { key: MEDIA_TARGET_KEY, value, updatedById: ctx.actor.id!, reason: input.reason }, update: { value, updatedById: ctx.actor.id!, reason: input.reason } });
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId: company.organizationId, action: "cms.media_target_set", resourceType: "company", resourceId: company.id, reason: input.reason });
    return { organizationId: company.organizationId, companyId: company.id };
  });
}

export const uploadMediaInput = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().max(100),
  /** Base64 file content. */
  data: z.string().min(4).max(Math.ceil((MEDIA_MAX_BYTES * 4) / 3) + 8),
  alt: z.string().trim().max(200).default(""),
});

export async function uploadMedia(ctx: RequestContext, raw: z.input<typeof uploadMediaInput>) {
  const input = uploadMediaInput.parse(raw);
  await requirePermission(ctx, MANAGE, platformChain());
  if (!ALLOWED_TYPES.includes(input.contentType)) throw invalid("Upload a PNG, JPEG, WebP, GIF, AVIF or SVG image", { reason: "cms_media_type" });
  const body = Buffer.from(input.data, "base64");
  if (!body.length || body.length > MEDIA_MAX_BYTES) throw invalid("Images can be at most 5 MB", { reason: "cms_media_too_large" });
  const target = await mediaTarget();
  if (!target) throw new AppError("not_configured", "Choose where website media is stored first (Content → Media).", { reason: "cms_media_not_configured" });
  const { newObjectKey, putObject } = await import("@/server/modules/integrations/services/storage");
  const ext = (input.fileName.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  const res = await putObject(target.organizationId, target.companyId, { key: newObjectKey("cms-media", ext), body: new Uint8Array(body), contentType: input.contentType });
  if (!res.ok) throw new AppError("service_unavailable", `Storage refused the upload: ${res.error}`, { reason: "cms_media_storage_failed", code: res.code });
  return transaction(async (tx) => {
    const row = await tx.cmsMedia.create({
      data: { organizationId: target.organizationId, companyId: target.companyId, ref: res.data.ref, backend: res.data.backend, fileName: input.fileName, contentType: input.contentType, size: body.length, alt: input.alt, createdById: ctx.actor.id! },
    });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "cms.media_uploaded", resourceType: "cms_media", resourceId: row.id, newValue: { fileName: input.fileName, size: body.length, backend: res.data.backend } });
    return { id: row.id, ref: `media:${row.id}`, url: res.data.url };
  });
}

export async function deleteMedia(ctx: RequestContext, mediaId: string) {
  if (!z.string().uuid().safeParse(mediaId).success) throw notFound("Media");
  return transaction(async (tx) => {
    await requirePermission(ctx, MANAGE, platformChain(), tx);
    const row = await tx.cmsMedia.findUnique({ where: { id: mediaId } });
    if (!row) throw notFound("Media");
    await tx.cmsMedia.delete({ where: { id: mediaId } });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "cms.media_deleted", resourceType: "cms_media", resourceId: mediaId, oldValue: { fileName: row.fileName } });
    return { ok: true };
  });
}

/** Companies an admin can pick as the media store (search by organization or company name). */
export async function mediaCompanyOptions(ctx: RequestContext, q: string) {
  await requirePermission(ctx, MANAGE, platformChain());
  const needle = q.trim().slice(0, 100);
  return db().company.findMany({
    where: { deletedAt: null, ...(needle ? { OR: [{ name: { contains: needle, mode: "insensitive" } }, { organization: { name: { contains: needle, mode: "insensitive" } } }] } : {}) },
    orderBy: { createdAt: "asc" },
    take: 25,
    select: { id: true, name: true, organization: { select: { name: true } } },
  });
}
