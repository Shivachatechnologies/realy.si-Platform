import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { MarketingSegment } from "@/generated/prisma/client";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { actorId, authorize, isUuid, normalizeEmail, uuid } from "./common";

export const ACCOUNT_TYPES = ["PROSPECT", "CUSTOMER", "PARTNER", "VENDOR", "OTHER"] as const;
export const SEGMENT_KINDS = ["DYNAMIC", "STATIC"] as const;

const tag = z.string().trim().min(1).max(60);
export const segmentInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  kind: z.enum(SEGMENT_KINDS).default("DYNAMIC"),
  tags: z.array(tag).max(30).default([]),
  accountTypes: z.array(z.enum(ACCOUNT_TYPES)).max(5).default([]),
  consentOnly: z.boolean().default(true),
});
export const updateSegmentInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  tags: z.array(tag).max(30).optional(),
  accountTypes: z.array(z.enum(ACCOUNT_TYPES)).max(5).optional(),
  consentOnly: z.boolean().optional(),
});
export const membersInput = z.object({ action: z.enum(["add", "remove"]), contactIds: z.array(uuid).min(1).max(500) });

/** Contacts a segment matches. `forEmail` always enforces consent + not unsubscribed (compliance), whatever the segment says. */
export function segmentContactWhere(segment: Pick<MarketingSegment, "id" | "companyId" | "kind" | "tags" | "accountTypes" | "consentOnly">, forEmail: boolean): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { companyId: segment.companyId, archivedAt: null };
  if (forEmail || segment.consentOnly) Object.assign(where, { marketingConsent: true, unsubscribedAt: null });
  if (forEmail) where.email = { not: null };
  if (segment.kind === "STATIC") where.marketingSegmentMembers = { some: { segmentId: segment.id } };
  else {
    if (segment.tags.length) where.tags = { hasSome: segment.tags };
    if (segment.accountTypes.length) where.account = { type: { in: segment.accountTypes } };
  }
  return where;
}

/** Suppressed (unsubscribed) normalized emails among the given ones. */
export async function suppressedEmails(client: Tx | Db, companyId: string, emails: string[]) {
  if (!emails.length) return new Set<string>();
  const rows = await client.marketingSuppression.findMany({ where: { companyId, emailNormalized: { in: emails } }, select: { emailNormalized: true } });
  return new Set(rows.map((r) => r.emailNormalized));
}

/** Email recipients of a segment (consenting, not unsubscribed, not suppressed). */
export async function segmentRecipients(client: Tx | Db, segment: MarketingSegment, take = 50_000) {
  const contacts = await client.contact.findMany({
    where: segmentContactWhere(segment, true),
    select: { id: true, firstName: true, lastName: true, email: true, account: { select: { name: true } } },
    orderBy: { id: "asc" },
    take,
  });
  const withEmail = contacts.filter((c) => c.email && normalizeEmail(c.email));
  const suppressed = await suppressedEmails(client, segment.companyId, withEmail.map((c) => normalizeEmail(c.email)!));
  return withEmail.filter((c) => !suppressed.has(normalizeEmail(c.email)!));
}

export async function listSegments(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const segments = await db().marketingSegment.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { name: "asc" }, take: 200 });
  const counts = await Promise.all(segments.map((s) => db().contact.count({ where: segmentContactWhere(s, false) })));
  const reachable = await Promise.all(segments.map((s) => db().contact.count({ where: segmentContactWhere(s, true) })));
  return segments.map((s, i) => ({ ...s, contactCount: counts[i]!, emailableCount: reachable[i]! }));
}

export async function getSegment(ctx: RequestContext, organizationId: string, companyId: string, segmentId: string, q?: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  if (!isUuid(segmentId)) throw notFound("Segment");
  const segment = await db().marketingSegment.findFirst({ where: { id: segmentId, organizationId, companyId } });
  if (!segment) throw notFound("Segment");
  const where = segmentContactWhere(segment, false);
  const search: Prisma.ContactWhereInput = q
    ? { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] }
    : {};
  const [count, emailable, contacts] = await Promise.all([
    db().contact.count({ where }),
    db().contact.count({ where: segmentContactWhere(segment, true) }),
    db().contact.findMany({
      where: { AND: [where, search] },
      select: { id: true, firstName: true, lastName: true, email: true, tags: true, marketingConsent: true, unsubscribedAt: true, account: { select: { name: true, type: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  return { segment, count, emailable, contacts };
}

/** Contacts of the company matching a search (for adding to static lists). */
export async function searchContacts(ctx: RequestContext, organizationId: string, companyId: string, q: string | undefined) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const where: Prisma.ContactWhereInput = { organizationId, companyId, archivedAt: null };
  if (q) where.OR = [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { tags: { has: q } }];
  return db().contact.findMany({
    where,
    select: { id: true, firstName: true, lastName: true, email: true, tags: true, marketingConsent: true, unsubscribedAt: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/** All tags in use on contacts (for the segment builder). */
export async function contactTags(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const rows = await db().contact.findMany({ where: { organizationId, companyId, archivedAt: null, NOT: { tags: { isEmpty: true } } }, select: { tags: true }, take: 5000 });
  return [...new Set(rows.flatMap((r) => r.tags))].sort().slice(0, 300);
}

export async function createSegment(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof segmentInput>) {
  const input = segmentInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    if (await tx.marketingSegment.findFirst({ where: { companyId, name: input.name }, select: { id: true } })) throw conflict("A segment with this name exists", { reason: "marketing_name_taken" });
    const s = await tx.marketingSegment.create({ data: { organizationId, companyId, ...input, description: input.description || null, createdById: actorId(ctx, organizationId) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.segment.created", resourceType: "marketing_segment", resourceId: s.id, newValue: { name: s.name, kind: s.kind } });
    return s;
  });
}

export async function updateSegment(ctx: RequestContext, organizationId: string, companyId: string, segmentId: string, raw: z.input<typeof updateSegmentInput>) {
  const input = updateSegmentInput.parse(raw);
  if (!isUuid(segmentId)) throw notFound("Segment");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const s = await tx.marketingSegment.findFirst({ where: { id: segmentId, organizationId, companyId, archivedAt: null } });
    if (!s) throw notFound("Segment");
    if (input.name && input.name !== s.name && (await tx.marketingSegment.findFirst({ where: { companyId, name: input.name }, select: { id: true } }))) {
      throw conflict("A segment with this name exists", { reason: "marketing_name_taken" });
    }
    const updated = await tx.marketingSegment.update({ where: { id: s.id }, data: { ...input, ...(input.description !== undefined ? { description: input.description || null } : {}) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.segment.updated", resourceType: "marketing_segment", resourceId: s.id, newValue: input });
    return updated;
  });
}

export async function archiveSegment(ctx: RequestContext, organizationId: string, companyId: string, segmentId: string) {
  if (!isUuid(segmentId)) throw notFound("Segment");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    // Free the name for reuse.
    const s = await tx.marketingSegment.findFirst({ where: { id: segmentId, organizationId, companyId, archivedAt: null } });
    if (!s) throw notFound("Segment");
    await tx.marketingSegment.update({ where: { id: s.id }, data: { archivedAt: new Date(), name: `${s.name} (archived ${s.id.slice(-6)})` } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.segment.archived", resourceType: "marketing_segment", resourceId: s.id });
    return { ok: true };
  });
}

export async function changeMembers(ctx: RequestContext, organizationId: string, companyId: string, segmentId: string, raw: z.input<typeof membersInput>) {
  const input = membersInput.parse(raw);
  if (!isUuid(segmentId)) throw notFound("Segment");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const s = await tx.marketingSegment.findFirst({ where: { id: segmentId, organizationId, companyId, archivedAt: null, kind: "STATIC" } });
    if (!s) throw notFound("Segment");
    let changed = 0;
    if (input.action === "add") {
      const valid = await tx.contact.findMany({ where: { companyId, id: { in: input.contactIds }, archivedAt: null }, select: { id: true } });
      changed = (await tx.marketingSegmentMember.createMany({ data: valid.map((c) => ({ organizationId, companyId, segmentId, contactId: c.id })), skipDuplicates: true })).count;
    } else {
      changed = (await tx.marketingSegmentMember.deleteMany({ where: { companyId, segmentId, contactId: { in: input.contactIds } } })).count;
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `marketing.segment.members_${input.action === "add" ? "added" : "removed"}`, resourceType: "marketing_segment", resourceId: s.id, newValue: { count: changed } });
    return { changed };
  });
}
