"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { useI18n } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import { api } from "@/lib/api-client";
import { ActionDialog } from "./action-dialog";

export interface PlanLimitsDTO {
  id: string;
  name: string;
  key: string;
  trialDays: number;
  entitlements: { featureKey: string; enabled: boolean; limitValue: string | null }[];
}

/**
 * Usage quotas and module access per plan, stored as plan entitlements (enforced: seats, companies, AI tokens per
 * month, API calls per month, module access). Empty = unlimited; unchecked module = not included in the plan.
 */
export function PlanLimits({ plans, limitKeys, moduleKeys, canManage }: { plans: PlanLimitsDTO[]; limitKeys: string[]; moduleKeys: string[]; canManage: boolean }) {
  const { t, locale } = useI18n();
  const show = (p: PlanLimitsDTO, key: string) => {
    const e = p.entitlements.find((x) => x.featureKey === key);
    if (!e) return "∞";
    if (!e.enabled) return "0";
    return e.limitValue === null ? "∞" : formatNumber(BigInt(e.limitValue), locale);
  };
  return (
    <Card>
      <CardHeader title={t("admin.plans.limitsTitle")} description={t("admin.plans.limitsHint")} />
      <Table>
        <THead>
          <Tr>
            <Th>{t("admin.pricing.plans")}</Th>
            {limitKeys.map((k) => (
              <Th key={k}>{t(`admin.plans.limits.${k}`)}</Th>
            ))}
            <Th>{t("admin.plans.modules")}</Th>
            {canManage ? <Th>{t("common.actions")}</Th> : null}
          </Tr>
        </THead>
        <TBody>
          {plans.map((p) => {
            const excluded = moduleKeys.filter((m) => p.entitlements.some((e) => e.featureKey === `module.${m}` && !e.enabled));
            return (
              <Tr key={p.id}>
                <Td>
                  <div className="font-medium">{p.name}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {p.key} · {t("admin.plans.trial", { count: p.trialDays })}
                  </div>
                </Td>
                {limitKeys.map((k) => (
                  <Td key={k} className="tabular text-xs">
                    {show(p, k)}
                  </Td>
                ))}
                <Td className="text-xs">
                  {excluded.length ? (
                    <div className="flex flex-wrap gap-1">
                      {excluded.map((m) => (
                        <Badge key={m} tone="danger">
                          {t(`platformModules.${m}`)}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    t("admin.plans.allModules")
                  )}
                </Td>
                {canManage ? (
                  <Td>
                    <PlanLimitsDialog plan={p} limitKeys={limitKeys} moduleKeys={moduleKeys} />
                  </Td>
                ) : null}
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </Card>
  );
}

function PlanLimitsDialog({ plan, limitKeys, moduleKeys }: { plan: PlanLimitsDTO; limitKeys: string[]; moduleKeys: string[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const current = () => ({
    limits: Object.fromEntries(
      limitKeys.map((k) => {
        const e = plan.entitlements.find((x) => x.featureKey === k);
        return [k, !e ? "" : !e.enabled ? "0" : (e.limitValue ?? "")];
      }),
    ) as Record<string, string>,
    modules: Object.fromEntries(moduleKeys.map((m) => [m, !plan.entitlements.some((e) => e.featureKey === `module.${m}` && !e.enabled)])) as Record<string, boolean>,
  });
  const [draft, setDraft] = useState(current);
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary" onClick={() => setDraft(current())}>
          {t("admin.common.edit")}
        </Button>
      }
      title={`${t("admin.plans.limitsTitle")}: ${plan.name}`}
      confirmLabel={t("common.save")}
      canSubmit={limitKeys.every((k) => /^\d{0,15}$/.test(draft.limits[k] ?? ""))}
      onConfirm={async (reason) => {
        const before = current();
        const url = `/api/v1/admin/plans/${plan.id}/entitlements`;
        for (const k of limitKeys) {
          const v = (draft.limits[k] ?? "").trim();
          if (v === before.limits[k]) continue;
          await api(url, { method: "PUT", body: { featureKey: k, enabled: true, limitValue: v === "" ? null : v, reason } });
        }
        for (const m of moduleKeys) {
          if (draft.modules[m] === before.modules[m]) continue;
          await api(url, { method: "PUT", body: { featureKey: `module.${m}`, enabled: !!draft.modules[m], limitValue: null, reason } });
        }
        router.refresh();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {limitKeys.map((k) => (
          <Field key={k} label={t(`admin.plans.limits.${k}`)} htmlFor={`lim-${k}`} hint={t("admin.controls.emptyNoLimit")}>
            <Input id={`lim-${k}`} inputMode="numeric" value={draft.limits[k] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, limits: { ...d.limits, [k]: e.target.value.replace(/[^\d]/g, "") } }))} />
          </Field>
        ))}
      </div>
      <fieldset className="grid grid-cols-2 gap-1 rounded-md border p-2 sm:grid-cols-3">
        <legend className="px-1 text-xs text-muted-foreground">{t("admin.plans.modules")}</legend>
        {moduleKeys.map((m) => (
          <label key={m} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!draft.modules[m]} onChange={(e) => setDraft((d) => ({ ...d, modules: { ...d.modules, [m]: e.target.checked } }))} />
            {t(`platformModules.${m}`)}
          </label>
        ))}
      </fieldset>
    </ActionDialog>
  );
}
