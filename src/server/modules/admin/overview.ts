import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { costMicros } from "@/server/modules/workforce/pricing";
import { daysAgo, requireAnyPlatform, utcMonthStart } from "./access";
import { platformHealth, queueCounts } from "./monitoring";

const LIVE_SUBSCRIPTION = ["ACTIVE", "TRIALING", "PAST_DUE"] as const;

/**
 * Monthly recurring revenue per currency, in minor units, from live subscription items (quantity × unit amount;
 * yearly items count 1/12). Only real subscription rows: no estimate when there are none.
 */
export async function mrrByCurrency() {
  const items = await db().subscriptionItem.findMany({
    where: { subscription: { status: { in: ["ACTIVE", "PAST_DUE"] } } },
    select: { quantity: true, unitAmountMinor: true, currency: true, subscription: { select: { interval: true } } },
  });
  const out = new Map<string, bigint>();
  for (const i of items) {
    const amount = i.unitAmountMinor * BigInt(i.quantity);
    const monthly = i.subscription.interval === "YEAR" ? amount / 12n : amount;
    out.set(i.currency, (out.get(i.currency) ?? 0n) + monthly);
  }
  return [...out].map(([currency, amountMinor]) => ({ currency, amountMinor })).sort((a, b) => (b.amountMinor > a.amountMinor ? 1 : -1));
}

/** Tokens and estimated cost (micro-USD) of AI tasks since `since`, priced per model (workforce/pricing.ts). */
export async function aiUsageSince(since: Date, where: { organizationId?: string } = {}) {
  const rows = await db().agentTask.groupBy({
    by: ["model"],
    where: { ...where, startedAt: { gte: since } },
    _sum: { inputTokens: true, outputTokens: true },
    _count: { _all: true },
  });
  let input = 0;
  let output = 0;
  let micros = 0;
  for (const r of rows) {
    const i = r._sum.inputTokens ?? 0;
    const o = r._sum.outputTokens ?? 0;
    input += i;
    output += o;
    micros += costMicros(r.model, i, o);
  }
  return { inputTokens: input, outputTokens: output, tokens: input + output, costMicros: micros };
}

/** Every Overview number comes straight from the database (or Redis for queues). */
export async function platformOverview(ctx: RequestContext) {
  await requireAnyPlatform(ctx, ["platform.users.read", "platform.organizations.read", "platform.audit.read"]);
  const d7 = daysAgo(7);
  const d30 = daysAgo(30);
  const h24 = daysAgo(1);
  const sessionActive = (since: Date) =>
    db().session.findMany({ where: { lastSeenAt: { gte: since } }, distinct: ["userId"], select: { userId: true } }).then((r) => r.length);
  const [
    users,
    organizations,
    companies,
    active7,
    active30,
    new7,
    new30,
    subscriptions,
    trialing,
    mrr,
    employeesActive,
    employeesPaused,
    tasksRunning,
    tasksQueued,
    tasksFailed24,
    aiMonth,
    apiRequests30,
    pendingApprovals,
    health,
    queues,
    recentAdmin,
    suspendedOrgs,
  ] = await Promise.all([
    db().user.count({ where: { status: { not: "DELETED" } } }),
    db().organization.count(),
    db().company.count({ where: { deletedAt: null } }),
    sessionActive(d7),
    sessionActive(d30),
    db().user.count({ where: { createdAt: { gte: d7 } } }),
    db().user.count({ where: { createdAt: { gte: d30 } } }),
    db().subscription.count({ where: { status: { in: [...LIVE_SUBSCRIPTION] } } }),
    db().subscription.count({ where: { status: "TRIALING" } }),
    mrrByCurrency(),
    db().aiEmployee.count({ where: { archivedAt: null, status: "ACTIVE" } }),
    db().aiEmployee.count({ where: { archivedAt: null, status: "PAUSED" } }),
    db().agentTask.count({ where: { status: "RUNNING" } }),
    db().agentTask.count({ where: { status: "QUEUED" } }),
    db().agentTask.count({ where: { status: "FAILED", completedAt: { gte: h24 } } }),
    aiUsageSince(utcMonthStart()),
    db().usageRecord.aggregate({ where: { meter: "api.request", occurredAt: { gte: d30 } }, _sum: { quantity: true } }).then((r) => Number(r._sum.quantity ?? 0)),
    db().approval.count({ where: { status: "PENDING" } }),
    platformHealth(),
    queueCounts(),
    db().auditLog.findMany({ where: { category: { in: ["ADMIN", "SECURITY"] }, organizationId: null }, orderBy: { createdAt: "desc" }, take: 10 }),
    db().organization.count({ where: { status: "SUSPENDED" } }),
  ]);
  const actorIds = [...new Set(recentAdmin.map((a) => a.actorId).filter((x): x is string => !!x))];
  const actors = await db().user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } });
  return {
    users,
    organizations,
    companies,
    suspendedOrgs,
    active: { d7: active7, d30: active30 },
    registrations: { d7: new7, d30: new30 },
    subscriptions: { live: subscriptions, trialing },
    mrr,
    aiEmployees: { active: employeesActive, paused: employeesPaused },
    tasks: { running: tasksRunning, queued: tasksQueued, failed24h: tasksFailed24 },
    aiMonth,
    apiRequests30,
    pendingApprovals,
    health,
    queues,
    recentAdmin: recentAdmin.map((a) => ({ ...a, actorEmail: actors.find((u) => u.id === a.actorId)?.email ?? null })),
  };
}
