import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { loadProgress, saveProgress } from "@/server/modules/crm/guided";
import { burnRate, cashBalance, openReceivables, overdueReceivables, profitAndLossTotals } from "./analytics";
import { balanceOf, OPEN_STATUSES } from "./billing";
import { addMonths, authorize, financeSettings, monthStart, todayUtc } from "./common";
import { ensureFinanceSetup } from "./ledger";
import { upcomingPayables } from "./payables";
import { askCfo } from "./insights";
import { openPayables } from "./spend";

/**
 * Finance OS beginner flows ("Add income", "Create invoice", …): a plain-language snapshot of the numbers that change
 * after each flow, the options a flow needs (with recommended defaults), and saved progress per flow. Records are
 * created through the existing finance services and API.
 */

export const FINANCE_FLOWS = ["income", "expense", "invoice", "payments", "bills", "profit"] as const;
export type FinanceFlow = (typeof FINANCE_FLOWS)[number];
const flowKey = (f: FinanceFlow) => `finance_${f}`;

/** The figures a beginner cares about, this month and now. */
export async function financeSnapshot(ctx: RequestContext, organizationId: string, companyId: string, now = new Date()) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const client = db();
  await ensureFinanceSetup(client, organizationId, companyId);
  const today = todayUtc(now);
  const from = monthStart(today);
  const company = await client.company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { baseCurrency: true } });
  const [month, cash, receivables, overdue, payables, payablesOverdue, upcoming, burn] = await Promise.all([
    profitAndLossTotals(client, companyId, { from, to: addMonths(from, 1) }),
    cashBalance(client, companyId),
    openReceivables(client, companyId),
    overdueReceivables(client, companyId, today),
    openPayables(client, companyId),
    openPayables(client, companyId, { dueBefore: today }),
    upcomingPayables(client, companyId, 30, today),
    burnRate(client, companyId, now),
  ]);
  return {
    currency: company.baseCurrency,
    monthRevenue: month.revenue,
    monthExpenses: month.expenses,
    monthProfit: month.profit,
    cash,
    receivables,
    overdue,
    payables,
    payablesOverdue,
    upcomingCount: upcoming.length,
    upcomingTotal: upcoming.reduce((s, b) => s + b.balanceMinor, 0n),
    netBurn: burn.netBurn,
    runwayMonths: burn.netBurn > 0n ? Number((cash * 10n) / burn.netBurn) / 10 : null,
  };
}

/** Everything the guided flows need to preselect sensible defaults. */
export async function guidedOptions(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const client = db();
  await ensureFinanceSetup(client, organizationId, companyId);
  const today = todayUtc();
  const [accounts, categories, customers, vendors, invoices, bills, settings] = await Promise.all([
    client.financeAccount.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, type: true } }),
    client.financeCategory.findMany({
      where: { organizationId, companyId, archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true, _count: { select: { transactions: true } } },
    }),
    client.account.findMany({ where: { organizationId, companyId, archivedAt: null, type: { in: ["CUSTOMER", "PROSPECT", "PARTNER"] } }, orderBy: { name: "asc" }, take: 300, select: { id: true, name: true, email: true } }),
    client.account.findMany({ where: { organizationId, companyId, archivedAt: null, type: { in: ["VENDOR", "PARTNER"] } }, orderBy: { name: "asc" }, take: 300, select: { id: true, name: true } }),
    client.invoice.findMany({
      where: { organizationId, companyId, status: { in: OPEN_STATUSES } },
      orderBy: { dueDate: "asc" },
      take: 100,
      select: { id: true, number: true, dueDate: true, currency: true, totalMinor: true, paidMinor: true, creditedMinor: true, status: true, account: { select: { name: true } } },
    }),
    upcomingPayables(client, companyId, 60, today),
    financeSettings(client, organizationId, companyId),
  ]);
  // Recommended category: the one used most often (ties → alphabetical).
  const rank = (kind: "INCOME" | "EXPENSE") => categories.filter((c) => c.kind === kind).sort((a, b) => b._count.transactions - a._count.transactions || a.name.localeCompare(b.name));
  const income = rank("INCOME");
  const expense = rank("EXPENSE");
  return {
    accounts,
    incomeCategories: income.map((c) => ({ id: c.id, name: c.name })),
    expenseCategories: expense.map((c) => ({ id: c.id, name: c.name })),
    customers,
    vendors,
    openInvoices: invoices.map((i) => ({
      id: i.id,
      number: i.number,
      customer: i.account.name,
      dueDate: i.dueDate.toISOString().slice(0, 10),
      currency: i.currency,
      balanceMinor: balanceOf(i).toString(),
      overdue: i.dueDate < today,
    })),
    upcomingBills: bills.map((b) => ({ id: b.id, number: b.number, vendor: b.vendor.name, dueDate: b.dueDate.toISOString().slice(0, 10), currency: b.currency, balanceMinor: b.balanceMinor.toString(), overdue: b.overdue })),
    defaultDueDays: settings.defaultDueDays,
  };
}

export const flowProgressInput = z.object({
  step: z.number().int().min(0).max(10),
  data: z.record(z.string().regex(/^[a-zA-Z]{1,40}$/), z.union([z.string().max(5000), z.number(), z.boolean(), z.null()])).default({}),
  completed: z.boolean().optional(),
});

export const parseFlow = (v: string | undefined): FinanceFlow | null => ((FINANCE_FLOWS as readonly string[]).includes(v ?? "") ? (v as FinanceFlow) : null);

export async function getFlowProgress(ctx: RequestContext, organizationId: string, companyId: string, flow: FinanceFlow) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const row = await loadProgress(db(), companyId, flowKey(flow));
  return { step: row?.step ?? 0, data: (row?.data as Record<string, unknown> | null) ?? {}, completedAt: row?.completedAt ?? null };
}

/** Save a flow's draft (step + answers); `completed` resets the draft for the next run and stamps completion. */
export async function saveFlowProgress(ctx: RequestContext, organizationId: string, companyId: string, flow: FinanceFlow, raw: z.input<typeof flowProgressInput>) {
  const input = flowProgressInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "finance.manage", tx);
    const r = await saveProgress(tx, ctx, organizationId, companyId, flowKey(flow), input.completed ? { step: 0, data: {}, replace: true, completed: true } : { step: input.step, data: input.data, replace: true });
    return { step: r.step, completedAt: r.completedAt };
  });
}

/** Which beginner flows were completed at least once (for check marks on the finance home). */
export async function completedFlows(organizationId: string, companyId: string) {
  const rows = await db().guidedFlowProgress.findMany({ where: { organizationId, companyId, flow: { in: FINANCE_FLOWS.map(flowKey) }, completedAt: { not: null } }, select: { flow: true } });
  return new Set(rows.map((r) => r.flow.replace(/^finance_/, "") as FinanceFlow));
}

export const financeHelpInput = z.object({
  page: z.string().trim().regex(/^[a-zA-Z0-9_.-]{1,60}$/),
  request: z.string().trim().max(1000).optional(),
  locale: z.string().max(10).optional(),
});

/** "Help me do this" on a finance page: an AI CFO question carrying the page context (answered from the real books). */
export async function financeHelp(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof financeHelpInput>) {
  const input = financeHelpInput.parse(raw);
  const lang = input.locale && /^[a-z]{2}(-[A-Z]{2})?$/.test(input.locale) ? ` Answer in the language of the locale "${input.locale}".` : "";
  const question = [
    `I'm on the "${input.page}" page of Finance and I'm not a finance expert. Explain in plain words what this page is for, what our real numbers here mean right now, and the next 1–3 concrete steps I should take in Realy.si.`,
    input.request ? `My question: ${input.request}` : null,
    lang.trim() || null,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 2000);
  return askCfo(ctx, organizationId, companyId, { question });
}
