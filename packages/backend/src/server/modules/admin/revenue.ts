import Stripe from "stripe";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { env } from "@/server/core/env";
import { logger } from "@/server/core/logger";
import { daysAgo, requireAnyPlatform } from "./access";
import { mrrByCurrency } from "./overview";

/**
 * Revenue (Admin → Plans & Billing → Revenue): MRR/ARR, new / churned / expansion MRR, MRR by plan and billing
 * country, recent Stripe invoice events and — when Stripe is connected — the latest invoices straight from Stripe.
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

let stripe: Stripe | null = null;

async function stripeInvoices() {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) return { connected: false as const, invoices: [], error: null };
  try {
    stripe ??= new Stripe(key, { maxNetworkRetries: 1, timeout: 10_000, appInfo: { name: "Realy Control Center" } });
    const res = await stripe.invoices.list({ limit: 25 });
    return {
      connected: true as const,
      livemode: res.data[0]?.livemode ?? !key.startsWith("sk_test"),
      error: null,
      invoices: res.data.map((i) => ({
        id: i.id ?? "",
        number: i.number,
        status: i.status,
        customerEmail: i.customer_email,
        customerName: i.customer_name,
        amountDue: BigInt(i.amount_due),
        amountPaid: BigInt(i.amount_paid),
        currency: i.currency.toUpperCase(),
        created: new Date(i.created * 1000),
        hostedUrl: i.hosted_invoice_url ?? null,
      })),
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "stripe invoices unavailable");
    return { connected: true as const, invoices: [], error: err instanceof Error ? err.message.slice(0, 200) : "Stripe request failed" };
  }
}

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
    stripe: await stripeInvoices(),
  };
}
