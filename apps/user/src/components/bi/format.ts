import { formatMoney, formatNumber } from "@/i18n/format";
import type { MetricUnit } from "@/server/core/metrics";

/** Format a metric value for display (money in minor units of `currency`). */
export function formatMetric(value: number | null, unit: MetricUnit, locale: string, currency: string, opts: { compact?: boolean } = {}): string {
  if (value === null) return "—";
  switch (unit) {
    case "money":
      if (opts.compact && Math.abs(value) >= 100_000_00) return formatNumber(value / 100, locale, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 });
      return formatMoney({ amountMinor: BigInt(Math.round(value)), currency }, locale);
    case "percent":
      return formatNumber(value / 100, locale, { style: "percent", maximumFractionDigits: 1 });
    case "days":
    case "hours":
      return formatNumber(value, locale, { style: "unit", unit: unit === "days" ? "day" : "hour", unitDisplay: "short", maximumFractionDigits: 1 });
    default:
      return formatNumber(value, locale, { maximumFractionDigits: 2, ...(opts.compact && Math.abs(value) >= 100_000 ? { notation: "compact" } : {}) });
  }
}

export function formatChange(pct: number | null, locale: string): string | null {
  if (pct === null) return null;
  return formatNumber(pct / 100, locale, { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
}
