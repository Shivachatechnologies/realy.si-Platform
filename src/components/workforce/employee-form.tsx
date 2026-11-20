"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";

export const AUTONOMY_OPTIONS = ["READ_ONLY", "RECOMMEND", "PREPARE", "EXECUTE_WITH_APPROVAL", "AUTONOMOUS_LOW_RISK"] as const;

export interface EmployeeFormValues {
  name: string;
  initials: string;
  instructions: string;
  skills: string[];
  allowedTools: string[];
  runsAsUserId: string | null;
  autonomy: (typeof AUTONOMY_OPTIONS)[number];
  monthlyTokenBudget: number | null;
}

/** Hire (create) or edit an AI employee. */
export function EmployeeForm({
  apiBase,
  profileKey,
  employeeId,
  tools,
  members,
  initial,
  onDone,
}: {
  apiBase: string;
  profileKey: string;
  /** Edit mode when set. */
  employeeId?: string;
  tools: { name: string; label: string; needsApproval: boolean }[];
  members: { id: string; name: string }[];
  initial: EmployeeFormValues;
  onDone?: () => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [skills, setSkills] = useState(initial.skills.join(", "));
  const [limitTools, setLimitTools] = useState(initial.allowedTools.length > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fields = error instanceof ApiError ? error.fieldErrors() : {};
  const set = <K extends keyof EmployeeFormValues>(k: K, val: EmployeeFormValues[K]) => setV((s) => ({ ...s, [k]: val }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      name: v.name,
      ...(v.initials ? { initials: v.initials } : {}),
      instructions: v.instructions || null,
      skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
      allowedTools: limitTools ? v.allowedTools : [],
      runsAsUserId: v.runsAsUserId || null,
      autonomy: v.autonomy,
      monthlyTokenBudget: v.monthlyTokenBudget || null,
    };
    try {
      if (employeeId) {
        await api(`${apiBase}/workforce/employees/${employeeId}`, { method: "PATCH", body: payload });
        onDone?.();
        router.refresh();
        setBusy(false);
      } else {
        // New hires start paused and go through the setup steps (role, goals, permissions) before activation.
        const created = await api<{ id: string }>(`${apiBase}/workforce/employees`, { body: { profileKey, ...payload, activate: false } });
        router.push(`/${locale}/workforce/${created.id}/setup`);
      }
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const id = employeeId ?? profileKey;
  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem]">
        <Field label={t("workforce.form.name")} htmlFor={`${id}-name`} error={fields.name}>
          <Input id={`${id}-name`} value={v.name} maxLength={80} required onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label={t("workforce.form.initials")} htmlFor={`${id}-initials`} error={fields.initials}>
          <Input id={`${id}-initials`} value={v.initials} maxLength={3} onChange={(e) => set("initials", e.target.value)} />
        </Field>
      </div>
      <Field label={t("workforce.form.instructions")} htmlFor={`${id}-instructions`} hint={t("workforce.form.instructionsHint")} error={fields.instructions}>
        <Textarea id={`${id}-instructions`} rows={4} maxLength={4000} value={v.instructions} onChange={(e) => set("instructions", e.target.value)} />
      </Field>
      <Field label={t("workforce.form.skills")} htmlFor={`${id}-skills`} hint={t("workforce.form.skillsHint")} error={fields.skills}>
        <Input id={`${id}-skills`} value={skills} onChange={(e) => setSkills(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("workforce.form.autonomy")} htmlFor={`${id}-autonomy`} hint={t(`workforce.autonomy.${v.autonomy}.hint`)}>
          <Select id={`${id}-autonomy`} value={v.autonomy} onChange={(e) => set("autonomy", e.target.value as EmployeeFormValues["autonomy"])}>
            {AUTONOMY_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {t(`workforce.autonomy.${a}.name`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("workforce.form.runsAs")} htmlFor={`${id}-runs-as`} hint={t("workforce.form.runsAsHint")} error={fields.runsAsUserId}>
          <Select id={`${id}-runs-as`} value={v.runsAsUserId ?? ""} onChange={(e) => set("runsAsUserId", e.target.value || null)}>
            <option value="">{t("workforce.form.runsAsRequester")}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("workforce.form.budget")} htmlFor={`${id}-budget`} hint={t("workforce.form.budgetHint")} error={fields.monthlyTokenBudget}>
        <Input
          id={`${id}-budget`}
          type="number"
          min={1000}
          step={1000}
          inputMode="numeric"
          value={v.monthlyTokenBudget ?? ""}
          onChange={(e) => set("monthlyTokenBudget", e.target.value ? Number(e.target.value) : null)}
        />
      </Field>
      <fieldset className="grid gap-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t("workforce.tools")}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={limitTools} onChange={(e) => setLimitTools(e.target.checked)} />
          {t("workforce.form.limitTools")}
        </label>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {tools.map((tool) => (
            <label key={tool.name} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={!limitTools}
                checked={!limitTools || v.allowedTools.includes(tool.name)}
                onChange={(e) => set("allowedTools", e.target.checked ? [...v.allowedTools, tool.name] : v.allowedTools.filter((x) => x !== tool.name))}
              />
              <span>
                {tool.label}
                {tool.needsApproval ? <span className="ms-1 text-xs text-warning">· {t("workforce.needsApproval")}</span> : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <FormError error={error} />
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? t("common.saving") : employeeId ? t("common.save") : t("workforce.hire.submit")}
        </Button>
      </div>
    </form>
  );
}
