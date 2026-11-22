import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { emergencyState } from "@/server/core/platform-controls";
import { breakerSnapshot } from "@/server/modules/agents/router";
import { daysAgo } from "./access";
import { sectionPermissions } from "./console-gate";
import { HEARTBEAT_STALE_MS } from "./monitoring";
import { cachedAggregate } from "./overview";
import { consolePermissions } from "./preferences";

/**
 * Action Center (stream A): one prioritised queue of everything on the platform that needs an administrator,
 * computed from data that already exists (dead-letter jobs, past-due subscriptions, failed payments, marketplace
 * reviews, admins without MFA, open AI breakers, failed webhooks, connection errors, stale workers, emergency
 * switches, failed email). Nothing is estimated: every item is a count of real rows with a link to them.
 *
 * Sources that need tables other streams have not shipped yet (alerts, incidents, support tickets, disputes,
 * access reviews, AI budgets) are listed in PENDING_SOURCES and shown as "Not yet tracked" with the owning stream.
 * When a stream ships one, it exports an `ActionSource` from its own module and stream A adds it to SOURCES.
 *
 * Every item is visible only to admins who may open its link (the console-gate section of `href`).
 * The whole queue is computed once per minute at most (cachedAggregate: memory, then Redis) and filtered per viewer.
 */

export type ActionSeverity = "critical" | "high" | "medium" | "low";
export type ActionDomain = "ops" | "billing" | "security" | "ai" | "content" | "integrations";

export interface ActionSample {
  id: string;
  label: string;
  sub?: string;
  href?: string;
  at?: string;
}

export interface ActionItem {
  /** Stable id; also usable as a sidebar badge id (`badge: "jobs.dead"` in a nav section). */
  id: string;
  domain: ActionDomain;
  severity: ActionSeverity;
  count: number;
  /** Locale-relative investigate link. Its console-gate section decides who sees the item. */
  href: string;
  /** Oldest affected row (how long it has been waiting), ISO. */
  oldestAt?: string;
  samples: ActionSample[];
}

export interface ActionSource {
  id: string;
  load(): Promise<ActionItem[]>;
}

/** Sources that need another stream's tables. Shown as "Not yet tracked", never as zero. */
export interface PendingSource {
  id: string;
  domain: ActionDomain;
  stream: "B" | "C" | "D" | "E" | "F";
  /** The missing table or feature. */
  needs: string;
  /** Where it will live once shipped. */
  href: string;
}

export const PENDING_SOURCES: readonly PendingSource[] = [
  { id: "alerts.open", domain: "ops", stream: "E", needs: "platform_alerts", href: "/alerts" },
  { id: "incidents.open", domain: "ops", stream: "E", needs: "platform_incidents", href: "/incidents" },
  { id: "support.tickets", domain: "content", stream: "F", needs: "platform_support_tickets", href: "/support" },
  { id: "billing.disputes", domain: "billing", stream: "D", needs: "platform_disputes / platform_refunds", href: "/payments" },
  { id: "access.reviews", domain: "security", stream: "B", needs: "access reviews", href: "/roles" },
  { id: "ai.budgets", domain: "ai", stream: "C", needs: "ai budget thresholds", href: "/ai" },
];

const SEVERITY_RANK: Record<ActionSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const iso = (d: Date | null | undefined) => d?.toISOString();

/** Severity from a count: `critical` at or above `crit`, `high` at or above `high`, else the base. */
const by = (count: number, base: ActionSeverity, high: number, crit = Infinity): ActionSeverity => (count >= crit ? "critical" : count >= high ? "high" : base);

const item = (i: Omit<ActionItem, "samples"> & { samples?: ActionSample[] }): ActionItem[] => (i.count > 0 ? [{ samples: [], ...i }] : []);

const deadJobs: ActionSource = {
  id: "jobs.dead",
  async load() {
    const [count, rows] = await Promise.all([
      db().workerJobRun.count({ where: { status: "DEAD" } }),
      db().workerJobRun.findMany({ where: { status: "DEAD" }, orderBy: { updatedAt: "asc" }, take: 5, select: { id: true, queue: true, jobName: true, deadLetteredAt: true, updatedAt: true } }),
    ]);
    return item({
      id: "jobs.dead",
      domain: "ops",
      severity: by(count, "medium", 5, 50),
      count,
      href: "/system/jobs?status=DEAD",
      oldestAt: iso(rows[0]?.deadLetteredAt ?? rows[0]?.updatedAt),
      samples: rows.map((r) => ({ id: r.id, label: r.jobName, sub: r.queue, href: `/system/jobs?status=DEAD&run=${r.id}`, at: iso(r.deadLetteredAt ?? r.updatedAt) })),
    });
  },
};

const pastDue: ActionSource = {
  id: "billing.pastDue",
  async load() {
    const where = { status: { in: ["PAST_DUE" as const, "UNPAID" as const] } };
    const [count, rows] = await Promise.all([
      db().subscription.count({ where }),
      db().subscription.findMany({ where, orderBy: { updatedAt: "asc" }, take: 5, select: { id: true, status: true, organizationId: true, updatedAt: true, organization: { select: { name: true } } } }),
    ]);
    return item({
      id: "billing.pastDue",
      domain: "billing",
      severity: by(count, "high", 10),
      count,
      href: "/subscriptions?status=PAST_DUE",
      oldestAt: iso(rows[0]?.updatedAt),
      samples: rows.map((r) => ({ id: r.id, label: r.organization.name, sub: r.status, href: `/plans/organizations/${r.organizationId}`, at: iso(r.updatedAt) })),
    });
  },
};

const failedPayments: ActionSource = {
  id: "billing.failedPayments",
  async load() {
    // Subscriptions whose LATEST payment attempt failed in the last 7 days (and none succeeded since).
    const rows = await db().subscription.findMany({
      where: { lastPaymentFailedAt: { gte: daysAgo(7) }, status: { notIn: ["CANCELED", "INCOMPLETE_EXPIRED"] } },
      orderBy: { lastPaymentFailedAt: "asc" },
      take: 200,
      select: { id: true, organizationId: true, lastPaymentFailedAt: true, lastPaymentSucceededAt: true, organization: { select: { name: true } } },
    });
    const open = rows.filter((r) => !r.lastPaymentSucceededAt || r.lastPaymentSucceededAt < r.lastPaymentFailedAt!);
    return item({
      id: "billing.failedPayments",
      domain: "billing",
      severity: by(open.length, "high", 5),
      count: open.length,
      href: "/ops",
      oldestAt: iso(open[0]?.lastPaymentFailedAt),
      samples: open.slice(0, 5).map((r) => ({ id: r.id, label: r.organization.name, href: `/plans/organizations/${r.organizationId}`, at: iso(r.lastPaymentFailedAt) })),
    });
  },
};

const marketplaceReview: ActionSource = {
  id: "marketplace.review",
  async load() {
    const where = { status: "IN_REVIEW" as const };
    const [count, rows] = await Promise.all([db().marketplaceListing.count({ where }), db().marketplaceListing.findMany({ where, orderBy: { updatedAt: "asc" }, take: 5, select: { id: true, name: true, updatedAt: true } })]);
    return item({
      id: "marketplace.review",
      domain: "content",
      severity: by(count, "low", 10),
      count,
      href: "/marketplace?status=IN_REVIEW",
      oldestAt: iso(rows[0]?.updatedAt),
      samples: rows.map((r) => ({ id: r.id, label: r.name, href: "/marketplace?status=IN_REVIEW", at: iso(r.updatedAt) })),
    });
  },
};

const adminsWithoutMfa: ActionSource = {
  id: "security.adminsWithoutMfa",
  async load() {
    const now = new Date();
    const grants = await db().roleAssignment.findMany({
      where: { principalType: "USER", scopeType: { in: ["PLATFORM", "REGION", "COUNTRY"] }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: { principalId: true },
      distinct: ["principalId"],
      take: 1000,
    });
    const users = await db().user.findMany({
      where: { id: { in: grants.map((g) => g.principalId) }, mfaEnabled: false, status: "ACTIVE" },
      select: { id: true, email: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return item({
      id: "security.adminsWithoutMfa",
      domain: "security",
      severity: users.length ? "critical" : "low",
      count: users.length,
      href: "/roles",
      samples: users.slice(0, 5).map((u) => ({ id: u.id, label: u.email, href: `/users/${u.id}` })),
    });
  },
};

const openBreakers: ActionSource = {
  id: "ai.breakers",
  async load() {
    const open = (await breakerSnapshot().catch(() => [])).filter((b) => b.open);
    return item({
      id: "ai.breakers",
      domain: "ai",
      severity: open.length ? "high" : "low",
      count: open.length,
      href: "/ai/models",
      samples: open.slice(0, 5).map((b) => ({ id: b.key, label: b.model, sub: b.provider, at: b.openedAt ?? undefined })),
    });
  },
};

const failedTasks: ActionSource = {
  id: "ai.failedTasks",
  async load() {
    const where = { status: "FAILED" as const, completedAt: { gte: daysAgo(1) } };
    const [count, codes] = await Promise.all([
      db().agentTask.count({ where }),
      db().agentTask.groupBy({ by: ["errorCode"], where, _count: { _all: true }, orderBy: { _count: { errorCode: "desc" } }, take: 5 }),
    ]);
    return item({
      id: "ai.failedTasks",
      domain: "ai",
      severity: by(count, "low", 20, 200),
      count,
      href: "/ai/tasks?status=FAILED",
      samples: codes.map((c) => ({ id: c.errorCode ?? "unknown", label: c.errorCode ?? "unknown", sub: String(c._count._all), href: c.errorCode ? `/ai/tasks?status=FAILED&errorCode=${encodeURIComponent(c.errorCode)}` : "/ai/tasks?status=FAILED" })),
    });
  },
};

const webhookFailures: ActionSource = {
  id: "integrations.webhookFailures",
  async load() {
    const where = { status: "FAILED" as const, updatedAt: { gte: daysAgo(7) } };
    const [count, rows] = await Promise.all([
      db().integrationWebhookDelivery.count({ where }),
      db().integrationWebhookDelivery.findMany({ where, orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, eventType: true, lastStatusCode: true, updatedAt: true } }),
    ]);
    return item({
      id: "integrations.webhookFailures",
      domain: "integrations",
      severity: by(count, "low", 25, 250),
      count,
      href: "/developers",
      samples: rows.map((r) => ({ id: r.id, label: r.eventType, sub: r.lastStatusCode ? `HTTP ${r.lastStatusCode}` : undefined, at: iso(r.updatedAt) })),
    });
  },
};

const connectionErrors: ActionSource = {
  id: "integrations.connectionErrors",
  async load() {
    const where = { status: "ERROR" as const };
    const [count, rows] = await Promise.all([
      db().integrationConnection.count({ where }),
      db().integrationConnection.findMany({ where, orderBy: { updatedAt: "asc" }, take: 5, select: { id: true, provider: true, organizationId: true, updatedAt: true } }),
    ]);
    return item({
      id: "integrations.connectionErrors",
      domain: "integrations",
      severity: by(count, "low", 20),
      count,
      href: "/integrations",
      oldestAt: iso(rows[0]?.updatedAt),
      samples: rows.map((r) => ({ id: r.id, label: r.provider, href: `/integrations?provider=${encodeURIComponent(r.provider)}`, at: iso(r.updatedAt) })),
    });
  },
};

const staleWorkers: ActionSource = {
  id: "ops.workersDown",
  async load() {
    const beats = await db().platformHeartbeat.findMany({ orderBy: { lastSeenAt: "desc" }, take: 20 }).catch(() => []);
    // Only a signal once a worker has reported at all: no heartbeat rows means "not deployed", not "down".
    if (!beats.length || Date.now() - beats[0]!.lastSeenAt.getTime() < HEARTBEAT_STALE_MS) return [];
    return item({ id: "ops.workersDown", domain: "ops", severity: "critical", count: 1, href: "/system", samples: [{ id: beats[0]!.id, label: beats[0]!.id, at: iso(beats[0]!.lastSeenAt) }] });
  },
};

const emergency: ActionSource = {
  id: "ops.emergency",
  async load() {
    const e = await emergencyState();
    return item({ id: "ops.emergency", domain: "ops", severity: "high", count: e.flags.length, href: "/controls", samples: e.flags.map((f) => ({ id: f, label: f })) });
  },
};

const failedEmail: ActionSource = {
  id: "email.failed",
  async load() {
    const count = await db().emailMessage.count({ where: { status: "FAILED", createdAt: { gte: daysAgo(1) } } });
    return item({ id: "email.failed", domain: "ops", severity: by(count, "low", 20, 200), count, href: "/ops" });
  },
};

/** Built-in sources, all from existing tables. Add another stream's `ActionSource` here once its table exists. */
export const SOURCES: readonly ActionSource[] = [deadJobs, pastDue, failedPayments, marketplaceReview, adminsWithoutMfa, openBreakers, failedTasks, webhookFailures, connectionErrors, staleWorkers, emergency, failedEmail];

export interface ActionQueue {
  items: ActionItem[];
  /** Sources that failed to load this time (shown as "Unavailable", never as zero). */
  failed: string[];
  computedAt: number;
}

/** Every source, unfiltered (cached). One failing source never hides the others. */
export async function computeActionQueue(sources: readonly ActionSource[] = SOURCES): Promise<Omit<ActionQueue, "computedAt">> {
  const results = await Promise.allSettled(sources.map((s) => s.load()));
  const items: ActionItem[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => (r.status === "fulfilled" ? items.push(...r.value) : failed.push(sources[i]!.id)));
  items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count);
  return { items, failed };
}

/** Who may see an item: the permissions of its link's console section (open sections: any admin). */
export const itemPermissions = (href: string) => sectionPermissions(`/_${href.split("?")[0]}`);

/** The viewer's Action Center: cached queue filtered to what they may open, plus the not-yet-tracked sources. */
export async function actionCenter(ctx: RequestContext): Promise<ActionQueue & { pending: PendingSource[] }> {
  const perms = new Set(await consolePermissions(ctx));
  if (!perms.size) return { items: [], failed: [], pending: [], computedAt: Date.now() };
  const visible = (href: string) => {
    const need = itemPermissions(href);
    return !need || need.some((p) => perms.has(p));
  };
  const { value, computedAt } = await cachedAggregate("actions:v1", 60_000, () => computeActionQueue());
  return {
    items: value.items.filter((i) => visible(i.href)),
    failed: value.failed.filter((id) => {
      const src = value.items.find((i) => i.id === id);
      return !src || visible(src.href);
    }),
    pending: PENDING_SOURCES.filter((p) => visible(p.href)),
    computedAt,
  };
}

/** Sidebar badge counts: every action item id, plus "actions.open" (visible items). */
export async function actionBadges(ctx: RequestContext): Promise<Record<string, number>> {
  const q = await actionCenter(ctx);
  return { "actions.open": q.items.length, ...Object.fromEntries(q.items.map((i) => [i.id, i.count])) };
}
