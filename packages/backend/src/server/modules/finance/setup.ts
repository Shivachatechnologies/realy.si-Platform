import { z } from "zod";
import type { AccountType } from "@/generated/prisma/enums";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { actorId, amount, authorize, companyInfo, day, isUuid, optionalText, optionalUuid, percentToBps, todayUtc, toDay, toMinor } from "./common";
import { ensureFinanceSetup, postEntry, removeSourcePostings, systemAccount } from "./ledger";

export const FINANCE_ACCOUNT_TYPES = ["BANK", "CASH", "CARD", "OTHER"] as const;

// ───────────── Bank / cash / card accounts ─────────────

export const financeAccountInput = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(FINANCE_ACCOUNT_TYPES),
  institution: optionalText(120),
  numberLast4: z.string().trim().regex(/^\d{0,4}$/).nullable().optional(),
  openingBalance: amount.default("0"),
  openingDate: day.optional(),
});
export const updateFinanceAccountInput = financeAccountInput.partial().extend({ archived: z.boolean().optional() });

async function nextLedgerCode(tx: Tx, companyId: string, start: number, end: number) {
  const used = new Set((await tx.ledgerAccount.findMany({ where: { companyId }, select: { code: true } })).map((a) => a.code));
  for (let c = start; c <= end; c++) if (!used.has(String(c))) return String(c);
  throw conflict("No free account codes left in the chart", { reason: "finance_chart_full" });
}

async function postOpening(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, account: { id: string; name: string; ledgerAccountId: string; openingBalanceMinor: bigint; openingDate: Date }) {
  await removeSourcePostings(tx, ctx, organizationId, companyId, "OPENING", account.id, `Opening balance changed: ${account.name}`);
  if (account.openingBalanceMinor === 0n) return;
  await postEntry(tx, ctx, {
    organizationId,
    companyId,
    date: account.openingDate,
    memo: `Opening balance: ${account.name}`,
    source: "OPENING",
    sourceId: account.id,
    lines: [
      { ledgerAccountId: account.ledgerAccountId, debitMinor: account.openingBalanceMinor },
      { ledgerAccountId: await systemAccount(tx, organizationId, companyId, "opening"), creditMinor: account.openingBalanceMinor },
    ],
  });
}

/** Balance per finance account: opening + income − expense ± transfers (all transactions, or up to `asOf` exclusive). */
export async function accountBalances(client: Tx | Db, companyId: string, asOf?: Date) {
  const dateWhere = asOf ? { date: { lt: asOf } } : {};
  const [accounts, sums, transfersIn] = await Promise.all([
    client.financeAccount.findMany({ where: { companyId }, select: { id: true, openingBalanceMinor: true, openingDate: true } }),
    client.financeTransaction.groupBy({ by: ["financeAccountId", "type"], where: { companyId, ...dateWhere }, _sum: { amountMinor: true } }),
    client.financeTransaction.groupBy({ by: ["toAccountId"], where: { companyId, type: "TRANSFER", ...dateWhere }, _sum: { amountMinor: true } }),
  ]);
  const bal = new Map(accounts.map((a) => [a.id, !asOf || a.openingDate < asOf ? a.openingBalanceMinor : 0n]));
  for (const s of sums) bal.set(s.financeAccountId, (bal.get(s.financeAccountId) ?? 0n) + (s.type === "INCOME" ? 1n : -1n) * (s._sum.amountMinor ?? 0n));
  for (const s of transfersIn) if (s.toAccountId) bal.set(s.toAccountId, (bal.get(s.toAccountId) ?? 0n) + (s._sum.amountMinor ?? 0n));
  return bal;
}

export async function listFinanceAccounts(ctx: RequestContext, organizationId: string, companyId: string, opts: { includeArchived?: boolean } = {}) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const [accounts, balances] = await Promise.all([
    db().financeAccount.findMany({ where: { organizationId, companyId, ...(opts.includeArchived ? {} : { archivedAt: null }) }, orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }], include: { ledgerAccount: { select: { code: true, name: true } } } }),
    accountBalances(db(), companyId),
  ]);
  return accounts.map((a) => ({ ...a, balanceMinor: balances.get(a.id) ?? 0n }));
}

export async function createFinanceAccount(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof financeAccountInput>) {
  const input = financeAccountInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const company = await companyInfo(tx, organizationId, companyId);
    await ensureFinanceSetup(tx, organizationId, companyId);
    if (await tx.financeAccount.findFirst({ where: { companyId, name: input.name }, select: { id: true } })) throw conflict("An account with this name exists", { reason: "finance_name_taken" });
    const card = input.type === "CARD";
    const code = await nextLedgerCode(tx, companyId, card ? 2101 : input.type === "CASH" ? 1001 : 1011, card ? 2199 : input.type === "CASH" ? 1009 : 1099);
    const ledger = await tx.ledgerAccount.create({ data: { organizationId, companyId, code, name: input.name, type: card ? "LIABILITY" : "ASSET" } });
    const account = await tx.financeAccount.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        type: input.type,
        institution: input.institution ?? null,
        numberLast4: input.numberLast4 || null,
        openingBalanceMinor: toMinor(input.openingBalance, company.baseCurrency),
        openingDate: input.openingDate ? toDay(input.openingDate) : todayUtc(),
        currency: company.baseCurrency,
        ledgerAccountId: ledger.id,
      },
    });
    await postOpening(tx, ctx, organizationId, companyId, account);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.account.created", resourceType: "finance_account", resourceId: account.id, newValue: { name: account.name, type: account.type } });
    return account;
  });
}

export async function updateFinanceAccount(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateFinanceAccountInput>) {
  const input = updateFinanceAccountInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.financeAccount.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!before) throw notFound("Account");
    if (input.type && input.type !== before.type && (input.type === "CARD") !== (before.type === "CARD")) {
      throw conflict("A card account can't become a bank account (or vice versa)", { reason: "finance_account_type_locked" });
    }
    if (input.name && input.name !== before.name && (await tx.financeAccount.findFirst({ where: { companyId, name: input.name }, select: { id: true } }))) {
      throw conflict("An account with this name exists", { reason: "finance_name_taken" });
    }
    const openingBalanceMinor = input.openingBalance !== undefined ? toMinor(input.openingBalance, before.currency) : before.openingBalanceMinor;
    const openingDate = input.openingDate ? toDay(input.openingDate) : before.openingDate;
    const a = await tx.financeAccount.update({
      where: { id },
      data: {
        name: input.name,
        type: input.type,
        institution: input.institution === undefined ? undefined : input.institution,
        numberLast4: input.numberLast4 === undefined ? undefined : input.numberLast4 || null,
        openingBalanceMinor,
        openingDate,
        ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
      },
    });
    if (input.name) await tx.ledgerAccount.update({ where: { id: before.ledgerAccountId }, data: { name: input.name } });
    if (openingBalanceMinor !== before.openingBalanceMinor || openingDate.getTime() !== before.openingDate.getTime()) await postOpening(tx, ctx, organizationId, companyId, a);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: input.archived ? "finance.account.archived" : "finance.account.updated", resourceType: "finance_account", resourceId: id, oldValue: { name: before.name, openingBalanceMinor: before.openingBalanceMinor }, newValue: { name: a.name, openingBalanceMinor } });
    return a;
  });
}

// ───────────── Categories ─────────────

export const categoryInput = z.object({ name: z.string().trim().min(1).max(80), kind: z.enum(["INCOME", "EXPENSE"]), ledgerAccountId: optionalUuid });
export const updateCategoryInput = categoryInput.partial().extend({ archived: z.boolean().optional() });

export async function listCategories(ctx: RequestContext, organizationId: string, companyId: string, opts: { includeArchived?: boolean } = {}) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  await ensureFinanceSetup(db(), organizationId, companyId);
  return db().financeCategory.findMany({
    where: { organizationId, companyId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    include: { ledgerAccount: { select: { id: true, code: true, name: true } }, _count: { select: { transactions: true } } },
  });
}

async function checkLedger(tx: Tx, organizationId: string, companyId: string, id: string | null | undefined, kind: "INCOME" | "EXPENSE") {
  if (!id) return;
  const a = await tx.ledgerAccount.findFirst({ where: { id, organizationId, companyId, archivedAt: null }, select: { type: true } });
  if (!a) throw notFound("Account");
  if (a.type !== kind && !(kind === "EXPENSE" && a.type === "ASSET")) throw conflict("Pick an account of the matching type", { reason: "finance_ledger_type_mismatch" });
}

export async function createCategory(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof categoryInput>) {
  const input = categoryInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    await ensureFinanceSetup(tx, organizationId, companyId);
    await checkLedger(tx, organizationId, companyId, input.ledgerAccountId, input.kind);
    if (await tx.financeCategory.findFirst({ where: { companyId, kind: input.kind, name: input.name }, select: { id: true } })) throw conflict("Category exists", { reason: "finance_name_taken" });
    const c = await tx.financeCategory.create({ data: { organizationId, companyId, name: input.name, kind: input.kind, ledgerAccountId: input.ledgerAccountId ?? (await systemAccount(tx, organizationId, companyId, input.kind === "INCOME" ? "other_income" : "expense")) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.category.created", resourceType: "finance_category", resourceId: c.id, newValue: input });
    return c;
  });
}

export async function updateCategory(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateCategoryInput>) {
  const input = updateCategoryInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.financeCategory.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!before) throw notFound("Category");
    if (input.kind && input.kind !== before.kind && (await tx.financeTransaction.count({ where: { categoryId: id } }))) throw conflict("Category in use", { reason: "finance_category_in_use" });
    await checkLedger(tx, organizationId, companyId, input.ledgerAccountId, input.kind ?? before.kind);
    const name = input.name ?? before.name;
    const kind = input.kind ?? before.kind;
    if ((name !== before.name || kind !== before.kind) && (await tx.financeCategory.findFirst({ where: { companyId, kind, name, id: { not: id } }, select: { id: true } }))) throw conflict("Category exists", { reason: "finance_name_taken" });
    const c = await tx.financeCategory.update({
      where: { id },
      data: { name, kind, ...(input.ledgerAccountId !== undefined && input.ledgerAccountId !== null ? { ledgerAccountId: input.ledgerAccountId } : {}), ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}) },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.category.updated", resourceType: "finance_category", resourceId: id, oldValue: { name: before.name }, newValue: input });
    return c;
  });
}

// ───────────── Tax rates ─────────────

export const taxRateInput = z.object({ name: z.string().trim().min(1).max(60), rate: z.union([z.number(), z.string()]), inclusive: z.boolean().default(false) });
export const updateTaxRateInput = taxRateInput.partial().extend({ archived: z.boolean().optional() });

function rateBps(rate: string | number) {
  const v = percentToBps(rate);
  if (v < 0 || v > 10_000) throw conflict("Rate must be between 0 and 100%", { reason: "finance_bad_rate" });
  return v;
}

export async function listTaxRates(ctx: RequestContext, organizationId: string, companyId: string, opts: { includeArchived?: boolean } = {}) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  return db().financeTaxRate.findMany({ where: { organizationId, companyId, ...(opts.includeArchived ? {} : { archivedAt: null }) }, orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }] });
}

export async function createTaxRate(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof taxRateInput>) {
  const input = taxRateInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    if (await tx.financeTaxRate.findFirst({ where: { companyId, name: input.name }, select: { id: true } })) throw conflict("Tax rate exists", { reason: "finance_name_taken" });
    const r = await tx.financeTaxRate.create({ data: { organizationId, companyId, name: input.name, rateBps: rateBps(input.rate), inclusive: input.inclusive, ledgerAccountId: await systemAccount(tx, organizationId, companyId, "tax") } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.tax_rate.created", resourceType: "finance_tax_rate", resourceId: r.id, newValue: { name: r.name, rateBps: r.rateBps, inclusive: r.inclusive } });
    return r;
  });
}

export async function updateTaxRate(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateTaxRateInput>) {
  const input = updateTaxRateInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.financeTaxRate.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!before) throw notFound("Tax rate");
    if (input.name && input.name !== before.name && (await tx.financeTaxRate.findFirst({ where: { companyId, name: input.name }, select: { id: true } }))) throw conflict("Tax rate exists", { reason: "finance_name_taken" });
    // Existing lines keep their snapshot rate; only new lines use the change.
    const r = await tx.financeTaxRate.update({
      where: { id },
      data: { name: input.name, rateBps: input.rate !== undefined ? rateBps(input.rate) : undefined, inclusive: input.inclusive, ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}) },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.tax_rate.updated", resourceType: "finance_tax_rate", resourceId: id, oldValue: { rateBps: before.rateBps, inclusive: before.inclusive }, newValue: { rateBps: r.rateBps, inclusive: r.inclusive } });
    return r;
  });
}

// ───────────── Customers & vendors (shared Account rows owned by CRM) ─────────────

export const counterpartyInput = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(["CUSTOMER", "VENDOR"]),
  email: z.string().trim().email().max(254).nullable().optional().or(z.literal("").transform(() => null)),
  phone: optionalText(40),
  address: optionalText(1000),
  website: optionalText(300),
  notes: optionalText(2000),
});

/**
 * Small helper allowed by the CRM's ownership of Account: finance creates customer/vendor rows it needs for invoices and
 * expenses (or reuses an existing account with the same name, upgrading a prospect to customer).
 */
export async function createCounterparty(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof counterpartyInput>, opts: { tx?: Tx } = {}) {
  const input = counterpartyInput.parse(raw);
  const run = async (tx: Tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const existing = await tx.account.findFirst({ where: { organizationId, companyId, archivedAt: null, name: { equals: input.name, mode: "insensitive" } } });
    if (existing) {
      if (existing.type === "PROSPECT" && input.type === "CUSTOMER") {
        await tx.account.update({ where: { id: existing.id }, data: { type: "CUSTOMER" } });
        await emitDomainEvent(tx, ctx, "customer.created", { organizationId, companyId, entityType: "account", entityId: existing.id, data: { name: existing.name, source: "finance" } });
      }
      return existing;
    }
    const a = await tx.account.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        type: input.type as AccountType,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        website: input.website ?? null,
        notes: input.notes ?? null,
        source: "finance",
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: input.type === "VENDOR" ? "finance.vendor.created" : "finance.customer.created", resourceType: "account", resourceId: a.id, newValue: { name: a.name, type: a.type } });
    if (input.type === "CUSTOMER") await emitDomainEvent(tx, ctx, "customer.created", { organizationId, companyId, entityType: "account", entityId: a.id, data: { name: a.name, source: "finance" } });
    return a;
  };
  return opts.tx ? run(opts.tx) : transaction(run);
}

export async function updateCounterparty(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: Partial<z.input<typeof counterpartyInput>>) {
  const input = counterpartyInput.partial().omit({ type: true }).parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const before = isUuid(id) ? await tx.account.findFirst({ where: { id, organizationId, companyId } }) : null;
    if (!before) throw notFound("Account");
    const a = await tx.account.update({ where: { id }, data: { name: input.name, email: input.email === undefined ? undefined : input.email, phone: input.phone, address: input.address, website: input.website, notes: input.notes } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.counterparty.updated", resourceType: "account", resourceId: id, oldValue: { name: before.name, email: before.email }, newValue: input });
    return a;
  });
}

/** Customers (CUSTOMER, or PROSPECT/PARTNER on request) or vendors for pickers and lists. */
export async function listCounterparties(ctx: RequestContext, organizationId: string, companyId: string, type: "CUSTOMER" | "VENDOR", opts: { q?: string; take?: number } = {}) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  return db().account.findMany({
    where: {
      organizationId,
      companyId,
      archivedAt: null,
      type: type === "CUSTOMER" ? { in: ["CUSTOMER", "PROSPECT", "PARTNER"] } : { in: ["VENDOR", "PARTNER"] },
      ...(opts.q ? { name: { contains: opts.q, mode: "insensitive" } } : {}),
    },
    orderBy: { name: "asc" },
    take: opts.take ?? 500,
    select: { id: true, name: true, type: true, email: true, phone: true, address: true, website: true, notes: true },
  });
}

/** Vendors with spend in the range. */
export async function vendorSpend(ctx: RequestContext, organizationId: string, companyId: string, from: Date, to: Date) {
  const vendors = await listCounterparties(ctx, organizationId, companyId, "VENDOR");
  const sums = await db().financeTransaction.groupBy({ by: ["accountId"], where: { companyId, type: "EXPENSE", accountId: { not: null }, date: { gte: from, lt: to } }, _sum: { amountMinor: true }, _count: true });
  const map = new Map(sums.map((s) => [s.accountId, { spend: s._sum.amountMinor ?? 0n, count: s._count }]));
  return vendors.map((v) => ({ ...v, spendMinor: map.get(v.id)?.spend ?? 0n, transactions: map.get(v.id)?.count ?? 0 }));
}

// ───────────── Cost centers (Departments, owned by HR) ─────────────

export const costCenterInput = z.object({ name: z.string().trim().min(1).max(120), costCenterCode: optionalText(40) });

export async function listCostCenters(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  return db().department.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, costCenterCode: true } });
}

/** Create a department to use as a cost center (HR manages the rest of it). */
export async function createCostCenter(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof costCenterInput>) {
  const input = costCenterInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    if (await tx.department.findFirst({ where: { companyId, name: input.name }, select: { id: true } })) throw conflict("A department with this name exists", { reason: "finance_name_taken" });
    const d = await tx.department.create({ data: { organizationId, companyId, name: input.name, costCenterCode: input.costCenterCode ?? null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.cost_center.created", resourceType: "department", resourceId: d.id, newValue: input });
    return d;
  });
}

// ───────────── Settings ─────────────

const prefix = z.string().trim().max(12).regex(/^[A-Za-z0-9/_-]*$/).nullable().transform((v) => v ?? "");
export const settingsInput = z.object({
  invoicePrefix: prefix,
  estimatePrefix: prefix,
  creditNotePrefix: prefix,
  defaultDueDays: z.coerce.number().int().min(0).max(365),
  invoiceFooter: optionalText(2000),
});

export async function updateFinanceSettings(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof settingsInput>) {
  const input = settingsInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const s = await tx.financeSettings.upsert({ where: { companyId }, create: { organizationId, companyId, ...input, invoiceFooter: input.invoiceFooter ?? null }, update: { ...input, invoiceFooter: input.invoiceFooter ?? null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "finance.settings.updated", resourceType: "finance_settings", resourceId: s.id, newValue: input });
    return s;
  });
}
