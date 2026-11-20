import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { MarketingContentStatus, MarketingContentType } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { actorId, authorize, enumParam, instant, isUuid, PAGE_SIZE, pageParam, param, requireOwned, toInstant, uuid } from "./common";

export const CONTENT_TYPES = [
  "BLOG",
  "SEO_ARTICLE",
  "LINKEDIN",
  "X",
  "INSTAGRAM",
  "FACEBOOK",
  "THREADS",
  "TIKTOK_SCRIPT",
  "YOUTUBE_SCRIPT",
  "VIDEO_SCRIPT",
  "CAROUSEL",
  "QUOTE",
  "GRAPHIC_BRIEF",
  "NEWSLETTER",
  "EMAIL",
  "AD",
  "LANDING_PAGE",
  "WEBSITE_COPY",
  "CASE_STUDY",
  "PRESS_RELEASE",
  "PRODUCT_ANNOUNCEMENT",
  "THOUGHT_LEADERSHIP",
  "INDUSTRY_REPORT",
] as const;
/** Long-form types that can be published as blog / CMS articles. */
export const ARTICLE_TYPES = new Set<MarketingContentType>(["BLOG", "SEO_ARTICLE", "CASE_STUDY", "PRESS_RELEASE", "PRODUCT_ANNOUNCEMENT", "THOUGHT_LEADERSHIP", "INDUSTRY_REPORT", "NEWSLETTER"]);
export const CONTENT_STATUSES = ["DRAFT", "IN_REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED"] as const;

export const contentInput = z.object({
  type: z.enum(CONTENT_TYPES),
  title: z.string().trim().min(1).max(250),
  body: z.string().max(100_000).default(""),
  brief: z.string().trim().max(5000).optional(),
  campaignId: uuid.or(z.literal("")).nullable().optional(),
  parentId: uuid.optional(),
  keywords: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
});
export const updateContentInput = z.object({
  type: z.enum(CONTENT_TYPES).optional(),
  title: z.string().trim().min(1).max(250).optional(),
  body: z.string().max(100_000).optional(),
  brief: z.string().trim().max(5000).optional(),
  campaignId: uuid.or(z.literal("")).nullable().optional(),
  slug: z.string().trim().max(200).regex(/^[a-z0-9-]*$/).optional(),
  metaTitle: z.string().trim().max(120).optional(),
  metaDescription: z.string().trim().max(320).optional(),
  keywords: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  categories: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  authorName: z.string().trim().max(120).optional(),
  featuredAssetId: uuid.or(z.literal("")).nullable().optional(),
  schemaMarkup: z.record(z.string(), z.unknown()).nullable().optional(),
});
export const workflowInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit"), comment: z.string().trim().max(2000).optional() }),
  z.object({ action: z.literal("approve"), comment: z.string().trim().max(2000).optional() }),
  z.object({ action: z.literal("request_changes"), comment: z.string().trim().min(1).max(2000) }),
  z.object({ action: z.literal("schedule"), scheduledAt: instant }),
  z.object({ action: z.literal("unschedule") }),
  z.object({ action: z.literal("publish"), publishedUrl: z.string().trim().url().max(2000).optional().or(z.literal("")) }),
  z.object({ action: z.literal("restore"), version: z.number().int().min(1) }),
]);
export const commentInput = z.object({ body: z.string().trim().min(1).max(4000) });

export interface ContentFilters {
  q?: string;
  type?: MarketingContentType;
  status?: MarketingContentStatus;
  campaignId?: string;
  sort?: "updated" | "title" | "scheduled";
  page: number;
}
export function parseContentFilters(raw: Record<string, string | string[] | undefined>): ContentFilters {
  const campaignId = param(raw, "campaign");
  return {
    q: param(raw, "q"),
    type: enumParam(raw, "type", CONTENT_TYPES),
    status: enumParam(raw, "status", CONTENT_STATUSES),
    campaignId: isUuid(campaignId) ? campaignId : undefined,
    sort: enumParam(raw, "sort", ["updated", "title", "scheduled"] as const),
    page: pageParam(raw),
  };
}

export async function listContent(ctx: RequestContext, organizationId: string, companyId: string, f: ContentFilters = { page: 1 }) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const where: Prisma.MarketingContentWhereInput = { organizationId, companyId, archivedAt: null };
  if (f.type) where.type = f.type;
  if (f.status) where.status = f.status;
  if (f.campaignId) where.campaignId = f.campaignId;
  if (f.q) where.OR = [{ title: { contains: f.q, mode: "insensitive" } }, { body: { contains: f.q, mode: "insensitive" } }];
  const orderBy: Prisma.MarketingContentOrderByWithRelationInput =
    f.sort === "title" ? { title: "asc" } : f.sort === "scheduled" ? { scheduledAt: { sort: "asc", nulls: "last" } } : { updatedAt: "desc" };
  const [total, data, byStatus] = await Promise.all([
    db().marketingContent.count({ where }),
    db().marketingContent.findMany({
      where,
      orderBy,
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, type: true, title: true, status: true, scheduledAt: true, publishedAt: true, updatedAt: true, version: true, campaign: { select: { id: true, name: true } } },
    }),
    db().marketingContent.groupBy({ by: ["status"], where: { organizationId, companyId, archivedAt: null }, _count: { _all: true } }),
  ]);
  return { total, pageSize: PAGE_SIZE, data, byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) as Partial<Record<MarketingContentStatus, number>> };
}

/** Content and social posts planned or published within [from, to). */
export async function contentCalendar(ctx: RequestContext, organizationId: string, companyId: string, from: Date, to: Date) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const [content, posts] = await Promise.all([
    db().marketingContent.findMany({
      where: { organizationId, companyId, archivedAt: null, OR: [{ scheduledAt: { gte: from, lt: to } }, { publishedAt: { gte: from, lt: to } }] },
      select: { id: true, title: true, type: true, status: true, scheduledAt: true, publishedAt: true },
      take: 500,
    }),
    db().marketingSocialPost.findMany({
      where: { organizationId, companyId, OR: [{ scheduledAt: { gte: from, lt: to } }, { publishedAt: { gte: from, lt: to } }], status: { not: "CANCELLED" } },
      select: { id: true, title: true, status: true, scheduledAt: true, publishedAt: true },
      take: 500,
    }),
  ]);
  return { content, posts };
}

export async function getContent(ctx: RequestContext, organizationId: string, companyId: string, contentId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  if (!isUuid(contentId)) throw notFound("Content");
  const c = await db().marketingContent.findFirst({
    where: { id: contentId, organizationId, companyId },
    include: {
      campaign: { select: { id: true, name: true, code: true } },
      versions: { orderBy: { version: "desc" }, take: 50 },
      comments: { orderBy: { createdAt: "asc" }, take: 200 },
      socialPosts: { select: { id: true, title: true, status: true, scheduledAt: true, publishedAt: true }, orderBy: { createdAt: "desc" }, take: 20 },
      parent: { select: { id: true, title: true, type: true } },
      children: { where: { archivedAt: null }, select: { id: true, title: true, type: true, status: true }, orderBy: { createdAt: "asc" }, take: 100 },
      cmsPublications: { orderBy: { createdAt: "desc" }, take: 20 },
      featuredAsset: { select: { id: true, name: true, url: true, mimeType: true, sizeBytes: true } },
    },
  });
  if (!c) throw notFound("Content");
  const ids = [...new Set([...c.comments.map((x) => x.authorId), ...c.versions.map((v) => v.createdById), ...(c.approvedById ? [c.approvedById] : [])])];
  const users = ids.length ? await db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  return {
    ...c,
    approvedByName: c.approvedById ? (name.get(c.approvedById) ?? null) : null,
    comments: c.comments.map((x) => ({ ...x, authorName: name.get(x.authorId) ?? null })),
    versions: c.versions.map((v) => ({ ...v, authorName: name.get(v.createdById) ?? null })),
  };
}

export async function createContent(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof contentInput>) {
  const input = contentInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const by = actorId(ctx, organizationId);
    const c = await tx.marketingContent.create({
      data: {
        organizationId,
        companyId,
        type: input.type,
        title: input.title,
        body: input.body,
        brief: input.brief || null,
        keywords: input.keywords ?? [],
        campaignId: await requireOwned(tx, "marketingCampaign", companyId, input.campaignId || null, "Campaign"),
        parentId: await requireOwned(tx, "marketingContent", companyId, input.parentId || null, "Content"),
        createdById: by,
      },
    });
    await tx.marketingContentVersion.create({ data: { organizationId, companyId, contentId: c.id, version: 1, title: c.title, body: c.body, createdById: by } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.content.created", resourceType: "marketing_content", resourceId: c.id, newValue: { title: c.title, type: c.type } });
    return c;
  });
}

/** Save a new version (title/body change). Edits to approved or scheduled content send it back to draft for re-approval. */
async function saveVersion(tx: Tx, ctx: RequestContext, c: { id: string; organizationId: string; companyId: string; version: number; status: MarketingContentStatus }, title: string, body: string, source: string) {
  const version = c.version + 1;
  await tx.marketingContentVersion.create({ data: { organizationId: c.organizationId, companyId: c.companyId, contentId: c.id, version, title, body, source, createdById: actorId(ctx, c.organizationId) } });
  const reopen = c.status === "APPROVED" || c.status === "SCHEDULED";
  return { version, ...(reopen ? { status: "DRAFT" as const, approvedAt: null, approvedById: null, scheduledAt: null } : {}) };
}

export async function updateContent(ctx: RequestContext, organizationId: string, companyId: string, contentId: string, raw: z.input<typeof updateContentInput>) {
  const input = updateContentInput.parse(raw);
  if (!isUuid(contentId)) throw notFound("Content");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const c = await tx.marketingContent.findFirst({ where: { id: contentId, organizationId, companyId, archivedAt: null } });
    if (!c) throw notFound("Content");
    const data: Prisma.MarketingContentUncheckedUpdateInput = {};
    if (input.type !== undefined) data.type = input.type;
    if (input.brief !== undefined) data.brief = input.brief || null;
    if (input.slug !== undefined) data.slug = input.slug || null;
    if (input.metaTitle !== undefined) data.metaTitle = input.metaTitle || null;
    if (input.metaDescription !== undefined) data.metaDescription = input.metaDescription || null;
    if (input.keywords !== undefined) data.keywords = input.keywords;
    if (input.categories !== undefined) data.categories = input.categories;
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.authorName !== undefined) data.authorName = input.authorName || null;
    if (input.schemaMarkup !== undefined) data.schemaMarkup = (input.schemaMarkup ?? undefined) as Prisma.InputJsonValue | undefined;
    if (input.featuredAssetId !== undefined) {
      if (input.featuredAssetId && !(await tx.marketingAsset.findFirst({ where: { id: input.featuredAssetId, companyId, archivedAt: null }, select: { id: true } }))) throw notFound("Asset");
      data.featuredAssetId = input.featuredAssetId || null;
    }
    if (input.campaignId !== undefined) data.campaignId = await requireOwned(tx, "marketingCampaign", companyId, input.campaignId || null, "Campaign");
    const title = input.title ?? c.title;
    const body = input.body ?? c.body;
    if (title !== c.title || body !== c.body) {
      if (c.status === "PUBLISHED") throw conflict("Published content cannot be edited", { reason: "marketing_content_published" });
      Object.assign(data, { title, body }, await saveVersion(tx, ctx, c, title, body, "edit"));
    }
    const updated = await tx.marketingContent.update({ where: { id: c.id }, data });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.content.updated", resourceType: "marketing_content", resourceId: c.id, newValue: { version: updated.version, status: updated.status } });
    return updated;
  });
}

/** Replace the body (or meta fields) with AI output — the caller verified the task. */
export async function applyAiToContent(ctx: RequestContext, organizationId: string, companyId: string, contentId: string, patch: { body?: string; metaTitle?: string; metaDescription?: string; keywords?: string[]; taskId: string }) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const c = await tx.marketingContent.findFirst({ where: { id: contentId, organizationId, companyId, archivedAt: null } });
    if (!c) throw notFound("Content");
    const data: Prisma.MarketingContentUncheckedUpdateInput = {};
    if (patch.body !== undefined) {
      if (c.status === "PUBLISHED") throw conflict("Published content cannot be edited", { reason: "marketing_content_published" });
      Object.assign(data, { body: patch.body }, await saveVersion(tx, ctx, c, c.title, patch.body, "ai_draft"));
    }
    if (patch.metaTitle !== undefined) data.metaTitle = patch.metaTitle.slice(0, 120);
    if (patch.metaDescription !== undefined) data.metaDescription = patch.metaDescription.slice(0, 320);
    if (patch.keywords !== undefined) data.keywords = patch.keywords.slice(0, 30).map((k) => k.slice(0, 80));
    const updated = await tx.marketingContent.update({ where: { id: c.id }, data });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.content.ai_applied", resourceType: "marketing_content", resourceId: c.id, newValue: { taskId: patch.taskId, body: patch.body !== undefined, meta: patch.metaTitle !== undefined } });
    return updated;
  });
}

async function addComment(tx: Tx, ctx: RequestContext, c: { id: string; organizationId: string; companyId: string }, kind: string, body: string) {
  await tx.marketingContentComment.create({ data: { organizationId: c.organizationId, companyId: c.companyId, contentId: c.id, authorId: actorId(ctx, c.organizationId), kind, body } });
}

/** Mark content published (emits content.published). Used by the workflow and by social publishing. */
export async function markContentPublished(tx: Tx, ctx: RequestContext, c: { id: string; organizationId: string; companyId: string; title: string; type: MarketingContentType; campaignId: string | null }, publishedUrl?: string | null) {
  const now = new Date();
  await tx.marketingContent.update({ where: { id: c.id }, data: { status: "PUBLISHED", publishedAt: now, ...(publishedUrl ? { publishedUrl } : {}) } });
  await emitDomainEvent(tx, ctx, "content.published", {
    organizationId: c.organizationId,
    companyId: c.companyId,
    entityType: "marketing_content",
    entityId: c.id,
    data: { title: c.title, type: c.type, campaignId: c.campaignId, publishedUrl: publishedUrl ?? null, publishedAt: now },
  });
}

export async function contentWorkflow(ctx: RequestContext, organizationId: string, companyId: string, contentId: string, raw: z.input<typeof workflowInput>) {
  const input = workflowInput.parse(raw);
  if (!isUuid(contentId)) throw notFound("Content");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const c = await tx.marketingContent.findFirst({ where: { id: contentId, organizationId, companyId, archivedAt: null } });
    if (!c) throw notFound("Content");
    const bad = () => conflict(`Cannot ${input.action} content in ${c.status}`, { reason: "marketing_invalid_transition" });
    const href = `/marketing/content/${c.id}`;
    switch (input.action) {
      case "submit": {
        if (c.status !== "DRAFT") throw bad();
        if (!c.body.trim()) throw invalid("Write the content first", { reason: "marketing_content_empty" });
        await tx.marketingContent.update({ where: { id: c.id }, data: { status: "IN_REVIEW", reviewerId: null } });
        await addComment(tx, ctx, c, "submitted", input.comment || "");
        const reviewers = (await usersWithPermission(tx, organizationId, companyId, "marketing.manage")).filter((u) => u !== ctx.actor.id);
        await notifyUsers(tx, organizationId, reviewers, "marketing.content_review", { companyId, title: c.title, href });
        break;
      }
      case "approve":
        if (c.status !== "IN_REVIEW") throw bad();
        await tx.marketingContent.update({ where: { id: c.id }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: ctx.actor.id, reviewerId: ctx.actor.id } });
        await addComment(tx, ctx, c, "approved", input.comment || "");
        await notifyUsers(tx, organizationId, [c.createdById].filter((u) => u !== ctx.actor.id), "marketing.content_approved", { companyId, title: c.title, href });
        break;
      case "request_changes":
        if (c.status !== "IN_REVIEW") throw bad();
        await tx.marketingContent.update({ where: { id: c.id }, data: { status: "DRAFT", reviewerId: ctx.actor.id } });
        await addComment(tx, ctx, c, "changes_requested", input.comment);
        await notifyUsers(tx, organizationId, [c.createdById].filter((u) => u !== ctx.actor.id), "marketing.content_changes", { companyId, title: c.title, href });
        break;
      case "schedule": {
        if (c.status !== "APPROVED" && c.status !== "SCHEDULED") throw bad();
        const at = toInstant(input.scheduledAt);
        if (!at) throw invalid("Invalid date");
        await tx.marketingContent.update({ where: { id: c.id }, data: { status: "SCHEDULED", scheduledAt: at } });
        break;
      }
      case "unschedule":
        if (c.status !== "SCHEDULED") throw bad();
        await tx.marketingContent.update({ where: { id: c.id }, data: { status: "APPROVED", scheduledAt: null } });
        break;
      case "publish":
        if (c.status !== "APPROVED" && c.status !== "SCHEDULED") throw bad();
        await markContentPublished(tx, ctx, c, input.publishedUrl || null);
        await addComment(tx, ctx, c, "published", input.publishedUrl || "");
        break;
      case "restore": {
        if (c.status === "PUBLISHED") throw conflict("Published content cannot be edited", { reason: "marketing_content_published" });
        const v = await tx.marketingContentVersion.findFirst({ where: { contentId: c.id, version: input.version } });
        if (!v) throw notFound("Version");
        await tx.marketingContent.update({ where: { id: c.id }, data: { title: v.title, body: v.body, ...(await saveVersion(tx, ctx, c, v.title, v.body, "restore")) } });
        break;
      }
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `marketing.content.${input.action}`, resourceType: "marketing_content", resourceId: c.id, oldValue: { status: c.status } });
    return tx.marketingContent.findUniqueOrThrow({ where: { id: c.id } });
  });
}

export async function commentOnContent(ctx: RequestContext, organizationId: string, companyId: string, contentId: string, raw: z.input<typeof commentInput>) {
  const input = commentInput.parse(raw);
  if (!isUuid(contentId)) throw notFound("Content");
  return transaction(async (tx) => {
    // Reviewers with read access may comment.
    await authorize(ctx, organizationId, companyId, "marketing.read", tx);
    const c = await tx.marketingContent.findFirst({ where: { id: contentId, organizationId, companyId }, select: { id: true, organizationId: true, companyId: true, createdById: true, title: true } });
    if (!c) throw notFound("Content");
    await addComment(tx, ctx, c, "comment", input.body);
    await notifyUsers(tx, organizationId, [c.createdById].filter((u) => u !== ctx.actor.id), "marketing.content_comment", { companyId, title: c.title, href: `/marketing/content/${c.id}` });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.content.commented", resourceType: "marketing_content", resourceId: c.id });
    return { ok: true };
  });
}

export async function archiveContent(ctx: RequestContext, organizationId: string, companyId: string, contentId: string) {
  if (!isUuid(contentId)) throw notFound("Content");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingContent.updateMany({ where: { id: contentId, organizationId, companyId, archivedAt: null }, data: { archivedAt: new Date() } });
    if (!count) throw notFound("Content");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.content.archived", resourceType: "marketing_content", resourceId: contentId });
    return { ok: true };
  });
}
