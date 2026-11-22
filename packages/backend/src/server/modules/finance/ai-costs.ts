import type { Db, Tx } from "@/server/core/db";
import { minorUnits } from "@/i18n/format";
import { addMonths, monthKey, monthStart, todayUtc, type DateRange } from "./common";

/**
 * AI and provider spend in finance (read-only view of the unified cost ledger, costs.prisma CostLedgerEntry).
 *
 * The ledger is written by the agents runtime and the costs sync job (costs/service.ts recordCost) in micro-USD, from
 * provider prices; finance never writes it. The books (journal) stay untouched: these figures are shown next to the
 * book P&L, burn and runway as an "operating view including AI and provider spend". They are added to book figures
 * only when the company's base currency is USD — there is no exchange-rate source, so for other currencies the spend
 * is reported separately in USD and never converted or invented.
 */

export const AI_SPEND_CURRENCY = "USD";

const big = (v: bigint | null | undefined) => v ?? 0n;

/** Micro-USD → minor units of the base currency; null when the base currency is not USD (not comparable). */
export function aiSpendToBase(micros: bigint, baseCurrency: string): bigint | null {
  if (baseCurrency !== AI_SPEND_CURRENCY) return null;
  const div = 10n ** BigInt(6 - minorUnits(AI_SPEND_CURRENCY));
  return (micros + div / 2n) / div;
}

const monthKeys = (from: Date, to: Date) => {
  const out: string[] = [];
  for (let m = monthStart(from); m < to; m = addMonths(m, 1)) out.push(monthKey(m));
  return out;
};

/** Recorded spend per UTC month in the range (zero-filled). */
export async function aiSpendByMonth(client: Tx | Db, organizationId: string, companyId: string, range: DateRange) {
  const where = { organizationId, companyId, occurredAt: { gte: range.from, lt: range.to } };
  const keys = monthKeys(range.from, range.to);
  const map = new Map(keys.map((k) => [k, 0n]));
  // One aggregate per month keeps the query bounded regardless of how many ledger rows exist.
  await Promise.all(
    keys.map(async (k) => {
      const from = new Date(`${k}-01T00:00:00Z`);
      const to = addMonths(from, 1);
      const r = await client.costLedgerEntry.aggregate({ where: { ...where, occurredAt: { gte: from < range.from ? range.from : from, lt: to > range.to ? range.to : to } }, _sum: { costMicros: true } });
      map.set(k, big(r._sum.costMicros));
    }),
  );
  return keys.map((month) => ({ month, micros: map.get(month)! }));
}

/** Totals and breakdowns of recorded AI and provider spend in the range. */
export async function aiSpendTotals(client: Tx | Db, organizationId: string, companyId: string, range: DateRange) {
  const where = { organizationId, companyId, occurredAt: { gte: range.from, lt: range.to } };
  const [sum, estimated, byCategory, byDepartment, byProvider, byAgent] = await Promise.all([
    client.costLedgerEntry.aggregate({ where, _sum: { costMicros: true }, _count: { _all: true } }),
    client.costLedgerEntry.aggregate({ where: { ...where, estimated: true }, _sum: { costMicros: true } }),
    client.costLedgerEntry.groupBy({ by: ["category"], where, _sum: { costMicros: true } }),
    client.costLedgerEntry.groupBy({ by: ["department"], where, _sum: { costMicros: true } }),
    client.costLedgerEntry.groupBy({ by: ["provider"], where, _sum: { costMicros: true } }),
    client.costLedgerEntry.groupBy({ by: ["aiEmployeeId"], where: { ...where, aiEmployeeId: { not: null } }, _sum: { costMicros: true } }),
  ]);
  const ids = byAgent.map((a) => a.aiEmployeeId!).slice(0, 200);
  const names = ids.length ? await client.aiEmployee.findMany({ where: { organizationId, companyId, id: { in: ids } }, select: { id: true, name: true, department: true } }) : [];
  const sorted = <T extends { micros: bigint }>(xs: T[]) => xs.sort((a, b) => (b.micros > a.micros ? 1 : b.micros < a.micros ? -1 : 0));
  return {
    micros: big(sum._sum.costMicros),
    estimatedMicros: big(estimated._sum.costMicros),
    entries: sum._count._all,
    byCategory: sorted(byCategory.map((r) => ({ key: r.category as string, micros: big(r._sum.costMicros) }))),
    byDepartment: sorted(byDepartment.map((r) => ({ key: r.department ?? "unassigned", micros: big(r._sum.costMicros) }))),
    byProvider: sorted(byProvider.map((r) => ({ key: r.provider, micros: big(r._sum.costMicros) }))),
    byAgent: sorted(
      byAgent.map((r) => {
        const e = names.find((n) => n.id === r.aiEmployeeId);
        return { id: r.aiEmployeeId!, name: e?.name ?? null, department: e?.department ?? null, micros: big(r._sum.costMicros) };
      }),
    ),
  };
}

/** Average monthly AI and provider spend over the last 3 full months (same window as the book burn rate). */
export async function aiMonthlyBurn(client: Tx | Db, organizationId: string, companyId: string, now = new Date()) {
  const end = monthStart(todayUtc(now));
  const r = await client.costLedgerEntry.aggregate({ where: { organizationId, companyId, occurredAt: { gte: addMonths(end, -3), lt: end } }, _sum: { costMicros: true } });
  return big(r._sum.costMicros) / 3n;
}

/**
 * Everything finance shows about AI and provider spend for a range, plus the operating view (book figures including
 * that spend) when it can be expressed in the base currency.
 */
export async function aiSpendView(
  client: Tx | Db,
  organizationId: string,
  companyId: string,
  baseCurrency: string,
  range: DateRange,
  book: { profit?: bigint; netBurn?: bigint; cash?: bigint } = {},
  now = new Date(),
) {
  const [totals, months, burnMicros, first] = await Promise.all([
    aiSpendTotals(client, organizationId, companyId, range),
    aiSpendByMonth(client, organizationId, companyId, range),
    aiMonthlyBurn(client, organizationId, companyId, now),
    client.costLedgerEntry.findFirst({ where: { organizationId, companyId }, orderBy: { occurredAt: "asc" }, select: { occurredAt: true } }),
  ]);
  const comparable = baseCurrency === AI_SPEND_CURRENCY;
  const totalBase = aiSpendToBase(totals.micros, baseCurrency);
  const burnBase = aiSpendToBase(burnMicros, baseCurrency);
  const profitAfterAi = comparable && book.profit !== undefined && totalBase !== null ? book.profit - totalBase : null;
  const netBurnWithAi = comparable && book.netBurn !== undefined && burnBase !== null ? book.netBurn + burnBase : null;
  const runwayWithAiMonths = comparable && netBurnWithAi !== null && netBurnWithAi > 0n && book.cash !== undefined ? Number((book.cash * 10n) / netBurnWithAi) / 10 : null;
  return {
    currency: AI_SPEND_CURRENCY,
    comparable,
    recorded: totals.entries > 0,
    since: first?.occurredAt ?? null,
    ...totals,
    months,
    monthlyBurnMicros: burnMicros,
    totalBase,
    monthlyBurnBase: burnBase,
    profitAfterAi,
    netBurnWithAi,
    runwayWithAiMonths,
  };
}

export type AiSpendView = Awaited<ReturnType<typeof aiSpendView>>;

/** "$12.34" from micro-USD (for AI tool text and CSV). */
export const usdFromMicros = (micros: bigint) => {
  const cents = (micros + 5_000n) / 10_000n;
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  return `${neg ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")} USD`;
};
