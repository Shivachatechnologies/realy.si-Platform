import { z } from "zod";
import type { RequestContext } from "@/server/core/context";
import { createTask, listSubjectTasks } from "@/server/modules/agents/service";
import { authorize } from "./common";

/** Agent tasks about the finance dashboard are attached to this subject (the company itself). */
export const INSIGHTS_SUBJECT = "finance_insights";

export const insightsInput = z.object({ focus: z.string().trim().max(1000).optional() });

/** "AI CFO insights": an ai_cfo task that reads the real figures through its tools and writes recommendations. */
export async function requestCfoInsights(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof insightsInput>) {
  const input = insightsInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "finance.read");
  const instructions = [
    "Prepare a CFO briefing for the leadership team. Call read_financial_summary (last 3 months and the year to date), read_cashflow_forecast, detect_expense_anomalies, read_invoices with status OVERDUE and read_ai_provider_costs (AI and provider spend from the cost ledger).",
    "Then write: (1) the state of the business in five bullet points with the key numbers (revenue, expenses, net profit, cash, burn rate, runway, MRR/ARR, overdue receivables, AI and provider spend); (2) risks, including unusual expenses and late payers; (3) the five most valuable actions for the next 30 days, each with its expected financial effect; (4) what data is missing to make better decisions.",
    "Do not propose creating records unless the requester asks for it.",
    input.focus ? `Additional focus from the requester: ${input.focus}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  return createTask(ctx, organizationId, companyId, { profile: "ai_cfo", title: "AI CFO insights", instructions, subject: { type: INSIGHTS_SUBJECT, id: companyId } });
}

export async function listInsightTasks(ctx: RequestContext, organizationId: string, companyId: string) {
  return listSubjectTasks(ctx, organizationId, companyId, INSIGHTS_SUBJECT, companyId, 5);
}

/** "Ask the AI CFO": free-form questions answered by an ai_cfo task from the real books. */
export const QUESTION_SUBJECT = "finance_question";

export const askInput = z.object({ question: z.string().trim().min(3).max(2000) });

export async function askCfo(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof askInput>) {
  const input = askInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "finance.read");
  const instructions = [
    `A member of the team asks: "${input.question}"`,
    "Answer from the company's real financial records only. Use read_financial_summary, read_cashflow_forecast, read_payables, read_budget_status, read_invoices, read_expenses, detect_expense_anomalies, read_ai_provider_costs or read_roi as the question needs, and quote the figures (with the currency) your answer rests on.",
    "Be concise: a direct answer first, then the supporting numbers and, when useful, one to three recommendations. If the records can't answer the question, say what is missing. Do not create or change records unless the question explicitly asks for it.",
  ].join("\n\n");
  const title = `AI CFO: ${input.question.length > 80 ? `${input.question.slice(0, 77)}…` : input.question}`;
  return createTask(ctx, organizationId, companyId, { profile: "ai_cfo", title, instructions, subject: { type: QUESTION_SUBJECT, id: companyId } });
}

export async function listQuestionTasks(ctx: RequestContext, organizationId: string, companyId: string) {
  return listSubjectTasks(ctx, organizationId, companyId, QUESTION_SUBJECT, companyId, 5);
}
