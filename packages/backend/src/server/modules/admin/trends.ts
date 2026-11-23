import { db, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { costMicros } from "@/server/modules/workforce/pricing";
import { daysAgo, requireAnyPlatform, utcDayStart } from "./access";

/**
 * Read-only daily series for the admin console charts. Every point is counted from real rows; empty days are 0.
 * Stream A owns this file. The helpers (trendDays, since, fill, fillAi, aiByDay) are shared with ./people-trends (B)
 * and ./ai-trends (C): keep their signatures stable.
 */
export const TREND_DAYS = 30;

export type DayRow = { day: Date; n: bigint | number | null };
export type DayModelRow = { day: Date; model: string | null; input: bigint | null; output: bigint | null; tasks: bigint };

/** UTC day keys (YYYY-MM-DD), oldest first, ending today. */
export function trendDays(days = TREND_DAYS) {
  const end = utcDayStart().getTime();
  return Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

export const since = (days = TREND_DAYS) => new Date(utcDayStart().getTime() - (days - 1) * 86_400_000);
const key = (d: Date) => d.toISOString().slice(0, 10);

export function fill(rows: DayRow[], days = TREND_DAYS) {
  const m = new Map(rows.map((r) => [key(r.day), Number(r.n ?? 0)]));
  return trendDays(days).map((d) => m.get(d) ?? 0);
}

export function fillAi(rows: DayModelRow[], days = TREND_DAYS) {
  const tokens = new Map<string, number>();
  const cost = new Map<string, number>();
  const tasks = new Map<string, number>();
  for (const r of rows) {
    const k = key(r.day);
    const i = Number(r.input ?? 0);
    const o = Number(r.output ?? 0);
    tokens.set(k, (tokens.get(k) ?? 0) + i + o);
    cost.set(k, (cost.get(k) ?? 0) + costMicros(r.model, i, o));
    tasks.set(k, (tasks.get(k) ?? 0) + Number(r.tasks));
  }
  const ds = trendDays(days);
  return { tokens: ds.map((d) => tokens.get(d) ?? 0), costMicros: ds.map((d) => cost.get(d) ?? 0), tasks: ds.map((d) => tasks.get(d) ?? 0) };
}

export const aiByDay = (from: Date, where: Prisma.Sql = Prisma.empty) =>
  db().$queryRaw<DayModelRow[]>(Prisma.sql`
    SELECT date_trunc('day', started_at AT TIME ZONE 'UTC') AS day, model,
           SUM(input_tokens)::bigint AS input, SUM(output_tokens)::bigint AS output, COUNT(*)::bigint AS tasks
    FROM agent_tasks WHERE started_at >= ${from} ${where} GROUP BY 1, 2`);

/** Platform-wide 30-day series for the Overview control room, plus the live AI fleet by role. */
export async function platformTrends(ctx: RequestContext) {
  await requireAnyPlatform(ctx, ["platform.users.read", "platform.organizations.read", "platform.audit.read"]);
  const from = since();
  const [registrations, organizations, signIns, tasksCreated, tasksFailed, subscriptions, ai, fleet, completed24h] = await Promise.all([
    db().$queryRaw<DayRow[]>`SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, COUNT(*)::bigint AS n FROM users WHERE created_at >= ${from} GROUP BY 1`,
    db().$queryRaw<DayRow[]>`SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, COUNT(*)::bigint AS n FROM organizations WHERE created_at >= ${from} GROUP BY 1`,
    db().$queryRaw<DayRow[]>`SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, COUNT(DISTINCT user_id)::bigint AS n FROM sessions WHERE created_at >= ${from} GROUP BY 1`,
    db().$queryRaw<DayRow[]>`SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, COUNT(*)::bigint AS n FROM agent_tasks WHERE created_at >= ${from} GROUP BY 1`,
    db().$queryRaw<DayRow[]>`SELECT date_trunc('day', completed_at AT TIME ZONE 'UTC') AS day, COUNT(*)::bigint AS n FROM agent_tasks WHERE status = 'FAILED' AND completed_at >= ${from} GROUP BY 1`,
    db().$queryRaw<DayRow[]>`SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, COUNT(*)::bigint AS n FROM subscriptions WHERE created_at >= ${from} GROUP BY 1`,
    aiByDay(from),
    db().agentTask.groupBy({ by: ["profile", "status"], where: { status: { in: ["RUNNING", "QUEUED"] } }, _count: { _all: true } }),
    db().agentTask.count({ where: { status: "COMPLETED", completedAt: { gte: daysAgo(1) } } }),
  ]);
  const roles = new Map<string, { running: number; queued: number }>();
  for (const f of fleet) {
    const cur = roles.get(f.profile) ?? { running: 0, queued: 0 };
    if (f.status === "RUNNING") cur.running += f._count._all;
    else cur.queued += f._count._all;
    roles.set(f.profile, cur);
  }
  return {
    days: trendDays(),
    registrations: fill(registrations),
    organizations: fill(organizations),
    signIns: fill(signIns),
    tasksCreated: fill(tasksCreated),
    tasksFailed: fill(tasksFailed),
    subscriptions: fill(subscriptions),
    ai: fillAi(ai),
    fleet: [...roles].map(([profile, v]) => ({ profile, ...v })).sort((a, b) => b.running + b.queued - (a.running + a.queued)).slice(0, 8),
    completed24h,
  };
}
