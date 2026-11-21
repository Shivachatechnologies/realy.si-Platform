"use client";

import { useState } from "react";
import { Pause, Play, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { ActionDialog, useAdminAction } from "./action-dialog";

const PATH = "/api/v1/admin/ai/models";

/** Provider on/off (off = every model of the provider on the platform kill list). */
export function ProviderToggle({ provider, label, enabled, canManage }: { provider: string; label: string; enabled: boolean; canManage: boolean }) {
  const { t } = useI18n();
  const run = useAdminAction();
  if (!canManage) return null;
  const title = enabled ? t("admin.aiModels.disableProvider", { name: label }) : t("admin.aiModels.enableProvider", { name: label });
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant={enabled ? "secondary" : "default"}>
          {enabled ? t("admin.aiModels.disable") : t("admin.aiModels.enable")}
        </Button>
      }
      title={title}
      description={enabled ? t("admin.aiModels.disableProviderHint") : undefined}
      confirmLabel={enabled ? t("admin.aiModels.disable") : t("admin.aiModels.enable")}
      danger={enabled}
      onConfirm={(reason) => run(PATH, "PUT", { action: "provider", provider, enabled: !enabled, reason })}
    />
  );
}

/** Enable / disable one model through the existing aiDisabledModels control. */
export function ModelToggle({ model, disabled, disabledList, canManage }: { model: string; disabled: boolean; disabledList: string[]; canManage: boolean }) {
  const { t } = useI18n();
  const run = useAdminAction();
  if (!canManage) return null;
  const next = disabled ? disabledList.filter((m) => m !== model) : [...disabledList, model];
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="ghost">
          {disabled ? t("admin.aiModels.enable") : t("admin.aiModels.disable")}
        </Button>
      }
      title={disabled ? t("admin.aiModels.enableModel", { model }) : t("admin.aiModels.disableModel", { model })}
      confirmLabel={disabled ? t("admin.aiModels.enable") : t("admin.aiModels.disable")}
      onConfirm={(reason) => run("/api/v1/admin/controls", "PUT", { key: "aiDisabledModels", value: next, reason })}
    />
  );
}

/** Default model for one profile class (department). */
export function ProfileModelPicker({ profileClass, label, current, models, canManage }: { profileClass: string; label: string; current: string | null; models: string[]; canManage: boolean }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [model, setModel] = useState(current ?? "");
  if (!canManage) return <span className="font-mono text-xs">{current ?? t("admin.aiModels.platformDefault")}</span>;
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="ghost" className="font-mono text-xs">
          {current ?? t("admin.aiModels.platformDefault")}
        </Button>
      }
      title={t("admin.aiModels.classModelTitle", { name: label })}
      description={t("admin.aiModels.classModelHint")}
      confirmLabel={t("common.save")}
      onConfirm={(reason) => run(PATH, "PUT", { action: "profileModel", profileClass, model: model || null, reason })}
    >
      <Field label={t("admin.aiModels.model")} htmlFor={`pm-${profileClass}`}>
        <Select id={`pm-${profileClass}`} value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">{t("admin.aiModels.platformDefault")}</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </Field>
    </ActionDialog>
  );
}

/** Add or change a per-organization model override. */
export function OrgModelOverride({ models, organizationId, current, name }: { models: string[]; organizationId?: string; current?: string; name?: string }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [org, setOrg] = useState(organizationId ?? "");
  const [model, setModel] = useState(current ?? models[0] ?? "");
  if (organizationId) {
    return (
      <ActionDialog
        trigger={
          <Button size="icon" variant="ghost" aria-label={t("admin.aiModels.removeOverride", { name: name ?? "" })}>
            <X />
          </Button>
        }
        title={t("admin.aiModels.removeOverride", { name: name ?? "" })}
        confirmLabel={t("admin.aiModels.remove")}
        onConfirm={(reason) => run(PATH, "PUT", { action: "orgModel", organizationId, model: null, reason })}
      />
    );
  }
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <Plus />
          {t("admin.aiModels.addOverride")}
        </Button>
      }
      title={t("admin.aiModels.addOverride")}
      description={t("admin.aiModels.overrideHint")}
      confirmLabel={t("common.save")}
      canSubmit={/^[0-9a-f-]{36}$/i.test(org.trim()) && !!model}
      onConfirm={(reason) => run(PATH, "PUT", { action: "orgModel", organizationId: org.trim(), model, reason })}
    >
      <Field label={t("admin.aiModels.organizationId")} htmlFor="om-org" hint={t("admin.aiModels.organizationIdHint")}>
        <Input id="om-org" value={org} onChange={(e) => setOrg(e.target.value)} className="font-mono" placeholder="00000000-0000-0000-0000-000000000000" />
      </Field>
      <Field label={t("admin.aiModels.model")} htmlFor="om-model">
        <Select id="om-model" value={model} onChange={(e) => setModel(e.target.value)}>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </Field>
    </ActionDialog>
  );
}

/** Platform monthly AI spend cap in USD (empty = no cap). */
export function BudgetEditor({ current }: { current: number | null }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const [value, setValue] = useState(current === null ? "" : String(current));
  const n = value.trim() === "" ? null : Number(value);
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          {t("admin.aiModels.setBudget")}
        </Button>
      }
      title={t("admin.aiModels.setBudget")}
      description={t("admin.aiModels.budgetHint")}
      confirmLabel={t("common.save")}
      canSubmit={n === null || (Number.isFinite(n) && n >= 0)}
      onConfirm={(reason) => run(PATH, "PUT", { action: "budget", monthlyUsd: n, reason })}
    >
      <Field label={t("admin.aiModels.budgetUsd")} htmlFor="budget-usd" hint={t("admin.aiModels.budgetEmpty")}>
        <Input id="budget-usd" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="5000" />
      </Field>
    </ActionDialog>
  );
}

/** Pause / resume all AI work of one organization. */
export function OrgAiPauseButton({ organizationId, name, paused }: { organizationId: string; name: string; paused: boolean }) {
  const { t } = useI18n();
  const run = useAdminAction();
  const label = paused ? t("admin.aiWorkforce.resume") : t("admin.aiWorkforce.pause");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant={paused ? "default" : "secondary"}>
          {paused ? <Play /> : <Pause />}
          {label}
        </Button>
      }
      title={paused ? t("admin.aiWorkforce.resumeTitle", { name }) : t("admin.aiWorkforce.pauseTitle", { name })}
      description={paused ? undefined : t("admin.aiWorkforce.pauseHint")}
      confirmLabel={label}
      danger={!paused}
      onConfirm={(reason) => run(`/api/v1/admin/ai/organizations/${organizationId}`, "PUT", { paused: !paused, reason })}
    />
  );
}
