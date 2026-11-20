import { formatDate } from "@/i18n/format";
import type { SeriesPoint } from "@/server/modules/bi/service";
import type { MetricUnit } from "@/server/core/metrics";
import type { ChartPoint } from "./charts";
import { formatMetric } from "./format";

/** Series → chart points with localized period labels and formatted values. */
export function toChartPoints(series: SeriesPoint[], unit: MetricUnit, locale: string, currency: string): ChartPoint[] {
  return series.map((p) => {
    const from = new Date(p.from);
    const to = new Date(new Date(p.to).getTime() - 1);
    const sameDay = from.toISOString().slice(0, 10) === to.toISOString().slice(0, 10);
    const label = sameDay ? formatDate(from, locale, "UTC", { month: "short", day: "numeric" }) : `${formatDate(from, locale, "UTC", { month: "short", day: "numeric" })} – ${formatDate(to, locale, "UTC", { month: "short", day: "numeric" })}`;
    return { label, value: p.value, display: formatMetric(p.value, unit, locale, currency) };
  });
}
