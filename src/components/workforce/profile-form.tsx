"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { AUTONOMY_OPTIONS } from "./employee-form";

export type ProfileSection = "configure" | "role" | "goals" | "permissions";
export const ORG_LEVEL_OPTIONS = ["EXECUTIVE", "MANAGER", "SPECIALIST"] as const;

export interface ProfileValues {
  jobTitle: string;
  jobDescription: string;
  instructions: string;
  skills: string[];
  model: string | null;
  managerEmployeeId: string | null;
  managerUserId: string | null;
  level: (typeof ORG_LEVEL_OPTIONS)[number];
  responsibilities: string[];
  goals: string[];
  kpis: { key: string; target: number }[];
  autonomy: (typeof AUTONOMY_OPTIONS)[number];
  runsAsUserId: string | null;
  monthlyTokenBudget: number | null;
  allowedTools: string[];
}

export interface ProfileOptions {
  employees: { id: string; name: string }[];
  members: { id: string; name: string }[];
  models: string[];
  defaultModel: string;
  metrics: { key: string; label: string }[];
  tools: { name: string; label: string; needsApproval: boolean }[];
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

/** Edit the parts of an AI employee's profile named in `sections` (one PATCH). Used by the setup steps and the edit dialog. */
export function ProfileForm({
  apiBase,
  employeeId,
  sections,
  initial,
  options,
  submitLabel,
  onSaved,
}: {
  apiBase: string;
  employeeId: string;
  sections: ProfileSection[];
  initial: ProfileValues;
  options: ProfileOptions;
  submitLabel?: string;
  onSaved?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [responsibilities, setResponsibilities] = useState(initial.responsibilities.join("\n"));
  const [goals, setGoals] = useState(initial.goals.join("\n"));
  const [skills, setSkills] = useState(initial.skills.join(", "));
  const [limitTools, setLimitTools] = useState(initial.allowedTools.length > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const fields = error instanceof ApiError ? error.fieldErrors() : {};
  const set = <K extends keyof ProfileValues>(k: K, val: ProfileValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const has = (s: ProfileSection) => sections.includes(s);
  const id = `profile-${employeeId}-${sections.join("-")}`;
  const manager = v.managerEmployeeId ? `ai:${v.managerEmployeeId}` : v.managerUserId ? `user:${v.managerUserId}` : "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const body: Record<string, unknown> = {};
    if (has("configure")) Object.assign(body, { jobTitle: v.jobTitle || null, jobDescription: v.jobDescription || null, instructions: v.instructions || null, skills: skills.split(",").map((s) => s.trim()).filter(Boolean), model: v.model || null });
    if (has("role")) Object.assign(body, { managerEmployeeId: v.managerEmployeeId, managerUserId: v.managerEmployeeId ? null : v.managerUserId, level: v.level, responsibilities: lines(responsibilities) });
    if (has("goals")) Object.assign(body, { goals: lines(goals), kpis: v.kpis.filter((k) => k.key && Number.isFinite(k.target)) });
    if (has("permissions")) Object.assign(body, { autonomy: v.autonomy, runsAsUserId: v.runsAsUserId || null, monthlyTokenBudget: v.monthlyTokenBudget || null, allowedTools: limitTools ? v.allowedTools : [] });
    try {
      await api(`${apiBase}/workforce/employees/${employeeId}`, { method: "PATCH", body });
      setSaved(true);
      onSaved?.();
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      {has("configure") ? (
        <>
          <Field label={t("workforce.profile.jobTitle")} htmlFor={`${id}-title`} error={fields.jobTitle}>
            <Input id={`${id}-title`} value={v.jobTitle} maxLength={120} onChange={(e) => set("jobTitle", e.target.value)} />
          </Field>
          <Field label={t("workforce.profile.jobDescription")} htmlFor={`${id}-desc`} error={fields.jobDescription}>
            <Textarea id={`${id}-desc`} rows={3} maxLength={4000} value={v.jobDescription} onChange={(e) => set("jobDescription", e.target.value)} />
          </Field>
          <Field label={t("workforce.form.instructions")} htmlFor={`${id}-instructions`} hint={t("workforce.form.instructionsHint")} error={fields.instructions}>
            <Textarea id={`${id}-instructions`} rows={3} maxLength={4000} value={v.instructions} onChange={(e) => set("instructions", e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("workforce.form.skills")} htmlFor={`${id}-skills`} hint={t("workforce.form.skillsHint")} error={fields.skills}>
              <Input id={`${id}-skills`} value={skills} onChange={(e) => setSkills(e.target.value)} />
            </Field>
            <Field label={t("workforce.profile.model")} htmlFor={`${id}-model`} hint={t("workforce.profile.modelHint")} error={fields.model}>
              <Select id={`${id}-model`} value={v.model ?? ""} onChange={(e) => set("model", e.target.value || null)}>
                <option value="">{t("workforce.profile.modelDefault", { model: options.defaultModel })}</option>
                {options.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </>
      ) : null}

      {has("role") ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("workforce.profile.manager")} htmlFor={`${id}-manager`} hint={t("workforce.profile.managerHint")} error={fields.managerEmployeeId ?? fields.managerUserId}>
              <Select
                id={`${id}-manager`}
                value={manager}
                onChange={(e) => {
                  const [kind, val] = e.target.value.split(":");
                  setV((s) => ({ ...s, managerEmployeeId: kind === "ai" ? val! : null, managerUserId: kind === "user" ? val! : null }));
                }}
              >
                <option value="">{t("workforce.profile.noManager")}</option>
                <optgroup label={t("workforce.profile.people")}>
                  {options.members.map((m) => (
                    <option key={m.id} value={`user:${m.id}`}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("workforce.profile.aiEmployees")}>
                  {options.employees.map((m) => (
                    <option key={m.id} value={`ai:${m.id}`}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              </Select>
            </Field>
            <Field label={t("workforce.profile.level")} htmlFor={`${id}-level`} hint={t(`workforce.levels.${v.level}.hint`)}>
              <Select id={`${id}-level`} value={v.level} onChange={(e) => set("level", e.target.value as ProfileValues["level"])}>
                {ORG_LEVEL_OPTIONS.map((l) => (
                  <option key={l} value={l}>
                    {t(`workforce.levels.${l}.name`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t("workforce.profile.responsibilities")} htmlFor={`${id}-resp`} hint={t("workforce.profile.onePerLine")} error={fields.responsibilities}>
            <Textarea id={`${id}-resp`} rows={4} value={responsibilities} onChange={(e) => setResponsibilities(e.target.value)} />
          </Field>
        </>
      ) : null}

      {has("goals") ? (
        <>
          <Field label={t("workforce.profile.goals")} htmlFor={`${id}-goals`} hint={t("workforce.profile.onePerLine")} error={fields.goals}>
            <Textarea id={`${id}-goals`} rows={3} value={goals} onChange={(e) => setGoals(e.target.value)} />
          </Field>
          <fieldset className="grid gap-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{t("workforce.profile.kpis")}</legend>
            <p className="text-xs text-muted-foreground">{t("workforce.profile.kpisHint")}</p>
            {v.kpis.map((k, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_8rem_auto] items-end gap-2">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  {t("workforce.profile.kpiMetric")}
                  <Select value={k.key} onChange={(e) => set("kpis", v.kpis.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}>
                    <option value="">—</option>
                    {options.metrics.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  {t("workforce.profile.kpiTarget")}
                  <Input type="number" step="any" value={Number.isFinite(k.target) ? k.target : ""} onChange={(e) => set("kpis", v.kpis.map((x, j) => (j === i ? { ...x, target: e.target.value === "" ? NaN : Number(e.target.value) } : x)))} />
                </label>
                <Button type="button" variant="ghost" size="icon" onClick={() => set("kpis", v.kpis.filter((_, j) => j !== i))}>
                  <Trash2 aria-hidden />
                  <span className="sr-only">{t("workforce.profile.removeKpi")}</span>
                </Button>
              </div>
            ))}
            <div>
              <Button type="button" variant="secondary" size="sm" disabled={v.kpis.length >= 20} onClick={() => set("kpis", [...v.kpis, { key: "", target: 0 }])}>
                <Plus aria-hidden />
                {t("workforce.profile.addKpi")}
              </Button>
            </div>
            {fields.kpis ? <p className="text-xs text-danger">{fields.kpis}</p> : null}
          </fieldset>
        </>
      ) : null}

      {has("permissions") ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("workforce.form.autonomy")} htmlFor={`${id}-autonomy`} hint={t(`workforce.autonomy.${v.autonomy}.hint`)}>
              <Select id={`${id}-autonomy`} value={v.autonomy} onChange={(e) => set("autonomy", e.target.value as ProfileValues["autonomy"])}>
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
                {options.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t("workforce.form.budget")} htmlFor={`${id}-budget`} hint={t("workforce.form.budgetHint")} error={fields.monthlyTokenBudget}>
            <Input id={`${id}-budget`} type="number" min={1000} step={1000} inputMode="numeric" value={v.monthlyTokenBudget ?? ""} onChange={(e) => set("monthlyTokenBudget", e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <fieldset className="grid gap-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{t("workforce.tools")}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={limitTools} onChange={(e) => setLimitTools(e.target.checked)} />
              {t("workforce.form.limitTools")}
            </label>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {options.tools.map((tool) => (
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
        </>
      ) : null}

      <FormError error={error} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? t("common.saving") : (submitLabel ?? t("common.save"))}
        </Button>
        {saved ? <span className="text-xs text-success">{t("workforce.profile.saved")}</span> : null}
      </div>
    </form>
  );
}
