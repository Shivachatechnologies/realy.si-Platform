import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, json, route, type HandlerArgs } from "@/server/core/http";
import { newRequestId } from "@/server/core/context";
import * as A from "./analytics";
import * as B from "./billing";
import * as L from "./ledger";
import * as S from "./setup";
import * as T from "./transactions";
import { insightsInput, requestCfoInsights } from "./insights";
import { parseRange } from "./common";

/**
 * Finance REST API: /api/v1/organizations/:orgId/companies/:companyId/finance/<path>. Each entry is wrapped with route()
 * (auth, CSRF, rate limits, idempotency for POST, error envelope) and dispatched by the catch-all route handler.
 */
type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
type Params = Record<string, string> & { orgId: string; companyId: string };
type Handler = (a: HandlerArgs & { o: string; c: string; p: Params; q: Record<string, string> }) => Promise<unknown>;

interface Entry {
  method: Method;
  pattern: string[];
  run: ReturnType<typeof route<Params>>;
}

const entries: Entry[] = [];

function add(method: Method, pattern: string, handler: Handler, opts: { maxBodyBytes?: number } = {}) {
  const run = route<Params>(
    {
      auth: "required",
      name: `${method} /organizations/:orgId/companies/:companyId/finance/${pattern}`,
      ...(method === "GET" ? {} : { rateLimits: LIMITS.tenantWrite }),
      ...(method === "POST" ? { idempotent: true } : {}),
      ...(opts.maxBodyBytes ? { maxBodyBytes: opts.maxBodyBytes } : {}),
    },
    async (args, p) => handler({ ...args, o: p.orgId, c: p.companyId, p, q: Object.fromEntries(args.req.nextUrl.searchParams) }),
  );
  entries.push({ method, pattern: pattern.split("/"), run });
}

const input = <S extends z.ZodType>(req: NextRequest, schema: S) => body(req, schema);
const csv = (text: string, name: string) =>
  new Response(text, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });

// Setup: accounts, categories, tax rates, counterparties, cost centers, settings.
add("GET", "accounts", async ({ ctx, o, c }) => ({ data: await S.listFinanceAccounts(ctx, o, c, { includeArchived: true }) }));
add("POST", "accounts", async ({ req, ctx, o, c }) => S.createFinanceAccount(ctx, o, c, await input(req, S.financeAccountInput)));
add("PATCH", "accounts/:id", async ({ req, ctx, o, c, p }) => S.updateFinanceAccount(ctx, o, c, p.id!, await input(req, S.updateFinanceAccountInput)));
add("GET", "categories", async ({ ctx, o, c }) => ({ data: await S.listCategories(ctx, o, c, { includeArchived: true }) }));
add("POST", "categories", async ({ req, ctx, o, c }) => S.createCategory(ctx, o, c, await input(req, S.categoryInput)));
add("PATCH", "categories/:id", async ({ req, ctx, o, c, p }) => S.updateCategory(ctx, o, c, p.id!, await input(req, S.updateCategoryInput)));
add("GET", "tax-rates", async ({ ctx, o, c }) => ({ data: await S.listTaxRates(ctx, o, c, { includeArchived: true }) }));
add("POST", "tax-rates", async ({ req, ctx, o, c }) => S.createTaxRate(ctx, o, c, await input(req, S.taxRateInput)));
add("PATCH", "tax-rates/:id", async ({ req, ctx, o, c, p }) => S.updateTaxRate(ctx, o, c, p.id!, await input(req, S.updateTaxRateInput)));
add("GET", "counterparties", async ({ ctx, o, c, q }) => ({ data: await S.listCounterparties(ctx, o, c, q.type === "VENDOR" ? "VENDOR" : "CUSTOMER", { q: q.q?.slice(0, 200), take: 50 }) }));
add("POST", "counterparties", async ({ req, ctx, o, c }) => S.createCounterparty(ctx, o, c, await input(req, S.counterpartyInput)));
add("PATCH", "counterparties/:id", async ({ req, ctx, o, c, p }) => S.updateCounterparty(ctx, o, c, p.id!, await input(req, S.counterpartyInput.partial())));
add("POST", "cost-centers", async ({ req, ctx, o, c }) => S.createCostCenter(ctx, o, c, await input(req, S.costCenterInput)));
add("PUT", "settings", async ({ req, ctx, o, c }) => S.updateFinanceSettings(ctx, o, c, await input(req, S.settingsInput)));

// Transactions.
add("GET", "transactions", async ({ ctx, o, c, q }) => T.listTransactions(ctx, o, c, T.parseTxnFilters(q)));
add("POST", "transactions", async ({ req, ctx, o, c }) => T.createTransaction(ctx, o, c, await input(req, T.transactionInput)));
add("GET", "transactions/export", async ({ ctx, o, c, q }) => csv(await T.exportTransactionsCsv(ctx, o, c, T.parseTxnFilters(q)), "transactions.csv"));
add("POST", "transactions/import", async ({ req, ctx, o, c }) => T.importTransactionsCsv(ctx, o, c, await input(req, T.importInput)), { maxBodyBytes: 2_100_000 });
add("GET", "transactions/:id", async ({ ctx, o, c, p }) => T.getTransaction(ctx, o, c, p.id!));
add("PATCH", "transactions/:id", async ({ req, ctx, o, c, p }) => T.updateTransaction(ctx, o, c, p.id!, await input(req, T.updateTransactionInput)));
add("DELETE", "transactions/:id", async ({ ctx, o, c, p }) => T.deleteTransaction(ctx, o, c, p.id!));
add("PUT", "transactions/:id/attachment", async ({ req, ctx, o, c, p }) => T.putAttachment(ctx, o, c, p.id!, await input(req, T.attachmentInput)), { maxBodyBytes: Math.ceil((T.MAX_ATTACHMENT_BYTES * 4) / 3) + 16 * 1024 });
add("DELETE", "transactions/:id/attachment", async ({ ctx, o, c, p }) => T.deleteAttachment(ctx, o, c, p.id!));
add("GET", "transactions/:id/attachment", async ({ ctx, o, c, p }) => {
  const a = await T.getAttachment(ctx, o, c, p.id!);
  const inline = a.contentType === "application/pdf" || a.contentType.startsWith("image/");
  return new Response(new Uint8Array(a.data), {
    headers: {
      "content-type": a.contentType,
      "content-length": String(a.sizeBytes),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "cache-control": "private, no-store",
    },
  });
});

// Recurring expenses, budgets, reconciliations.
add("POST", "recurring-expenses", async ({ req, ctx, o, c }) => T.createRecurringExpense(ctx, o, c, await input(req, T.recurringExpenseInput)));
add("PATCH", "recurring-expenses/:id", async ({ req, ctx, o, c, p }) => T.updateRecurringExpense(ctx, o, c, p.id!, await input(req, T.updateRecurringExpenseInput)));
add("DELETE", "recurring-expenses/:id", async ({ ctx, o, c, p }) => T.deleteRecurringExpense(ctx, o, c, p.id!));
add("GET", "budgets", async ({ ctx, o, c }) => ({ data: await T.budgetVsActual(ctx, o, c) }));
add("POST", "budgets", async ({ req, ctx, o, c }) => T.createBudget(ctx, o, c, await input(req, T.budgetInput)));
add("PATCH", "budgets/:id", async ({ req, ctx, o, c, p }) => T.updateBudget(ctx, o, c, p.id!, await input(req, T.updateBudgetInput)));
add("DELETE", "budgets/:id", async ({ ctx, o, c, p }) => T.deleteBudget(ctx, o, c, p.id!));
add("POST", "reconciliations", async ({ req, ctx, o, c }) => T.startReconciliation(ctx, o, c, await input(req, T.reconciliationInput)));
add("GET", "reconciliations/:id", async ({ ctx, o, c, p }) => T.getReconciliation(ctx, o, c, p.id!));
add("PATCH", "reconciliations/:id", async ({ req, ctx, o, c, p }) => T.updateReconciliation(ctx, o, c, p.id!, await input(req, T.reconciliationUpdateInput)));
add("DELETE", "reconciliations/:id", async ({ ctx, o, c, p }) => T.cancelReconciliation(ctx, o, c, p.id!));

// Accounting.
add("GET", "ledger-accounts", async ({ ctx, o, c }) => ({ data: await L.listLedgerAccounts(ctx, o, c, { includeArchived: true }) }));
add("POST", "ledger-accounts", async ({ req, ctx, o, c }) => L.createLedgerAccount(ctx, o, c, await input(req, L.ledgerAccountInput)));
add("PATCH", "ledger-accounts/:id", async ({ req, ctx, o, c, p }) => L.updateLedgerAccount(ctx, o, c, p.id!, await input(req, L.updateLedgerAccountInput)));
add("GET", "journal", async ({ ctx, o, c, q }) => L.listJournalEntries(ctx, o, c, { q: q.q, page: Math.max(1, Number(q.page) || 1) }));
add("POST", "journal", async ({ req, ctx, o, c }) => L.createJournalEntry(ctx, o, c, await input(req, L.journalInput)));
add("GET", "journal/:id", async ({ ctx, o, c, p }) => L.getJournalEntry(ctx, o, c, p.id!));
add("PATCH", "journal/:id", async ({ req, ctx, o, c, p }) => L.updateJournalEntry(ctx, o, c, p.id!, await input(req, L.journalInput)));
add("DELETE", "journal/:id", async ({ ctx, o, c, p }) => L.deleteJournalEntry(ctx, o, c, p.id!));
add("POST", "journal/:id/post", async ({ ctx, o, c, p }) => L.postJournalEntry(ctx, o, c, p.id!));
add("POST", "journal/:id/reverse", async ({ ctx, o, c, p }) => L.reverseJournalEntry(ctx, o, c, p.id!));
add("POST", "periods", async ({ req, ctx, o, c }) => L.createPeriod(ctx, o, c, await input(req, L.periodInput)));
add("PATCH", "periods/:id", async ({ req, ctx, o, c, p }) => L.setPeriodStatus(ctx, o, c, p.id!, await input(req, z.object({ status: z.enum(["OPEN", "CLOSED"]) }))));
add("DELETE", "periods/:id", async ({ ctx, o, c, p }) => L.deletePeriod(ctx, o, c, p.id!));

// Billing.
add("GET", "invoices", async ({ ctx, o, c, q }) => B.listInvoices(ctx, o, c, B.parseInvoiceFilters(q)));
add("POST", "invoices", async ({ req, ctx, o, c }) => B.createInvoice(ctx, o, c, await input(req, B.invoiceInput)), { maxBodyBytes: 256 * 1024 });
add("GET", "invoices/:id", async ({ ctx, o, c, p }) => B.getInvoice(ctx, o, c, p.id!));
add("PATCH", "invoices/:id", async ({ req, ctx, o, c, p }) => B.updateInvoice(ctx, o, c, p.id!, await input(req, B.updateInvoiceInput)), { maxBodyBytes: 256 * 1024 });
add("DELETE", "invoices/:id", async ({ ctx, o, c, p }) => B.deleteInvoice(ctx, o, c, p.id!));
add("POST", "invoices/:id/mark-sent", async ({ ctx, o, c, p }) => B.markInvoiceSent(ctx, o, c, p.id!));
add("POST", "invoices/:id/send", async ({ req, ctx, o, c, p }) => B.emailInvoice(ctx, o, c, p.id!, "INVOICE", await input(req, B.sendInput)));
add("POST", "invoices/:id/remind", async ({ req, ctx, o, c, p }) => B.emailInvoice(ctx, o, c, p.id!, "REMINDER", await input(req, B.sendInput)));
add("POST", "invoices/:id/void", async ({ ctx, o, c, p }) => B.voidInvoice(ctx, o, c, p.id!));
add("POST", "invoices/:id/payments", async ({ req, ctx, o, c, p }) => B.recordPayment(ctx, o, c, p.id!, await input(req, B.paymentInput)));
add("DELETE", "payments/:id", async ({ ctx, o, c, p }) => B.deletePayment(ctx, o, c, p.id!));
add("GET", "estimates", async ({ ctx, o, c, q }) => B.listEstimates(ctx, o, c, { q: q.q, page: Math.max(1, Number(q.page) || 1) }));
add("POST", "estimates", async ({ req, ctx, o, c }) => B.createEstimate(ctx, o, c, await input(req, B.estimateInput)), { maxBodyBytes: 256 * 1024 });
add("GET", "estimates/:id", async ({ ctx, o, c, p }) => B.getEstimate(ctx, o, c, p.id!));
add("PATCH", "estimates/:id", async ({ req, ctx, o, c, p }) => B.updateEstimate(ctx, o, c, p.id!, await input(req, B.updateEstimateInput)), { maxBodyBytes: 256 * 1024 });
add("DELETE", "estimates/:id", async ({ ctx, o, c, p }) => B.deleteEstimate(ctx, o, c, p.id!));
add("POST", "estimates/:id/status", async ({ req, ctx, o, c, p }) => B.setEstimateStatus(ctx, o, c, p.id!, await input(req, z.object({ status: z.enum(["DRAFT", "SENT", "ACCEPTED", "DECLINED"]) }))));
add("POST", "estimates/:id/convert", async ({ ctx, o, c, p }) => B.convertEstimate(ctx, o, c, p.id!));
add("POST", "estimates/:id/send", async ({ req, ctx, o, c, p }) => B.emailEstimate(ctx, o, c, p.id!, await input(req, B.sendInput)));
add("GET", "recurring-invoices", async ({ ctx, o, c }) => ({ data: await B.listRecurringInvoices(ctx, o, c) }));
add("POST", "recurring-invoices", async ({ req, ctx, o, c }) => B.createRecurringInvoice(ctx, o, c, await input(req, B.recurringInvoiceInput)), { maxBodyBytes: 256 * 1024 });
add("PATCH", "recurring-invoices/:id", async ({ req, ctx, o, c, p }) => B.updateRecurringInvoice(ctx, o, c, p.id!, await input(req, B.updateRecurringInvoiceInput)), { maxBodyBytes: 256 * 1024 });
add("DELETE", "recurring-invoices/:id", async ({ ctx, o, c, p }) => B.deleteRecurringInvoice(ctx, o, c, p.id!));
add("POST", "recurring-invoices/:id/run", async ({ ctx, o, c, p }) => B.runRecurringInvoiceNow(ctx, o, c, p.id!));
add("POST", "credit-notes", async ({ req, ctx, o, c }) => B.createCreditNote(ctx, o, c, await input(req, B.creditNoteInput)));
add("POST", "credit-notes/:id/apply", async ({ req, ctx, o, c, p }) => B.applyCreditNote(ctx, o, c, p.id!, await input(req, B.applyCreditInput)));
add("POST", "credit-notes/:id/void", async ({ ctx, o, c, p }) => B.voidCreditNote(ctx, o, c, p.id!));
add("GET", "receivables", async ({ ctx, o, c }) => B.receivablesAging(ctx, o, c));

// Cash flow, scenarios, reports, AI.
add("GET", "dashboard", async ({ ctx, o, c, q }) => A.financeDashboard(ctx, o, c, parseRange(q)));
add("GET", "anomalies", async ({ ctx, o, c }) => ({ data: await A.detectExpenseAnomalies(ctx, o, c) }));
add("POST", "plan-items", async ({ req, ctx, o, c }) => A.createPlanItem(ctx, o, c, await input(req, A.planItemInput)));
add("PATCH", "plan-items/:id", async ({ req, ctx, o, c, p }) => A.updatePlanItem(ctx, o, c, p.id!, await input(req, A.planItemInput.partial())));
add("DELETE", "plan-items/:id", async ({ ctx, o, c, p }) => A.deletePlanItem(ctx, o, c, p.id!));
add("GET", "scenarios", async ({ ctx, o, c }) => A.projectScenarios(ctx, o, c));
add("POST", "scenarios", async ({ req, ctx, o, c }) => A.createScenario(ctx, o, c, await input(req, A.scenarioInput)));
add("PATCH", "scenarios/:id", async ({ req, ctx, o, c, p }) => A.updateScenario(ctx, o, c, p.id!, await input(req, A.scenarioInput)));
add("DELETE", "scenarios/:id", async ({ ctx, o, c, p }) => A.deleteScenario(ctx, o, c, p.id!));
add("GET", "reports/:report", async ({ ctx, o, c, p, q }) => csv(await A.reportCsv(ctx, o, c, A.parseReport(p.report), parseRange(q)), `${A.parseReport(p.report)}.csv`));
add("POST", "insights", async ({ req, ctx, o, c }) => requestCfoInsights(ctx, o, c, await input(req, insightsInput)));

function match(method: string, path: string[]) {
  for (const e of entries) {
    if (e.method !== method || e.pattern.length !== path.length) continue;
    const named: Record<string, string> = {};
    if (e.pattern.every((seg, i) => (seg.startsWith(":") ? ((named[seg.slice(1)] = path[i]!), true) : seg === path[i]))) return { entry: e, named };
  }
  return null;
}

type RouteCtx = { params: Promise<{ orgId: string; companyId: string; path: string[] }> };

export function dispatch(method: Method) {
  return async (req: NextRequest, routeCtx: RouteCtx): Promise<Response> => {
    const { orgId, companyId, path } = await routeCtx.params;
    const m = match(method, path);
    if (!m) {
      const requestId = newRequestId(req.headers.get("x-request-id"));
      return json({ error: { code: "not_found", message: "Not found", requestId } }, { status: 404, requestId });
    }
    return m.entry.run(req, { params: Promise.resolve({ ...m.named, orgId, companyId } as Params) });
  };
}
