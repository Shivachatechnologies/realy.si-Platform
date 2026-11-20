import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { requireReviewer } from "@/server/modules/marketplace/service";
import { isUuid, reasonSchema } from "./access";

/**
 * Marketplace management (Admin → Marketplace): every listing across publishers with moderation (approve / reject go
 * through the marketplace service's review; unlist / relist here), and publishers with verification.
 * Reviewer = platform.content.manage (or a configured marketplace reviewer).
 */

const STATUSES = ["DRAFT", "IN_REVIEW", "PUBLISHED", "REJECTED", "ARCHIVED"] as const;
const filters = z.object({
  status: z.enum(STATUSES).optional().catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
  publisher: z.string().uuid().optional().catch(undefined),
});

export async function marketplaceAdminOverview(ctx: RequestContext, raw: Partial<Record<keyof z.input<typeof filters>, unknown>> = {}) {
  await requireReviewer(ctx);
  const f = filters.parse(raw);
  const where: Prisma.MarketplaceListingWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.publisher ? { publisherId: f.publisher } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { listingKey: { contains: f.q.toLowerCase() } }] } : {}),
  };
  const [listings, counts, publishers, installs] = await Promise.all([
    db().marketplaceListing.findMany({
      where,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 200,
      select: { id: true, listingKey: true, type: true, category: true, name: true, summary: true, status: true, pricingModel: true, priceMinor: true, currency: true, latestVersion: true, reviewNote: true, submittedAt: true, publishedAt: true, updatedAt: true, publisher: { select: { id: true, name: true, slug: true, verified: true } }, versions: { orderBy: { createdAt: "desc" }, take: 1, select: { version: true, changelog: true, createdAt: true } } },
    }),
    db().marketplaceListing.groupBy({ by: ["status"], _count: { _all: true } }),
    db().marketplacePublisher.findMany({ orderBy: { createdAt: "desc" }, take: 200, select: { id: true, organizationId: true, name: true, slug: true, website: true, verified: true, createdAt: true, _count: { select: { listings: true } } } }),
    db().marketplaceInstallation.groupBy({ by: ["listingKey"], where: { status: "ACTIVE" }, _count: { _all: true } }).catch(() => [] as { listingKey: string; _count: { _all: number } }[]),
  ]);
  const orgs = await db().organization.findMany({ where: { id: { in: publishers.map((p) => p.organizationId) } }, select: { id: true, name: true, status: true } });
  return {
    listings: listings.map((l) => ({ ...l, installs: installs.find((i) => i.listingKey === l.listingKey)?._count._all ?? 0 })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<Record<(typeof STATUSES)[number], number>>,
    publishers: publishers.map((p) => ({ ...p, listings: p._count.listings, organizationName: orgs.find((o) => o.id === p.organizationId)?.name ?? "", organizationStatus: orgs.find((o) => o.id === p.organizationId)?.status ?? null })),
  };
}

export const moderateInput = z.object({ action: z.enum(["unlist", "relist"]), reason: reasonSchema });

/** Unlist (ARCHIVED: hidden from the catalog, existing installs keep working) or relist a published listing. */
export async function moderateListing(ctx: RequestContext, listingId: string, raw: z.input<typeof moderateInput>) {
  const input = moderateInput.parse(raw);
  if (!isUuid(listingId)) throw notFound("Listing");
  await requireReviewer(ctx);
  return transaction(async (tx) => {
    const row = await tx.marketplaceListing.findUnique({ where: { id: listingId }, select: { id: true, status: true, organizationId: true, latestVersion: true, listingKey: true } });
    if (!row) throw notFound("Listing");
    if (input.action === "unlist" && row.status === "ARCHIVED") throw conflict("The listing is already unlisted");
    if (input.action === "relist" && (row.status !== "ARCHIVED" || !row.latestVersion)) throw conflict("Only unlisted listings with an approved version can be relisted");
    const status = input.action === "unlist" ? "ARCHIVED" : "PUBLISHED";
    await tx.marketplaceListing.update({ where: { id: row.id }, data: { status, reviewNote: input.reason, reviewedById: ctx.actor.id } });
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId: row.organizationId, action: `marketplace.listing_${input.action}ed`, resourceType: "marketplace_listing", resourceId: row.id, oldValue: { status: row.status }, newValue: { status, listingKey: row.listingKey }, reason: input.reason });
    return { id: row.id, status };
  });
}

export const publisherVerifyInput = z.object({ verified: z.boolean(), reason: reasonSchema });

export async function setPublisherVerified(ctx: RequestContext, publisherId: string, raw: z.input<typeof publisherVerifyInput>) {
  const input = publisherVerifyInput.parse(raw);
  if (!isUuid(publisherId)) throw notFound("Publisher");
  await requireReviewer(ctx);
  return transaction(async (tx) => {
    const p = await tx.marketplacePublisher.findUnique({ where: { id: publisherId }, select: { id: true, verified: true, organizationId: true, slug: true } });
    if (!p) throw notFound("Publisher");
    await tx.marketplacePublisher.update({ where: { id: p.id }, data: { verified: input.verified } });
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId: p.organizationId, action: input.verified ? "marketplace.publisher_verified" : "marketplace.publisher_unverified", resourceType: "marketplace_publisher", resourceId: p.id, oldValue: { verified: p.verified }, newValue: { verified: input.verified, slug: p.slug }, reason: input.reason });
    return { id: p.id, verified: input.verified };
  });
}
