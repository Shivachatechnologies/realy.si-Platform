"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ActionDialog, useAdminAction } from "./action-dialog";

/** Asks once per admin session for the reason to open a tenant's details; recorded as platform.tenant_viewed. */
export function TenantViewGate({ organizationId, name }: { organizationId: string; name: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="max-w-xl">
      <CardHeader title={t("admin.organizations.viewGate.title", { name })} description={t("admin.organizations.viewGate.hint")} />
      <CardBody>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api(`/api/v1/admin/organizations/${organizationId}/view`, { method: "POST", body: { reason } });
              router.refresh();
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={t("common.reason")} htmlFor="view-reason" hint={t("admin.common.reasonAudited")}>
            <Textarea id="view-reason" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("admin.organizations.viewGate.placeholder")} />
          </Field>
          <FormError error={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || reason.trim().length < 3}>
              {t("admin.organizations.viewGate.open")}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function OrgStatusButton({ organizationId, slug, status }: { organizationId: string; slug: string; status: "ACTIVE" | "SUSPENDED" | "CLOSED" }) {
  const { t } = useI18n();
  const run = useAdminAction();
  if (status === "CLOSED") return null;
  const suspend = status === "ACTIVE";
  const label = suspend ? t("admin.organizations.suspend") : t("admin.organizations.reactivate");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant={suspend ? "danger" : "default"}>
          {label}
        </Button>
      }
      title={label}
      description={suspend ? t("admin.organizations.suspendHint") : undefined}
      confirmLabel={label}
      phrase={suspend ? slug : undefined}
      danger={suspend}
      onConfirm={(reason, confirm) => run(`/api/v1/admin/organizations/${organizationId}/status`, "PUT", { status: suspend ? "SUSPENDED" : "ACTIVE", reason, confirm })}
    />
  );
}

export interface OrgOverrideDTO {
  disabledModules: string[];
  aiDisabled: boolean;
  aiDailyTokenBudget: number | null;
  aiMonthlyTokenBudget: number | null;
}

/** Per-organization restrictions: modules, AI switch and token budgets. */
export function OrgRestrictions({ organizationId, value, modules, canManage }: { organizationId: string; value: OrgOverrideDTO; modules: string[]; canManage: boolean }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [draft, setDraft] = useState(value);
  const num = (s: string) => (s.trim() === "" ? null : Math.max(0, Math.floor(Number(s))));
  if (!canManage) return null;
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary" onClick={() => setDraft(value)}>
          {t("admin.organizations.editRestrictions")}
        </Button>
      }
      title={t("admin.organizations.restrictions")}
      description={t("admin.organizations.restrictionsHint")}
      confirmLabel={t("common.save")}
      onConfirm={(reason) => run(`/api/v1/admin/organizations/${organizationId}/restrictions`, "PUT", { ...draft, reason })}
    >
      <fieldset className="grid grid-cols-2 gap-1 rounded-md border p-2 sm:grid-cols-3">
        <legend className="px-1 text-xs text-muted-foreground">{t("admin.organizations.disabledModules")}</legend>
        {modules.map((m) => (
          <label key={m} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.disabledModules.includes(m)}
              onChange={(e) => setDraft((d) => ({ ...d, disabledModules: e.target.checked ? [...d.disabledModules, m] : d.disabledModules.filter((x) => x !== m) }))}
            />
            {t(`admin.modules.${m}`)}
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.aiDisabled} onChange={(e) => setDraft((d) => ({ ...d, aiDisabled: e.target.checked }))} />
        {t("admin.organizations.aiDisabled")}
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("admin.organizations.aiDaily")} htmlFor="ai-daily" hint={t("admin.controls.emptyNoLimit")}>
          <Input id="ai-daily" type="number" min={0} value={draft.aiDailyTokenBudget ?? ""} onChange={(e) => setDraft((d) => ({ ...d, aiDailyTokenBudget: num(e.target.value) }))} />
        </Field>
        <Field label={t("admin.organizations.aiMonthly")} htmlFor="ai-monthly" hint={t("admin.controls.emptyNoLimit")}>
          <Input id="ai-monthly" type="number" min={0} value={draft.aiMonthlyTokenBudget ?? ""} onChange={(e) => setDraft((d) => ({ ...d, aiMonthlyTokenBudget: num(e.target.value) }))} />
        </Field>
      </div>
    </ActionDialog>
  );
}
