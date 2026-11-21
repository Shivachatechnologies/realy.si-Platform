import { z } from "zod";
import { db, Prisma, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { toJson } from "@/server/core/json";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { contentAccountIds, contentAssetIds, contentProductIds, readContent, readSiteSeo, readTheme, assetIdOf, type PageContent } from "./schemas";

export type SitesPermission = "marketing.read" | "marketing.manage";
export const uuid = z.string().uuid();
export const isUuid = (v: string | null | undefined) => !!v && uuid.safeParse(v).success;
export const json = (v: unknown) => toJson(v) as Prisma.InputJsonValue;
export const actorId = (ctx: RequestContext, organizationId: string) => ctx.actor.id ?? organizationId;

/** Authorize at the company (inside the transaction for writes). Foreign companies resolve to not_found. */
export async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: SitesPermission, tx?: Tx) {
  const chain = await companyChain(tx ?? db(), organizationId, companyId);
  await requirePermission(ctx, permission, chain, tx);
  return chain;
}

export async function requireSite(client: Tx, organizationId: string, companyId: string) {
  const site = await client.site.findFirst({ where: { organizationId, companyId } });
  if (!site) throw notFound("Website");
  return site;
}

export async function requirePage(client: Tx, organizationId: string, companyId: string, pageId: string) {
  if (!isUuid(pageId)) throw notFound("Page");
  const page = await client.sitePage.findFirst({ where: { id: pageId, organizationId, companyId } });
  if (!page) throw notFound("Page");
  return page;
}

/**
 * References in content must point at this company's records: images at its asset library, testimonials at CRM
 * accounts of type CUSTOMER (real customers only), pricing cards at its products. Ids from the client are never trusted.
 */
export async function assertReferences(client: Tx, organizationId: string, companyId: string, c: PageContent) {
  const assetIds = contentAssetIds(c);
  const accountIds = contentAccountIds(c);
  const productIds = contentProductIds(c);
  const [assets, accounts, products] = await Promise.all([
    assetIds.length ? client.visualAsset.findMany({ where: { id: { in: assetIds }, organizationId, companyId, kind: { in: ["IMAGE", "SVG"] } }, select: { id: true } }) : [],
    accountIds.length ? client.account.findMany({ where: { id: { in: accountIds }, organizationId, companyId, type: "CUSTOMER", archivedAt: null }, select: { id: true } }) : [],
    productIds.length ? client.product.findMany({ where: { id: { in: productIds }, organizationId, companyId, archivedAt: null }, select: { id: true } }) : [],
  ]);
  if (assets.length !== assetIds.length) throw invalid("An image is not in your asset library", { reason: "sites_unknown_asset" });
  if (accounts.length !== accountIds.length) throw invalid("Testimonials can only quote real customers (CRM accounts of type Customer)", { reason: "sites_testimonial_not_customer" });
  if (products.length !== productIds.length) throw invalid("A pricing card points at a product that does not exist", { reason: "sites_unknown_product" });
}

export async function assertAsset(client: Tx, organizationId: string, companyId: string, assetId: string | null) {
  if (!assetId) return;
  if (!isUuid(assetId) || !(await client.visualAsset.findFirst({ where: { id: assetId, organizationId, companyId }, select: { id: true } }))) throw invalid("That image is not in your asset library", { reason: "sites_unknown_asset" });
}

/**
 * Recompute which assets the public site may serve: the theme logo, the SEO image and every image of live (published)
 * or scheduled page content. The public asset route serves nothing else.
 */
export async function refreshPublicAssets(tx: Tx, siteId: string) {
  const site = await tx.site.findUnique({ where: { id: siteId }, select: { theme: true, seo: true } });
  if (!site) return;
  const pages = await tx.sitePage.findMany({ where: { siteId, OR: [{ published: { not: Prisma.DbNull } }, { pending: { not: Prisma.DbNull } }] }, select: { published: true, pending: true } });
  const ids = new Set<string>();
  const logo = readTheme(site.theme).logoAssetId;
  if (logo) ids.add(logo);
  const og = assetIdOf(readSiteSeo(site.seo).ogImage);
  if (og) ids.add(og);
  for (const p of pages) for (const snap of [p.published, p.pending]) if (snap) for (const id of contentAssetIds(readContent(snap))) ids.add(id);
  await tx.site.update({ where: { id: siteId }, data: { publicAssetIds: [...ids].slice(0, 500) } });
}
