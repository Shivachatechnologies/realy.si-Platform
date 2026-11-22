import { z } from "zod";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { daysAgo, requireAnyPlatform } from "./access";
import { mrrByCurrency } from "./overview";

/**
 * Revenue (Admin → Plans & Billing → Revenue): MRR/ARR, new / churned / expansion MRR, MRR by plan and billing
 * country and recent Stripe invoice events. Invoices themselves come from the synced mirror (/invoices).
 * Only real subscription rows; amounts in minor units per currency (never converted or estimated).
 */

const READ = ["platform.subscriptions.read", "pricing.read"];
type Money = Map<string, bigint>;
const add = (m: Money, currency: string, v: bigint) => m.set(currency, (m.get(currency) ?? 0n) + v);
const list = (m: Money) => [...m].map(([currency, amountMinor]) => ({ currency, amountMinor })).sort((a, b) => (b.amountMinor > a.amountMinor ? 1 : -1));

interface ItemRow {
  quantity: number;
  unitAmountMinor: bigint;
  currency: string;
  createdAt: Date;
}
const monthly = (i: ItemRow, interval: "MONTH" | "YEAR") => {
  const a = i.unitAmountMinor * BigInt(i.quantity);
  return interval === "YEAR" ? a / 12n : a;
};

export async function revenueOverview(ctx: RequestContext) {
  await requireAnyPlatform(ctx, READ);
  const d30 = daysAgo(30);
  const [subs, mrr, events, plans] = await Promise.all([
    db().subscription.findMany({
      where: { OR: [{ status: { in: ["ACTIVE", "PAST_DUE", "TRIALING"] } }, { canceledAt: { gte: daysAgo(365) } }] },
      select: { id: true, status: true, interval: true, billingCountryCode: true, createdAt: true, canceledAt: true, planId: true, organizationId: true, items: { select: { quantity: true, unitAmountMinor: true, currency: true, createdAt: true } } },
    }),
    mrrByCurrency(),
    db().stripeEvent.findMany({ where: { type: { startsWith: "invoice." } }, orderBy: { processedAt: "desc" }, take: 30 }),
    db().plan.findMany({ select: { id: true, key: true, name: true } }),
  ]);
  const newMrr: Money = new Map();
  const churned: Money = new Map();
  const expansion: Money = new Map();
  const byPlan = new Map<string, { subs: number; mrr: Money }>();
  const byCountry = new Map<string, { subs: number; mrr: Money }>();
  const months = new Map<string, { started: number; canceled: number }>();
  const monthKey = (d: Date) => d.toISOString().slice(0, 7);
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    months.set(monthKey(d), { started: 0, canceled: 0 });
  }
  let trialing = 0;
  for (const s of subs) {
    const m = months.get(monthKey(s.createdAt));
    if (m) m.started++;
    if (s.canceledAt) {
      const c = months.get(monthKey(s.canceledAt));
      if (c) c.canceled++;
    }
    const paying = s.status === "ACTIVE" || s.status === "PAST_DUE";
    if (s.status === "TRIALING") trialing++;
    for (const i of s.items) {
      const v = monthly(i, s.interval);
      if (paying) {
        if (s.createdAt >= d30) add(newMrr, i.currency, v);
        else if (i.createdAt >= d30) add(expansion, i.currency, v);
        for (const [map, key] of [
          [byPlan, s.planId],
          [byCountry, s.billingCountryCode],
        ] as const) {
          const cur = map.get(key) ?? { subs: 0, mrr: new Map() };
          add(cur.mrr, i.currency, v);
          map.set(key, cur);
        }
      } else if (s.status === "CANCELED" && s.canceledAt && s.canceledAt >= d30) add(churned, i.currency, v);
    }
    if (paying) {
      for (const [map, key] of [
        [byPlan, s.planId],
        [byCountry, s.billingCountryCode],
      ] as const) {
        const cur = map.get(key) ?? { subs: 0, mrr: new Map() };
        cur.subs++;
        map.set(key, cur);
      }
    }
  }
  const paying = subs.filter((s) => s.status === "ACTIVE" || s.status === "PAST_DUE").length;
  const canceled30 = subs.filter((s) => s.canceledAt && s.canceledAt >= d30).length;
  const orgIds = [...new Set(events.map((e) => e.organizationId).filter((x): x is string => !!x))];
  const orgs = await db().organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } });
  return {
    mrr,
    arr: mrr.map((m) => ({ currency: m.currency, amountMinor: m.amountMinor * 12n })),
    newMrr: list(newMrr),
    churnedMrr: list(churned),
    expansionMrr: list(expansion),
    paying,
    trialing,
    canceled30,
    churnRate: paying + canceled30 > 0 ? canceled30 / (paying + canceled30) : null,
    byPlan: [...byPlan].map(([planId, v]) => ({ planId, name: plans.find((p) => p.id === planId)?.name ?? planId, key: plans.find((p) => p.id === planId)?.key ?? "", subs: v.subs, mrr: list(v.mrr) })).sort((a, b) => b.subs - a.subs),
    byCountry: [...byCountry].map(([country, v]) => ({ country, subs: v.subs, mrr: list(v.mrr) })).sort((a, b) => b.subs - a.subs),
    months: [...months].map(([month, v]) => ({ month, ...v })),
    events: events.map((e) => ({ ...e, organizationName: orgs.find((o) => o.id === e.organizationId)?.name ?? null })),
  };
}

// ───────────── Revenue analytics v2 (mrr_snapshots) ─────────────

export const revenueAnalyticsInput = z.object({
  days: z.coerce.number().int().refine((d) => [30, 90, 180, 365].includes(d)).default(90).catch(90),
  currency: z.string().regex(/^[A-Z]{3}$/).optional().catch(undefined),
});

/** Thresholds below which LTV is not shown (it would be noise, not a measurement). */
export const LTV_MIN = { historyDays: 90, payingOrgs: 30, churnedOrgs: 5 } as const;

const ratio = (num: bigint, den: bigint) => (den > 0n ? Number((num * 1_000_000n) / den) / 1_000_000 : null);

/**
 * MRR history and movement from daily snapshots (one currency at a time, never converted), plan distribution,
 * revenue concentration, growth, NRR / GRR over the range, ARPU, trial conversion and — only when the data is
 * statistically meaningful — LTV.
 */
export async function revenueAnalytics(ctx: RequestContext, raw: { days?: unknown; currency?: unknown } = {}) {
  await requireAnyPlatform(ctx, READ);
  const input = revenueAnalyticsInput.parse(raw);
  const from = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - (input.days - 1) * 86_400_000);
  const currencies = await db().mrrSnapshot.findMany({ distinct: ["currency"], select: { currency: true }, orderBy: { currency: "asc" } });
  const firstAny = await db().mrrSnapshot.findFirst({ orderBy: { day: "asc" }, select: { day: true } });
  if (!currencies.length) return { state: "no_snapshots" as const, days: input.days, currencies: [] as string[], firstSnapshot: null };
  const latestPerCurrency = await db().mrrSnapshot.findMany({ where: { day: (await db().mrrSnapshot.findFirst({ orderBy: { day: "desc" }, select: { day: true } }))!.day }, select: { currency: true, mrrMinor: true } });
  const currency = input.currency && currencies.some((c) => c.currency === input.currency) ? input.currency : ([...latestPerCurrency].sort((a, b) => (b.mrrMinor > a.mrrMinor ? 1 : -1))[0]?.currency ?? currencies[0]!.currency);
  const select = { day: true, mrrMinor: true, newMinor: true, expansionMinor: true, contractionMinor: true, churnMinor: true, reactivationMinor: true, activeSubs: true, trialingSubs: true, pastDueSubs: true, payingOrgs: true, newOrgs: true, churnedOrgs: true, baseline: true, byPlan: true, computedAt: true } as const;
  const [rows, latest, first] = await Promise.all([
    db().mrrSnapshot.findMany({ where: { currency, day: { gte: from } }, orderBy: { day: "asc" }, select }),
    db().mrrSnapshot.findFirst({ where: { currency }, orderBy: { day: "desc" }, select: { ...select, orgMrr: true } }),
    db().mrrSnapshot.findFirst({ where: { currency }, orderBy: { day: "asc" }, select: { day: true } }),
  ]);
  const movementRows = rows.filter((r) => !r.baseline);
  const sum = (k: "newMinor" | "expansionMinor" | "contractionMinor" | "churnMinor" | "reactivationMinor") => movementRows.reduce((a, r) => a + r[k], 0n);
  const totals = { newMinor: sum("newMinor"), expansionMinor: sum("expansionMinor"), contractionMinor: sum("contractionMinor"), churnMinor: sum("churnMinor"), reactivationMinor: sum("reactivationMinor") };
  const start = rows[0] ?? null;
  const end = rows[rows.length - 1] ?? null;
  const historyDays = first ? Math.round((Date.now() - first.day.getTime()) / 86_400_000) + 1 : 0;
  // NRR / GRR need a starting snapshot and at least one movement day after it.
  const startMrr = start?.mrrMinor ?? 0n;
  const nrr = start && movementRows.length && startMrr > 0n ? ratio(startMrr + totals.expansionMinor + totals.reactivationMinor - totals.contractionMinor - totals.churnMinor, startMrr) : null;
  const grr = start && movementRows.length && startMrr > 0n ? ratio(startMrr - totals.contractionMinor - totals.churnMinor, startMrr) : null;
  const growth = start && end && start !== end && startMrr > 0n ? ratio(end.mrrMinor - startMrr, startMrr) : null;

  // Concentration from the latest snapshot's per-organization MRR.
  const orgMrr = Object.entries((latest?.orgMrr ?? {}) as Record<string, string>)
    .map(([org, v]) => ({ org, v: /^\d+$/.test(v) ? BigInt(v) : 0n }))
    .sort((a, b) => (b.v > a.v ? 1 : b.v < a.v ? -1 : 0));
  const total = orgMrr.reduce((a, r) => a + r.v, 0n);
  const share = (n: number) => ratio(orgMrr.slice(0, n).reduce((a, r) => a + r.v, 0n), total);
  const topOrgs = orgMrr.slice(0, 10);
  const orgs = topOrgs.length ? await db().organization.findMany({ where: { id: { in: topOrgs.map((o) => o.org) } }, select: { id: true, name: true } }) : [];

  // ARPU and LTV (ARPU / monthly logo churn), gated on enough history and volume.
  const payingOrgs = latest?.payingOrgs ?? 0;
  const arpuMinor = payingOrgs > 0 && latest ? latest.mrrMinor / BigInt(payingOrgs) : null;
  const ltvWindow = await db().mrrSnapshot.findMany({ where: { currency, baseline: false, day: { gte: new Date(Date.now() - LTV_MIN.historyDays * 86_400_000) } }, select: { churnedOrgs: true, payingOrgs: true } });
  const churned90 = ltvWindow.reduce((a, r) => a + r.churnedOrgs, 0);
  const avgPaying = ltvWindow.length ? ltvWindow.reduce((a, r) => a + r.payingOrgs, 0) / ltvWindow.length : 0;
  const monthlyLogoChurn = avgPaying > 0 ? churned90 / avgPaying / (LTV_MIN.historyDays / 30) : null;
  const ltvReasons: string[] = [];
  if (historyDays < LTV_MIN.historyDays) ltvReasons.push("history");
  if (payingOrgs < LTV_MIN.payingOrgs) ltvReasons.push("paying");
  if (churned90 < LTV_MIN.churnedOrgs) ltvReasons.push("churn");
  const ltvMinor = !ltvReasons.length && arpuMinor !== null && monthlyLogoChurn ? BigInt(Math.round(Number(arpuMinor) / monthlyLogoChurn)) : null;

  // Trial conversion: trials that ended in the range, and how many of those organizations subscribed since.
  const ended = await db().entitlementTrial.findMany({ where: { endsAt: { gte: from, lte: new Date() } }, select: { organizationId: true, startedAt: true } });
  const converted = ended.length
    ? await db().subscription.findMany({ where: { organizationId: { in: ended.map((t) => t.organizationId) }, status: { notIn: ["INCOMPLETE", "INCOMPLETE_EXPIRED"] } }, select: { organizationId: true, createdAt: true }, distinct: ["organizationId"] })
    : [];
  const startedOf = new Map(ended.map((t) => [t.organizationId, t.startedAt]));
  const conversions = converted.filter((s) => s.createdAt >= (startedOf.get(s.organizationId) ?? new Date(0))).length;

  return {
    state: "ok" as const,
    days: input.days,
    currency,
    currencies: currencies.map((c) => c.currency),
    firstSnapshot: firstAny?.day ?? null,
    historyDays,
    computedAt: latest?.computedAt ?? null,
    /** The 6-hourly job missed at least two runs. */
    stale: !!latest && Date.now() - latest.computedAt.getTime() > 13 * 3_600_000,
    series: rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), mrrMinor: r.mrrMinor, newMinor: r.newMinor, expansionMinor: r.expansionMinor, contractionMinor: r.contractionMinor, churnMinor: r.churnMinor, reactivationMinor: r.reactivationMinor, payingOrgs: r.payingOrgs, baseline: r.baseline })),
    totals,
    start: start ? { day: start.day, mrrMinor: start.mrrMinor } : null,
    end: end ? { day: end.day, mrrMinor: end.mrrMinor, activeSubs: end.activeSubs, trialingSubs: end.trialingSubs, pastDueSubs: end.pastDueSubs } : null,
    nrr,
    grr,
    growth,
    arpuMinor,
    payingOrgs,
    byPlan: Object.entries((latest?.byPlan ?? {}) as Record<string, string>).map(([plan, v]) => ({ plan, mrrMinor: /^\d+$/.test(v) ? BigInt(v) : 0n })).sort((a, b) => (b.mrrMinor > a.mrrMinor ? 1 : -1)),
    concentration: { top1: share(1), top5: share(5), top10: share(10), orgs: orgMrr.length, top: topOrgs.map((o) => ({ organizationId: o.org, name: orgs.find((x) => x.id === o.org)?.name ?? o.org, mrrMinor: o.v, share: ratio(o.v, total) })) },
    trialConversion: { ended: ended.length, converted: conversions, rate: ended.length ? conversions / ended.length : null },
    ltv: { minor: ltvMinor, reasons: ltvReasons, monthlyLogoChurn, churned90, thresholds: LTV_MIN },
  };
}
