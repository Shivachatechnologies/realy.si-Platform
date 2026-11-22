/**
 * Control Center → Analytics (stream D): platform_daily_metrics snapshots and their history.
 *
 * `sessions.last_seen_at` is overwritten on every request, so daily / weekly / monthly active users can only be
 * measured going forward: the `billing.daily-metrics` worker job (hourly) writes today's values, and each day keeps
 * the last value computed that day. There is no history before the first snapshot, and the page says so.
 */
import { z } from "zod";
import { db, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { requireAnyPlatform } from "./access";

const DAY = 86_400_000;
const utcDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export const DAILY_METRIC_KEYS = [
  "users.total",
  "users.signups",
  "users.dau",
  "users.wau",
  "users.mau",
  "orgs.total",
  "orgs.created",
  "orgs.active",
  "trials.started",
  "trials.active",
  "subscriptions.active",
  "subscriptions.trialing",
  "subscriptions.past_due",
  "subscriptions.started",
  "subscriptions.canceled",
  "ai.tasks",
  "workflow.runs",
] as const;
export type DailyMetricKey = (typeof DAILY_METRIC_KEYS)[number];

const one = async (q: Promise<{ n: bigint | number | null }[]>) => BigInt((await q)[0]?.n ?? 0);

/** Compute and upsert today's platform_daily_metrics. Returns the number of metrics written. */
export async function computeDailyMetrics(now = new Date()): Promise<number> {
  const day = utcDay(now);
  const d7 = new Date(now.getTime() - 7 * DAY);
  const d30 = new Date(now.getTime() - 30 * DAY);
  const c = db();
  const values: Record<DailyMetricKey, Promise<bigint>> = {
    "users.total": c.user.count({ where: { status: { not: "DELETED" } } }).then(BigInt),
    "users.signups": c.user.count({ where: { createdAt: { gte: day } } }).then(BigInt),
    "users.dau": one(c.$queryRaw(Prisma.sql`SELECT COUNT(DISTINCT user_id)::bigint AS n FROM sessions WHERE last_seen_at >= ${day}`)),
    "users.wau": one(c.$queryRaw(Prisma.sql`SELECT COUNT(DISTINCT user_id)::bigint AS n FROM sessions WHERE last_seen_at >= ${d7}`)),
    "users.mau": one(c.$queryRaw(Prisma.sql`SELECT COUNT(DISTINCT user_id)::bigint AS n FROM sessions WHERE last_seen_at >= ${d30}`)),
    "orgs.total": c.organization.count().then(BigInt),
    "orgs.created": c.organization.count({ where: { createdAt: { gte: day } } }).then(BigInt),
    "orgs.active": one(c.$queryRaw(Prisma.sql`SELECT COUNT(DISTINCT active_organization_id)::bigint AS n FROM sessions WHERE last_seen_at >= ${day} AND active_organization_id IS NOT NULL`)),
    "trials.started": c.entitlementTrial.count({ where: { startedAt: { gte: day } } }).then(BigInt),
    "trials.active": c.entitlementTrial.count({ where: { startedAt: { lte: now }, endsAt: { gt: now } } }).then(BigInt),
    "subscriptions.active": c.subscription.count({ where: { status: "ACTIVE" } }).then(BigInt),
    "subscriptions.trialing": c.subscription.count({ where: { status: "TRIALING" } }).then(BigInt),
    "subscriptions.past_due": c.subscription.count({ where: { status: "PAST_DUE" } }).then(BigInt),
    "subscriptions.started": c.subscription.count({ where: { createdAt: { gte: day } } }).then(BigInt),
    "subscriptions.canceled": c.subscription.count({ where: { canceledAt: { gte: day } } }).then(BigInt),
    "ai.tasks": c.agentTask.count({ where: { createdAt: { gte: day } } }).then(BigInt),
    "workflow.runs": c.workflowRun.count({ where: { createdAt: { gte: day }, isTest: false } }).then(BigInt),
  };
  const entries = await Promise.all(DAILY_METRIC_KEYS.map(async (k) => [k, await values[k]] as const));
  await db().$transaction(entries.map(([key, value]) => db().platformDailyMetric.upsert({ where: { day_key: { day, key } }, update: { value }, create: { day, key, value } })));
  return entries.length;
}

export const analyticsInput = z.object({ days: z.coerce.number().int().refine((d) => [30, 90, 180, 365].includes(d)).default(90).catch(90) });

/** Daily metric history (up to 12 months) and the first snapshot date (history before it does not exist). */
export async function platformAnalytics(ctx: RequestContext, raw: { days?: unknown } = {}) {
  await requireAnyPlatform(ctx, ["platform.users.read", "platform.subscriptions.read", "pricing.read"]);
  const { days } = analyticsInput.parse(raw);
  const from = new Date(utcDay().getTime() - (days - 1) * DAY);
  const [rows, first, last] = await Promise.all([
    db().platformDailyMetric.findMany({ where: { day: { gte: from } }, orderBy: { day: "asc" } }),
    db().platformDailyMetric.findFirst({ orderBy: { day: "asc" }, select: { day: true } }),
    db().platformDailyMetric.findFirst({ orderBy: { computedAt: "desc" }, select: { computedAt: true } }),
  ]);
  const dayKeys = Array.from({ length: days }, (_, i) => new Date(from.getTime() + i * DAY).toISOString().slice(0, 10));
  const byKey = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!byKey.has(r.key)) byKey.set(r.key, new Map());
    byKey.get(r.key)!.set(r.day.toISOString().slice(0, 10), Number(r.value));
  }
  const firstKey = first?.day.toISOString().slice(0, 10) ?? null;
  // Days before the first snapshot are null (not tracked), never 0.
  const series = Object.fromEntries(
    DAILY_METRIC_KEYS.map((k) => [k, dayKeys.map((d) => (firstKey && d >= firstKey ? (byKey.get(k)?.get(d) ?? null) : null))]),
  ) as Record<DailyMetricKey, (number | null)[]>;
  const latest = Object.fromEntries(DAILY_METRIC_KEYS.map((k) => [k, [...(series[k] ?? [])].reverse().find((v) => v !== null) ?? null])) as Record<DailyMetricKey, number | null>;
  const dau = latest["users.dau"];
  const mau = latest["users.mau"];
  return { days, dayKeys, series, latest, stickiness: dau !== null && mau ? dau / mau : null, firstSnapshot: first?.day ?? null, lastComputedAt: last?.computedAt ?? null, stale: !!last && Date.now() - last.computedAt.getTime() > 3 * 3_600_000, trackedDays: dayKeys.filter((d) => firstKey && d >= firstKey).length };
}
