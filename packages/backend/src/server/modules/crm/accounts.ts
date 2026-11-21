import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { AccountType } from "@/generated/prisma/enums";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers } from "@/server/modules/notifications/service";
import {
  actorId,
  authorize,
  blank,
  cleanTags,
  clearable,
  contains,
  currencyInput,
  isUuid,
  optText,
  pageOf,
  param,
  pick,
  requireOwner,
  tagsInput,
  userNames,
  uuid,
  ZERO_UUID,
} from "./common";
import { validateCustomFields } from "./custom-fields";

export const ACCOUNT_TYPES = ["PROSPECT", "CUSTOMER", "PARTNER", "VENDOR", "OTHER"] as const;
export const ACCOUNT_SORTS = ["name", "created", "updated"] as const;

const domainOf = (v?: string | null) =>
  v
    ? v
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0] || null
    : null;

export const accountInput = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(ACCOUNT_TYPES).default("PROSPECT"),
  domain: optText(200),
  website: optText(300),
  industry: optText(100),
  email: z.string().trim().email().max(254).optional().or(blank),
  phone: optText(40),
  address: optText(1000),
  countryCode: z.string().trim().length(2).optional().or(blank),
  currency: currencyInput.optional().or(blank),
  source: optText(100),
  territory: optText(100),
  notes: optText(5000),
  ownerId: uuid.optional().or(blank),
  tags: tagsInput.optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  allowDuplicate: z.boolean().default(false),
});
export const accountPatch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  type: z.enum(ACCOUNT_TYPES).optional(),
  domain: clearable(200),
  website: clearable(300),
  industry: clearable(100),
  email: z.string().trim().email().max(254).or(z.literal("")).nullable().optional(),
  phone: clearable(40),
  address: clearable(1000),
  countryCode: z.string().trim().length(2).or(z.literal("")).nullable().optional(),
  currency: currencyInput.or(z.literal("")).nullable().optional(),
  source: clearable(100),
  territory: clearable(100),
  notes: clearable(5000),
  ownerId: uuid.nullable().optional(),
  tags: tagsInput.optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export const accountBulkInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), ids: z.array(uuid).min(1).max(500), ownerId: uuid.nullable() }),
  z.object({ action: z.literal("type"), ids: z.array(uuid).min(1).max(500), type: z.enum(ACCOUNT_TYPES) }),
  z.object({ action: z.literal("tag"), ids: z.array(uuid).min(1).max(500), tag: z.string().trim().min(1).max(40), remove: z.boolean().default(false) }),
  z.object({ action: z.literal("archive"), ids: z.array(uuid).min(1).max(500) }),
]);
export const mergeAccountsInput = z.object({ secondaryId: uuid });

export interface AccountFilters {
  q?: string;
  type?: AccountType;
  owner?: string;
  tag?: string;
  sort?: (typeof ACCOUNT_SORTS)[number];
  page?: number;
}

export function parseAccountFilters(raw: Record<string, string | string[] | undefined>): AccountFilters {
  const owner = param(raw, "owner");
  return {
    q: param(raw, "q"),
    type: pick(param(raw, "type"), ACCOUNT_TYPES),
    owner: owner === "me" || owner === "unassigned" || isUuid(owner) ? owner : undefined,
    tag: param(raw, "tag", 40)?.toLowerCase(),
    sort: pick(param(raw, "sort"), ACCOUNT_SORTS),
    page: pageOf(raw).page,
  };
}

function accountWhere(ctx: RequestContext, organizationId: string, companyId: string, f: AccountFilters): Prisma.AccountWhereInput {
  const where: Prisma.AccountWhereInput = { organizationId, companyId, archivedAt: null };
  if (f.type) where.type = f.type;
  if (f.tag) where.tags = { has: f.tag };
  if (f.owner === "me") where.ownerId = ctx.actor.id ?? ZERO_UUID;
  else if (f.owner === "unassigned") where.ownerId = null;
  else if (f.owner) where.ownerId = f.owner;
  if (f.q) where.OR = [{ name: contains(f.q) }, { domain: contains(f.q) }, { email: contains(f.q) }, { industry: contains(f.q) }, { phone: contains(f.q) }];
  return where;
}

const PAGE = 50;

export async function listAccounts(ctx: RequestContext, organizationId: string, companyId: string, f: AccountFilters = {}, opts: { take?: number } = {}) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const where = accountWhere(ctx, organizationId, companyId, f);
  const orderBy: Prisma.AccountOrderByWithRelationInput = f.sort === "created" ? { createdAt: "desc" } : f.sort === "updated" ? { updatedAt: "desc" } : { name: "asc" };
  const take = opts.take ?? PAGE;
  const [rows, total] = await Promise.all([
    db().account.findMany({
      where,
      orderBy,
      take,
      skip: ((f.page ?? 1) - 1) * take,
      include: { owner: { select: { id: true, name: true } }, _count: { select: { contacts: { where: { archivedAt: null } }, crmDeals: { where: { archivedAt: null, status: "OPEN" } } } } },
    }),
    db().account.count({ where }),
  ]);
  return { rows, total, page: f.page ?? 1, pageSize: take };
}

/** Active accounts with the same domain or (case-insensitive) name. */
async function accountDuplicates(client: Tx | Db, companyId: string, name: string, domain: string | null, excludeId?: string) {
  return client.account.findMany({
    where: {
      companyId,
      archivedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ name: { equals: name.trim(), mode: "insensitive" } }, ...(domain ? [{ domain: { equals: domain, mode: "insensitive" as const } }] : [])],
    },
    select: { id: true, name: true, domain: true, type: true },
    take: 5,
  });
}

export async function getAccount(ctx: RequestContext, organizationId: string, companyId: string, accountId: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  if (!isUuid(accountId)) throw notFound("Account");
  const a = await db().account.findFirst({
    where: { id: accountId, organizationId, companyId },
    include: {
      owner: { select: { id: true, name: true } },
      contacts: { where: { archivedAt: null }, orderBy: { firstName: "asc" }, take: 200, select: { id: true, firstName: true, lastName: true, email: true, phone: true, title: true } },
      crmDeals: { where: { archivedAt: null }, orderBy: { createdAt: "desc" }, take: 200, include: { stage: { select: { name: true, type: true, probability: true } } } },
    },
  });
  if (!a) throw notFound("Account");
  const duplicates = a.archivedAt ? [] : await accountDuplicates(db(), companyId, a.name, a.domain, a.id);
  const owners = await userNames(db(), a.crmDeals.map((d) => d.ownerId));
  return { ...a, crmDeals: a.crmDeals.map((d) => ({ ...d, ownerName: d.ownerId ? (owners.get(d.ownerId) ?? null) : null })), duplicates };
}

async function emitCustomer(tx: Tx, ctx: RequestContext, a: { id: string; organizationId: string; companyId: string; name: string; ownerId: string | null; source: string | null }) {
  await emitDomainEvent(tx, ctx, "customer.created", {
    organizationId: a.organizationId,
    companyId: a.companyId,
    entityType: "account",
    entityId: a.id,
    data: { name: a.name, ownerId: a.ownerId, source: a.source },
  });
}

/** Create an account inside an existing transaction (used by lead conversion and CSV import). */
export async function insertAccount(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, input: z.output<typeof accountInput>) {
  const domain = domainOf(input.domain) ?? domainOf(input.website);
  const a = await tx.account.create({
    data: {
      organizationId,
      companyId,
      name: input.name,
      type: input.type,
      domain,
      website: input.website || null,
      industry: input.industry || null,
      email: input.email || null,
      phone: input.phone || null,
      address: input.address || null,
      countryCode: input.countryCode ? input.countryCode.toUpperCase() : null,
      currency: input.currency || null,
      source: input.source || null,
      territory: input.territory || null,
      notes: input.notes || null,
      ownerId: input.ownerId || null,
      tags: cleanTags(input.tags),
      customFields: await validateCustomFields(tx, companyId, "ACCOUNT", input.customFields),
      createdById: actorId(ctx, organizationId),
    },
  });
  await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.account.created", resourceType: "account", resourceId: a.id, newValue: { name: a.name, type: a.type } });
  if (a.type === "CUSTOMER") await emitCustomer(tx, ctx, a);
  if (a.ownerId && a.ownerId !== ctx.actor.id) await notifyUsers(tx, organizationId, [a.ownerId], "crm.account_assigned", { companyId, title: a.name, href: `/crm/accounts/${a.id}` });
  return a;
}

export async function createAccount(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof accountInput>) {
  const input = accountInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    if (input.ownerId) await requireOwner(tx, organizationId, chain, input.ownerId);
    if (!input.allowDuplicate) {
      const dupes = await accountDuplicates(tx, companyId, input.name, domainOf(input.domain) ?? domainOf(input.website));
      if (dupes.length) throw conflict("An account with this name or domain already exists", { reason: "crm_account_duplicate", ids: dupes.map((d) => d.id) });
    }
    return insertAccount(tx, ctx, organizationId, companyId, input);
  });
}

async function requireAccount(tx: Tx, organizationId: string, companyId: string, id: string) {
  const a = isUuid(id) ? await tx.account.findFirst({ where: { id, organizationId, companyId, archivedAt: null } }) : null;
  if (!a) throw notFound("Account");
  return a;
}

export async function updateAccount(ctx: RequestContext, organizationId: string, companyId: string, accountId: string, raw: z.input<typeof accountPatch>) {
  const input = accountPatch.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const before = await requireAccount(tx, organizationId, companyId, accountId);
    if (input.ownerId && input.ownerId !== before.ownerId) await requireOwner(tx, organizationId, chain, input.ownerId);
    const nul = (v: string | null | undefined) => (v === undefined ? undefined : v || null);
    const data: Prisma.AccountUpdateInput = {
      name: input.name,
      type: input.type,
      domain: input.domain === undefined ? undefined : domainOf(input.domain),
      website: nul(input.website),
      industry: nul(input.industry),
      email: nul(input.email),
      phone: nul(input.phone),
      address: nul(input.address),
      countryCode: input.countryCode === undefined ? undefined : input.countryCode ? input.countryCode.toUpperCase() : null,
      currency: nul(input.currency),
      source: nul(input.source),
      territory: nul(input.territory),
      notes: nul(input.notes),
      ...(input.ownerId !== undefined ? { owner: input.ownerId ? { connect: { id: input.ownerId } } : { disconnect: true } } : {}),
      tags: input.tags ? cleanTags(input.tags) : undefined,
      customFields: input.customFields ? await validateCustomFields(tx, companyId, "ACCOUNT", input.customFields, before.customFields, { partial: true }) : undefined,
    };
    const a = await tx.account.update({ where: { id: accountId }, data });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.account.updated", resourceType: "account", resourceId: a.id, oldValue: { type: before.type, ownerId: before.ownerId }, newValue: input });
    if (before.type !== "CUSTOMER" && a.type === "CUSTOMER") await emitCustomer(tx, ctx, a);
    if (input.ownerId && input.ownerId !== before.ownerId && input.ownerId !== ctx.actor.id) {
      await notifyUsers(tx, organizationId, [input.ownerId], "crm.account_assigned", { companyId, title: a.name, href: `/crm/accounts/${a.id}` });
    }
    return a;
  });
}

export async function archiveAccount(ctx: RequestContext, organizationId: string, companyId: string, accountId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    await requireAccount(tx, organizationId, companyId, accountId);
    await tx.account.update({ where: { id: accountId }, data: { archivedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.account.archived", resourceType: "account", resourceId: accountId });
    return { ok: true };
  });
}

export async function bulkAccounts(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof accountBulkInput>) {
  const input = accountBulkInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const rows = await tx.account.findMany({ where: { id: { in: [...new Set(input.ids)] }, organizationId, companyId, archivedAt: null } });
    const ids = rows.map((r) => r.id);
    if (!ids.length) return { count: 0 };
    if (input.action === "assign") {
      if (input.ownerId) await requireOwner(tx, organizationId, chain, input.ownerId);
      await tx.account.updateMany({ where: { id: { in: ids } }, data: { ownerId: input.ownerId } });
      if (input.ownerId && input.ownerId !== ctx.actor.id) {
        await notifyUsers(tx, organizationId, [input.ownerId], "crm.bulk_assigned", { companyId, title: String(ids.length), href: `/crm/accounts?owner=${input.ownerId}` });
      }
    } else if (input.action === "type") {
      await tx.account.updateMany({ where: { id: { in: ids } }, data: { type: input.type } });
      if (input.type === "CUSTOMER") for (const r of rows.filter((r) => r.type !== "CUSTOMER")) await emitCustomer(tx, ctx, r);
    } else if (input.action === "tag") {
      const tag = input.tag.toLowerCase();
      for (const r of rows) {
        const tags = input.remove ? r.tags.filter((t) => t !== tag) : cleanTags([...r.tags, tag]);
        await tx.account.update({ where: { id: r.id }, data: { tags } });
      }
    } else {
      await tx.account.updateMany({ where: { id: { in: ids } }, data: { archivedAt: new Date() } });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `crm.account.bulk_${input.action}`, resourceType: "account", resourceId: ids[0], newValue: { ...input, ids } });
    return { count: ids.length };
  });
}

/** Merge `secondaryId` into `accountId`: blanks filled, contacts/deals/activities/follow-ups/attachments move, secondary archived. */
export async function mergeAccounts(ctx: RequestContext, organizationId: string, companyId: string, accountId: string, raw: z.input<typeof mergeAccountsInput>) {
  const { secondaryId } = mergeAccountsInput.parse(raw);
  if (secondaryId === accountId) throw invalid("Choose two different accounts");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const a = await requireAccount(tx, organizationId, companyId, accountId);
    const b = await requireAccount(tx, organizationId, companyId, secondaryId);
    const fill = {
      domain: a.domain ?? b.domain,
      website: a.website ?? b.website,
      industry: a.industry ?? b.industry,
      email: a.email ?? b.email,
      phone: a.phone ?? b.phone,
      address: a.address ?? b.address,
      countryCode: a.countryCode ?? b.countryCode,
      currency: a.currency ?? b.currency,
      source: a.source ?? b.source,
      territory: a.territory ?? b.territory,
      ownerId: a.ownerId ?? b.ownerId,
      tags: cleanTags([...a.tags, ...b.tags]),
      customFields: { ...((b.customFields as object) ?? {}), ...((a.customFields as object) ?? {}) },
      notes: a.notes && b.notes && a.notes !== b.notes ? `${a.notes}\n\n— merged from ${b.name} —\n${b.notes}`.slice(0, 5000) : (a.notes ?? b.notes),
    };
    await tx.account.update({ where: { id: a.id }, data: fill });
    const move = { where: { accountId: b.id }, data: { accountId: a.id } };
    await tx.contact.updateMany(move);
    await tx.crmDeal.updateMany(move);
    await tx.crmActivity.updateMany(move);
    await tx.crmFollowUp.updateMany(move);
    await tx.crmAttachment.updateMany(move);
    await tx.account.update({ where: { id: b.id }, data: { archivedAt: new Date(), mergedIntoId: a.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.account.merged", resourceType: "account", resourceId: a.id, oldValue: { mergedFrom: b.id, name: b.name } });
    return { id: a.id };
  });
}

/** Lightweight account options for pickers. */
export async function accountOptions(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  return db().account.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { name: "asc" }, take: 1000, select: { id: true, name: true } });
}
