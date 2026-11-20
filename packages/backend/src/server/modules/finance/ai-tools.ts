import { z } from "zod";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import { addDays, addMonths, authorize, companyInfo, dayString, fromMinor, monthStart, todayUtc, toDay } from "./common";
import { burnRate, cashBalance, cashForecast, detectExpenseAnomalies, openReceivables, overdueReceivables, profitAndLossTotals, recurringRevenue } from "./analytics";
import { createInvoice, INVOICE_STATUSES, listInvoices } from "./billing";
import { createTransaction, listTransactions } from "./transactions";
import { createCounterparty } from "./setup";
import { createBill, payablesAging, upcomingPayables } from "./payables";
import { departmentBudgets, parseBudgetWindow } from "./budgets";
import { budgetVsActual } from "./transactions";
import { financeAlertCenter } from "./alerts";
import { moneyFlow } from "./money-flow";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = (v: bigint, currency: string) => `${fromMinor(v, currency)} ${currency}`;

/** AI tools of the finance module, registered in src/server/modules/tools/modules.ts. Use `def` from tools/define. */
export const FINANCE_TOOLS: Record<string, ToolDefinition> = {
  read_financial_summary: def({
    name: "read_financial_summary",
    version: 1,
    description:
      "Financial summary from the company's books for a date range (default: the last 3 full months plus this month): revenue, expenses and net profit (from posted journal entries), cash balance, net and gross burn rate, runway, MRR, ARR, open and overdue receivables, and revenue/expenses per month.",
    input: z.object({ from: date.optional(), to: date.optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { from: { type: "string", description: "Start date YYYY-MM-DD (inclusive)" }, to: { type: "string", description: "End date YYYY-MM-DD (inclusive)" } },
      required: [],
      additionalProperties: false,
    },
    permissions: ["finance.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: ({ from, to }) => `Read the financial summary${from || to ? ` (${from ?? "…"} – ${to ?? "today"})` : ""}`,
    async execute({ from, to }, { ctx, organizationId, companyId }) {
      await authorize(ctx, organizationId, companyId, "finance.read");
      const c = (await companyInfo(db(), organizationId, companyId)).baseCurrency;
      const range = { from: from ? toDay(from) : addMonths(monthStart(todayUtc()), -3), to: to ? addDays(toDay(to), 1) : addDays(todayUtc(), 1) };
      if (range.from >= range.to) throw new AppError("validation_error", "from must be before to");
      const client = db();
      const [pnl, cash, burn, rr, overdue, open] = await Promise.all([
        profitAndLossTotals(client, companyId, range),
        cashBalance(client, companyId),
        burnRate(client, companyId),
        recurringRevenue(client, companyId),
        overdueReceivables(client, companyId),
        openReceivables(client, companyId),
      ]);
      const monthly: string[] = [];
      for (let m = monthStart(range.from); m < range.to; m = addMonths(m, 1)) {
        const end = addMonths(m, 1) < range.to ? addMonths(m, 1) : range.to;
        const r = await profitAndLossTotals(client, companyId, { from: m < range.from ? range.from : m, to: end });
        monthly.push(`- ${dayString(m).slice(0, 7)}: revenue ${money(r.revenue, c)}, expenses ${money(r.expenses, c)}, profit ${money(r.profit, c)}`);
      }
      const runway = burn.netBurn > 0n ? `${(Number((cash * 10n) / burn.netBurn) / 10).toFixed(1)} months` : "not burning cash (cash-flow positive over the last 3 months)";
      const content = [
        `Period ${dayString(range.from)} to ${dayString(addDays(range.to, -1))}, currency ${c}.`,
        `Revenue ${money(pnl.revenue, c)}; expenses ${money(pnl.expenses, c)}; net profit ${money(pnl.profit, c)}.`,
        `Cash balance now ${money(cash, c)}. Net burn ${money(burn.netBurn, c)}/month, gross burn ${money(burn.grossBurn, c)}/month. Runway: ${runway}.`,
        `MRR ${money(rr.mrr, c)}; ARR ${money(rr.arr, c)} (from active recurring invoices).`,
        `Open receivables ${money(open, c)}, of which overdue ${money(overdue, c)}.`,
        `By month:\n${monthly.join("\n")}`,
      ].join("\n");
      return { content, count: monthly.length };
    },
  }),

  read_cashflow_forecast: def({
    name: "read_cashflow_forecast",
    version: 1,
    description: "Cash-flow forecast for the next 1–12 months: expected receivables, recurring income and expenses, planned items, trend, net flow and projected cash balance per month.",
    input: z.object({ months: z.number().int().min(1).max(12).optional() }).strict(),
    modelSchema: { type: "object", properties: { months: { type: "integer", description: "Months ahead (default 6)" } }, required: [], additionalProperties: false },
    permissions: ["finance.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: ({ months }) => `Read the ${months ?? 6}-month cash-flow forecast`,
    async execute({ months }, { ctx, organizationId, companyId }) {
      await authorize(ctx, organizationId, companyId, "finance.read");
      const c = (await companyInfo(db(), organizationId, companyId)).baseCurrency;
      const f = await cashForecast(db(), companyId, months ?? 6);
      const lines = f.months.map(
        (m) =>
          `- ${m.month}: inflow ${money(m.inflow, c)} (receivables ${money(m.receivables, c)}, recurring ${money(m.recurringIncome, c)}, trend ${money(m.trendIncome, c)}), outflow ${money(m.outflow, c)} (recurring ${money(m.recurringExpenses, c)}, trend ${money(m.trendExpenses, c)}), planned ${money(m.planned, c)}, net ${money(m.net, c)}, projected cash ${money(m.balance, c)}`,
      );
      return { content: `Starting cash ${money(f.startingCash, c)}.\n${lines.join("\n")}`, count: lines.length };
    },
  }),

  read_invoices: def({
    name: "read_invoices",
    version: 1,
    description: "List the company's invoices (newest first, up to 50), optionally filtered by status or a search term (number or customer). Returns number, customer, status, dates, total and balance due.",
    input: z.object({ status: z.enum(INVOICE_STATUSES).optional(), query: z.string().trim().max(200).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { status: { type: "string", enum: [...INVOICE_STATUSES] }, query: { type: "string", description: "Invoice number or customer name" } },
      required: [],
      additionalProperties: false,
    },
    permissions: ["finance.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ status, query }) => `Read invoices${status ? ` (${status})` : ""}${query ? ` matching "${query}"` : ""}`,
    async execute({ status, query }, { ctx, organizationId, companyId }) {
      const r = await listInvoices(ctx, organizationId, companyId, { status, q: query, sort: "issueDate", dir: "desc", page: 1 });
      if (!r.rows.length) return { content: "No invoices match.", count: 0 };
      const content = r.rows
        .map((i) => `- ${i.number} (${i.id}) ${i.account.name} [${i.status}] issued ${dayString(i.issueDate)}, due ${dayString(i.dueDate)}, total ${money(i.totalMinor, i.currency)}, balance ${money(i.balanceMinor, i.currency)}`)
        .join("\n");
      return { content: `${r.total} invoice(s); showing ${r.rows.length}.\n${content}`, count: r.rows.length, records: r.rows.map((i) => `invoice:${i.id}`) };
    },
  }),

  read_expenses: def({
    name: "read_expenses",
    version: 1,
    description: "List expense transactions (newest first, up to 50) in an optional date range or matching a search term, with category, vendor, cost center and amount, plus the total.",
    input: z.object({ from: date.optional(), to: date.optional(), query: z.string().trim().max(200).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" }, query: { type: "string" } },
      required: [],
      additionalProperties: false,
    },
    permissions: ["finance.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ from, to }) => `Read expenses${from || to ? ` (${from ?? "…"} – ${to ?? "today"})` : ""}`,
    async execute({ from, to, query }, { ctx, organizationId, companyId }) {
      const r = await listTransactions(ctx, organizationId, companyId, { type: "EXPENSE", from, to, q: query, sort: "date", dir: "desc", page: 1 });
      if (!r.rows.length) return { content: "No expenses match.", count: 0 };
      const c = r.rows[0]!.currency;
      const content = r.rows
        .map((t) => `- ${dayString(t.date)} ${money(t.amountMinor, t.currency)} — ${t.description}; category ${t.category?.name ?? "none"}; vendor ${t.account?.name ?? "none"}; cost center ${t.department?.name ?? "none"}`)
        .join("\n");
      return { content: `${r.total} expense(s), total ${money(r.totals.EXPENSE, c)}; showing ${r.rows.length}.\n${content}`, count: r.rows.length, records: r.rows.map((t) => `finance_transaction:${t.id}`) };
    },
  }),

  detect_expense_anomalies: def({
    name: "detect_expense_anomalies",
    version: 1,
    description:
      "Statistical anomaly detection on expenses: each expense of the last N days (default 90) is compared with the other expenses of its category and of its vendor over the past year (z-score, at least 5 comparable expenses). Returns the unusual ones with their z-score and the typical amount.",
    input: z.object({ days: z.number().int().min(7).max(365).optional(), threshold: z.number().min(1.5).max(6).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { days: { type: "integer", description: "Look-back window in days (default 90)" }, threshold: { type: "number", description: "|z| threshold (default 2.5)" } },
      required: [],
      additionalProperties: false,
    },
    permissions: ["finance.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: ({ days }) => `Detect expense anomalies (last ${days ?? 90} days)`,
    async execute({ days, threshold }, { ctx, organizationId, companyId }) {
      const found = await detectExpenseAnomalies(ctx, organizationId, companyId, { days, threshold });
      if (!found.length) return { content: "No statistically unusual expenses found (or not enough history per category/vendor).", count: 0 };
      const c = (await companyInfo(db(), organizationId, companyId)).baseCurrency;
      const content = found.map((a) => `- ${dayString(a.date)} ${money(a.amountMinor, c)} "${a.description}" — ${a.group} ${a.groupName}: typical ${money(a.meanMinor, c)}, z = ${a.z} (n=${a.samples})`).join("\n");
      return { content, count: found.length, records: found.map((a) => `finance_transaction:${a.id}`) };
    },
  }),

  create_invoice_draft: def({
    name: "create_invoice_draft",
    version: 1,
    description:
      'Propose a DRAFT invoice for a customer (existing customer by name, or a new one). A person must approve before it is created; it is never sent automatically. Unit prices are in major units of the company currency (e.g. "1250.00").',
    input: z
      .object({
        customerName: z.string().trim().min(1).max(200),
        customerEmail: z.string().trim().email().max(254).optional(),
        issueDate: date.optional(),
        dueDate: date.optional(),
        notes: z.string().trim().max(2000).optional(),
        lines: z
          .array(z.object({ description: z.string().trim().min(1).max(500), quantity: z.number().positive().max(1_000_000), unitPrice: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/) }).strict())
          .min(1)
          .max(50),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        customerName: { type: "string" },
        customerEmail: { type: "string" },
        issueDate: { type: "string", description: "YYYY-MM-DD, default today" },
        dueDate: { type: "string", description: "YYYY-MM-DD, default per payment terms" },
        notes: { type: "string" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: { description: { type: "string" }, quantity: { type: "number" }, unitPrice: { type: "string", description: "Major units, e.g. 99.50" } },
            required: ["description", "quantity", "unitPrice"],
            additionalProperties: false,
          },
        },
      },
      required: ["customerName", "lines"],
      additionalProperties: false,
    },
    permissions: ["finance.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 20_000,
    summarize: ({ customerName, lines }) => `Create a draft invoice for ${customerName} (${lines.length} line${lines.length === 1 ? "" : "s"})`,
    async execute(input, { ctx, organizationId, companyId }) {
      const existing = await db().account.findFirst({ where: { organizationId, companyId, archivedAt: null, name: { equals: input.customerName, mode: "insensitive" } }, select: { id: true } });
      const accountId = existing?.id ?? (await createCounterparty(ctx, organizationId, companyId, { name: input.customerName, email: input.customerEmail ?? null, type: "CUSTOMER" })).id;
      const inv = await createInvoice(ctx, organizationId, companyId, {
        accountId,
        issueDate: input.issueDate ?? dayString(todayUtc()),
        dueDate: input.dueDate,
        notes: input.notes ?? null,
        lines: input.lines.map((l) => ({ description: l.description, quantity: String(Math.round(l.quantity * 1000) / 1000), unitPrice: l.unitPrice })),
      });
      return { content: `Draft invoice ${inv.number} created for ${input.customerName}: total ${money(inv.totalMinor, inv.currency)}. It is a draft and has not been sent.`, records: [`invoice:${inv.id}`] };
    },
  }),

  record_expense: def({
    name: "record_expense",
    version: 1,
    description:
      'Propose recording an expense in a bank/cash/card account (by account name; default the first account), with optional category, vendor and cost center by name. A person must approve before it is recorded. Amount in major units (e.g. "49.90").',
    input: z
      .object({
        date,
        amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
        description: z.string().trim().min(1).max(300),
        accountName: z.string().trim().max(120).optional(),
        categoryName: z.string().trim().max(80).optional(),
        vendorName: z.string().trim().max(200).optional(),
        costCenterName: z.string().trim().max(120).optional(),
        reference: z.string().trim().max(120).optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        amount: { type: "string", description: "Major units, e.g. 49.90" },
        description: { type: "string" },
        accountName: { type: "string", description: "Bank/cash/card account name" },
        categoryName: { type: "string", description: "Expense category name" },
        vendorName: { type: "string" },
        costCenterName: { type: "string" },
        reference: { type: "string" },
      },
      required: ["date", "amount", "description"],
      additionalProperties: false,
    },
    permissions: ["finance.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 20_000,
    summarize: ({ amount, description }) => `Record an expense of ${amount}: ${description}`,
    async execute(input, { ctx, organizationId, companyId }) {
      const ci = { mode: "insensitive" as const };
      const account = await db().financeAccount.findFirst({
        where: { organizationId, companyId, archivedAt: null, ...(input.accountName ? { name: { equals: input.accountName, ...ci } } : {}) },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!account) throw new AppError("conflict", input.accountName ? `No account named "${input.accountName}"; nothing was recorded.` : "There is no bank, cash or card account yet; nothing was recorded.");
      const category = input.categoryName ? await db().financeCategory.findFirst({ where: { organizationId, companyId, kind: "EXPENSE", archivedAt: null, name: { equals: input.categoryName, ...ci } }, select: { id: true } }) : null;
      const department = input.costCenterName ? await db().department.findFirst({ where: { organizationId, companyId, archivedAt: null, name: { equals: input.costCenterName, ...ci } }, select: { id: true } }) : null;
      const vendorId = input.vendorName ? (await createCounterparty(ctx, organizationId, companyId, { name: input.vendorName, type: "VENDOR" })).id : null;
      const t = await createTransaction(
        ctx,
        organizationId,
        companyId,
        { type: "EXPENSE", date: input.date, amount: input.amount, financeAccountId: account.id, categoryId: category?.id ?? null, accountId: vendorId, departmentId: department?.id ?? null, description: input.description, reference: input.reference ?? null },
        { source: "AI" },
      );
      const notes = [input.categoryName && !category ? `category "${input.categoryName}" not found (left uncategorized)` : null, input.costCenterName && !department ? `cost center "${input.costCenterName}" not found` : null].filter(Boolean);
      return { content: `Recorded expense ${money(t.amountMinor, t.currency)} "${t.description}" on ${input.date}.${notes.length ? ` Note: ${notes.join("; ")}.` : ""}`, records: [`finance_transaction:${t.id}`] };
    },
  }),

  read_payables: def({
    name: "read_payables",
    version: 1,
    description:
      "Accounts payable: open vendor bills with the aging (not yet due, 1–30, 31–60, 61–90, 90+ days past due), the largest vendors owed, bills due in the next N days (default 30) and the count of bills waiting for approval.",
    input: z.object({ days: z.number().int().min(1).max(180).optional() }).strict(),
    modelSchema: { type: "object", properties: { days: { type: "integer", description: "Look-ahead for upcoming bills in days (default 30)" } }, required: [], additionalProperties: false },
    permissions: ["finance.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: ({ days }) => `Read accounts payable (next ${days ?? 30} days)`,
    async execute({ days }, { ctx, organizationId, companyId }) {
      const c = (await companyInfo(db(), organizationId, companyId)).baseCurrency;
      const aging = await payablesAging(ctx, organizationId, companyId);
      const [upcoming, awaiting] = await Promise.all([upcomingPayables(db(), companyId, days ?? 30), db().financeBill.count({ where: { organizationId, companyId, status: "AWAITING_APPROVAL" } })]);
      const b = aging.totals;
      const content = [
        `Open payables ${money(aging.total, c)}, of which overdue ${money(aging.overdue, c)}. Aging: not yet due ${money(b.current, c)}; 1–30 days ${money(b.d1_30, c)}; 31–60 ${money(b.d31_60, c)}; 61–90 ${money(b.d61_90, c)}; 90+ ${money(b.d90_plus, c)}.`,
        `Bills awaiting approval: ${awaiting}.`,
        `Top vendors owed:\n${aging.vendors.slice(0, 10).map((v) => `- ${v.name}: ${money(v.total, c)}`).join("\n") || "- none"}`,
        `Due in the next ${days ?? 30} days (incl. overdue):\n${upcoming.map((x) => `- ${x.vendor.name} bill ${x.number} (${x.id}) due ${dayString(x.dueDate)}${x.overdue ? " OVERDUE" : ""}: ${money(x.balanceMinor, c)}`).join("\n") || "- none"}`,
      ].join("\n");
      return { content, count: aging.bills.length, records: upcoming.map((x) => `finance_bill:${x.id}`) };
    },
  }),

  read_budget_status: def({
    name: "read_budget_status",
    version: 1,
    description: "Budget status: budget vs actual (expenses + approved vendor bills) per department for the current month or quarter, and every budget whose period includes today with its utilization.",
    input: z.object({ period: z.enum(["month", "quarter"]).optional() }).strict(),
    modelSchema: { type: "object", properties: { period: { type: "string", enum: ["month", "quarter"], description: "Department view period (default month)" } }, required: [], additionalProperties: false },
    permissions: ["finance.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: ({ period }) => `Read budget status (${period ?? "month"})`,
    async execute({ period }, { ctx, organizationId, companyId }) {
      const c = (await companyInfo(db(), organizationId, companyId)).baseCurrency;
      const w = parseBudgetWindow({ period: period ?? "month" });
      const deps = await departmentBudgets(ctx, organizationId, companyId, w);
      const today = todayUtc();
      const active = (await budgetVsActual(ctx, organizationId, companyId, { from: today, to: addDays(today, 1) })).filter((x) => x.periodStart <= today && x.periodEnd >= today);
      const content = [
        `Departments, ${w.label}: budget ${money(deps.totalBudget, c)}, actual ${money(deps.totalActual, c)}${deps.usedPct !== null ? ` (${deps.usedPct}% used)` : ""}.`,
        deps.rows.map((r) => `- ${r.name}${r.headName ? ` (head ${r.headName})` : ""}: budget ${money(r.budgetMinor, c)}, actual ${money(r.totalMinor, c)} (expenses ${money(r.transactionsMinor, c)}, bills ${money(r.billsMinor, c)})${r.usedPct !== null ? `, ${r.usedPct}% used` : ", no budget"}`).join("\n") || "- no department budgets or spend",
        `Budgets active today:`,
        active.map((x) => `- ${x.name} (${dayString(x.periodStart)} – ${dayString(x.periodEnd)}${x.category ? `, ${x.category.name}` : ""}${x.department ? `, ${x.department.name}` : ""}): ${money(x.actualMinor, c)} of ${money(x.amountMinor, c)} (${x.usedPct}%)`).join("\n") || "- none",
      ].join("\n");
      return { content, count: deps.rows.length + active.length };
    },
  }),

  create_bill_draft: def({
    name: "create_bill_draft",
    version: 1,
    description:
      'Propose a DRAFT vendor bill (accounts payable) for a vendor (existing by name, or a new one) with line items, optional expense category and cost center per line (by name). A person must approve before it is created; drafts are not posted or paid. Unit prices in major units of the company currency (e.g. "1250.00").',
    input: z
      .object({
        vendorName: z.string().trim().min(1).max(200),
        number: z.string().trim().min(1).max(60),
        issueDate: date.optional(),
        dueDate: date.optional(),
        notes: z.string().trim().max(2000).optional(),
        lines: z
          .array(
            z
              .object({
                description: z.string().trim().min(1).max(500),
                quantity: z.number().positive().max(1_000_000),
                unitPrice: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
                categoryName: z.string().trim().max(80).optional(),
                costCenterName: z.string().trim().max(120).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(50),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        vendorName: { type: "string" },
        number: { type: "string", description: "The vendor's bill/invoice number" },
        issueDate: { type: "string", description: "YYYY-MM-DD, default today" },
        dueDate: { type: "string", description: "YYYY-MM-DD, default per payment terms" },
        notes: { type: "string" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: { type: "number" },
              unitPrice: { type: "string", description: "Major units, e.g. 99.50" },
              categoryName: { type: "string", description: "Expense category name" },
              costCenterName: { type: "string", description: "Department / cost center name" },
            },
            required: ["description", "quantity", "unitPrice"],
            additionalProperties: false,
          },
        },
      },
      required: ["vendorName", "number", "lines"],
      additionalProperties: false,
    },
    permissions: ["finance.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 20_000,
    summarize: ({ vendorName, number, lines }) => `Create a draft bill ${number} from ${vendorName} (${lines.length} line${lines.length === 1 ? "" : "s"})`,
    async execute(input, { ctx, organizationId, companyId }) {
      const ci = { mode: "insensitive" as const };
      const vendor = await db().account.findFirst({ where: { organizationId, companyId, archivedAt: null, name: { equals: input.vendorName, ...ci } }, select: { id: true } });
      const missing: string[] = [];
      const lines = [];
      for (const l of input.lines) {
        const category = l.categoryName ? await db().financeCategory.findFirst({ where: { organizationId, companyId, kind: "EXPENSE", archivedAt: null, name: { equals: l.categoryName, ...ci } }, select: { id: true } }) : null;
        const department = l.costCenterName ? await db().department.findFirst({ where: { organizationId, companyId, archivedAt: null, name: { equals: l.costCenterName, ...ci } }, select: { id: true } }) : null;
        if (l.categoryName && !category) missing.push(`category "${l.categoryName}"`);
        if (l.costCenterName && !department) missing.push(`cost center "${l.costCenterName}"`);
        lines.push({ description: l.description, quantity: String(Math.round(l.quantity * 1000) / 1000), unitPrice: l.unitPrice, categoryId: category?.id ?? null, departmentId: department?.id ?? null });
      }
      const bill = await createBill(ctx, organizationId, companyId, {
        ...(vendor ? { vendorId: vendor.id } : { newVendor: { name: input.vendorName } }),
        number: input.number,
        issueDate: input.issueDate ?? dayString(todayUtc()),
        dueDate: input.dueDate,
        notes: input.notes ?? null,
        lines,
      });
      return {
        content: `Draft bill ${bill.number} from ${input.vendorName} created: total ${money(bill.totalMinor, bill.currency)}, due ${dayString(bill.dueDate)}. It is a draft: it must be submitted for approval before it is posted or paid.${missing.length ? ` Not found (left empty): ${[...new Set(missing)].join(", ")}.` : ""}`,
        records: [`finance_bill:${bill.id}`],
      };
    },
  }),

  read_financial_alerts: def({
    name: "read_financial_alerts",
    version: 1,
    description: "Everything that needs attention now: cash runway (months) and its level, the first forecast month with negative cash, overdue customer invoices and vendor bills (with days late), and budgets at 80% or more.",
    input: z.object({}).strict(),
    modelSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    permissions: ["finance.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: () => "Read financial alerts",
    async execute(_i, { ctx, organizationId, companyId }) {
      const c = (await companyInfo(db(), organizationId, companyId)).baseCurrency;
      const a = await financeAlertCenter(ctx, organizationId, companyId);
      const content = [
        `Cash ${money(a.runway.cash, c)}, net burn ${money(a.runway.netBurn, c)}/month, runway ${a.runway.months === null ? "not burning cash" : `${a.runway.months} months`}${a.runway.level ? ` (${a.runway.level})` : ""}.`,
        a.negative ? `Forecast: cash drops to ${money(a.negative.balance, c)} in ${a.negative.month} (projection, not fact).` : "Forecast: cash stays positive for the next 6 months.",
        `Overdue invoices: ${a.invoices.length} totalling ${money(a.invoicesTotal, c)}${a.invoices.length ? "\n" + a.invoices.slice(0, 15).map((i) => `- ${i.number} ${i.account.name}: ${money(i.balanceMinor, i.currency)}, ${i.daysLate} days late`).join("\n") : ""}`,
        `Overdue vendor bills: ${a.bills.length} totalling ${money(a.billsTotal, c)}${a.bills.length ? "\n" + a.bills.slice(0, 15).map((b) => `- ${b.vendor.name} ${b.number}: ${money(b.balanceMinor, b.currency)}, ${b.daysLate} days late`).join("\n") : ""}`,
        `Budgets at 80%+: ${a.overBudget.length ? a.overBudget.map((b) => `${b.name} ${b.usedPct}%`).join(", ") : "none"}`,
      ].join("\n");
      return { content, count: a.count };
    },
  }),

  read_money_flow: def({
    name: "read_money_flow",
    version: 1,
    description: "Where money came from and went in a period (income and expense ledger accounts, largest first, with profit or loss) — the data behind the money-flow diagram.",
    input: z.object({ from: date.optional(), to: date.optional() }).strict(),
    modelSchema: { type: "object", properties: { from: { type: "string", description: "YYYY-MM-DD (default: 12 months ago)" }, to: { type: "string", description: "YYYY-MM-DD exclusive (default: today)" } }, required: [], additionalProperties: false },
    permissions: ["finance.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: () => "Read the money flow",
    async execute({ from, to }, { ctx, organizationId, companyId }) {
      const c = (await companyInfo(db(), organizationId, companyId)).baseCurrency;
      const end = to ? toDay(to) : addDays(todayUtc(), 1);
      const start = from ? toDay(from) : addMonths(monthStart(todayUtc()), -11);
      const f = await moneyFlow(ctx, organizationId, companyId, { from: start, to: end });
      const line = (n: { label: string | null; key: string; amountMinor: bigint }) => `- ${n.label ?? n.key}: ${money(n.amountMinor, c)}`;
      return {
        content: `Period ${dayString(start)} to ${dayString(end)}. Income ${money(f.totalIncome, c)}, expenses ${money(f.totalExpense, c)}, net ${money(f.net, c)}.\nMoney in:\n${f.sources.map(line).join("\n") || "- none"}\nMoney out:\n${f.uses.map(line).join("\n") || "- none"}`,
      };
    },
  }),
};
