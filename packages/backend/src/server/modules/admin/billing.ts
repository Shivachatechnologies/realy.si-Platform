import { z } from "zod";
import { db, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
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
