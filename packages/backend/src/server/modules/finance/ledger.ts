import { z } from "zod";
import type { JournalSource, LedgerAccountType } from "@/generated/prisma/enums";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { actorId, authorize, companyInfo, day, isUuid, nextSequence, optionalText, optionalUuid, positiveAmount, toDay, toMinor, uuid, type DateRange } from "./common";

export const LEDGER_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;

/** Standard chart of accounts, seeded lazily the first time a company uses finance. */
const STANDARD_CHART: { code: string; name: string; type: LedgerAccountType; key?: string }[] = [
  { code: "1000", name: "Cash on hand", type: "ASSET", key: "cash" },
  { code: "1010", name: "Bank", type: "ASSET", key: "bank" },
  { code: "1100", name: "Accounts receivable", type: "ASSET", key: "ar" },
  { code: "1200", name: "Prepaid expenses", type: "ASSET" },
  { code: "1500", name: "Fixed assets", type: "ASSET", key: "fixed_assets" },
  { code: "2000", name: "Accounts payable", type: "LIABILITY", key: "ap" },
  { code: "2100", name: "Credit cards", type: "LIABILITY", key: "card" },
  { code: "2200", name: "Sales tax payable", type: "LIABILITY", key: "tax" },
  { code: "2300", name: "Accrued liabilities", type: "LIABILITY" },
  { code: "2500", name: "Loans", type: "LIABILITY", key: "loans" },
  { code: "3000", name: "Owner's equity", type: "EQUITY", key: "equity" },
  { code: "3100", name: "Retained earnings", type: "EQUITY", key: "retained" },
  { code: "3200", name: "Opening balance equity", type: "EQUITY", key: "opening" },
  { code: "4000", name: "Sales revenue", type: "INCOME", key: "revenue" },
  { code: "4100", name: "Service revenue", type: "INCOME", key: "service_revenue" },
  { code: "4900", name: "Other income", type: "INCOME", key: "other_income" },
  { code: "4950", name: "Sales returns and allowances", type: "INCOME", key: "returns" },
  { code: "5000", name: "Cost of goods sold", type: "EXPENSE", key: "cogs" },
  { code: "6000", name: "General expenses", type: "EXPENSE", key: "expense" },
  { code: "6100", name: "Salaries and wages", type: "EXPENSE", key: "salaries" },
  { code: "6200", name: "Rent", type: "EXPENSE", key: "rent" },
  { code: "6300", name: "Software and subscriptions", type: "EXPENSE", key: "software" },
  { code: "6400", name: "Marketing and advertising", type: "EXPENSE", key: "marketing" },
  { code: "6500", name: "Travel", type: "EXPENSE", key: "travel" },
  { code: "6600", name: "Professional fees", type: "EXPENSE", key: "professional" },
  { code: "6700", name: "Utilities", type: "EXPENSE", key: "utilities" },
  { code: "6800", name: "Bank fees", type: "EXPENSE", key: "bank_fees" },
  { code: "6900", name: "Taxes and licenses", type: "EXPENSE", key: "taxes" },
  { code: "6950", name: "Office supplies", type: "EXPENSE", key: "office" },
];

/** Default categories and the ledger account (system key) each posts to. */
const DEFAULT_CATEGORIES: { name: string; kind: "INCOME" | "EXPENSE"; key: string }[] = [
  { name: "Sales", kind: "INCOME", key: "revenue" },
  { name: "Services", kind: "INCOME", key: "service_revenue" },
  { name: "Interest", kind: "INCOME", key: "other_income" },
  { name: "Other income", kind: "INCOME", key: "other_income" },
  { name: "Salaries", kind: "EXPENSE", key: "salaries" },
  { name: "Rent", kind: "EXPENSE", key: "rent" },
  { name: "Software", kind: "EXPENSE", key: "software" },
  { name: "Marketing", kind: "EXPENSE", key: "marketing" },
  { name: "Travel", kind: "EXPENSE", key: "travel" },
  { name: "Professional fees", kind: "EXPENSE", key: "professional" },
  { name: "Utilities", kind: "EXPENSE", key: "utilities" },
  { name: "Bank fees", kind: "EXPENSE", key: "bank_fees" },
  { name: "Taxes", kind: "EXPENSE", key: "taxes" },
  { name: "Office", kind: "EXPENSE", key: "office" },
  { name: "Cost of sales", kind: "EXPENSE", key: "cogs" },
  { name: "Other expenses", kind: "EXPENSE", key: "expense" },
];

/** Idempotently seed the standard chart and default categories for a company. Safe to call on every write. */
export async function ensureFinanceSetup(client: Tx | Db, organizationId: string, companyId: string) {
  const existing = await client.ledgerAccount.count({ where: { companyId } });
  if (existing > 0) return;
  await client.ledgerAccount.createMany({
    data: STANDARD_CHART.map((a) => ({ organizationId, companyId, code: a.code, name: a.name, type: a.type, systemKey: a.key ?? null })),
    skipDuplicates: true,
  });
  const accounts = await client.ledgerAccount.findMany({ where: { companyId, systemKey: { not: null } }, select: { id: true, systemKey: true } });
  const byKey = new Map(accounts.map((a) => [a.systemKey, a.id]));
  await client.financeCategory.createMany({
    data: DEFAULT_CATEGORIES.map((c) => ({ organizationId, companyId, name: c.name, kind: c.kind, ledgerAccountId: byKey.get(c.key) ?? null })),
    skipDuplicates: true,
  });
}

export async function systemAccount(client: Tx | Db, organizationId: string, companyId: string, key: string) {
  await ensureFinanceSetup(client, organizationId, companyId);
  const a = await client.ledgerAccount.findFirst({ where: { companyId, systemKey: key }, select: { id: true } });
  if (a) return a.id;
  // A seeded account was deleted from the chart: fall back to the general account of the same family.
  const fallback = STANDARD_CHART.find((c) => c.key === key);
  const any = await client.ledgerAccount.findFirst({ where: { companyId, type: fallback?.type ?? "EXPENSE", archivedAt: null }, orderBy: { code: "asc" }, select: { id: true } });
  if (!any) throw conflict("The chart of accounts is missing a required account", { reason: "finance_chart_incomplete" });
  return any.id;
}

/** Reject postings dated inside a closed financial period. */
export async function assertPeriodOpen(client: Tx | Db, companyId: string, date: Date) {
  const closed = await client.financialPeriod.findFirst({ where: { companyId, status: "CLOSED", startDate: { lte: date }, endDate: { gte: date } }, select: { name: true } });
  if (closed) throw conflict(`The period ${closed.name} is closed`, { reason: "finance_period_closed" });
}

export interface PostingLine {
  ledgerAccountId: string;
  debitMinor?: bigint;
  creditMinor?: bigint;
  description?: string | null;
  departmentId?: string | null;
}

/**
 * Write a POSTED, balanced journal entry (automatic postings from invoices, payments, transactions). Zero lines are
 * dropped; an entry with nothing left is skipped (returns null).
 */
export async function postEntry(
  tx: Tx,
  ctx: RequestContext,
  args: { organizationId: string; companyId: string; date: Date; memo: string; source: JournalSource; sourceId?: string | null; reversesId?: string | null; lines: PostingLine[] },
) {
  const lines = args.lines
    .map((l) => ({ ...l, debitMinor: l.debitMinor ?? 0n, creditMinor: l.creditMinor ?? 0n }))
    .map((l) => {
      // Normalize negative amounts to the opposite side.
      const net = l.debitMinor - l.creditMinor;
      return { ...l, debitMinor: net > 0n ? net : 0n, creditMinor: net < 0n ? -net : 0n };
    })
    .filter((l) => l.debitMinor !== 0n || l.creditMinor !== 0n);
  if (!lines.length) return null;
  const debit = lines.reduce((s, l) => s + l.debitMinor, 0n);
  const credit = lines.reduce((s, l) => s + l.creditMinor, 0n);
  if (debit !== credit) throw invalid("Journal entry does not balance", { reason: "finance_unbalanced" });
  await assertPeriodOpen(tx, args.companyId, args.date);
  const number = await nextSequence(tx, args.organizationId, args.companyId, "JOURNAL");
  const entry = await tx.journalEntry.create({
    data: {
      organizationId: args.organizationId,
      companyId: args.companyId,
      number,
      date: args.date,
      memo: args.memo.slice(0, 500),
      status: "POSTED",
      source: args.source,
      sourceId: args.sourceId ?? null,
      reversesId: args.reversesId ?? null,
      postedAt: new Date(),
      createdById: actorId(ctx, args.organizationId),
    },
    select: { id: true, number: true },
  });
  await tx.journalLine.createMany({
    data: lines.map((l, i) => ({
      organizationId: args.organizationId,
      companyId: args.companyId,
      entryId: entry.id,
      ledgerAccountId: l.ledgerAccountId,
      debitMinor: l.debitMinor,
      creditMinor: l.creditMinor,
      description: l.description ?? null,
      departmentId: l.departmentId ?? null,
      position: i,
    })),
  });
  return entry;
}

/** Post the mirror image of a posted entry (dated `date`, default today) and return it. */
export async function reverseEntry(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, entryId: string, memo: string, date = new Date()) {
  const entry = await tx.journalEntry.findFirst({ where: { id: entryId, companyId, status: "POSTED" }, include: { lines: true } });
  if (!entry) return null;
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return postEntry(tx, ctx, {
    organizationId,
    companyId,
    date: d < entry.date ? entry.date : d,
    memo,
    source: "REVERSAL",
    sourceId: entry.sourceId,
    reversesId: entry.id,
    lines: entry.lines.map((l) => ({ ledgerAccountId: l.ledgerAccountId, debitMinor: l.creditMinor, creditMinor: l.debitMinor, description: l.description, departmentId: l.departmentId })),
  });
}

/** Cancel all automatic postings of a source record by posting reversals (keeps the audit trail). */
export async function removeSourcePostings(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, source: JournalSource, sourceId: string, memo: string) {
  const entries = await tx.journalEntry.findMany({ where: { companyId, source, sourceId, status: "POSTED" }, select: { id: true, date: true } });
  for (const e of entries) {
    const already = await tx.journalEntry.findFirst({ where: { companyId, reversesId: e.id }, select: { id: true } });
    if (!already) await reverseEntry(tx, ctx, organizationId, companyId, e.id, memo);
  }
}

// ───────────── Chart of accounts ─────────────

export const ledgerAccountInput = z.object({
  code: z.string().trim().regex(/^[0-9A-Za-z.-]{1,12}$/),
  name: z.string().trim().min(1).max(120),
  type: z.enum(LEDGER_TYPES),
  description: optionalText(500),
});
export const updateLedgerAccountInput = ledgerAccountInput.partial().extend({ archived: z.boolean().optional() });

export async function listLedgerAccounts(ctx: RequestContext, organizationId: string, companyId: string, opts: { includeArchived?: boolean } = {}) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  await ensureFinanceSetup(db(), organizationId, companyId);
  const [accounts, sums] = await Promise.all([
    db().ledgerAccount.findMany({ where: { organizationId, companyId, ...(opts.includeArchived ? {} : { archivedAt: null }) }, orderBy: { code: "asc" } }),
    db().journalLine.groupBy({ by: ["ledgerAccountId"], where: { companyId, entry: { status: "POSTED" } }, _sum: { debitMinor: true, creditMinor: true } }),
  ]);
  const bal = new Map(sums.map((s) => [s.ledgerAccountId, (s._sum.debitMinor ?? 0n) - (s._sum.creditMinor ?? 0n)]));
  return accounts.map((a) => {
    const dr = bal.get(a.id) ?? 0n;
    // Natural balance: debit-normal for assets and expenses, credit-normal otherwise.
    return { ...a, balanceMinor: a.type === "ASSET" || a.type === "EXPENSE" ? dr : -dr };
  });
}

export async function createLedgerAccount(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof ledgerAccountInput>) {
  const input = ledgerAccountInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    await ensureFinanceSetup(tx, organizationId, companyId);
    if (await tx.ledgerAccount.findFirst({ where: { companyId, code: input.code }, select: { id: true } })) throw conflict("Code already used", { reason: "finance_code_taken" });
    const a = await tx.ledgerAccount.create({ data: { organizationId, companyId, code: input.code, name: input.name, type: input.type, description: input.description ?? null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.ledger_account.created", resourceType: "ledger_account", resourceId: a.id, newValue: input });
    return a;
  });
}

export async function updateLedgerAccount(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateLedgerAccountInput>) {
  const input = updateLedgerAccountInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.ledgerAccount.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!before) throw notFound("Account");
    if (input.type && input.type !== before.type && (before.systemKey || (await tx.journalLine.count({ where: { ledgerAccountId: id } })))) {
      throw conflict("The type of an account in use can't change", { reason: "finance_account_in_use" });
    }
    if (input.code && input.code !== before.code && (await tx.ledgerAccount.findFirst({ where: { companyId, code: input.code }, select: { id: true } }))) {
      throw conflict("Code already used", { reason: "finance_code_taken" });
    }
    if (input.archived && before.systemKey) throw conflict("System accounts can't be archived", { reason: "finance_system_account" });
    const a = await tx.ledgerAccount.update({
      where: { id },
      data: {
        code: input.code,
        name: input.name,
        type: input.type,
        description: input.description === undefined ? undefined : input.description,
        ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.ledger_account.updated", resourceType: "ledger_account", resourceId: id, oldValue: { code: before.code, name: before.name }, newValue: input });
    return a;
  });
}

// ───────────── Journal entries ─────────────

const journalLineInput = z.object({
  ledgerAccountId: uuid,
  debit: positiveAmount.optional().or(z.literal("").transform(() => undefined)),
  credit: positiveAmount.optional().or(z.literal("").transform(() => undefined)),
  description: optionalText(300),
  departmentId: optionalUuid,
});
export const journalInput = z.object({
  date: day,
  memo: optionalText(500),
  lines: z.array(journalLineInput).min(2).max(100),
  /** Post right away (otherwise saved as draft). */
  post: z.boolean().default(false),
});

async function validatedLines(tx: Tx, organizationId: string, companyId: string, currency: string, lines: z.output<typeof journalLineInput>[]) {
  const ids = [...new Set(lines.map((l) => l.ledgerAccountId))];
  const found = await tx.ledgerAccount.findMany({ where: { id: { in: ids }, organizationId, companyId, archivedAt: null }, select: { id: true } });
  if (found.length !== ids.length) throw notFound("Account");
  const depIds = [...new Set(lines.map((l) => l.departmentId).filter((d): d is string => !!d))];
  if (depIds.length && (await tx.department.count({ where: { id: { in: depIds }, companyId } })) !== depIds.length) throw notFound("Cost center");
  return lines.map((l, i) => {
    const debitMinor = l.debit ? toMinor(l.debit, currency) : 0n;
    const creditMinor = l.credit ? toMinor(l.credit, currency) : 0n;
    if ((debitMinor === 0n) === (creditMinor === 0n)) throw invalid("Each line needs either a debit or a credit", { reason: "finance_line_side" });
    return { organizationId, companyId, ledgerAccountId: l.ledgerAccountId, debitMinor, creditMinor, description: l.description ?? null, departmentId: l.departmentId ?? null, position: i };
  });
}

function assertBalanced(lines: { debitMinor: bigint; creditMinor: bigint }[]) {
  const d = lines.reduce((s, l) => s + l.debitMinor, 0n);
  const c = lines.reduce((s, l) => s + l.creditMinor, 0n);
  if (d !== c || d === 0n) throw invalid("Debits and credits must be equal", { reason: "finance_unbalanced" });
}

export async function createJournalEntry(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof journalInput>) {
  const input = journalInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const company = await companyInfo(tx, organizationId, companyId);
    await ensureFinanceSetup(tx, organizationId, companyId);
    const lines = await validatedLines(tx, organizationId, companyId, company.baseCurrency, input.lines);
    const date = toDay(input.date);
    if (input.post) {
      assertBalanced(lines);
      await assertPeriodOpen(tx, companyId, date);
    }
    const number = await nextSequence(tx, organizationId, companyId, "JOURNAL");
    const e = await tx.journalEntry.create({
      data: {
        organizationId,
        companyId,
        number,
        date,
        memo: input.memo ?? null,
        status: input.post ? "POSTED" : "DRAFT",
        postedAt: input.post ? new Date() : null,
        source: "MANUAL",
        createdById: actorId(ctx, organizationId),
      },
    });
    await tx.journalLine.createMany({ data: lines.map((l) => ({ ...l, entryId: e.id })) });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: input.post ? "finance.journal.posted" : "finance.journal.created", resourceType: "journal_entry", resourceId: e.id, newValue: { number, date: input.date } });
    return e;
  });
}

export async function updateJournalEntry(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof journalInput>) {
  const input = journalInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const entry = isUuid(id) ? await tx.journalEntry.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!entry) throw notFound("Journal entry");
    if (entry.status !== "DRAFT") throw conflict("Posted entries can't be edited; reverse them instead", { reason: "finance_entry_posted" });
    const company = await companyInfo(tx, organizationId, companyId);
    const lines = await validatedLines(tx, organizationId, companyId, company.baseCurrency, input.lines);
    const date = toDay(input.date);
    if (input.post) {
      assertBalanced(lines);
      await assertPeriodOpen(tx, companyId, date);
    }
    await tx.journalLine.deleteMany({ where: { entryId: id } });
    const e = await tx.journalEntry.update({
      where: { id },
      data: { date, memo: input.memo ?? null, status: input.post ? "POSTED" : "DRAFT", postedAt: input.post ? new Date() : null },
    });
    await tx.journalLine.createMany({ data: lines.map((l) => ({ ...l, entryId: id })) });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: input.post ? "finance.journal.posted" : "finance.journal.updated", resourceType: "journal_entry", resourceId: id });
    return e;
  });
}

export async function postJournalEntry(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const entry = isUuid(id) ? await tx.journalEntry.findFirst({ where: { id, organizationId, companyId }, include: { lines: true } }) : null;
    if (!entry) throw notFound("Journal entry");
    if (entry.status !== "DRAFT") throw conflict("Already posted", { reason: "finance_entry_posted" });
    assertBalanced(entry.lines);
    await assertPeriodOpen(tx, companyId, entry.date);
    await tx.journalEntry.update({ where: { id }, data: { status: "POSTED", postedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.journal.posted", resourceType: "journal_entry", resourceId: id });
    return { ok: true };
  });
}

export async function deleteJournalEntry(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const entry = isUuid(id) ? await tx.journalEntry.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!entry) throw notFound("Journal entry");
    if (entry.status !== "DRAFT") throw conflict("Posted entries can't be deleted; reverse them instead", { reason: "finance_entry_posted" });
    await tx.journalEntry.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.journal.deleted", resourceType: "journal_entry", resourceId: id });
    return { ok: true };
  });
}

export async function reverseJournalEntry(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const entry = isUuid(id) ? await tx.journalEntry.findFirst({ where: { id, organizationId, companyId, status: "POSTED" } }) : null;
    if (!entry) throw notFound("Journal entry");
    if (entry.source !== "MANUAL" && entry.source !== "OPENING") throw conflict("Automatic postings change with their source record", { reason: "finance_entry_automatic" });
    if (await tx.journalEntry.findFirst({ where: { companyId, reversesId: id }, select: { id: true } })) throw conflict("Already reversed", { reason: "finance_entry_reversed" });
    const r = await reverseEntry(tx, ctx, organizationId, companyId, id, `Reversal of #${entry.number}`);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.journal.reversed", resourceType: "journal_entry", resourceId: id, newValue: { reversalId: r?.id } });
    return r;
  });
}

export interface JournalFilters {
  q?: string;
  status?: "DRAFT" | "POSTED";
  source?: JournalSource;
  page: number;
}

export async function listJournalEntries(ctx: RequestContext, organizationId: string, companyId: string, f: JournalFilters, range?: DateRange) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const where = {
    organizationId,
    companyId,
    ...(f.status ? { status: f.status } : {}),
    ...(f.source ? { source: f.source } : {}),
    ...(range ? { date: { gte: range.from, lt: range.to } } : {}),
    ...(f.q ? { OR: [{ memo: { contains: f.q, mode: "insensitive" as const } }, ...(/^\d+$/.test(f.q) ? [{ number: Number(f.q) }] : [])] } : {}),
  };
  const [total, rows] = await Promise.all([
    db().journalEntry.count({ where }),
    db().journalEntry.findMany({
      where,
      orderBy: [{ date: "desc" }, { number: "desc" }],
      skip: (f.page - 1) * 50,
      take: 50,
      include: { lines: { select: { debitMinor: true, creditMinor: true, ledgerAccount: { select: { code: true, name: true } } }, orderBy: { position: "asc" } } },
    }),
  ]);
  return { total, rows: rows.map((r) => ({ ...r, totalMinor: r.lines.reduce((s, l) => s + l.debitMinor, 0n) })) };
}

export async function getJournalEntry(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const e = isUuid(id)
    ? await db().journalEntry.findFirst({
        where: { id, organizationId, companyId },
        include: { lines: { orderBy: { position: "asc" }, include: { ledgerAccount: { select: { id: true, code: true, name: true } }, department: { select: { id: true, name: true } } } } },
      })
    : null;
  if (!e) throw notFound("Journal entry");
  const reversal = await db().journalEntry.findFirst({ where: { companyId, reversesId: id }, select: { id: true, number: true } });
  return { ...e, reversal };
}

/** General ledger of one account: posted lines in the range with running balance (natural sign), plus the opening balance. */
export async function generalLedger(ctx: RequestContext, organizationId: string, companyId: string, ledgerAccountId: string, range: DateRange) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const account = isUuid(ledgerAccountId) ? await db().ledgerAccount.findFirst({ where: { id: ledgerAccountId, organizationId, companyId } }) : null;
  if (!account) throw notFound("Account");
  const sign = account.type === "ASSET" || account.type === "EXPENSE" ? 1n : -1n;
  const before = await db().journalLine.aggregate({ where: { ledgerAccountId, entry: { status: "POSTED", date: { lt: range.from } } }, _sum: { debitMinor: true, creditMinor: true } });
  const opening = sign * ((before._sum.debitMinor ?? 0n) - (before._sum.creditMinor ?? 0n));
  const lines = await db().journalLine.findMany({
    where: { ledgerAccountId, entry: { status: "POSTED", date: { gte: range.from, lt: range.to } } },
    include: { entry: { select: { id: true, number: true, date: true, memo: true, source: true } } },
    orderBy: [{ entry: { date: "asc" } }, { entry: { number: "asc" } }, { position: "asc" }],
    take: 5000,
  });
  let running = opening;
  const rows = lines.map((l) => {
    running += sign * (l.debitMinor - l.creditMinor);
    return { id: l.id, entry: l.entry, description: l.description, debitMinor: l.debitMinor, creditMinor: l.creditMinor, balanceMinor: running };
  });
  return { account, opening, closing: running, rows };
}

// ───────────── Financial periods ─────────────

export const periodInput = z.object({ name: z.string().trim().min(1).max(60), startDate: day, endDate: day });

export async function listPeriods(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  return db().financialPeriod.findMany({ take: 500, where: { organizationId, companyId }, orderBy: { startDate: "desc" } });
}

export async function createPeriod(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof periodInput>) {
  const input = periodInput.parse(raw);
  const startDate = toDay(input.startDate);
  const endDate = toDay(input.endDate);
  if (endDate < startDate) throw invalid("The end date must be after the start date", { reason: "finance_bad_range" });
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const overlap = await tx.financialPeriod.findFirst({ where: { companyId, startDate: { lte: endDate }, endDate: { gte: startDate } }, select: { id: true } });
    if (overlap) throw conflict("Periods can't overlap", { reason: "finance_period_overlap" });
    const p = await tx.financialPeriod.create({ data: { organizationId, companyId, name: input.name, startDate, endDate } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.period.created", resourceType: "financial_period", resourceId: p.id, newValue: input });
    return p;
  });
}

export async function setPeriodStatus(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: { status: "OPEN" | "CLOSED" }) {
  const { status } = z.object({ status: z.enum(["OPEN", "CLOSED"]) }).parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const p = isUuid(id) ? await tx.financialPeriod.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!p) throw notFound("Period");
    if (status === "CLOSED") {
      const drafts = await tx.journalEntry.count({ where: { companyId, status: "DRAFT", date: { gte: p.startDate, lte: p.endDate } } });
      if (drafts) throw conflict("Post or delete the draft journal entries of this period first", { reason: "finance_period_drafts" });
    }
    const r = await tx.financialPeriod.update({ where: { id }, data: { status, closedAt: status === "CLOSED" ? new Date() : null, closedById: status === "CLOSED" ? (ctx.actor.id ?? null) : null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: status === "CLOSED" ? "finance.period.closed" : "finance.period.reopened", resourceType: "financial_period", resourceId: id });
    return r;
  });
}

export async function deletePeriod(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const p = isUuid(id) ? await tx.financialPeriod.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!p) throw notFound("Period");
    if (p.status === "CLOSED") throw conflict("Reopen the period before deleting it", { reason: "finance_period_closed" });
    await tx.financialPeriod.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.period.deleted", resourceType: "financial_period", resourceId: id });
    return { ok: true };
  });
}

/** Sum of posted lines per ledger account (debit − credit) within an optional date window. */
export async function ledgerTotals(client: Tx | Db, companyId: string, where: { from?: Date; to?: Date }) {
  const sums = await client.journalLine.groupBy({
    by: ["ledgerAccountId"],
    where: { companyId, entry: { status: "POSTED", date: { ...(where.from ? { gte: where.from } : {}), ...(where.to ? { lt: where.to } : {}) } } },
    _sum: { debitMinor: true, creditMinor: true },
  });
  return new Map(sums.map((s) => [s.ledgerAccountId, (s._sum.debitMinor ?? 0n) - (s._sum.creditMinor ?? 0n)]));
}
