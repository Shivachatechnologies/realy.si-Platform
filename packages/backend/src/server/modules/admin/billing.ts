import { z } from "zod";
import { db, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { billingConfig } from "@/server/modules/billing/gateway";
import { mirrorStatus } from "@/server/modules/billing/explorers";
import { prismaPage, toPage } from "@/server/core/pagination";
import { PLAN_LIMIT_KEYS, PLATFORM_MODULES, planModuleKey } from "@/server/core/platform-controls";
import { requireAnyPlatform } from "./access";
import { mrrByCurrency } from "./overview";

export const SUBSCRIPTION_STATUSES = ["INCOMPLETE", "INCOMPLETE_EXPIRED", "TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "UNPAID", "PAUSED"] as const;

const listInput = z.object({
  status: z.enum(SUBSCRIPTION_STATUSES).optional().catch(undefined),
  plan: z.string().regex(/^[a-z0-9_-]{1,64}$/).optional().catch(undefined),
  interval: z.enum(["MONTH", "YEAR"]).optional().catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional().catch(undefined),
});

/** Subscription status overview across organizations with filters, counts per status and MRR. */
export async function subscriptionOverview(ctx: RequestContext, raw: Partial<Record<keyof z.input<typeof listInput>, unknown>> = {}) {
  await requireAnyPlatform(ctx, ["platform.subscriptions.read", "pricing.read"]);
  const f = listInput.parse(raw);
  const where: Prisma.SubscriptionWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.plan ? { plan: { key: f.plan } } : {}),
    ...(f.interval ? { interval: f.interval } : {}),
    ...(f.q ? { organization: { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { slug: { contains: f.q, mode: "insensitive" } }] } } : {}),
  };
  const [rows, byStatus, byPlan, mrr, plans] = await Promise.all([
    db().subscription.findMany({
      where,
      orderBy: { id: "desc" },
      ...prismaPage({ limit: f.limit, cursor: f.cursor }),
      select: {
        id: true,
        status: true,
        interval: true,
        currency: true,
        billingCountryCode: true,
        currentPeriodEnd: true,
        trialEndsAt: true,
        cancelAtPeriodEnd: true,
        lastPaymentFailedAt: true,
        createdAt: true,
        organization: { select: { id: true, name: true, slug: true } },
        plan: { select: { key: true, name: true } },
        items: { select: { quantity: true, unitAmountMinor: true, currency: true } },
      },
    }),
    db().subscription.groupBy({ by: ["status"], _count: { _all: true } }),
    db().subscription.groupBy({ by: ["planId"], where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, _count: { _all: true } }),
    mrrByCurrency(),
    db().plan.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, key: true, name: true } }),
  ]);
  return {
    page: toPage(rows, { limit: f.limit, cursor: f.cursor }),
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) as Partial<Record<(typeof SUBSCRIPTION_STATUSES)[number], number>>,
    byPlan: plans.map((p) => ({ ...p, live: byPlan.find((b) => b.planId === p.id)?._count._all ?? 0 })),
    mrr,
    plans,
  };
}

/** Well-known plan limit/feature keys edited in Plans & Billing → Plan limits (stored as plan_entitlements). */
export const PLAN_LIMIT_FIELDS = [
  { key: PLAN_LIMIT_KEYS.seats, kind: "limit" },
  { key: PLAN_LIMIT_KEYS.companies, kind: "limit" },
  { key: PLAN_LIMIT_KEYS.aiTokensPerMonth, kind: "limit" },
  { key: PLAN_LIMIT_KEYS.apiCallsPerMonth, kind: "limit" },
  { key: PLAN_LIMIT_KEYS.storageMb, kind: "limit" },
  { key: PLAN_LIMIT_KEYS.agents, kind: "limit" },
  ...PLATFORM_MODULES.map((m) => ({ key: planModuleKey(m), kind: "module" as const })),
] as const;

// ───────────── Subscription detail (Control Center → Subscriptions → one subscription) ─────────────

/** One subscription: items with their price versions, plan, organization, mirrored invoices / payments, audit and Stripe events. */
export async function getSubscriptionDetail(ctx: RequestContext, subscriptionId: string) {
  await requireAnyPlatform(ctx, ["platform.subscriptions.read", "pricing.read"]);
  if (!/^[0-9a-f-]{36}$/.test(subscriptionId)) throw notFound("Subscription");
  const sub = await db().subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      plan: { select: { id: true, key: true, name: true, status: true } },
      organization: { select: { id: true, name: true, slug: true, status: true } },
      items: { include: { priceVersion: { include: { price: { select: { id: true, interval: true, marketType: true, marketCode: true, currency: true } } } } } },
    },
  });
  if (!sub) throw notFound("Subscription");
  const [invoices, audit, events, history, ledger] = await Promise.all([
    db().platformInvoice.findMany({ where: { OR: [{ subscriptionId: sub.id }, ...(sub.stripeSubscriptionId ? [{ stripeSubscriptionId: sub.stripeSubscriptionId }] : [])] }, orderBy: { createdAt: "desc" }, take: 24 }),
    db().auditLog.findMany({ where: { resourceType: "subscription", resourceId: sub.id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, action: true, actorId: true, actorType: true, reason: true, createdAt: true, oldValue: true, newValue: true, category: true } }),
    db().stripeEvent.findMany({ where: { organizationId: sub.organizationId }, orderBy: { processedAt: "desc" }, take: 25 }),
    db().subscription.findMany({ where: { organizationId: sub.organizationId, NOT: { id: sub.id } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, status: true, createdAt: true, canceledAt: true, plan: { select: { name: true } } } }),
    db().creditLedgerEntry.findMany({ where: { organizationId: sub.organizationId }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const payments = invoices.length ? await db().platformPayment.findMany({ where: { stripeInvoiceId: { in: invoices.map((i) => i.stripeInvoiceId) } }, orderBy: { createdAt: "desc" }, take: 50 }) : [];
  const actorIds = [...new Set(audit.map((a) => a.actorId).filter((x): x is string => !!x))];
  const actors = actorIds.length ? await db().user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const monthlyMinor = sub.items.reduce((a, i) => a + (i.unitAmountMinor * BigInt(i.quantity)) / (sub.interval === "YEAR" ? 12n : 1n), 0n);
  return {
    subscription: sub,
    monthlyMinor,
    invoices,
    payments,
    audit: audit.map((a) => ({ ...a, actorName: actors.find((u) => u.id === a.actorId)?.name ?? null })),
    events,
    history,
    ledger,
  };
}

/** Live Stripe view of the subscription (pause state); `unavailable` when Stripe is not configured or the call fails. */
export async function liveStripeSubscription(ctx: RequestContext, stripeSubscriptionId: string | null) {
  await requireAnyPlatform(ctx, ["platform.subscriptions.read", "pricing.read"]);
  if (!stripeSubscriptionId) return { state: "not_stripe" as const };
  const c = billingConfig();
  if (!c) return { state: "not_configured" as const };
  try {
    const s = await c.gateway.retrieveSubscription(stripeSubscriptionId);
    return { state: "ok" as const, status: s.status, pauseCollection: s.pauseCollection ?? null, cancelAtPeriodEnd: s.cancelAtPeriodEnd, trialEnd: s.trialEnd };
  } catch (err) {
    return { state: "unavailable" as const, error: err instanceof Error ? err.message.slice(0, 200) : "Stripe request failed" };
  }
}

// ───────────── Billing overview (Control Center → Revenue) ─────────────

type MoneyRow = { currency: string; amountMinor: bigint };
const moneyRows = (rows: { currency: string; _sum: Record<string, bigint | null> }[], field: string): MoneyRow[] =>
  rows.map((r) => ({ currency: r.currency, amountMinor: r._sum[field] ?? 0n })).filter((r) => r.amountMinor !== 0n).sort((a, b) => (b.amountMinor > a.amountMinor ? 1 : -1));

export const overviewRangeInput = z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90, 365].includes(d)).default(30).catch(30) });

/**
 * Money that actually moved, from the Stripe mirror (platform_payments / refunds / invoices), plus MRR from live
 * subscription items. Gross = succeeded charges created in the range; net = gross − refunds created in the range.
 * Tax only where Stripe reported it on the invoice. Every figure is per currency.
 */
export async function billingOverview(ctx: RequestContext, raw: { days?: unknown } = {}) {
  await requireAnyPlatform(ctx, ["platform.subscriptions.read", "pricing.read"]);
  const { days } = overviewRangeInput.parse(raw);
  const from = new Date(Date.now() - days * 86_400_000);
  const paidStatuses = ["succeeded", "partially_refunded", "refunded", "disputed"];
  const [mrr, gross, refunds, discounts, tax, taxUnknown, failed, failedSubs, outstanding, overdue, openDisputes, disputedAmount, daily, refundDaily, mirror] = await Promise.all([
    mrrByCurrency(),
    db().platformPayment.groupBy({ by: ["currency"], where: { status: { in: paidStatuses }, createdAt: { gte: from } }, _sum: { amountMinor: true } }),
    db().platformRefund.groupBy({ by: ["currency"], where: { status: "succeeded", createdAt: { gte: from } }, _sum: { amountMinor: true } }),
    db().platformInvoice.groupBy({ by: ["currency"], where: { status: "paid", createdAt: { gte: from } }, _sum: { discountMinor: true } }),
    db().platformInvoice.groupBy({ by: ["currency"], where: { status: "paid", taxKnown: true, createdAt: { gte: from } }, _sum: { taxMinor: true } }),
    db().platformInvoice.count({ where: { status: "paid", taxKnown: false, createdAt: { gte: from } } }),
    db().platformPayment.count({ where: { status: "failed", createdAt: { gte: from } } }),
    db().subscription.count({ where: { status: { in: ["PAST_DUE", "UNPAID"] } } }),
    db().platformInvoice.groupBy({ by: ["currency"], where: { status: "open" }, _sum: { amountRemainingMinor: true }, _count: { _all: true } }),
    db().platformInvoice.count({ where: { status: "open", dueAt: { lt: new Date() } } }),
    db().platformDispute.count({ where: { status: { in: ["warning_needs_response", "warning_under_review", "needs_response", "under_review"] } } }),
    db().platformDispute.groupBy({ by: ["currency"], where: { status: { in: ["warning_needs_response", "warning_under_review", "needs_response", "under_review"] } }, _sum: { amountMinor: true } }),
    db().$queryRaw<{ day: Date; currency: string; gross: bigint | null; failed: bigint }[]>(Prisma.sql`
      SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, currency,
             SUM(CASE WHEN status IN ('succeeded','partially_refunded','refunded','disputed') THEN amount_minor ELSE 0 END)::bigint AS gross,
             COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed
      FROM platform_payments WHERE created_at >= ${from} GROUP BY 1, 2`),
    db().$queryRaw<{ day: Date; currency: string; refunded: bigint | null }[]>(Prisma.sql`
      SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, currency, SUM(amount_minor)::bigint AS refunded
      FROM platform_refunds WHERE status = 'succeeded' AND created_at >= ${from} GROUP BY 1, 2`),
    mirrorStatus(),
  ]);
  const grossRows = moneyRows(gross, "amountMinor");
  const refundRows = moneyRows(refunds, "amountMinor");
  const currencies = [...new Set([...grossRows, ...refundRows].map((r) => r.currency))];
  const net = currencies
    .map((currency) => ({ currency, amountMinor: (grossRows.find((r) => r.currency === currency)?.amountMinor ?? 0n) - (refundRows.find((r) => r.currency === currency)?.amountMinor ?? 0n) }))
    .sort((a, b) => (b.amountMinor > a.amountMinor ? 1 : -1));
  // Daily series of the main currency (the one with the most gross revenue); other currencies are listed, never mixed.
  const main = net[0]?.currency ?? mrr[0]?.currency ?? null;
  const dayKeys = Array.from({ length: days }, (_, i) => new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
  const k = (d: Date) => d.toISOString().slice(0, 10);
  const series = {
    currency: main,
    days: dayKeys,
    gross: dayKeys.map((d) => Number(daily.filter((r) => r.currency === main && k(r.day) === d).reduce((a, r) => a + (r.gross ?? 0n), 0n))),
    refunds: dayKeys.map((d) => Number(refundDaily.filter((r) => r.currency === main && k(r.day) === d).reduce((a, r) => a + (r.refunded ?? 0n), 0n))),
    failed: dayKeys.map((d) => Number(daily.filter((r) => k(r.day) === d).reduce((a, r) => a + r.failed, 0n))),
  };
  return {
    days,
    configured: billingConfig() !== null,
    mrr,
    arr: mrr.map((m) => ({ currency: m.currency, amountMinor: m.amountMinor * 12n })),
    gross: grossRows,
    refunds: refundRows,
    net,
    discounts: moneyRows(discounts, "discountMinor"),
    tax: moneyRows(tax, "taxMinor"),
    taxUnknownInvoices: taxUnknown,
    failedPayments: failed,
    failedSubscriptions: failedSubs,
    outstanding: outstanding.map((o) => ({ currency: o.currency, amountMinor: o._sum.amountRemainingMinor ?? 0n, invoices: o._count._all })).filter((o) => o.invoices > 0),
    overdueInvoices: overdue,
    openDisputes,
    disputedAmount: moneyRows(disputedAmount, "amountMinor"),
    series,
    mirror,
  };
}
