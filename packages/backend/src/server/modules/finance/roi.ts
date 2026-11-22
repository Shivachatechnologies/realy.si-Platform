import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { authorize, companyInfo, type DateRange } from "./common";
import { AI_SPEND_CURRENCY, aiSpendToBase, aiSpendTotals } from "./ai-costs";

/**
 * ROI analytics from recorded data only (docs: GAP-MATRIX 6.6).
 *
 * - Cost: AI and provider spend from the cost ledger (micro-USD), and recorded marketing spend per campaign.
 * - Return: CRM deals marked WON (closedAt in the range). Attribution rules, nothing estimated:
 *   - campaign: the deal's campaignCode equals the campaign code (case-insensitive);
 *   - AI employee: the AI employee whose agent task worked the deal's lead most recently before the deal closed;
 *   - department: the sum of its AI employees' attributed deals.
 * - ROI % = (return − cost) / cost, only when both are in the same currency and cost > 0; otherwise null, with the
 *   amounts shown side by side. Nothing is converted between currencies.
 */

export interface MoneyByCurrency {
  currency: string;
  amountMinor: bigint;
}

const MAX_DEALS = 5000;
const MAX_TASKS = 20_000;

function addMoney(list: MoneyByCurrency[], currency: string, amount: bigint) {
  const row = list.find((r) => r.currency === currency);
  if (row) row.amountMinor += amount;
  else list.push({ currency, amountMinor: amount });
}

export function roiPct(returnMinor: bigint, costMinor: bigint): number | null {
  if (costMinor <= 0n) return null;
  return Number(((returnMinor - costMinor) * 1000n) / costMinor) / 10;
}

/**
 * ROI of AI spend against attributed revenue: only the USD part of revenue is comparable with the USD ledger. Without
 * any attributed deal there is no measured return (many AI roles do not sell), so ROI is null rather than −100 %.
 */
function aiRoi(revenue: MoneyByCurrency[], micros: bigint) {
  const costMinor = aiSpendToBase(micros, AI_SPEND_CURRENCY)!;
  const usd = revenue.find((r) => r.currency === AI_SPEND_CURRENCY)?.amountMinor ?? 0n;
  const otherCurrencies = revenue.some((r) => r.currency !== AI_SPEND_CURRENCY && r.amountMinor !== 0n);
  return { costMinor, roiPct: usd > 0n && !otherCurrencies ? roiPct(usd, costMinor) : null, mixedCurrencies: otherCurrencies };
}

export async function roiAnalytics(ctx: RequestContext, organizationId: string, companyId: string, range: DateRange) {
  await authorize(ctx, organizationId, companyId, "finance.read");
  const client = db();
  const company = await companyInfo(client, organizationId, companyId);
  const [ai, deals, campaigns, spend, employees] = await Promise.all([
    aiSpendTotals(client, organizationId, companyId, range),
    client.crmDeal.findMany({
      where: { organizationId, companyId, status: "WON", archivedAt: null, closedAt: { gte: range.from, lt: range.to } },
      select: { id: true, amountMinor: true, currency: true, closedAt: true, leadId: true, campaignCode: true },
      orderBy: { closedAt: "desc" },
      take: MAX_DEALS,
    }),
    client.marketingCampaign.findMany({ where: { organizationId, companyId, archivedAt: null }, select: { id: true, name: true, code: true, currency: true, budgetMinor: true, status: true }, take: 500 }),
    client.marketingSpend.groupBy({ by: ["campaignId", "currency"], where: { organizationId, companyId, spentOn: { gte: range.from, lt: range.to } }, _sum: { amountMinor: true } }),
    client.aiEmployee.findMany({ where: { organizationId, companyId }, select: { id: true, name: true, department: true, archivedAt: true }, take: 500 }),
  ]);

  // ── AI employee attribution through the lead the AI worked on.
  const leadIds = [...new Set(deals.flatMap((d) => (d.leadId ? [d.leadId] : [])))];
  const tasks = leadIds.length
    ? await client.agentTask.findMany({
        where: { organizationId, companyId, leadId: { in: leadIds }, aiEmployeeId: { not: null } },
        select: { leadId: true, aiEmployeeId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: MAX_TASKS,
      })
    : [];
  const completed = await client.agentTask.groupBy({ by: ["aiEmployeeId"], where: { organizationId, companyId, aiEmployeeId: { not: null }, status: "COMPLETED", completedAt: { gte: range.from, lt: range.to } }, _count: { _all: true } });
  // Newest first per lead (the query is ordered by createdAt desc).
  const tasksByLead = new Map<string, typeof tasks>();
  for (const t of tasks) (tasksByLead.get(t.leadId!) ?? tasksByLead.set(t.leadId!, []).get(t.leadId!)!).push(t);
  const attributed = new Map<string, { deals: number; revenue: MoneyByCurrency[] }>();
  let unattributedDeals = 0;
  for (const d of deals) {
    const t = d.leadId ? tasksByLead.get(d.leadId)?.find((x) => !d.closedAt || x.createdAt <= d.closedAt) : undefined;
    if (!t) {
      unattributedDeals++;
      continue;
    }
    const a = attributed.get(t.aiEmployeeId!) ?? { deals: 0, revenue: [] };
    a.deals++;
    addMoney(a.revenue, d.currency, d.amountMinor);
    attributed.set(t.aiEmployeeId!, a);
  }

  const agentIds = new Set([...ai.byAgent.map((a) => a.id), ...attributed.keys(), ...completed.map((c) => c.aiEmployeeId!)]);
  const byAgent = [...agentIds]
    .map((id) => {
      const e = employees.find((x) => x.id === id);
      const micros = ai.byAgent.find((a) => a.id === id)?.micros ?? 0n;
      const a = attributed.get(id) ?? { deals: 0, revenue: [] };
      return { id, name: e?.name ?? null, department: e?.department ?? null, archived: !!e?.archivedAt, costMicros: micros, tasksCompleted: completed.find((c) => c.aiEmployeeId === id)?._count._all ?? 0, dealsWon: a.deals, revenue: a.revenue, ...aiRoi(a.revenue, micros) };
    })
    .sort((x, y) => (y.costMicros > x.costMicros ? 1 : y.costMicros < x.costMicros ? -1 : y.dealsWon - x.dealsWon));

  // ── Departments: ledger department key; revenue = their AI employees' attributed deals.
  const deptKeys = new Set([...ai.byDepartment.map((d) => d.key), ...byAgent.filter((a) => a.dealsWon > 0 && a.department).map((a) => a.department!)]);
  const byDepartment = [...deptKeys]
    .map((key) => {
      const micros = ai.byDepartment.find((d) => d.key === key)?.micros ?? 0n;
      const revenue: MoneyByCurrency[] = [];
      let dealsWon = 0;
      for (const a of byAgent.filter((x) => x.department === key)) {
        dealsWon += a.dealsWon;
        for (const r of a.revenue) addMoney(revenue, r.currency, r.amountMinor);
      }
      return { key, costMicros: micros, dealsWon, revenue, ...aiRoi(revenue, micros) };
    })
    .sort((x, y) => (y.costMicros > x.costMicros ? 1 : y.costMicros < x.costMicros ? -1 : 0));

  // ── Campaigns: recorded spend vs won deals carrying the campaign code.
  const byCampaign = campaigns
    .map((c) => {
      const code = c.code.trim().toUpperCase();
      const won = deals.filter((d) => d.campaignCode?.trim().toUpperCase() === code);
      const revenue: MoneyByCurrency[] = [];
      for (const d of won) addMoney(revenue, d.currency, d.amountMinor);
      const spent: MoneyByCurrency[] = [];
      for (const s of spend.filter((x) => x.campaignId === c.id)) addMoney(spent, s.currency, s._sum.amountMinor ?? 0n);
      const sameSpend = spent.find((s) => s.currency === c.currency)?.amountMinor ?? 0n;
      const sameRevenue = revenue.find((r) => r.currency === c.currency)?.amountMinor ?? 0n;
      const mixedCurrencies = [...spent, ...revenue].some((x) => x.currency !== c.currency && x.amountMinor !== 0n);
      return { id: c.id, name: c.name, code: c.code, status: c.status, currency: c.currency, budgetMinor: c.budgetMinor, spend: spent, spendMinor: sameSpend, dealsWon: won.length, revenue, revenueMinor: sameRevenue, roiPct: mixedCurrencies ? null : roiPct(sameRevenue, sameSpend), mixedCurrencies };
    })
    .filter((c) => c.spend.length || c.dealsWon)
    .sort((x, y) => y.dealsWon - x.dealsWon || (y.spendMinor > x.spendMinor ? 1 : -1));

  const revenueTotal: MoneyByCurrency[] = [];
  for (const d of deals) addMoney(revenueTotal, d.currency, d.amountMinor);
  return {
    baseCurrency: company.baseCurrency,
    aiCurrency: AI_SPEND_CURRENCY,
    totals: { aiCostMicros: ai.micros, aiEstimatedMicros: ai.estimatedMicros, dealsWon: deals.length, revenue: revenueTotal, unattributedDeals, truncated: deals.length >= MAX_DEALS },
    byAgent,
    byDepartment,
    byCampaign,
  };
}

export type RoiAnalytics = Awaited<ReturnType<typeof roiAnalytics>>;
