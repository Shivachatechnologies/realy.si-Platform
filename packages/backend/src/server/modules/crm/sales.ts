import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { authorize, companyCurrency, eligibleOwnerIds, isUuid, param, userNames } from "./common";
import { periodStartOf } from "./config";
import { dealProbability, dealWeighted } from "./deals";

/**
 * Sales team analytics from live CRM data: performance & leaderboard, targets attainment, forecast, conversion,
 * attribution, lost reasons and commissions. Money sums only include deals in the company's base currency.
 */

const DAY = 86_400_000;

export interface SalesRange {
  from: Date;
  /** Exclusive. */
  to: Date;
  owner?: string;
  pipelineId?: string;
  source?: string;
}

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive) — defaults to the current month. */
export function parseSalesRange(raw: Record<string, string | string[] | undefined>, now = new Date()): SalesRange {
  const d = (k: string) => {
    const v = param(raw, k);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? new Date(`${v}T00:00:00Z`) : null;
  };
  const from = d("from") ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const toIncl = d("to");
  const to = toIncl ? new Date(toIncl.getTime() + DAY) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const owner = param(raw, "owner");
  const pipelineId = param(raw, "pipeline");
  return { from, to: to > from ? to : new Date(from.getTime() + DAY), owner: isUuid(owner) ? owner : undefined, pipelineId: isUuid(pipelineId) ? pipelineId : undefined, source: param(raw, "source", 100) };
}

function dealScope(organizationId: string, companyId: string, r: SalesRange): Prisma.CrmDealWhereInput {
  return {
    organizationId,
    companyId,
    archivedAt: null,
    ...(r.owner ? { ownerId: r.owner } : {}),
    ...(r.pipelineId ? { pipelineId: r.pipelineId } : {}),
    ...(r.source ? { source: { equals: r.source, mode: "insensitive" as const } } : {}),
  };
}

const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

async function loadDeals(organizationId: string, companyId: string, r: SalesRange) {
  const { baseCurrency } = await companyCurrency(db(), organizationId, companyId);
  const scope = dealScope(organizationId, companyId, r);
  const [closed, open, created] = await Promise.all([
    db().crmDeal.findMany({
      where: { ...scope, status: { in: ["WON", "LOST"] }, closedAt: { gte: r.from, lt: r.to } },
      select: { id: true, name: true, ownerId: true, pipelineId: true, amountMinor: true, currency: true, status: true, closedAt: true, createdAt: true, source: true, campaignCode: true, lostReason: true, leadId: true },
      take: 20_000,
    }),
    db().crmDeal.findMany({
      where: { ...scope, status: "OPEN" },
      select: { id: true, ownerId: true, amountMinor: true, currency: true, probability: true, status: true, expectedCloseDate: true, staleSince: true, stage: { select: { probability: true } } },
      take: 20_000,
    }),
    db().crmDeal.count({ where: { ...scope, createdAt: { gte: r.from, lt: r.to } } }),
  ]);
  const inBase = <T extends { currency: string }>(xs: T[]) => xs.filter((x) => x.currency === baseCurrency);
  return { baseCurrency, closed, open, created, inBase };
}

/** Per-owner performance for the range, sorted by won revenue (the leaderboard). */
export async function teamPerformance(ctx: RequestContext, organizationId: string, companyId: string, r: SalesRange) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const { baseCurrency, closed, open, inBase } = await loadDeals(organizationId, companyId, r);
  const [activities, leadActs, leads] = await Promise.all([
    db().crmActivity.groupBy({ by: ["createdById"], where: { organizationId, companyId, occurredAt: { gte: r.from, lt: r.to } }, _count: { _all: true } }),
    db().leadActivity.groupBy({ by: ["createdById"], where: { organizationId, companyId, occurredAt: { gte: r.from, lt: r.to } }, _count: { _all: true } }),
    db().lead.findMany({
      where: { organizationId, companyId, createdAt: { gte: r.from, lt: r.to }, ...(r.owner ? { ownerId: r.owner } : {}), ...(r.source ? { source: { equals: r.source, mode: "insensitive" as const } } : {}) },
      select: { ownerId: true, convertedAt: true },
      take: 50_000,
    }),
  ]);
  const actCount = new Map<string, number>();
  for (const a of [...activities, ...leadActs]) actCount.set(a.createdById, (actCount.get(a.createdById) ?? 0) + a._count._all);
  const ownerIds = [...new Set([...closed.map((d) => d.ownerId), ...open.map((d) => d.ownerId), ...leads.map((l) => l.ownerId)])];
  const names = await userNames(db(), ownerIds);
  const rows = ownerIds.map((ownerId) => {
    const won = inBase(closed.filter((d) => d.ownerId === ownerId && d.status === "WON"));
    const wonAll = closed.filter((d) => d.ownerId === ownerId && d.status === "WON").length;
    const lost = closed.filter((d) => d.ownerId === ownerId && d.status === "LOST").length;
    const mineOpen = inBase(open.filter((d) => d.ownerId === ownerId));
    const myLeads = leads.filter((l) => l.ownerId === ownerId);
    const wonMinor = sum(won.map((d) => d.amountMinor));
    const cycle = won.map((d) => (d.closedAt!.getTime() - d.createdAt.getTime()) / DAY);
    return {
      ownerId,
      name: ownerId ? (names.get(ownerId) ?? null) : null,
      wonCount: wonAll,
      lostCount: lost,
      wonMinor,
      winRate: wonAll + lost ? wonAll / (wonAll + lost) : null,
      avgDealMinor: won.length ? wonMinor / BigInt(won.length) : 0n,
      cycleDays: cycle.length ? cycle.reduce((a, b) => a + b, 0) / cycle.length : null,
      openCount: open.filter((d) => d.ownerId === ownerId).length,
      openMinor: sum(mineOpen.map((d) => d.amountMinor)),
      weightedMinor: sum(mineOpen.map((d) => dealWeighted(d))),
      activities: ownerId ? (actCount.get(ownerId) ?? 0) : 0,
      leads: myLeads.length,
      converted: myLeads.filter((l) => l.convertedAt).length,
    };
  });
  rows.sort((a, b) => (b.wonMinor > a.wonMinor ? 1 : b.wonMinor < a.wonMinor ? -1 : b.weightedMinor > a.weightedMinor ? 1 : -1));
  return { currency: baseCurrency, rows };
}

/** Headline sales numbers for a range (team leader dashboard). */
export async function salesSummary(ctx: RequestContext, organizationId: string, companyId: string, r: SalesRange) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const { baseCurrency, closed, open, created, inBase } = await loadDeals(organizationId, companyId, r);
  const won = closed.filter((d) => d.status === "WON");
  const lost = closed.filter((d) => d.status === "LOST");
  const wonBase = inBase(won);
  const newLeads = await db().lead.count({ where: { organizationId, companyId, createdAt: { gte: r.from, lt: r.to }, ...(r.owner ? { ownerId: r.owner } : {}) } });
  const cycle = won.map((d) => (d.closedAt!.getTime() - d.createdAt.getTime()) / DAY);
  return {
    currency: baseCurrency,
    newLeads,
    dealsCreated: created,
    wonCount: won.length,
    lostCount: lost.length,
    wonMinor: sum(wonBase.map((d) => d.amountMinor)),
    winRate: won.length + lost.length ? won.length / (won.length + lost.length) : null,
    avgDealMinor: wonBase.length ? sum(wonBase.map((d) => d.amountMinor)) / BigInt(wonBase.length) : 0n,
    cycleDays: cycle.length ? cycle.reduce((a, b) => a + b, 0) / cycle.length : null,
    openCount: open.length,
    openMinor: sum(inBase(open).map((d) => d.amountMinor)),
    weightedMinor: sum(inBase(open).map((d) => dealWeighted(d))),
    staleCount: open.filter((d) => d.staleSince).length,
  };
}

/**
 * Forecast of open deals by expected close month (weighted and best case) for the next `months` months, plus won
 * revenue already closed in each month; and the weighted forecast per owner over the same horizon.
 */
export async function salesForecast(ctx: RequestContext, organizationId: string, companyId: string, opts: { months?: number; owner?: string; pipelineId?: string } = {}, now = new Date()) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const months = Math.min(12, Math.max(1, opts.months ?? 6));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1));
  const { baseCurrency } = await companyCurrency(db(), organizationId, companyId);
  const scope = dealScope(organizationId, companyId, { from: start, to: end, owner: opts.owner, pipelineId: opts.pipelineId });
  const [open, won] = await Promise.all([
    db().crmDeal.findMany({
      where: { ...scope, status: "OPEN", currency: baseCurrency },
      select: { ownerId: true, amountMinor: true, probability: true, status: true, expectedCloseDate: true, stage: { select: { probability: true } } },
      take: 20_000,
    }),
    db().crmDeal.findMany({ where: { ...scope, status: "WON", currency: baseCurrency, closedAt: { gte: start, lt: end } }, select: { amountMinor: true, closedAt: true }, take: 20_000 }),
  ]);
  const keyOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const buckets = Array.from({ length: months }, (_, i) => keyOf(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))));
  // Overdue expected closes (or none) count toward the current month.
  const bucketOf = (d: Date | null) => (!d || d < start ? buckets[0]! : keyOf(d));
  const byMonth = buckets.map((month) => {
    const items = open.filter((d) => bucketOf(d.expectedCloseDate) === month);
    return {
      month,
      count: items.length,
      bestCaseMinor: sum(items.map((d) => d.amountMinor)),
      weightedMinor: sum(items.map((d) => dealWeighted(d))),
      commitMinor: sum(items.filter((d) => dealProbability(d) >= 75).map((d) => d.amountMinor)),
      wonMinor: sum(won.filter((d) => keyOf(d.closedAt!) === month).map((d) => d.amountMinor)),
    };
  });
  const inHorizon = open.filter((d) => buckets.includes(bucketOf(d.expectedCloseDate)));
  const ownerIds = [...new Set(inHorizon.map((d) => d.ownerId))];
  const names = await userNames(db(), ownerIds);
  const byOwner = ownerIds
    .map((ownerId) => {
      const items = inHorizon.filter((d) => d.ownerId === ownerId);
      return { ownerId, name: ownerId ? (names.get(ownerId) ?? null) : null, count: items.length, bestCaseMinor: sum(items.map((d) => d.amountMinor)), weightedMinor: sum(items.map((d) => dealWeighted(d))) };
    })
    .sort((a, b) => (b.weightedMinor > a.weightedMinor ? 1 : -1));
  return { currency: baseCurrency, byMonth, byOwner };
}

/** Targets of the period containing `at` with attainment (won amount / deals closed in the period by the owner). */
export async function targetAttainment(ctx: RequestContext, organizationId: string, companyId: string, period: "MONTH" | "QUARTER", at = new Date()) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const start = periodStartOf(period, at);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + (period === "QUARTER" ? 3 : 1), 1));
  const targets = await db().crmSalesTarget.findMany({ where: { organizationId, companyId, period, periodStart: start } });
  const won = await db().crmDeal.findMany({
    where: { organizationId, companyId, archivedAt: null, status: "WON", closedAt: { gte: start, lt: end }, ownerId: { in: targets.map((t) => t.ownerId) } },
    select: { ownerId: true, amountMinor: true, currency: true },
  });
  const names = await userNames(db(), targets.map((t) => t.ownerId));
  const rows = targets.map((t) => {
    const mine = won.filter((d) => d.ownerId === t.ownerId);
    const wonMinor = sum(mine.filter((d) => d.currency === t.currency).map((d) => d.amountMinor));
    return {
      id: t.id,
      ownerId: t.ownerId,
      name: names.get(t.ownerId) ?? null,
      targetMinor: t.amountMinor,
      currency: t.currency,
      wonMinor,
      attainment: t.amountMinor > 0n ? Number((wonMinor * 10_000n) / t.amountMinor) / 10_000 : null,
      dealsTarget: t.dealsTarget,
      dealsWon: mine.length,
    };
  });
  rows.sort((a, b) => (b.attainment ?? 0) - (a.attainment ?? 0));
  return { period, start, end, rows };
}

/** Lead → deal → won conversion by owner and by source for leads created in the range. */
export async function conversionMetrics(ctx: RequestContext, organizationId: string, companyId: string, r: SalesRange) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const leads = await db().lead.findMany({
    where: { organizationId, companyId, createdAt: { gte: r.from, lt: r.to }, mergedIntoId: null, ...(r.owner ? { ownerId: r.owner } : {}), ...(r.source ? { source: { equals: r.source, mode: "insensitive" as const } } : {}) },
    select: { id: true, ownerId: true, source: true, campaignCode: true, convertedAt: true, qualified: true, crmDeals: { select: { status: true } } },
    take: 50_000,
  });
  const group = (key: (l: (typeof leads)[number]) => string | null) => {
    const m = new Map<string | null, typeof leads>();
    for (const l of leads) m.set(key(l), [...(m.get(key(l)) ?? []), l]);
    return [...m.entries()]
      .map(([k, ls]) => {
        const deals = ls.filter((l) => l.crmDeals.length).length;
        const won = ls.filter((l) => l.crmDeals.some((d) => d.status === "WON")).length;
        return { key: k, leads: ls.length, qualified: ls.filter((l) => l.qualified).length, deals, won, leadToDeal: ls.length ? deals / ls.length : null, dealToWon: deals ? won / deals : null, leadToWon: ls.length ? won / ls.length : null };
      })
      .sort((a, b) => b.leads - a.leads);
  };
  const byOwner = group((l) => l.ownerId);
  const names = await userNames(db(), byOwner.map((o) => o.key));
  return {
    total: group(() => "all")[0] ?? null,
    byOwner: byOwner.map((o) => ({ ...o, name: o.key ? (names.get(o.key) ?? null) : null })),
    bySource: group((l) => l.source?.trim() || null),
    byCampaign: group((l) => l.campaignCode?.trim() || null),
  };
}

/**
 * Stage analytics of one pipeline (the given one or the default) for deals with stage activity in the range, from
 * CrmDealStageChange: how many deals reached each open stage, stage-to-stage conversion (reached next / reached this),
 * the share that reached WON, and the average days spent in each stage (finished stays, plus the ongoing stay of
 * still-open deals).
 */
export async function stageAnalytics(ctx: RequestContext, organizationId: string, companyId: string, r: SalesRange, now = new Date()) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const pipeline = await db().crmPipeline.findFirst({
    where: { organizationId, companyId, archivedAt: null, ...(r.pipelineId ? { id: r.pipelineId } : {}) },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }],
    include: { stages: { orderBy: { position: "asc" } } },
  });
  if (!pipeline) return null;
  const deals = await db().crmDeal.findMany({
    where: {
      ...dealScope(organizationId, companyId, { ...r, pipelineId: pipeline.id }),
      stageHistory: { some: { changedAt: { gte: r.from, lt: r.to } } },
    },
    select: { id: true, status: true, stageId: true, stageHistory: { orderBy: { changedAt: "asc" }, select: { toStageId: true, changedAt: true } } },
    take: 20_000,
  });
  const stages = pipeline.stages.filter((s) => !s.archivedAt || deals.some((d) => d.stageHistory.some((h) => h.toStageId === s.id)));
  const pos = new Map(stages.map((s, i) => [s.id, i]));
  const openStages = stages.filter((s) => s.type === "OPEN");
  const won = stages.filter((s) => s.type === "WON").map((s) => s.id);
  // Furthest open-stage position each deal reached (a WON deal reached every open stage).
  const reachedIdx = deals.map((d) => {
    if (d.status === "WON" || d.stageHistory.some((h) => won.includes(h.toStageId))) return Number.MAX_SAFE_INTEGER;
    let max = -1;
    for (const h of d.stageHistory) {
      const st = stages[pos.get(h.toStageId) ?? -1];
      if (st?.type === "OPEN") max = Math.max(max, pos.get(h.toStageId)!);
    }
    return max;
  });
  const days = new Map<string, number[]>();
  for (const d of deals) {
    d.stageHistory.forEach((h, i) => {
      const next = d.stageHistory[i + 1];
      const end = next ? next.changedAt : d.status === "OPEN" && d.stageId === h.toStageId ? now : null;
      if (!end) return;
      days.set(h.toStageId, [...(days.get(h.toStageId) ?? []), (end.getTime() - h.changedAt.getTime()) / DAY]);
    });
  }
  const avg = (xs: number[] | undefined) => (xs?.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const reachedCount = (idx: number) => reachedIdx.filter((x) => x >= idx).length;
  const wonCount = reachedIdx.filter((x) => x === Number.MAX_SAFE_INTEGER).length;
  const rows = openStages.map((s, i) => {
    const reached = reachedCount(pos.get(s.id)!);
    const nextStage = openStages[i + 1];
    const nextReached = nextStage ? reachedCount(pos.get(nextStage.id)!) : wonCount;
    return { stageId: s.id, name: s.name, reached, toNext: reached ? nextReached / reached : null, nextName: nextStage?.name ?? null, avgDays: avg(days.get(s.id)), stays: days.get(s.id)?.length ?? 0 };
  });
  return { pipeline: { id: pipeline.id, name: pipeline.name }, deals: deals.length, won: wonCount, winShare: deals.length ? wonCount / deals.length : null, rows };
}

/**
 * Sales team management: every member who can own sales records, with their capacity settings, open workload
 * (leads, deals, sales tasks, follow-ups) and attainment of this month's and quarter's targets.
 */
export async function salesTeam(ctx: RequestContext, organizationId: string, companyId: string, now = new Date()) {
  const chain = await authorize(ctx, organizationId, companyId, "sales.read");
  const ids = await eligibleOwnerIds(db(), organizationId, chain);
  const { baseCurrency } = await companyCurrency(db(), organizationId, companyId);
  const month = periodStartOf("MONTH", now);
  const quarter = periodStartOf("QUARTER", now);
  const monthEnd = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  const quarterEnd = new Date(Date.UTC(quarter.getUTCFullYear(), quarter.getUTCMonth() + 3, 1));
  const [users, reps, openDeals, openLeads, tasks, followUps, leadFollowUps, targets, wonQ] = await Promise.all([
    db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    db().crmSalesRep.findMany({ where: { companyId, ownerId: { in: ids } } }),
    db().crmDeal.groupBy({ by: ["ownerId", "currency"], where: { organizationId, companyId, archivedAt: null, status: "OPEN", ownerId: { in: ids } }, _count: { _all: true }, _sum: { amountMinor: true } }),
    db().lead.groupBy({ by: ["ownerId"], where: { organizationId, companyId, archivedAt: null, convertedAt: null, ownerId: { in: ids } }, _count: { _all: true } }),
    db().workTask.groupBy({ by: ["assigneeId"], where: { organizationId, companyId, archivedAt: null, assigneeId: { in: ids }, sourceType: { in: ["crm_deal", "crm_lead", "crm_account"] }, status: { notIn: ["DONE", "CANCELLED"] } }, _count: { _all: true } }),
    db().crmFollowUp.groupBy({ by: ["assigneeId"], where: { organizationId, companyId, completedAt: null, assigneeId: { in: ids } }, _count: { _all: true } }),
    db().leadFollowUp.findMany({ where: { organizationId, companyId, completedAt: null, lead: { ownerId: { in: ids }, archivedAt: null } }, select: { lead: { select: { ownerId: true } } }, take: 50_000 }),
    db().crmSalesTarget.findMany({ where: { organizationId, companyId, ownerId: { in: ids }, OR: [{ period: "MONTH", periodStart: month }, { period: "QUARTER", periodStart: quarter }] } }),
    db().crmDeal.findMany({ where: { organizationId, companyId, archivedAt: null, status: "WON", ownerId: { in: ids }, closedAt: { gte: quarter, lt: quarterEnd } }, select: { ownerId: true, amountMinor: true, currency: true, closedAt: true } }),
  ]);
  const count = <K extends string>(rows: ({ _count: { _all: number } } & Record<K, string | null>)[], key: K) => new Map(rows.map((r) => [r[key], r._count._all]));
  const leadsBy = count(openLeads, "ownerId");
  const tasksBy = count(tasks, "assigneeId");
  const fuBy = count(followUps, "assigneeId");
  const lfu = new Map<string, number>();
  for (const f of leadFollowUps) if (f.lead.ownerId) lfu.set(f.lead.ownerId, (lfu.get(f.lead.ownerId) ?? 0) + 1);
  const attainment = (target: { amountMinor: bigint; currency: string } | undefined, won: bigint) => (target && target.amountMinor > 0n ? Number((won * 10_000n) / target.amountMinor) / 10_000 : null);
  const members = users.map((u) => {
    const rep = reps.find((r) => r.ownerId === u.id) ?? null;
    const deals = openDeals.filter((d) => d.ownerId === u.id);
    const openDealCount = deals.reduce((a, d) => a + d._count._all, 0);
    const mine = wonQ.filter((d) => d.ownerId === u.id && d.currency === baseCurrency);
    const wonQuarter = sum(mine.map((d) => d.amountMinor));
    const wonMonth = sum(mine.filter((d) => d.closedAt! >= month && d.closedAt! < monthEnd).map((d) => d.amountMinor));
    const tMonth = targets.find((t) => t.ownerId === u.id && t.period === "MONTH");
    const tQuarter = targets.find((t) => t.ownerId === u.id && t.period === "QUARTER");
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: rep?.role ?? null,
      available: rep?.available ?? true,
      maxOpenDeals: rep?.maxOpenDeals ?? null,
      maxOpenLeads: rep?.maxOpenLeads ?? null,
      openDeals: openDealCount,
      openDealsMinor: sum(deals.filter((d) => d.currency === baseCurrency).map((d) => d._sum.amountMinor ?? 0n)),
      openLeads: leadsBy.get(u.id) ?? 0,
      openTasks: tasksBy.get(u.id) ?? 0,
      openFollowUps: (fuBy.get(u.id) ?? 0) + (lfu.get(u.id) ?? 0),
      dealLoad: rep?.maxOpenDeals ? openDealCount / rep.maxOpenDeals : null,
      month: { targetMinor: tMonth?.amountMinor ?? null, wonMinor: wonMonth, attainment: attainment(tMonth, wonMonth) },
      quarter: { targetMinor: tQuarter?.amountMinor ?? null, wonMinor: wonQuarter, attainment: attainment(tQuarter, wonQuarter) },
    };
  });
  return { currency: baseCurrency, month, quarter, members };
}

/** Won revenue in the range attributed by source, campaign code and owner; plus lost-reason breakdown. */
export async function revenueAttribution(ctx: RequestContext, organizationId: string, companyId: string, r: SalesRange) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const { baseCurrency, closed, inBase } = await loadDeals(organizationId, companyId, r);
  const won = inBase(closed.filter((d) => d.status === "WON"));
  const total = sum(won.map((d) => d.amountMinor));
  const by = (key: (d: (typeof won)[number]) => string | null) => {
    const m = new Map<string | null, bigint[]>();
    for (const d of won) m.set(key(d), [...(m.get(key(d)) ?? []), d.amountMinor]);
    return [...m.entries()]
      .map(([k, xs]) => ({ key: k, count: xs.length, wonMinor: sum(xs), share: total > 0n ? Number((sum(xs) * 10_000n) / total) / 10_000 : null }))
      .sort((a, b) => (b.wonMinor > a.wonMinor ? 1 : -1));
  };
  const byOwner = by((d) => d.ownerId);
  const names = await userNames(db(), byOwner.map((o) => o.key));
  const lost = closed.filter((d) => d.status === "LOST");
  const reasons = new Map<string, { count: number; amounts: bigint[] }>();
  for (const d of lost) {
    const k = d.lostReason?.trim() || "";
    const e = reasons.get(k) ?? { count: 0, amounts: [] };
    e.count++;
    if (d.currency === baseCurrency) e.amounts.push(d.amountMinor);
    reasons.set(k, e);
  }
  return {
    currency: baseCurrency,
    totalMinor: total,
    bySource: by((d) => d.source?.trim() || null),
    byCampaign: by((d) => d.campaignCode?.trim() || null),
    byOwner: byOwner.map((o) => ({ ...o, name: o.key ? (names.get(o.key) ?? null) : null })),
    lostReasons: [...reasons.entries()].map(([reason, e]) => ({ reason: reason || null, count: e.count, lostMinor: sum(e.amounts) })).sort((a, b) => b.count - a.count),
  };
}

type Tier = { fromMinor: string; rateBps: number };

/** Progressive commission: base rate below the first tier, each tier's rate on the part above its threshold. */
export function tieredCommission(amount: bigint, rateBps: number, tiers: Tier[]): bigint {
  const ts = [...tiers].map((t) => ({ from: BigInt(t.fromMinor), rate: t.rateBps })).sort((a, b) => (a.from < b.from ? -1 : 1));
  const bands = [{ from: 0n, rate: rateBps }, ...ts.filter((t) => t.from > 0n)];
  if (ts.some((t) => t.from === 0n)) bands[0]!.rate = ts.find((t) => t.from === 0n)!.rate;
  let total = 0n;
  for (const [i, b] of bands.entries()) {
    const upper = bands[i + 1]?.from ?? amount;
    const slice = (amount < upper ? amount : upper) - b.from;
    if (slice > 0n) total += (slice * BigInt(b.rate)) / 10_000n;
  }
  return total;
}

/**
 * Commissions for deals won in the range: each deal uses its most specific active rule (owner+pipeline, owner,
 * pipeline, then company-wide; lower position first); tiers apply to the owner's total won amount under that rule.
 */
export async function computeCommissions(ctx: RequestContext, organizationId: string, companyId: string, r: SalesRange) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const { baseCurrency } = await companyCurrency(db(), organizationId, companyId);
  const [rules, won] = await Promise.all([
    db().crmCommissionRule.findMany({ where: { organizationId, companyId, active: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    db().crmDeal.findMany({
      where: { ...dealScope(organizationId, companyId, r), status: "WON", closedAt: { gte: r.from, lt: r.to }, currency: baseCurrency, ownerId: { not: null } },
      select: { id: true, ownerId: true, pipelineId: true, amountMinor: true },
      take: 20_000,
    }),
  ]);
  const specificity = (rule: (typeof rules)[number]) => (rule.ownerId ? 2 : 0) + (rule.pipelineId ? 1 : 0);
  const ruleFor = (d: (typeof won)[number]) =>
    rules
      .filter((rule) => (!rule.ownerId || rule.ownerId === d.ownerId) && (!rule.pipelineId || rule.pipelineId === d.pipelineId))
      .sort((a, b) => specificity(b) - specificity(a))[0];
  const groups = new Map<string, { ownerId: string; ruleId: string; amounts: bigint[] }>();
  for (const d of won) {
    const rule = ruleFor(d);
    if (!rule) continue;
    const k = `${d.ownerId}:${rule.id}`;
    const g = groups.get(k) ?? { ownerId: d.ownerId!, ruleId: rule.id, amounts: [] };
    g.amounts.push(d.amountMinor);
    groups.set(k, g);
  }
  const names = await userNames(db(), [...groups.values()].map((g) => g.ownerId));
  const ruleById = new Map(rules.map((x) => [x.id, x]));
  const lines = [...groups.values()].map((g) => {
    const rule = ruleById.get(g.ruleId)!;
    const wonMinor = sum(g.amounts);
    return { ownerId: g.ownerId, name: names.get(g.ownerId) ?? null, ruleId: rule.id, ruleName: rule.name, deals: g.amounts.length, wonMinor, commissionMinor: tieredCommission(wonMinor, rule.rateBps, (rule.tiers as Tier[]) ?? []) };
  });
  const byOwner = new Map<string, { ownerId: string; name: string | null; wonMinor: bigint; commissionMinor: bigint; deals: number }>();
  for (const l of lines) {
    const e = byOwner.get(l.ownerId) ?? { ownerId: l.ownerId, name: l.name, wonMinor: 0n, commissionMinor: 0n, deals: 0 };
    e.wonMinor += l.wonMinor;
    e.commissionMinor += l.commissionMinor;
    e.deals += l.deals;
    byOwner.set(l.ownerId, e);
  }
  return {
    currency: baseCurrency,
    lines,
    byOwner: [...byOwner.values()].sort((a, b) => (b.commissionMinor > a.commissionMinor ? 1 : -1)),
    totalMinor: sum(lines.map((l) => l.commissionMinor)),
    uncovered: won.filter((d) => !ruleFor(d)).length,
  };
}

/** Deals closed or created in the range, for the sales report table and CSV export. */
export async function salesReportRows(ctx: RequestContext, organizationId: string, companyId: string, r: SalesRange, basis: "closed" | "created" = "closed") {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const rows = await db().crmDeal.findMany({
    where: { ...dealScope(organizationId, companyId, r), ...(basis === "closed" ? { closedAt: { gte: r.from, lt: r.to } } : { createdAt: { gte: r.from, lt: r.to } }) },
    orderBy: basis === "closed" ? { closedAt: "desc" } : { createdAt: "desc" },
    take: 10_000,
    include: { stage: { select: { name: true, probability: true } }, pipeline: { select: { name: true } }, account: { select: { name: true } } },
  });
  const names = await userNames(db(), rows.map((d) => d.ownerId));
  return rows.map((d) => ({ ...d, ownerName: d.ownerId ? (names.get(d.ownerId) ?? null) : null }));
}
