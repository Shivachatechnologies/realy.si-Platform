import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { EstimateStatus, InvoiceStatus } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { randomToken } from "@/server/core/crypto";
import { env } from "@/server/core/env";
import { logger } from "@/server/core/logger";
import { applyBps } from "@/server/core/money";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { sendPlainEmail } from "@/server/modules/email/service";
import {
  actorId,
  addDays,
  advance,
  amount,
  authorize,
  companyInfo,
  day,
  dayString,
  financeSettings,
  fromMinor,
  isUuid,
  nextSequence,
  optionalText,
  PAGE_SIZE,
  pageParam,
  param,
  percentToBps,
  positiveAmount,
  todayUtc,
  toDay,
  toMinor,
  uuid,
} from "./common";
import { ensureFinanceSetup, postEntry, removeSourcePostings, systemAccount } from "./ledger";
import { createCounterparty } from "./setup";

export const INVOICE_STATUSES = ["DRAFT", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"] as const;
export const OPEN_STATUSES: InvoiceStatus[] = ["SENT", "PARTIALLY_PAID", "OVERDUE"];
export const ESTIMATE_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "CONVERTED"] as const;
export const PAYMENT_METHODS = ["BANK_TRANSFER", "CARD", "CASH", "CHECK", "OTHER"] as const;

// ───────────── Line items ─────────────

export const lineInput = z.object({
  description: z.string().trim().min(1).max(500),
  /** Up to three decimals. */
  quantity: z.union([z.number(), z.string()]).transform((v) => String(v).trim()).pipe(z.string().regex(/^\d{1,9}(\.\d{1,3})?$/)),
  /** Major units. */
  unitPrice: amount.refine((v) => !v.startsWith("-"), "Must not be negative"),
  /** Percent (0–100). */
  discount: z.union([z.number(), z.string()]).optional().nullable(),
  taxRateId: uuid.nullable().optional().or(z.literal("").transform(() => null)),
});
export type LineInput = z.input<typeof lineInput>;

const qtyMilli = (q: string) => {
  const [i, f = ""] = q.split(".");
  return Number(i) * 1000 + Number(f.padEnd(3, "0"));
};
/** a × b / c rounded half away from zero (non-negative operands). */
const mulDiv = (a: bigint, b: bigint, c: bigint) => (a * b * 2n + c) / (2n * c);

export interface ComputedLine {
  position: number;
  description: string;
  quantityMilli: number;
  unitPriceMinor: bigint;
  discountBps: number;
  taxRateId: string | null;
  taxBps: number;
  taxInclusive: boolean;
  netMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  /** In price terms (incl. tax for inclusive lines), before discounts. */
  grossMinor: bigint;
  discountMinor: bigint;
}

/**
 * Server-side totals. Per line: gross = qty × unit price; line discount then the document discount reduce it; tax is added
 * (exclusive rates) or extracted (inclusive rates). Document totals: subtotal (gross) − discount + exclusive tax = total.
 */
export async function computeLines(client: Tx | ReturnType<typeof db>, organizationId: string, companyId: string, currency: string, raw: LineInput[], docDiscountBps: number) {
  const lines = raw.map((l) => lineInput.parse(l));
  const rateIds = [...new Set(lines.map((l) => l.taxRateId).filter((x): x is string => !!x))];
  const rates = rateIds.length ? await client.financeTaxRate.findMany({ where: { id: { in: rateIds }, organizationId, companyId } }) : [];
  if (rates.length !== rateIds.length) throw notFound("Tax rate");
  const rateBy = new Map(rates.map((r) => [r.id, r]));
  if (docDiscountBps < 0 || docDiscountBps > 10_000) throw invalid("Discount must be between 0 and 100%", { reason: "finance_bad_discount" });
  const computed: ComputedLine[] = lines.map((l, i) => {
    const discountBps = percentToBps(l.discount ?? 0);
    if (discountBps < 0 || discountBps > 10_000) throw invalid("Discount must be between 0 and 100%", { reason: "finance_bad_discount" });
    const quantityMilli = qtyMilli(l.quantity);
    const unitPriceMinor = toMinor(l.unitPrice, currency);
    const gross = mulDiv(unitPriceMinor, BigInt(quantityMilli), 1000n);
    const afterLine = gross - applyBps({ amountMinor: gross, currency }, discountBps).amountMinor;
    const afterDoc = afterLine - applyBps({ amountMinor: afterLine, currency }, docDiscountBps).amountMinor;
    const rate = l.taxRateId ? rateBy.get(l.taxRateId)! : null;
    const taxBps = rate?.rateBps ?? 0;
    const inclusive = rate?.inclusive ?? false;
    let netMinor: bigint, taxMinor: bigint, totalMinor: bigint;
    if (inclusive) {
      totalMinor = afterDoc;
      netMinor = mulDiv(afterDoc, 10_000n, BigInt(10_000 + taxBps));
      taxMinor = totalMinor - netMinor;
    } else {
      netMinor = afterDoc;
      taxMinor = applyBps({ amountMinor: netMinor, currency }, taxBps).amountMinor;
      totalMinor = netMinor + taxMinor;
    }
    return { position: i, description: l.description, quantityMilli, unitPriceMinor, discountBps, taxRateId: rate?.id ?? null, taxBps, taxInclusive: inclusive, netMinor, taxMinor, totalMinor, grossMinor: gross, discountMinor: gross - afterDoc };
  });
  const sum = (f: (l: ComputedLine) => bigint) => computed.reduce((s, l) => s + f(l), 0n);
  return {
    lines: computed,
    subtotalMinor: sum((l) => l.grossMinor),
    discountMinor: sum((l) => l.discountMinor),
    taxMinor: sum((l) => l.taxMinor),
    netMinor: sum((l) => l.netMinor),
    totalMinor: sum((l) => l.totalMinor),
  };
}

const lineRows = (organizationId: string, companyId: string, lines: ComputedLine[], parent: { invoiceId?: string; estimateId?: string }) =>
  lines.map((l) => ({
    organizationId,
    companyId,
    invoiceId: parent.invoiceId ?? null,
    estimateId: parent.estimateId ?? null,
    position: l.position,
    description: l.description,
    quantityMilli: l.quantityMilli,
    unitPriceMinor: l.unitPriceMinor,
    discountBps: l.discountBps,
    taxRateId: l.taxRateId,
    taxBps: l.taxBps,
    taxInclusive: l.taxInclusive,
    netMinor: l.netMinor,
    taxMinor: l.taxMinor,
    totalMinor: l.totalMinor,
  }));

async function resolveCustomer(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, accountId: string | null | undefined, newCustomer?: { name: string; email?: string | null } | null) {
  if (accountId) {
    const a = await tx.account.findFirst({ where: { id: accountId, organizationId, companyId }, select: { id: true, name: true } });
    if (!a) throw notFound("Customer");
    return a;
  }
  if (newCustomer?.name) {
    const a = await createCounterparty(ctx, organizationId, companyId, { name: newCustomer.name, email: newCustomer.email ?? null, type: "CUSTOMER" }, { tx });
    return { id: a.id, name: a.name };
  }
  throw invalid("Choose a customer", { reason: "finance_customer_required" });
}

const newCustomerInput = z.object({ name: z.string().trim().min(1).max(200), email: z.string().trim().email().max(254).nullable().optional().or(z.literal("").transform(() => null)) }).nullable().optional();

/** Balance still owed on an invoice. */
export const balanceOf = (i: { totalMinor: bigint; paidMinor: bigint; creditedMinor: bigint }) => i.totalMinor - i.paidMinor - i.creditedMinor;

/** Status implied by amounts and the due date (DRAFT and VOID are kept). */
export function derivedStatus(i: { status: InvoiceStatus; totalMinor: bigint; paidMinor: bigint; creditedMinor: bigint; dueDate: Date }, today = todayUtc()): InvoiceStatus {
  if (i.status === "DRAFT" || i.status === "VOID") return i.status;
  if (balanceOf(i) <= 0n) return "PAID";
  if (i.dueDate < today) return "OVERDUE";
  return i.paidMinor + i.creditedMinor > 0n ? "PARTIALLY_PAID" : "SENT";
}

// ───────────── Invoices ─────────────

export const invoiceInput = z.object({
  accountId: uuid.nullable().optional(),
  newCustomer: newCustomerInput,
  issueDate: day,
  dueDate: day.optional().or(z.literal("").transform(() => undefined)),
  discount: z.union([z.number(), z.string()]).optional().nullable(),
  notes: optionalText(5000),
  terms: optionalText(5000),
  lines: z.array(lineInput).min(1).max(200),
});
export const updateInvoiceInput = invoiceInput.partial();

export interface InvoiceFilters {
  q?: string;
  status?: InvoiceStatus;
  accountId?: string;
  from?: string;
  to?: string;
  sort: "issueDate" | "dueDate" | "total" | "number";
  dir: "asc" | "desc";
  page: number;
}

export function parseInvoiceFilters(raw: Record<string, string | string[] | undefined>): InvoiceFilters {
  const status = param(raw, "status");
  const sort = param(raw, "sort");
  const d = (k: string) => {
    const v = param(raw, k);
    return v && day.safeParse(v).success ? v : undefined;
  };
  const acct = param(raw, "customer");
  return {
    q: param(raw, "q")?.slice(0, 200),
    status: (INVOICE_STATUSES as readonly string[]).includes(status ?? "") ? (status as InvoiceStatus) : undefined,
    accountId: isUuid(acct) ? acct : undefined,
    from: d("from"),
    to: d("to"),
    sort: sort === "dueDate" || sort === "total" || sort === "number" ? sort : "issueDate",
    dir: param(raw, "dir") === "asc" ? "asc" : "desc",
    page: pageParam(raw),
  };
}

export async function listInvoices(ctx: RequestContext, organizationId: string, companyId: string, f: InvoiceFilters) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const where: Prisma.InvoiceWhereInput = {
    organizationId,
    companyId,
    ...(f.status ? { status: f.status } : {}),
    ...(f.accountId ? { accountId: f.accountId } : {}),
    ...(f.from || f.to ? { issueDate: { ...(f.from ? { gte: toDay(f.from) } : {}), ...(f.to ? { lte: toDay(f.to) } : {}) } } : {}),
    ...(f.q ? { OR: [{ number: { contains: f.q, mode: "insensitive" } }, { account: { name: { contains: f.q, mode: "insensitive" } } }, { notes: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
  const orderBy: Prisma.InvoiceOrderByWithRelationInput[] =
    f.sort === "total" ? [{ totalMinor: f.dir }] : f.sort === "dueDate" ? [{ dueDate: f.dir }] : f.sort === "number" ? [{ number: f.dir }] : [{ issueDate: f.dir }, { number: f.dir }];
  const [total, rows] = await Promise.all([
    db().invoice.count({ where }),
    db().invoice.findMany({ where, orderBy, skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { account: { select: { id: true, name: true } } } }),
  ]);
  return { total, rows: rows.map((r) => ({ ...r, balanceMinor: balanceOf(r) })), pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

const invoiceDetail = {
  account: { select: { id: true, name: true, email: true, address: true, phone: true } },
  lines: { orderBy: { position: "asc" }, include: { taxRate: { select: { name: true } } } },
  payments: { orderBy: { date: "asc" }, include: { financeAccount: { select: { id: true, name: true } } } },
  credits: { orderBy: { createdAt: "asc" }, include: { creditNote: { select: { id: true, number: true } } } },
  emails: { orderBy: { createdAt: "desc" }, take: 20 },
} satisfies Prisma.InvoiceInclude;

export async function getInvoice(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const inv = isUuid(id) ? await db().invoice.findFirst({ where: { id, organizationId, companyId }, include: invoiceDetail }) : null;
  if (!inv) throw notFound("Invoice");
  return { ...inv, balanceMinor: balanceOf(inv) };
}

/** Public view by token (no login): issued invoices only; never drafts. */
export async function getPublicInvoice(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const inv = await db().invoice.findFirst({ where: { publicToken: token, status: { not: "DRAFT" } }, include: { ...invoiceDetail, emails: false, company: { select: { name: true, legalName: true, defaultLocale: true, timezone: true } } } });
  if (!inv) return null;
  const settings = await financeSettings(db(), inv.organizationId, inv.companyId);
  return { ...inv, balanceMinor: balanceOf(inv), footer: settings.invoiceFooter };
}

export const publicInvoiceUrl = (token: string, locale = "en-US") => `${env().APP_URL.replace(/\/$/, "")}/${locale}/i/${token}`;

/** Create a draft invoice in an open transaction (API, estimate conversion, recurring job, AI). */
export async function createInvoiceTx(
  tx: Tx,
  ctx: RequestContext,
  organizationId: string,
  companyId: string,
  input: z.output<typeof invoiceInput>,
  extra: { estimateId?: string; recurringInvoiceId?: string; source?: string } = {},
) {
  const company = await companyInfo(tx, organizationId, companyId);
  await ensureFinanceSetup(tx, organizationId, companyId);
  const settings = await financeSettings(tx, organizationId, companyId);
  const customer = await resolveCustomer(tx, ctx, organizationId, companyId, input.accountId, input.newCustomer);
  const discountBps = percentToBps(input.discount ?? 0);
  const totals = await computeLines(tx, organizationId, companyId, company.baseCurrency, input.lines, discountBps);
  const issueDate = toDay(input.issueDate);
  const dueDate = input.dueDate ? toDay(input.dueDate) : addDays(issueDate, settings.defaultDueDays);
  if (dueDate < issueDate) throw invalid("The due date can't be before the issue date", { reason: "finance_bad_range" });
  const seq = await nextSequence(tx, organizationId, companyId, "INVOICE");
  const inv = await tx.invoice.create({
    data: {
      organizationId,
      companyId,
      number: `${settings.invoicePrefix}${String(seq).padStart(4, "0")}`,
      accountId: customer.id,
      issueDate,
      dueDate,
      currency: company.baseCurrency,
      discountBps,
      subtotalMinor: totals.subtotalMinor,
      discountMinor: totals.discountMinor,
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
      estimateId: extra.estimateId ?? null,
      recurringInvoiceId: extra.recurringInvoiceId ?? null,
      createdById: actorId(ctx, organizationId),
    },
  });
  await tx.billingLine.createMany({ data: lineRows(organizationId, companyId, totals.lines, { invoiceId: inv.id }) });
  await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.invoice.created", resourceType: "invoice", resourceId: inv.id, newValue: { number: inv.number, totalMinor: inv.totalMinor, accountId: customer.id, source: extra.source ?? "manual" } });
  await emitDomainEvent(tx, ctx, "invoice.created", {
    organizationId,
    companyId,
    entityType: "invoice",
    entityId: inv.id,
    data: { number: inv.number, customerId: customer.id, customerName: customer.name, totalMinor: inv.totalMinor, currency: inv.currency, dueDate: inv.dueDate, status: inv.status },
  });
  return inv;
}

export async function createInvoice(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof invoiceInput>) {
  const input = invoiceInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    return createInvoiceTx(tx, ctx, organizationId, companyId, input);
  });
}

export async function updateInvoice(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateInvoiceInput>) {
  const input = updateInvoiceInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.invoice.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!before) throw notFound("Invoice");
    if (before.status !== "DRAFT") throw conflict("Only draft invoices can be edited", { reason: "finance_invoice_not_draft" });
    const customer = input.accountId || input.newCustomer?.name ? await resolveCustomer(tx, ctx, organizationId, companyId, input.accountId, input.newCustomer) : null;
    const discountBps = input.discount !== undefined ? percentToBps(input.discount ?? 0) : before.discountBps;
    const issueDate = input.issueDate ? toDay(input.issueDate) : before.issueDate;
    const dueDate = input.dueDate ? toDay(input.dueDate) : before.dueDate;
    if (dueDate < issueDate) throw invalid("The due date can't be before the issue date", { reason: "finance_bad_range" });
    let totals: Awaited<ReturnType<typeof computeLines>> | null = null;
    if (input.lines || input.discount !== undefined) {
      const lines: LineInput[] =
        input.lines ??
        (await tx.billingLine.findMany({ where: { invoiceId: id }, orderBy: { position: "asc" } })).map((l) => ({
          description: l.description,
          quantity: String(l.quantityMilli / 1000),
          unitPrice: minorToMajor(l.unitPriceMinor, before.currency),
          discount: l.discountBps / 100,
          taxRateId: l.taxRateId,
        }));
      totals = await computeLines(tx, organizationId, companyId, before.currency, lines, discountBps);
      await tx.billingLine.deleteMany({ where: { invoiceId: id } });
      await tx.billingLine.createMany({ data: lineRows(organizationId, companyId, totals.lines, { invoiceId: id }) });
    }
    const inv = await tx.invoice.update({
      where: { id },
      data: {
        ...(customer ? { accountId: customer.id } : {}),
        issueDate,
        dueDate,
        discountBps,
        notes: input.notes === undefined ? undefined : input.notes,
        terms: input.terms === undefined ? undefined : input.terms,
        ...(totals ? { subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor, taxMinor: totals.taxMinor, totalMinor: totals.totalMinor } : {}),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.invoice.updated", resourceType: "invoice", resourceId: id, oldValue: { totalMinor: before.totalMinor }, newValue: { totalMinor: inv.totalMinor } });
    return inv;
  });
}

const minorToMajor = fromMinor;

export async function deleteInvoice(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.invoice.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!before) throw notFound("Invoice");
    if (before.status !== "DRAFT") throw conflict("Issued invoices can't be deleted; void them instead", { reason: "finance_invoice_not_draft" });
    await tx.estimate.updateMany({ where: { invoiceId: id }, data: { invoiceId: null, status: "ACCEPTED" } });
    await tx.invoice.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.invoice.deleted", resourceType: "invoice", resourceId: id, oldValue: { number: before.number } });
    return { ok: true };
  });
}

/** DRAFT → issued: number is final, journal posted (Dr AR / Cr revenue, tax), public link created. */
async function issueTx(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  const inv = await tx.invoice.findFirst({ where: { id, organizationId, companyId }, include: { lines: true, account: { select: { name: true } } } });
  if (!inv) throw notFound("Invoice");
  if (inv.status !== "DRAFT") return inv;
  if (inv.totalMinor <= 0n) throw conflict("The invoice total must be greater than zero", { reason: "finance_invoice_zero" });
  const ar = await systemAccount(tx, organizationId, companyId, "ar");
  const revenue = await systemAccount(tx, organizationId, companyId, "revenue");
  const taxByAccount = new Map<string, bigint>();
  const defaultTax = await systemAccount(tx, organizationId, companyId, "tax");
  const rateIds = [...new Set(inv.lines.map((l) => l.taxRateId).filter((x): x is string => !!x))];
  const rates = rateIds.length ? await tx.financeTaxRate.findMany({ where: { id: { in: rateIds } }, select: { id: true, ledgerAccountId: true } }) : [];
  const rateLedger = new Map(rates.map((r) => [r.id, r.ledgerAccountId ?? defaultTax]));
  for (const l of inv.lines) if (l.taxMinor) {
    const acc = (l.taxRateId && rateLedger.get(l.taxRateId)) || defaultTax;
    taxByAccount.set(acc, (taxByAccount.get(acc) ?? 0n) + l.taxMinor);
  }
  const net = inv.totalMinor - inv.taxMinor;
  await postEntry(tx, ctx, {
    organizationId,
    companyId,
    date: inv.issueDate,
    memo: `Invoice ${inv.number} — ${inv.account.name}`,
    source: "INVOICE",
    sourceId: inv.id,
    lines: [{ ledgerAccountId: ar, debitMinor: inv.totalMinor }, { ledgerAccountId: revenue, creditMinor: net }, ...[...taxByAccount].map(([ledgerAccountId, v]) => ({ ledgerAccountId, creditMinor: v }))],
  });
  // Overdue is set by the periodic job, which also emits invoice.overdue and notifies finance.
  return tx.invoice.update({ where: { id }, data: { status: "SENT", issuedAt: new Date(), publicToken: inv.publicToken ?? randomToken(24) }, include: { lines: true, account: { select: { name: true } } } });
}

async function emitSent(tx: Tx, ctx: RequestContext, inv: { id: string; organizationId: string; companyId: string; number: string; accountId: string; totalMinor: bigint; currency: string; dueDate: Date }, channel: "email" | "manual") {
  await emitDomainEvent(tx, ctx, "invoice.sent", {
    organizationId: inv.organizationId,
    companyId: inv.companyId,
    entityType: "invoice",
    entityId: inv.id,
    data: { number: inv.number, customerId: inv.accountId, totalMinor: inv.totalMinor, currency: inv.currency, dueDate: inv.dueDate, channel },
  });
}

/** Mark as sent without emailing (sent by other means): issues the invoice. */
export async function markInvoiceSent(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.invoice.findFirst({ where: { id, organizationId, companyId }, select: { status: true } }) : null;
    if (!before) throw notFound("Invoice");
    if (before.status !== "DRAFT") throw conflict("Already issued", { reason: "finance_invoice_not_draft" });
    const inv = await issueTx(tx, ctx, organizationId, companyId, id);
    await tx.invoice.update({ where: { id }, data: { sentAt: new Date() } });
    await emitSent(tx, ctx, inv, "manual");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.invoice.issued", resourceType: "invoice", resourceId: id, newValue: { number: inv.number } });
    return inv;
  });
}

export const sendInput = z.object({
  to: z.string().trim().email().max(254).optional().or(z.literal("").transform(() => undefined)),
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(5000),
  locale: z.string().max(10).optional(),
});

/**
 * Email the invoice (or a reminder) to the customer through the platform email provider. The invoice is issued and marked
 * sent only when the provider accepted the message; NOT_CONFIGURED / FAILED are recorded truthfully and nothing changes.
 */
export async function emailInvoice(ctx: RequestContext, organizationId: string, companyId: string, id: string, kind: "INVOICE" | "REMINDER", raw: z.input<typeof sendInput>) {
  const input = sendInput.parse(raw);
  const prepared = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const inv = isUuid(id) ? await tx.invoice.findFirst({ where: { id, organizationId, companyId }, include: { account: { select: { email: true, name: true } } } }) : null;
    if (!inv) throw notFound("Invoice");
    if (inv.status === "VOID") throw conflict("The invoice is void", { reason: "finance_invoice_void" });
    if (kind === "REMINDER" && !OPEN_STATUSES.includes(inv.status)) throw conflict("Reminders are for unpaid issued invoices", { reason: "finance_invoice_not_open" });
    if (kind === "INVOICE" && inv.totalMinor <= 0n) throw conflict("The invoice total must be greater than zero", { reason: "finance_invoice_zero" });
    const to = input.to ?? inv.account.email;
    if (!to) throw conflict("The customer has no email address", { reason: "finance_customer_no_email" });
    const token = inv.publicToken ?? randomToken(24);
    if (!inv.publicToken) await tx.invoice.update({ where: { id }, data: { publicToken: token } });
    return { inv, to, token };
  });
  const link = publicInvoiceUrl(prepared.token, input.locale);
  const withView = input.message.includes(link) ? input.message : `${input.message}\n\n${link}`;
  // Online payment link (when one was created through the connected payment provider).
  const payLink = prepared.inv.paymentLinkUrl;
  const text = payLink && !withView.includes(payLink) ? `${withView}\n\nPay online: ${payLink}` : withView;
  const result = await sendPlainEmail({ to: prepared.to, subject: input.subject, text, template: kind === "INVOICE" ? "finance_invoice" : "finance_invoice_reminder", organizationId, userId: ctx.actor.id ?? null, locale: input.locale });
  await transaction(async (tx) => {
    await tx.financeEmailLog.create({ data: { organizationId, companyId, invoiceId: id, kind, toEmail: prepared.to, status: result.status, sentById: ctx.actor.id ?? null } });
    if (result.status === "SENT") {
      if (kind === "INVOICE") {
        const inv = await issueTx(tx, ctx, organizationId, companyId, id);
        await tx.invoice.update({ where: { id }, data: { sentAt: new Date() } });
        await emitSent(tx, ctx, inv, "email");
      } else {
        await tx.invoice.update({ where: { id }, data: { lastReminderAt: new Date() } });
      }
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: kind === "INVOICE" ? "finance.invoice.emailed" : "finance.invoice.reminder", resourceType: "invoice", resourceId: id, newValue: { status: result.status } });
  });
  return { status: result.status };
}

export async function voidInvoice(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const inv = isUuid(id) ? await tx.invoice.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!inv) throw notFound("Invoice");
    if (inv.status === "DRAFT") throw conflict("Delete drafts instead of voiding them", { reason: "finance_invoice_draft" });
    if (inv.status === "VOID") throw conflict("Already void", { reason: "finance_invoice_void" });
    if (inv.paidMinor > 0n || inv.creditedMinor > 0n) throw conflict("Remove payments and credits before voiding", { reason: "finance_invoice_has_payments" });
    await removeSourcePostings(tx, ctx, organizationId, companyId, "INVOICE", id, `Invoice ${inv.number} voided`);
    const r = await tx.invoice.update({ where: { id }, data: { status: "VOID", voidedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.invoice.voided", resourceType: "invoice", resourceId: id, oldValue: { status: inv.status } });
    return r;
  });
}

// ───────────── Payments ─────────────

export const paymentInput = z.object({
  amount: positiveAmount,
  date: day,
  method: z.enum(PAYMENT_METHODS).default("BANK_TRANSFER"),
  financeAccountId: uuid,
  reference: optionalText(120),
});

async function refreshInvoiceStatus(tx: Tx, ctx: RequestContext, id: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { account: { select: { name: true } } } });
  const status = derivedStatus(inv);
  if (status !== inv.status) {
    await tx.invoice.update({ where: { id }, data: { status, paidAt: status === "PAID" ? new Date() : null } });
    if (status === "PAID") {
      await emitDomainEvent(tx, ctx, "invoice.paid", {
        organizationId: inv.organizationId,
        companyId: inv.companyId,
        entityType: "invoice",
        entityId: id,
        data: { number: inv.number, customerId: inv.accountId, customerName: inv.account.name, totalMinor: inv.totalMinor, currency: inv.currency },
      });
      const recipients = await usersWithPermission(tx, inv.organizationId, inv.companyId, "finance.manage");
      await notifyUsers(tx, inv.organizationId, recipients.filter((u) => u !== ctx.actor.id), "finance.invoice_paid", { companyId: inv.companyId, title: `${inv.number} · ${inv.account.name}`, href: `/finance/invoices/${id}` });
    }
  }
  return status;
}

export async function recordPayment(ctx: RequestContext, organizationId: string, companyId: string, invoiceId: string, raw: z.input<typeof paymentInput>, opts: { tx?: Tx } = {}) {
  const input = paymentInput.parse(raw);
  const run = async (tx: Tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const inv = isUuid(invoiceId) ? await tx.invoice.findFirst({ where: { id: invoiceId, organizationId, companyId }, include: { account: { select: { name: true } } } }) : null;
    if (!inv) throw notFound("Invoice");
    if (!OPEN_STATUSES.includes(inv.status)) throw conflict("Payments can be recorded on issued, unpaid invoices", { reason: "finance_invoice_not_open" });
    const acct = await tx.financeAccount.findFirst({ where: { id: input.financeAccountId, organizationId, companyId, archivedAt: null }, select: { id: true, ledgerAccountId: true } });
    if (!acct) throw notFound("Account");
    const amountMinor = toMinor(input.amount, inv.currency);
    if (amountMinor > balanceOf(inv)) throw invalid("The payment is larger than the balance due", { reason: "finance_overpayment" });
    const date = toDay(input.date);
    const payment = await tx.invoicePayment.create({
      data: { organizationId, companyId, invoiceId, date, amountMinor, method: input.method, reference: input.reference ?? null, financeAccountId: acct.id, createdById: actorId(ctx, organizationId) },
    });
    const entry = await postEntry(tx, ctx, {
      organizationId,
      companyId,
      date,
      memo: `Payment for ${inv.number} — ${inv.account.name}`,
      source: "PAYMENT",
      sourceId: payment.id,
      lines: [
        { ledgerAccountId: acct.ledgerAccountId, debitMinor: amountMinor },
        { ledgerAccountId: await systemAccount(tx, organizationId, companyId, "ar"), creditMinor: amountMinor },
      ],
    });
    await tx.invoicePayment.update({ where: { id: payment.id }, data: { journalEntryId: entry?.id ?? null } });
    // Mirror in the bank register so balances, cash flow and reconciliation see the money.
    await tx.financeTransaction.create({
      data: {
        organizationId,
        companyId,
        type: "INCOME",
        date,
        amountMinor,
        currency: inv.currency,
        financeAccountId: acct.id,
        accountId: inv.accountId,
        description: `Payment ${inv.number}`,
        reference: input.reference ?? null,
        source: "PAYMENT",
        paymentId: payment.id,
        journalEntryId: entry?.id ?? null,
        createdById: actorId(ctx, organizationId),
      },
    });
    await tx.invoice.update({ where: { id: invoiceId }, data: { paidMinor: { increment: amountMinor } } });
    await emitDomainEvent(tx, ctx, "payment.received", {
      organizationId,
      companyId,
      entityType: "invoice_payment",
      entityId: payment.id,
      data: { invoiceId, invoiceNumber: inv.number, customerId: inv.accountId, amountMinor, currency: inv.currency, method: input.method, date },
    });
    await refreshInvoiceStatus(tx, ctx, invoiceId);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.payment.recorded", resourceType: "invoice", resourceId: invoiceId, newValue: { paymentId: payment.id, amountMinor } });
    return payment;
  };
  return opts.tx ? run(opts.tx) : transaction(run);
}

export async function deletePayment(ctx: RequestContext, organizationId: string, companyId: string, paymentId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const p = isUuid(paymentId) ? await tx.invoicePayment.findFirst({ where: { id: paymentId, organizationId, companyId }, include: { invoice: { select: { number: true } } } }) : null;
    if (!p) throw notFound("Payment");
    const txn = await tx.financeTransaction.findFirst({ where: { paymentId }, select: { id: true, reconciledAt: true } });
    if (txn?.reconciledAt) throw conflict("The payment is reconciled and can't be removed", { reason: "finance_txn_reconciled" });
    await removeSourcePostings(tx, ctx, organizationId, companyId, "PAYMENT", paymentId, `Payment removed: ${p.invoice.number}`);
    if (txn) await tx.financeTransaction.delete({ where: { id: txn.id } });
    await tx.invoicePayment.delete({ where: { id: paymentId } });
    await tx.invoice.update({ where: { id: p.invoiceId }, data: { paidMinor: { decrement: p.amountMinor } } });
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: p.invoiceId } });
    // Back from PAID to open: recompute without emitting paid.
    if (inv.status === "PAID") await tx.invoice.update({ where: { id: inv.id }, data: { status: derivedStatus({ ...inv, status: "SENT" }), paidAt: null } });
    else await refreshInvoiceStatus(tx, ctx, inv.id);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.payment.deleted", resourceType: "invoice", resourceId: p.invoiceId, oldValue: { paymentId, amountMinor: p.amountMinor } });
    return { ok: true };
  });
}

// ───────────── Credit notes ─────────────

export const creditNoteInput = z.object({
  accountId: uuid,
  issueDate: day,
  amount: positiveAmount,
  reason: z.string().trim().min(1).max(1000),
  /** Optionally apply right away to this invoice (up to its balance). */
  invoiceId: uuid.nullable().optional().or(z.literal("").transform(() => null)),
});
export const applyCreditInput = z.object({ invoiceId: uuid, amount: positiveAmount });

export async function listCreditNotes(ctx: RequestContext, organizationId: string, companyId: string, opts: { q?: string; status?: string; page?: number } = {}) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const where: Prisma.CreditNoteWhereInput = {
    organizationId,
    companyId,
    ...(opts.status === "OPEN" || opts.status === "APPLIED" || opts.status === "VOID" ? { status: opts.status } : {}),
    ...(opts.q ? { OR: [{ number: { contains: opts.q, mode: "insensitive" } }, { reason: { contains: opts.q, mode: "insensitive" } }, { account: { name: { contains: opts.q, mode: "insensitive" } } }] } : {}),
  };
  const page = opts.page ?? 1;
  const [total, rows] = await Promise.all([
    db().creditNote.count({ where }),
    db().creditNote.findMany({ where, orderBy: [{ issueDate: "desc" }, { number: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { account: { select: { id: true, name: true } }, applications: { include: { invoice: { select: { id: true, number: true } } } } } }),
  ]);
  return { total, rows, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

async function applyCreditTx(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, creditNoteId: string, invoiceId: string, amountMinor: bigint) {
  const cn = await tx.creditNote.findFirst({ where: { id: creditNoteId, organizationId, companyId } });
  if (!cn) throw notFound("Credit note");
  if (cn.status !== "OPEN") throw conflict("This credit note is fully applied or void", { reason: "finance_credit_not_open" });
  const inv = await tx.invoice.findFirst({ where: { id: invoiceId, organizationId, companyId } });
  if (!inv) throw notFound("Invoice");
  if (inv.accountId !== cn.accountId) throw conflict("The invoice belongs to another customer", { reason: "finance_credit_other_customer" });
  if (!OPEN_STATUSES.includes(inv.status)) throw conflict("Credits can be applied to issued, unpaid invoices", { reason: "finance_invoice_not_open" });
  if (amountMinor > cn.amountMinor - cn.appliedMinor) throw invalid("More than the credit note's remaining amount", { reason: "finance_credit_exceeds" });
  if (amountMinor > balanceOf(inv)) throw invalid("More than the invoice balance", { reason: "finance_overpayment" });
  const app = await tx.creditNoteApplication.create({ data: { organizationId, companyId, creditNoteId, invoiceId, amountMinor, createdById: actorId(ctx, organizationId) } });
  const entry = await postEntry(tx, ctx, {
    organizationId,
    companyId,
    date: todayUtc() < cn.issueDate ? cn.issueDate : todayUtc(),
    memo: `Credit note ${cn.number} applied to ${inv.number}`,
    source: "CREDIT_NOTE",
    sourceId: app.id,
    lines: [
      { ledgerAccountId: await systemAccount(tx, organizationId, companyId, "returns"), debitMinor: amountMinor },
      { ledgerAccountId: await systemAccount(tx, organizationId, companyId, "ar"), creditMinor: amountMinor },
    ],
  });
  await tx.creditNoteApplication.update({ where: { id: app.id }, data: { journalEntryId: entry?.id ?? null } });
  const applied = cn.appliedMinor + amountMinor;
  await tx.creditNote.update({ where: { id: cn.id }, data: { appliedMinor: applied, status: applied >= cn.amountMinor ? "APPLIED" : "OPEN" } });
  await tx.invoice.update({ where: { id: invoiceId }, data: { creditedMinor: { increment: amountMinor } } });
  await refreshInvoiceStatus(tx, ctx, invoiceId);
  await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.credit_note.applied", resourceType: "credit_note", resourceId: cn.id, newValue: { invoiceId, amountMinor } });
  return app;
}

export async function createCreditNote(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof creditNoteInput>) {
  const input = creditNoteInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const company = await companyInfo(tx, organizationId, companyId);
    await ensureFinanceSetup(tx, organizationId, companyId);
    if (!(await tx.account.findFirst({ where: { id: input.accountId, organizationId, companyId }, select: { id: true } }))) throw notFound("Customer");
    const settings = await financeSettings(tx, organizationId, companyId);
    const seq = await nextSequence(tx, organizationId, companyId, "CREDIT_NOTE");
    const cn = await tx.creditNote.create({
      data: {
        organizationId,
        companyId,
        number: `${settings.creditNotePrefix}${String(seq).padStart(4, "0")}`,
        accountId: input.accountId,
        issueDate: toDay(input.issueDate),
        amountMinor: toMinor(input.amount, company.baseCurrency),
        currency: company.baseCurrency,
        reason: input.reason,
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.credit_note.created", resourceType: "credit_note", resourceId: cn.id, newValue: { number: cn.number, amountMinor: cn.amountMinor } });
    if (input.invoiceId) {
      const inv = await tx.invoice.findFirst({ where: { id: input.invoiceId, organizationId, companyId } });
      if (!inv) throw notFound("Invoice");
      const amt = cn.amountMinor < balanceOf(inv) ? cn.amountMinor : balanceOf(inv);
      if (amt > 0n) await applyCreditTx(tx, ctx, organizationId, companyId, cn.id, inv.id, amt);
    }
    return cn;
  });
}

export async function applyCreditNote(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof applyCreditInput>) {
  const input = applyCreditInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    if (!isUuid(id)) throw notFound("Credit note");
    const cn = await tx.creditNote.findFirst({ where: { id, organizationId, companyId }, select: { currency: true } });
    if (!cn) throw notFound("Credit note");
    return applyCreditTx(tx, ctx, organizationId, companyId, id, input.invoiceId, toMinor(input.amount, cn.currency));
  });
}

export async function voidCreditNote(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const cn = isUuid(id) ? await tx.creditNote.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!cn) throw notFound("Credit note");
    if (cn.appliedMinor > 0n) throw conflict("Applied credit notes can't be voided", { reason: "finance_credit_applied" });
    if (cn.status === "VOID") throw conflict("Already void", { reason: "finance_credit_not_open" });
    await tx.creditNote.update({ where: { id }, data: { status: "VOID" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.credit_note.voided", resourceType: "credit_note", resourceId: id });
    return { ok: true };
  });
}

// ───────────── Estimates ─────────────

export const estimateInput = z.object({
  accountId: uuid.nullable().optional(),
  newCustomer: newCustomerInput,
  issueDate: day,
  expiryDate: day.nullable().optional().or(z.literal("").transform(() => null)),
  discount: z.union([z.number(), z.string()]).optional().nullable(),
  notes: optionalText(5000),
  terms: optionalText(5000),
  lines: z.array(lineInput).min(1).max(200),
});
export const updateEstimateInput = estimateInput.partial();

export async function listEstimates(ctx: RequestContext, organizationId: string, companyId: string, opts: { q?: string; status?: EstimateStatus; page?: number } = {}) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const where: Prisma.EstimateWhereInput = {
    organizationId,
    companyId,
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.q ? { OR: [{ number: { contains: opts.q, mode: "insensitive" } }, { account: { name: { contains: opts.q, mode: "insensitive" } } }] } : {}),
  };
  const page = opts.page ?? 1;
  const [total, rows] = await Promise.all([
    db().estimate.count({ where }),
    db().estimate.findMany({ where, orderBy: [{ issueDate: "desc" }, { number: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { account: { select: { id: true, name: true } } } }),
  ]);
  return { total, rows, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getEstimate(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const e = isUuid(id)
    ? await db().estimate.findFirst({
        where: { id, organizationId, companyId },
        include: { account: { select: { id: true, name: true, email: true, address: true, phone: true } }, lines: { orderBy: { position: "asc" }, include: { taxRate: { select: { name: true } } } }, emails: { orderBy: { createdAt: "desc" }, take: 20 } },
      })
    : null;
  if (!e) throw notFound("Estimate");
  return e;
}

export async function createEstimate(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof estimateInput>) {
  const input = estimateInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const company = await companyInfo(tx, organizationId, companyId);
    const settings = await financeSettings(tx, organizationId, companyId);
    const customer = await resolveCustomer(tx, ctx, organizationId, companyId, input.accountId, input.newCustomer);
    const discountBps = percentToBps(input.discount ?? 0);
    const totals = await computeLines(tx, organizationId, companyId, company.baseCurrency, input.lines, discountBps);
    const seq = await nextSequence(tx, organizationId, companyId, "ESTIMATE");
    const e = await tx.estimate.create({
      data: {
        organizationId,
        companyId,
        number: `${settings.estimatePrefix}${String(seq).padStart(4, "0")}`,
        accountId: customer.id,
        issueDate: toDay(input.issueDate),
        expiryDate: input.expiryDate ? toDay(input.expiryDate) : null,
        currency: company.baseCurrency,
        discountBps,
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        createdById: actorId(ctx, organizationId),
      },
    });
    await tx.billingLine.createMany({ data: lineRows(organizationId, companyId, totals.lines, { estimateId: e.id }) });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.estimate.created", resourceType: "estimate", resourceId: e.id, newValue: { number: e.number, totalMinor: e.totalMinor } });
    return e;
  });
}

export async function updateEstimate(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateEstimateInput>) {
  const input = updateEstimateInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.estimate.findFirst({ where: { id, organizationId, companyId }, include: { lines: { orderBy: { position: "asc" } } } }) : null;
    if (!before) throw notFound("Estimate");
    if (before.status === "CONVERTED") throw conflict("Converted estimates can't be edited", { reason: "finance_estimate_converted" });
    const customer = input.accountId || input.newCustomer?.name ? await resolveCustomer(tx, ctx, organizationId, companyId, input.accountId, input.newCustomer) : null;
    const discountBps = input.discount !== undefined ? percentToBps(input.discount ?? 0) : before.discountBps;
    const lines: LineInput[] = input.lines ?? before.lines.map((l) => ({ description: l.description, quantity: String(l.quantityMilli / 1000), unitPrice: minorToMajor(l.unitPriceMinor, before.currency), discount: l.discountBps / 100, taxRateId: l.taxRateId }));
    const totals = await computeLines(tx, organizationId, companyId, before.currency, lines, discountBps);
    await tx.billingLine.deleteMany({ where: { estimateId: id } });
    await tx.billingLine.createMany({ data: lineRows(organizationId, companyId, totals.lines, { estimateId: id }) });
    const e = await tx.estimate.update({
      where: { id },
      data: {
        ...(customer ? { accountId: customer.id } : {}),
        issueDate: input.issueDate ? toDay(input.issueDate) : undefined,
        expiryDate: input.expiryDate === undefined ? undefined : input.expiryDate ? toDay(input.expiryDate) : null,
        discountBps,
        notes: input.notes === undefined ? undefined : input.notes,
        terms: input.terms === undefined ? undefined : input.terms,
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.estimate.updated", resourceType: "estimate", resourceId: id, newValue: { totalMinor: e.totalMinor } });
    return e;
  });
}

export async function setEstimateStatus(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: { status: "SENT" | "ACCEPTED" | "DECLINED" | "DRAFT" }) {
  const { status } = z.object({ status: z.enum(["DRAFT", "SENT", "ACCEPTED", "DECLINED"]) }).parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const e = isUuid(id) ? await tx.estimate.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!e) throw notFound("Estimate");
    if (e.status === "CONVERTED") throw conflict("Converted estimates can't change", { reason: "finance_estimate_converted" });
    const r = await tx.estimate.update({ where: { id }, data: { status, ...(status === "SENT" && !e.sentAt ? { sentAt: new Date() } : {}) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.estimate.status", resourceType: "estimate", resourceId: id, oldValue: { status: e.status }, newValue: { status } });
    return r;
  });
}

export async function deleteEstimate(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const e = isUuid(id) ? await tx.estimate.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!e) throw notFound("Estimate");
    if (e.status === "CONVERTED") throw conflict("Converted estimates are kept with their invoice", { reason: "finance_estimate_converted" });
    await tx.estimate.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.estimate.deleted", resourceType: "estimate", resourceId: id, oldValue: { number: e.number } });
    return { ok: true };
  });
}

/** Turn an estimate into a draft invoice with the same customer and lines. */
export async function convertEstimate(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const e = isUuid(id) ? await tx.estimate.findFirst({ where: { id, organizationId, companyId }, include: { lines: { orderBy: { position: "asc" } } } }) : null;
    if (!e) throw notFound("Estimate");
    if (e.status === "CONVERTED" || e.invoiceId) throw conflict("Already converted", { reason: "finance_estimate_converted" });
    if (e.status === "DECLINED") throw conflict("Declined estimates can't be converted", { reason: "finance_estimate_declined" });
    const inv = await createInvoiceTx(
      tx,
      ctx,
      organizationId,
      companyId,
      {
        accountId: e.accountId,
        issueDate: dayString(todayUtc()),
        discount: e.discountBps / 100,
        notes: e.notes,
        terms: e.terms,
        lines: e.lines.map((l) => ({ description: l.description, quantity: String(l.quantityMilli / 1000), unitPrice: minorToMajor(l.unitPriceMinor, e.currency), discount: l.discountBps / 100, taxRateId: l.taxRateId })),
      },
      { estimateId: e.id, source: "estimate" },
    );
    await tx.estimate.update({ where: { id }, data: { status: "CONVERTED", invoiceId: inv.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.estimate.converted", resourceType: "estimate", resourceId: id, newValue: { invoiceId: inv.id } });
    return inv;
  });
}

export async function emailEstimate(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof sendInput>) {
  const input = sendInput.parse(raw);
  const e = await getEstimate(ctx, organizationId, companyId, id);
  await authorize(ctx, organizationId, companyId, "finance.manage");
  const to = input.to ?? e.account.email;
  if (!to) throw conflict("The customer has no email address", { reason: "finance_customer_no_email" });
  const result = await sendPlainEmail({ to, subject: input.subject, text: input.message, template: "finance_estimate", organizationId, userId: ctx.actor.id ?? null, locale: input.locale });
  await transaction(async (tx) => {
    await tx.financeEmailLog.create({ data: { organizationId, companyId, estimateId: id, kind: "ESTIMATE", toEmail: to, status: result.status, sentById: ctx.actor.id ?? null } });
    if (result.status === "SENT" && e.status === "DRAFT") await tx.estimate.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.estimate.emailed", resourceType: "estimate", resourceId: id, newValue: { status: result.status } });
  });
  return { status: result.status };
}

// ───────────── Recurring invoices ─────────────

export const recurringInvoiceInput = z.object({
  name: z.string().trim().min(1).max(200),
  accountId: uuid,
  frequency: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
  nextIssueDate: day,
  endDate: day.nullable().optional().or(z.literal("").transform(() => null)),
  dueDays: z.coerce.number().int().min(0).max(365).default(30),
  discount: z.union([z.number(), z.string()]).optional().nullable(),
  notes: optionalText(5000),
  lines: z.array(lineInput).min(1).max(200),
  active: z.boolean().default(true),
});
export const updateRecurringInvoiceInput = recurringInvoiceInput.partial();

export async function listRecurringInvoices(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  return db().recurringInvoice.findMany({ where: { organizationId, companyId }, orderBy: [{ active: "desc" }, { nextIssueDate: "asc" }], include: { account: { select: { id: true, name: true } }, _count: { select: { invoices: true } } } });
}

export async function createRecurringInvoice(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof recurringInvoiceInput>) {
  const input = recurringInvoiceInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const company = await companyInfo(tx, organizationId, companyId);
    if (!(await tx.account.findFirst({ where: { id: input.accountId, organizationId, companyId }, select: { id: true } }))) throw notFound("Customer");
    const discountBps = percentToBps(input.discount ?? 0);
    const totals = await computeLines(tx, organizationId, companyId, company.baseCurrency, input.lines, discountBps);
    const r = await tx.recurringInvoice.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        accountId: input.accountId,
        frequency: input.frequency,
        nextIssueDate: toDay(input.nextIssueDate),
        endDate: input.endDate ? toDay(input.endDate) : null,
        dueDays: input.dueDays,
        discountBps,
        lines: input.lines as unknown as Prisma.InputJsonValue,
        notes: input.notes ?? null,
        currency: company.baseCurrency,
        netMinor: totals.netMinor,
        active: input.active,
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.recurring_invoice.created", resourceType: "recurring_invoice", resourceId: r.id, newValue: { name: r.name, frequency: r.frequency } });
    return r;
  });
}

export async function updateRecurringInvoice(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateRecurringInvoiceInput>) {
  const input = updateRecurringInvoiceInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.recurringInvoice.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!before) throw notFound("Recurring invoice");
    if (input.accountId && !(await tx.account.findFirst({ where: { id: input.accountId, organizationId, companyId }, select: { id: true } }))) throw notFound("Customer");
    const discountBps = input.discount !== undefined ? percentToBps(input.discount ?? 0) : before.discountBps;
    const lines = (input.lines ?? (before.lines as unknown as LineInput[])) as LineInput[];
    const totals = await computeLines(tx, organizationId, companyId, before.currency, lines, discountBps);
    const r = await tx.recurringInvoice.update({
      where: { id },
      data: {
        name: input.name,
        accountId: input.accountId,
        frequency: input.frequency,
        nextIssueDate: input.nextIssueDate ? toDay(input.nextIssueDate) : undefined,
        endDate: input.endDate === undefined ? undefined : input.endDate ? toDay(input.endDate) : null,
        dueDays: input.dueDays,
        discountBps,
        lines: lines as unknown as Prisma.InputJsonValue,
        notes: input.notes === undefined ? undefined : input.notes,
        netMinor: totals.netMinor,
        active: input.active,
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.recurring_invoice.updated", resourceType: "recurring_invoice", resourceId: id, newValue: { name: r.name, active: r.active } });
    return r;
  });
}

export async function deleteRecurringInvoice(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.recurringInvoice.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!before) throw notFound("Recurring invoice");
    await tx.invoice.updateMany({ where: { recurringInvoiceId: id }, data: { recurringInvoiceId: null } });
    await tx.recurringInvoice.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.recurring_invoice.deleted", resourceType: "recurring_invoice", resourceId: id, oldValue: { name: before.name } });
    return { ok: true };
  });
}

/** Generate the next invoice of a template now (draft), advancing its schedule. */
async function generateFromTemplate(tx: Tx, ctx: RequestContext, r: { id: string; organizationId: string; companyId: string; name: string; accountId: string; frequency: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY"; nextIssueDate: Date; endDate: Date | null; dueDays: number; discountBps: number; lines: unknown; notes: string | null }) {
  const inv = await createInvoiceTx(
    tx,
    ctx,
    r.organizationId,
    r.companyId,
    { accountId: r.accountId, issueDate: dayString(r.nextIssueDate), dueDate: dayString(addDays(r.nextIssueDate, r.dueDays)), discount: r.discountBps / 100, notes: r.notes, lines: r.lines as LineInput[] as z.output<typeof lineInput>[] },
    { recurringInvoiceId: r.id, source: "recurring" },
  );
  const next = advance(r.nextIssueDate, r.frequency);
  await tx.recurringInvoice.update({ where: { id: r.id }, data: { nextIssueDate: next, lastIssuedAt: new Date(), active: !(r.endDate && next > r.endDate) } });
  const recipients = await usersWithPermission(tx, r.organizationId, r.companyId, "finance.manage");
  await notifyUsers(tx, r.organizationId, recipients, "finance.recurring_invoice_generated", { companyId: r.companyId, title: `${inv.number} · ${r.name}`, href: `/finance/invoices/${inv.id}` });
  return inv;
}

export async function runRecurringInvoiceNow(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const r = isUuid(id) ? await tx.recurringInvoice.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!r) throw notFound("Recurring invoice");
    if (!r.active) throw conflict("The schedule is paused", { reason: "finance_recurring_paused" });
    return generateFromTemplate(tx, ctx, r);
  });
}

/** Worker: draft invoices for every due template (catching up at most 12 issues each). */
export async function runDueRecurringInvoices(now = new Date()): Promise<number> {
  const today = todayUtc(now);
  const due = await db().recurringInvoice.findMany({ where: { active: true, nextIssueDate: { lte: today } }, take: 200, select: { id: true } });
  let generated = 0;
  for (const { id } of due) {
    try {
      generated += await transaction(async (tx) => {
        let n = 0;
        for (; n < 12; n++) {
          const r = await tx.recurringInvoice.findFirst({ where: { id, active: true, nextIssueDate: { lte: today } } });
          if (!r || (r.endDate && r.nextIssueDate > r.endDate)) {
            if (r) await tx.recurringInvoice.update({ where: { id }, data: { active: false } });
            break;
          }
          await generateFromTemplate(tx, systemContext(), r);
        }
        return n;
      });
    } catch (err) {
      logger.warn({ err, recurringInvoiceId: id }, "recurring invoice run failed");
    }
  }
  return generated;
}

// ───────────── Receivables & overdue ─────────────

export const AGING_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export function agingBucket(dueDate: Date, today = todayUtc()): AgingBucket {
  const days = Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000);
  return days <= 0 ? "current" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90_plus";
}

export async function receivablesAging(ctx: RequestContext, organizationId: string, companyId: string, today = todayUtc()) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const open = await db().invoice.findMany({ where: { organizationId, companyId, status: { in: OPEN_STATUSES } }, orderBy: { dueDate: "asc" }, include: { account: { select: { id: true, name: true, email: true } } }, take: 5000 });
  const zero = () => Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0n])) as Record<AgingBucket, bigint>;
  const totals = zero();
  const byCustomer = new Map<string, { id: string; name: string; buckets: Record<AgingBucket, bigint>; total: bigint }>();
  const invoices = open.map((i) => {
    const bucket = agingBucket(i.dueDate, today);
    const bal = balanceOf(i);
    totals[bucket] += bal;
    const c = byCustomer.get(i.accountId) ?? { id: i.accountId, name: i.account.name, buckets: zero(), total: 0n };
    c.buckets[bucket] += bal;
    c.total += bal;
    byCustomer.set(i.accountId, c);
    return { ...i, balanceMinor: bal, bucket, daysOverdue: Math.max(0, Math.floor((today.getTime() - i.dueDate.getTime()) / 86_400_000)) };
  });
  return { totals, total: Object.values(totals).reduce((s, v) => s + v, 0n), customers: [...byCustomer.values()].sort((a, b) => (b.total > a.total ? 1 : -1)), invoices };
}

/** Worker: SENT / PARTIALLY_PAID invoices past their due date become OVERDUE; emits invoice.overdue and notifies finance. */
export async function markOverdueInvoices(now = new Date()): Promise<number> {
  const today = todayUtc(now);
  const due = await db().invoice.findMany({ where: { status: { in: ["SENT", "PARTIALLY_PAID"] }, dueDate: { lt: today } }, take: 500, select: { id: true } });
  let marked = 0;
  for (const { id } of due) {
    try {
      await transaction(async (tx) => {
        const { count } = await tx.invoice.updateMany({ where: { id, status: { in: ["SENT", "PARTIALLY_PAID"] }, dueDate: { lt: today } }, data: { status: "OVERDUE" } });
        if (!count) return;
        const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { account: { select: { name: true } } } });
        const ctx = systemContext();
        await emitDomainEvent(tx, ctx, "invoice.overdue", {
          organizationId: inv.organizationId,
          companyId: inv.companyId,
          entityType: "invoice",
          entityId: id,
          data: { number: inv.number, customerId: inv.accountId, customerName: inv.account.name, balanceMinor: balanceOf(inv), currency: inv.currency, dueDate: inv.dueDate },
        });
        const recipients = await usersWithPermission(tx, inv.organizationId, inv.companyId, "finance.manage");
        await notifyUsers(tx, inv.organizationId, recipients, "finance.invoice_overdue", { companyId: inv.companyId, title: `${inv.number} · ${inv.account.name}`, href: `/finance/invoices/${id}` });
        await writeAudit(tx, ctx, { category: "TENANT", organizationId: inv.organizationId, action: "finance.invoice.overdue", resourceType: "invoice", resourceId: id });
        marked++;
      });
    } catch (err) {
      logger.warn({ err, invoiceId: id }, "marking invoice overdue failed");
    }
  }
  return marked;
}
