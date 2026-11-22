import { z } from "zod";
import { db, Prisma, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { getControls } from "@/server/core/platform-controls";
import { WORKER_STALE_MS } from "@/server/core/job-admin";
import { workerConfigured } from "@/server/core/jobs";
import { pageInput, prismaPage, toPage } from "@/server/core/pagination";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { reasonSchema, requireAnyPlatform, requirePlatform } from "./access";
import { notifyAdmins, type AdminNotificationInput } from "./notifications";
import { BACKLOG_CRITICAL, BACKLOG_WARN, latestChecks, serviceDef, type HealthStatus } from "./health";
import { createIncident, openIncidentForAlert } from "./incidents";

/**
 * Alert engine and center (stream E). Real threshold rules over data the platform already stores, evaluated every
 * 5 minutes by the worker job `ops.monitor` (right after the health probes). Each firing has a fingerprint (rule +
 * subject): while an alert with that fingerprint is not RESOLVED, a repeat firing only bumps its count (dedupe).
 * Alerts of one rule and service share a `groupKey` (grouping). When a rule evaluates and a condition no longer
 * holds, its alert resolves itself. Storm control: at most MAX_NEW_PER_RUN new alerts per run (the rest fold into one
 * "alerts.storm" alert), at most MAX_NOTIFY_PER_RUN notifications per run, one notification per group per run, and
 * no re-notification of the same alert within RENOTIFY_MS. Notifications go through stream A's `notifyAdmins`.
 */

export const ALERT_READ = ["platform.incidents.read", "platform.alerts.manage"];
export const ALERT_MANAGE = "platform.alerts.manage";

export const ALERT_STATUSES = ["OPEN", "ACKNOWLEDGED", "SNOOZED", "RESOLVED"] as const;
export const ALERT_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
type Severity = (typeof ALERT_SEVERITIES)[number];
const SEV_RANK: Record<Severity, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };
const ACTIVE = ["OPEN", "ACKNOWLEDGED", "SNOOZED"] as const;

const MIN = 60_000;
export const MAX_NEW_PER_RUN = 25;
export const MAX_NOTIFY_PER_RUN = 10;
export const RENOTIFY_MS = 30 * MIN;
/** Unacknowledged CRITICAL alerts escalate after these delays (level 1, level 2). */
export const ESCALATE_AFTER_MS = [15 * MIN, 60 * MIN] as const;

/**
 * Notification policy per severity. INFO: alert center only. WARNING: incident readers on raise. CRITICAL: alert
 * managers and incident managers on raise; escalation level 1 notifies control managers, level 2 every alert manager
 * again (CRITICAL). Delivery channel: stream A's admin notifications (in-app; email when A enables it).
 */
export const NOTIFICATION_POLICY: Record<Severity, { onRaise: string[]; escalation: string[][] }> = {
  INFO: { onRaise: [], escalation: [] },
  WARNING: { onRaise: ["platform.incidents.read"], escalation: [] },
  CRITICAL: { onRaise: ["platform.alerts.manage", "platform.incidents.manage"], escalation: [["platform.controls.manage"], ["platform.alerts.manage"]] },
};

export interface Firing {
  fingerprint: string;
  service?: string | null;
  severity: Severity;
  title: string;
  detail?: Record<string, unknown>;
  organizationId?: string | null;
}

interface EvalContext {
  checks: Awaited<ReturnType<typeof latestChecks>>;
  now: number;
}

export interface AlertRule {
  key: string;
  /** Default service for grouping. */
  service: string | null;
  /** Human-readable threshold (shown on the rules list). */
  threshold: string;
  /** Open an incident automatically when a CRITICAL firing of this rule is raised. */
  autoIncident?: (f: Firing) => boolean;
  /** Firings, or null when the data needed is unavailable (the rule is skipped and nothing auto-resolves). */
  evaluate(c: EvalContext): Promise<Firing[] | null>;
}

const since = (ms: number) => new Date(Date.now() - ms);

const fresh = (c: EvalContext, service: string, maxAgeMs: number) => {
  const chk = c.checks.get(service);
  return chk && c.now - chk.checkedAt.getTime() <= maxAgeMs ? chk : null;
};

export const ALERT_RULES: readonly AlertRule[] = [
  {
    key: "queue.backlog",
    service: "queues",
    threshold: `waiting + delayed ≥ ${BACKLOG_WARN} (warning), ≥ ${BACKLOG_CRITICAL} (critical), per queue`,
    async evaluate(c) {
      const chk = fresh(c, "queues", 35 * MIN);
      const queues = (chk?.detail as { queues?: { name: string; available: boolean; waiting: number; delayed: number }[] } | null)?.queues;
      if (!chk || !queues) return null;
      return queues
        .filter((q) => q.available && q.name !== "dead-letter" && q.waiting + q.delayed >= BACKLOG_WARN)
        .map((q) => ({
          fingerprint: `queue.backlog:${q.name}`,
          severity: q.waiting + q.delayed >= BACKLOG_CRITICAL ? ("CRITICAL" as const) : ("WARNING" as const),
          title: `Queue ${q.name} backlog: ${q.waiting + q.delayed} jobs`,
          detail: { queue: q.name, waiting: q.waiting, delayed: q.delayed, threshold: BACKLOG_WARN, checkedAt: chk.checkedAt.toISOString() },
        }));
    },
  },
  {
    key: "dlq.growth",
    service: "queues",
    threshold: "≥ 5 jobs dead-lettered in the last hour (warning), ≥ 25 (critical)",
    async evaluate() {
      const n = await db().workerJobRun.count({ where: { deadLetteredAt: { gte: since(60 * MIN) } } });
      if (n < 5) return [];
      const byQueue = await db().workerJobRun.groupBy({ by: ["queue"], where: { deadLetteredAt: { gte: since(60 * MIN) } }, _count: { _all: true } });
      return [{ fingerprint: "dlq.growth", severity: n >= 25 ? "CRITICAL" : "WARNING", title: `${n} jobs dead-lettered in the last hour`, detail: { count: n, byQueue: Object.fromEntries(byQueue.map((q) => [q.queue, q._count._all])) } }];
    },
  },
  {
    key: "worker.stale",
    service: "workers",
    threshold: "a worker heartbeat older than 3 minutes (warning); no live worker at all (critical)",
    autoIncident: (f) => f.fingerprint === "worker.none_alive",
    async evaluate() {
      if (!workerConfigured()) return [];
      const rows = await db().platformHeartbeat.findMany({ where: { kind: "worker", lastSeenAt: { gte: since(24 * 60 * MIN) } }, select: { id: true, hostname: true, pid: true, lastSeenAt: true } });
      const stale = rows.filter((r) => Date.now() - r.lastSeenAt.getTime() >= WORKER_STALE_MS);
      const out: Firing[] = stale.map((r) => ({ fingerprint: `worker.stale:${r.id}`, severity: "WARNING", title: `Worker ${r.hostname}:${r.pid} stopped reporting`, detail: { workerId: r.id, lastSeenAt: r.lastSeenAt.toISOString() } }));
      if (rows.length && stale.length === rows.length) out.push({ fingerprint: "worker.none_alive", severity: "CRITICAL", title: "No live background worker", detail: { workers: rows.length } });
      return out;
    },
  },
  {
    key: "ai.breaker_open",
    service: null,
    threshold: "an AI provider circuit breaker is open",
    async evaluate() {
      const snap = await import("@/server/modules/agents/router").then((m) => m.breakerSnapshot()).catch(() => null);
      if (!snap) return null;
      return snap
        .filter((b) => b.open)
        .map((b) => ({ fingerprint: `ai.breaker_open:${b.key}`, service: `ai.${b.provider}`, severity: "WARNING" as const, title: `AI breaker open: ${b.provider} ${b.model}`, detail: { provider: b.provider, model: b.model, failures: b.failures, openedAt: b.openedAt } }));
    },
  },
  {
    key: "errors.spike",
    service: "api",
    threshold: "≥ 20 server errors in 15 minutes and ≥ 3× the 24 h baseline (warning), ≥ 100 (critical)",
    async evaluate() {
      const [recent, day] = await Promise.all([
        db().errorEvent.count({ where: { createdAt: { gte: since(15 * MIN) } } }),
        db().errorEvent.count({ where: { createdAt: { gte: since(24 * 60 * MIN), lt: since(15 * MIN) } } }),
      ]);
      const baseline = day / 95;
      if (recent < 20 || recent < 3 * baseline) return [];
      return [{ fingerprint: "errors.spike", severity: recent >= 100 ? "CRITICAL" : "WARNING", title: `${recent} server errors in 15 minutes`, detail: { last15m: recent, baselinePer15m: Math.round(baseline * 10) / 10 } }];
    },
  },
  {
    key: "errors.group_spike",
    service: "api",
    threshold: "one error group ≥ 50 events in 15 minutes",
    async evaluate() {
      const rows = await db().errorEvent.groupBy({ by: ["groupId"], where: { createdAt: { gte: since(15 * MIN) } }, _count: { _all: true }, having: { groupId: { _count: { gte: 50 } } }, orderBy: { _count: { groupId: "desc" } }, take: 20 });
      if (!rows.length) return [];
      const groups = await db().errorGroup.findMany({ where: { id: { in: rows.map((r) => r.groupId) } }, select: { id: true, name: true, source: true, route: true } });
      return rows.map((r) => {
        const g = groups.find((x) => x.id === r.groupId);
        return { fingerprint: `errors.group_spike:${r.groupId}`, service: g?.source === "worker" ? "workers" : "api", severity: "WARNING" as const, title: `${g?.name ?? "Error"} ×${r._count._all} in 15 minutes`, detail: { groupId: r.groupId, last15m: r._count._all, route: g?.route ?? null } };
      });
    },
  },
  {
    key: "payments.failed",
    service: "payments",
    threshold: "≥ 3 invoice.payment_failed Stripe events in the last hour (warning), ≥ 10 (critical)",
    async evaluate() {
      const n = await db().stripeEvent.count({ where: { type: "invoice.payment_failed", processedAt: { gte: since(60 * MIN) } } });
      if (n < 3) return [];
      return [{ fingerprint: "payments.failed", severity: n >= 10 ? "CRITICAL" : "WARNING", title: `${n} failed payments in the last hour`, detail: { lastHour: n } }];
    },
  },
  {
    key: "budget.ai_tokens",
    service: null,
    threshold: "platform AI token budget ≥ 80 % used (warning), ≥ 100 % (critical)",
    async evaluate() {
      const c = await getControls();
      const out: Firing[] = [];
      const d = new Date();
      const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const month = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      for (const [kind, budget, from] of [["daily", c.aiDailyTokenBudget, day], ["monthly", c.aiMonthlyTokenBudget, month]] as const) {
        if (budget === null || budget <= 0) continue;
        const r = await db().agentTask.aggregate({ where: { startedAt: { gte: from } }, _sum: { inputTokens: true, outputTokens: true } });
        const used = (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0);
        const share = used / budget;
        if (share >= 0.8) out.push({ fingerprint: `budget.ai_tokens:${kind}`, severity: share >= 1 ? "CRITICAL" : "WARNING", title: `Platform AI ${kind} token budget ${Math.round(share * 100)} % used`, detail: { kind, used, budget, percent: Math.round(share * 1000) / 10 } });
      }
      return out;
    },
  },
  {
    key: "health.down",
    service: null,
    threshold: "a configured service DOWN or CRITICAL on its last 2 checks (critical), DEGRADED on its last 3 (warning)",
    autoIncident: (f) => f.severity === "CRITICAL" && !!serviceDef(f.service ?? "")?.core,
    async evaluate() {
      const rows = await db().$queryRaw<{ service: string; status: HealthStatus; rn: number; checked_at: Date }[]>(Prisma.sql`
        SELECT service, status::text AS status, rn::int AS rn, checked_at FROM (
          SELECT service, status, checked_at, ROW_NUMBER() OVER (PARTITION BY service ORDER BY checked_at DESC) AS rn
          FROM service_health_checks WHERE checked_at >= now() - interval '2 hours'
        ) t WHERE rn <= 3`);
      const by = new Map<string, HealthStatus[]>();
      for (const r of rows.sort((a, b) => a.rn - b.rn)) by.set(r.service, [...(by.get(r.service) ?? []), r.status]);
      const out: Firing[] = [];
      for (const [service, list] of by) {
        const bad = (s: HealthStatus) => s === "DOWN" || s === "CRITICAL";
        if (list.length >= 2 && bad(list[0]!) && bad(list[1]!)) out.push({ fingerprint: `health.down:${service}`, service, severity: "CRITICAL", title: `${service} is ${list[0]!.toLowerCase()}`, detail: { last: list } });
        else if (list.length >= 3 && list.every((s) => s === "DEGRADED")) out.push({ fingerprint: `health.degraded:${service}`, service, severity: "WARNING", title: `${service} degraded for 3 checks`, detail: { last: list } });
      }
      return out;
    },
  },
  {
    key: "webhooks.failure_rate",
    service: "webhooks",
    threshold: "≥ 25 % of ≥ 20 webhook deliveries failed in the last hour",
    async evaluate(c) {
      const chk = fresh(c, "webhooks", 20 * MIN);
      if (!chk) return null;
      const d = chk.detail as { delivered1h?: number; failed1h?: number };
      const total = (d.delivered1h ?? 0) + (d.failed1h ?? 0);
      if (total < 20 || (d.failed1h ?? 0) / total < 0.25) return [];
      return [{ fingerprint: "webhooks.failure_rate", severity: "WARNING", title: `${d.failed1h} of ${total} webhook deliveries failed`, detail: { failed1h: d.failed1h, delivered1h: d.delivered1h } }];
    },
  },
];

export const ALERT_RULE_KEYS = [...ALERT_RULES.map((r) => r.key), "alerts.storm"];

/** Where to investigate an alert (locale-relative console links). Every alert has at least one. */
export function investigateLinks(rule: string, detail: Record<string, unknown>, service: string | null): { key: string; href: string }[] {
  const s = (v: unknown) => (typeof v === "string" ? encodeURIComponent(v) : "");
  switch (rule) {
    case "queue.backlog":
      return [{ key: "jobs", href: `/system/jobs?queue=${s(detail.queue)}` }, { key: "health", href: "/health/queues" }];
    case "dlq.growth":
      return [{ key: "dlq", href: "/system/jobs?status=DEAD" }];
    case "worker.stale":
      return [{ key: "jobs", href: "/system/jobs" }, { key: "infra", href: "/infra" }];
    case "ai.breaker_open":
      return [{ key: "aiModels", href: "/ai/models" }, { key: "health", href: `/health/${service ?? "ai.anthropic"}` }];
    case "errors.spike":
      return [{ key: "errors", href: "/errors?since=1h" }];
    case "errors.group_spike":
      return [{ key: "errorGroup", href: `/errors/${s(detail.groupId)}` }];
    case "payments.failed":
      return [{ key: "payments", href: "/payments" }, { key: "health", href: "/health/payments" }];
    case "budget.ai_tokens":
      return [{ key: "aiUsage", href: "/ai/usage" }, { key: "controls", href: "/controls" }];
    case "health.down":
      return [{ key: "health", href: `/health/${service ?? ""}` }];
    case "webhooks.failure_rate":
      return [{ key: "developers", href: "/developers" }, { key: "health", href: "/health/webhooks" }];
    default:
      return [{ key: "alerts", href: "/alerts" }];
  }
}

// ───────────── Engine ─────────────

interface RunState {
  created: number;
  suppressed: Firing[];
  notifications: number;
  notifiedGroups: Set<string>;
  newByGroup: Map<string, number>;
}

async function notify(alert: { id: string; title: string; severity: Severity; groupKey: string }, permissions: string[], run: RunState, type: string, title = alert.title) {
  if (!permissions.length || run.notifications >= MAX_NOTIFY_PER_RUN) return false;
  run.notifications++;
  for (const permission of permissions) {
    const input: AdminNotificationInput = { permission, type, severity: alert.severity, title, href: `/alerts/${alert.id}`, dedupeKey: `alert:${alert.id}:${type}` };
    await notifyAdmins(null, input).catch(() => undefined);
  }
  await db().platformAlert.update({ where: { id: alert.id }, data: { lastNotifiedAt: new Date(), events: { create: { kind: "notified", note: `${type} → ${permissions.join(", ")}` } } } });
  return true;
}

async function raise(rule: AlertRule | { key: string; service: string | null; autoIncident?: undefined }, f: Firing, run: RunState): Promise<"new" | "repeat" | "suppressed"> {
  const service = f.service === undefined ? rule.service : f.service;
  const groupKey = `${rule.key}:${service ?? "platform"}`;
  const existing = await db().platformAlert.findFirst({ where: { fingerprint: f.fingerprint, status: { in: [...ACTIVE] } }, orderBy: { lastSeenAt: "desc" } });
  if (existing) {
    const up = SEV_RANK[f.severity] > SEV_RANK[existing.severity];
    await db().platformAlert.update({
      where: { id: existing.id },
      data: {
        count: { increment: 1 },
        lastSeenAt: new Date(),
        title: f.title.slice(0, 300),
        detail: (f.detail ?? {}) as Prisma.InputJsonValue,
        ...(up ? { severity: f.severity, events: { create: { kind: "repeated", note: `${existing.severity} → ${f.severity}` } } } : {}),
      },
    });
    if (up && existing.status !== "SNOOZED") await notify({ ...existing, severity: f.severity }, NOTIFICATION_POLICY[f.severity].onRaise, run, "alert.severity_raised", f.title);
    return "repeat";
  }
  if (run.created >= MAX_NEW_PER_RUN) {
    run.suppressed.push(f);
    return "suppressed";
  }
  run.created++;
  const alert = await transaction(async (tx) => {
    const a = await tx.platformAlert.create({
      data: { fingerprint: f.fingerprint, rule: rule.key, groupKey, service, severity: f.severity, title: f.title.slice(0, 300), detail: (f.detail ?? {}) as Prisma.InputJsonValue, organizationId: f.organizationId ?? null, events: { create: { kind: "raised" } } },
    });
    await emitEvent(tx, systemContext(), "platform.alert.raised", { alertId: a.id, rule: rule.key, severity: f.severity, service, fingerprint: f.fingerprint }, { aggregateType: "platform_alert", aggregateId: a.id });
    return a;
  });
  run.newByGroup.set(groupKey, (run.newByGroup.get(groupKey) ?? 0) + 1);
  // Grouping: one notification per group per run; later alerts of the group are visible in the center.
  if (!run.notifiedGroups.has(groupKey)) {
    run.notifiedGroups.add(groupKey);
    await notify(alert, NOTIFICATION_POLICY[f.severity].onRaise, run, "alert.raised");
  }
  if (f.severity === "CRITICAL" && rule.autoIncident?.(f)) {
    await openIncidentForAlert(alert).catch((err) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "auto incident failed"));
  }
  return "new";
}

async function autoResolve(ruleKey: string, firing: Set<string>): Promise<number> {
  const active = await db().platformAlert.findMany({ where: { rule: ruleKey, status: { in: [...ACTIVE] } }, select: { id: true, fingerprint: true } });
  const gone = active.filter((a) => !firing.has(a.fingerprint));
  for (const a of gone) {
    await transaction(async (tx) => {
      await tx.platformAlert.update({ where: { id: a.id }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedBy: "rule", events: { create: { kind: "auto_resolved", note: "condition cleared" } } } });
      await emitEvent(tx, systemContext(), "platform.alert.resolved", { alertId: a.id, rule: ruleKey, by: "rule" }, { aggregateType: "platform_alert", aggregateId: a.id });
    });
  }
  return gone.length;
}

async function wakeSnoozed(run: RunState) {
  const due = await db().platformAlert.findMany({ where: { status: "SNOOZED", snoozedUntil: { lte: new Date() } }, take: 100 });
  for (const a of due) {
    await db().platformAlert.update({ where: { id: a.id }, data: { status: "OPEN", snoozedUntil: null, events: { create: { kind: "unsnoozed", note: "snooze expired" } } } });
    await notify(a, NOTIFICATION_POLICY[a.severity].onRaise, run, "alert.unsnoozed");
  }
}

async function escalate(run: RunState) {
  for (let level = 0; level < ESCALATE_AFTER_MS.length; level++) {
    const due = await db().platformAlert.findMany({ where: { status: "OPEN", severity: "CRITICAL", escalationLevel: level, firstSeenAt: { lte: since(ESCALATE_AFTER_MS[level]!) } }, take: 50 });
    for (const a of due) {
      if (a.lastNotifiedAt && Date.now() - a.lastNotifiedAt.getTime() < RENOTIFY_MS && level > 0) continue;
      await transaction(async (tx) => {
        await tx.platformAlert.update({ where: { id: a.id }, data: { escalationLevel: level + 1, escalatedAt: new Date(), events: { create: { kind: "escalated", note: `level ${level + 1} (unacknowledged)` } } } });
        await emitEvent(tx, systemContext(), "platform.alert.escalated", { alertId: a.id, rule: a.rule, level: level + 1 }, { aggregateType: "platform_alert", aggregateId: a.id });
      });
      await notify(a, NOTIFICATION_POLICY.CRITICAL.escalation[level] ?? [], run, `alert.escalated.${level + 1}`);
    }
  }
}

export interface EvaluationSummary {
  rules: { key: string; firing: number; skipped: boolean; error?: string }[];
  created: number;
  resolved: number;
  suppressed: number;
  notifications: number;
}

/** One evaluation pass (worker job `ops.monitor`; also run from tests). */
export async function evaluateAlertRules(): Promise<EvaluationSummary> {
  const checks = await latestChecks().catch(() => new Map() as Awaited<ReturnType<typeof latestChecks>>);
  const c: EvalContext = { checks, now: Date.now() };
  const run: RunState = { created: 0, suppressed: [], notifications: 0, notifiedGroups: new Set(), newByGroup: new Map() };
  const summary: EvaluationSummary = { rules: [], created: 0, resolved: 0, suppressed: 0, notifications: 0 };
  for (const rule of ALERT_RULES) {
    try {
      const firings = await rule.evaluate(c);
      if (firings === null) {
        summary.rules.push({ key: rule.key, firing: 0, skipped: true });
        continue;
      }
      for (const f of firings) await raise(rule, f, run);
      // Suppressed firings never got an alert row; keep any existing alert of theirs open.
      summary.resolved += await autoResolve(rule.key, new Set(firings.map((f) => f.fingerprint)));
      summary.rules.push({ key: rule.key, firing: firings.length, skipped: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ rule: rule.key, err: message }, "alert rule failed");
      summary.rules.push({ key: rule.key, firing: 0, skipped: true, error: message.slice(0, 200) });
    }
  }
  const storm = { key: "alerts.storm", service: null };
  if (run.suppressed.length) {
    run.created = 0; // the storm alert itself must not be suppressed
    await raise(storm, { fingerprint: "alerts.storm", severity: "CRITICAL", title: `Alert storm: ${run.suppressed.length} more alerts suppressed`, detail: { suppressed: run.suppressed.length, fingerprints: run.suppressed.slice(0, 50).map((f) => f.fingerprint) } }, run);
  } else {
    summary.resolved += await autoResolve("alerts.storm", new Set());
  }
  await wakeSnoozed(run);
  await escalate(run);
  summary.created = run.created;
  summary.suppressed = run.suppressed.length;
  summary.notifications = run.notifications;
  return summary;
}

// ───────────── Alert center ─────────────

export const alertFilters = pageInput.extend({
  status: z.enum(ALERT_STATUSES).optional(),
  state: z.enum(["active", "all"]).optional(),
  severity: z.enum(ALERT_SEVERITIES).optional(),
  rule: z.string().max(60).optional(),
  service: z.string().max(40).optional(),
  assignee: z.string().uuid().optional(),
  q: z.string().trim().max(200).optional(),
});

export async function listAlerts(ctx: RequestContext, raw: z.input<typeof alertFilters> = {}) {
  await requireAnyPlatform(ctx, ALERT_READ);
  const f = alertFilters.parse(raw);
  const where: Prisma.PlatformAlertWhereInput = {
    ...(f.status ? { status: f.status } : f.state === "all" ? {} : { status: { in: [...ACTIVE] } }),
    ...(f.severity ? { severity: f.severity } : {}),
    ...(f.rule ? { rule: f.rule } : {}),
    ...(f.service ? { service: f.service } : {}),
    ...(f.assignee ? { assigneeId: f.assignee } : {}),
    ...(f.q ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { fingerprint: { contains: f.q } }] } : {}),
  };
  const [rows, byStatus, bySeverity, groups] = await Promise.all([
    db().platformAlert.findMany({ where, orderBy: { id: "desc" }, ...prismaPage(f) }),
    db().platformAlert.groupBy({ by: ["status"], _count: { _all: true } }),
    db().platformAlert.groupBy({ by: ["severity"], where: { status: { in: [...ACTIVE] } }, _count: { _all: true } }),
    db().platformAlert.groupBy({ by: ["groupKey", "rule", "service"], where: { status: { in: [...ACTIVE] } }, _count: { _all: true }, _max: { lastSeenAt: true }, orderBy: { _max: { lastSeenAt: "desc" } }, take: 30 }),
  ]);
  const page = toPage(rows, f);
  const assignees = [...new Set(page.data.map((a) => a.assigneeId).filter((v): v is string => !!v))];
  const people = assignees.length ? await db().user.findMany({ where: { id: { in: assignees } }, select: { id: true, name: true } }) : [];
  return {
    ...page,
    data: page.data.map((a) => ({ ...a, assignee: people.find((p) => p.id === a.assigneeId) ?? null, investigate: investigateLinks(a.rule, (a.detail ?? {}) as Record<string, unknown>, a.service)[0] ?? null })),
    counts: Object.fromEntries(ALERT_STATUSES.map((s) => [s, byStatus.find((b) => b.status === s)?._count._all ?? 0])) as Record<(typeof ALERT_STATUSES)[number], number>,
    activeBySeverity: Object.fromEntries(ALERT_SEVERITIES.map((s) => [s, bySeverity.find((b) => b.severity === s)?._count._all ?? 0])) as Record<Severity, number>,
    groups: groups.map((g) => ({ groupKey: g.groupKey, rule: g.rule, service: g.service, count: g._count._all, lastSeenAt: g._max.lastSeenAt })),
  };
}

export async function getAlert(ctx: RequestContext, id: string) {
  await requireAnyPlatform(ctx, ALERT_READ);
  if (!z.string().uuid().safeParse(id).success) throw notFound("Alert");
  const alert = await db().platformAlert.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: "asc" }, take: 300 } } });
  if (!alert) throw notFound("Alert");
  const people = [...new Set([alert.assigneeId, alert.acknowledgedById, ...alert.events.map((e) => e.actorId)].filter((v): v is string => !!v))];
  const [users, incident, siblings] = await Promise.all([
    people.length ? db().user.findMany({ where: { id: { in: people } }, select: { id: true, name: true, email: true } }) : [],
    alert.incidentId ? db().platformIncident.findUnique({ where: { id: alert.incidentId }, select: { id: true, number: true, title: true, status: true, severity: true } }) : null,
    db().platformAlert.findMany({ where: { groupKey: alert.groupKey, id: { not: id } }, orderBy: { lastSeenAt: "desc" }, take: 10, select: { id: true, title: true, status: true, severity: true, lastSeenAt: true, count: true } }),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  return {
    alert,
    assignee: alert.assigneeId ? (byId.get(alert.assigneeId) ?? null) : null,
    acknowledgedBy: alert.acknowledgedById ? (byId.get(alert.acknowledgedById) ?? null) : null,
    events: alert.events.map((e) => ({ ...e, actor: e.actorId ? (byId.get(e.actorId) ?? null) : null })),
    incident,
    siblings,
    investigate: investigateLinks(alert.rule, (alert.detail ?? {}) as Record<string, unknown>, alert.service),
    rule: ALERT_RULES.find((r) => r.key === alert.rule) ? { key: alert.rule, threshold: ALERT_RULES.find((r) => r.key === alert.rule)!.threshold } : { key: alert.rule, threshold: null },
    policy: NOTIFICATION_POLICY[alert.severity],
  };
}

export const ALERT_ACTIONS = ["ack", "assign", "snooze", "resolve", "reopen", "escalate", "note", "link_incident", "open_incident"] as const;

export const alertActionInput = z.object({
  action: z.enum(ALERT_ACTIONS),
  reason: reasonSchema,
  assigneeId: z.string().uuid().nullable().optional(),
  minutes: z.coerce.number().int().min(15).max(7 * 24 * 60).optional(),
  note: z.string().trim().min(1).max(2_000).optional(),
  incidentId: z.string().uuid().optional(),
  severity: z.enum(["SEV1", "SEV2", "SEV3", "SEV4"]).optional(),
});

/** One alert action (platform.alerts.manage, audited with a reason). */
export async function alertAction(ctx: RequestContext, id: string, raw: z.input<typeof alertActionInput>) {
  const input = alertActionInput.parse(raw);
  if (!z.string().uuid().safeParse(id).success) throw notFound("Alert");
  if (input.action === "open_incident") {
    await requirePlatform(ctx, ALERT_MANAGE);
    const a = await db().platformAlert.findUnique({ where: { id } });
    if (!a) throw notFound("Alert");
    if (a.incidentId) throw conflict("The alert is already linked to an incident", { reason: "already_linked", incidentId: a.incidentId });
    const incident = await createIncident(ctx, { title: a.title.slice(0, 200), severity: input.severity ?? (a.severity === "CRITICAL" ? "SEV2" : "SEV3"), services: a.service && serviceDef(a.service) ? [a.service] : [], summary: input.note, alertIds: [a.id], reason: input.reason });
    return { id, incidentId: incident.id };
  }
  const result = await transaction(async (tx) => {
    await requirePlatform(ctx, ALERT_MANAGE);
    const a = await tx.platformAlert.findUnique({ where: { id } });
    if (!a) throw notFound("Alert");
    const resolved = a.status === "RESOLVED";
    if (resolved && input.action !== "reopen" && input.action !== "note") throw conflict("The alert is resolved; reopen it first", { reason: "alert_resolved" });
    const now = new Date();
    let data: Prisma.PlatformAlertUpdateInput = {};
    let note: string | null = input.note ?? null;
    switch (input.action) {
      case "ack":
        if (a.status === "ACKNOWLEDGED") throw conflict("Already acknowledged", { reason: "already_acknowledged" });
        data = { status: "ACKNOWLEDGED", acknowledgedAt: now, acknowledgedById: ctx.actor.id, snoozedUntil: null };
        break;
      case "assign": {
        if (input.assigneeId === undefined) throw invalid("assigneeId is required", { reason: "assignee_required" });
        if (input.assigneeId) {
          const u = await tx.user.findUnique({ where: { id: input.assigneeId }, select: { status: true, name: true } });
          if (!u || u.status !== "ACTIVE") throw notFound("Assignee");
          note = note ?? u.name;
        }
        data = { assigneeId: input.assigneeId };
        break;
      }
      case "snooze": {
        const minutes = input.minutes ?? 60;
        data = { status: "SNOOZED", snoozedUntil: new Date(now.getTime() + minutes * MIN) };
        note = note ?? `${minutes} min`;
        break;
      }
      case "resolve":
        data = { status: "RESOLVED", resolvedAt: now, resolvedBy: ctx.actor.id ?? "admin" };
        break;
      case "reopen":
        if (!resolved) throw conflict("Only resolved alerts can be reopened", { reason: "alert_not_resolved" });
        {
          const dup = await tx.platformAlert.findFirst({ where: { fingerprint: a.fingerprint, status: { in: [...ACTIVE] } }, select: { id: true } });
          if (dup) throw conflict("A newer alert with the same fingerprint is active", { reason: "duplicate_active", alertId: dup.id });
        }
        data = { status: "OPEN", resolvedAt: null, resolvedBy: null, snoozedUntil: null };
        break;
      case "escalate":
        data = { escalationLevel: Math.min(a.escalationLevel + 1, ESCALATE_AFTER_MS.length), escalatedAt: now };
        break;
      case "note":
        if (!input.note) throw invalid("note is required", { reason: "note_required" });
        break;
      case "link_incident": {
        if (!input.incidentId) throw invalid("incidentId is required", { reason: "incident_required" });
        const inc = await tx.platformIncident.findUnique({ where: { id: input.incidentId }, select: { id: true, number: true } });
        if (!inc) throw notFound("Incident");
        data = { incidentId: inc.id };
        note = `#${inc.number}`;
        await tx.platformIncidentUpdate.create({ data: { incidentId: inc.id, kind: "alert_linked", message: "1", authorId: ctx.actor.id } });
        break;
      }
    }
    const kind = { ack: "acked", assign: "assigned", snooze: "snoozed", resolve: "resolved", reopen: "reopened", escalate: "escalated", note: "note", link_incident: "incident_linked" }[input.action as Exclude<(typeof ALERT_ACTIONS)[number], "open_incident">];
    const updated = await tx.platformAlert.update({ where: { id }, data: { ...data, events: { create: { kind, actorId: ctx.actor.id, note } } } });
    await writeAudit(tx, ctx, { category: "ADMIN", action: `platform.alert.${kind}`, resourceType: "platform_alert", resourceId: id, oldValue: { status: a.status, assigneeId: a.assigneeId, escalationLevel: a.escalationLevel }, newValue: { status: updated.status, assigneeId: updated.assigneeId, escalationLevel: updated.escalationLevel }, reason: input.reason });
    if (input.action === "resolve") await emitEvent(tx, ctx, "platform.alert.resolved", { alertId: id, rule: a.rule, by: "admin" }, { aggregateType: "platform_alert", aggregateId: id });
    if (input.action === "escalate") await emitEvent(tx, ctx, "platform.alert.escalated", { alertId: id, rule: a.rule, level: updated.escalationLevel }, { aggregateType: "platform_alert", aggregateId: id });
    return updated;
  });
  if (input.action === "escalate") {
    const perms = NOTIFICATION_POLICY.CRITICAL.escalation[result.escalationLevel - 1] ?? NOTIFICATION_POLICY.CRITICAL.onRaise;
    for (const permission of perms) await notifyAdmins(ctx, { permission, type: "alert.escalated", severity: result.severity, title: result.title, href: `/alerts/${id}`, dedupeKey: `alert:${id}:escalated:${result.escalationLevel}` });
  }
  if (input.action === "assign" && result.assigneeId) {
    await notifyAdmins(ctx, { userId: result.assigneeId, type: "alert.assigned", severity: result.severity, title: result.title, href: `/alerts/${id}`, dedupeKey: `alert:${id}:assigned:${result.assigneeId}` });
  }
  return { id, status: result.status };
}

export const bulkAlertInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(100), action: z.enum(["ack", "resolve"]), reason: reasonSchema });

/** Acknowledge or resolve many alerts (e.g. a whole group) in one audited step. */
export async function bulkAlertAction(ctx: RequestContext, raw: z.input<typeof bulkAlertInput>) {
  const input = bulkAlertInput.parse(raw);
  return transaction(async (tx) => {
    await requirePlatform(ctx, ALERT_MANAGE);
    const now = new Date();
    const targets = await tx.platformAlert.findMany({ where: { id: { in: input.ids }, status: input.action === "ack" ? "OPEN" : { in: [...ACTIVE] } }, select: { id: true } });
    const ids = targets.map((t) => t.id);
    if (!ids.length) return { changed: 0 };
    await tx.platformAlert.updateMany({
      where: { id: { in: ids } },
      data: input.action === "ack" ? { status: "ACKNOWLEDGED", acknowledgedAt: now, acknowledgedById: ctx.actor.id } : { status: "RESOLVED", resolvedAt: now, resolvedBy: ctx.actor.id ?? "admin" },
    });
    await tx.platformAlertEvent.createMany({ data: ids.map((alertId) => ({ alertId, kind: input.action === "ack" ? "acked" : "resolved", actorId: ctx.actor.id, note: "bulk" })) });
    await writeAudit(tx, ctx, { category: "ADMIN", action: `platform.alert.bulk_${input.action}`, resourceType: "platform_alert", newValue: { ids }, reason: input.reason });
    return { changed: ids.length };
  });
}

/** Rules catalog for the alert center (key, threshold, auto incident) and the notification policy. */
export function alertRulesCatalog() {
  return {
    rules: ALERT_RULES.map((r) => ({ key: r.key, service: r.service, threshold: r.threshold, autoIncident: !!r.autoIncident })),
    policy: NOTIFICATION_POLICY,
    limits: { maxNewPerRun: MAX_NEW_PER_RUN, maxNotificationsPerRun: MAX_NOTIFY_PER_RUN, renotifyMinutes: RENOTIFY_MS / MIN, escalateAfterMinutes: ESCALATE_AFTER_MS.map((m) => m / MIN), intervalMinutes: 5 },
  };
}

/** Last time the engine evaluated (from worker_job_runs of `ops.monitor`), for the stale-engine indicator. */
export async function alertEngineStatus() {
  const last = await db().workerJobRun.findFirst({ where: { jobName: "ops.monitor" }, orderBy: { updatedAt: "desc" }, select: { status: true, updatedAt: true, lastError: true } });
  const lastCheck = await db().serviceHealthCheck.findFirst({ orderBy: { checkedAt: "desc" }, select: { checkedAt: true } });
  return { lastRunAt: last?.updatedAt ?? lastCheck?.checkedAt ?? null, lastStatus: last?.status ?? null, lastError: last?.lastError ?? null };
}

/** Retention: resolved alerts older than 90 days are removed with their events. */
export async function purgeResolvedAlerts(): Promise<number> {
  const r = await db().platformAlert.deleteMany({ where: { status: "RESOLVED", resolvedAt: { lt: since(90 * 24 * 60 * MIN) } } });
  return r.count;
}

// ───────────── Action center and badges (consumed by stream A) ─────────────

/** One actionable item for A's action center (`BE/admin/action-center.ts` ActionSource contract, structural). */
export interface OpsActionItem {
  /** Stable id: "alert:<id>" or "incident:<id>". */
  id: string;
  kind: "alert" | "incident";
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  /** Locale-relative console link. */
  href: string;
  status: string;
  assigneeId: string | null;
  at: Date;
}

const INCIDENT_SEVERITY: Record<string, OpsActionItem["severity"]> = { SEV1: "CRITICAL", SEV2: "CRITICAL", SEV3: "WARNING", SEV4: "INFO" };

/**
 * Open and acknowledged alerts and active incidents, most severe first, without a permission check (callers gate:
 * `opsActionSource` per viewer, A's Action Center through the console-gate section of each item's link).
 */
export async function opsActionRows(include: { alerts: boolean; incidents: boolean }, limit = 20): Promise<OpsActionItem[]> {
  const [alerts, incidents] = await Promise.all([
    include.alerts ? db().platformAlert.findMany({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } }, orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }], take: limit, select: { id: true, title: true, severity: true, status: true, assigneeId: true, lastSeenAt: true } }) : [],
    include.incidents ? db().platformIncident.findMany({ where: { status: { notIn: ["RESOLVED", "CLOSED"] } }, orderBy: [{ severity: "asc" }, { detectedAt: "desc" }], take: limit, select: { id: true, number: true, title: true, severity: true, status: true, ownerId: true, detectedAt: true } }) : [],
  ]);
  const rank = { CRITICAL: 2, WARNING: 1, INFO: 0 } as const;
  return [
    ...incidents.map((i) => ({ id: `incident:${i.id}`, kind: "incident" as const, severity: INCIDENT_SEVERITY[i.severity] ?? "WARNING", title: `#${i.number} ${i.title}`, href: `/incidents/${i.id}`, status: i.status, assigneeId: i.ownerId, at: i.detectedAt })),
    ...alerts.map((a) => ({ id: `alert:${a.id}`, kind: "alert" as const, severity: a.severity, title: a.title, href: `/alerts/${a.id}`, status: a.status, assigneeId: a.assigneeId, at: a.lastSeenAt })),
  ]
    .sort((x, y) => rank[y.severity] - rank[x.severity] || y.at.getTime() - x.at.getTime())
    .slice(0, limit);
}

/**
 * Per-viewer variant of {@link opsActionRows}: each half is filtered by its own read permission. A's Action Center
 * (`BE/admin/action-center.ts`) adapts the same rows into its `alerts.open` / `incidents.active` items.
 */
export const opsActionSource = {
  key: "ops",
  perms: ["platform.incidents.read", "platform.alerts.manage"] as readonly string[],
  async load(ctx: RequestContext, limit = 20): Promise<OpsActionItem[]> {
    const { canPlatform } = await import("./access");
    const [alertsOk, incidentsOk] = await Promise.all([
      Promise.all(ALERT_READ.map((p) => canPlatform(ctx, p))).then((r) => r.some(Boolean)),
      canPlatform(ctx, "platform.incidents.read"),
    ]);
    return opsActionRows({ alerts: alertsOk, incidents: incidentsOk }, limit);
  },
};

/**
 * Status reader for sidebar badges and the command center (no permission check: counts only; callers gate display).
 * Badge ids used in AC/nav/sections/e.ts: "alerts.open", "incidents.active", "jobs.dead".
 */
export async function opsStatusCounts() {
  const [alerts, incidents, dead, errorsOpen] = await Promise.all([
    db().platformAlert.groupBy({ by: ["severity"], where: { status: "OPEN" }, _count: { _all: true } }),
    db().platformIncident.groupBy({ by: ["severity"], where: { status: { notIn: ["RESOLVED", "CLOSED"] } }, _count: { _all: true } }),
    db().workerJobRun.count({ where: { status: "DEAD" } }),
    db().errorGroup.count({ where: { status: { in: ["OPEN", "REGRESSED"] } } }),
  ]);
  const sum = (rows: { _count: { _all: number } }[]) => rows.reduce((a, r) => a + r._count._all, 0);
  return {
    "alerts.open": sum(alerts),
    alertsCritical: alerts.find((a) => a.severity === "CRITICAL")?._count._all ?? 0,
    "incidents.active": sum(incidents),
    incidentsMajor: incidents.filter((i) => i.severity === "SEV1" || i.severity === "SEV2").reduce((a, r) => a + r._count._all, 0),
    "jobs.dead": dead,
    errorsOpen,
  };
}
