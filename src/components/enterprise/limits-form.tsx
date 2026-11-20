"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./use-action";

const KEYS = ["maxMembers", "maxCompanies", "maxWorkspacesPerCompany", "maxAiTokensPerDay", "maxApiKeys"] as const;
type Key = (typeof KEYS)[number];

/** Organization usage limits (empty = unlimited). */
export function LimitsForm({ orgId, initial }: { orgId: string; initial: Record<Key, number | null> }) {
  const { t } = useI18n();
  const [v, setV] = useState<Record<Key, string>>(() => Object.fromEntries(KEYS.map((k) => [k, initial[k] === null ? "" : String(initial[k])])) as Record<Key, string>);
  const a = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run(() =>
          api(`/api/v1/organizations/${orgId}/enterprise/limits`, {
            method: "PUT",
            body: Object.fromEntries(KEYS.map((k) => [k, v[k] === "" ? null : Number(v[k])])),
          }),
        );
      }}
    >
      {KEYS.map((k) => (
        <Field key={k} label={t(`enterprise.limits.${k}`)} htmlFor={`lim-${k}`} hint={t("enterprise.limits.unlimitedHint")} error={a.fields[k]}>
          <Input id={`lim-${k}`} type="number" min={0} step={1} inputMode="numeric" value={v[k]} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} />
        </Field>
      ))}
      <div className="grid gap-2 sm:col-span-3">
        <FormError error={a.error} />
        {a.done ? <Notice tone="success">{t("enterprise.saved")}</Notice> : null}
        <div>
          <Button type="submit" disabled={a.busy}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </form>
  );
}
