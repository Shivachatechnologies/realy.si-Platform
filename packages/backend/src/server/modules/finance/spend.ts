import type { Prisma } from "@/generated/prisma/client";
import type { FinanceBillStatus } from "@/generated/prisma/enums";
import type { Db, Tx } from "@/server/core/db";

/** Bills that are in the books (approval posted Dr Expense / Cr AP). */
export const POSTED_BILL_STATUSES: FinanceBillStatus[] = ["APPROVED", "PARTIALLY_PAID", "PAID"];
/** Bills that still owe money to the vendor. */
export const OPEN_BILL_STATUSES: FinanceBillStatus[] = ["APPROVED", "PARTIALLY_PAID"];

export interface SpendWindow {
  from: Date;
  /** Exclusive. */
  to: Date;
  departmentId?: string | null;
  categoryId?: string | null;
  projectId?: string | null;
}

/**
 * Accrual spend in a window: expense transactions (excluding bill-payment mirrors, which settle AP and are not new spend)
 * plus the net (ex-tax) lines of posted vendor bills by bill date. No authorization: callers authorize.
 */
export async function spendActual(client: Tx | Db, companyId: string, w: SpendWindow) {
  const scope = {
    ...(w.departmentId ? { departmentId: w.departmentId } : {}),
    ...(w.categoryId ? { categoryId: w.categoryId } : {}),
    ...(w.projectId ? { projectId: w.projectId } : {}),
  };
  const [txn, bills] = await Promise.all([
    client.financeTransaction.aggregate({ where: { companyId, type: "EXPENSE", billPaymentId: null, date: { gte: w.from, lt: w.to }, ...scope }, _sum: { amountMinor: true } }),
    client.financeBillLine.aggregate({ where: { companyId, ...scope, bill: { status: { in: POSTED_BILL_STATUSES }, issueDate: { gte: w.from, lt: w.to } } }, _sum: { netMinor: true } }),
  ]);
  const transactionsMinor = txn._sum.amountMinor ?? 0n;
  const billsMinor = bills._sum.netMinor ?? 0n;
  return { transactionsMinor, billsMinor, totalMinor: transactionsMinor + billsMinor };
}

/** Open AP balance (approved bills not fully paid), optionally only those due before `dueBefore`. */
export async function openPayables(client: Tx | Db, companyId: string, opts: { dueBefore?: Date } = {}) {
  const where: Prisma.FinanceBillWhereInput = { companyId, status: { in: OPEN_BILL_STATUSES }, ...(opts.dueBefore ? { dueDate: { lt: opts.dueBefore } } : {}) };
  const agg = await client.financeBill.aggregate({ where, _sum: { totalMinor: true, paidMinor: true } });
  return (agg._sum.totalMinor ?? 0n) - (agg._sum.paidMinor ?? 0n);
}
