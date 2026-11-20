"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";

export const GROWTH_AUTONOMY_OPTIONS = ["OBSERVE", "RECOMMEND", "PREPARE", "EXECUTE_WITH_APPROVAL"] as const;

/** Growth engine settings: on/off, autonomy and the decision-overload threshold. */
export function GrowthSettingsForm({ apiBase, initial, disabled }: { apiBase: string; initial: { enabled: boolean; autonomy: (typeof GROWTH_AUTONOMY_OPTIONS)[number]; decisionThreshold: number }; disabled?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const fields = error instanceof ApiError ? error.fieldErrors() : {};

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api(`${apiBase}/growth/settings`, { method: "PATCH", body: v });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.enabled} disabled={disabled} onChange={(e) => setV((s) => ({ ...s, enabled: e.target.checked }))} />
        {t("growth.settings.enabled")}
      </label>
      <Field label={t("growth.settings.autonomy")} htmlFor="growth-autonomy" hint={t(`growth.autonomy.${v.autonomy}.hint`)}>
        <Select id="growth-autonomy" value={v.autonomy} disabled={disabled} onChange={(e) => setV((s) => ({ ...s, autonomy: e.target.value as typeof v.autonomy }))}>
          {GROWTH_AUTONOMY_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {t(`growth.autonomy.${a}.name`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("growth.settings.threshold")} htmlFor="growth-threshold" hint={t("growth.settings.thresholdHint")} error={fields.decisionThreshold}>
        <Input id="growth-threshold" type="number" min={1} max={500} disabled={disabled} value={v.decisionThreshold} onChange={(e) => setV((s) => ({ ...s, decisionThreshold: Number(e.target.value) }))} />
      </Field>
      <FormError error={error} />
      {!disabled ? (
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? t("common.saving") : t("common.save")}
          </Button>
          {saved ? <span className="text-xs text-success">{t("workforce.profile.saved")}</span> : null}
        </div>
      ) : null}
    </form>
  );
}
