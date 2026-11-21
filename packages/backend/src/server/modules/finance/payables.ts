import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { FinanceBillStatus } from "@/generated/prisma/enums";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { cancelPendingRequestsTx, openApprovalRequestTx } from "./approval-rules";
import { agingBucket, AGING_BUCKETS, computeLines, paymentInput, type AgingBucket } from "./billing";
import {
  actorId,
  addDays,
  amount,
  authorize,
  companyInfo,
  day,
  financeSettings,
  isUuid,
  optionalText,
  optionalUuid,
  PAGE_SIZE,
  pageParam,
  param,
  todayUtc,
  toDay,
  toMinor,
} from "./common";
import { decodeAttachment, findDocAttachment, upsertDocAttachment } from "./doc-attachments";
import { ensureFinanceSetup, postEntry, removeSourcePostings, systemAccount } from "./ledger";
import { createCounterparty } from "./setup";
import { OPEN_BILL_STATUSES } from "./spend";
import type { attachmentInput } from "./transactions";

export const BILL_STATUSES = ["DRAFT", "AWAITING_APPROVAL", "APPROVED", "PARTIALLY_PAID", "PAID", "VOID"] as const;
export { OPEN_BILL_STATUSES };

export const billLineInput = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.union([z.number(), z.string()]).transform((v) => String(v).trim()).pipe(z.string().regex(/^\d{1,9}(\.\d{1,3})?$/)),
  unitPrice: amount.refine((v) => !v.startsWith("-"), "Must not be negative"),
  taxRateId: optionalUuid,
  categoryId: optionalUuid,
  departmentId: optionalUuid,
  projectId: optionalUuid,
});

const newVendorInput = z.object({ name: z.string().trim().min(1).max(200), email: z.string().trim().email().max(254).nullable().optional().or(z.literal("").transform(() => null)) }).nullable().optional();

export const billInput = z.object({
  vendorId: optionalUuid,
  newVendor: newVendorInput,
  number: z.string().trim().min(1).max(60),
  issueDate: day,
  dueDate: day.optional().or(z.literal("").transform(() => undefined)),
  notes: optionalText(5000),
  lines: z.array(billLineInput).min(1).max(200),
  /** Submit for approval (or approve when no rule applies) right after saving. */
  submit: z.boolean().optional(),
});
export const updateBillInput = billInput.omit({ submit: true }).partial();

export interface BillFilters {
  q?: string;
  status?: FinanceBillStatus;
  vendorId?: string;
  departmentId?: string;
  projectId?: string;
  from?: string;
  to?: string;
  overdue?: boolean;
  sort: "dueDate" | "issueDate" | "total" | "number";
  dir: "asc" | "desc";
  page: number;
}

export function parseBillFilters(raw: Record<string, string | string[] | undefined>): BillFilters {
  const id = (k: string) => {
    const v = param(raw, k);
    return isUuid(v) ? v : undefined;
  };
  const d = (k: string) => {
    const v = param(raw, k);
    return v && day.safeParse(v).success ? v : undefined;
  };
  const status = param(raw, "status");
  const sort = param(raw, "sort");
  return {
    q: param(raw, "q")?.slice(0, 200),
    status: (BILL_STATUSES as readonly string[]).includes(status ?? "") ? (status as FinanceBillStatus) : undefined,
    vendorId: id("vendor"),
    departmentId: id("costCenter"),
    projectId: id("project"),
    from: d("from"),
    to: d("to"),
    overdue: param(raw, "overdue") === "1",
    sort: sort === "issueDate" || sort === "total" || sort === "number" ? sort : "dueDate",
    dir: param(raw, "dir") === "desc" ? "desc" : "asc",
    page: pageParam(raw),
  };
}

export const billBalance = (b: { totalMinor: bigint; paidMinor: bigint }) => b.totalMinor - b.paidMinor;

function billWhere(organizationId: string, companyId: string, f: Partial<BillFilters>): Prisma.FinanceBillWhereInput {
  const where: Prisma.FinanceBillWhereInput = { organizationId, companyId };
  const and: Prisma.FinanceBillWhereInput[] = [];
  if (f.status) where.status = f.status;
  if (f.vendorId) where.vendorId = f.vendorId;
  if (f.departmentId) and.push({ lines: { some: { departmentId: f.departmentId } } });
  if (f.projectId) and.push({ lines: { some: { projectId: f.projectId } } });
  if (f.from || f.to) where.issueDate = { ...(f.from ? { gte: toDay(f.from) } : {}), ...(f.to ? { lte: toDay(f.to) } : {}) };
  if (f.overdue) and.push({ status: { in: OPEN_BILL_STATUSES }, dueDate: { lt: todayUtc() } });
  if (f.q) {
    const contains = { contains: f.q, mode: "insensitive" as const };
    and.push({ OR: [{ number: contains }, { notes: contains }, { vendor: { name: contains } }, { lines: { some: { description: contains } } }] });
  }
  if (and.length) where.AND = and;
  return where;
}

export async function listBills(ctx: RequestContext, organizationId: string, companyId: string, f: BillFilters) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const where = billWhere(organizationId, companyId, f);
  const orderBy: Prisma.FinanceBillOrderByWithRelationInput[] =
    f.sort === "total" ? [{ totalMinor: f.dir }, { id: "desc" }] : f.sort === "number" ? [{ number: f.dir }, { id: "desc" }] : f.sort === "issueDate" ? [{ issueDate: f.dir }, { id: "desc" }] : [{ dueDate: f.dir }, { id: "desc" }];
  const [total, rows] = await Promise.all([
    db().financeBill.count({ where }),
    db().financeBill.findMany({ where, orderBy, skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { vendor: { select: { id: true, name: true } }, attachment: { select: { id: true } } } }),
  ]);
  return { total, rows: rows.map((b) => ({ ...b, balanceMinor: billBalance(b) })), pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

const billDetail = {
  vendor: { select: { id: true, name: true, email: true } },
  lines: {
    orderBy: { position: "asc" },
    include: { category: { select: { id: true, name: true } }, department: { select: { id: true, name: true } }, project: { select: { id: true, name: true } }, taxRate: { select: { id: true, name: true } } },
  },
  payments: { orderBy: { date: "asc" }, include: { financeAccount: { select: { id: true, name: true } } } },
  attachment: { select: { id: true, fileName: true, sizeBytes: true, contentType: true } },
  approvals: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.FinanceBillInclude;

export async function getBill(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const b = isUuid(id) ? await db().financeBill.findFirst({ where: { id, organizationId, companyId }, include: billDetail }) : null;
  if (!b) throw notFound("Bill");
  const paymentTxns = b.payments.length ? await db().financeTransaction.findMany({ where: { companyId, billPaymentId: { in: b.payments.map((p) => p.id) } }, select: { id: true, billPaymentId: true } }) : [];
  const txnBy = new Map(paymentTxns.map((t) => [t.billPaymentId, t.id]));
  return { ...b, balanceMinor: billBalance(b), payments: b.payments.map((p) => ({ ...p, transactionId: txnBy.get(p.id) ?? null })) };
}

async function resolveVendor(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, vendorId: string | null | undefined, newVendor?: { name: string; email?: string | null } | null) {
  if (vendorId) {
    const a = await tx.account.findFirst({ where: { id: vendorId, organizationId, companyId }, select: { id: true, name: true } });
    if (!a) throw notFound("Vendor");
    return a;
  }
  if (newVendor?.name) {
    const a = await createCounterparty(ctx, organizationId, companyId, { name: newVendor.name, email: newVendor.email ?? null, type: "VENDOR" }, { tx });
    return { id: a.id, name: a.name };
  }
  throw invalid("Choose a vendor", { reason: "finance_vendor_required" });
}

/** Validate line references and compute totals (tax per line, no discounts on bills). */
async function computeBillLines(tx: Tx, organizationId: string, companyId: string, currency: string, lines: z.output<typeof billLineInput>[]) {
  const ids = (k: "categoryId" | "departmentId" | "projectId") => [...new Set(lines.map((l) => l[k]).filter((x): x is string => !!x))];
  const [cats, deps, projects] = await Promise.all([
    ids("categoryId").length ? tx.financeCategory.count({ where: { id: { in: ids("categoryId") }, organizationId, companyId, kind: "EXPENSE" } }) : 0,
    ids("departmentId").length ? tx.department.count({ where: { id: { in: ids("departmentId") }, organizationId, companyId } }) : 0,
    ids("projectId").length ? tx.project.count({ where: { id: { in: ids("projectId") }, organizationId, companyId } }) : 0,
  ]);
  if (cats !== ids("categoryId").length) throw notFound("Category");
  if (deps !== ids("departmentId").length) throw notFound("Cost center");
  if (projects !== ids("projectId").length) throw notFound("Project");
  const computed = await computeLines(tx, organizationId, companyId, currency, lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discount: 0, taxRateId: l.taxRateId ?? null })), 0);
  const rows = computed.lines.map((c, i) => ({
    organizationId,
    companyId,
    position: i,
    description: c.description,
    quantityMilli: c.quantityMilli,
    unitPriceMinor: c.unitPriceMinor,
    categoryId: lines[i]!.categoryId ?? null,
    departmentId: lines[i]!.departmentId ?? null,
    projectId: lines[i]!.projectId ?? null,
    taxRateId: c.taxRateId,
    taxBps: c.taxBps,
    taxInclusive: c.taxInclusive,
    netMinor: c.netMinor,
    taxMinor: c.taxMinor,
    totalMinor: c.totalMinor,
  }));
  return { rows, subtotalMinor: computed.netMinor, taxMinor: computed.taxMinor, totalMinor: computed.totalMinor };
}

async function assertUniqueNumber(tx: Tx, companyId: string, vendorId: string, number: string, exceptId?: string) {
  const dup = await tx.financeBill.findFirst({ where: { companyId, vendorId, number: { equals: number, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  if (dup) throw conflict("This vendor already has a bill with that number", { reason: "finance_bill_duplicate" });
}

export async function createBill(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof billInput>) {
  const input = billInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const company = await companyInfo(tx, organizationId, companyId);
    await ensureFinanceSetup(tx, organizationId, companyId);
    const vendor = await resolveVendor(tx, ctx, organizationId, companyId, input.vendorId, input.newVendor);
    await assertUniqueNumber(tx, companyId, vendor.id, input.number);
    const issueDate = toDay(input.issueDate);
    const dueDate = input.dueDate ? toDay(input.dueDate) : addDays(issueDate, (await financeSettings(tx, organizationId, companyId)).defaultDueDays);
    if (dueDate < issueDate) throw invalid("The due date must be on or after the bill date", { reason: "finance_bad_range" });
    const c = await computeBillLines(tx, organizationId, companyId, company.baseCurrency, input.lines);
    const bill = await tx.financeBill.create({
      data: {
        organizationId,
        companyId,
        vendorId: vendor.id,
        number: input.number,
        issueDate,
        dueDate,
        currency: company.baseCurrency,
        subtotalMinor: c.subtotalMinor,
        taxMinor: c.taxMinor,
        totalMinor: c.totalMinor,
        notes: input.notes ?? null,
        createdById: actorId(ctx, organizationId),
      },
    });
    await tx.financeBillLine.createMany({ data: c.rows.map((r) => ({ ...r, billId: bill.id })) });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.bill.created", resourceType: "finance_bill", resourceId: bill.id, newValue: { number: bill.number, vendorId: vendor.id, totalMinor: bill.totalMinor } });
    if (input.submit) await submitBillTx(tx, ctx, organizationId, companyId, bill.id);
    return tx.financeBill.findUniqueOrThrow({ where: { id: bill.id } });
  });
}

async function draftBill(tx: Tx, organizationId: string, companyId: string, id: string) {
  const b = isUuid(id) ? await tx.financeBill.findFirst({ where: { id, organizationId, companyId } }) : null;
  if (!b) throw notFound("Bill");
  if (b.status !== "DRAFT") throw conflict("Only draft bills can be changed", { reason: "finance_bill_not_draft" });
  return b;
}

export async function updateBill(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateBillInput>) {
  const input = updateBillInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = await draftBill(tx, organizationId, companyId, id);
    const vendor = input.vendorId || input.newVendor ? await resolveVendor(tx, ctx, organizationId, companyId, input.vendorId, input.newVendor) : { id: before.vendorId };
    const number = input.number ?? before.number;
    await assertUniqueNumber(tx, companyId, vendor.id, number, id);
    const issueDate = input.issueDate ? toDay(input.issueDate) : before.issueDate;
    const dueDate = input.dueDate ? toDay(input.dueDate) : before.dueDate;
    if (dueDate < issueDate) throw invalid("The due date must be on or after the bill date", { reason: "finance_bad_range" });
    let totals = {};
    if (input.lines) {
      const c = await computeBillLines(tx, organizationId, companyId, before.currency, input.lines);
      await tx.financeBillLine.deleteMany({ where: { billId: id } });
      await tx.financeBillLine.createMany({ data: c.rows.map((r) => ({ ...r, billId: id })) });
      totals = { subtotalMinor: c.subtotalMinor, taxMinor: c.taxMinor, totalMinor: c.totalMinor };
    }
    const b = await tx.financeBill.update({ where: { id }, data: { vendorId: vendor.id, number, issueDate, dueDate, notes: input.notes === undefined ? undefined : input.notes, ...totals } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.bill.updated", resourceType: "finance_bill", resourceId: id, oldValue: { number: before.number, totalMinor: before.totalMinor }, newValue: { number: b.number, totalMinor: b.totalMinor } });
    return b;
  });
}

export async function deleteBill(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = await draftBill(tx, organizationId, companyId, id);
    await tx.financeBill.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.bill.deleted", resourceType: "finance_bill", resourceId: id, oldValue: { number: before.number, vendorId: before.vendorId, totalMinor: before.totalMinor } });
    return { ok: true };
  });
}

/** Approval posting: Dr expense (per line category, cost center) + Dr input tax / Cr accounts payable. */
export async function approveBillTx(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, id: string, approverId: string | null) {
  const b = await tx.financeBill.findFirst({ where: { id, organizationId, companyId }, include: { vendor: { select: { name: true } }, lines: { include: { category: { select: { ledgerAccountId: true } }, taxRate: { select: { ledgerAccountId: true } } } } } });
  if (!b) throw notFound("Bill");
  if (b.status !== "DRAFT" && b.status !== "AWAITING_APPROVAL") throw conflict("The bill is already approved or void", { reason: "finance_bill_not_pending" });
  const expense = await systemAccount(tx, organizationId, companyId, "expense");
  const tax = await systemAccount(tx, organizationId, companyId, "tax");
  const lines = [
    ...b.lines.map((l) => ({ ledgerAccountId: l.category?.ledgerAccountId ?? expense, debitMinor: l.netMinor, departmentId: l.departmentId, description: l.description.slice(0, 200) })),
    ...b.lines.filter((l) => l.taxMinor > 0n).map((l) => ({ ledgerAccountId: l.taxRate?.ledgerAccountId ?? tax, debitMinor: l.taxMinor, description: "Input tax" })),
    { ledgerAccountId: await systemAccount(tx, organizationId, companyId, "ap"), creditMinor: b.totalMinor },
  ];
  await postEntry(tx, ctx, { organizationId, companyId, date: b.issueDate, memo: `Bill ${b.number} — ${b.vendor.name}`, source: "BILL", sourceId: b.id, lines });
  const updated = await tx.financeBill.update({ where: { id }, data: { status: b.paidMinor >= b.totalMinor && b.totalMinor > 0n ? "PAID" : "APPROVED", approvedAt: new Date(), approvedById: approverId, submittedAt: b.submittedAt ?? new Date() } });
  await emitDomainEvent(tx, ctx, "expense.created", {
    organizationId,
    companyId,
    entityType: "finance_bill",
    entityId: b.id,
    data: { amountMinor: b.subtotalMinor, totalMinor: b.totalMinor, currency: b.currency, description: `Bill ${b.number}`, vendorId: b.vendorId, vendorName: b.vendor.name, date: b.issueDate, dueDate: b.dueDate },
  });
  await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.bill.approved", resourceType: "finance_bill", resourceId: id, newValue: { totalMinor: b.totalMinor, approverId } });
  return updated;
}

/** Rejected approval: the bill goes back to draft for correction. */
export async function returnBillToDraftTx(tx: Tx, ctx: RequestContext, organizationId: string, id: string, note: string | null) {
  await tx.financeBill.update({ where: { id }, data: { status: "DRAFT", submittedAt: null } });
  await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.bill.rejected", resourceType: "finance_bill", resourceId: id, newValue: { note } });
}

async function submitBillTx(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  const b = await tx.financeBill.findFirst({ where: { id, organizationId, companyId }, include: { vendor: { select: { name: true } }, lines: { select: { departmentId: true, categoryId: true } } } });
  if (!b) throw notFound("Bill");
  if (b.status !== "DRAFT") throw conflict("Only draft bills can be submitted", { reason: "finance_bill_not_draft" });
  if (b.totalMinor <= 0n) throw invalid("The bill total must be greater than zero", { reason: "finance_bill_empty" });
  const req = await openApprovalRequestTx(tx, ctx, organizationId, companyId, {
    kind: "BILL",
    billId: b.id,
    title: `${b.vendor.name} · ${b.number}`,
    amountMinor: b.totalMinor,
    currency: b.currency,
    departmentIds: b.lines.map((l) => l.departmentId),
    categoryIds: b.lines.map((l) => l.categoryId),
    requestedById: actorId(ctx, organizationId),
  });
  if (req) {
    await tx.financeBill.update({ where: { id }, data: { status: "AWAITING_APPROVAL", submittedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.bill.submitted", resourceType: "finance_bill", resourceId: id, newValue: { approvalRequestId: req.id } });
    return { status: "AWAITING_APPROVAL" as const, approvalRequestId: req.id };
  }
  await approveBillTx(tx, ctx, organizationId, companyId, id, ctx.actor.id ?? null);
  return { status: "APPROVED" as const, approvalRequestId: null };
}

/** Submit a draft: opens an approval request when a rule applies, otherwise approves (posts) it right away. */
export async function submitBill(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    return submitBillTx(tx, ctx, organizationId, companyId, id);
  });
}

export async function voidBill(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const b = isUuid(id) ? await tx.financeBill.findFirst({ where: { id, organizationId, companyId }, include: { _count: { select: { payments: true } } } }) : null;
    if (!b) throw notFound("Bill");
    if (b.status === "VOID") return b;
    if (b._count.payments) throw conflict("Remove the bill's payments before voiding it", { reason: "finance_bill_has_payments" });
    if (b.status === "APPROVED") await removeSourcePostings(tx, ctx, organizationId, companyId, "BILL", id, `Bill voided: ${b.number}`);
    await cancelPendingRequestsTx(tx, { billId: id });
    const v = await tx.financeBill.update({ where: { id }, data: { status: "VOID", voidedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.bill.voided", resourceType: "finance_bill", resourceId: id, oldValue: { status: b.status } });
    return v;
  });
}

// ───────────── Payments ─────────────

export const billPaymentInput = paymentInput;

export async function recordBillPayment(ctx: RequestContext, organizationId: string, companyId: string, billId: string, raw: z.input<typeof billPaymentInput>) {
  const input = billPaymentInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const b = isUuid(billId) ? await tx.financeBill.findFirst({ where: { id: billId, organizationId, companyId }, include: { vendor: { select: { name: true } } } }) : null;
    if (!b) throw notFound("Bill");
    if (!OPEN_BILL_STATUSES.includes(b.status)) throw conflict("Payments can be recorded on approved, unpaid bills", { reason: "finance_bill_not_open" });
    const acct = await tx.financeAccount.findFirst({ where: { id: input.financeAccountId, organizationId, companyId, archivedAt: null }, select: { id: true, ledgerAccountId: true } });
    if (!acct) throw notFound("Account");
    const amountMinor = toMinor(input.amount, b.currency);
    if (amountMinor > billBalance(b)) throw invalid("The payment is larger than the balance due", { reason: "finance_overpayment" });
    const date = toDay(input.date);
    const payment = await tx.financeBillPayment.create({
      data: { organizationId, companyId, billId, date, amountMinor, method: input.method, reference: input.reference ?? null, financeAccountId: acct.id, createdById: actorId(ctx, organizationId) },
    });
    const entry = await postEntry(tx, ctx, {
      organizationId,
      companyId,
      date,
      memo: `Payment of bill ${b.number} — ${b.vendor.name}`,
      source: "BILL_PAYMENT",
      sourceId: payment.id,
      lines: [
        { ledgerAccountId: await systemAccount(tx, organizationId, companyId, "ap"), debitMinor: amountMinor },
        { ledgerAccountId: acct.ledgerAccountId, creditMinor: amountMinor },
      ],
    });
    await tx.financeBillPayment.update({ where: { id: payment.id }, data: { journalEntryId: entry?.id ?? null } });
    // Mirror in the bank register so balances, cash flow and reconciliation see the money leave.
    await tx.financeTransaction.create({
      data: {
        organizationId,
        companyId,
        type: "EXPENSE",
        date,
        amountMinor,
        currency: b.currency,
        financeAccountId: acct.id,
        accountId: b.vendorId,
        description: `Bill ${b.number} — ${b.vendor.name}`.slice(0, 300),
        reference: input.reference ?? null,
        source: "BILL_PAYMENT",
        billPaymentId: payment.id,
        journalEntryId: entry?.id ?? null,
        createdById: actorId(ctx, organizationId),
      },
    });
    const paidMinor = b.paidMinor + amountMinor;
    const status: FinanceBillStatus = paidMinor >= b.totalMinor ? "PAID" : "PARTIALLY_PAID";
    await tx.financeBill.update({ where: { id: billId }, data: { paidMinor, status, paidAt: status === "PAID" ? new Date() : null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.bill_payment.recorded", resourceType: "finance_bill", resourceId: billId, newValue: { paymentId: payment.id, amountMinor, status } });
    return payment;
  });
}

export async function deleteBillPayment(ctx: RequestContext, organizationId: string, companyId: string, paymentId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const p = isUuid(paymentId) ? await tx.financeBillPayment.findFirst({ where: { id: paymentId, organizationId, companyId }, include: { bill: true } }) : null;
    if (!p) throw notFound("Payment");
    const txn = await tx.financeTransaction.findFirst({ where: { billPaymentId: paymentId }, select: { id: true, reconciledAt: true } });
    if (txn?.reconciledAt) throw conflict("The payment is reconciled and can't be removed", { reason: "finance_txn_reconciled" });
    await removeSourcePostings(tx, ctx, organizationId, companyId, "BILL_PAYMENT", paymentId, `Bill payment removed: ${p.bill.number}`);
    if (txn) await tx.financeTransaction.delete({ where: { id: txn.id } });
    await tx.financeBillPayment.delete({ where: { id: paymentId } });
    const paidMinor = p.bill.paidMinor - p.amountMinor;
    await tx.financeBill.update({ where: { id: p.billId }, data: { paidMinor, status: paidMinor > 0n ? "PARTIALLY_PAID" : "APPROVED", paidAt: null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.bill_payment.deleted", resourceType: "finance_bill", resourceId: p.billId, oldValue: { paymentId, amountMinor: p.amountMinor } });
    return { ok: true };
  });
}

// ───────────── Attachments ─────────────

export async function putBillAttachment(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof attachmentInput>) {
  const file = decodeAttachment(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const b = isUuid(id) ? await tx.financeBill.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }) : null;
    if (!b) throw notFound("Bill");
    const a = await upsertDocAttachment(tx, organizationId, companyId, { billId: id }, file);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.attachment.uploaded", resourceType: "finance_bill", resourceId: id, newValue: { fileName: file.fileName, sizeBytes: file.data.length } });
    return a;
  });
}

export async function getBillAttachment(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  if (!isUuid(id)) throw notFound("Attachment");
  return findDocAttachment(db(), organizationId, companyId, { billId: id });
}

export async function deleteBillAttachment(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const { count } = isUuid(id) ? await tx.financeDocAttachment.deleteMany({ where: { billId: id, organizationId, companyId } }) : { count: 0 };
    if (!count) throw notFound("Attachment");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.attachment.deleted", resourceType: "finance_bill", resourceId: id });
    return { ok: true };
  });
}

// ───────────── Aging, upcoming, overdue ─────────────

/** Accounts payable aging: open bills by days past due (not yet due, 1–30, 31–60, 61–90, 90+) and by vendor. */
export async function payablesAging(ctx: RequestContext, organizationId: string, companyId: string, today = todayUtc()) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const open = await db().financeBill.findMany({ where: { organizationId, companyId, status: { in: OPEN_BILL_STATUSES } }, orderBy: { dueDate: "asc" }, include: { vendor: { select: { id: true, name: true } } }, take: 5000 });
  const zero = () => Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0n])) as Record<AgingBucket, bigint>;
  const totals = zero();
  const byVendor = new Map<string, { id: string; name: string; buckets: Record<AgingBucket, bigint>; total: bigint }>();
  const bills = open.map((b) => {
    const bucket = agingBucket(b.dueDate, today);
    const bal = billBalance(b);
    totals[bucket] += bal;
    const v = byVendor.get(b.vendorId) ?? { id: b.vendorId, name: b.vendor.name, buckets: zero(), total: 0n };
    v.buckets[bucket] += bal;
    v.total += bal;
    byVendor.set(b.vendorId, v);
    return { ...b, balanceMinor: bal, bucket, daysOverdue: Math.max(0, Math.floor((today.getTime() - b.dueDate.getTime()) / 86_400_000)) };
  });
  const total = Object.values(totals).reduce((s, v) => s + v, 0n);
  return { totals, total, overdue: total - totals.current, vendors: [...byVendor.values()].sort((a, b) => (b.total > a.total ? 1 : -1)), bills };
}

/** Open bills due in the next `days` days (and overdue ones), soonest first. No authorization: callers authorize. */
export async function upcomingPayables(client: Tx | Db, companyId: string, days = 30, today = todayUtc()) {
  const rows = await client.financeBill.findMany({ where: { companyId, status: { in: OPEN_BILL_STATUSES }, dueDate: { lt: addDays(today, days + 1) } }, orderBy: { dueDate: "asc" }, take: 50, include: { vendor: { select: { id: true, name: true } } } });
  return rows.map((b) => ({ ...b, balanceMinor: billBalance(b), overdue: b.dueDate < today }));
}

/** Worker: notify finance managers once about every approved bill that became overdue. */
export async function notifyOverdueBills(now = new Date()): Promise<number> {
  const today = todayUtc(now);
  const due = await db().financeBill.findMany({ where: { status: { in: OPEN_BILL_STATUSES }, dueDate: { lt: today }, overdueNotifiedAt: null }, take: 500, select: { id: true } });
  let notified = 0;
  for (const { id } of due) {
    try {
      await transaction(async (tx) => {
        const { count } = await tx.financeBill.updateMany({ where: { id, overdueNotifiedAt: null, status: { in: OPEN_BILL_STATUSES } }, data: { overdueNotifiedAt: new Date() } });
        if (!count) return;
        const b = await tx.financeBill.findUniqueOrThrow({ where: { id }, include: { vendor: { select: { name: true } } } });
        const recipients = await usersWithPermission(tx, b.organizationId, b.companyId, "finance.manage");
        await notifyUsers(tx, b.organizationId, recipients, "finance.bill_overdue", { companyId: b.companyId, title: `${b.vendor.name} · ${b.number}`, href: `/finance/bills/${id}` });
        await writeAudit(tx, systemContext(), { category: "TENANT", organizationId: b.organizationId, action: "finance.bill.overdue", resourceType: "finance_bill", resourceId: id });
        notified++;
      });
    } catch (err) {
      logger.warn({ err, billId: id }, "overdue bill notification failed");
    }
  }
  return notified;
}

