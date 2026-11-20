"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";

/** Create (then open) or rename a custom dashboard. */
export function DashboardForm({ apiBase, dashboardId, initial }: { apiBase: string; dashboardId?: string; initial?: { name: string; description: string; shared: boolean } }) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const [v, setV] = useState(initial ?? { name: "", description: "", shared: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fields = error instanceof ApiError ? error.fieldErrors() : {};

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name: v.name, description: v.description || null, shared: v.shared };
      if (dashboardId) {
        await api(`${apiBase}/analytics/dashboards/${dashboardId}`, { method: "PATCH", body });
        router.refresh();
        setBusy(false);
      } else {
        const d = await api<{ id: string }>(`${apiBase}/analytics/dashboards`, { body });
        router.push(`/${locale}/analytics/dashboards/${d.id}`);
      }
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const id = dashboardId ?? "new-dashboard";
  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("analytics.dashboards.name")} htmlFor={`${id}-name`} error={fields.name}>
          <Input id={`${id}-name`} value={v.name} maxLength={120} required onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label={t("analytics.dashboards.description")} htmlFor={`${id}-description`} error={fields.description}>
          <Input id={`${id}-description`} value={v.description} maxLength={500} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.shared} onChange={(e) => setV({ ...v, shared: e.target.checked })} />
        {t("analytics.dashboards.shareHint")}
      </label>
      <FormError error={error} />
      <div>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? t("common.saving") : dashboardId ? t("common.save") : t("analytics.dashboards.create")}
        </Button>
      </div>
    </form>
  );
}
