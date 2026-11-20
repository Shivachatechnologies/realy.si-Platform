import type { RequestContext } from "@/server/core/context";
import type { DateRange } from "./common";
import { profitAndLossReport } from "./analytics";

/**
 * Money flow for the "where does the money come from and go" diagram: income accounts → the company → expense accounts
 * (+ profit kept, or the loss covered from savings), from posted journal lines in the range (the P&L). Small streams are
 * grouped into "other" so the picture stays readable; every number is a real ledger total.
 */
export interface FlowNode {
  key: string;
  label: string | null;
  amountMinor: bigint;
  kind: "income" | "expense" | "profit" | "loss" | "other_income" | "other_expense";
}

const TOP = 6;

function group(rows: { id: string; name: string; amountMinor: bigint }[], kind: "income" | "expense"): FlowNode[] {
  const positive = rows.filter((r) => r.amountMinor > 0n).sort((a, b) => (b.amountMinor > a.amountMinor ? 1 : b.amountMinor < a.amountMinor ? -1 : 0));
  const head = positive.slice(0, TOP).map((r) => ({ key: r.id, label: r.name, amountMinor: r.amountMinor, kind }) as FlowNode);
  const rest = positive.slice(TOP);
  if (rest.length) head.push({ key: `other_${kind}`, label: null, amountMinor: rest.reduce((s, r) => s + r.amountMinor, 0n), kind: kind === "income" ? "other_income" : "other_expense" });
  return head;
}

export async function moneyFlow(ctx: RequestContext, organizationId: string, companyId: string, range: DateRange) {
  const pnl = await profitAndLossReport(ctx, organizationId, companyId, range);
  const sources = group(pnl.income, "income");
  const uses = group(pnl.expense, "expense");
  const totalIn = sources.reduce((s, n) => s + n.amountMinor, 0n);
  const totalOut = uses.reduce((s, n) => s + n.amountMinor, 0n);
  // Balance both sides: profit is kept money (right side); a loss is money taken from savings (left side).
  if (totalIn > totalOut) uses.push({ key: "profit", label: null, amountMinor: totalIn - totalOut, kind: "profit" });
  else if (totalOut > totalIn) sources.push({ key: "loss", label: null, amountMinor: totalOut - totalIn, kind: "loss" });
  return { sources, uses, totalIncome: pnl.totalIncome, totalExpense: pnl.totalExpense, net: pnl.net, scale: totalIn > totalOut ? totalIn : totalOut };
}
