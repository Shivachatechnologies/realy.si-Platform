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
 * Other streams' sources are adapted here from their modules: alerts and incidents (E, `opsActionRows` /
 * `opsStatusCounts`), platform support tickets (F, `supportAttention`), open disputes (D, platform_disputes) and AI
 * budget rules at their soft limit (C, `budgetRulesAtRisk`) and open access reviews (B, platform_access_reviews).
 * Their modules load lazily (no import cycles). A future source without a table goes in PENDING_SOURCES ("Not yet
 * tracked", with the owning stream).
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

export const PENDING_SOURCES: readonly PendingSource[] = [];

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
      href: "/payments?status=failed",
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
    return item({ id: "email.failed", domain: "ops", severity: by(count, "low", 20, 200), count, href: "/email" });
  },
};

const ALERT_SEVERITY: Record<string, ActionSeverity> = { CRITICAL: "critical", WARNING: "high", INFO: "medium" };

/** Stream E: open and acknowledged alerts, and active incidents (badges `alerts.open`, `incidents.active`). */
const opsAlertsAndIncidents: ActionSource = {
  id: "ops.alertsIncidents",
  async load() {
    const { opsActionRows, opsStatusCounts } = await import("./alerts");
    const [counts, rows] = await Promise.all([opsStatusCounts(), opsActionRows({ alerts: true, incidents: true }, 20)]);
    const alerts = rows.filter((r) => r.kind === "alert");
    const incidents = rows.filter((r) => r.kind === "incident");
    const oldest = (list: typeof rows) => iso(list.reduce<Date | null>((m, r) => (!m || r.at < m ? r.at : m), null));
    const sample = (r: (typeof rows)[number]): ActionSample => ({ id: r.id, label: r.title, sub: r.status, href: r.href, at: iso(r.at) });
    return [
      ...item({
        id: "incidents.active",
        domain: "ops",
        severity: counts.incidentsMajor ? "critical" : "high",
        count: counts["incidents.active"],
        href: "/incidents",
        oldestAt: oldest(incidents),
        samples: incidents.slice(0, 5).map(sample),
      }),
      ...item({
        id: "alerts.open",
        domain: "ops",
        severity: counts.alertsCritical ? "critical" : (ALERT_SEVERITY[alerts[0]?.severity ?? "INFO"] ?? "medium"),
        count: counts["alerts.open"],
        href: "/alerts",
        oldestAt: oldest(alerts),
        samples: alerts.slice(0, 5).map(sample),
      }),
    ];
  },
};

/** Stream F: open platform support tickets; severity rises with tickets past their first-response SLA. */
const supportTickets: ActionSource = {
  id: "support.tickets",
  async load() {
    const { supportAttention } = await import("./support");
    const s = await supportAttention();
    return [
      ...item({
        id: "support.slaBreached",
        domain: "content",
        severity: by(s.breached, "high", 5, 20),
        count: s.breached,
        href: "/support?sla=breached",
        samples: s.samples.map((t) => ({ id: t.id, label: `#${t.number} ${t.subject}`, sub: t.priority, href: `/support/${t.id}`, at: iso(t.slaDueAt) })),
      }),
      ...item({ id: "support.tickets", domain: "content", severity: by(s.open, "low", 25, 100), count: s.open, href: "/support", oldestAt: iso(s.oldestAt) }),
    ];
  },
};

/** Stream D: open Stripe disputes (platform_disputes), the nearest evidence deadline first. */
const openDisputes: ActionSource = {
  id: "billing.disputes",
  async load() {
    const { OPEN_DISPUTE_STATUSES } = await import("@/server/modules/billing/explorers");
    const where = { status: { in: OPEN_DISPUTE_STATUSES } };
    const [count, rows] = await Promise.all([
      db().platformDispute.count({ where }),
      db().platformDispute.findMany({ where, orderBy: [{ evidenceDueBy: { sort: "asc", nulls: "last" } }], take: 5, select: { id: true, reason: true, status: true, evidenceDueBy: true, createdAt: true } }),
    ]);
    const dueSoon = rows.some((r) => r.evidenceDueBy && r.evidenceDueBy.getTime() - Date.now() < 3 * 86_400_000);
    return item({
      id: "billing.disputes",
      domain: "billing",
      severity: dueSoon ? "critical" : "high",
      count,
      href: "/payments/disputes?open=1",
      oldestAt: iso(rows.reduce<Date | null>((m, r) => (!m || r.createdAt < m ? r.createdAt : m), null)),
      samples: rows.map((r) => ({ id: r.id, label: r.reason, sub: r.status, href: `/payments/disputes/${r.id}`, at: iso(r.evidenceDueBy ?? r.createdAt) })),
    });
  },
};

/** Stream C: platform AI budget rules at or over their soft limit this period. */
const aiBudgets: ActionSource = {
  id: "ai.budgets",
  async load() {
    const { budgetRulesAtRisk } = await import("./ai-budgets");
    const rules = await budgetRulesAtRisk();
    const over = rules.filter((r) => r.pct >= 1);
    return item({
      id: "ai.budgets",
      domain: "ai",
      severity: over.some((r) => r.hard) ? "critical" : over.length ? "high" : "medium",
      count: rules.length,
      href: "/ai/budgets",
      samples: rules.slice(0, 5).map((r) => ({ id: r.id, label: `${r.level}: ${r.key}`, sub: `${Math.round(r.pct * 100)}% · ${r.period}` })),
    });
  },
};

/** Stream B: open platform access reviews; overdue ones (past `dueAt`) raise the severity. */
const accessReviews: ActionSource = {
  id: "access.reviews",
  async load() {
    const rows = await db().platformAccessReview.findMany({ where: { status: "OPEN" }, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }], take: 50, select: { id: true, title: true, dueAt: true, createdAt: true } });
    const overdue = rows.filter((r) => r.dueAt && r.dueAt.getTime() < Date.now()).length;
    return item({
      id: "access.reviews",
      domain: "security",
      severity: overdue ? "high" : "medium",
      count: rows.length,
      href: "/roles/reviews",
      oldestAt: iso(rows.reduce<Date | null>((m, r) => (!m || r.createdAt < m ? r.createdAt : m), null)),
      samples: rows.slice(0, 5).map((r) => ({ id: r.id, label: r.title, href: `/roles/reviews/${r.id}`, at: iso(r.dueAt ?? r.createdAt) })),
    });
  },
};

/** Every source. Another stream's module is adapted above and loaded lazily. */
export const SOURCES: readonly ActionSource[] = [
  opsAlertsAndIncidents,
  deadJobs,
  pastDue,
  failedPayments,
  openDisputes,
  supportTickets,
  marketplaceReview,
  adminsWithoutMfa,
  accessReviews,
  openBreakers,
  failedTasks,
  aiBudgets,
  webhookFailures,
  connectionErrors,
  staleWorkers,
  emergency,
  failedEmail,
];

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
  const { value, computedAt } = await cachedAggregate("actions:v2", 60_000, () => computeActionQueue());
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
