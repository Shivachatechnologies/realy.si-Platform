import { z } from "zod";
import { randomBytes } from "node:crypto";
import { db, Prisma, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { assertFeature, assertLimit } from "@/server/modules/entitlements/service";
import { websiteSchema } from "@/server/modules/builder/kit-defs";
import { actorId, assertAsset, assertReferences, authorize, isUuid, json, refreshPublicAssets, requirePage, requireSite } from "./common";
import {
  SITE_LOCALES,
  SITE_PAGE_KINDS,
  SITE_TEMPLATES,
  assetIdOf,
  footerSchema,
  navSchema,
  pageContentSchema,
  pagePathSchema,
  readContent,
  readFooter,
  readNav,
  readSiteSeo,
  readTheme,
  siteSeoSchema,
  siteSlugSchema,
  themeSchema,
  type PageContent,
  type SitePageKind,
} from "./schemas";
import { blankPage, landingPage, pagesFromStructure, siteT, templatePages, type DraftPage, type TemplateInput } from "./templates";

/**
 * Company websites & landing pages (docs/module-development.md). One site per company; pages and landing pages are
 * typed blocks with draft → scheduled → published, immutable versions and rollback. Permissions marketing.read /
 * marketing.manage; plan feature `feature.website_builder` on create and publish; page counts are plan limits
 * (`sites.pages.max`, `sites.landing_pages.max`). Every write is audited; publishing emits `site.published`.
 */

const FEATURE = "feature.website_builder" as const;

// ───────────── Site ─────────────

export function shapeSite(s: Prisma.SiteGetPayload<object>) {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    locale: s.locale,
    theme: readTheme(s.theme),
    nav: readNav(s.nav),
    footer: readFooter(s.footer),
    seo: readSiteSeo(s.seo),
    online: s.online,
    launchedAt: s.launchedAt,
    customDomain: s.customDomain,
    domainStatus: s.domainStatus,
    domainToken: s.domainToken,
    domainCheckedAt: s.domainCheckedAt,
    domainVerifiedAt: s.domainVerifiedAt,
    domainError: s.domainError,
    updatedAt: s.updatedAt,
  };
}
export type SiteView = ReturnType<typeof shapeSite>;

async function productsOf(client: Tx | ReturnType<typeof db>, organizationId: string, companyId: string) {
  return client.product.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { createdAt: "asc" }, take: 100, select: { id: true, name: true, description: true } });
}

/** The site (or null), page counts and new submissions — the /website overview. */
export async function getSiteOverview(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const site = await db().site.findFirst({ where: { organizationId, companyId } });
  if (!site) return { site: null, pages: [], newSubmissions: 0, totalSubmissions: 0 } as const;
  const [pages, newSubmissions, totalSubmissions] = await Promise.all([
    listPageRows(site.id),
    db().siteFormSubmission.count({ where: { siteId: site.id, status: "NEW" } }),
    db().siteFormSubmission.count({ where: { siteId: site.id } }),
  ]);
  return { site: shapeSite(site), pages, newSubmissions, totalSubmissions } as const;
}

/** Defaults for the guided setup: brand kit colours and fonts, the pinned brand logo, products, Founder Kit structure. */
export async function setupDefaults(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const [company, kit, logo, products, structure] = await Promise.all([
    db().company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { name: true, slug: true, defaultLocale: true } }),
    db().marketingBrandKit.findFirst({ where: { organizationId, companyId }, select: { brandName: true, tagline: true, colors: true, headingFont: true } }),
    db().visualAsset.findFirst({ where: { organizationId, companyId, scopeType: "BRAND", kind: { in: ["IMAGE", "SVG"] } }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], select: { id: true } }),
    productsOf(db(), organizationId, companyId),
    latestStructure(organizationId, companyId),
  ]);
  const colors = (Array.isArray(kit?.colors) ? kit.colors : []) as { hex?: unknown; name?: unknown }[];
  const hexes = colors.map((c) => (typeof c?.hex === "string" && /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex.toLowerCase() : null)).filter((x): x is string => !!x);
  const heading = (kit?.headingFont ?? "").toLowerCase();
  const font = /serif|garamond|playfair|georgia|times|merriweather|lora/.test(heading) && !/sans/.test(heading) ? "classic" : /mono|code/.test(heading) ? "mono" : /sora|display|poppins|montserrat/.test(heading) ? "display" : "modern";
  const base = (company.slug || company.name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "site";
  let slug = base.length >= 3 ? base : `${base}-site`;
  if (!siteSlugSchema.safeParse(slug).success) slug = `${slug}-site`.slice(0, 48);
  if (await db().site.findUnique({ where: { slug }, select: { id: true } })) slug = `${slug.slice(0, 40)}-${randomBytes(2).toString("hex")}`;
  return {
    name: kit?.brandName || company.name,
    tagline: kit?.tagline ?? null,
    slug,
    locale: (SITE_LOCALES as readonly string[]).includes(company.defaultLocale) ? company.defaultLocale : "en-US",
    theme: themeSchema.parse({ brandColor: hexes[0] ?? undefined, accentColor: hexes[1] ?? undefined, font, logoAssetId: logo?.id ?? null }),
    hasBrandKit: !!kit,
    products: products.map((p) => ({ id: p.id, name: p.name })),
    structure: structure ? { runId: structure.runId, pages: structure.pages.length } : null,
  };
}

/** The newest READY Founder Kit "website_structure" deliverable of the company, if any. */
export async function latestStructure(organizationId: string, companyId: string) {
  const item = await db().builderKitItem.findFirst({ where: { organizationId, companyId, key: "website_structure", status: "READY" }, orderBy: { updatedAt: "desc" }, select: { runId: true, data: true } });
  const parsed = item ? websiteSchema.safeParse(item.data) : null;
  return item && parsed?.success ? { runId: item.runId, pages: parsed.data.pages } : null;
}

export const createSiteInput = z.object({
  name: z.string().trim().min(1).max(120),
  slug: siteSlugSchema,
  locale: z.enum(SITE_LOCALES).default("en-US"),
  theme: themeSchema.default(themeSchema.parse({})),
  /** template: starter pages; structure: from the Founder Kit website structure; blank: a home page only; ai: blank, then the AI drafts. */
  start: z.enum(["template", "structure", "blank", "ai"]).default("template"),
  template: z.enum(SITE_TEMPLATES).default("services"),
});

async function templateInput(client: Tx, organizationId: string, companyId: string, name: string): Promise<TemplateInput> {
  const [kit, products] = await Promise.all([client.marketingBrandKit.findFirst({ where: { organizationId, companyId }, select: { tagline: true } }), productsOf(client, organizationId, companyId)]);
  const desc = products[0]?.description ?? null;
  return { companyName: name, tagline: kit?.tagline ?? null, description: desc ? desc.slice(0, 300) : null, products };
}

async function insertPages(tx: Tx, ctx: RequestContext, site: { id: string; organizationId: string; companyId: string }, drafts: DraftPage[], opts: { aiDrafted?: boolean; startPosition?: number } = {}) {
  const ids: string[] = [];
  let position = opts.startPosition ?? 0;
  for (const d of drafts) {
    const row = await tx.sitePage.create({
      data: {
        organizationId: site.organizationId,
        companyId: site.companyId,
        siteId: site.id,
        kind: d.kind,
        slug: d.slug,
        title: d.title.slice(0, 160) || d.slug || "Home",
        draft: json(d.content),
        position: position++,
        showInNav: d.showInNav,
        aiDrafted: !!opts.aiDrafted,
        createdById: actorId(ctx, site.organizationId),
        updatedById: actorId(ctx, site.organizationId),
      },
    });
    ids.push(row.id);
  }
  return ids;
}

/** Guided setup: creates the site with its theme and starter pages (all drafts — nothing is public yet). */
export async function createSite(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof createSiteInput>) {
  const input = createSiteInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  await assertFeature(ctx, organizationId, FEATURE);
  const t = await siteT(input.locale);
  const result = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    if (await tx.site.findFirst({ where: { organizationId, companyId }, select: { id: true } })) throw conflict("This company already has a website", { reason: "sites_exists" });
    if (await tx.site.findUnique({ where: { slug: input.slug }, select: { id: true } })) throw conflict("That address is already taken", { reason: "sites_slug_taken" });
    await assertAsset(tx, organizationId, companyId, input.theme.logoAssetId);
    const site = await tx.site.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        slug: input.slug,
        locale: input.locale,
        theme: json(input.theme),
        nav: json([]),
        footer: json(footerSchema.parse({ text: `© ${new Date().getUTCFullYear()} ${input.name}` })),
        seo: json(siteSeoSchema.parse({ title: input.name.slice(0, 70) })),
        createdById: actorId(ctx, organizationId),
        updatedById: actorId(ctx, organizationId),
      },
    });
    const ti = await templateInput(tx, organizationId, companyId, input.name);
    let drafts: DraftPage[];
    if (input.start === "structure") {
      const structure = await latestStructure(organizationId, companyId);
      if (!structure) throw invalid("Your Founder Kit has no ready website structure yet", { reason: "sites_no_structure" });
      drafts = pagesFromStructure(t, ti, structure);
    } else if (input.start === "template") drafts = templatePages(input.template, t, ti);
    else drafts = [blankPage("", t("sites.tpl.pageHome"), "PAGE")];
    drafts = drafts.slice(0, 15);
    const pageIds = await insertPages(tx, ctx, site, drafts, { aiDrafted: input.start === "structure" });
    await syncNav(tx, site.id);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "site.created", resourceType: "site", resourceId: site.id, newValue: { slug: site.slug, start: input.start, template: input.start === "template" ? input.template : null, pages: pageIds.length } });
    return { id: site.id, slug: site.slug, pageIds, homePageId: pageIds[0] ?? null };
  });
  return result;
}

/** Navigation defaults to the site's pages (kind PAGE, showInNav) in order, unless the founder edited it. */
async function syncNav(tx: Tx, siteId: string) {
  const site = await tx.site.findUnique({ where: { id: siteId }, select: { nav: true } });
  if (!site || readNav(site.nav).length) return;
  const pages = await tx.sitePage.findMany({ where: { siteId, kind: "PAGE", showInNav: true, slug: { not: "" } }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 6, select: { slug: true, title: true } });
  await tx.site.update({ where: { id: siteId }, data: { nav: json(pages.map((p) => ({ label: p.title.slice(0, 40), href: `/${p.slug}` }))) } });
}

export const updateSiteInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: siteSlugSchema.optional(),
  locale: z.enum(SITE_LOCALES).optional(),
  theme: themeSchema.optional(),
  nav: navSchema.optional(),
  footer: footerSchema.optional(),
  seo: siteSeoSchema.optional(),
});

/** Name, address, locale, theme (brand colour, font, logo), navigation, footer and SEO defaults. */
export async function updateSite(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof updateSiteInput>) {
  const input = updateSiteInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const site = await requireSite(tx, organizationId, companyId);
    if (input.slug && input.slug !== site.slug && (await tx.site.findUnique({ where: { slug: input.slug }, select: { id: true } }))) throw conflict("That address is already taken", { reason: "sites_slug_taken" });
    if (input.theme) await assertAsset(tx, organizationId, companyId, input.theme.logoAssetId);
    if (input.seo?.ogImage) await assertAsset(tx, organizationId, companyId, assetIdOf(input.seo.ogImage));
    const updated = await tx.site.update({
      where: { id: site.id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.slug ? { slug: input.slug } : {}),
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.theme ? { theme: json(input.theme) } : {}),
        ...(input.nav ? { nav: json(input.nav) } : {}),
        ...(input.footer ? { footer: json(input.footer) } : {}),
        ...(input.seo ? { seo: json(input.seo) } : {}),
        updatedById: actorId(ctx, organizationId),
      },
    });
    if (input.theme || input.seo) await refreshPublicAssets(tx, site.id);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "site.updated", resourceType: "site", resourceId: site.id, oldValue: input.slug && input.slug !== site.slug ? { slug: site.slug } : undefined, newValue: { fields: Object.keys(input), slug: updated.slug } });
    return { site: shapeSite(updated), previousSlug: site.slug };
  });
}

/** Take the whole site online (published pages become reachable) or offline (every page returns 404). */
export async function setSiteOnline(ctx: RequestContext, organizationId: string, companyId: string, online: boolean) {
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  if (online) await assertFeature(ctx, organizationId, FEATURE);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const site = await requireSite(tx, organizationId, companyId);
    if (online && !(await tx.sitePage.count({ where: { siteId: site.id, status: "PUBLISHED" } }))) throw invalid("Publish at least one page before taking the site online", { reason: "sites_nothing_published" });
    const now = new Date();
    await tx.site.update({ where: { id: site.id }, data: { online, ...(online && !site.launchedAt ? { launchedAt: now } : {}), updatedById: actorId(ctx, organizationId) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: online ? "site.online" : "site.offline", resourceType: "site", resourceId: site.id, newValue: { slug: site.slug } });
    if (online) await emitDomainEvent(tx, ctx, "site.published", { organizationId, companyId, entityType: "site", entityId: site.id, data: { siteId: site.id, slug: site.slug, pageId: null, pagePath: "", kind: "SITE", version: null, firstLaunch: !site.launchedAt } });
    return { slug: site.slug, online };
  });
}

// ───────────── Pages ─────────────

async function listPageRows(siteId: string) {
  const rows = await db().sitePage.findMany({ where: { siteId }, orderBy: [{ kind: "asc" }, { position: "asc" }, { createdAt: "asc" }], take: 300 });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    slug: r.slug,
    title: r.title,
    status: r.status,
    showInNav: r.showInNav,
    aiDrafted: r.aiDrafted,
    publishAt: r.publishAt,
    publishedAt: r.publishedAt,
    liveVersion: r.liveVersion,
    updatedAt: r.updatedAt,
    hasUnpublished: !!r.published && JSON.stringify(readContent(r.published)) !== JSON.stringify(readContent(r.draft)),
    blocks: readContent(r.draft).blocks.length,
  }));
}
export type SitePageRow = Awaited<ReturnType<typeof listPageRows>>[number];

export async function listPages(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const site = await db().site.findFirst({ where: { organizationId, companyId }, select: { id: true } });
  if (!site) throw notFound("Website");
  return { data: await listPageRows(site.id) };
}

export async function getPage(ctx: RequestContext, organizationId: string, companyId: string, pageId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  if (!isUuid(pageId)) throw notFound("Page");
  const row = await db().sitePage.findFirst({
    where: { id: pageId, organizationId, companyId },
    include: { versions: { orderBy: { version: "desc" }, take: 30, select: { id: true, version: true, note: true, createdById: true, createdAt: true } } },
  });
  if (!row) throw notFound("Page");
  const people = await db().user.findMany({ where: { id: { in: [...new Set([row.updatedById, ...row.versions.map((v) => v.createdById)])] } }, select: { id: true, name: true } });
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? null;
  return {
    id: row.id,
    siteId: row.siteId,
    kind: row.kind,
    slug: row.slug,
    title: row.title,
    status: row.status,
    showInNav: row.showInNav,
    aiDrafted: row.aiDrafted,
    draft: readContent(row.draft),
    hasPublished: !!row.published,
    hasUnpublished: !!row.published && JSON.stringify(readContent(row.published)) !== JSON.stringify(readContent(row.draft)),
    publishAt: row.publishAt,
    publishedAt: row.publishedAt,
    liveVersion: row.liveVersion,
    updatedAt: row.updatedAt,
    updatedBy: nameOf(row.updatedById),
    versions: row.versions.map((v) => ({ id: v.id, version: v.version, note: v.note, createdAt: v.createdAt, createdBy: nameOf(v.createdById) })),
  };
}
export type SitePageDetail = Awaited<ReturnType<typeof getPage>>;

const LIMIT_OF: Record<SitePageKind, "sites.pages.max" | "sites.landing_pages.max"> = { PAGE: "sites.pages.max", LANDING: "sites.landing_pages.max" };

export const createPageInput = z.object({
  kind: z.enum(SITE_PAGE_KINDS).default("PAGE"),
  slug: pagePathSchema,
  title: z.string().trim().min(1).max(160),
  /** blank: a title block; landing: a landing page layout with a contact form; duplicate: copy another page's draft. */
  from: z.enum(["blank", "landing", "duplicate"]).default("blank"),
  sourcePageId: z.string().uuid().optional(),
});

export async function createPage(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof createPageInput>) {
  const input = createPageInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  await assertLimit(ctx, organizationId, LIMIT_OF[input.kind], 1);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const site = await requireSite(tx, organizationId, companyId);
    if (await tx.sitePage.findFirst({ where: { siteId: site.id, slug: input.slug }, select: { id: true } })) throw conflict("A page already uses this address", { reason: "sites_page_slug_taken" });
    let draft: DraftPage;
    if (input.from === "duplicate") {
      if (!input.sourcePageId) throw invalid("Choose the page to copy");
      const src = await requirePage(tx, organizationId, companyId, input.sourcePageId);
      draft = { slug: input.slug, title: input.title, kind: input.kind, showInNav: input.kind === "PAGE", content: { ...readContent(src.draft), title: input.title } };
    } else if (input.from === "landing") {
      draft = landingPage(await siteT(site.locale), await templateInput(tx, organizationId, companyId, site.name), input.slug, input.title);
      draft.kind = input.kind;
      draft.showInNav = input.kind === "PAGE";
    } else draft = blankPage(input.slug, input.title, input.kind);
    const last = await tx.sitePage.findFirst({ where: { siteId: site.id }, orderBy: { position: "desc" }, select: { position: true } });
    const [id] = await insertPages(tx, ctx, site, [draft], { startPosition: (last?.position ?? 0) + 1 });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "site.page.created", resourceType: "site_page", resourceId: id!, newValue: { kind: input.kind, slug: input.slug, from: input.from } });
    return { id: id! };
  });
}

export const savePageInput = z.object({
  slug: pagePathSchema.optional(),
  kind: z.enum(SITE_PAGE_KINDS).optional(),
  showInNav: z.boolean().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
  content: pageContentSchema.optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
});

/** Save the draft (and page settings). Optimistic concurrency: a stale editor gets a conflict instead of overwriting. */
export async function savePage(ctx: RequestContext, organizationId: string, companyId: string, pageId: string, raw: z.input<typeof savePageInput>) {
  const input = savePageInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const current = isUuid(pageId) ? await db().sitePage.findFirst({ where: { id: pageId, organizationId, companyId }, select: { kind: true } }) : null;
  if (current && input.kind && input.kind !== current.kind) await assertLimit(ctx, organizationId, LIMIT_OF[input.kind], 1);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const page = await requirePage(tx, organizationId, companyId, pageId);
    if (input.expectedUpdatedAt && page.updatedAt.toISOString() !== input.expectedUpdatedAt) throw conflict("Someone else saved this page in the meantime. Reload to see their changes.", { reason: "sites_stale_draft" });
    if (input.slug !== undefined && input.slug !== page.slug && (await tx.sitePage.findFirst({ where: { siteId: page.siteId, slug: input.slug }, select: { id: true } }))) throw conflict("A page already uses this address", { reason: "sites_page_slug_taken" });
    if (input.content) await assertReferences(tx, organizationId, companyId, input.content);
    const updated = await tx.sitePage.update({
      where: { id: page.id },
      data: {
        ...(input.content ? { draft: json(input.content), title: input.content.title || page.title, aiDrafted: false } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
        ...(input.showInNav !== undefined ? { showInNav: input.showInNav } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        updatedById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "site.page.draft_saved", resourceType: "site_page", resourceId: page.id, oldValue: input.slug !== undefined && input.slug !== page.slug ? { slug: page.slug } : undefined, newValue: { slug: updated.slug, kind: updated.kind, blocks: input.content?.blocks.length } });
    return { id: page.id, updatedAt: updated.updatedAt.toISOString(), slugChanged: input.slug !== undefined && input.slug !== page.slug && !!page.published };
  });
}

export const pageActionInput = z.object({
  note: z.string().trim().max(300).default(""),
  publishAt: z.string().datetime().optional(),
  version: z.coerce.number().int().min(1).optional(),
  /** rollback: also publish the restored version. */
  publish: z.boolean().optional(),
});
export const PAGE_ACTIONS = ["publish", "schedule", "unpublish", "cancel_schedule", "rollback"] as const;
export type PageAction = (typeof PAGE_ACTIONS)[number];

const snapshotOf = (page: { title: string }, c: PageContent): PageContent => ({ ...c, title: c.title || page.title });

async function takeVersion(tx: Tx, ctx: RequestContext, page: { id: string; organizationId: string; companyId: string }, content: PageContent, note: string) {
  const last = await tx.sitePageVersion.findFirst({ where: { pageId: page.id }, orderBy: { version: "desc" }, select: { version: true } });
  const version = (last?.version ?? 0) + 1;
  await tx.sitePageVersion.create({ data: { organizationId: page.organizationId, companyId: page.companyId, pageId: page.id, version, content: json(content), note, createdById: actorId(ctx, page.organizationId) } });
  return version;
}

/** Emits site.published for a page that just went live (also used by the scheduler). */
export async function emitPagePublished(tx: Tx, ctx: RequestContext, page: { id: string; organizationId: string; companyId: string; siteId: string; slug: string; kind: string }, version: number | null, siteSlug: string) {
  await emitDomainEvent(tx, ctx, "site.published", { organizationId: page.organizationId, companyId: page.companyId, entityType: "site_page", entityId: page.id, data: { siteId: page.siteId, slug: siteSlug, pageId: page.id, pagePath: page.slug, kind: page.kind, version, firstLaunch: false } });
}

/** Publish now, schedule, unpublish, cancel a schedule, or roll back to an earlier version. */
export async function pageAction(ctx: RequestContext, organizationId: string, companyId: string, pageId: string, action: PageAction, raw: z.input<typeof pageActionInput>) {
  const input = pageActionInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  if (action === "publish" || action === "schedule" || (action === "rollback" && input.publish)) await assertFeature(ctx, organizationId, FEATURE);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const page = await requirePage(tx, organizationId, companyId, pageId);
    const site = await tx.site.findUniqueOrThrow({ where: { id: page.siteId }, select: { slug: true, online: true } });
    const draft = snapshotOf(page, readContent(page.draft));
    const requireContent = () => {
      if (!draft.blocks.length) throw invalid("Add at least one block before publishing", { reason: "sites_page_empty" });
    };
    let data: Prisma.SitePageUpdateInput;
    let audit: Record<string, unknown> = {};
    let published: number | null | undefined;
    switch (action) {
      case "publish": {
        requireContent();
        await assertReferences(tx, organizationId, companyId, draft);
        const version = await takeVersion(tx, ctx, page, draft, input.note);
        data = { status: "PUBLISHED", published: json(draft), pending: Prisma.DbNull, publishAt: null, publishedAt: new Date(), liveVersion: version, title: draft.title };
        audit = { version };
        published = version;
        break;
      }
      case "schedule": {
        requireContent();
        await assertReferences(tx, organizationId, companyId, draft);
        const at = input.publishAt ? new Date(input.publishAt) : null;
        if (!at || at.getTime() < Date.now() + 60_000) throw invalid("Pick a publish time at least a minute from now", { reason: "sites_schedule_past" });
        const version = await takeVersion(tx, ctx, page, draft, input.note);
        data = { status: "SCHEDULED", pending: json({ ...draft, version }), publishAt: at };
        audit = { version, publishAt: at.toISOString() };
        break;
      }
      case "cancel_schedule":
        if (page.status !== "SCHEDULED") throw conflict("This page is not scheduled");
        data = { status: page.published ? "PUBLISHED" : "DRAFT", pending: Prisma.DbNull, publishAt: null };
        break;
      case "unpublish":
        data = { status: "DRAFT", published: Prisma.DbNull, pending: Prisma.DbNull, publishAt: null, liveVersion: null };
        break;
      case "rollback": {
        if (!input.version) throw invalid("Choose a version to restore");
        const v = await tx.sitePageVersion.findUnique({ where: { pageId_version: { pageId: page.id, version: input.version } } });
        if (!v) throw notFound("Version");
        const content = readContent(v.content);
        if (input.publish) await assertReferences(tx, organizationId, companyId, content);
        data = input.publish
          ? { draft: json(content), status: "PUBLISHED", published: json(content), pending: Prisma.DbNull, publishAt: null, publishedAt: new Date(), liveVersion: v.version, title: content.title || page.title }
          : { draft: json(content), title: content.title || page.title };
        audit = { version: v.version, published: !!input.publish };
        if (input.publish) published = v.version;
        break;
      }
    }
    await tx.sitePage.update({ where: { id: page.id }, data: { ...data, updatedById: actorId(ctx, organizationId) } });
    await refreshPublicAssets(tx, page.siteId);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `site.page.${action}`, resourceType: "site_page", resourceId: page.id, oldValue: { status: page.status, liveVersion: page.liveVersion }, newValue: { slug: page.slug, ...audit }, reason: input.note || null });
    if (published !== undefined) await emitPagePublished(tx, ctx, page, published, site.slug);
    return { id: page.id, action, siteSlug: site.slug, siteOnline: site.online };
  });
}

export async function deletePage(ctx: RequestContext, organizationId: string, companyId: string, pageId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const page = await requirePage(tx, organizationId, companyId, pageId);
    const site = await tx.site.findUniqueOrThrow({ where: { id: page.siteId }, select: { slug: true } });
    await tx.sitePage.delete({ where: { id: page.id } });
    await refreshPublicAssets(tx, page.siteId);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "site.page.deleted", resourceType: "site_page", resourceId: page.id, oldValue: { slug: page.slug, kind: page.kind, status: page.status } });
    return { id: page.id, siteSlug: site.slug };
  });
}

// ───────────── Editor data ─────────────

/** What the block editor can reference: images of the asset library, CRM customers (testimonials) and products (pricing). */
export async function editorData(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const [assets, customers, products] = await Promise.all([
    db().visualAsset.findMany({ where: { organizationId, companyId, kind: { in: ["IMAGE", "SVG"] } }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 120, select: { id: true, title: true, scopeType: true } }),
    db().account.findMany({ where: { organizationId, companyId, type: "CUSTOMER", archivedAt: null }, orderBy: { name: "asc" }, take: 300, select: { id: true, name: true } }),
    productsOf(db(), organizationId, companyId),
  ]);
  return { assets, customers, products: products.map((p) => ({ id: p.id, name: p.name, description: p.description ?? "" })) };
}
export type SiteEditorData = Awaited<ReturnType<typeof editorData>>;

// ───────────── Scheduler (worker) ─────────────

/** Promote scheduled pages whose time has come (every minute). Idempotent: conditional updates. */
export async function publishScheduledPages(): Promise<number> {
  const { systemContext } = await import("@/server/core/context");
  const due = await db().sitePage.findMany({ where: { status: "SCHEDULED", publishAt: { lte: new Date() } }, take: 100, select: { id: true } });
  let n = 0;
  for (const { id } of due) {
    const ctx = systemContext();
    const done = await transaction(async (tx) => {
      const page = await tx.sitePage.findUnique({ where: { id } });
      if (!page || page.status !== "SCHEDULED" || !page.pending || !page.publishAt || page.publishAt > new Date()) return false;
      const version = (page.pending as { version?: unknown }).version;
      const content = readContent(page.pending);
      const r = await tx.sitePage.updateMany({
        where: { id, status: "SCHEDULED", publishAt: page.publishAt },
        data: { status: "PUBLISHED", published: json(content), pending: Prisma.DbNull, publishedAt: page.publishAt, liveVersion: typeof version === "number" ? version : page.liveVersion, title: content.title || page.title },
      });
      if (!r.count) return false;
      const site = await tx.site.findUniqueOrThrow({ where: { id: page.siteId }, select: { slug: true } });
      await refreshPublicAssets(tx, page.siteId);
      await writeAudit(tx, ctx, { category: "TENANT", organizationId: page.organizationId, action: "site.page.scheduled_published", resourceType: "site_page", resourceId: id, newValue: { slug: page.slug, version } });
      await emitPagePublished(tx, ctx, page, typeof version === "number" ? version : null, site.slug);
      return true;
    });
    if (done) n++;
  }
  return n;
}

// ───────────── AI drafts (draft_site_pages tool) ─────────────

/**
 * Write AI-drafted pages as DRAFTS: a new page is created (within plan limits); an existing page gets a new draft
 * (its live version, if any, stays online until a person publishes). Nothing is ever published by the AI.
 */
export async function upsertDraftPages(ctx: RequestContext, organizationId: string, companyId: string, drafts: DraftPage[]) {
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const site = await db().site.findFirst({ where: { organizationId, companyId }, select: { id: true, slug: true } });
  if (!site) throw notFound("Website");
  const existing = await db().sitePage.findMany({ where: { siteId: site.id, slug: { in: drafts.map((d) => d.slug) } }, select: { slug: true } });
  const known = new Set(existing.map((e) => e.slug));
  const newCount = { PAGE: 0, LANDING: 0 };
  for (const d of drafts) if (!known.has(d.slug)) newCount[d.kind]++;
  if (newCount.PAGE) await assertLimit(ctx, organizationId, "sites.pages.max", newCount.PAGE);
  if (newCount.LANDING) await assertLimit(ctx, organizationId, "sites.landing_pages.max", newCount.LANDING);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const out: { id: string; slug: string; created: boolean }[] = [];
    const last = await tx.sitePage.findFirst({ where: { siteId: site.id }, orderBy: { position: "desc" }, select: { position: true } });
    let position = (last?.position ?? 0) + 1;
    for (const d of drafts) {
      await assertReferences(tx, organizationId, companyId, d.content);
      const row = await tx.sitePage.findFirst({ where: { siteId: site.id, slug: d.slug } });
      if (row) {
        await tx.sitePage.update({ where: { id: row.id }, data: { draft: json(d.content), title: d.title.slice(0, 160), aiDrafted: true, updatedById: actorId(ctx, organizationId) } });
        out.push({ id: row.id, slug: d.slug, created: false });
      } else {
        const [id] = await insertPages(tx, ctx, { id: site.id, organizationId, companyId }, [d], { aiDrafted: true, startPosition: position++ });
        out.push({ id: id!, slug: d.slug, created: true });
      }
    }
    await syncNav(tx, site.id);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "site.pages.ai_drafted", resourceType: "site", resourceId: site.id, newValue: { pages: out.map((p) => ({ slug: p.slug, created: p.created })) } });
    return { siteSlug: site.slug, pages: out };
  });
}
