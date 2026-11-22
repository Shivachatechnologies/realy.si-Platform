import { z } from "zod";
import { db } from "@/server/core/db";
import { fromMinor, toMinor } from "@/server/modules/finance/common";

/**
 * Budgets of goals and initiatives (G1, B15). A budget is an amount in a currency the founder sets; "actual" is what the
 * work for it really cost — the AI and provider spend in the cost ledger of every agent task that worked on it (the
 * goal's AI plan, its objectives' milestone tasks and command runs, an initiative's command runs). The ledger is in
 * USD, so budget-vs-actual is only compared when the budget is in USD; otherwise both are shown side by side.
 */

export const budgetInput = z
  .object({
    amount: z.string().trim().regex(/^\d{1,12}(\.\d{1,4})?$/, "Use a positive amount, e.g. 5000 or 5000.50"),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .nullable()
  .optional();

/** Columns for a budget input (undefined = unchanged, null = cleared). */
export function budgetColumns(b: z.output<typeof budgetInput>): { budgetMinor: bigint | null; budgetCurrency: string | null } | Record<string, never> {
  if (b === undefined) return {};
  if (b === null) return { budgetMinor: null, budgetCurrency: null };
  return { budgetMinor: toMinor(b.amount, b.currency), budgetCurrency: b.currency };
}

export interface BudgetStatus {
  budget: { amount: string; amountMinor: string; currency: string } | null;
  /** AI and provider spend of the work (USD). */
  actual: { micros: number; usd: string; tasks: number };
  /** Share of the budget used (USD budgets only), else null. */
  usedPct: number | null;
  over: boolean;
}

async function spendOf(companyId: string, taskIds: string[]): Promise<{ micros: number; tasks: number }> {
  if (!taskIds.length) return { micros: 0, tasks: 0 };
  const r = await db().costLedgerEntry.aggregate({ where: { companyId, taskId: { in: taskIds } }, _sum: { costMicros: true } });
  return { micros: Number(r._sum.costMicros ?? 0n), tasks: taskIds.length };
}

function status(budgetMinor: bigint | null, currency: string | null, spend: { micros: number; tasks: number }): BudgetStatus {
  const usd = (spend.micros / 1_000_000).toFixed(2);
  const budget = budgetMinor !== null && currency ? { amount: fromMinor(budgetMinor, currency), amountMinor: budgetMinor.toString(), currency } : null;
  const comparable = budget && currency === "USD" && budgetMinor! > 0n;
  const usedPct = comparable ? Math.round((spend.micros / 10_000 / Number(budgetMinor)) * 100) : null;
  return { budget, actual: { micros: spend.micros, usd, tasks: spend.tasks }, usedPct, over: usedPct !== null && usedPct > 100 };
}

/** Agent tasks of command runs (their plan steps and everything those steps delegated). */
async function runTaskIds(scope: { organizationId: string; companyId: string }, runIds: string[]): Promise<string[]> {
  if (!runIds.length) return [];
  const steps = await db().commandPlanStep.findMany({ where: { ...scope, runId: { in: runIds }, taskId: { not: null } }, select: { taskId: true } });
  const ids = steps.map((s) => s.taskId!).filter(Boolean);
  // Delegated children (depth ≤ 2).
  let frontier = ids;
  for (let i = 0; i < 2 && frontier.length; i++) {
    const kids = await db().agentTask.findMany({ where: { ...scope, parentTaskId: { in: frontier } }, select: { id: true } });
    frontier = kids.map((k) => k.id).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  return ids;
}

/** Budget vs actual for goals (callers have authorized objectives.read for the company). */
export async function goalBudgets(scope: { organizationId: string; companyId: string }, goals: { id: string; budgetMinor: bigint | null; budgetCurrency: string | null; planTaskId: string | null }[]): Promise<Map<string, BudgetStatus>> {
  const out = new Map<string, BudgetStatus>();
  for (const g of goals) {
    const objectives = await db().objective.findMany({ where: { ...scope, goalId: g.id }, select: { id: true, milestones: { select: { id: true } } } });
    const objectiveIds = objectives.map((o) => o.id);
    const milestoneIds = objectives.flatMap((o) => o.milestones.map((m) => m.id));
    const [runs, initiatives, direct] = await Promise.all([
      objectiveIds.length ? db().commandRun.findMany({ where: { ...scope, objectiveId: { in: objectiveIds } }, select: { id: true } }) : [],
      objectiveIds.length ? db().objectiveInitiative.findMany({ where: { ...scope, objectiveId: { in: objectiveIds }, commandRunId: { not: null } }, select: { commandRunId: true } }) : [],
      db().agentTask.findMany({ where: { ...scope, OR: [{ subjectType: "company_goal", subjectId: g.id }, ...(milestoneIds.length ? [{ milestoneId: { in: milestoneIds } }] : []), ...(g.planTaskId ? [{ id: g.planTaskId }] : [])] }, select: { id: true } }),
    ]);
    const runIds = [...new Set([...runs.map((r) => r.id), ...initiatives.map((i) => i.commandRunId!)])];
    const taskIds = [...new Set([...direct.map((t) => t.id), ...(await runTaskIds(scope, runIds))])];
    out.set(g.id, status(g.budgetMinor, g.budgetCurrency, await spendOf(scope.companyId, taskIds)));
  }
  return out;
}

/** Budget vs actual for one initiative (its command runs' tasks). */
export async function initiativeBudget(scope: { organizationId: string; companyId: string }, i: { budgetMinor: bigint | null; budgetCurrency: string | null; commandRunId: string | null }): Promise<BudgetStatus> {
  const taskIds = await runTaskIds(scope, i.commandRunId ? [i.commandRunId] : []);
  return status(i.budgetMinor, i.budgetCurrency, await spendOf(scope.companyId, taskIds));
}
