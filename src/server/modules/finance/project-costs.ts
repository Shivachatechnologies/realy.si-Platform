import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { authorize, companyInfo, type DateRange } from "./common";
import { POSTED_BILL_STATUSES } from "./spend";

export interface ProjectCosts {
  projectId: string;
  /** Company base currency; all amounts in its minor units. */
  currency: string;
  /** Expense transactions tagged with the project (incl. approved expense claims). */
  expensesMinor: bigint;
  /** Net (ex-tax) lines of posted vendor bills tagged with the project. */
  billsMinor: bigint;
  totalCostMinor: bigint;
  /** Income transactions tagged with the project. */
  incomeMinor: bigint;
  /** Expense claims for the project still waiting for approval (not in the totals). */
  pendingClaimsMinor: bigint;
  byCategory: { categoryId: string | null; name: string | null; amountMinor: bigint }[];
  transactionCount: number;
  billLineCount: number;
}

async function costs(organizationId: string, companyId: string, projectIds: string[], range?: DateRange) {
  const txnWhere: Prisma.FinanceTransactionWhereInput = { organizationId, companyId, projectId: { in: projectIds }, ...(range ? { date: { gte: range.from, lt: range.to } } : {}) };
  const lineWhere: Prisma.FinanceBillLineWhereInput = { organizationId, companyId, projectId: { in: projectIds }, bill: { status: { in: POSTED_BILL_STATUSES }, ...(range ? { issueDate: { gte: range.from, lt: range.to } } : {}) } };
  const [txns, lines, claims] = await Promise.all([
    db().financeTransaction.groupBy({ by: ["projectId", "type", "categoryId"], where: { ...txnWhere, type: { in: ["INCOME", "EXPENSE"] } }, _sum: { amountMinor: true }, _count: true }),
    db().financeBillLine.groupBy({ by: ["projectId", "categoryId"], where: lineWhere, _sum: { netMinor: true }, _count: true }),
    db().financeExpenseClaim.groupBy({ by: ["projectId"], where: { organizationId, companyId, projectId: { in: projectIds }, status: "PENDING" }, _sum: { amountMinor: true } }),
  ]);
  const catIds = [...new Set([...txns.map((t) => t.categoryId), ...lines.map((l) => l.categoryId)].filter((x): x is string => !!x))];
  const cats = catIds.length ? await db().financeCategory.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } }) : [];
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const currency = (await companyInfo(db(), organizationId, companyId)).baseCurrency;
  return projectIds.map<ProjectCosts>((projectId) => {
    const byCat = new Map<string | null, bigint>();
    let expensesMinor = 0n;
    let incomeMinor = 0n;
    let transactionCount = 0;
    for (const t of txns.filter((x) => x.projectId === projectId)) {
      const v = t._sum.amountMinor ?? 0n;
      transactionCount += t._count;
      if (t.type === "INCOME") incomeMinor += v;
      else {
        expensesMinor += v;
        byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0n) + v);
      }
    }
    let billsMinor = 0n;
    let billLineCount = 0;
    for (const l of lines.filter((x) => x.projectId === projectId)) {
      const v = l._sum.netMinor ?? 0n;
      billsMinor += v;
      billLineCount += l._count;
      byCat.set(l.categoryId, (byCat.get(l.categoryId) ?? 0n) + v);
    }
    return {
      projectId,
      currency,
      expensesMinor,
      billsMinor,
      totalCostMinor: expensesMinor + billsMinor,
      incomeMinor,
      pendingClaimsMinor: claims.find((c) => c.projectId === projectId)?._sum.amountMinor ?? 0n,
      byCategory: [...byCat].map(([categoryId, amountMinor]) => ({ categoryId, name: categoryId ? (catName.get(categoryId) ?? null) : null, amountMinor })).sort((a, b) => (b.amountMinor > a.amountMinor ? 1 : -1)),
      transactionCount,
      billLineCount,
    };
  });
}

/**
 * Project cost totals from finance (for the work module's project budget page). Performs NO authorization: the caller
 * must already have checked access to the project (e.g. projects.read) in this organization and company.
 */
export async function financeProjectCosts(organizationId: string, companyId: string, projectId: string): Promise<ProjectCosts> {
  return (await costs(organizationId, companyId, [projectId]))[0]!;
}

/** "Project costs" report: every project with finance activity (or a budget) in the range, cost vs budget. */
export async function projectCostsReport(ctx: RequestContext, organizationId: string, companyId: string, range: DateRange) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const [txnProjects, lineProjects] = await Promise.all([
    db().financeTransaction.findMany({ where: { organizationId, companyId, projectId: { not: null }, date: { gte: range.from, lt: range.to } }, distinct: ["projectId"], select: { projectId: true } }),
    db().financeBillLine.findMany({ where: { organizationId, companyId, projectId: { not: null }, bill: { status: { in: POSTED_BILL_STATUSES }, issueDate: { gte: range.from, lt: range.to } } }, distinct: ["projectId"], select: { projectId: true } }),
  ]);
  const ids = [...new Set([...txnProjects, ...lineProjects].map((p) => p.projectId!))];
  if (!ids.length) return { rows: [], totalCost: 0n, totalIncome: 0n };
  const [projects, totals] = await Promise.all([
    db().project.findMany({ where: { id: { in: ids }, organizationId, companyId }, select: { id: true, name: true, status: true, budgetMinor: true, currency: true } }),
    costs(organizationId, companyId, ids, range),
  ]);
  const rows = projects
    .map((p) => {
      const c = totals.find((t) => t.projectId === p.id)!;
      const budget = p.budgetMinor !== null && (!p.currency || p.currency === c.currency) ? p.budgetMinor : null;
      return { ...c, name: p.name, status: p.status, budgetMinor: budget, usedPct: budget && budget > 0n ? Number((c.totalCostMinor * 10_000n) / budget) / 100 : null };
    })
    .sort((a, b) => (b.totalCostMinor > a.totalCostMinor ? 1 : -1));
  return { rows, totalCost: rows.reduce((s, r) => s + r.totalCostMinor, 0n), totalIncome: rows.reduce((s, r) => s + r.incomeMinor, 0n) };
}
