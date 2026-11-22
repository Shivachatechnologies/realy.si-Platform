import { z } from "zod";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { createTask, listSubjectTasks } from "@/server/modules/agents/service";
import { addDays, addMonths, authorize, companyInfo, fromMinor, monthKey, monthStart, todayUtc } from "./common";
import { burnRate, cashBalance, overdueReceivables, profitAndLossTotals, recurringRevenue } from "./analytics";
import { openPayables } from "./spend";
import { budgetVsActual } from "./transactions";
import { aiSpendView, usdFromMicros } from "./ai-costs";
import { roiAnalytics } from "./roi";

/**
 * Monthly CFO pack (GAP-MATRIX 6.7): P&L vs the previous month, cash at the start and end of the month, burn and
 * runway, budget variance, AI and provider spend, ROI and open receivables/payables — computed from the books and
 * the cost ledger only. `cfoMonthlyPack` returns the figures (and a Markdown rendering); `requestCfoMonthlyPack`
 * asks the AI CFO to write the commentary on top of it. Schedulers (the workforce schedule presets) use
 * CFO_MONTHLY_PACK_PRESET, whose instructions make the AI CFO call read_cfo_monthly_pack for the last full month.
 */

export const MONTHLY_PACK_SUBJECT = "finance_monthly_pack";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const monthlyPackInput = z.object({ month: z.string().regex(MONTH).optional() });

/** The month a pack covers: the given YYYY-MM, else the last full month. Never a month in the future. */
export function packMonth(month: string | undefined, now = new Date()) {
  const current = monthStart(todayUtc(now));
  const from = month && MONTH.test(month) ? new Date(`${month}-01T00:00:00Z`) : addMonths(current, -1);
  const safe = from > current ? addMonths(current, -1) : from;
  const to = addMonths(safe, 1);
  return { month: monthKey(safe), from: safe, to, partial: to > current, prev: { from: addMonths(safe, -1), to: safe } };
}

const pct = (a: bigint, b: bigint) => (b !== 0n ? Number(((a - b) * 1000n) / (b < 0n ? -b : b)) / 10 : null);

export async function cfoMonthlyPack(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof monthlyPackInput> = {}, now = new Date()) {
  const pack = await buildPack(ctx, organizationId, companyId, raw, now);
  return { ...pack, markdown: packMarkdown(pack) };
}

async function buildPack(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof monthlyPackInput>, now: Date) {
  const input = monthlyPackInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "finance.read");
  const client = db();
  const company = await companyInfo(client, organizationId, companyId);
  const c = company.baseCurrency;
  const m = packMonth(input.month, now);
  const range = { from: m.from, to: m.to };
  const asOf = m.partial ? addDays(todayUtc(now), 1) : m.to;
  const [pnl, prev, cashStart, cashEnd, burn, rr, budgets, overdue, payablesOverdue, roi] = await Promise.all([
    profitAndLossTotals(client, companyId, range),
    profitAndLossTotals(client, companyId, m.prev),
    cashBalance(client, companyId, m.from),
    cashBalance(client, companyId, asOf),
    burnRate(client, companyId, m.to),
    recurringRevenue(client, companyId),
    budgetVsActual(ctx, organizationId, companyId, range),
    overdueReceivables(client, companyId),
    openPayables(client, companyId, { dueBefore: todayUtc(now) }),
    roiAnalytics(ctx, organizationId, companyId, range),
  ]);
  const [ai, aiPrev] = await Promise.all([
    aiSpendView(client, organizationId, companyId, c, range, { profit: pnl.profit, netBurn: burn.netBurn, cash: cashEnd }, m.to),
    aiSpendView(client, organizationId, companyId, c, m.prev, {}, m.from),
  ]);
  const runwayMonths = burn.netBurn > 0n ? Number((cashEnd * 10n) / burn.netBurn) / 10 : null;
  const variance = budgets.map((b) => ({ id: b.id, name: b.name, category: b.category?.name ?? null, department: b.department?.name ?? null, budgetMinor: b.amountMinor, actualMinor: b.actualMinor, remainingMinor: b.remainingMinor, usedPct: b.usedPct }));
  const pack = {
    month: m.month,
    partial: m.partial,
    currency: c,
    company: company.name,
    pnl: { ...pnl, prev, revenueChangePct: pct(pnl.revenue, prev.revenue), expenseChangePct: pct(pnl.expenses, prev.expenses), margin: pnl.revenue > 0n ? Number((pnl.profit * 10_000n) / pnl.revenue) / 100 : null },
    cash: { start: cashStart, end: cashEnd, change: cashEnd - cashStart },
    burn,
    runwayMonths,
    mrr: rr.mrr,
    arr: rr.arr,
    budgets: variance,
    overBudget: variance.filter((v) => v.usedPct >= 100).length,
    receivablesOverdue: overdue,
    payablesOverdue,
    ai: { ...ai, prevMicros: aiPrev.micros, changePct: pct(ai.micros, aiPrev.micros) },
    roi: { totals: roi.totals, topAgents: roi.byAgent.slice(0, 5), departments: roi.byDepartment.slice(0, 8), campaigns: roi.byCampaign.slice(0, 5) },
  };
  return pack;
}

type Pack = Awaited<ReturnType<typeof buildPack>>;

function packMarkdown(p: Pack) {
  const c = p.currency;
  const money = (v: bigint) => `${fromMinor(v, c)} ${c}`;
  const change = (v: number | null) => (v === null ? "n/a" : `${v > 0 ? "+" : ""}${v}%`);
  const moneyList = (xs: { currency: string; amountMinor: bigint }[]) => (xs.length ? xs.map((x) => `${fromMinor(x.amountMinor, x.currency)} ${x.currency}`).join(" + ") : "none");
  const lines = [
    `# Monthly CFO pack — ${p.company}, ${p.month}${p.partial ? " (month to date)" : ""}`,
    `All figures come from the company's books and the AI cost ledger. Currency ${c}.`,
    "",
    "## Profit and loss",
    `- Revenue ${money(p.pnl.revenue)} (${change(p.pnl.revenueChangePct)} vs ${money(p.pnl.prev.revenue)} the month before)`,
    `- Expenses ${money(p.pnl.expenses)} (${change(p.pnl.expenseChangePct)} vs ${money(p.pnl.prev.expenses)})`,
    `- Net profit ${money(p.pnl.profit)}${p.pnl.margin !== null ? `, margin ${p.pnl.margin}%` : ""}`,
    "",
    "## Cash",
    `- Cash at the start ${money(p.cash.start)}, at the end ${money(p.cash.end)} (change ${money(p.cash.change)})`,
    `- Net burn ${money(p.burn.netBurn)}/month, gross burn ${money(p.burn.grossBurn)}/month (3-month average)`,
    `- Runway: ${p.runwayMonths === null ? "not burning cash" : `${p.runwayMonths} months`}`,
    `- MRR ${money(p.mrr)}, ARR ${money(p.arr)}`,
    `- Overdue receivables ${money(p.receivablesOverdue)}; overdue payables ${money(p.payablesOverdue)} (as of today)`,
    "",
    "## Budget variance",
    ...(p.budgets.length ? p.budgets.map((b) => `- ${b.name}: actual ${money(b.actualMinor)} of ${money(b.budgetMinor)} (${b.usedPct}%)${b.usedPct >= 100 ? " — OVER" : ""}`) : ["- No budgets cover this month."]),
    "",
    "## AI and provider spend",
    ...(p.ai.recorded
      ? [
          `- ${usdFromMicros(p.ai.micros)} recorded (${change(p.ai.changePct)} vs ${usdFromMicros(p.ai.prevMicros)}); ${usdFromMicros(p.ai.estimatedMicros)} of it estimated from provider prices`,
          `- By category: ${p.ai.byCategory.map((x) => `${x.key} ${usdFromMicros(x.micros)}`).join("; ") || "none"}`,
          `- By department: ${p.ai.byDepartment.map((x) => `${x.key} ${usdFromMicros(x.micros)}`).join("; ") || "none"}`,
          p.ai.comparable
            ? `- Net profit after AI & provider spend ${p.ai.profitAfterAi !== null ? money(p.ai.profitAfterAi) : "n/a"}; burn including it ${p.ai.netBurnWithAi !== null ? money(p.ai.netBurnWithAi) : "n/a"}/month; runway including it ${p.ai.runwayWithAiMonths !== null ? `${p.ai.runwayWithAiMonths} months` : "not burning cash"}`
            : `- Not added to the ${c} figures: the ledger is in USD and no exchange rate is recorded.`,
        ]
      : ["- No AI or provider spend was recorded this month."]),
    "",
    "## Return on spend",
    `- Won deals ${p.roi.totals.dealsWon} worth ${moneyList(p.roi.totals.revenue)}; ${p.roi.totals.unattributedDeals} not attributed to an AI employee`,
    ...p.roi.topAgents.map((a) => `- ${a.name ?? a.id}: cost ${usdFromMicros(a.costMicros)}, ${a.tasksCompleted} tasks completed, ${a.dealsWon} won deals (${moneyList(a.revenue)}), ROI ${a.roiPct === null ? "n/a" : `${a.roiPct}%`}`),
    ...p.roi.campaigns.map((x) => `- Campaign ${x.name} (${x.code}): spend ${moneyList(x.spend)}, ${x.dealsWon} won deals (${moneyList(x.revenue)}), ROI ${x.roiPct === null ? "n/a" : `${x.roiPct}%`}`),
    "",
  ];
  return lines.join("\n");
}

/** Instructions for the AI CFO; used by the on-demand request and by the monthly schedule preset. */
export function monthlyPackInstructions(month?: string) {
  return [
    `Prepare the monthly CFO pack for ${month ? `the month ${month}` : "the last full month"}.`,
    `Call read_cfo_monthly_pack${month ? ` with month "${month}"` : " (no month: it covers the last full month)"} first; use read_budget_variance, read_ai_provider_costs and read_roi for detail when a figure needs explaining.`,
    "Write: (1) the month in five bullet points with the key numbers (revenue, expenses, net profit, cash change, burn, runway, AI and provider spend); (2) what changed versus the month before and why, from the data; (3) budget lines over or near their limit; (4) AI and provider spend and its return; (5) the three most important actions for next month, each with its expected financial effect; (6) what data is missing.",
    "Quote only figures the tools return, with their currency. Do not create or change records.",
  ].join("\n\n");
}

/** Preset for a monthly AI CFO schedule (frequency comes from the workforce scheduler). */
export const CFO_MONTHLY_PACK_PRESET = { key: "cfo_monthly_pack", profileKey: "ai_cfo", name: "Monthly CFO pack", briefingMode: "MONTHLY", instructions: monthlyPackInstructions() } as const;

export async function requestCfoMonthlyPack(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof monthlyPackInput> = {}) {
  const input = monthlyPackInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "finance.read");
  const m = packMonth(input.month);
  return createTask(ctx, organizationId, companyId, { profile: "ai_cfo", title: `Monthly CFO pack ${m.month}`, instructions: monthlyPackInstructions(m.month), subject: { type: MONTHLY_PACK_SUBJECT, id: companyId } });
}

export async function listMonthlyPackTasks(ctx: RequestContext, organizationId: string, companyId: string) {
  return listSubjectTasks(ctx, organizationId, companyId, MONTHLY_PACK_SUBJECT, companyId, 6);
}

