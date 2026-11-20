import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { FinanceTxnSource, FinanceTxnType } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import {
  actorId,
  advance,
  amount,
  authorize,
  companyInfo,
  day,
  fromMinor,
  isUuid,
  optionalText,
  optionalUuid,
  PAGE_SIZE,
  pageParam,
  param,
  parseCsv,
  positiveAmount,
  todayUtc,
  toCsv,
  toDay,
  dayString,
  toMinor,
  uuid,
} from "./common";
import { ensureFinanceSetup, postEntry, removeSourcePostings, systemAccount } from "./ledger";
import { accountBalances, createCounterparty } from "./setup";

export const TXN_TYPES = ["INCOME", "EXPENSE", "TRANSFER"] as const;
export const FREQUENCIES = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ATTACHMENT_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "image/heic", "text/plain", "text/csv"]);

export const transactionInput = z.object({
  type: z.enum(TXN_TYPES),
  date: day,
  amount: positiveAmount,
  financeAccountId: uuid,
  toAccountId: optionalUuid,
  categoryId: optionalUuid,
  accountId: optionalUuid,
  departmentId: optionalUuid,
  description: z.string().trim().min(1).max(300),
  reference: optionalText(120),
  notes: optionalText(5000),
});
export const updateTransactionInput = transactionInput.partial();

type TxnData = z.output<typeof transactionInput>;

export interface TxnFilters {
  q?: string;
  type?: FinanceTxnType;
  financeAccountId?: string;
  categoryId?: string;
  accountId?: string;
  departmentId?: string;
  from?: string;
  to?: string;
  sort: "date" | "amount" | "description";
  dir: "asc" | "desc";
  page: number;
}

export function parseTxnFilters(raw: Record<string, string | string[] | undefined>): TxnFilters {
  const id = (k: string) => {
    const v = param(raw, k);
    return isUuid(v) ? v : undefined;
  };
  const d = (k: string) => {
    const v = param(raw, k);
    return v && day.safeParse(v).success ? v : undefined;
  };
  const type = param(raw, "type");
  const sort = param(raw, "sort");
  return {
    q: param(raw, "q")?.slice(0, 200),
    type: (TXN_TYPES as readonly string[]).includes(type ?? "") ? (type as FinanceTxnType) : undefined,
    financeAccountId: id("account"),
    categoryId: id("category"),
    accountId: id("counterparty"),
    departmentId: id("costCenter"),
    from: d("from"),
    to: d("to"),
    sort: sort === "amount" || sort === "description" ? sort : "date",
    dir: param(raw, "dir") === "asc" ? "asc" : "desc",
    page: pageParam(raw),
  };
}

function txnWhere(organizationId: string, companyId: string, f: Partial<TxnFilters>): Prisma.FinanceTransactionWhereInput {
  const where: Prisma.FinanceTransactionWhereInput = { organizationId, companyId };
  if (f.type) where.type = f.type;
  if (f.financeAccountId) where.OR = [{ financeAccountId: f.financeAccountId }, { toAccountId: f.financeAccountId }];
  if (f.categoryId) where.categoryId = f.categoryId;
  if (f.accountId) where.accountId = f.accountId;
  if (f.departmentId) where.departmentId = f.departmentId;
  if (f.from || f.to) where.date = { ...(f.from ? { gte: toDay(f.from) } : {}), ...(f.to ? { lte: toDay(f.to) } : {}) };
  if (f.q) {
    const contains = { contains: f.q, mode: "insensitive" as const };
    where.AND = [{ OR: [{ description: contains }, { reference: contains }, { notes: contains }, { account: { name: contains } }, { category: { name: contains } }] }];
  }
  return where;
}

const listInclude = {
  financeAccount: { select: { id: true, name: true } },
  toAccount: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  account: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  attachment: { select: { id: true, fileName: true, sizeBytes: true } },
} satisfies Prisma.FinanceTransactionInclude;

export async function listTransactions(ctx: RequestContext, organizationId: string, companyId: string, f: TxnFilters) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const where = txnWhere(organizationId, companyId, f);
  const orderBy: Prisma.FinanceTransactionOrderByWithRelationInput[] =
    f.sort === "amount" ? [{ amountMinor: f.dir }, { id: "desc" }] : f.sort === "description" ? [{ description: f.dir }, { id: "desc" }] : [{ date: f.dir }, { id: f.dir }];
  const [total, rows, sums] = await Promise.all([
    db().financeTransaction.count({ where }),
    db().financeTransaction.findMany({ where, orderBy, skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: listInclude }),
    db().financeTransaction.groupBy({ by: ["type"], where, _sum: { amountMinor: true } }),
  ]);
  const totals = Object.fromEntries(TXN_TYPES.map((t) => [t, sums.find((s) => s.type === t)?._sum.amountMinor ?? 0n])) as Record<FinanceTxnType, bigint>;
  return { total, rows, totals, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getTransaction(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const t = isUuid(id) ? await db().financeTransaction.findFirst({ where: { id, organizationId, companyId }, include: { ...listInclude, recurring: { select: { id: true, name: true } } } }) : null;
  if (!t) throw notFound("Transaction");
  const payment = t.paymentId ? await db().invoicePayment.findFirst({ where: { id: t.paymentId, companyId }, select: { invoiceId: true } }) : null;
  return { ...t, invoiceId: payment?.invoiceId ?? null };
}

/** Validate references (all inside the company) and the type-specific rules. */
async function checkRefs(tx: Tx, organizationId: string, companyId: string, d: TxnData) {
  const acct = await tx.financeAccount.findFirst({ where: { id: d.financeAccountId, organizationId, companyId }, select: { id: true, ledgerAccountId: true, archivedAt: true, name: true } });
  if (!acct) throw notFound("Account");
  let to: { id: string; ledgerAccountId: string } | null = null;
  if (d.type === "TRANSFER") {
    if (!d.toAccountId || d.toAccountId === d.financeAccountId) throw invalid("Pick a different destination account", { reason: "finance_transfer_target" });
    to = await tx.financeAccount.findFirst({ where: { id: d.toAccountId, organizationId, companyId }, select: { id: true, ledgerAccountId: true } });
    if (!to) throw notFound("Account");
  }
  let category: { id: string; ledgerAccountId: string | null; kind: string } | null = null;
  if (d.categoryId && d.type !== "TRANSFER") {
    category = await tx.financeCategory.findFirst({ where: { id: d.categoryId, organizationId, companyId }, select: { id: true, ledgerAccountId: true, kind: true } });
    if (!category) throw notFound("Category");
    if (category.kind !== d.type) throw invalid("The category doesn't match the transaction type", { reason: "finance_category_kind" });
  }
  if (d.accountId && !(await tx.account.findFirst({ where: { id: d.accountId, organizationId, companyId }, select: { id: true } }))) throw notFound("Vendor or customer");
  if (d.departmentId && !(await tx.department.findFirst({ where: { id: d.departmentId, organizationId, companyId }, select: { id: true } }))) throw notFound("Cost center");
  return { acct, to, category };
}

async function postTransaction(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, t: { id: string; type: FinanceTxnType; date: Date; amountMinor: bigint; description: string; departmentId: string | null }, refs: Awaited<ReturnType<typeof checkRefs>>) {
  const bank = refs.acct.ledgerAccountId;
  const lines =
    t.type === "INCOME"
      ? [
          { ledgerAccountId: bank, debitMinor: t.amountMinor },
          { ledgerAccountId: refs.category?.ledgerAccountId ?? (await systemAccount(tx, organizationId, companyId, "other_income")), creditMinor: t.amountMinor, departmentId: t.departmentId },
        ]
      : t.type === "EXPENSE"
        ? [
            { ledgerAccountId: refs.category?.ledgerAccountId ?? (await systemAccount(tx, organizationId, companyId, "expense")), debitMinor: t.amountMinor, departmentId: t.departmentId },
            { ledgerAccountId: bank, creditMinor: t.amountMinor },
          ]
        : [
            { ledgerAccountId: refs.to!.ledgerAccountId, debitMinor: t.amountMinor },
            { ledgerAccountId: bank, creditMinor: t.amountMinor },
          ];
  const entry = await postEntry(tx, ctx, { organizationId, companyId, date: t.date, memo: t.description, source: "TRANSACTION", sourceId: t.id, lines });
  return entry?.id ?? null;
}

/** Create a transaction inside an open transaction (used by the API, CSV import, recurring job and AI tool). */
export async function createTransactionTx(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, d: TxnData, opts: { source?: FinanceTxnSource; recurringId?: string | null; currency: string }) {
  await ensureFinanceSetup(tx, organizationId, companyId);
  const refs = await checkRefs(tx, organizationId, companyId, d);
  if (refs.acct.archivedAt) throw conflict("The account is archived", { reason: "finance_account_archived" });
  const t = await tx.financeTransaction.create({
    data: {
      organizationId,
      companyId,
      type: d.type,
      date: toDay(d.date),
      amountMinor: toMinor(d.amount, opts.currency),
      currency: opts.currency,
      financeAccountId: d.financeAccountId,
      toAccountId: d.type === "TRANSFER" ? (d.toAccountId ?? null) : null,
      categoryId: d.type === "TRANSFER" ? null : (d.categoryId ?? null),
      accountId: d.accountId ?? null,
      departmentId: d.departmentId ?? null,
      description: d.description,
      reference: d.reference ?? null,
      notes: d.notes ?? null,
      source: opts.source ?? "MANUAL",
      recurringId: opts.recurringId ?? null,
      createdById: actorId(ctx, organizationId),
    },
  });
  const journalEntryId = await postTransaction(tx, ctx, organizationId, companyId, t, refs);
  if (journalEntryId) await tx.financeTransaction.update({ where: { id: t.id }, data: { journalEntryId } });
  await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.transaction.created", resourceType: "finance_transaction", resourceId: t.id, newValue: { type: t.type, amountMinor: t.amountMinor, date: d.date, source: t.source } });
  if (t.type === "EXPENSE") {
    await emitDomainEvent(tx, ctx, "expense.created", {
      organizationId,
      companyId,
      entityType: "finance_transaction",
      entityId: t.id,
      data: { amountMinor: t.amountMinor, currency: t.currency, description: t.description, categoryId: t.categoryId, vendorId: t.accountId, departmentId: t.departmentId, date: t.date },
    });
  }
  return t;
}

export async function createTransaction(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof transactionInput>, opts: { source?: FinanceTxnSource } = {}) {
  const input = transactionInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const company = await companyInfo(tx, organizationId, companyId);
    return createTransactionTx(tx, ctx, organizationId, companyId, input, { currency: company.baseCurrency, source: opts.source });
  });
}

export async function updateTransaction(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateTransactionInput>) {
  const input = updateTransactionInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.financeTransaction.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!before) throw notFound("Transaction");
    if (before.paymentId) throw conflict("This transaction belongs to an invoice payment; change the payment instead", { reason: "finance_txn_from_payment" });
    const merged: TxnData = {
      type: input.type ?? before.type,
      date: input.date ?? dayString(before.date),
      amount: input.amount ?? fromMinor(before.amountMinor, before.currency),
      financeAccountId: input.financeAccountId ?? before.financeAccountId,
      toAccountId: input.toAccountId !== undefined ? input.toAccountId : before.toAccountId,
      categoryId: input.categoryId !== undefined ? input.categoryId : before.categoryId,
      accountId: input.accountId !== undefined ? input.accountId : before.accountId,
      departmentId: input.departmentId !== undefined ? input.departmentId : before.departmentId,
      description: input.description ?? before.description,
      reference: input.reference !== undefined ? input.reference : before.reference,
      notes: input.notes !== undefined ? input.notes : before.notes,
    };
    const amountMinor = toMinor(merged.amount, before.currency);
    const date = toDay(merged.date);
    const moneyChanged = amountMinor !== before.amountMinor || date.getTime() !== before.date.getTime() || merged.type !== before.type || merged.financeAccountId !== before.financeAccountId || merged.toAccountId !== before.toAccountId;
    if (moneyChanged && before.reconciledAt) throw conflict("Reconciled transactions can't change amount, date or account", { reason: "finance_txn_reconciled" });
    const refs = await checkRefs(tx, organizationId, companyId, merged);
    const t = await tx.financeTransaction.update({
      where: { id },
      data: {
        type: merged.type,
        date,
        amountMinor,
        financeAccountId: merged.financeAccountId,
        toAccountId: merged.type === "TRANSFER" ? (merged.toAccountId ?? null) : null,
        categoryId: merged.type === "TRANSFER" ? null : (merged.categoryId ?? null),
        accountId: merged.accountId ?? null,
        departmentId: merged.departmentId ?? null,
        description: merged.description,
        reference: merged.reference ?? null,
        notes: merged.notes ?? null,
      },
    });
    const postingChanged = moneyChanged || merged.categoryId !== before.categoryId || merged.departmentId !== before.departmentId;
    if (postingChanged) {
      await removeSourcePostings(tx, ctx, organizationId, companyId, "TRANSACTION", id, `Transaction changed: ${before.description}`);
      const journalEntryId = await postTransaction(tx, ctx, organizationId, companyId, t, refs);
      await tx.financeTransaction.update({ where: { id }, data: { journalEntryId } });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.transaction.updated", resourceType: "finance_transaction", resourceId: id, oldValue: { amountMinor: before.amountMinor, date: before.date, type: before.type }, newValue: { amountMinor, date, type: t.type } });
    return t;
  });
}

export async function deleteTransaction(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.financeTransaction.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!before) throw notFound("Transaction");
    if (before.paymentId) throw conflict("This transaction belongs to an invoice payment; delete the payment instead", { reason: "finance_txn_from_payment" });
    if (before.reconciledAt) throw conflict("Reconciled transactions can't be deleted", { reason: "finance_txn_reconciled" });
    await removeSourcePostings(tx, ctx, organizationId, companyId, "TRANSACTION", id, `Transaction deleted: ${before.description}`);
    await tx.financeTransaction.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.transaction.deleted", resourceType: "finance_transaction", resourceId: id, oldValue: { type: before.type, amountMinor: before.amountMinor, date: before.date, description: before.description } });
    return { ok: true };
  });
}

// ───────────── Attachments ─────────────

export const attachmentInput = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().trim().max(100),
  dataBase64: z.string().min(1).max(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8),
});

export async function putAttachment(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof attachmentInput>) {
  const input = attachmentInput.parse(raw);
  if (!ATTACHMENT_TYPES.has(input.contentType)) throw invalid("Unsupported file type", { reason: "finance_attachment_type" });
  const data = Buffer.from(input.dataBase64, "base64");
  if (!data.length) throw invalid("Empty file", { reason: "finance_attachment_empty" });
  if (data.length > MAX_ATTACHMENT_BYTES) throw new AppError("payload_too_large", "Attachments are limited to 5 MB", { reason: "finance_attachment_too_large" });
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const t = isUuid(id) ? await tx.financeTransaction.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }) : null;
    if (!t) throw notFound("Transaction");
    const fileName = input.fileName.replace(/[\\/\r\n"]/g, "_");
    const a = await tx.financeTxnAttachment.upsert({
      where: { transactionId: id },
      create: { organizationId, companyId, transactionId: id, fileName, contentType: input.contentType, sizeBytes: data.length, data },
      update: { fileName, contentType: input.contentType, sizeBytes: data.length, data, createdAt: new Date() },
      select: { id: true, fileName: true, sizeBytes: true },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.attachment.uploaded", resourceType: "finance_transaction", resourceId: id, newValue: { fileName, sizeBytes: data.length } });
    return a;
  });
}

export async function getAttachment(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const a = isUuid(id) ? await db().financeTxnAttachment.findFirst({ where: { transactionId: id, organizationId, companyId } }) : null;
  if (!a) throw notFound("Attachment");
  return a;
}

export async function deleteAttachment(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const { count } = isUuid(id) ? await tx.financeTxnAttachment.deleteMany({ where: { transactionId: id, organizationId, companyId } }) : { count: 0 };
    if (!count) throw notFound("Attachment");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.attachment.deleted", resourceType: "finance_transaction", resourceId: id });
    return { ok: true };
  });
}

// ───────────── CSV import / export ─────────────

export const CSV_COLUMNS = ["date", "type", "amount", "account", "category", "counterparty", "cost_center", "reference", "description", "notes"] as const;

export async function exportTransactionsCsv(ctx: RequestContext, organizationId: string, companyId: string, f: TxnFilters) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const rows = await db().financeTransaction.findMany({ where: txnWhere(organizationId, companyId, f), orderBy: [{ date: "asc" }, { id: "asc" }], take: 50_000, include: listInclude });
  return toCsv([
    [...CSV_COLUMNS, "to_account", "currency", "id"],
    ...rows.map((t) => [
      dayString(t.date),
      t.type,
      fromMinor(t.amountMinor, t.currency),
      t.financeAccount.name,
      t.category?.name ?? "",
      t.account?.name ?? "",
      t.department?.name ?? "",
      t.reference ?? "",
      t.description,
      t.notes ?? "",
      t.toAccount?.name ?? "",
      t.currency,
      t.id,
    ]),
  ]);
}

export const importInput = z.object({ csv: z.string().min(1).max(2_000_000), defaultAccountId: optionalUuid });

/**
 * Import transactions from CSV (header row with the CSV_COLUMNS names; type optional — a negative amount is an expense).
 * All rows are validated first; nothing is imported if any row has an error. Unknown categories and counterparties are created.
 */
export async function importTransactionsCsv(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof importInput>) {
  const input = importInput.parse(raw);
  const table = parseCsv(input.csv);
  if (table.length < 2) throw invalid("The file has no data rows", { reason: "finance_csv_empty" });
  if (table.length > 2001) throw invalid("Import at most 2000 rows at a time", { reason: "finance_csv_too_many" });
  const header = table[0]!.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (name: string) => header.indexOf(name);
  if (col("date") < 0 || col("amount") < 0 || col("description") < 0) throw invalid("The header needs date, amount and description columns", { reason: "finance_csv_header" });
  return transaction(
    async (tx) => {
      await authorize(ctx, organizationId, companyId, "finance.manage", tx);
      const company = await companyInfo(tx, organizationId, companyId);
      await ensureFinanceSetup(tx, organizationId, companyId);
      const [accounts, categories, counterparties, departments] = await Promise.all([
        tx.financeAccount.findMany({ where: { companyId, archivedAt: null }, select: { id: true, name: true } }),
        tx.financeCategory.findMany({ where: { companyId, archivedAt: null }, select: { id: true, name: true, kind: true } }),
        tx.account.findMany({ where: { companyId, archivedAt: null }, select: { id: true, name: true } }),
        tx.department.findMany({ where: { companyId, archivedAt: null }, select: { id: true, name: true, costCenterCode: true } }),
      ]);
      const key = (s: string) => s.trim().toLowerCase();
      const accountBy = new Map(accounts.map((a) => [key(a.name), a.id]));
      const depBy = new Map(departments.flatMap((d) => [[key(d.name), d.id] as const, ...(d.costCenterCode ? [[key(d.costCenterCode), d.id] as const] : [])]));
      const errors: { row: number; message: string }[] = [];
      const parsed: { row: number; data: Omit<TxnData, "categoryId" | "accountId"> & { category?: string; counterparty?: string } }[] = [];
      table.slice(1).forEach((r, i) => {
        const row = i + 2;
        const get = (name: string) => (col(name) >= 0 ? (r[col(name)] ?? "").trim() : "");
        const rawAmount = get("amount").replace(/[\s,](?=\d{3}\b)/g, "");
        let type = get("type").toUpperCase();
        if (!amount.safeParse(rawAmount).success || /^-?0*(\.0*)?$/.test(rawAmount)) return errors.push({ row, message: "amount" });
        if (!type) type = rawAmount.startsWith("-") ? "EXPENSE" : "INCOME";
        if (!(TXN_TYPES as readonly string[]).includes(type) || type === "TRANSFER") return errors.push({ row, message: "type" });
        const date = get("date");
        if (!day.safeParse(date).success || Number.isNaN(new Date(date).getTime())) return errors.push({ row, message: "date" });
        const accountName = get("account");
        const financeAccountId = accountName ? accountBy.get(key(accountName)) : (input.defaultAccountId ?? undefined);
        if (!financeAccountId) return errors.push({ row, message: "account" });
        const cc = get("cost_center");
        const departmentId = cc ? depBy.get(key(cc)) : undefined;
        if (cc && !departmentId) return errors.push({ row, message: "cost_center" });
        const description = get("description").slice(0, 300);
        if (!description) return errors.push({ row, message: "description" });
        parsed.push({
          row,
          data: {
            type: type as "INCOME" | "EXPENSE",
            date,
            amount: rawAmount.replace(/^-/, ""),
            financeAccountId,
            toAccountId: null,
            departmentId: departmentId ?? null,
            description,
            reference: get("reference").slice(0, 120) || null,
            notes: get("notes").slice(0, 5000) || null,
            category: get("category").slice(0, 80) || undefined,
            counterparty: get("counterparty").slice(0, 200) || undefined,
          },
        });
      });
      if (errors.length) return { created: 0, errors };
      const catBy = new Map(categories.map((c) => [`${c.kind}:${key(c.name)}`, c.id]));
      const cpBy = new Map(counterparties.map((c) => [key(c.name), c.id]));
      let created = 0;
      for (const p of parsed) {
        const { category, counterparty, ...d } = p.data;
        let categoryId: string | null = null;
        if (category) {
          const k = `${d.type}:${key(category)}`;
          categoryId = catBy.get(k) ?? null;
          if (!categoryId) {
            const c = await tx.financeCategory.create({ data: { organizationId, companyId, name: category, kind: d.type as "INCOME" | "EXPENSE", ledgerAccountId: await systemAccount(tx, organizationId, companyId, d.type === "INCOME" ? "other_income" : "expense") } });
            catBy.set(k, c.id);
            categoryId = c.id;
          }
        }
        let accountId: string | null = null;
        if (counterparty) {
          accountId = cpBy.get(key(counterparty)) ?? null;
          if (!accountId) {
            const a = await createCounterparty(ctx, organizationId, companyId, { name: counterparty, type: d.type === "INCOME" ? "CUSTOMER" : "VENDOR" }, { tx });
            cpBy.set(key(counterparty), a.id);
            accountId = a.id;
          }
        }
        try {
          await createTransactionTx(tx, ctx, organizationId, companyId, { ...d, categoryId, accountId }, { currency: company.baseCurrency, source: "IMPORT" });
          created++;
        } catch (err) {
          if (err instanceof AppError) {
            errors.push({ row: p.row, message: (err.details?.reason as string | undefined) ?? err.code });
            continue;
          }
          throw err;
        }
      }
      // Any failure aborts the whole import (the transaction rolls back).
      if (errors.length) throw invalid("Some rows could not be imported", { reason: "finance_csv_rows", rows: errors });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.transactions.imported", resourceType: "finance_transaction", resourceId: null, newValue: { created } });
      return { created, errors };
    },
    { timeout: 120_000 },
  );
}

// ───────────── Recurring expenses ─────────────

export const recurringExpenseInput = z.object({
  name: z.string().trim().min(1).max(200),
  amount: positiveAmount,
  financeAccountId: uuid,
  categoryId: optionalUuid,
  accountId: optionalUuid,
  departmentId: optionalUuid,
  frequency: z.enum(FREQUENCIES),
  nextRunDate: day,
  endDate: day.nullable().optional().or(z.literal("").transform(() => null)),
  active: z.boolean().default(true),
});
export const updateRecurringExpenseInput = recurringExpenseInput.partial();

export async function listRecurringExpenses(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  return db().recurringExpense.findMany({
    where: { organizationId, companyId },
    orderBy: [{ active: "desc" }, { nextRunDate: "asc" }],
    include: { financeAccount: { select: { id: true, name: true } }, category: { select: { id: true, name: true } }, account: { select: { id: true, name: true } }, department: { select: { id: true, name: true } } },
  });
}

async function checkRecurringRefs(tx: Tx, organizationId: string, companyId: string, d: Partial<z.output<typeof recurringExpenseInput>>) {
  if (d.financeAccountId && !(await tx.financeAccount.findFirst({ where: { id: d.financeAccountId, organizationId, companyId }, select: { id: true } }))) throw notFound("Account");
  if (d.categoryId && !(await tx.financeCategory.findFirst({ where: { id: d.categoryId, organizationId, companyId, kind: "EXPENSE" }, select: { id: true } }))) throw notFound("Category");
  if (d.accountId && !(await tx.account.findFirst({ where: { id: d.accountId, organizationId, companyId }, select: { id: true } }))) throw notFound("Vendor");
  if (d.departmentId && !(await tx.department.findFirst({ where: { id: d.departmentId, organizationId, companyId }, select: { id: true } }))) throw notFound("Cost center");
}

export async function createRecurringExpense(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof recurringExpenseInput>) {
  const input = recurringExpenseInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const company = await companyInfo(tx, organizationId, companyId);
    await checkRecurringRefs(tx, organizationId, companyId, input);
    const r = await tx.recurringExpense.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        amountMinor: toMinor(input.amount, company.baseCurrency),
        currency: company.baseCurrency,
        financeAccountId: input.financeAccountId,
        categoryId: input.categoryId ?? null,
        accountId: input.accountId ?? null,
        departmentId: input.departmentId ?? null,
        frequency: input.frequency,
        nextRunDate: toDay(input.nextRunDate),
        endDate: input.endDate ? toDay(input.endDate) : null,
        active: input.active,
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.recurring_expense.created", resourceType: "recurring_expense", resourceId: r.id, newValue: { name: r.name, amountMinor: r.amountMinor, frequency: r.frequency } });
    return r;
  });
}

export async function updateRecurringExpense(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateRecurringExpenseInput>) {
  const input = updateRecurringExpenseInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.recurringExpense.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!before) throw notFound("Recurring expense");
    await checkRecurringRefs(tx, organizationId, companyId, input);
    const r = await tx.recurringExpense.update({
      where: { id },
      data: {
        name: input.name,
        amountMinor: input.amount ? toMinor(input.amount, before.currency) : undefined,
        financeAccountId: input.financeAccountId,
        categoryId: input.categoryId,
        accountId: input.accountId,
        departmentId: input.departmentId,
        frequency: input.frequency,
        nextRunDate: input.nextRunDate ? toDay(input.nextRunDate) : undefined,
        endDate: input.endDate === undefined ? undefined : input.endDate ? toDay(input.endDate) : null,
        active: input.active,
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.recurring_expense.updated", resourceType: "recurring_expense", resourceId: id, newValue: input });
    return r;
  });
}

export async function deleteRecurringExpense(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.recurringExpense.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!before) throw notFound("Recurring expense");
    await tx.financeTransaction.updateMany({ where: { recurringId: id }, data: { recurringId: null } });
    await tx.recurringExpense.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.recurring_expense.deleted", resourceType: "recurring_expense", resourceId: id, oldValue: { name: before.name } });
    return { ok: true };
  });
}

/** Worker: turn every due recurring expense into transactions (catching up at most 24 missed runs each). */
export async function runDueRecurringExpenses(now = new Date()): Promise<number> {
  const today = todayUtc(now);
  const due = await db().recurringExpense.findMany({ where: { active: true, nextRunDate: { lte: today } }, take: 200, select: { id: true } });
  let generated = 0;
  for (const { id } of due) {
    try {
      generated += await transaction(async (tx) => {
        // Re-read under the transaction; skip if another worker advanced it.
        const r = await tx.recurringExpense.findFirst({ where: { id, active: true, nextRunDate: { lte: today } } });
        if (!r) return 0;
        const ctx = systemContext();
        let next = r.nextRunDate;
        let n = 0;
        while (next <= today && n < 24 && (!r.endDate || next <= r.endDate)) {
          await createTransactionTx(
            tx,
            ctx,
            r.organizationId,
            r.companyId,
            {
              type: "EXPENSE",
              date: dayString(next),
              amount: fromMinor(r.amountMinor, r.currency),
              financeAccountId: r.financeAccountId,
              toAccountId: null,
              categoryId: r.categoryId,
              accountId: r.accountId,
              departmentId: r.departmentId,
              description: r.name,
              reference: null,
              notes: null,
            },
            { currency: r.currency, source: "RECURRING", recurringId: r.id },
          );
          next = advance(next, r.frequency);
          n++;
        }
        const ended = !!r.endDate && next > r.endDate;
        await tx.recurringExpense.update({ where: { id }, data: { nextRunDate: next, lastRunAt: new Date(), active: !ended } });
        return n;
      });
    } catch (err) {
      // e.g. a closed period or an archived account: leave it due and report; other schedules still run.
      logger.warn({ err, recurringExpenseId: id }, "recurring expense run failed");
    }
  }
  return generated;
}

// ───────────── Budgets ─────────────

export const budgetInput = z.object({
  name: z.string().trim().min(1).max(120),
  categoryId: optionalUuid,
  departmentId: optionalUuid,
  periodStart: day,
  periodEnd: day,
  amount: positiveAmount,
});
export const updateBudgetInput = budgetInput.partial();

async function checkBudget(tx: Tx, organizationId: string, companyId: string, d: Partial<z.output<typeof budgetInput>>) {
  if (d.categoryId && !(await tx.financeCategory.findFirst({ where: { id: d.categoryId, organizationId, companyId, kind: "EXPENSE" }, select: { id: true } }))) throw notFound("Category");
  if (d.departmentId && !(await tx.department.findFirst({ where: { id: d.departmentId, organizationId, companyId }, select: { id: true } }))) throw notFound("Cost center");
  if (d.periodStart && d.periodEnd && toDay(d.periodEnd) < toDay(d.periodStart)) throw invalid("The end date must be after the start date", { reason: "finance_bad_range" });
}

export async function createBudget(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof budgetInput>) {
  const input = budgetInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const company = await companyInfo(tx, organizationId, companyId);
    await checkBudget(tx, organizationId, companyId, input);
    const b = await tx.financeBudget.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        categoryId: input.categoryId ?? null,
        departmentId: input.departmentId ?? null,
        periodStart: toDay(input.periodStart),
        periodEnd: toDay(input.periodEnd),
        amountMinor: toMinor(input.amount, company.baseCurrency),
        currency: company.baseCurrency,
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.budget.created", resourceType: "finance_budget", resourceId: b.id, newValue: { name: b.name, amountMinor: b.amountMinor } });
    return b;
  });
}

export async function updateBudget(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateBudgetInput>) {
  const input = updateBudgetInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.financeBudget.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!before) throw notFound("Budget");
    await checkBudget(tx, organizationId, companyId, { ...input, periodStart: input.periodStart ?? dayString(before.periodStart), periodEnd: input.periodEnd ?? dayString(before.periodEnd) });
    const b = await tx.financeBudget.update({
      where: { id },
      data: {
        name: input.name,
        categoryId: input.categoryId,
        departmentId: input.departmentId,
        periodStart: input.periodStart ? toDay(input.periodStart) : undefined,
        periodEnd: input.periodEnd ? toDay(input.periodEnd) : undefined,
        amountMinor: input.amount ? toMinor(input.amount, before.currency) : undefined,
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.budget.updated", resourceType: "finance_budget", resourceId: id, newValue: input });
    return b;
  });
}

export async function deleteBudget(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const { count } = isUuid(id) ? await tx.financeBudget.deleteMany({ where: { id, organizationId, companyId } }) : { count: 0 };
    if (!count) throw notFound("Budget");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.budget.deleted", resourceType: "finance_budget", resourceId: id });
    return { ok: true };
  });
}

/** Budgets overlapping the window (all when omitted) with actual expense spend in each budget's own period. */
export async function budgetVsActual(ctx: RequestContext, organizationId: string, companyId: string, window?: { from: Date; to: Date }) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const budgets = await db().financeBudget.findMany({
    where: { organizationId, companyId, ...(window ? { periodStart: { lt: window.to }, periodEnd: { gte: window.from } } : {}) },
    orderBy: [{ periodStart: "desc" }, { name: "asc" }],
    include: { category: { select: { id: true, name: true } }, department: { select: { id: true, name: true } } },
    take: 500,
  });
  const out = [];
  for (const b of budgets) {
    const agg = await db().financeTransaction.aggregate({
      where: { companyId, type: "EXPENSE", date: { gte: b.periodStart, lte: b.periodEnd }, ...(b.categoryId ? { categoryId: b.categoryId } : {}), ...(b.departmentId ? { departmentId: b.departmentId } : {}) },
      _sum: { amountMinor: true },
    });
    const actual = agg._sum.amountMinor ?? 0n;
    out.push({ ...b, actualMinor: actual, remainingMinor: b.amountMinor - actual, usedPct: b.amountMinor > 0n ? Number((actual * 10_000n) / b.amountMinor) / 100 : 0 });
  }
  return out;
}

// ───────────── Reconciliation ─────────────

export const reconciliationInput = z.object({ financeAccountId: uuid, statementDate: day, endingBalance: amount });
export const reconciliationUpdateInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("tick"), transactionIds: z.array(uuid).min(1).max(500), cleared: z.boolean() }),
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("update"), statementDate: day.optional(), endingBalance: amount.optional() }),
]);

const signedFor = (accountId: string, t: { type: FinanceTxnType; amountMinor: bigint; financeAccountId: string; toAccountId: string | null }) =>
  t.type === "INCOME" ? t.amountMinor : t.type === "EXPENSE" ? -t.amountMinor : t.toAccountId === accountId ? t.amountMinor : -t.amountMinor;

export async function listReconciliations(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  return db().reconciliation.findMany({ where: { organizationId, companyId }, orderBy: { createdAt: "desc" }, take: 100, include: { financeAccount: { select: { id: true, name: true } }, _count: { select: { transactions: true } } } });
}

export async function startReconciliation(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof reconciliationInput>) {
  const input = reconciliationInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const acct = await tx.financeAccount.findFirst({ where: { id: input.financeAccountId, organizationId, companyId }, select: { id: true, currency: true } });
    if (!acct) throw notFound("Account");
    if (await tx.reconciliation.findFirst({ where: { financeAccountId: acct.id, status: "IN_PROGRESS" }, select: { id: true } })) throw conflict("Finish the open reconciliation of this account first", { reason: "finance_reconciliation_open" });
    const r = await tx.reconciliation.create({
      data: { organizationId, companyId, financeAccountId: acct.id, statementDate: toDay(input.statementDate), endingBalanceMinor: toMinor(input.endingBalance, acct.currency), createdById: actorId(ctx, organizationId) },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.reconciliation.started", resourceType: "reconciliation", resourceId: r.id, newValue: input });
    return r;
  });
}

async function reconciliationState(client: Tx | ReturnType<typeof db>, companyId: string, r: { id: string; financeAccountId: string; statementDate: Date; endingBalanceMinor: bigint; status: string }) {
  const acct = await client.financeAccount.findFirstOrThrow({ where: { id: r.financeAccountId }, select: { openingBalanceMinor: true, openingDate: true } });
  const accountTxns = { companyId, OR: [{ financeAccountId: r.financeAccountId }, { toAccountId: r.financeAccountId }] };
  const [previously, ticked, candidates] = await Promise.all([
    client.financeTransaction.findMany({ where: { ...accountTxns, reconciledAt: { not: null }, NOT: { reconciliationId: r.id } }, select: { type: true, amountMinor: true, financeAccountId: true, toAccountId: true } }),
    client.financeTransaction.findMany({ where: { ...accountTxns, reconciliationId: r.id }, select: { type: true, amountMinor: true, financeAccountId: true, toAccountId: true } }),
    client.financeTransaction.findMany({
      where: r.status === "COMPLETED" ? { companyId, reconciliationId: r.id } : { ...accountTxns, reconciledAt: null, date: { lte: r.statementDate } },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      take: 2000,
      include: { category: { select: { name: true } }, account: { select: { name: true } } },
    }),
  ]);
  const opening = acct.openingDate <= r.statementDate ? acct.openingBalanceMinor : 0n;
  const startBalance = opening + previously.reduce((s, t) => s + signedFor(r.financeAccountId, t), 0n);
  const cleared = startBalance + ticked.reduce((s, t) => s + signedFor(r.financeAccountId, t), 0n);
  return {
    startBalance,
    clearedBalance: cleared,
    difference: r.endingBalanceMinor - cleared,
    candidates: candidates.map((t) => ({ ...t, signedMinor: signedFor(r.financeAccountId, t), ticked: t.reconciliationId === r.id })),
  };
}

export async function getReconciliation(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const r = isUuid(id) ? await db().reconciliation.findFirst({ where: { id, organizationId, companyId }, include: { financeAccount: { select: { id: true, name: true, currency: true } } } }) : null;
  if (!r) throw notFound("Reconciliation");
  return { ...r, ...(await reconciliationState(db(), companyId, r)) };
}

export async function updateReconciliation(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof reconciliationUpdateInput>) {
  const input = reconciliationUpdateInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const r = isUuid(id) ? await tx.reconciliation.findFirst({ where: { id, organizationId, companyId }, include: { financeAccount: { select: { currency: true } } } }) : null;
    if (!r) throw notFound("Reconciliation");
    if (r.status !== "IN_PROGRESS") throw conflict("This reconciliation is completed", { reason: "finance_reconciliation_done" });
    if (input.action === "tick") {
      const accountTxns = { companyId, reconciledAt: null, date: { lte: r.statementDate }, OR: [{ financeAccountId: r.financeAccountId }, { toAccountId: r.financeAccountId }] };
      await tx.financeTransaction.updateMany({
        where: { id: { in: input.transactionIds }, ...accountTxns, ...(input.cleared ? { reconciliationId: null } : { reconciliationId: id }) },
        data: { reconciliationId: input.cleared ? id : null },
      });
      return { ok: true };
    }
    if (input.action === "update") {
      await tx.reconciliation.update({
        where: { id },
        data: { statementDate: input.statementDate ? toDay(input.statementDate) : undefined, endingBalanceMinor: input.endingBalance ? toMinor(input.endingBalance, r.financeAccount.currency) : undefined },
      });
      if (input.statementDate) await tx.financeTransaction.updateMany({ where: { reconciliationId: id, date: { gt: toDay(input.statementDate) } }, data: { reconciliationId: null } });
      return { ok: true };
    }
    const state = await reconciliationState(tx, companyId, r);
    if (state.difference !== 0n) throw conflict("The difference must be zero to complete", { reason: "finance_reconciliation_difference" });
    const now = new Date();
    await tx.financeTransaction.updateMany({ where: { reconciliationId: id }, data: { reconciledAt: now } });
    await tx.reconciliation.update({ where: { id }, data: { status: "COMPLETED", completedAt: now } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.reconciliation.completed", resourceType: "reconciliation", resourceId: id, newValue: { endingBalanceMinor: r.endingBalanceMinor } });
    return { ok: true };
  });
}

export async function cancelReconciliation(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const r = isUuid(id) ? await tx.reconciliation.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!r) throw notFound("Reconciliation");
    if (r.status !== "IN_PROGRESS") throw conflict("Completed reconciliations can't be cancelled", { reason: "finance_reconciliation_done" });
    await tx.financeTransaction.updateMany({ where: { reconciliationId: id }, data: { reconciliationId: null } });
    await tx.reconciliation.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.reconciliation.cancelled", resourceType: "reconciliation", resourceId: id });
    return { ok: true };
  });
}

export { accountBalances };
