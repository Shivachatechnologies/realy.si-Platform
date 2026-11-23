import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { db, Prisma, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { reasonSchema, requireAnyPlatform, requirePlatform } from "./access";
import { isProduction, requireProductionConfirmation } from "./releases";
import { scrubText } from "./errors";

/**
 * Data operations (stream E): migration status, read-only integrity checks, the retention registry and managed
 * exports of operational datasets. There is deliberately no database editor and no data mutation here: checks only
 * count and sample ids (bounded, 5 s statement timeout each); exports are capped CSV downloads of platform-ops tables
 * (no tenant business data), audited with a reason and gated by the MFA-protected `platform.data.export`.
 */

export const DATA_READ = ["platform.data.read", "platform.data.export"];
export const DATA_EXPORT = "platform.data.export";

// ───────────── Migrations ─────────────

function repositoryMigrations(): string[] | null {
  const candidates = [path.resolve(process.cwd(), "packages/database/prisma/migrations"), path.resolve(process.cwd(), "../../packages/database/prisma/migrations"), path.resolve(process.cwd(), "prisma/migrations")];
  for (const dir of candidates) {
    try {
      if (existsSync(dir)) return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name)).map((d) => d.name).sort();
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export async function migrationStatus(ctx: RequestContext) {
  await requireAnyPlatform(ctx, DATA_READ);
  const rows = await db()
    .$queryRaw<{ migration_name: string; started_at: Date; finished_at: Date | null; rolled_back_at: Date | null; applied_steps_count: number; logs: string | null }[]>(Prisma.sql`
      SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, logs FROM _prisma_migrations ORDER BY started_at DESC LIMIT 500`)
    .catch(() => null);
  if (!rows) return { available: false as const, applied: [], failed: [], pending: null, repository: null };
  const applied = rows.filter((r) => r.finished_at && !r.rolled_back_at);
  const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => ({ ...r, logs: r.logs ? scrubText(r.logs, 1_000) : null }));
  const repo = repositoryMigrations();
  const appliedNames = new Set(applied.map((r) => r.migration_name));
  return {
    available: true as const,
    applied: applied.map((r) => ({ name: r.migration_name, startedAt: r.started_at, finishedAt: r.finished_at, steps: r.applied_steps_count })),
    failed: failed.map((r) => ({ name: r.migration_name, startedAt: r.started_at, logs: r.logs })),
    rolledBack: rows.filter((r) => r.rolled_back_at).map((r) => ({ name: r.migration_name, rolledBackAt: r.rolled_back_at })),
    /** Migrations in the bundled repository folder that the database has not applied; null when the folder is not bundled. */
    pending: repo ? repo.filter((n) => !appliedNames.has(n)) : null,
    /** Applied in the database but unknown to this build (a newer deploy ran, or a migration was renamed). */
    unknown: repo ? applied.map((r) => r.migration_name).filter((n) => !repo.includes(n)) : null,
    repository: repo ? repo.length : null,
    latest: applied[0]?.migration_name ?? null,
  };
}

// ───────────── Integrity checks ─────────────

interface IntegrityCheck {
  key: string;
  severity: "warning" | "info";
  /** Returns the number of affected rows and up to 5 sample ids. Read-only. */
  sql: Prisma.Sql;
}

export const INTEGRITY_CHECKS: readonly IntegrityCheck[] = [
  {
    key: "members_of_deleted_users",
    severity: "warning",
    sql: Prisma.sql`SELECT m.id::text AS id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.status = 'DELETED' AND m.status = 'ACTIVE'`,
  },
  {
    key: "sessions_of_inactive_users",
    severity: "warning",
    sql: Prisma.sql`SELECT s.id::text AS id FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.status IN ('SUSPENDED', 'DELETED') AND s.revoked_at IS NULL AND s.expires_at > now()`,
  },
  {
    key: "live_subscriptions_closed_orgs",
    severity: "warning",
    sql: Prisma.sql`SELECT s.id::text AS id FROM subscriptions s JOIN organizations o ON o.id = s.organization_id WHERE o.status = 'CLOSED' AND s.status IN ('ACTIVE', 'TRIALING', 'PAST_DUE')`,
  },
  {
    key: "orgs_without_active_members",
    severity: "info",
    sql: Prisma.sql`SELECT o.id::text AS id FROM organizations o WHERE o.status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.status = 'ACTIVE')`,
  },
  {
    key: "stuck_job_runs",
    severity: "info",
    sql: Prisma.sql`SELECT id::text AS id FROM worker_job_runs WHERE status = 'ACTIVE' AND updated_at < now() - interval '6 hours'`,
  },
  {
    key: "stuck_ai_tasks",
    severity: "info",
    sql: Prisma.sql`SELECT id::text AS id FROM agent_tasks WHERE status = 'RUNNING' AND started_at < now() - interval '24 hours'`,
  },
  {
    key: "orphan_error_events",
    severity: "info",
    sql: Prisma.sql`SELECT e.id::text AS id FROM error_events e WHERE NOT EXISTS (SELECT 1 FROM error_groups g WHERE g.id = e.group_id)`,
  },
  {
    key: "alerts_missing_incident",
    severity: "info",
    sql: Prisma.sql`SELECT a.id::text AS id FROM platform_alerts a WHERE a.incident_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM platform_incidents i WHERE i.id = a.incident_id)`,
  },
  {
    key: "failed_migrations",
    severity: "warning",
    sql: Prisma.sql`SELECT migration_name AS id FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
  },
];

export interface IntegrityResult {
  key: string;
  severity: "warning" | "info";
  count: number | null;
  samples: string[];
  error: string | null;
  ms: number;
}

/** Run every check (read-only; 5 s timeout each). Stored as a `data.integrity` probe row for the last-run view. */
export async function runIntegrityChecks(): Promise<IntegrityResult[]> {
  const out: IntegrityResult[] = [];
  for (const c of INTEGRITY_CHECKS) {
    const t0 = Date.now();
    try {
      const [count, samples] = await db().$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = 5000");
        const n = await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS n FROM (${c.sql}) t`);
        const s = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM (${c.sql}) t LIMIT 5`);
        return [Number(n[0]?.n ?? 0), s.map((r) => r.id)] as const;
      });
      out.push({ key: c.key, severity: c.severity, count, samples, error: null, ms: Date.now() - t0 });
    } catch (err) {
      out.push({ key: c.key, severity: c.severity, count: null, samples: [], error: err instanceof Error ? scrubText(err.message, 200) : "failed", ms: Date.now() - t0 });
    }
  }
  const bad = out.some((r) => r.severity === "warning" && (r.count ?? 0) > 0);
  await db()
    .serviceHealthCheck.create({ data: { service: "data.integrity", status: out.some((r) => r.error) ? "UNKNOWN" : bad ? "DEGRADED" : "HEALTHY", detail: { checks: out } as unknown as Prisma.InputJsonValue } })
    .catch(() => undefined);
  return out;
}

/** On-demand run from Admin → Data (audited, no reason needed: it only reads). */
export async function runIntegrityChecksAsAdmin(ctx: RequestContext) {
  await requireAnyPlatform(ctx, DATA_READ);
  const results = await runIntegrityChecks();
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", action: "platform.data.integrity_checked", resourceType: "platform_data", newValue: { failing: results.filter((r) => (r.count ?? 0) > 0).map((r) => r.key) } }));
  return results;
}

async function lastIntegrityRun() {
  const row = await db().serviceHealthCheck.findFirst({ where: { service: "data.integrity" }, orderBy: { checkedAt: "desc" } });
  return row ? { checkedAt: row.checkedAt, status: row.status, checks: ((row.detail as { checks?: IntegrityResult[] })?.checks ?? []) as IntegrityResult[] } : null;
}

// ───────────── Retention registry ─────────────

export const RETENTION: readonly { table: string; keep: string; job: string | null }[] = [
  { table: "service_health_checks", keep: "30 days", job: "ops.retention" },
  { table: "error_events", keep: "30 days", job: "ops.retention" },
  { table: "app_log_entries", keep: "7 days", job: "ops.retention" },
  { table: "platform_alerts", keep: "resolved: 90 days", job: "ops.retention" },
  { table: "worker_job_runs", keep: "succeeded 7 days (schedules 2), failed 30, dead 35", job: "platform.maintenance" },
  { table: "idempotency_keys", keep: "until expiry", job: "platform.maintenance" },
  { table: "integration_request_logs", keep: "30 days", job: "integrations.prune_request_logs" },
  { table: "audit_logs", keep: "forever (append-only)", job: null },
  { table: "platform_incidents", keep: "forever", job: null },
  { table: "platform_releases", keep: "forever", job: null },
  { table: "error_groups", keep: "forever (events expire)", job: null },
];

async function retentionRegistry() {
  const tables = RETENTION.map((r) => r.table);
  const jobs = [...new Set(RETENTION.map((r) => r.job).filter((j): j is string => !!j))];
  const [estimates, runs] = await Promise.all([
    db().$queryRaw<{ name: string; rows: number }[]>(Prisma.sql`SELECT relname AS name, GREATEST(reltuples, 0)::float AS rows FROM pg_class WHERE relkind = 'r' AND relname IN (${Prisma.join(tables)})`).catch(() => []),
    db().workerJobRun.findMany({ where: { jobName: { in: jobs } }, orderBy: { updatedAt: "desc" }, take: 100, select: { jobName: true, status: true, updatedAt: true, result: true } }),
  ]);
  return RETENTION.map((r) => {
    const run = r.job ? runs.find((x) => x.jobName === r.job) : undefined;
    return { ...r, rowsEstimate: Math.round(estimates.find((e) => e.name === r.table)?.rows ?? 0), lastRun: run ? { status: run.status, at: run.updatedAt, removed: run.result } : null };
  });
}

// ───────────── Exports ─────────────

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join(" ") : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Formula injection guard for spreadsheet apps.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const EXPORT_LIMIT = 10_000;

const DATASETS = {
  incidents: async () => {
    const rows = await db().platformIncident.findMany({ orderBy: { detectedAt: "desc" }, take: EXPORT_LIMIT, select: { number: true, title: true, severity: true, status: true, source: true, services: true, detectedAt: true, acknowledgedAt: true, mitigatedAt: true, resolvedAt: true, closedAt: true, postmortemState: true } });
    return { columns: ["number", "title", "severity", "status", "source", "services", "detectedAt", "acknowledgedAt", "mitigatedAt", "resolvedAt", "closedAt", "postmortemState"], rows };
  },
  alerts: async () => {
    const rows = await db().platformAlert.findMany({ orderBy: { lastSeenAt: "desc" }, take: EXPORT_LIMIT, select: { id: true, rule: true, service: true, severity: true, status: true, title: true, count: true, firstSeenAt: true, lastSeenAt: true, acknowledgedAt: true, resolvedAt: true, escalationLevel: true } });
    return { columns: ["id", "rule", "service", "severity", "status", "title", "count", "firstSeenAt", "lastSeenAt", "acknowledgedAt", "resolvedAt", "escalationLevel"], rows };
  },
  error_groups: async () => {
    const rows = await db().errorGroup.findMany({ orderBy: { lastSeenAt: "desc" }, take: EXPORT_LIMIT, select: { id: true, source: true, name: true, message: true, route: true, status: true, count: true, firstSeenAt: true, lastSeenAt: true, lastRelease: true } });
    return { columns: ["id", "source", "name", "message", "route", "status", "count", "firstSeenAt", "lastSeenAt", "lastRelease"], rows };
  },
  health_checks: async () => {
    const rows = await db().serviceHealthCheck.findMany({ where: { checkedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, orderBy: { checkedAt: "desc" }, take: EXPORT_LIMIT, select: { service: true, status: true, latencyMs: true, checkedAt: true } });
    return { columns: ["service", "status", "latencyMs", "checkedAt"], rows };
  },
  releases: async () => {
    const rows = await db().platformRelease.findMany({ orderBy: { firstSeenAt: "desc" }, take: EXPORT_LIMIT, select: { app: true, sha: true, ref: true, environment: true, deploymentId: true, firstSeenAt: true, lastSeenAt: true, boots: true } });
    return { columns: ["app", "sha", "ref", "environment", "deploymentId", "firstSeenAt", "lastSeenAt", "boots"], rows };
  },
  job_runs: async () => {
    const rows = await db().workerJobRun.findMany({ where: { updatedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, orderBy: { updatedAt: "desc" }, take: EXPORT_LIMIT, select: { queue: true, jobName: true, jobId: true, status: true, attempts: true, maxAttempts: true, durationMs: true, lastError: true, createdAt: true, finishedAt: true } });
    return { columns: ["queue", "jobName", "jobId", "status", "attempts", "maxAttempts", "durationMs", "lastError", "createdAt", "finishedAt"], rows };
  },
} as const;

export const EXPORT_DATASETS = Object.keys(DATASETS) as (keyof typeof DATASETS)[];

export const exportInput = z.object({ dataset: z.enum(EXPORT_DATASETS as [keyof typeof DATASETS, ...(keyof typeof DATASETS)[]]), reason: reasonSchema, confirm: z.string().max(200).optional() });

/** Build one CSV export (audited `platform.data.exported`; in production the "PRODUCTION export <dataset>" phrase too). */
export async function exportDataset(ctx: RequestContext, raw: z.input<typeof exportInput>) {
  const input = exportInput.parse(raw);
  await requirePlatform(ctx, DATA_EXPORT);
  // Not destructive: the typed phrase is the extra production confirmation only.
  if (isProduction()) requireProductionConfirmation(input.confirm, `export ${input.dataset}`);
  const def = DATASETS[input.dataset];
  if (!def) throw notFound("Dataset");
  const { columns, rows } = await def();
  const csv = [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell((r as Record<string, unknown>)[c])).join(","))].join("\n");
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", action: "platform.data.exported", resourceType: "platform_data", resourceId: input.dataset, newValue: { dataset: input.dataset, rows: rows.length, capped: rows.length >= EXPORT_LIMIT }, reason: input.reason }));
  return { filename: `realy-${input.dataset}-${new Date().toISOString().slice(0, 10)}.csv`, csv, rows: rows.length };
}

/** Data page: migrations, last integrity run, retention registry, export catalog and recent exports (from the audit log). */
export async function dataOpsOverview(ctx: RequestContext) {
  await requireAnyPlatform(ctx, DATA_READ);
  const [migrations, integrity, retention, exports] = await Promise.all([
    migrationStatus(ctx),
    lastIntegrityRun(),
    retentionRegistry(),
    db().auditLog.findMany({ where: { action: "platform.data.exported" }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, actorId: true, resourceId: true, newValue: true, reason: true, createdAt: true } }),
  ]);
  const actors = [...new Set(exports.map((e) => e.actorId).filter((v): v is string => !!v))];
  const users = actors.length ? await db().user.findMany({ where: { id: { in: actors } }, select: { id: true, name: true } }) : [];
  return {
    migrations,
    integrity,
    checks: INTEGRITY_CHECKS.map((c) => ({ key: c.key, severity: c.severity })),
    retention,
    datasets: EXPORT_DATASETS,
    exportLimit: EXPORT_LIMIT,
    recentExports: exports.map((e) => ({ ...e, actor: users.find((u) => u.id === e.actorId)?.name ?? null })),
  };
}
