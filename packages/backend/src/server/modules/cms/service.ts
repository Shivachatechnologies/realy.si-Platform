import { z } from "zod";
import type { CmsEntryKind, CmsEntryStatus } from "@/generated/prisma/enums";
import { db, transaction, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { toJson } from "@/server/core/json";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { requireAnyPlatform } from "@/server/modules/admin/access";
import { CMS_KINDS, CMS_LOCALES, contentSchema, readContent, slugSchema, type CmsContent } from "./schemas";
import { invalidatePublicCms } from "./public";

/**
 * Platform CMS (Admin → Content): pages, blog posts and landing pages with locale variants, block content, SEO,
 * draft → scheduled → published, immutable versions and rollback. Platform-level (no tenant), every change audited.
 */

const READ = ["platform.content.manage", "platform.controls.manage"];
const MANAGE = "platform.content.manage";
const isUuid = (v: string) => z.string().uuid().safeParse(v).success;
const json = (v: unknown) => toJson(v) as Prisma.InputJsonValue;

const listInput = z.object({
  kind: z.enum(CMS_KINDS).optional().catch(undefined),
  status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional().catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
});

/** Which locales of a content blob have a title or blocks. */
export const filledLocales = (c: CmsContent) => CMS_LOCALES.filter((l) => !!c.locales[l] && (c.locales[l]!.title || c.locales[l]!.blocks.length));

export async function listEntries(ctx: RequestContext, raw: Partial<Record<keyof z.input<typeof listInput>, unknown>> = {}) {
  await requireAnyPlatform(ctx, READ);
  const f = listInput.parse(raw);
  const where: Prisma.CmsEntryWhereInput = {
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.status ? { status: f.status } : { status: { not: "ARCHIVED" } }),
    ...(f.q ? { slug: { contains: f.q.toLowerCase() } } : {}),
  };
  const [rows, counts] = await Promise.all([
    db().cmsEntry.findMany({ where, orderBy: { updatedAt: "desc" }, take: 200 }),
    db().cmsEntry.groupBy({ by: ["kind", "status"], _count: { _all: true } }),
  ]);
  return {
    entries: rows.map((r) => {
      const draft = readContent(r.draft);
      const en = draft.locales["en-US"] ?? Object.values(draft.locales)[0];
      return { id: r.id, kind: r.kind, slug: r.slug, status: r.status, title: en?.title ?? "", locales: filledLocales(draft), publishAt: r.publishAt, publishedAt: r.publishedAt, liveVersion: r.liveVersion, updatedAt: r.updatedAt, hasUnpublished: !!r.published && JSON.stringify(r.published) !== JSON.stringify(r.draft) };
    }),
    counts: counts.map((c) => ({ kind: c.kind, status: c.status, count: c._count._all })),
  };
}

export async function getEntry(ctx: RequestContext, entryId: string) {
  await requireAnyPlatform(ctx, READ);
  if (!isUuid(entryId)) throw notFound("Page");
  const row = await db().cmsEntry.findUnique({
    where: { id: entryId },
    include: { versions: { orderBy: { version: "desc" }, take: 30, select: { id: true, version: true, note: true, createdById: true, createdAt: true } } },
  });
  if (!row) throw notFound("Page");
  const people = await db().user.findMany({ where: { id: { in: [...new Set([row.updatedById, ...row.versions.map((v) => v.createdById)])] } }, select: { id: true, name: true } });
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "—";
  return {
    id: row.id,
    kind: row.kind,
    slug: row.slug,
    status: row.status,
    draft: readContent(row.draft),
    hasPublished: !!row.published,
    publishAt: row.publishAt,
    publishedAt: row.publishedAt,
    liveVersion: row.liveVersion,
    updatedAt: row.updatedAt,
    updatedBy: nameOf(row.updatedById),
    versions: row.versions.map((v) => ({ ...v, createdBy: nameOf(v.createdById) })),
  };
}

export const createEntryInput = z.object({ kind: z.enum(CMS_KINDS), slug: slugSchema, title: z.string().trim().min(1).max(200) });

export async function createEntry(ctx: RequestContext, raw: z.input<typeof createEntryInput>) {
  const input = createEntryInput.parse(raw);
  return transaction(async (tx) => {
    await requirePermission(ctx, MANAGE, platformChain(), tx);
    if (await tx.cmsEntry.findUnique({ where: { slug: input.slug }, select: { id: true } })) throw conflict("That address is already used by another page", { reason: "cms_slug_taken" });
    const draft: CmsContent = contentSchema.parse({
      locales: {
        "en-US": {
          title: input.title,
          blocks:
            input.kind === "POST"
              ? [{ id: "intro0001", type: "richText", body: "" }]
              : [{ id: "hero00001", type: "hero", title: input.title }],
        },
      },
    });
    const row = await tx.cmsEntry.create({ data: { kind: input.kind as CmsEntryKind, slug: input.slug, draft: json(draft), createdById: ctx.actor.id!, updatedById: ctx.actor.id! } });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "cms.entry.created", resourceType: "cms_entry", resourceId: row.id, newValue: { kind: input.kind, slug: input.slug } });
    return { id: row.id };
  });
}

export const saveDraftInput = z.object({ slug: slugSchema.optional(), content: contentSchema, expectedUpdatedAt: z.string().datetime().optional() });

/** Save the draft (all locales). Optimistic concurrency: a stale editor gets a conflict instead of overwriting. */
export async function saveDraft(ctx: RequestContext, entryId: string, raw: z.input<typeof saveDraftInput>) {
  const input = saveDraftInput.parse(raw);
  if (!isUuid(entryId)) throw notFound("Page");
  return transaction(async (tx) => {
    await requirePermission(ctx, MANAGE, platformChain(), tx);
    const row = await tx.cmsEntry.findUnique({ where: { id: entryId } });
    if (!row || row.status === "ARCHIVED") throw notFound("Page");
    if (input.expectedUpdatedAt && row.updatedAt.toISOString() !== input.expectedUpdatedAt) throw conflict("Someone else saved this page in the meantime. Reload to see their changes.", { reason: "cms_stale_draft" });
    if (input.slug && input.slug !== row.slug && (await tx.cmsEntry.findUnique({ where: { slug: input.slug }, select: { id: true } }))) throw conflict("That address is already used by another page", { reason: "cms_slug_taken" });
    const updated = await tx.cmsEntry.update({ where: { id: entryId }, data: { draft: json(input.content), ...(input.slug ? { slug: input.slug } : {}), updatedById: ctx.actor.id! } });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "cms.entry.draft_saved", resourceType: "cms_entry", resourceId: entryId, oldValue: input.slug && input.slug !== row.slug ? { slug: row.slug } : undefined, newValue: { slug: updated.slug, locales: filledLocales(input.content) } });
    if (input.slug && input.slug !== row.slug) invalidatePublicCms();
    return { id: entryId, updatedAt: updated.updatedAt.toISOString() };
  });
}

export const entryActionInput = z.object({
  note: z.string().trim().max(300).default(""),
  publishAt: z.string().datetime().optional(),
  version: z.coerce.number().int().min(1).optional(),
  publish: z.boolean().optional(),
});
export const ENTRY_ACTIONS = ["publish", "schedule", "unpublish", "archive", "restore", "rollback"] as const;
export type EntryAction = (typeof ENTRY_ACTIONS)[number];

/** Publish now, schedule, unpublish, archive, restore an archived entry, or roll back to an earlier version. */
export async function entryAction(ctx: RequestContext, entryId: string, action: EntryAction, raw: z.input<typeof entryActionInput>) {
  const input = entryActionInput.parse(raw);
  if (!isUuid(entryId)) throw notFound("Page");
  const result = await transaction(async (tx) => {
    await requirePermission(ctx, MANAGE, platformChain(), tx);
    const row = await tx.cmsEntry.findUnique({ where: { id: entryId } });
    if (!row) throw notFound("Page");
    const draft = readContent(row.draft);
    const snapshot = async (content: CmsContent) => {
      const last = await tx.cmsEntryVersion.findFirst({ where: { entryId }, orderBy: { version: "desc" }, select: { version: true } });
      const version = (last?.version ?? 0) + 1;
      await tx.cmsEntryVersion.create({ data: { entryId, version, content: json(content), note: input.note, createdById: ctx.actor.id! } });
      return version;
    };
    const requireContent = () => {
      if (!draft.locales["en-US"]?.title) throw invalid("Add an English (en-US) title before publishing", { reason: "cms_missing_default_locale" });
    };
    let data: Prisma.CmsEntryUpdateInput;
    let audit: Record<string, unknown> = {};
    switch (action) {
      case "publish": {
        if (row.status === "ARCHIVED") throw conflict("Restore the page before publishing it");
        requireContent();
        const version = await snapshot(draft);
        data = { status: "PUBLISHED", published: json(draft), pending: Prisma.DbNull, publishAt: null, publishedAt: new Date(), liveVersion: version };
        audit = { version };
        break;
      }
      case "schedule": {
        if (row.status === "ARCHIVED") throw conflict("Restore the page before scheduling it");
        requireContent();
        const at = input.publishAt ? new Date(input.publishAt) : null;
        if (!at || at.getTime() < Date.now() + 60_000) throw invalid("Pick a publish time at least a minute from now", { reason: "cms_schedule_past" });
        const version = await snapshot(draft);
        data = { status: "SCHEDULED", pending: json({ ...draft, version }), publishAt: at };
        audit = { version, publishAt: at.toISOString() };
        break;
      }
      case "unpublish":
        data = { status: "DRAFT", published: Prisma.DbNull, pending: Prisma.DbNull, publishAt: null, liveVersion: null };
        break;
      case "archive":
        data = { status: "ARCHIVED", published: Prisma.DbNull, pending: Prisma.DbNull, publishAt: null, liveVersion: null };
        break;
      case "restore":
        if (row.status !== "ARCHIVED") throw conflict("Only archived pages can be restored");
        data = { status: "DRAFT" };
        break;
      case "rollback": {
        if (!input.version) throw invalid("Choose a version to restore");
        const v = await tx.cmsEntryVersion.findUnique({ where: { entryId_version: { entryId, version: input.version } } });
        if (!v) throw notFound("Version");
        const content = readContent(v.content);
        data = input.publish ? { draft: json(content), status: "PUBLISHED", published: json(content), pending: Prisma.DbNull, publishAt: null, publishedAt: new Date(), liveVersion: v.version } : { draft: json(content) };
        audit = { version: v.version, published: !!input.publish };
        break;
      }
    }
    await tx.cmsEntry.update({ where: { id: entryId }, data: { ...data, updatedById: ctx.actor.id! } });
    await writeAudit(tx, ctx, { category: "ADMIN", action: `cms.entry.${action}`, resourceType: "cms_entry", resourceId: entryId, oldValue: { status: row.status, liveVersion: row.liveVersion }, newValue: { slug: row.slug, ...audit }, reason: input.note || null });
    return { id: entryId, action };
  });
  invalidatePublicCms();
  return result;
}

export type { CmsEntryStatus };
