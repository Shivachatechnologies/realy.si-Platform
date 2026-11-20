"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";

const RANGES = ["7d", "30d", "90d", "month", "quarter", "year", "custom"] as const;

export interface ReportValues {
  name: string;
  description: string;
  metricKeys: string[];
  range: (typeof RANGES)[number];
  customFrom: string;
  customTo: string;
  bucketed: boolean;
  shared: boolean;
}

/** Create or edit a saved report definition. */
export function ReportForm({ apiBase, metrics, reportId, initial, onDone }: { apiBase: string; metrics: { key: string; label: string; group: string }[]; reportId?: string; initial?: ReportValues; onDone?: () => void }) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<ReportValues>(initial ?? { name: "", description: "", metricKeys: [], range: "30d", customFrom: "", customTo: "", bucketed: false, shared: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fields = error instanceof ApiError ? error.fieldErrors() : {};
  const groups = [...new Set(metrics.map((m) => m.group))];
  const id = reportId ?? "new-report";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: v.name,
      description: v.description || null,
      metricKeys: v.metricKeys,
      range: v.range,
      customFrom: v.range === "custom" ? v.customFrom || null : null,
      customTo: v.range === "custom" ? v.customTo || null : null,
      bucketed: v.bucketed,
      shared: v.shared,
    };
    try {
      if (reportId) {
        await api(`${apiBase}/analytics/reports/${reportId}`, { method: "PATCH", body });
        onDone?.();
        router.refresh();
        setBusy(false);
      } else {
        const r = await api<{ id: string }>(`${apiBase}/analytics/reports`, { body });
        router.push(`/${locale}/analytics/reports/${r.id}`);
      }
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("analytics.reports.name")} htmlFor={`${id}-name`} error={fields.name}>
          <Input id={`${id}-name`} value={v.name} maxLength={120} required onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label={t("analytics.reports.description")} htmlFor={`${id}-description`}>
          <Input id={`${id}-description`} value={v.description} maxLength={500} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
      </div>
      <fieldset className="grid gap-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t("analytics.reports.metrics")}</legend>
        {fields.metricKeys ? <p className="text-xs text-danger">{fields.metricKeys}</p> : null}
        {metrics.length === 0 ? <p className="text-sm text-muted-foreground">{t("analytics.noMetrics")}</p> : null}
        {groups.map((g) => (
          <div key={g} className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">{g}</span>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {metrics
                .filter((m) => m.group === g)
                .map((m) => (
                  <label key={m.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={v.metricKeys.includes(m.key)}
                      onChange={(e) => setV({ ...v, metricKeys: e.target.checked ? [...v.metricKeys, m.key] : v.metricKeys.filter((k) => k !== m.key) })}
                    />
                    {m.label}
                  </label>
                ))}
            </div>
          </div>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("analytics.range.label")} htmlFor={`${id}-range`}>
          <Select id={`${id}-range`} value={v.range} onChange={(e) => setV({ ...v, range: e.target.value as ReportValues["range"] })}>
            {RANGES.map((r) => (
              <option key={r} value={r}>
                {t(`analytics.range.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        {v.range === "custom" ? (
          <>
            <Field label={t("analytics.range.from")} htmlFor={`${id}-from`}>
              <Input id={`${id}-from`} type="date" required value={v.customFrom} onChange={(e) => setV({ ...v, customFrom: e.target.value })} />
            </Field>
            <Field label={t("analytics.range.to")} htmlFor={`${id}-to`}>
              <Input id={`${id}-to`} type="date" required value={v.customTo} min={v.customFrom || undefined} onChange={(e) => setV({ ...v, customTo: e.target.value })} />
            </Field>
          </>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v.bucketed} onChange={(e) => setV({ ...v, bucketed: e.target.checked })} />
          {t("analytics.reports.bucketed")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v.shared} onChange={(e) => setV({ ...v, shared: e.target.checked })} />
          {t("analytics.reports.shared")}
        </label>
      </div>
      <FormError error={error} />
      <div>
        <Button type="submit" size="sm" disabled={busy || v.metricKeys.length === 0}>
          {busy ? t("common.saving") : reportId ? t("common.save") : t("analytics.reports.create")}
        </Button>
      </div>
    </form>
  );
}
