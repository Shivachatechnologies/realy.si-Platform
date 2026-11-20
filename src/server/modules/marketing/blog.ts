import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { authorize, isUuid, PAGE_SIZE } from "./common";
import { ARTICLE_TYPES } from "./content";
import { assetPublicUrl } from "./assets";
import { getMarketingConnection, isUsable } from "./connections-bridge";
import { CMS_PROVIDERS } from "./providers/cms";

const BLOG_SIZE = 12;
const featuredSelect = { select: { id: true, url: true, mimeType: true, sizeBytes: true } } as const;

/** Realy-hosted public blog (no auth): published, public articles of a company. */
export async function publicBlog(companyId: string, page = 1, category?: string) {
  if (!isUuid(companyId)) return null;
  const company = await db().company.findUnique({ where: { id: companyId }, select: { id: true, name: true, defaultLocale: true } });
  if (!company) return null;
  const where: Prisma.MarketingContentWhereInput = { companyId, blogPublic: true, status: "PUBLISHED", archivedAt: null, ...(category ? { categories: { has: category } } : {}) };
  const [total, posts, brand, cats] = await Promise.all([
    db().marketingContent.count({ where }),
    db().marketingContent.findMany({ where, orderBy: { publishedAt: "desc" }, skip: (page - 1) * BLOG_SIZE, take: BLOG_SIZE, select: { id: true, title: true, slug: true, metaDescription: true, body: true, publishedAt: true, authorName: true, categories: true, featuredAsset: featuredSelect } }),
    db().marketingBrandKit.findUnique({ where: { companyId }, select: { brandName: true, tagline: true, logoUrl: true, colors: true } }),
    db().marketingContent.findMany({ where: { companyId, blogPublic: true, status: "PUBLISHED", archivedAt: null }, select: { categories: true }, take: 500 }),
  ]);
  return {
    company,
    brand,
    total,
    pageSize: BLOG_SIZE,
    categories: [...new Set(cats.flatMap((c) => c.categories))].sort(),
    posts: posts.map((p) => ({ ...p, excerpt: p.metaDescription ?? p.body.replace(/[#*_>`[\]()]/g, "").slice(0, 220), image: p.featuredAsset ? assetPublicUrl(p.featuredAsset) : null })),
  };
}

export async function publicBlogPost(companyId: string, slug: string) {
  if (!isUuid(companyId) || !/^[a-z0-9-]{1,200}$/.test(slug)) return null;
  const post = await db().marketingContent.findFirst({ where: { companyId, slug, blogPublic: true, status: "PUBLISHED", archivedAt: null }, include: { featuredAsset: featuredSelect, company: { select: { name: true } } } });
  if (!post) return null;
  await db().marketingContent.update({ where: { id: post.id }, data: { views: { increment: 1 } } });
  return { ...post, image: post.featuredAsset ? assetPublicUrl(post.featuredAsset) : null };
}

/** Blog & website publishing overview for the Marketing Studio. */
export async function blogOverview(ctx: RequestContext, organizationId: string, companyId: string, q?: string, page = 1) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const where: Prisma.MarketingContentWhereInput = { organizationId, companyId, archivedAt: null, type: { in: [...ARTICLE_TYPES] }, ...(q ? { title: { contains: q, mode: "insensitive" } } : {}) };
  const [total, articles, views, cms] = await Promise.all([
    db().marketingContent.count({ where }),
    db().marketingContent.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, title: true, type: true, status: true, slug: true, blogPublic: true, views: true, categories: true, tags: true, scheduledAt: true, publishedAt: true, version: true, cmsPublications: { orderBy: { createdAt: "desc" }, take: 3, select: { provider: true, status: true, url: true, error: true } } },
    }),
    db().marketingContent.aggregate({ where: { companyId, blogPublic: true }, _sum: { views: true }, _count: { _all: true } }),
    Promise.all(CMS_PROVIDERS.map(async (p) => [p, isUsable(await getMarketingConnection(organizationId, companyId, p))] as const)),
  ]);
  return { total, pageSize: PAGE_SIZE, articles, totalViews: views._sum.views ?? 0, publicPosts: views._count._all, cms: Object.fromEntries(cms) as Record<(typeof CMS_PROVIDERS)[number], boolean> };
}
