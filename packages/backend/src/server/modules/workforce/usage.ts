import { db } from "@/server/core/db";
import { costMicros } from "./pricing";

/** Start of the current UTC month. */
export const utcMonthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Tokens and estimated cost of AI tasks matching `where` since `from`, grouped by model for pricing. */
export async function tokenUsage(where: { organizationId: string; companyId: string; aiEmployeeId?: string | { in: string[] } }, from: Date, to?: Date) {
  const rows = await db().agentTask.groupBy({
    by: ["aiEmployeeId", "model"],
    where: { ...where, startedAt: { gte: from, ...(to ? { lt: to } : {}) } },
    _sum: { inputTokens: true, outputTokens: true },
  });
  const byEmployee = new Map<string | null, { tokens: number; costMicros: number }>();
  let tokens = 0;
  let cost = 0;
  for (const r of rows) {
    const i = r._sum.inputTokens ?? 0;
    const o = r._sum.outputTokens ?? 0;
    const c = costMicros(r.model, i, o);
    tokens += i + o;
    cost += c;
    const e = byEmployee.get(r.aiEmployeeId) ?? { tokens: 0, costMicros: 0 };
    e.tokens += i + o;
    e.costMicros += c;
    byEmployee.set(r.aiEmployeeId, e);
  }
  return { tokens, costMicros: cost, byEmployee };
}

/** Tokens an AI employee used this UTC month, and whether its monthly budget is used up. */
export async function employeeMonthUsage(organizationId: string, companyId: string, employee: { id: string; monthlyTokenBudget: number | null }) {
  const r = await db().agentTask.aggregate({
    where: { organizationId, companyId, aiEmployeeId: employee.id, startedAt: { gte: utcMonthStart() } },
    _sum: { inputTokens: true, outputTokens: true },
  });
  const used = (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0);
  const budget = employee.monthlyTokenBudget;
  return { used, budget, exhausted: budget !== null && used >= budget };
}
