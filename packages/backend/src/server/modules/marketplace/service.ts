import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { MarketplaceListingStatus } from "@/generated/prisma/enums";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { orgChain, platformChain } from "@/server/modules/rbac/scope";
import { slugify } from "@/server/modules/organizations/service";
import { BUILTIN_LISTINGS, BUILTIN_PUBLISHER, builtinKey } from "./catalog";
import { compareVersions, LISTING_CATEGORIES, LISTING_TYPES, manifestSchema, parseManifest, PRICING_MODELS, SEMVER, type ListingType, type Manifest } from "./manifest";

export const PAGE_SIZE = 24;
export const SORTS = ["popular", "rating", "newest", "name"] as const;
export type ListingSort = (typeof SORTS)[number];
/** Publisher slugs that would collide with marketplace routes. */
const RESERVED_SLUGS = new Set(["realy", "installed", "publish", "review", "publishers", "api", "admin"]);

export interface ListingVersionView {
  version: string;
  releasedAt: Date;
  changelog: string;
  manifest: Manifest;
}

export interface ListingView {
  key: string;
  id: string | null;
  builtin: boolean;
  slug: string;
  publisher: {
    slug: string;
    name: string;
    verified: boolean;
    organizationId: string | null;
  };
  type: ListingType;
  category: string;
  tags: string[];
  name: string;
  summary: string;
  description: string;
  iconUrl: string | null;
  status: MarketplaceListingStatus;
  pricingModel: (typeof PRICING_MODELS)[number];
  priceMinor: bigint | null;
  currency: string | null;
  latestVersion: string | null;
  versions: ListingVersionView[];
  ratingAvg: number;
  ratingCount: number;
  installCount: number;
  createdAt: Date;
  reviewNote: string | null;
}

/** Translations for built-in names/summaries (search matches the viewer's language too). */
export type CatalogText = (slug: string) => { name: string; summary: string };

function builtinViews(text?: CatalogText): ListingView[] {
  return BUILTIN_LISTINGS.map((l) => {
    const versions = [...l.versions]
      .map((v) => ({
        version: v.version,
        releasedAt: new Date(v.releasedAt),
        changelog: v.changelog,
        manifest: parseManifest(v.manifest),
      }))
      .sort((a, b) => compareVersions(b.version, a.version));
    const localized = text?.(l.slug);
    return {
      key: builtinKey(l.slug),
      id: null,
      builtin: true,
      slug: l.slug,
      publisher: {
        slug: BUILTIN_PUBLISHER.slug,
        name: BUILTIN_PUBLISHER.name,
        verified: true,
        organizationId: null,
      },
      type: l.type,
      category: l.category,
      tags: l.tags,
      name: localized?.name ?? l.name,
      summary: localized?.summary ?? l.summary,
      description: "",
      iconUrl: null,
      status: "PUBLISHED",
      pricingModel: "FREE",
      priceMinor: null,
      currency: null,
      latestVersion: versions[0]?.version ?? null,
      versions,
      ratingAvg: 0,
      ratingCount: 0,
      installCount: 0,
      createdAt: new Date(l.createdAt),
      reviewNote: null,
    };
  });
}

/** Live = approved at least once and not archived (stays browsable while a new version is in review). */
const LIVE = {
  latestVersion: { not: null },
  status: { not: "ARCHIVED" },
} satisfies Prisma.MarketplaceListingWhereInput;
export const isLive = (l: Pick<ListingView, "latestVersion" | "status">) => l.latestVersion !== null && l.status !== "ARCHIVED";

const listingInclude = {
  publisher: true,
  versions: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.MarketplaceListingInclude;
type ListingRow = Prisma.MarketplaceListingGetPayload<{
  include: typeof listingInclude;
}>;

/** `full` (publisher/reviewer) includes versions not yet approved; installers see versions up to `latestVersion`. */
function dbView(r: ListingRow, full = false): ListingView {
  const versions = r.versions
    .filter((v) => full || (r.latestVersion !== null && compareVersions(v.version, r.latestVersion) <= 0))
    .map((v) => ({
      version: v.version,
      releasedAt: v.createdAt,
      changelog: v.changelog,
      manifest: parseManifest(v.manifest),
    }))
    .sort((a, b) => compareVersions(b.version, a.version));
  return {
    key: r.listingKey,
    id: r.id,
    builtin: false,
    slug: r.listingKey.split("/")[1] ?? r.listingKey,
    publisher: {
      slug: r.publisher.slug,
      name: r.publisher.name,
      verified: r.publisher.verified,
      organizationId: r.publisher.organizationId,
    },
    type: r.type,
    category: r.category,
    tags: r.tags,
    name: r.name,
    summary: r.summary,
    description: r.description,
    iconUrl: r.iconUrl,
    status: r.status,
    pricingModel: r.pricingModel,
    priceMinor: r.priceMinor,
    currency: r.currency,
    latestVersion: r.latestVersion,
    versions,
    ratingAvg: 0,
    ratingCount: 0,
    installCount: 0,
    createdAt: r.publishedAt ?? r.createdAt,
    reviewNote: r.reviewNote,
  };
}

/** Attach rating and active-install aggregates (across all organizations). */
async function withStats(client: Tx | Db, views: ListingView[]): Promise<ListingView[]> {
  const keys = views.map((v) => v.key);
  if (!keys.length) return views;
  const [ratings, installs] = await Promise.all([
    client.marketplaceReview.groupBy({
      by: ["listingKey"],
      where: { listingKey: { in: keys } },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    client.marketplaceInstallation.groupBy({
      by: ["listingKey"],
      where: { listingKey: { in: keys }, status: "ACTIVE" },
      _count: { _all: true },
    }),
  ]);
  const r = new Map(ratings.map((x) => [x.listingKey, x]));
  const i = new Map(installs.map((x) => [x.listingKey, x._count._all]));
  return views.map((v) => ({
    ...v,
    ratingAvg: r.get(v.key)?._avg.rating ?? 0,
    ratingCount: r.get(v.key)?._count._all ?? 0,
    installCount: i.get(v.key) ?? 0,
  }));
}

export interface ListingFilters {
  q?: string;
  type?: ListingType;
  category?: string;
  pricing?: "free" | "paid";
  sort: ListingSort;
  page: number;
}

export function parseListingFilters(raw: Record<string, string | string[] | undefined>): ListingFilters {
  const one = (k: string) => {
    const v = raw[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const type = one("type");
  const category = one("category");
  const pricing = one("pricing");
  const sort = one("sort");
  const page = Number(one("page") ?? "1");
  return {
    q: one("q")?.slice(0, 120),
    type: (LISTING_TYPES as readonly string[]).includes(type ?? "") ? (type as ListingType) : undefined,
    category: (LISTING_CATEGORIES as readonly string[]).includes(category ?? "") ? category : undefined,
    pricing: pricing === "free" || pricing === "paid" ? pricing : undefined,
    sort: (SORTS as readonly string[]).includes(sort ?? "") ? (sort as ListingSort) : "popular",
    page: Number.isInteger(page) && page > 0 && page < 1000 ? page : 1,
  };
}

/** All published listings (built-in catalog + organizations'), with stats. */
export async function allPublishedListings(text?: CatalogText): Promise<ListingView[]> {
  const rows = await db().marketplaceListing.findMany({
    where: LIVE,
    include: listingInclude,
    take: 1000,
  });
  return withStats(db(), [...builtinViews(text), ...rows.map((r) => dbView(r))]);
}

/** Browse the marketplace: search, filters, sort and pagination over the merged catalog. */
export async function searchListings(ctx: RequestContext, organizationId: string, filters: ListingFilters, text?: CatalogText) {
  await requirePermission(ctx, "marketplace.read", orgChain(organizationId));
  let all = await allPublishedListings(text);
  if (filters.type) all = all.filter((l) => l.type === filters.type);
  if (filters.category) all = all.filter((l) => l.category === filters.category);
  if (filters.pricing) all = all.filter((l) => (filters.pricing === "free" ? l.pricingModel === "FREE" : l.pricingModel !== "FREE"));
  if (filters.q) {
    const q = filters.q.toLowerCase();
    all = all.filter((l) => [l.name, l.summary, l.description, l.publisher.name, ...l.tags].some((s) => s.toLowerCase().includes(q)));
  }
  const sorters: Record<ListingSort, (a: ListingView, b: ListingView) => number> = {
    popular: (a, b) => b.installCount - a.installCount || b.ratingCount - a.ratingCount || a.name.localeCompare(b.name),
    rating: (a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount,
    newest: (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  all.sort(sorters[filters.sort]);
  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(filters.page, pages);
  return {
    data: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total,
    page,
    pages,
  };
}

/** Resolve a listing by key. Unpublished DB listings are visible only to their publisher's organization (and reviewers). */
export async function resolveListing(client: Tx | Db, key: string, viewerOrgId: string | null, opts: { reviewer?: boolean; text?: CatalogText } = {}): Promise<ListingView | null> {
  const [publisher, slug] = key.split("/");
  if (!publisher || !slug) return null;
  if (publisher === BUILTIN_PUBLISHER.slug) return builtinViews(opts.text).find((l) => l.slug === slug) ?? null;
  const row = await client.marketplaceListing.findUnique({
    where: { listingKey: key },
    include: listingInclude,
  });
  if (!row) return null;
  const privileged = row.organizationId === viewerOrgId || !!opts.reviewer;
  if (!privileged && (row.latestVersion === null || row.status === "ARCHIVED")) return null;
  return dbView(row, privileged);
}

async function isReviewer(ctx: RequestContext) {
  return (await can(ctx, "platform.content.manage", platformChain())) || (await can(ctx, "platform.organizations.manage", platformChain()));
}

export async function getListing(ctx: RequestContext, organizationId: string, key: string, text?: CatalogText) {
  await requirePermission(ctx, "marketplace.read", orgChain(organizationId));
  // Customer view (user app): a listing is visible to its own organization or once live. Reviewing unpublished
  // listings of other organizations is a platform-admin function (Control Center → Marketplace).
  const listing = await resolveListing(db(), key, organizationId, { text });
  if (!listing) throw notFound("Listing");
  const [withAgg] = await withStats(db(), [listing]);
  const reviews = await db().marketplaceReview.findMany({
    where: { listingKey: key },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const distribution = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: reviews.filter((r) => r.rating === stars).length,
  }));
  return { listing: withAgg!, reviews, distribution };
}

// ───────────── Reviews ─────────────

export const reviewInput = z.object({
  listingKey: z.string().min(3).max(140),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).default(""),
  body: z.string().trim().max(4000).default(""),
});

/** One review per user per listing (upsert); requires the listing to be installed in one of the organization's companies. */
export async function upsertReview(ctx: RequestContext, organizationId: string, raw: z.input<typeof reviewInput>) {
  const input = reviewInput.parse(raw);
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw forbidden("Only people can write reviews");
  const userId = ctx.actor.id;
  return transaction(async (tx) => {
    await requirePermission(ctx, "marketplace.read", orgChain(organizationId), tx);
    const listing = await resolveListing(tx, input.listingKey, organizationId);
    if (!listing || !isLive(listing)) throw notFound("Listing");
    if (listing.publisher.organizationId === organizationId)
      throw forbidden("Publishers cannot review their own listings", {
        reason: "marketplace_own_listing",
      });
    const installed = await tx.marketplaceInstallation.findFirst({
      where: { organizationId, listingKey: input.listingKey },
      select: { id: true },
    });
    if (!installed) throw new AppError("not_available", "Install the listing before reviewing it", { reason: "marketplace_review_requires_install" });
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true },
    });
    const review = await tx.marketplaceReview.upsert({
      where: { listingKey_userId: { listingKey: input.listingKey, userId } },
      create: {
        listingKey: input.listingKey,
        organizationId,
        userId,
        authorName: user.name,
        rating: input.rating,
        title: input.title,
        body: input.body,
      },
      update: {
        rating: input.rating,
        title: input.title,
        body: input.body,
        authorName: user.name,
      },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "marketplace.review_saved",
      resourceType: "marketplace_review",
      resourceId: review.id,
      newValue: { listingKey: input.listingKey, rating: input.rating },
    });
    return review;
  });
}

export async function deleteReview(ctx: RequestContext, organizationId: string, reviewId: string) {
  await transaction(async (tx) => {
    await requirePermission(ctx, "marketplace.read", orgChain(organizationId), tx);
    const r = await tx.marketplaceReview.findFirst({
      where: { id: reviewId, userId: ctx.actor.id ?? "" },
    });
    if (!r) throw notFound("Review");
    await tx.marketplaceReview.delete({ where: { id: r.id } });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "marketplace.review_deleted",
      resourceType: "marketplace_review",
      resourceId: r.id,
    });
  });
}

// ───────────── Publishers ─────────────

export const publisherInput = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}$/, "lowercase letters, digits and -"),
  description: z.string().trim().max(2000).default(""),
  website: z
    .string()
    .trim()
    .url()
    .max(300)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  logoUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export async function getMyPublisher(ctx: RequestContext, organizationId: string) {
  await requirePermission(ctx, "marketplace.read", orgChain(organizationId));
  return db().marketplacePublisher.findUnique({ where: { organizationId } });
}

export async function upsertPublisher(ctx: RequestContext, organizationId: string, raw: z.input<typeof publisherInput>) {
  const input = publisherInput.parse(raw);
  if (RESERVED_SLUGS.has(input.slug))
    throw invalid("This publisher handle is reserved", {
      reason: "marketplace_slug_taken",
    });
  return transaction(async (tx) => {
    await requirePermission(ctx, "organizations.manage", orgChain(organizationId), tx);
    const existing = await tx.marketplacePublisher.findUnique({
      where: { organizationId },
    });
    const taken = await tx.marketplacePublisher.findUnique({
      where: { slug: input.slug },
    });
    if (taken && taken.organizationId !== organizationId) throw conflict("Handle taken", { reason: "marketplace_slug_taken" });
    if (
      existing &&
      existing.slug !== input.slug &&
      (await tx.marketplaceListing.count({
        where: { publisherId: existing.id },
      }))
    ) {
      throw invalid("The handle cannot change once listings exist", {
        reason: "marketplace_slug_locked",
      });
    }
    const data = {
      name: input.name,
      slug: input.slug,
      description: input.description,
      website: input.website ?? null,
      logoUrl: input.logoUrl ?? null,
    };
    const p = existing
      ? await tx.marketplacePublisher.update({
          where: { id: existing.id },
          data,
        })
      : await tx.marketplacePublisher.create({
          data: {
            ...data,
            organizationId,
            createdById: ctx.actor.id ?? organizationId,
          },
        });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: existing ? "marketplace.publisher_updated" : "marketplace.publisher_created",
      resourceType: "marketplace_publisher",
      resourceId: p.id,
      oldValue: existing ?? undefined,
      newValue: data,
    });
    return p;
  });
}

/** Public publisher profile with its published listings. */
export async function getPublisherProfile(ctx: RequestContext, organizationId: string, slug: string, text?: CatalogText) {
  await requirePermission(ctx, "marketplace.read", orgChain(organizationId));
  const all = await allPublishedListings(text);
  if (slug === BUILTIN_PUBLISHER.slug) {
    return {
      publisher: {
        ...BUILTIN_PUBLISHER,
        description: BUILTIN_PUBLISHER.description,
        logoUrl: null as string | null,
        createdAt: null as Date | null,
        builtin: true,
      },
      listings: all.filter((l) => l.builtin),
    };
  }
  const p = await db().marketplacePublisher.findUnique({ where: { slug } });
  if (!p) throw notFound("Publisher");
  return {
    publisher: {
      slug: p.slug,
      name: p.name,
      description: p.description,
      website: p.website,
      verified: p.verified,
      logoUrl: p.logoUrl,
      createdAt: p.createdAt as Date | null,
      builtin: false,
    },
    listings: all.filter((l) => l.publisher.slug === p.slug),
  };
}

// ───────────── Publishing (organization admins) ─────────────

const money = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/);
export const listingInput = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{1,58}$/)
      .optional(),
    name: z.string().trim().min(2).max(120),
    type: z.enum(LISTING_TYPES),
    category: z.enum(LISTING_CATEGORIES),
    summary: z.string().trim().min(10).max(240),
    description: z.string().trim().max(10000).default(""),
    tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10).default([]),
    iconUrl: z
      .string()
      .trim()
      .url()
      .max(500)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    pricingModel: z.enum(PRICING_MODELS).default("FREE"),
    /** Major units ("49.00"); required unless FREE. */
    price: money.optional().or(z.literal("").transform(() => undefined)),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional()
      .or(z.literal("").transform(() => undefined)),
  })
  .superRefine((v, c) => {
    if (v.pricingModel !== "FREE" && (!v.price || !v.currency))
      c.addIssue({
        code: "custom",
        path: ["price"],
        message: "Price and currency are required for paid listings",
      });
  });
export const versionInput = z.object({
  version: z.string().regex(SEMVER, "Use MAJOR.MINOR.PATCH"),
  changelog: z.string().trim().max(4000).default(""),
  manifest: manifestSchema,
});
export const reviewDecisionInput = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(2000).optional(),
});

async function requirePublisher(tx: Tx, organizationId: string) {
  const p = await tx.marketplacePublisher.findUnique({
    where: { organizationId },
  });
  if (!p)
    throw invalid("Create a publisher profile first", {
      reason: "marketplace_no_publisher",
    });
  return p;
}

const toMinor = (v?: string) => (v ? BigInt(Math.round(Number(v) * 100)) : null);

export async function listOwnListings(ctx: RequestContext, organizationId: string) {
  await requirePermission(ctx, "marketplace.read", orgChain(organizationId));
  const rows = await db().marketplaceListing.findMany({
    where: { organizationId },
    include: listingInclude,
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return withStats(
    db(),
    rows.map((r) => dbView(r, true)),
  );
}

export async function getOwnListing(ctx: RequestContext, organizationId: string, listingId: string) {
  await requirePermission(ctx, "marketplace.read", orgChain(organizationId));
  if (!z.string().uuid().safeParse(listingId).success) throw notFound("Listing");
  const row = await db().marketplaceListing.findFirst({
    where: { id: listingId, organizationId },
    include: listingInclude,
  });
  if (!row) throw notFound("Listing");
  return dbView(row, true);
}

export async function createListing(ctx: RequestContext, organizationId: string, raw: z.input<typeof listingInput>) {
  const input = listingInput.parse(raw);
  return transaction(async (tx) => {
    await requirePermission(ctx, "organizations.manage", orgChain(organizationId), tx);
    const publisher = await requirePublisher(tx, organizationId);
    const key = `${publisher.slug}/${input.slug ?? slugify(input.name)}`;
    if (await tx.marketplaceListing.findUnique({ where: { listingKey: key } }))
      throw conflict("A listing with this handle exists", {
        reason: "marketplace_slug_taken",
      });
    const row = await tx.marketplaceListing.create({
      data: {
        publisherId: publisher.id,
        organizationId,
        listingKey: key,
        type: input.type,
        category: input.category,
        name: input.name,
        summary: input.summary,
        description: input.description,
        tags: input.tags,
        iconUrl: input.iconUrl ?? null,
        pricingModel: input.pricingModel,
        priceMinor: input.pricingModel === "FREE" ? null : toMinor(input.price),
        currency: input.pricingModel === "FREE" ? null : (input.currency ?? null),
        createdById: ctx.actor.id ?? organizationId,
      },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "marketplace.listing_created",
      resourceType: "marketplace_listing",
      resourceId: row.id,
      newValue: { key, name: row.name, type: row.type },
    });
    return row;
  });
}

async function ownRow(tx: Tx, organizationId: string, listingId: string) {
  if (!z.string().uuid().safeParse(listingId).success) throw notFound("Listing");
  const row = await tx.marketplaceListing.findFirst({
    where: { id: listingId, organizationId },
    include: { versions: true },
  });
  if (!row) throw notFound("Listing");
  return row;
}

export async function updateListing(ctx: RequestContext, organizationId: string, listingId: string, raw: z.input<typeof listingInput>) {
  const input = listingInput.parse(raw);
  return transaction(async (tx) => {
    await requirePermission(ctx, "organizations.manage", orgChain(organizationId), tx);
    const row = await ownRow(tx, organizationId, listingId);
    if (row.status === "ARCHIVED") throw invalid("Archived listings cannot be edited");
    const status: MarketplaceListingStatus = row.status === "REJECTED" ? "DRAFT" : row.status;
    const data = {
      type: input.type,
      category: input.category,
      name: input.name,
      summary: input.summary,
      description: input.description,
      tags: input.tags,
      iconUrl: input.iconUrl ?? null,
      pricingModel: input.pricingModel,
      priceMinor: input.pricingModel === "FREE" ? null : toMinor(input.price),
      currency: input.pricingModel === "FREE" ? null : (input.currency ?? null),
      status,
    };
    const updated = await tx.marketplaceListing.update({
      where: { id: row.id },
      data,
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "marketplace.listing_updated",
      resourceType: "marketplace_listing",
      resourceId: row.id,
      oldValue: { name: row.name, status: row.status },
      newValue: data,
    });
    return updated;
  });
}

export async function addListingVersion(ctx: RequestContext, organizationId: string, listingId: string, raw: z.input<typeof versionInput>) {
  const input = versionInput.parse(raw);
  return transaction(async (tx) => {
    await requirePermission(ctx, "organizations.manage", orgChain(organizationId), tx);
    const row = await ownRow(tx, organizationId, listingId);
    if (row.status === "ARCHIVED") throw invalid("Archived listings cannot get new versions");
    if (row.versions.some((v) => compareVersions(v.version, input.version) >= 0)) {
      throw invalid("The version must be higher than every existing version", {
        reason: "marketplace_version_not_higher",
      });
    }
    const unknownRoles = input.manifest.roles.flatMap((r) => r.permissions).filter((p) => p.startsWith("platform."));
    if (unknownRoles.length) throw invalid("Roles cannot include platform permissions");
    const v = await tx.marketplaceListingVersion.create({
      data: {
        listingId: row.id,
        version: input.version,
        changelog: input.changelog,
        manifest: input.manifest as unknown as Prisma.InputJsonValue,
      },
    });
    // A new version reaches installers only after review (installers see versions up to latestVersion).
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "marketplace.version_added",
      resourceType: "marketplace_listing",
      resourceId: row.id,
      newValue: { version: input.version },
    });
    return v;
  });
}

export async function submitListing(ctx: RequestContext, organizationId: string, listingId: string) {
  return transaction(async (tx) => {
    await requirePermission(ctx, "organizations.manage", orgChain(organizationId), tx);
    const row = await ownRow(tx, organizationId, listingId);
    if (!row.versions.length)
      throw invalid("Add a version before submitting", {
        reason: "marketplace_no_version",
      });
    const pendingVersion = row.versions.some((v) => row.latestVersion === null || compareVersions(v.version, row.latestVersion) > 0);
    const submittable = row.status === "DRAFT" || row.status === "REJECTED" || (row.status === "PUBLISHED" && pendingVersion);
    if (!submittable) throw conflict("Nothing to submit", { reason: "marketplace_not_draft" });
    const updated = await tx.marketplaceListing.update({
      where: { id: row.id },
      data: { status: "IN_REVIEW", submittedAt: new Date(), reviewNote: null },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "marketplace.listing_submitted",
      resourceType: "marketplace_listing",
      resourceId: row.id,
    });
    return updated;
  });
}

export async function archiveListing(ctx: RequestContext, organizationId: string, listingId: string) {
  return transaction(async (tx) => {
    await requirePermission(ctx, "organizations.manage", orgChain(organizationId), tx);
    const row = await ownRow(tx, organizationId, listingId);
    const updated = await tx.marketplaceListing.update({
      where: { id: row.id },
      data: { status: "ARCHIVED" },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "marketplace.listing_archived",
      resourceType: "marketplace_listing",
      resourceId: row.id,
      oldValue: { status: row.status },
    });
    return updated;
  });
}

// ───────────── Platform review ─────────────

export async function requireReviewer(ctx: RequestContext) {
  if (!(await isReviewer(ctx))) await requirePermission(ctx, "platform.content.manage", platformChain());
}

export async function listReviewQueue(ctx: RequestContext) {
  await requireReviewer(ctx);
  const rows = await db().marketplaceListing.findMany({
    where: { status: "IN_REVIEW" },
    include: listingInclude,
    orderBy: { submittedAt: "asc" },
    take: 200,
  });
  return rows.map((r) => dbView(r, true));
}

export async function decideListing(ctx: RequestContext, listingId: string, raw: z.input<typeof reviewDecisionInput>) {
  const input = reviewDecisionInput.parse(raw);
  await requireReviewer(ctx);
  return transaction(async (tx) => {
    if (!z.string().uuid().safeParse(listingId).success) throw notFound("Listing");
    const row = await tx.marketplaceListing.findUnique({
      where: { id: listingId },
      include: { versions: true },
    });
    if (!row || row.status !== "IN_REVIEW") throw notFound("Listing");
    const latest = [...row.versions].sort((a, b) => compareVersions(b.version, a.version))[0];
    const approve = input.decision === "approve";
    if (!approve && !input.note)
      throw invalid("Explain why the listing is rejected", {
        reason: "marketplace_note_required",
      });
    const updated = await tx.marketplaceListing.update({
      where: { id: row.id },
      data: approve
        ? {
            status: "PUBLISHED",
            publishedAt: row.publishedAt ?? new Date(),
            latestVersion: latest?.version ?? null,
            reviewNote: input.note ?? null,
            reviewedById: ctx.actor.id,
          }
        : // A live listing keeps serving its approved version; only the submitted change is rejected.
          {
            status: row.latestVersion ? "PUBLISHED" : "REJECTED",
            reviewNote: input.note ?? null,
            reviewedById: ctx.actor.id,
          },
    });
    await writeAudit(tx, ctx, {
      category: "ADMIN",
      organizationId: row.organizationId,
      action: approve ? "marketplace.listing_approved" : "marketplace.listing_rejected",
      resourceType: "marketplace_listing",
      resourceId: row.id,
      newValue: { version: latest?.version, note: input.note },
      reason: input.note ?? null,
    });
    const admins = await tx.roleAssignment.findMany({
      where: {
        organizationId: row.organizationId,
        principalType: "USER",
        scopeType: "ORGANIZATION",
        role: {
          permissions: {
            some: { permission: { key: "organizations.manage" } },
          },
        },
      },
      select: { principalId: true },
    });
    await notifyUsers(
      tx,
      row.organizationId,
      admins.map((a) => a.principalId),
      approve ? "marketplace.listing_approved" : "marketplace.listing_rejected",
      { title: row.name, href: `/marketplace/publish/${row.id}` },
    );
    return updated;
  });
}
