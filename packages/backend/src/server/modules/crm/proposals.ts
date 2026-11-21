import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { CrmProposalStatus } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, notFound } from "@/server/core/errors";
import { randomToken } from "@/server/core/crypto";
import { env } from "@/server/core/env";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask, getTask } from "@/server/modules/agents/service";
import { sendPlainEmail } from "@/server/modules/email/service";
import { createEstimate } from "@/server/modules/finance/billing";
import { notifyUsers } from "@/server/modules/notifications/service";
import { actorId, authorize, contains, day, isUuid, pageOf, param, pick, toDay, toMajor, toMinor, userNames, uuid, ZERO_UUID } from "./common";
import { closeDealTx } from "./deals";

/**
 * Sales proposals: a priced, sectioned offer for a deal with versioning, a public share link (/p/<token>) on which the
 * customer accepts or declines (recorded with time, IP and user agent), email delivery of the link, AI drafting and an
 * optional finance estimate on acceptance. Accepting moves the deal to its pipeline's WON stage (emits deal.won).
 */

export const PROPOSAL_STATUSES = ["DRAFT", "SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED"] as const;
export const PROPOSAL_SORTS = ["created", "updated", "total", "valid"] as const;
const LOCKED: CrmProposalStatus[] = ["ACCEPTED", "DECLINED"];
const OPEN_FOR_DECISION: CrmProposalStatus[] = ["SENT", "VIEWED"];
const SECTION_MAX = 20_000;

const quantity = z
  .union([z.number(), z.string()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,9}(\.\d{1,3})?$/, "Quantity: up to 3 decimals"));
const percent = z
  .union([z.number(), z.string()])
  .transform((v) => (v === "" ? "0" : String(v).trim()))
  .pipe(z.string().regex(/^\d{1,3}(\.\d{1,2})?$/))
  .refine((v) => Number(v) <= 100, "0–100");

export const proposalLineInput = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: quantity,
  /** Major units of the deal currency. */
  unitPrice: z.string().trim().regex(/^\d{1,12}(\.\d{1,3})?$/),
  discount: percent.optional(),
  tax: percent.optional(),
});
const sections = {
  intro: z.string().max(SECTION_MAX).optional(),
  scope: z.string().max(SECTION_MAX).optional(),
  timeline: z.string().max(SECTION_MAX).optional(),
  terms: z.string().max(SECTION_MAX).optional(),
};
export const proposalInput = z.object({
  dealId: uuid,
  contactId: uuid.optional().or(z.literal("").transform(() => undefined)),
  title: z.string().trim().min(1).max(200),
  ...sections,
  validUntil: day.optional().or(z.literal("").transform(() => undefined)),
  createEstimateOnAccept: z.boolean().optional(),
  lines: z.array(proposalLineInput).max(200).default([]),
});
export const proposalPatch = z.object({
  contactId: uuid.nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  ...sections,
  validUntil: day.or(z.literal("")).nullable().optional(),
  createEstimateOnAccept: z.boolean().optional(),
  lines: z.array(proposalLineInput).max(200).optional(),
});
export const sendProposalInput = z.object({
  to: z.string().trim().email().max(254).optional().or(z.literal("").transform(() => undefined)),
  subject: z.string().trim().min(1).max(200).optional(),
  message: z.string().trim().max(5000).optional(),
  locale: z.string().max(10).optional(),
});
export const decisionInput = z.object({
  decision: z.enum(["accept", "decline"]),
  name: z.string().trim().min(1).max(200),
  note: z.string().trim().max(2000).optional(),
});
export const aiDraftInput = z.object({ guidance: z.string().trim().max(1000).optional() });
export const applyAiInput = z.object({ taskId: uuid });

// ───────────── Pricing ─────────────

const qtyMilli = (q: string) => {
  const [i, f = ""] = q.split(".");
  return Number(i) * 1000 + Number(f.padEnd(3, "0"));
};
const bps = (p: string | undefined) => {
  if (!p) return 0;
  const [i, f = ""] = p.split(".");
  return Number(i) * 100 + Number(f.padEnd(2, "0"));
};
/** a × b / c rounded half up (non-negative operands). */
const mulDiv = (a: bigint, b: bigint, c: bigint) => (a * b * 2n + c) / (2n * c);

export interface PricedLine {
  position: number;
  description: string;
  quantityMilli: number;
  unitPriceMinor: bigint;
  discountBps: number;
  taxBps: number;
  netMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
}

/** Server-side totals: gross = qty × price; minus line discount = net; plus (exclusive) tax = total. */
export function priceLines(currency: string, raw: z.input<typeof proposalLineInput>[]) {
  const lines: PricedLine[] = raw.map((r, position) => {
    const l = proposalLineInput.parse(r);
    const quantityMilli = qtyMilli(l.quantity);
    const unitPriceMinor = toMinor(l.unitPrice, currency) ?? 0n;
    const discountBps = bps(l.discount);
    const taxBps = bps(l.tax);
    const gross = mulDiv(unitPriceMinor, BigInt(quantityMilli), 1000n);
    const netMinor = gross - mulDiv(gross, BigInt(discountBps), 10_000n);
    const taxMinor = mulDiv(netMinor, BigInt(taxBps), 10_000n);
    return { position, description: l.description, quantityMilli, unitPriceMinor, discountBps, taxBps, netMinor, taxMinor, totalMinor: netMinor + taxMinor };
  });
  const sum = (f: (l: PricedLine) => bigint) => lines.reduce((a, l) => a + f(l), 0n);
  const subtotal = lines.reduce((a, l) => a + mulDiv(l.unitPriceMinor, BigInt(l.quantityMilli), 1000n), 0n);
  const net = sum((l) => l.netMinor);
  return { lines, subtotalMinor: subtotal, discountMinor: subtotal - net, taxMinor: sum((l) => l.taxMinor), totalMinor: sum((l) => l.totalMinor) };
}

/** Stored line → form values (major units / percents). */
export const lineToInput = (l: { description: string; quantityMilli: number; unitPriceMinor: bigint; discountBps: number; taxBps: number }, currency: string) => ({
  description: l.description,
  quantity: String(l.quantityMilli / 1000),
  unitPrice: toMajor(l.unitPriceMinor, currency) || "0",
  discount: String(l.discountBps / 100),
  tax: String(l.taxBps / 100),
});

// ───────────── Queries ─────────────

export interface ProposalFilters {
  q?: string;
  status?: CrmProposalStatus;
  dealId?: string;
  owner?: string;
  sort?: (typeof PROPOSAL_SORTS)[number];
  page?: number;
}

export function parseProposalFilters(raw: Record<string, string | string[] | undefined>): ProposalFilters {
  const dealId = param(raw, "deal");
  const owner = param(raw, "owner");
  return {
    q: param(raw, "q"),
    status: pick(param(raw, "status"), PROPOSAL_STATUSES),
    dealId: isUuid(dealId) ? dealId : undefined,
    owner: owner === "me" || isUuid(owner) ? owner : undefined,
    sort: pick(param(raw, "sort"), PROPOSAL_SORTS),
    page: pageOf(raw).page,
  };
}

const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
/** EXPIRED is also derived on read, so a proposal past its valid-until date never shows as open. */
export const effectiveStatus = (p: { status: CrmProposalStatus; validUntil: Date | null }): CrmProposalStatus =>
  OPEN_FOR_DECISION.includes(p.status) && p.validUntil && p.validUntil < today() ? "EXPIRED" : p.status;

export async function listProposals(ctx: RequestContext, organizationId: string, companyId: string, f: ProposalFilters = {}, opts: { take?: number } = {}) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const where: Prisma.CrmProposalWhereInput = { organizationId, companyId, archivedAt: null };
  if (f.status) where.status = f.status;
  if (f.dealId) where.dealId = f.dealId;
  if (f.owner === "me") where.ownerId = ctx.actor.id ?? ZERO_UUID;
  else if (f.owner) where.ownerId = f.owner;
  if (f.q) where.OR = [{ title: contains(f.q) }, { number: contains(f.q) }, { deal: { name: contains(f.q) } }, { account: { name: contains(f.q) } }];
  const orderBy: Prisma.CrmProposalOrderByWithRelationInput[] =
    f.sort === "total" ? [{ totalMinor: "desc" }] : f.sort === "valid" ? [{ validUntil: { sort: "asc", nulls: "last" } }] : f.sort === "updated" ? [{ updatedAt: "desc" }] : [{ createdAt: "desc" }];
  const take = opts.take ?? 50;
  const page = f.page ?? 1;
  const [rows, total] = await Promise.all([
    db().crmProposal.findMany({
      where,
      orderBy,
      take,
      skip: (page - 1) * take,
      include: { deal: { select: { id: true, name: true } }, account: { select: { id: true, name: true } }, contact: { select: { id: true, firstName: true, lastName: true, email: true } } },
    }),
    db().crmProposal.count({ where }),
  ]);
  const names = await userNames(db(), rows.map((r) => r.ownerId));
  return { rows: rows.map((r) => ({ ...r, status: effectiveStatus(r), ownerName: r.ownerId ? (names.get(r.ownerId) ?? null) : null })), total, page, pageSize: take };
}

export async function getProposal(ctx: RequestContext, organizationId: string, companyId: string, proposalId: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const p = isUuid(proposalId)
    ? await db().crmProposal.findFirst({
        where: { id: proposalId, organizationId, companyId },
        include: {
          lines: { orderBy: { position: "asc" } },
          revisions: { orderBy: { version: "desc" }, take: 50 },
          sends: { orderBy: { sentAt: "desc" }, take: 50 },
          deal: { select: { id: true, name: true, status: true, currency: true, stage: { select: { name: true } } } },
          account: { select: { id: true, name: true, address: true, email: true } },
          contact: { select: { id: true, firstName: true, lastName: true, email: true, title: true } },
        },
      })
    : null;
  if (!p) throw notFound("Proposal");
  const names = await userNames(db(), [p.ownerId, p.createdById, ...p.sends.map((s) => s.sentById), ...p.revisions.map((r) => r.createdById)]);
  const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  return {
    ...p,
    status: effectiveStatus(p),
    ownerName: name(p.ownerId),
    sends: p.sends.map((s) => ({ ...s, sentByName: name(s.sentById) })),
    revisions: p.revisions.map((r) => ({ ...r, createdByName: name(r.createdById) })),
  };
}

export const publicProposalUrl = (token: string, locale = "en-US") => `${env().APP_URL.replace(/\/$/, "")}/${locale}/p/${token}`;

// ───────────── Writes ─────────────

async function nextNumber(tx: Tx, organizationId: string, companyId: string) {
  const row = await tx.crmSequence.upsert({
    where: { companyId_key: { companyId, key: "proposal" } },
    create: { organizationId, companyId, key: "proposal", value: 1 },
    update: { value: { increment: 1 } },
  });
  return `P-${String(row.value).padStart(4, "0")}`;
}

async function requireDealForProposal(tx: Tx, organizationId: string, companyId: string, dealId: string) {
  const d = await tx.crmDeal.findFirst({ where: { id: dealId, organizationId, companyId, archivedAt: null }, select: { id: true, name: true, currency: true, accountId: true, contactId: true, ownerId: true } });
  if (!d) throw notFound("Deal");
  return d;
}

async function requireContact(tx: Tx, organizationId: string, companyId: string, contactId: string) {
  const c = await tx.contact.findFirst({ where: { id: contactId, organizationId, companyId, archivedAt: null }, select: { id: true } });
  if (!c) throw notFound("Contact");
}

const lineRows = (organizationId: string, companyId: string, proposalId: string, lines: PricedLine[]) =>
  lines.map((l) => ({ organizationId, companyId, proposalId, ...l }));

/** Create a proposal inside an existing transaction (UI, AI tool). Caller authorizes sales.manage. */
export async function insertProposal(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, input: z.output<typeof proposalInput>) {
  const deal = await requireDealForProposal(tx, organizationId, companyId, input.dealId);
  const contactId = input.contactId || deal.contactId || null;
  if (input.contactId) await requireContact(tx, organizationId, companyId, input.contactId);
  const priced = priceLines(deal.currency, input.lines);
  const p = await tx.crmProposal.create({
    data: {
      organizationId,
      companyId,
      number: await nextNumber(tx, organizationId, companyId),
      dealId: deal.id,
      accountId: deal.accountId,
      contactId,
      ownerId: deal.ownerId ?? ctx.actor.id ?? null,
      title: input.title,
      intro: input.intro ?? "",
      scope: input.scope ?? "",
      timeline: input.timeline ?? "",
      terms: input.terms ?? "",
      currency: deal.currency,
      subtotalMinor: priced.subtotalMinor,
      discountMinor: priced.discountMinor,
      taxMinor: priced.taxMinor,
      totalMinor: priced.totalMinor,
      validUntil: toDay(input.validUntil),
      createEstimateOnAccept: input.createEstimateOnAccept ?? false,
      shareToken: randomToken(24),
      createdById: actorId(ctx, organizationId),
    },
  });
  if (priced.lines.length) await tx.crmProposalLine.createMany({ data: lineRows(organizationId, companyId, p.id, priced.lines) });
  await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.proposal.created", resourceType: "crm_proposal", resourceId: p.id, newValue: { number: p.number, dealId: deal.id, totalMinor: p.totalMinor } });
  return p;
}

export async function createProposal(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof proposalInput>) {
  const input = proposalInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    return insertProposal(tx, ctx, organizationId, companyId, input);
  });
}

async function lockProposal(tx: Tx, organizationId: string, companyId: string, proposalId: string) {
  if (!isUuid(proposalId)) throw notFound("Proposal");
  await tx.$queryRaw`SELECT id FROM crm_proposals WHERE id = ${proposalId}::uuid FOR UPDATE`;
  const p = await tx.crmProposal.findFirst({ where: { id: proposalId, organizationId, companyId, archivedAt: null }, include: { lines: { orderBy: { position: "asc" } } } });
  if (!p) throw notFound("Proposal");
  return p;
}

type LockedProposal = Awaited<ReturnType<typeof lockProposal>>;

const snapshotOf = (p: LockedProposal) => ({
  title: p.title,
  intro: p.intro,
  scope: p.scope,
  timeline: p.timeline,
  terms: p.terms,
  validUntil: p.validUntil?.toISOString().slice(0, 10) ?? null,
  currency: p.currency,
  status: p.status,
  sentAt: p.sentAt?.toISOString() ?? null,
  totals: { subtotalMinor: p.subtotalMinor.toString(), discountMinor: p.discountMinor.toString(), taxMinor: p.taxMinor.toString(), totalMinor: p.totalMinor.toString() },
  lines: p.lines.map((l) => ({ description: l.description, quantityMilli: l.quantityMilli, unitPriceMinor: l.unitPriceMinor.toString(), discountBps: l.discountBps, taxBps: l.taxBps, totalMinor: l.totalMinor.toString() })),
});

/** Update a proposal inside a transaction. Editing a proposal the customer has seen keeps the old version as a revision. */
async function updateInTx(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, before: LockedProposal, input: z.output<typeof proposalPatch>, action = "crm.proposal.updated") {
  if (LOCKED.includes(before.status)) throw conflict("Accepted or declined proposals can't be edited", { reason: "crm_proposal_locked" });
  if (input.contactId) await requireContact(tx, organizationId, companyId, input.contactId);
  const revise = before.status !== "DRAFT";
  if (revise) {
    await tx.crmProposalRevision.create({ data: { organizationId, companyId, proposalId: before.id, version: before.version, snapshot: snapshotOf(before), createdById: actorId(ctx, organizationId) } });
  }
  const data: Prisma.CrmProposalUncheckedUpdateInput = {
    title: input.title,
    intro: input.intro,
    scope: input.scope,
    timeline: input.timeline,
    terms: input.terms,
    createEstimateOnAccept: input.createEstimateOnAccept,
    ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
    ...(input.validUntil !== undefined ? { validUntil: toDay(input.validUntil || null) } : {}),
    // A revised proposal must be sent again; the customer decides on the new version.
    ...(revise ? { version: before.version + 1, status: "DRAFT" as const, viewedAt: null } : {}),
  };
  if (input.lines) {
    const priced = priceLines(before.currency, input.lines);
    await tx.crmProposalLine.deleteMany({ where: { proposalId: before.id } });
    if (priced.lines.length) await tx.crmProposalLine.createMany({ data: lineRows(organizationId, companyId, before.id, priced.lines) });
    Object.assign(data, { subtotalMinor: priced.subtotalMinor, discountMinor: priced.discountMinor, taxMinor: priced.taxMinor, totalMinor: priced.totalMinor });
  }
  const p = await tx.crmProposal.update({ where: { id: before.id }, data });
  await writeAudit(tx, ctx, {
    category: "TENANT",
    organizationId,
    action,
    resourceType: "crm_proposal",
    resourceId: p.id,
    oldValue: { version: before.version, status: before.status, totalMinor: before.totalMinor },
    newValue: { version: p.version, status: p.status, totalMinor: p.totalMinor, fields: Object.keys(input) },
  });
  return p;
}

export async function updateProposal(ctx: RequestContext, organizationId: string, companyId: string, proposalId: string, raw: z.input<typeof proposalPatch>) {
  const input = proposalPatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const before = await lockProposal(tx, organizationId, companyId, proposalId);
    return updateInTx(tx, ctx, organizationId, companyId, before, input);
  });
}

export async function archiveProposal(ctx: RequestContext, organizationId: string, companyId: string, proposalId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    await lockProposal(tx, organizationId, companyId, proposalId);
    await tx.crmProposal.update({ where: { id: proposalId }, data: { archivedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.proposal.archived", resourceType: "crm_proposal", resourceId: proposalId });
    return { ok: true };
  });
}

/** Email the share link to the contact (or `to`). Recorded as sent only when the provider accepted the message. */
export async function sendProposal(ctx: RequestContext, organizationId: string, companyId: string, proposalId: string, raw: z.input<typeof sendProposalInput>) {
  const input = sendProposalInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "sales.manage");
  const p = await getProposal(ctx, organizationId, companyId, proposalId);
  if (p.archivedAt) throw conflict("The proposal is archived", { reason: "crm_proposal_archived" });
  if (LOCKED.includes(p.status)) throw conflict("Accepted or declined proposals can't be sent again", { reason: "crm_proposal_locked" });
  if (p.validUntil && p.validUntil < today()) throw conflict("The proposal has expired; set a new valid-until date first", { reason: "crm_proposal_expired" });
  if (!p.lines.length) throw invalid("Add at least one line item before sending", { reason: "crm_proposal_no_lines" });
  const to = input.to ?? p.contact?.email ?? null;
  if (!to) throw invalid("The contact has no email address", { reason: "crm_proposal_no_email" });
  const company = await db().company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { name: true } });
  const link = publicProposalUrl(p.shareToken, input.locale);
  const subject = input.subject ?? `${p.title} (${p.number})`;
  const greeting = p.contact ? `Hello ${p.contact.firstName},` : "Hello,";
  const text = [
    input.message || `${greeting}\n\nPlease find our proposal "${p.title}" from ${company.name} at the link below. You can review it and accept or decline it online.`,
    link,
    p.validUntil ? `Valid until ${p.validUntil.toISOString().slice(0, 10)}.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const r = await sendPlainEmail({ to, subject, text, template: "crm_proposal", organizationId, userId: ctx.actor.id ?? null, locale: input.locale });
  if (r.status === "NOT_CONFIGURED") throw new AppError("not_configured", "Email delivery isn't configured; nothing was sent.", { reason: "crm_email_not_configured" });
  if (r.status !== "SENT") throw new AppError("not_available", "The email provider rejected the message; nothing was sent.", { reason: "crm_email_failed" });
  return transaction(async (tx) => {
    const locked = await lockProposal(tx, organizationId, companyId, proposalId);
    const now = new Date();
    await tx.crmProposalSend.create({ data: { organizationId, companyId, proposalId, version: locked.version, toEmail: to, subject, body: text.slice(0, 10_000), providerMessageId: r.messageId ?? null, sentById: ctx.actor.id } });
    const updated = await tx.crmProposal.update({
      where: { id: proposalId },
      data: { sentAt: now, sentTo: to, ...(locked.status === "DRAFT" || locked.status === "EXPIRED" ? { status: "SENT" as const } : {}) },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.proposal.sent", resourceType: "crm_proposal", resourceId: proposalId, newValue: { to, version: locked.version, subject } });
    return { ...updated, sent: true, to };
  });
}

// ───────────── Public share link ─────────────

const publicInclude = {
  lines: { orderBy: { position: "asc" } },
  company: { select: { name: true, legalName: true, timezone: true } },
  account: { select: { name: true, address: true } },
  contact: { select: { firstName: true, lastName: true } },
} satisfies Prisma.CrmProposalInclude;

/** The proposal behind a share token (no login; the unguessable token is the credential). Counts the view. */
export async function viewPublicProposal(token: string) {
  if (!token || token.length < 16 || token.length > 64 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const p = await db().crmProposal.findUnique({ where: { shareToken: token }, include: publicInclude });
  if (!p || p.archivedAt || p.status === "DRAFT") return null;
  const status = effectiveStatus(p);
  if (status === "SENT" || status === "VIEWED") {
    await transaction(async (tx) => {
      const first = await tx.crmProposal.updateMany({ where: { id: p.id, status: "SENT" }, data: { status: "VIEWED", viewedAt: new Date(), viewCount: { increment: 1 } } });
      if (first.count) {
        await writeAudit(tx, systemContext(), { category: "TENANT", organizationId: p.organizationId, action: "crm.proposal.viewed", resourceType: "crm_proposal", resourceId: p.id });
        if (p.ownerId) await notifyUsers(tx, p.organizationId, [p.ownerId], "crm.proposal_viewed", { companyId: p.companyId, title: `${p.number} ${p.title}`, href: `/crm/proposals/${p.id}` });
      } else {
        await tx.crmProposal.update({ where: { id: p.id }, data: { viewCount: { increment: 1 } } });
      }
    });
  }
  return { ...p, status: status === "SENT" ? ("VIEWED" as const) : status };
}

/** Customer's accept/decline on the public page. Accepting wins the deal (deal.won) and optionally drafts an estimate. */
export async function decideProposal(token: string, raw: z.input<typeof decisionInput>, meta: { ip: string | null; userAgent: string | null }) {
  const input = decisionInput.parse(raw);
  const found = token && /^[A-Za-z0-9_-]{16,64}$/.test(token) ? await db().crmProposal.findUnique({ where: { shareToken: token }, select: { id: true } }) : null;
  if (!found) throw notFound("Proposal");
  const ctx = { ...systemContext(), ip: meta.ip, userAgent: meta.userAgent };
  const result = await transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM crm_proposals WHERE id = ${found.id}::uuid FOR UPDATE`;
    const p = row ? await tx.crmProposal.findUniqueOrThrow({ where: { id: found.id }, include: { deal: { select: { id: true, status: true, name: true, archivedAt: true } } } }) : null;
    if (!p || p.archivedAt || p.status === "DRAFT") throw notFound("Proposal");
    const status = effectiveStatus(p);
    if (status === "EXPIRED") throw conflict("This proposal has expired", { reason: "crm_proposal_expired" });
    if (!OPEN_FOR_DECISION.includes(status)) throw conflict("A decision was already recorded for this proposal", { reason: "crm_proposal_decided" });
    const accepted = input.decision === "accept";
    const now = new Date();
    const updated = await tx.crmProposal.update({
      where: { id: p.id },
      data: {
        status: accepted ? "ACCEPTED" : "DECLINED",
        decidedAt: now,
        decisionName: input.name,
        decisionNote: input.note || null,
        decisionIp: meta.ip?.slice(0, 100) ?? null,
        decisionUserAgent: meta.userAgent?.slice(0, 500) ?? null,
      },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId: p.organizationId,
      action: accepted ? "crm.proposal.accepted" : "crm.proposal.declined",
      resourceType: "crm_proposal",
      resourceId: p.id,
      newValue: { name: input.name, note: input.note ?? null, ip: meta.ip, version: p.version },
    });
    await tx.crmActivity.create({
      data: {
        organizationId: p.organizationId,
        companyId: p.companyId,
        type: "NOTE",
        subject: `${p.number} ${accepted ? "accepted" : "declined"}`,
        summary: `Proposal "${p.title}" (v${p.version}) was ${accepted ? "accepted" : "declined"} by ${input.name}${input.note ? `: ${input.note}` : ""}.`.slice(0, 5000),
        occurredAt: now,
        dealId: p.dealId,
        contactId: p.contactId,
        accountId: p.accountId,
        createdById: p.createdById,
      },
    });
    let dealWon = false;
    if (accepted && p.deal.status !== "WON" && !p.deal.archivedAt) {
      try {
        await closeDealTx(tx, ctx, p.organizationId, p.companyId, p.dealId, { outcome: "won" });
        dealWon = true;
      } catch (err) {
        // A pipeline without a WON stage: the acceptance still counts; the owner moves the deal by hand.
        if (!(err instanceof AppError)) throw err;
        logger.warn({ proposalId: p.id, err: err.message }, "accepted proposal: deal not moved to won");
      }
    }
    const recipients = [...new Set([p.ownerId, p.createdById].filter((x): x is string => !!x && x !== p.organizationId))];
    await notifyUsers(tx, p.organizationId, recipients, accepted ? "crm.proposal_accepted" : "crm.proposal_declined", { companyId: p.companyId, title: `${p.number} ${p.title}`, href: `/crm/proposals/${p.id}` });
    return { proposal: updated, dealWon };
  });
  let estimateId: string | null = null;
  if (result.proposal.status === "ACCEPTED" && result.proposal.createEstimateOnAccept) {
    estimateId = await estimateFromProposal(ctx, result.proposal.organizationId, result.proposal.companyId, result.proposal.id).catch((err) => {
      logger.warn({ err, proposalId: result.proposal.id }, "estimate from accepted proposal failed");
      return null;
    });
  }
  return { status: result.proposal.status, decidedAt: result.proposal.decidedAt, dealWon: result.dealWon, estimateCreated: !!estimateId };
}

// ───────────── Finance estimate ─────────────

/**
 * Create a finance estimate draft from the proposal's lines (finance.manage). Finance estimates use the company's base
 * currency and its tax rates, so the deal must be in that currency and each line's tax must match an exclusive rate.
 */
async function estimateFromProposal(ctx: RequestContext, organizationId: string, companyId: string, proposalId: string): Promise<string> {
  const p = await db().crmProposal.findFirst({ where: { id: proposalId, organizationId, companyId }, include: { lines: { orderBy: { position: "asc" } }, deal: { select: { accountId: true } } } });
  if (!p) throw notFound("Proposal");
  if (p.estimateId) return p.estimateId;
  const accountId = p.accountId ?? p.deal.accountId;
  if (!accountId) throw invalid("Link the deal to an account first", { reason: "crm_proposal_no_account" });
  const company = await db().company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { baseCurrency: true } });
  if (company.baseCurrency !== p.currency) throw invalid("Estimates use the company currency; this proposal is in another currency", { reason: "crm_proposal_currency" });
  const rates = await db().financeTaxRate.findMany({ where: { organizationId, companyId, inclusive: false }, select: { id: true, rateBps: true } });
  const rateFor = (b: number) => (b === 0 ? null : (rates.find((r) => r.rateBps === b)?.id ?? undefined));
  const lines = p.lines.map((l) => {
    const taxRateId = rateFor(l.taxBps);
    if (taxRateId === undefined) throw invalid(`No finance tax rate of ${l.taxBps / 100}% exists`, { reason: "crm_proposal_tax_rate" });
    return { description: l.description, quantity: String(l.quantityMilli / 1000), unitPrice: toMajor(l.unitPriceMinor, p.currency) || "0", discount: l.discountBps / 100, taxRateId };
  });
  if (!lines.length) throw invalid("The proposal has no line items", { reason: "crm_proposal_no_lines" });
  const e = await createEstimate(ctx, organizationId, companyId, {
    accountId,
    issueDate: new Date().toISOString().slice(0, 10),
    expiryDate: p.validUntil ? p.validUntil.toISOString().slice(0, 10) : null,
    notes: `${p.number} — ${p.title}`.slice(0, 5000),
    terms: p.terms ? p.terms.slice(0, 5000) : undefined,
    lines,
  });
  await transaction(async (tx) => {
    await tx.crmProposal.update({ where: { id: p.id }, data: { estimateId: e.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.proposal.estimate_created", resourceType: "crm_proposal", resourceId: p.id, newValue: { estimateId: e.id, number: e.number } });
  });
  return e.id;
}

export async function createProposalEstimate(ctx: RequestContext, organizationId: string, companyId: string, proposalId: string) {
  await authorize(ctx, organizationId, companyId, "sales.manage");
  const p = await getProposal(ctx, organizationId, companyId, proposalId);
  if (p.estimateId) throw conflict("An estimate already exists for this proposal", { reason: "crm_proposal_estimate_exists" });
  return { estimateId: await estimateFromProposal(ctx, organizationId, companyId, p.id) };
}

// ───────────── AI drafting ─────────────

const SECTION_HEADINGS = { intro: "Introduction", scope: "Scope", timeline: "Timeline", terms: "Terms" } as const;

export async function draftProposalWithAi(ctx: RequestContext, organizationId: string, companyId: string, proposalId: string, raw: z.input<typeof aiDraftInput>) {
  const input = aiDraftInput.parse(raw);
  const p = await getProposal(ctx, organizationId, companyId, proposalId);
  if (LOCKED.includes(p.status)) throw conflict("Accepted or declined proposals can't be edited", { reason: "crm_proposal_locked" });
  return createTask(ctx, organizationId, companyId, {
    profile: "account_executive",
    title: `Proposal draft: ${p.number} ${p.title}`.slice(0, 200),
    instructions:
      `Call read_proposals with proposalId ${p.id}, then read_deal with dealId ${p.dealId} (and read_account for its account if it has one). ` +
      `Write the text of this sales proposal grounded in the deal, its activity and the line items. Output EXACTLY four sections, each starting with a level-2 heading on its own line, in this order: ` +
      `"## ${SECTION_HEADINGS.intro}", "## ${SECTION_HEADINGS.scope}", "## ${SECTION_HEADINGS.timeline}", "## ${SECTION_HEADINGS.terms}". ` +
      `Use plain paragraphs, "- " bullet lists and **bold** only. Do not invent prices, discounts or dates that are not in the records; refer to the line items for pricing. ` +
      `This is a draft for a person to review — do not call any tool that changes data.` +
      (input.guidance ? `\n\nAdditional direction from the requester: ${input.guidance}` : ""),
    subject: { type: "crm_proposal", id: p.id },
  });
}

/** Split an AI deliverable into the four sections by its "## Heading" lines (unknown text goes to the intro). */
export function parseSections(output: string) {
  const out: Record<keyof typeof SECTION_HEADINGS, string[]> = { intro: [], scope: [], timeline: [], terms: [] };
  const match = (line: string): keyof typeof SECTION_HEADINGS | null => {
    const h = line.match(/^#{1,3}\s*(?:\d+[.)]\s*)?(.+?)\s*:?\s*$/);
    if (!h) return null;
    const name = h[1]!.toLowerCase();
    if (/intro|overview|summary/.test(name)) return "intro";
    if (/scope|deliverable|solution/.test(name)) return "scope";
    if (/timeline|schedule|plan|milestone/.test(name)) return "timeline";
    if (/term|condition/.test(name)) return "terms";
    return null;
  };
  let current: keyof typeof SECTION_HEADINGS = "intro";
  for (const line of output.replace(/\r\n/g, "\n").split("\n")) {
    const m = match(line);
    if (m) current = m;
    else out[current].push(line);
  }
  const clean = (xs: string[]) => xs.join("\n").trim().slice(0, SECTION_MAX);
  return { intro: clean(out.intro), scope: clean(out.scope), timeline: clean(out.timeline), terms: clean(out.terms) };
}

/** "Use AI draft": copy a completed AI task's output (linked to this proposal) into the sections. */
export async function applyAiDraft(ctx: RequestContext, organizationId: string, companyId: string, proposalId: string, raw: z.input<typeof applyAiInput>) {
  const input = applyAiInput.parse(raw);
  const task = await getTask(ctx, organizationId, companyId, input.taskId);
  if (task.subjectType !== "crm_proposal" || task.subjectId !== proposalId) throw notFound("Task");
  if (task.status !== "COMPLETED" || !task.output?.trim()) throw conflict("The AI draft isn't complete yet", { reason: "crm_ai_draft_incomplete" });
  const s = parseSections(task.output);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const before = await lockProposal(tx, organizationId, companyId, proposalId);
    const patch = Object.fromEntries(Object.entries(s).filter(([, v]) => v)) as z.output<typeof proposalPatch>;
    if (!Object.keys(patch).length) throw conflict("The AI draft is empty", { reason: "crm_ai_draft_incomplete" });
    return updateInTx(tx, ctx, organizationId, companyId, before, patch, "crm.proposal.ai_draft_applied");
  });
}

// ───────────── Job ─────────────

/** Mark sent/viewed proposals past their valid-until date as EXPIRED and tell the owner. */
export async function expireProposals(now = new Date()): Promise<number> {
  const cutoff = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const due = await db().crmProposal.findMany({ where: { status: { in: OPEN_FOR_DECISION }, validUntil: { lt: cutoff }, archivedAt: null }, select: { id: true }, take: 2000 });
  let n = 0;
  for (const { id } of due) {
    await transaction(async (tx) => {
      const { count } = await tx.crmProposal.updateMany({ where: { id, status: { in: OPEN_FOR_DECISION } }, data: { status: "EXPIRED" } });
      if (!count) return;
      n++;
      const p = await tx.crmProposal.findUniqueOrThrow({ where: { id }, select: { organizationId: true, companyId: true, ownerId: true, number: true, title: true } });
      await writeAudit(tx, systemContext(), { category: "TENANT", organizationId: p.organizationId, action: "crm.proposal.expired", resourceType: "crm_proposal", resourceId: id });
      if (p.ownerId) await notifyUsers(tx, p.organizationId, [p.ownerId], "crm.proposal_expired", { companyId: p.companyId, title: `${p.number} ${p.title}`, href: `/crm/proposals/${id}` });
    });
  }
  return n;
}
