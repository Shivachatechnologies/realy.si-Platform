"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

const RANGES = ["7d", "30d", "90d", "month", "quarter", "year"] as const;

/** Add a widget (metric + chart type + range) to a dashboard. */
export function WidgetForm({ path, metrics }: { path: string; metrics: { key: string; label: string; group: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [metricKey, setMetricKey] = useState(metrics[0]?.key ?? "");
  const [chartType, setChartType] = useState<"NUMBER" | "LINE" | "BAR">("NUMBER");
  const [range, setRange] = useState<(typeof RANGES)[number]>("30d");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const groups = [...new Set(metrics.map((m) => m.group))];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(path, { body: { metricKey, chartType, range, title: title || null } });
      setTitle("");
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!metrics.length) return <p className="text-sm text-muted-foreground">{t("analytics.noMetrics")}</p>;
  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("analytics.widgets.metric")} htmlFor="widget-metric">
          <Select id="widget-metric" value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {metrics
                  .filter((m) => m.group === g)
                  .map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label={t("analytics.widgets.chart")} htmlFor="widget-chart">
          <Select id="widget-chart" value={chartType} onChange={(e) => setChartType(e.target.value as typeof chartType)}>
            {(["NUMBER", "LINE", "BAR"] as const).map((c) => (
              <option key={c} value={c}>
                {t(`analytics.widgets.types.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("analytics.range.label")} htmlFor="widget-range">
          <Select id="widget-range" value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
            {RANGES.map((r) => (
              <option key={r} value={r}>
                {t(`analytics.range.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("analytics.widgets.title")} htmlFor="widget-title">
          <Input id="widget-title" value={title} maxLength={120} placeholder={t("common.optional")} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </div>
      <FormError error={error} />
      <div>
        <Button type="submit" size="sm" disabled={busy || !metricKey}>
          <Plus aria-hidden />
          {t("analytics.widgets.add")}
        </Button>
      </div>
    </form>
  );
}
