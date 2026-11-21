import { db } from "@/server/core/db";
import { systemContext } from "@/server/core/context";
import { logger } from "@/server/core/logger";
import { assetBytes } from "@/server/modules/assets/service";
import { contentAccountIds, contentProductIds, pagePathSchema, readContent, readFooter, readNav, readSiteSeo, readTheme, siteSlugSchema, type PageContent, type SiteFooter, type SiteNav, type SiteSeo, type SiteTheme } from "./schemas";

/**
 * Public read side (apps/user /s/<slug>/…): online sites of active companies, published snapshots only — never drafts.
 * A scheduled snapshot whose time has come is served even before the scheduler promotes it. Results are plain JSON
 * (cacheable by the app's data cache, tag `siteCacheTag(slug)`); references are resolved against live records, so a
 * deleted product or a customer that is no longer a customer disappears from the page.
 */

export const siteCacheTag = (slug: string) => `site:${slug}`;

export interface PublicSite {
  id: string;
  slug: string;
  name: string;
  locale: string;
  companyName: string;
  theme: SiteTheme;
  nav: SiteNav;
  footer: SiteFooter;
  seo: SiteSeo;
  customDomain: string | null;
  domainVerified: boolean;
  pages: { slug: string; title: string; kind: "PAGE" | "LANDING"; noIndex: boolean; publishedAt: string | null }[];
}

export interface PublicPage {
  id: string;
  slug: string;
  kind: "PAGE" | "LANDING";
  publishedAt: string | null;
  content: PageContent;
  products: Record<string, { name: string; description: string }>;
  customers: Record<string, { name: string }>;
}

const liveSnapshot = (p: { status: string; published: unknown; pending: unknown; publishAt: Date | null; publishedAt: Date | null }, now = new Date()) => {
  if (p.status === "SCHEDULED" && p.pending && p.publishAt && p.publishAt <= now) return { raw: p.pending, at: p.publishAt };
  return p.published ? { raw: p.published, at: p.publishedAt } : null;
};

async function findSite(slugRaw: string) {
  const slug = siteSlugSchema.safeParse(slugRaw);
  if (!slug.success) return null;
  return db().site.findFirst({ where: { slug: slug.data, online: true, company: { deletedAt: null, status: "ACTIVE" } }, include: { company: { select: { name: true } } } });
}

/** The online site with its live pages (navigation, sitemap), or null. */
export async function loadPublicSite(slugRaw: string): Promise<PublicSite | null> {
  try {
    const site = await findSite(slugRaw);
    if (!site) return null;
    const rows = await db().sitePage.findMany({ where: { siteId: site.id, status: { in: ["PUBLISHED", "SCHEDULED"] } }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { slug: true, kind: true, status: true, published: true, pending: true, publishAt: true, publishedAt: true } });
    const pages = rows.flatMap((r) => {
      const live = liveSnapshot(r);
      if (!live) return [];
      const c = readContent(live.raw);
      return [{ slug: r.slug, title: c.title, kind: r.kind, noIndex: c.seo.noIndex, publishedAt: live.at?.toISOString() ?? null }];
    });
    return {
      id: site.id,
      slug: site.slug,
      name: site.name,
      locale: site.locale,
      companyName: site.company.name,
      theme: readTheme(site.theme),
      nav: readNav(site.nav),
      footer: readFooter(site.footer),
      seo: readSiteSeo(site.seo),
      customDomain: site.customDomain,
      domainVerified: site.domainStatus === "VERIFIED",
      pages,
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "public site unavailable");
    return null;
  }
}

/** The live page at a path of an online site, with its referenced products and customers resolved, or null. */
export async function loadPublicPage(slugRaw: string, pathRaw: string): Promise<PublicPage | null> {
  const path = pagePathSchema.safeParse(pathRaw);
  if (!path.success) return null;
  try {
    const site = await findSite(slugRaw);
    if (!site) return null;
    const row = await db().sitePage.findFirst({ where: { siteId: site.id, slug: path.data, status: { in: ["PUBLISHED", "SCHEDULED"] } } });
    if (!row) return null;
    const live = liveSnapshot(row);
    if (!live) return null;
    const content = readContent(live.raw);
    const productIds = contentProductIds(content);
    const accountIds = contentAccountIds(content);
    const [products, accounts] = await Promise.all([
      productIds.length ? db().product.findMany({ where: { id: { in: productIds }, companyId: site.companyId, archivedAt: null }, select: { id: true, name: true, description: true } }) : [],
      accountIds.length ? db().account.findMany({ where: { id: { in: accountIds }, companyId: site.companyId, type: "CUSTOMER", archivedAt: null }, select: { id: true, name: true } }) : [],
    ]);
    return {
      id: row.id,
      slug: row.slug,
      kind: row.kind,
      publishedAt: live.at?.toISOString() ?? null,
      content,
      products: Object.fromEntries(products.map((p) => [p.id, { name: p.name, description: p.description ?? "" }])),
      customers: Object.fromEntries(accounts.map((a) => [a.id, { name: a.name }])),
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "public site page unavailable");
    return null;
  }
}

/** Bytes of an image the published site references (only assets listed in Site.publicAssetIds are served). */
export async function publicSiteAsset(slugRaw: string, assetId: string) {
  const site = await findSite(slugRaw);
  if (!site || !site.publicAssetIds.includes(assetId.toLowerCase())) return null;
  try {
    return await assetBytes(systemContext(), site.organizationId, site.companyId, assetId.toLowerCase());
  } catch {
    return null;
  }
}

/** Public URL of a site image (same-origin: the CSP only allows images from 'self'). */
export const publicAssetUrl = (siteSlug: string, assetId: string) => `/api/public/sites/${siteSlug}/assets/${assetId}`;
