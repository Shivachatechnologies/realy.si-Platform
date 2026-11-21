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
import { askCfo, askInput, insightsInput, requestCfoInsights } from "./insights";
import * as AP from "./payables";
import * as AR from "./approval-rules";
import * as AQ from "./approvals";
import * as BU from "./budgets";
import * as EC from "./expense-claims";
import * as PC from "./project-costs";
import { attachmentResponse } from "./doc-attachments";
import { parseRange } from "./common";
import * as G from "./guided";
import { createInvoicePaymentLink } from "./payment-links";
import { notFound } from "@/server/core/errors";
import * as FM from "./manager";

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
add("POST", "invoices/:id/payment-link", async ({ ctx, o, c, p }) => createInvoicePaymentLink(ctx, o, c, p.id!));
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


// Accounts payable: vendor bills, bill payments, aging.
const attachmentBytes = { maxBodyBytes: Math.ceil((T.MAX_ATTACHMENT_BYTES * 4) / 3) + 16 * 1024 };
add("GET", "bills", async ({ ctx, o, c, q }) => AP.listBills(ctx, o, c, AP.parseBillFilters(q)));
add("POST", "bills", async ({ req, ctx, o, c }) => AP.createBill(ctx, o, c, await input(req, AP.billInput)), { maxBodyBytes: 256 * 1024 });
add("GET", "bills/:id", async ({ ctx, o, c, p }) => AP.getBill(ctx, o, c, p.id!));
add("PATCH", "bills/:id", async ({ req, ctx, o, c, p }) => AP.updateBill(ctx, o, c, p.id!, await input(req, AP.updateBillInput)), { maxBodyBytes: 256 * 1024 });
add("DELETE", "bills/:id", async ({ ctx, o, c, p }) => AP.deleteBill(ctx, o, c, p.id!));
add("POST", "bills/:id/submit", async ({ ctx, o, c, p }) => AP.submitBill(ctx, o, c, p.id!));
add("POST", "bills/:id/void", async ({ ctx, o, c, p }) => AP.voidBill(ctx, o, c, p.id!));
add("POST", "bills/:id/payments", async ({ req, ctx, o, c, p }) => AP.recordBillPayment(ctx, o, c, p.id!, await input(req, AP.billPaymentInput)));
add("DELETE", "bill-payments/:id", async ({ ctx, o, c, p }) => AP.deleteBillPayment(ctx, o, c, p.id!));
add("PUT", "bills/:id/attachment", async ({ req, ctx, o, c, p }) => AP.putBillAttachment(ctx, o, c, p.id!, await input(req, T.attachmentInput)), attachmentBytes);
add("DELETE", "bills/:id/attachment", async ({ ctx, o, c, p }) => AP.deleteBillAttachment(ctx, o, c, p.id!));
add("GET", "bills/:id/attachment", async ({ ctx, o, c, p }) => attachmentResponse(await AP.getBillAttachment(ctx, o, c, p.id!)));
add("GET", "payables", async ({ ctx, o, c }) => AP.payablesAging(ctx, o, c));

// Approval workflows and employee expense claims.
add("GET", "approval-rules", async ({ ctx, o, c }) => ({ data: await AR.listApprovalRules(ctx, o, c) }));
add("POST", "approval-rules", async ({ req, ctx, o, c }) => AR.createApprovalRule(ctx, o, c, await input(req, AR.approvalRuleInput)));
add("PATCH", "approval-rules/:id", async ({ req, ctx, o, c, p }) => AR.updateApprovalRule(ctx, o, c, p.id!, await input(req, AR.updateApprovalRuleInput)));
add("DELETE", "approval-rules/:id", async ({ ctx, o, c, p }) => AR.deleteApprovalRule(ctx, o, c, p.id!));
add("GET", "approvals", async ({ ctx, o, c, q }) => AQ.listApprovalRequests(ctx, o, c, AQ.parseApprovalFilters(q)));
add("POST", "approvals/:id/decision", async ({ req, ctx, o, c, p }) => AQ.decideApproval(ctx, o, c, p.id!, await input(req, AQ.decisionInput)));
const claimSubmit = EC.expenseClaimInput.extend({ receipt: T.attachmentInput.optional() });
add("GET", "expense-claims", async ({ ctx, o, c, q }) => EC.listExpenseClaims(ctx, o, c, EC.parseClaimFilters(q)));
add(
  "POST",
  "expense-claims",
  async ({ req, ctx, o, c }) => {
    const { receipt, ...claim } = await input(req, claimSubmit);
    return EC.submitExpenseClaim(ctx, o, c, claim, receipt);
  },
  attachmentBytes,
);
add("GET", "expense-claims/:id", async ({ ctx, o, c, p }) => EC.getExpenseClaim(ctx, o, c, p.id!));
add("DELETE", "expense-claims/:id", async ({ ctx, o, c, p }) => EC.withdrawExpenseClaim(ctx, o, c, p.id!));
add("PUT", "expense-claims/:id/receipt", async ({ req, ctx, o, c, p }) => EC.putClaimReceipt(ctx, o, c, p.id!, await input(req, T.attachmentInput)), attachmentBytes);
add("GET", "expense-claims/:id/receipt", async ({ ctx, o, c, p }) => attachmentResponse(await EC.getClaimReceipt(ctx, o, c, p.id!)));

// Department budgets and project costs.
add("GET", "department-budgets", async ({ ctx, o, c, q }) => BU.departmentBudgets(ctx, o, c, BU.parseBudgetWindow(q)));
add("GET", "department-budgets/:id", async ({ ctx, o, c, p, q }) => BU.departmentSpendDetail(ctx, o, c, p.id!, BU.parseBudgetWindow(q)));
add("GET", "project-costs", async ({ ctx, o, c, q }) => PC.projectCostsReport(ctx, o, c, parseRange(q)));

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
// Finance OS beginner flows.
const flowOf = (v: string | undefined) => G.parseFlow(v) ?? (() => { throw notFound("Flow"); })();
add("POST", "guided/help", async ({ req, ctx, o, c }) => G.financeHelp(ctx, o, c, await input(req, G.financeHelpInput)));
add("GET", "guided/summary", async ({ ctx, o, c }) => G.financeSnapshot(ctx, o, c));
add("GET", "guided/options", async ({ ctx, o, c }) => G.guidedOptions(ctx, o, c));
add("GET", "guided/progress/:flow", async ({ ctx, o, c, p }) => G.getFlowProgress(ctx, o, c, flowOf(p.flow)));
add("PUT", "guided/progress/:flow", async ({ req, ctx, o, c, p }) => G.saveFlowProgress(ctx, o, c, flowOf(p.flow), await input(req, G.flowProgressInput)));
add("POST", "ask", async ({ req, ctx, o, c }) => askCfo(ctx, o, c, await input(req, askInput)));

// AI Finance Manager desk: memo, revenue forecast, categorisation suggestions, budget variance explanations.
add("POST", "manager/memo", async ({ req, ctx, o, c }) => FM.requestFinanceMemo(ctx, o, c, await input(req, FM.memoInput)));
add("GET", "manager/revenue-forecast", async ({ ctx, o, c, q }) => FM.revenueForecast(ctx, o, c, Number(q.months) || 6));
add("GET", "manager/category-suggestions", async ({ ctx, o, c }) => FM.expenseCategorySuggestions(ctx, o, c));
add("POST", "manager/category-suggestions/:id/apply", async ({ req, ctx, o, c, p }) => FM.applyExpenseCategory(ctx, o, c, p.id!, await input(req, FM.applyCategoryInput)));
add("GET", "manager/budget-variance", async ({ ctx, o, c }) => ({ data: await FM.budgetVarianceExplanations(ctx, o, c) }));

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
