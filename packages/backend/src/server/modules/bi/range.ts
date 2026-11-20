import { z } from "zod";
import type { MetricRange } from "@/server/core/metrics";

/** Pure date-range helpers (safe for client components). Ranges are UTC days; `to` is exclusive. */
export const RANGE_KEYS = ["7d", "30d", "90d", "month", "quarter", "year", "custom"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];
export const WIDGET_RANGES = ["7d", "30d", "90d", "month", "quarter", "year"] as const;

const DAY = 86_400_000;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const rangeParams = z.object({
  range: z.enum(RANGE_KEYS).catch("30d").default("30d"),
  from: day.optional().catch(undefined),
  to: day.optional().catch(undefined),
});

const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Resolve a range key (and custom from/to, inclusive days) to a concrete range ending today (exclusive tomorrow). */
export function resolveRange(key: RangeKey, from?: string, to?: string, now = new Date()): MetricRange {
  const tomorrow = new Date(utcDay(now).getTime() + DAY);
  switch (key) {
    case "7d":
    case "30d":
    case "90d":
      return { from: new Date(tomorrow.getTime() - Number(key.slice(0, -1)) * DAY), to: tomorrow };
    case "month":
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: tomorrow };
    case "quarter":
      return { from: new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1)), to: tomorrow };
    case "year":
      return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to: tomorrow };
    case "custom": {
      const f = from ? new Date(`${from}T00:00:00Z`) : new Date(tomorrow.getTime() - 30 * DAY);
      const t = to ? new Date(new Date(`${to}T00:00:00Z`).getTime() + DAY) : tomorrow;
      if (!(f < t) || Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return { from: new Date(tomorrow.getTime() - 30 * DAY), to: tomorrow };
      // At most 3 years.
      return { from: t.getTime() - f.getTime() > 1096 * DAY ? new Date(t.getTime() - 1096 * DAY) : f, to: t };
    }
  }
}

/** The period of equal length immediately before. */
export const previousRange = (r: MetricRange): MetricRange => ({ from: new Date(r.from.getTime() - (r.to.getTime() - r.from.getTime())), to: r.from });

/** Consecutive buckets covering the range (daily, weekly or monthly), at most `max`. */
export function bucketsOf(r: MetricRange, max = 31): MetricRange[] {
  const days = Math.max(1, Math.round((r.to.getTime() - r.from.getTime()) / DAY));
  const out: MetricRange[] = [];
  if (days <= max) {
    for (let t = r.from.getTime(); t < r.to.getTime(); t += DAY) out.push({ from: new Date(t), to: new Date(Math.min(t + DAY, r.to.getTime())) });
    return out;
  }
  if (days / 7 <= max) {
    for (let t = r.to.getTime(); t > r.from.getTime(); t -= 7 * DAY) out.unshift({ from: new Date(Math.max(t - 7 * DAY, r.from.getTime())), to: new Date(t) });
    return out;
  }
  // Monthly buckets (calendar months), trimmed to the range and to `max` most recent.
  let cursor = new Date(Date.UTC(r.from.getUTCFullYear(), r.from.getUTCMonth(), 1));
  while (cursor < r.to) {
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    out.push({ from: new Date(Math.max(cursor.getTime(), r.from.getTime())), to: new Date(Math.min(next.getTime(), r.to.getTime())) });
    cursor = next;
  }
  return out.slice(-max);
}

/** Percentage change, or null when the previous value is zero. */
export const changePct = (current: number, previous: number) => (previous === 0 ? null : ((current - previous) / Math.abs(previous)) * 100);
