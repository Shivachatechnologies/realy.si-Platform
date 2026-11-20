import { z } from "zod";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, invalid } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { costMicros, priceFor } from "./pricing";
import { utcMonthStart } from "./usage";

/**
 * AI budgets of the workforce: per AI employee (tokens and/or estimated USD cost per UTC month) and per department
 * (all its AI employees together). They are checked when a task is created, again right before it runs, and during
 * the run (the runtime stops once the remaining allowance is spent). Platform AI controls and company/organization
 * allowances (agents/service.ts requireBudget) apply on top — a budget here can only narrow, never widen.
 */

/** Department keys (mirrors service.ts DEPARTMENTS; kept here to avoid an import cycle). */
export const BUDGET_DEPARTMENTS = ["executive", "sales", "marketing", "finance", "hr", "engineering", "product", "support", "operations", "research"] as const;

export interface BudgetLine {
  tokensUsed: number;
  tokenBudget: number | null;
  costCentsUsed: number;
  costBudgetCents: number | null;
}

export type BudgetExhaustion = { scope: "employee" | "department"; kind: "tokens" | "cost" } | null;

export interface EmployeeBudget {
  employee: BudgetLine;
  department: (BudgetLine & { department: string }) | null;
  exhausted: BudgetExhaustion;
  /** Tokens the next run may still spend before a budget is reached (conservative); null = no budget applies. */
  remainingTokens: number | null;
}

interface BudgetEmployee {
  id: string;
  department: string;
  monthlyTokenBudget: number | null;
  monthlyCostBudgetCents: bigint | null;
  model?: string | null;
}

const toCents = (micros: number) => Math.round(micros / 10_000);
const num = (v: bigint | null | undefined) => (v === null || v === undefined ? null : Number(v));

/** Tokens and estimated cost (USD cents) of tasks matching `where` this UTC month. */
async function monthSpend(where: { organizationId: string; companyId: string; aiEmployeeId?: string; aiEmployee?: { department: string } }) {
  const rows = await db().agentTask.groupBy({
    by: ["model"],
    where: { ...where, startedAt: { gte: utcMonthStart() } },
    _sum: { inputTokens: true, outputTokens: true },
  });
  let tokens = 0;
  let micros = 0;
  for (const r of rows) {
    const i = r._sum.inputTokens ?? 0;
    const o = r._sum.outputTokens ?? 0;
    tokens += i + o;
    micros += costMicros(r.model, i, o);
  }
  return { tokens, costCents: toCents(micros) };
}

function exhaustedLine(l: BudgetLine): "tokens" | "cost" | null {
  if (l.tokenBudget !== null && l.tokensUsed >= l.tokenBudget) return "tokens";
  if (l.costBudgetCents !== null && l.costCentsUsed >= l.costBudgetCents) return "cost";
  return null;
}

/** Remaining tokens of a line, converting a cost allowance with the model's (higher) output price — never optimistic. */
function remainingOf(l: BudgetLine, model: string | null | undefined): number | null {
  const parts: number[] = [];
  if (l.tokenBudget !== null) parts.push(Math.max(0, l.tokenBudget - l.tokensUsed));
  if (l.costBudgetCents !== null) {
    const p = priceFor(model);
    const perToken = Math.max(p.input, p.output); // micro-USD per token
    parts.push(Math.max(0, Math.floor(((l.costBudgetCents - l.costCentsUsed) * 10_000) / perToken)));
  }
  return parts.length ? Math.min(...parts) : null;
}

/** This month's budget position of one AI employee and its department. Callers must have authorized the read. */
export async function employeeBudget(organizationId: string, companyId: string, e: BudgetEmployee): Promise<EmployeeBudget> {
  const [mine, deptBudget] = await Promise.all([
    monthSpend({ organizationId, companyId, aiEmployeeId: e.id }),
    db().aiDepartmentBudget.findUnique({ where: { companyId_department: { companyId, department: e.department } } }),
  ]);
  const employee: BudgetLine = { tokensUsed: mine.tokens, tokenBudget: e.monthlyTokenBudget, costCentsUsed: mine.costCents, costBudgetCents: num(e.monthlyCostBudgetCents) };
  let department: EmployeeBudget["department"] = null;
  if (deptBudget && deptBudget.organizationId === organizationId && (deptBudget.monthlyTokenBudget !== null || deptBudget.monthlyCostBudgetCents !== null)) {
    const spend = await monthSpend({ organizationId, companyId, aiEmployee: { department: e.department } });
    department = { department: e.department, tokensUsed: spend.tokens, tokenBudget: deptBudget.monthlyTokenBudget, costCentsUsed: spend.costCents, costBudgetCents: num(deptBudget.monthlyCostBudgetCents) };
  }
  const empHit = exhaustedLine(employee);
  const deptHit = department ? exhaustedLine(department) : null;
  const exhausted: BudgetExhaustion = empHit ? { scope: "employee", kind: empHit } : deptHit ? { scope: "department", kind: deptHit } : null;
  const rem = [remainingOf(employee, e.model), department ? remainingOf(department, e.model) : null].filter((v): v is number => v !== null);
  return { employee, department, exhausted, remainingTokens: rem.length ? Math.min(...rem) : null };
}

/** Error code / message for an exhausted budget (shared by task creation and the worker). */
export function budgetRefusal(name: string, b: EmployeeBudget): { code: "employee_over_budget" | "department_over_budget"; reason: string; message: string } | null {
  if (!b.exhausted) return null;
  if (b.exhausted.scope === "employee") {
    return { code: "employee_over_budget", reason: "workforce_employee_over_budget", message: `${name} has used this month's ${b.exhausted.kind === "cost" ? "cost" : "token"} budget` };
  }
  return { code: "department_over_budget", reason: "workforce_department_over_budget", message: `The ${b.department?.department ?? ""} department has used this month's AI ${b.exhausted.kind === "cost" ? "cost" : "token"} budget` };
}

/** Throws not_available when the employee or its department is over budget. */
export async function assertEmployeeBudget(organizationId: string, companyId: string, e: BudgetEmployee & { name: string }) {
  const b = await employeeBudget(organizationId, companyId, e);
  const r = budgetRefusal(e.name, b);
  if (r) {
    throw new AppError("not_available", r.message, {
      reason: r.reason,
      used: r.code === "employee_over_budget" ? b.employee.tokensUsed : b.department?.tokensUsed,
      budget: r.code === "employee_over_budget" ? b.employee.tokenBudget : b.department?.tokenBudget,
    });
  }
  return b;
}

// ───────────── Department budgets ─────────────

export const departmentBudgetInput = z.object({
  department: z.enum(BUDGET_DEPARTMENTS),
  monthlyTokenBudget: z.number().int().min(1000).max(10_000_000_000).nullable(),
  /** USD cents per month. */
  monthlyCostBudgetCents: z.number().int().min(1).max(100_000_000).nullable(),
});

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "agents.read" | "agents.manage", tx?: Tx) {
  await requirePermission(ctx, permission, await companyChain(tx ?? db(), organizationId, companyId), tx);
}

export interface DepartmentBudgetRow extends BudgetLine {
  department: string;
  employees: number;
  configured: boolean;
  exhausted: "tokens" | "cost" | null;
}

/** Every department that has AI employees or a budget, with this month's spend. */
export async function listDepartmentBudgets(ctx: RequestContext, organizationId: string, companyId: string): Promise<DepartmentBudgetRow[]> {
  await authorize(ctx, organizationId, companyId, "agents.read");
  const [budgets, staff, spend] = await Promise.all([
    db().aiDepartmentBudget.findMany({ where: { organizationId, companyId } }),
    db().aiEmployee.groupBy({ by: ["department"], where: { organizationId, companyId, archivedAt: null }, _count: { _all: true } }),
    db().agentTask.findMany({
      where: { organizationId, companyId, aiEmployeeId: { not: null }, startedAt: { gte: utcMonthStart() } },
      select: { model: true, inputTokens: true, outputTokens: true, aiEmployee: { select: { department: true } } },
      take: 50_000,
    }),
  ]);
  const used = new Map<string, { tokens: number; micros: number }>();
  for (const t of spend) {
    const d = t.aiEmployee?.department;
    if (!d) continue;
    const u = used.get(d) ?? { tokens: 0, micros: 0 };
    u.tokens += (t.inputTokens ?? 0) + (t.outputTokens ?? 0);
    u.micros += costMicros(t.model, t.inputTokens ?? 0, t.outputTokens ?? 0);
    used.set(d, u);
  }
  const keys = new Set<string>([...staff.map((s) => s.department), ...budgets.map((b) => b.department)]);
  return BUDGET_DEPARTMENTS.filter((d) => keys.has(d)).map((d) => {
    const b = budgets.find((x) => x.department === d);
    const u = used.get(d) ?? { tokens: 0, micros: 0 };
    const line: BudgetLine = { tokensUsed: u.tokens, tokenBudget: b?.monthlyTokenBudget ?? null, costCentsUsed: toCents(u.micros), costBudgetCents: num(b?.monthlyCostBudgetCents) };
    return { department: d, employees: staff.find((s) => s.department === d)?._count._all ?? 0, configured: !!b, exhausted: exhaustedLine(line), ...line };
  });
}

/** Set (or, with both limits null, remove) a department's monthly AI budget. */
export async function setDepartmentBudget(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof departmentBudgetInput>) {
  const input = departmentBudgetInput.parse(raw);
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw invalid("Only a person can set budgets");
  const actorId = ctx.actor.id;
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.manage", tx);
    const before = await tx.aiDepartmentBudget.findUnique({ where: { companyId_department: { companyId, department: input.department } } });
    const oldValue = before ? { monthlyTokenBudget: before.monthlyTokenBudget, monthlyCostBudgetCents: num(before.monthlyCostBudgetCents) } : null;
    if (input.monthlyTokenBudget === null && input.monthlyCostBudgetCents === null) {
      if (before) await tx.aiDepartmentBudget.delete({ where: { id: before.id } });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ai_department_budget.removed", resourceType: "ai_department_budget", resourceId: before?.id ?? input.department, oldValue, newValue: { companyId, department: input.department } });
      return { department: input.department, removed: true };
    }
    const data = {
      monthlyTokenBudget: input.monthlyTokenBudget,
      monthlyCostBudgetCents: input.monthlyCostBudgetCents === null ? null : BigInt(input.monthlyCostBudgetCents),
      updatedById: actorId,
    };
    const row = await tx.aiDepartmentBudget.upsert({
      where: { companyId_department: { companyId, department: input.department } },
      create: { organizationId, companyId, department: input.department, ...data },
      update: data,
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "ai_department_budget.set",
      resourceType: "ai_department_budget",
      resourceId: row.id,
      oldValue,
      newValue: { companyId, department: input.department, monthlyTokenBudget: input.monthlyTokenBudget, monthlyCostBudgetCents: input.monthlyCostBudgetCents },
    });
    return { department: input.department, removed: false };
  });
}
