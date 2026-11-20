import { formatMetric } from "@/components/bi/format";
import { formatNumber } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import type { MetricUnit } from "@/server/core/metrics";
import type { KrProgress } from "@/server/modules/objectives/key-results";
import { DeleteButton, EditKeyResultDialog, type MetricOption } from "./objective-forms";
import { KrStatusBadge, ProgressBar } from "./progress";

export interface KeyResultRow {
  id: string;
  title: string;
  source: "METRIC" | "MANUAL";
  metricKey: string | null;
  unit: string | null;
  baseline: number;
  target: number;
  current: number | null;
  direction: "INCREASE" | "DECREASE";
}

/** Format a key-result value: registry unit (money in minor units) or a manual unit label. */
export function formatKrValue(v: number | null, kr: { unit: string | null }, metricUnit: MetricUnit | null, locale: string, currency: string) {
  if (v === null) return "—";
  if (metricUnit) return formatMetric(v, metricUnit, locale, currency, { compact: true });
  return `${formatNumber(v, locale, { maximumFractionDigits: 2 })}${kr.unit ? ` ${kr.unit}` : ""}`;
}

const display = (unit: MetricUnit | null, v: number) => String(unit === "money" ? v / 100 : v);

export function KeyResultList({
  t,
  locale,
  currency,
  base,
  keyResults,
  progress,
  canManage,
  metrics,
}: {
  t: Translate;
  locale: string;
  currency: string;
  base: string;
  keyResults: KeyResultRow[];
  progress: Map<string, KrProgress>;
  canManage: boolean;
  metrics: MetricOption[];
}) {
  if (!keyResults.length) return <p className="text-sm text-muted-foreground">{t("objectives.kr.empty")}</p>;
  return (
    <ul className="grid gap-2">
      {keyResults.map((kr) => {
        const p = progress.get(kr.id) ?? { value: null, progress: null, status: "NO_DATA" as const, visible: true, unit: null };
        const unit = p.unit;
        return (
          <li key={kr.id} className="grid gap-1 rounded-md border bg-surface-2 p-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 font-medium">{kr.title}</span>
              <KrStatusBadge status={p.status} label={t(`objectives.kr.status.${p.status}`)} />
              <span className="tabular text-xs text-muted-foreground">{p.progress === null ? "—" : formatNumber(p.progress, locale, { style: "percent", maximumFractionDigits: 0 })}</span>
              {canManage ? (
                <span className="flex items-center">
                  <EditKeyResultDialog
                    base={base}
                    metrics={metrics}
                    keyResult={{ id: kr.id, title: kr.title, source: kr.source, metricKey: kr.metricKey ?? "", unit: kr.unit ?? "", baseline: display(unit, kr.baseline), target: display(unit, kr.target), current: kr.current === null ? "" : String(kr.current), direction: kr.direction }}
                  />
                  <DeleteButton endpoint={`${base}/key-results/${kr.id}`} label={t("objectives.kr.delete")} confirmText={t("objectives.kr.deleteConfirm", { title: kr.title })} />
                </span>
              ) : null}
            </div>
            <ProgressBar value={p.progress} status={p.status} label={kr.title} />
            <p className="text-xs text-muted-foreground">
              {p.visible
                ? t("objectives.kr.values", { current: formatKrValue(p.value, kr, unit, locale, currency), baseline: formatKrValue(kr.baseline, kr, unit, locale, currency), target: formatKrValue(kr.target, kr, unit, locale, currency) })
                : t("objectives.kr.hidden")}
              {kr.source === "METRIC" ? <span className="ms-2 font-mono">{kr.metricKey}</span> : <span className="ms-2">{t("objectives.kr.sources.MANUAL")}</span>}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
