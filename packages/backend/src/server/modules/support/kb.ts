import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { SupportArticleStatus } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { authorize, isUuid, userNames, uuid } from "./common";

export const kbCategoryInput = z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(500).optional(), position: z.number().int().min(0).max(1000).default(0) });
export const articleInput = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(100_000),
  categoryId: uuid.nullable().optional().or(z.literal("").transform(() => null)),
  status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).default([]),
});
export const updateArticleInput = articleInput.partial();

const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "article";

async function uniqueSlug(tx: Tx, companyId: string, title: string, excludeId?: string) {
  const base = slugify(title);
  for (let i = 1; i < 200; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    if (!(await tx.supportKbArticle.findFirst({ where: { companyId, slug, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } }))) return slug;
  }
  return `${base}-${Date.now()}`;
}

// ─── Categories ───────────────────────────────────────────────────────────────────────────────────────────────────

export async function listKbCategories(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "support.read");
  return db().supportKbCategory.findMany({ where: { organizationId, companyId }, orderBy: [{ position: "asc" }, { name: "asc" }], take: 500, include: { _count: { select: { articles: true } } } });
}

export async function saveKbCategory(ctx: RequestContext, organizationId: string, companyId: string, id: string | null, raw: z.input<typeof kbCategoryInput>) {
  const input = kbCategoryInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    if (await tx.supportKbCategory.findFirst({ where: { companyId, name: { equals: input.name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } })) {
      throw conflict("A category with this name exists", { reason: "support_name_exists" });
    }
    const data = { name: input.name, description: input.description || null, position: input.position };
    if (id) {
      if (!isUuid(id) || !(await tx.supportKbCategory.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }))) throw notFound("Category");
      return tx.supportKbCategory.update({ where: { id }, data });
    }
    return tx.supportKbCategory.create({ data: { ...data, organizationId, companyId } });
  });
}

export async function deleteKbCategory(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    if (!isUuid(id) || !(await tx.supportKbCategory.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }))) throw notFound("Category");
    await tx.supportKbArticle.updateMany({ where: { companyId, categoryId: id }, data: { categoryId: null } });
    await tx.supportKbCategory.delete({ where: { id } });
    return { ok: true };
  });
}

// ─── Articles ─────────────────────────────────────────────────────────────────────────────────────────────────────

function searchWhere(q: string | undefined): Prisma.SupportKbArticleWhereInput {
  if (!q) return {};
  const words = q
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 6);
  const terms = words.length ? words : [q.toLowerCase()];
  // Every word must appear in the title, body or tags (ILIKE).
  return { AND: terms.map((w) => ({ OR: [{ title: { contains: w, mode: "insensitive" as const } }, { body: { contains: w, mode: "insensitive" as const } }, { tags: { has: w } }] })) };
}

/** Title hits rank above body-only hits; then views. */
function rank<T extends { title: string; views: number }>(rows: T[], q?: string) {
  if (!q) return rows;
  const lq = q.toLowerCase();
  return [...rows].sort((a, b) => Number(b.title.toLowerCase().includes(lq)) - Number(a.title.toLowerCase().includes(lq)) || b.views - a.views);
}

export async function listArticles(ctx: RequestContext, organizationId: string, companyId: string, opts: { q?: string; status?: SupportArticleStatus; categoryId?: string; page?: number } = {}) {
  await authorize(ctx, organizationId, companyId, "support.read");
  const page = Math.max(opts.page ?? 1, 1);
  const where: Prisma.SupportKbArticleWhereInput = {
    organizationId,
    companyId,
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.categoryId && isUuid(opts.categoryId) ? { categoryId: opts.categoryId } : {}),
    ...searchWhere(opts.q),
  };
  const [total, rows] = await Promise.all([
    db().supportKbArticle.count({ where }),
    db().supportKbArticle.findMany({ where, orderBy: [{ updatedAt: "desc" }], skip: (page - 1) * 25, take: 25, select: { id: true, title: true, slug: true, status: true, views: true, tags: true, updatedAt: true, publishedAt: true, authorId: true, category: { select: { id: true, name: true } } } }),
  ]);
  const names = await userNames(db(), rows.map((r) => r.authorId));
  return { data: rank(rows, opts.q).map((r) => ({ ...r, authorName: names.get(r.authorId) ?? null })), total, page, pageSize: 25 };
}

/** Knowledge-base search for agents and AI: published articles first, with an excerpt around the match. */
export async function searchArticles(ctx: RequestContext, organizationId: string, companyId: string, q: string, opts: { publishedOnly?: boolean; limit?: number } = {}) {
  await authorize(ctx, organizationId, companyId, "support.read");
  const rows = await db().supportKbArticle.findMany({
    where: { organizationId, companyId, ...(opts.publishedOnly ? { status: "PUBLISHED" } : {}), ...searchWhere(q) },
    orderBy: [{ status: "desc" }, { views: "desc" }],
    take: 50,
    select: { id: true, title: true, slug: true, status: true, body: true, views: true },
  });
  return rank(rows, q)
    .slice(0, opts.limit ?? 8)
    .map((r) => {
      const at = r.body.toLowerCase().indexOf(q.toLowerCase().split(/\s+/)[0] ?? "");
      const start = Math.max(at - 120, 0);
      return { id: r.id, title: r.title, slug: r.slug, status: r.status, excerpt: r.body.slice(start, start + 600), body: r.body };
    });
}

export async function getArticle(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "support.read");
  if (!isUuid(id)) throw notFound("Article");
  const a = await db().supportKbArticle.findFirst({ where: { id, organizationId, companyId }, include: { category: { select: { id: true, name: true } } } });
  if (!a) throw notFound("Article");
  return a;
}

export async function createArticle(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof articleInput>) {
  const input = articleInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    if (input.categoryId && !(await tx.supportKbCategory.findFirst({ where: { id: input.categoryId, organizationId, companyId }, select: { id: true } }))) throw notFound("Category");
    const a = await tx.supportKbArticle.create({
      data: {
        organizationId,
        companyId,
        title: input.title,
        slug: await uniqueSlug(tx, companyId, input.title),
        body: input.body,
        categoryId: input.categoryId ?? null,
        status: input.status,
        tags: [...new Set(input.tags)],
        authorId: ctx.actor.id ?? organizationId,
        publishedAt: input.status === "PUBLISHED" ? new Date() : null,
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "kb.article.created", resourceType: "kb_article", resourceId: a.id, newValue: { title: a.title, status: a.status } });
    return a;
  });
}

export async function updateArticle(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateArticleInput>) {
  const input = updateArticleInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    if (!isUuid(id)) throw notFound("Article");
    const before = await tx.supportKbArticle.findFirst({ where: { id, organizationId, companyId } });
    if (!before) throw notFound("Article");
    if (input.categoryId && !(await tx.supportKbCategory.findFirst({ where: { id: input.categoryId, organizationId, companyId }, select: { id: true } }))) throw notFound("Category");
    const a = await tx.supportKbArticle.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title, ...(before.status === "DRAFT" ? { slug: await uniqueSlug(tx, companyId, input.title, id) } : {}) } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.tags !== undefined ? { tags: [...new Set(input.tags)] } : {}),
        ...(input.status !== undefined ? { status: input.status, ...(input.status === "PUBLISHED" && !before.publishedAt ? { publishedAt: new Date() } : {}) } : {}),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "kb.article.updated", resourceType: "kb_article", resourceId: id, oldValue: { title: before.title, status: before.status }, newValue: { title: a.title, status: a.status } });
    return a;
  });
}

export async function deleteArticle(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    if (!isUuid(id)) throw notFound("Article");
    const a = await tx.supportKbArticle.findFirst({ where: { id, organizationId, companyId }, select: { id: true, title: true } });
    if (!a) throw notFound("Article");
    await tx.supportKbArticle.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "kb.article.deleted", resourceType: "kb_article", resourceId: id, oldValue: { title: a.title } });
    return { ok: true };
  });
}

// ─── Public help center (/help/<companyId>) ───────────────────────────────────────────────────────────────────────

async function helpCompany(companyId: string) {
  if (!isUuid(companyId)) throw notFound("Help center");
  const company = await db().company.findFirst({ where: { id: companyId, deletedAt: null, status: "ACTIVE" }, select: { id: true, name: true, organizationId: true } });
  if (!company) throw notFound("Help center");
  const settings = await db().supportSettings.findUnique({ where: { companyId }, select: { helpCenterEnabled: true, supportFormEnabled: true } });
  if (settings && !settings.helpCenterEnabled) throw new AppError("not_found", "Help center not found");
  return { ...company, supportFormEnabled: settings?.supportFormEnabled ?? true };
}

/** Published articles only — never drafts. */
export async function publicHelpCenter(companyId: string, opts: { q?: string; categoryId?: string } = {}) {
  const company = await helpCompany(companyId);
  const [categories, articles] = await Promise.all([
    db().supportKbCategory.findMany({ where: { companyId, articles: { some: { status: "PUBLISHED" } } }, orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, name: true, description: true } }),
    db().supportKbArticle.findMany({
      where: { companyId, status: "PUBLISHED", ...(opts.categoryId && isUuid(opts.categoryId) ? { categoryId: opts.categoryId } : {}), ...searchWhere(opts.q) },
      orderBy: [{ views: "desc" }, { title: "asc" }],
      take: 100,
      select: { id: true, title: true, slug: true, categoryId: true, views: true, body: true },
    }),
  ]);
  return { company, categories, articles: rank(articles, opts.q).map(({ body, ...a }) => ({ ...a, excerpt: body.replace(/^#+\s.*$/gm, "").trim().slice(0, 180) })) };
}

/** A published article by slug; counts the view. */
export async function publicArticle(companyId: string, slug: string) {
  const company = await helpCompany(companyId);
  if (!/^[\p{L}\p{N}-]{1,100}$/u.test(slug)) throw notFound("Article");
  const a = await db().supportKbArticle.findFirst({ where: { companyId, slug, status: "PUBLISHED" }, include: { category: { select: { id: true, name: true } } } });
  if (!a) throw notFound("Article");
  await db().supportKbArticle.update({ where: { id: a.id }, data: { views: { increment: 1 } } });
  return { company, article: a };
}
