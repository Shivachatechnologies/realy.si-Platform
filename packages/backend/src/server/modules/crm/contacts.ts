import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers } from "@/server/modules/notifications/service";
import { actorId, authorize, blank, cleanTags, clearable, contains, isUuid, optText, pageOf, param, pick, requireOwner, tagsInput, uuid, ZERO_UUID } from "./common";
import { validateCustomFields } from "./custom-fields";
import { normalizeEmail, normalizePhone } from "./scoring";
import { assertLimit } from "@/server/modules/entitlements/service";

export const CONTACT_SORTS = ["name", "created", "updated"] as const;

export const contactInput = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: optText(100),
  email: z.string().trim().email().max(254).optional().or(blank),
  phone: optText(40),
  title: optText(150),
  accountId: uuid.optional().or(blank),
  ownerId: uuid.optional().or(blank),
  marketingConsent: z.boolean().default(false),
  tags: tagsInput.optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  allowDuplicate: z.boolean().default(false),
});
export const contactPatch = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: clearable(100),
  email: z.string().trim().email().max(254).or(z.literal("")).nullable().optional(),
  phone: clearable(40),
  title: clearable(150),
  accountId: uuid.nullable().optional(),
  ownerId: uuid.nullable().optional(),
  marketingConsent: z.boolean().optional(),
  tags: tagsInput.optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export const contactBulkInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), ids: z.array(uuid).min(1).max(500), ownerId: uuid.nullable() }),
  z.object({ action: z.literal("account"), ids: z.array(uuid).min(1).max(500), accountId: uuid.nullable() }),
  z.object({ action: z.literal("tag"), ids: z.array(uuid).min(1).max(500), tag: z.string().trim().min(1).max(40), remove: z.boolean().default(false) }),
  z.object({ action: z.literal("archive"), ids: z.array(uuid).min(1).max(500) }),
]);
export const mergeContactsInput = z.object({ secondaryId: uuid });

export interface ContactFilters {
  q?: string;
  owner?: string;
  accountId?: string;
  tag?: string;
  consent?: "yes" | "no";
  sort?: (typeof CONTACT_SORTS)[number];
  page?: number;
}

export function parseContactFilters(raw: Record<string, string | string[] | undefined>): ContactFilters {
  const owner = param(raw, "owner");
  const accountId = param(raw, "account");
  return {
    q: param(raw, "q"),
    owner: owner === "me" || owner === "unassigned" || isUuid(owner) ? owner : undefined,
    accountId: isUuid(accountId) ? accountId : undefined,
    tag: param(raw, "tag", 40)?.toLowerCase(),
    consent: pick(param(raw, "consent"), ["yes", "no"] as const),
    sort: pick(param(raw, "sort"), CONTACT_SORTS),
    page: pageOf(raw).page,
  };
}

export function contactWhere(ctx: RequestContext, organizationId: string, companyId: string, f: ContactFilters): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { organizationId, companyId, archivedAt: null };
  if (f.accountId) where.accountId = f.accountId;
  if (f.tag) where.tags = { has: f.tag };
  if (f.consent) where.marketingConsent = f.consent === "yes";
  if (f.owner === "me") where.ownerId = ctx.actor.id ?? ZERO_UUID;
  else if (f.owner === "unassigned") where.ownerId = null;
  else if (f.owner) where.ownerId = f.owner;
  if (f.q) where.OR = [{ firstName: contains(f.q) }, { lastName: contains(f.q) }, { email: contains(f.q) }, { phone: contains(f.q) }, { title: contains(f.q) }, { account: { name: contains(f.q) } }];
  return where;
}

export const contactName = (c: { firstName: string; lastName: string | null }) => [c.firstName, c.lastName].filter(Boolean).join(" ");

export async function listContacts(ctx: RequestContext, organizationId: string, companyId: string, f: ContactFilters = {}, opts: { take?: number } = {}) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const where = contactWhere(ctx, organizationId, companyId, f);
  const orderBy: Prisma.ContactOrderByWithRelationInput[] =
    f.sort === "created" ? [{ createdAt: "desc" }] : f.sort === "updated" ? [{ updatedAt: "desc" }] : [{ firstName: "asc" }, { lastName: "asc" }];
  const take = opts.take ?? 50;
  const [rows, total] = await Promise.all([
    db().contact.findMany({
      where,
      orderBy,
      take,
      skip: ((f.page ?? 1) - 1) * take,
      include: { owner: { select: { id: true, name: true } }, account: { select: { id: true, name: true } } },
    }),
    db().contact.count({ where }),
  ]);
  return { rows, total, page: f.page ?? 1, pageSize: take };
}

async function contactDuplicates(client: Tx | Db, companyId: string, emailNormalized: string | null, phoneNormalized: string | null, excludeId?: string) {
  if (!emailNormalized && !phoneNormalized) return [];
  return client.contact.findMany({
    where: {
      companyId,
      archivedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [...(emailNormalized ? [{ emailNormalized }] : []), ...(phoneNormalized ? [{ phoneNormalized }] : [])],
    },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    take: 5,
  });
}

export async function getContact(ctx: RequestContext, organizationId: string, companyId: string, contactId: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  if (!isUuid(contactId)) throw notFound("Contact");
  const c = await db().contact.findFirst({
    where: { id: contactId, organizationId, companyId },
    include: {
      owner: { select: { id: true, name: true } },
      account: { select: { id: true, name: true, type: true } },
      lead: { select: { id: true, name: true } },
      crmDeals: { where: { archivedAt: null }, orderBy: { createdAt: "desc" }, take: 100, include: { stage: { select: { name: true, type: true } } } },
    },
  });
  if (!c) throw notFound("Contact");
  const duplicates = c.archivedAt ? [] : await contactDuplicates(db(), companyId, c.emailNormalized, c.phoneNormalized, c.id);
  return { ...c, duplicates };
}

async function requireAccountId(tx: Tx, organizationId: string, companyId: string, accountId: string) {
  if (!(await tx.account.findFirst({ where: { id: accountId, organizationId, companyId, archivedAt: null }, select: { id: true } }))) throw notFound("Account");
}

/** Create a contact inside an existing transaction (lead conversion, CSV import). */
export async function insertContact(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, input: z.output<typeof contactInput>, extra: { leadId?: string; limitChecked?: boolean } = {}) {
  // Plan limit (bulk callers such as the CSV import assert once for the whole batch and pass limitChecked).
  if (!extra.limitChecked) await assertLimit(ctx, organizationId, "crm.contacts.max", 1);
  const c = await tx.contact.create({
    data: {
      organizationId,
      companyId,
      firstName: input.firstName,
      lastName: input.lastName || null,
      email: input.email || null,
      emailNormalized: normalizeEmail(input.email),
      phone: input.phone || null,
      phoneNormalized: normalizePhone(input.phone),
      title: input.title || null,
      accountId: input.accountId || null,
      leadId: extra.leadId ?? null,
      ownerId: input.ownerId || null,
      marketingConsent: input.marketingConsent,
      tags: cleanTags(input.tags),
      customFields: await validateCustomFields(tx, companyId, "CONTACT", input.customFields),
      createdById: actorId(ctx, organizationId),
    },
  });
  await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.contact.created", resourceType: "contact", resourceId: c.id, newValue: { name: contactName(c), accountId: c.accountId } });
  await emitDomainEvent(tx, ctx, "contact.created", {
    organizationId,
    companyId,
    entityType: "contact",
    entityId: c.id,
    data: { name: contactName(c), email: c.email, accountId: c.accountId, ownerId: c.ownerId, marketingConsent: c.marketingConsent, leadId: c.leadId },
  });
  if (c.ownerId && c.ownerId !== ctx.actor.id) await notifyUsers(tx, organizationId, [c.ownerId], "crm.contact_assigned", { companyId, title: contactName(c), href: `/crm/contacts/${c.id}` });
  return c;
}

export async function createContact(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof contactInput>) {
  const input = contactInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    if (input.ownerId) await requireOwner(tx, organizationId, chain, input.ownerId);
    if (input.accountId) await requireAccountId(tx, organizationId, companyId, input.accountId);
    if (!input.allowDuplicate) {
      const dupes = await contactDuplicates(tx, companyId, normalizeEmail(input.email), normalizePhone(input.phone));
      if (dupes.length) throw conflict("A contact with this email or phone already exists", { reason: "crm_contact_duplicate", ids: dupes.map((d) => d.id) });
    }
    return insertContact(tx, ctx, organizationId, companyId, input);
  });
}

async function requireContact(tx: Tx, organizationId: string, companyId: string, id: string) {
  const c = isUuid(id) ? await tx.contact.findFirst({ where: { id, organizationId, companyId, archivedAt: null } }) : null;
  if (!c) throw notFound("Contact");
  return c;
}

export async function updateContact(ctx: RequestContext, organizationId: string, companyId: string, contactId: string, raw: z.input<typeof contactPatch>) {
  const input = contactPatch.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const before = await requireContact(tx, organizationId, companyId, contactId);
    if (input.ownerId && input.ownerId !== before.ownerId) await requireOwner(tx, organizationId, chain, input.ownerId);
    if (input.accountId) await requireAccountId(tx, organizationId, companyId, input.accountId);
    const nul = (v: string | null | undefined) => (v === undefined ? undefined : v || null);
    const consentOff = input.marketingConsent === false && before.marketingConsent;
    const c = await tx.contact.update({
      where: { id: contactId },
      data: {
        firstName: input.firstName,
        lastName: nul(input.lastName),
        ...(input.email !== undefined ? { email: input.email || null, emailNormalized: normalizeEmail(input.email) } : {}),
        ...(input.phone !== undefined ? { phone: input.phone || null, phoneNormalized: normalizePhone(input.phone) } : {}),
        title: nul(input.title),
        ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        ...(input.marketingConsent !== undefined ? { marketingConsent: input.marketingConsent, ...(consentOff ? { unsubscribedAt: new Date() } : input.marketingConsent ? { unsubscribedAt: null } : {}) } : {}),
        tags: input.tags ? cleanTags(input.tags) : undefined,
        customFields: input.customFields ? await validateCustomFields(tx, companyId, "CONTACT", input.customFields, before.customFields, { partial: true }) : undefined,
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.contact.updated", resourceType: "contact", resourceId: c.id, oldValue: { ownerId: before.ownerId, accountId: before.accountId }, newValue: input });
    if (input.ownerId && input.ownerId !== before.ownerId && input.ownerId !== ctx.actor.id) {
      await notifyUsers(tx, organizationId, [input.ownerId], "crm.contact_assigned", { companyId, title: contactName(c), href: `/crm/contacts/${c.id}` });
    }
    return c;
  });
}

export async function archiveContact(ctx: RequestContext, organizationId: string, companyId: string, contactId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    await requireContact(tx, organizationId, companyId, contactId);
    await tx.contact.update({ where: { id: contactId }, data: { archivedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.contact.archived", resourceType: "contact", resourceId: contactId });
    return { ok: true };
  });
}

export async function bulkContacts(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof contactBulkInput>) {
  const input = contactBulkInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const rows = await tx.contact.findMany({ where: { id: { in: [...new Set(input.ids)] }, organizationId, companyId, archivedAt: null } });
    const ids = rows.map((r) => r.id);
    if (!ids.length) return { count: 0 };
    if (input.action === "assign") {
      if (input.ownerId) await requireOwner(tx, organizationId, chain, input.ownerId);
      await tx.contact.updateMany({ where: { id: { in: ids } }, data: { ownerId: input.ownerId } });
      if (input.ownerId && input.ownerId !== ctx.actor.id) {
        await notifyUsers(tx, organizationId, [input.ownerId], "crm.bulk_assigned", { companyId, title: String(ids.length), href: `/crm/contacts?owner=${input.ownerId}` });
      }
    } else if (input.action === "account") {
      if (input.accountId) await requireAccountId(tx, organizationId, companyId, input.accountId);
      await tx.contact.updateMany({ where: { id: { in: ids } }, data: { accountId: input.accountId } });
    } else if (input.action === "tag") {
      const tag = input.tag.toLowerCase();
      for (const r of rows) await tx.contact.update({ where: { id: r.id }, data: { tags: input.remove ? r.tags.filter((t) => t !== tag) : cleanTags([...r.tags, tag]) } });
    } else {
      await tx.contact.updateMany({ where: { id: { in: ids } }, data: { archivedAt: new Date() } });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `crm.contact.bulk_${input.action}`, resourceType: "contact", resourceId: ids[0], newValue: { ...input, ids } });
    return { count: ids.length };
  });
}

/** Merge `secondaryId` into `contactId`: blanks filled, deals/activities/follow-ups/attachments move, secondary archived. */
export async function mergeContacts(ctx: RequestContext, organizationId: string, companyId: string, contactId: string, raw: z.input<typeof mergeContactsInput>) {
  const { secondaryId } = mergeContactsInput.parse(raw);
  if (secondaryId === contactId) throw invalid("Choose two different contacts");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const a = await requireContact(tx, organizationId, companyId, contactId);
    const b = await requireContact(tx, organizationId, companyId, secondaryId);
    await tx.contact.update({
      where: { id: a.id },
      data: {
        lastName: a.lastName ?? b.lastName,
        email: a.email ?? b.email,
        emailNormalized: a.emailNormalized ?? b.emailNormalized,
        phone: a.phone ?? b.phone,
        phoneNormalized: a.phoneNormalized ?? b.phoneNormalized,
        title: a.title ?? b.title,
        accountId: a.accountId ?? b.accountId,
        leadId: a.leadId ?? b.leadId,
        ownerId: a.ownerId ?? b.ownerId,
        // Consent is never widened by a merge: both must have opted in.
        marketingConsent: a.marketingConsent && b.marketingConsent,
        tags: cleanTags([...a.tags, ...b.tags]),
        customFields: { ...((b.customFields as object) ?? {}), ...((a.customFields as object) ?? {}) },
      },
    });
    const move = { where: { contactId: b.id }, data: { contactId: a.id } };
    await tx.crmDeal.updateMany(move);
    await tx.crmActivity.updateMany(move);
    await tx.crmFollowUp.updateMany(move);
    await tx.crmAttachment.updateMany(move);
    await tx.contact.update({ where: { id: b.id }, data: { archivedAt: new Date(), mergedIntoId: a.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.contact.merged", resourceType: "contact", resourceId: a.id, oldValue: { mergedFrom: b.id, name: contactName(b) } });
    return { id: a.id };
  });
}

export async function contactOptions(ctx: RequestContext, organizationId: string, companyId: string, accountId?: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const rows = await db().contact.findMany({
    where: { organizationId, companyId, archivedAt: null, ...(accountId ? { accountId } : {}) },
    orderBy: [{ firstName: "asc" }],
    take: 1000,
    select: { id: true, firstName: true, lastName: true, accountId: true },
  });
  return rows.map((r) => ({ id: r.id, name: contactName(r), accountId: r.accountId }));
}
