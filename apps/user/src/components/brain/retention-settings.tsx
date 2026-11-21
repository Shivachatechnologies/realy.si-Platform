"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

const CHOICES = [null, 30, 90, 180, 365, 730, 1825] as const;

/** Retention per memory layer: managers pick how long rows are kept before the retention job removes them. */
export function RetentionSettings({
  organizationId,
  companyId,
  rows,
  canManage,
}: {
  organizationId: string;
  companyId: string;
  rows: { layer: string; retentionDays: number | null; custom: boolean }[];
  canManage: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function change(layer: string, value: string) {
    setBusy(layer);
    setError(null);
    try {
      await api(`/api/v1/organizations/${organizationId}/companies/${companyId}/brain/memory/retention`, { method: "PUT", body: { layer, retentionDays: value ? Number(value) : null } });
      router.refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const label = (d: number | null) => (d === null ? t("brain.memory.retention.forever") : t("brain.memory.retention.days", { count: d }));
  return (
    <div className="grid gap-3">
      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((r) => {
          const options = CHOICES.includes(r.retentionDays as (typeof CHOICES)[number]) ? CHOICES : [...CHOICES, r.retentionDays];
          return (
            <li key={r.layer} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{t(`brain.memory.layers.${r.layer}`)}</p>
                <p className="text-xs text-muted-foreground">{r.custom ? t("brain.memory.retention.custom") : t("brain.memory.retention.default")}</p>
              </div>
              {canManage ? (
                <Select
                  aria-label={t("brain.memory.retention.for", { layer: t(`brain.memory.layers.${r.layer}`) })}
                  className="w-40 shrink-0"
                  value={r.retentionDays === null ? "" : String(r.retentionDays)}
                  disabled={busy !== null}
                  onChange={(e) => void change(r.layer, e.target.value)}
                >
                  {options.map((d) => (
                    <option key={String(d)} value={d === null ? "" : String(d)}>
                      {label(d)}
                    </option>
                  ))}
                </Select>
              ) : (
                <span className="shrink-0 text-sm">{label(r.retentionDays)}</span>
              )}
            </li>
          );
        })}
      </ul>
      <FormError error={error} />
    </div>
  );
}
