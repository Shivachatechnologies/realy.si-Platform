import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, forbidden, notFound } from "@/server/core/errors";
import { toJson } from "@/server/core/json";
import { writeAudit } from "@/server/modules/audit/service";
import { deleteAsset } from "@/server/modules/assets/service";
import { deleteMedia } from "@/server/modules/cms/media";
import { archiveLibraryAsset } from "@/server/modules/creative/library";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { isUuid, reasonSchema, requireAnyPlatform } from "./access";

/**
 * Files & storage explorer (Admin → Files, stream F) across the file stores that have database records:
 * `integration_stored_objects` (bytes in Postgres), `cms_media` (platform media), `visual_assets` (brand images) and
 * `creative_assets` (Creative Studio library). Metadata only: file contents are never read or returned here.
 *
 * Deletion is a two-person workflow (`file_deletion_requests`): one admin requests with a reason, a different admin
 * holding platform.security.manage approves (the store's own delete service then runs as trusted platform code) or
 * rejects. Creative assets are archived (the tenant's own delete semantics). Everything is audited.
 */

export const FILE_STORES = ["integration_stored_object", "cms_media", "visual_asset", "creative_asset"] as const;
export type FileStore = (typeof FILE_STORES)[number];

/** Same permissions as the `files` console section. */
const READ = ["platform.organizations.read", "platform.security.read", "platform.content.manage"];
const REQUEST = ["platform.security.manage", "platform.content.manage"];
const APPROVE = "platform.security.manage";
export const LARGE_FILE_BYTES = 10 * 1024 * 1024;

export interface FileRow {
  id: string;
  store: FileStore;
  organizationId: string;
  companyId: string;
  name: string;
  contentType: string | null;
  size: number | null;
  status: "stored" | "archived" | "no_file";
  provider: string | null;
  storage: string | null;
  createdAt: Date;
}

const storageKind = (ref: string | null | undefined) => (ref ? (ref.split(":")[0] ?? null) : null);

async function readStore(store: FileStore, where: { org?: string; large?: boolean; cursor?: string; q?: string }, take: number): Promise<FileRow[]> {
  const page = { orderBy: { id: "desc" as const }, take, ...(where.cursor ? { cursor: { id: where.cursor }, skip: 1 } : {}) };
  const org = where.org ? { organizationId: where.org } : {};
  if (store === "integration_stored_object") {
    const rows = await db().integrationStoredObject.findMany({ where: { ...org, ...(where.large ? { size: { gte: LARGE_FILE_BYTES } } : {}), ...(where.q ? { key: { contains: where.q, mode: "insensitive" } } : {}) }, ...page, select: { id: true, organizationId: true, companyId: true, key: true, contentType: true, size: true, createdAt: true } });
    return rows.map((r) => ({ id: r.id, store, organizationId: r.organizationId, companyId: r.companyId, name: r.key, contentType: r.contentType, size: r.size, status: "stored", provider: "postgres", storage: "db", createdAt: r.createdAt }));
  }
  if (store === "cms_media") {
    const rows = await db().cmsMedia.findMany({ where: { ...org, ...(where.large ? { size: { gte: LARGE_FILE_BYTES } } : {}), ...(where.q ? { fileName: { contains: where.q, mode: "insensitive" } } : {}) }, ...page, select: { id: true, organizationId: true, companyId: true, fileName: true, contentType: true, size: true, backend: true, ref: true, createdAt: true } });
    return rows.map((r) => ({ id: r.id, store, organizationId: r.organizationId, companyId: r.companyId, name: r.fileName, contentType: r.contentType, size: r.size, status: "stored", provider: r.backend, storage: storageKind(r.ref), createdAt: r.createdAt }));
  }
  if (store === "visual_asset") {
    const rows = await db().visualAsset.findMany({ where: { ...org, ...(where.large ? { sizeBytes: { gte: LARGE_FILE_BYTES } } : {}), ...(where.q ? { title: { contains: where.q, mode: "insensitive" } } : {}) }, ...page, select: { id: true, organizationId: true, companyId: true, title: true, contentType: true, sizeBytes: true, provider: true, storageRef: true, createdAt: true } });
    return rows.map((r) => ({ id: r.id, store, organizationId: r.organizationId, companyId: r.companyId, name: r.title ?? r.id.slice(0, 8), contentType: r.contentType, size: r.sizeBytes, status: "stored", provider: r.provider, storage: storageKind(r.storageRef), createdAt: r.createdAt }));
  }
  const rows = await db().creativeAsset.findMany({ where: { ...org, ...(where.large ? { sizeBytes: { gte: LARGE_FILE_BYTES } } : {}), ...(where.q ? { name: { contains: where.q, mode: "insensitive" } } : {}) }, ...page, select: { id: true, organizationId: true, companyId: true, name: true, mimeType: true, sizeBytes: true, provider: true, storageRef: true, url: true, archivedAt: true, createdAt: true } });
  return rows.map((r) => ({ id: r.id, store, organizationId: r.organizationId, companyId: r.companyId, name: r.name, contentType: r.mimeType, size: r.sizeBytes, status: r.archivedAt ? "archived" : !r.storageRef && !r.url ? "no_file" : "stored", provider: r.provider, storage: storageKind(r.storageRef) ?? (r.url ? "url" : null), createdAt: r.createdAt }));
}

const fileFilters = z.object({
  store: z.enum(FILE_STORES).default("integration_stored_object").catch("integration_stored_object"),
  org: z.string().uuid().optional().catch(undefined),
  large: z.enum(["1"]).optional().catch(undefined),
  q: z.string().trim().max(120).optional().catch(undefined),
  cursor: z.string().uuid().optional().catch(undefined),
});
export type FileFilters = Partial<Record<keyof z.input<typeof fileFilters>, unknown>>;

/** Totals per store (count, bytes), per-organization bytes (top 15), and the orphan check. */
export async function storageOverview(ctx: RequestContext) {
  await requireAnyPlatform(ctx, READ);
  const [iso, cms, vis, cre, byOrg, orphanCms, noFile, pendingDeletes] = await Promise.all([
    db().integrationStoredObject.aggregate({ _count: { _all: true }, _sum: { size: true } }),
    db().cmsMedia.aggregate({ _count: { _all: true }, _sum: { size: true } }),
    db().visualAsset.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } }),
    db().creativeAsset.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } }),
    db().$queryRaw<{ organization_id: string; bytes: bigint; files: bigint }[]>`
      SELECT organization_id, sum(bytes)::bigint AS bytes, sum(files)::bigint AS files FROM (
        SELECT organization_id, sum(size)::bigint AS bytes, count(*)::bigint AS files FROM integration_stored_objects GROUP BY 1
        UNION ALL SELECT organization_id, sum(size)::bigint, count(*) FROM cms_media GROUP BY 1
        UNION ALL SELECT organization_id, sum(size_bytes)::bigint, count(*) FROM visual_assets GROUP BY 1
        UNION ALL SELECT organization_id, coalesce(sum(size_bytes), 0)::bigint, count(*) FROM creative_assets GROUP BY 1
      ) s GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
    // cms_media has no foreign key: rows whose organization no longer exists are orphans.
    db().$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM cms_media m LEFT JOIN organizations o ON o.id = m.organization_id WHERE o.id IS NULL`,
    db().creativeAsset.count({ where: { storageRef: null, url: null, archivedAt: null } }),
    db().fileDeletionRequest.count({ where: { status: "PENDING" } }),
  ]);
  const orgIds = byOrg.map((b) => b.organization_id);
  const orgs = orgIds.length ? await db().organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [];
  return {
    stores: [
      { store: "integration_stored_object" as FileStore, files: iso._count._all, bytes: iso._sum.size ?? 0 },
      { store: "cms_media" as FileStore, files: cms._count._all, bytes: cms._sum.size ?? 0 },
      { store: "visual_asset" as FileStore, files: vis._count._all, bytes: vis._sum.sizeBytes ?? 0 },
      { store: "creative_asset" as FileStore, files: cre._count._all, bytes: cre._sum.sizeBytes ?? 0 },
    ],
    byOrganization: byOrg.map((b) => ({ organizationId: b.organization_id, organizationName: orgs.find((o) => o.id === b.organization_id)?.name ?? null, bytes: Number(b.bytes), files: Number(b.files) })),
    orphans: { cmsMediaWithoutOrganization: Number(orphanCms[0]?.n ?? 0), creativeWithoutFile: noFile },
    pendingDeletes,
  };
}

/** One store's file records (keyset pages of 50) with organization names and pending deletion requests. */
export async function listFiles(ctx: RequestContext, raw: FileFilters = {}) {
  await requireAnyPlatform(ctx, READ);
  const f = fileFilters.parse(raw);
  const rows = await readStore(f.store, { org: f.org, large: !!f.large, q: f.q, cursor: f.cursor }, 51);
  const more = rows.length > 50;
  const data = more ? rows.slice(0, 50) : rows;
  const [orgs, pending] = await Promise.all([
    data.length ? db().organization.findMany({ where: { id: { in: [...new Set(data.map((r) => r.organizationId))] } }, select: { id: true, name: true } }) : [],
    data.length ? db().fileDeletionRequest.findMany({ where: { store: f.store, fileId: { in: data.map((r) => r.id) }, status: "PENDING" }, select: { fileId: true, id: true } }) : [],
  ]);
  return {
    filters: f,
    data: data.map((r) => ({ ...r, organizationName: orgs.find((o) => o.id === r.organizationId)?.name ?? null, pendingDeletionId: pending.find((p) => p.fileId === r.id)?.id ?? null })),
    nextCursor: more ? data[data.length - 1]!.id : null,
  };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
export const FILE_EXPORT_MAX = 10_000;

/** CSV of file METADATA for one store and filter (no contents, no URLs). platform.data.export (MFA) or security.manage. */
export async function exportFileMetadata(ctx: RequestContext, raw: FileFilters = {}) {
  await requireAnyPlatform(ctx, ["platform.data.export", "platform.security.manage"]);
  const f = fileFilters.parse(raw);
  const rows = await readStore(f.store, { org: f.org, large: !!f.large, q: f.q }, FILE_EXPORT_MAX);
  await transaction((tx) => writeAudit(tx, ctx, { category: "SECURITY", organizationId: f.org ?? null, action: "platform.files_exported", resourceType: "file_store", resourceId: f.store, newValue: { rows: rows.length, filters: { org: f.org ?? null, large: !!f.large, q: f.q ?? null } } }));
  const header = ["store", "id", "organization_id", "company_id", "name", "content_type", "size_bytes", "status", "provider", "storage", "created_at"];
  return [header.join(","), ...rows.map((r) => [r.store, r.id, r.organizationId, r.companyId, r.name, r.contentType, r.size, r.status, r.provider, r.storage, r.createdAt].map(csvCell).join(","))].join("\n") + "\n";
}

async function findFile(store: FileStore, id: string) {
  if (store === "integration_stored_object") return db().integrationStoredObject.findUnique({ where: { id }, select: { id: true, organizationId: true, companyId: true, key: true, size: true, contentType: true } }).then((r) => (r ? { ...r, name: r.key } : null));
  if (store === "cms_media") return db().cmsMedia.findUnique({ where: { id }, select: { id: true, organizationId: true, companyId: true, fileName: true, size: true, contentType: true } }).then((r) => (r ? { ...r, name: r.fileName } : null));
  if (store === "visual_asset") return db().visualAsset.findUnique({ where: { id }, select: { id: true, organizationId: true, companyId: true, title: true, sizeBytes: true, contentType: true } }).then((r) => (r ? { id: r.id, organizationId: r.organizationId, companyId: r.companyId, name: r.title ?? r.id, size: r.sizeBytes, contentType: r.contentType } : null));
  return db().creativeAsset.findUnique({ where: { id }, select: { id: true, organizationId: true, companyId: true, name: true, sizeBytes: true, mimeType: true, archivedAt: true } }).then((r) => (r && !r.archivedAt ? { id: r.id, organizationId: r.organizationId, companyId: r.companyId, name: r.name, size: r.sizeBytes, contentType: r.mimeType } : null));
}

export const deletionRequestInput = z.object({ store: z.enum(FILE_STORES), fileId: z.string().uuid(), reason: reasonSchema });

/** Step 1: request deletion of one file (metadata snapshot kept on the request). */
export async function requestFileDeletion(ctx: RequestContext, raw: z.input<typeof deletionRequestInput>) {
  const input = deletionRequestInput.parse(raw);
  await requireAnyPlatform(ctx, REQUEST);
  if (!ctx.actor.id) throw forbidden("Only people can request deletions");
  const file = await findFile(input.store, input.fileId);
  if (!file) throw notFound("File");
  return transaction(async (tx) => {
    const open = await tx.fileDeletionRequest.findFirst({ where: { store: input.store, fileId: input.fileId, status: "PENDING" }, select: { id: true } });
    if (open) throw conflict("A deletion request for this file is already pending", { requestId: open.id });
    const req = await tx.fileDeletionRequest.create({ data: { store: input.store, fileId: file.id, organizationId: file.organizationId, fileMeta: toJson({ name: file.name, size: file.size, contentType: file.contentType, companyId: file.companyId }), requestedById: ctx.actor.id!, reason: input.reason } });
    await writeAudit(tx, ctx, { category: "SECURITY", organizationId: file.organizationId, action: "platform.file_deletion_requested", resourceType: input.store, resourceId: file.id, newValue: { requestId: req.id, name: file.name, size: file.size }, reason: input.reason });
    return { id: req.id };
  });
}

/** Pending and recent deletion requests (newest first) with requester / decider names. */
export async function listDeletionRequests(ctx: RequestContext, raw: { status?: string } = {}) {
  await requireAnyPlatform(ctx, READ);
  const status = ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "FAILED"].includes(raw.status ?? "") ? raw.status : undefined;
  const rows = await db().fileDeletionRequest.findMany({ where: status ? { status } : {}, orderBy: { id: "desc" }, take: 50 });
  const ids = [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById]).filter((x): x is string => !!x))];
  const users = ids.length ? await db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  return rows.map((r) => ({ ...r, requestedBy: users.find((u) => u.id === r.requestedById) ?? null, decidedBy: users.find((u) => u.id === r.decidedById) ?? null }));
}

export const deletionDecisionInput = z.object({ decision: z.enum(["approve", "reject", "cancel"]), reason: reasonSchema, confirm: z.string().max(100).optional() });
export const DELETE_PHRASE = "DELETE FILE";

/**
 * Step 2: approve (a DIFFERENT admin with platform.security.manage; typed confirmation), reject, or cancel (the
 * requester). Approval runs the store's delete service as trusted platform code, then records the outcome.
 */
export async function decideFileDeletion(ctx: RequestContext, requestId: string, raw: z.input<typeof deletionDecisionInput>) {
  const input = deletionDecisionInput.parse(raw);
  if (!isUuid(requestId)) throw notFound("Deletion request");
  const req = await db().fileDeletionRequest.findUnique({ where: { id: requestId } });
  if (!req) throw notFound("Deletion request");
  if (req.status !== "PENDING") throw conflict("This request was already decided");
  if (input.decision === "cancel") {
    if (req.requestedById !== ctx.actor.id) throw forbidden("Only the requester can cancel a request");
  } else {
    await requirePermission(ctx, APPROVE, platformChain());
    if (req.requestedById === ctx.actor.id) throw forbidden("A different administrator must decide on your request", { reason: "four_eyes_required" });
  }
  if (input.decision === "approve" && (input.confirm ?? "").trim() !== DELETE_PHRASE) throw conflict(`Type ${DELETE_PHRASE} to confirm`, { reason: "confirmation_mismatch" });
  const status = input.decision === "approve" ? "APPROVED" : input.decision === "reject" ? "REJECTED" : "CANCELLED";
  // Claim the request first, so two approvers cannot both run the deletion.
  const claimed = await db().fileDeletionRequest.updateMany({ where: { id: req.id, status: "PENDING" }, data: { status, decidedById: ctx.actor.id, decisionReason: input.reason, decidedAt: new Date() } });
  if (!claimed.count) throw conflict("This request was already decided");
  let error: string | null = null;
  if (input.decision === "approve") {
    try {
      await performDeletion(ctx, req.store as FileStore, req.fileId);
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 300) : "deletion failed";
      await db().fileDeletionRequest.update({ where: { id: req.id }, data: { status: "FAILED", error } });
    }
  }
  await transaction((tx) =>
    writeAudit(tx, ctx, { category: "SECURITY", organizationId: req.organizationId, action: `platform.file_deletion_${input.decision === "approve" ? (error ? "failed" : "approved") : input.decision === "reject" ? "rejected" : "cancelled"}`, resourceType: req.store, resourceId: req.fileId, oldValue: req.fileMeta, newValue: { requestId: req.id, error }, reason: input.reason }),
  );
  if (error) throw conflict(`The file could not be deleted: ${error}`, { reason: "file_delete_failed" });
  return { status };
}

async function performDeletion(ctx: RequestContext, store: FileStore, fileId: string) {
  const sys = { ...systemContext(ctx.requestId), actor: { type: "SYSTEM" as const, id: ctx.actor.id } };
  if (store === "cms_media") return deleteMedia(sys, fileId);
  if (store === "visual_asset") {
    const a = await db().visualAsset.findUnique({ where: { id: fileId }, select: { organizationId: true, companyId: true } });
    if (!a) throw notFound("File");
    return deleteAsset(sys, a.organizationId, a.companyId, fileId);
  }
  if (store === "creative_asset") {
    const a = await db().creativeAsset.findUnique({ where: { id: fileId }, select: { organizationId: true, companyId: true } });
    if (!a) throw notFound("File");
    return archiveLibraryAsset(sys, a.organizationId, a.companyId, fileId);
  }
  // Raw stored objects: refuse while a visual asset still points at the bytes (delete that asset instead).
  const o = await db().integrationStoredObject.findUnique({ where: { id: fileId }, select: { id: true, companyId: true } });
  if (!o) throw notFound("File");
  const inUse = await db().visualAsset.count({ where: { companyId: o.companyId, storageRef: `db:${o.id}` } });
  if (inUse) throw conflict("A visual asset still uses this object: delete the asset instead");
  await db().integrationStoredObject.delete({ where: { id: o.id } });
  return { ok: true };
}
