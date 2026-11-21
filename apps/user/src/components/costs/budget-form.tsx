"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

const SCOPES = ["COMPANY", "DEPARTMENT", "AGENT", "TASK"] as const;
type Scope = (typeof SCOPES)[number];

/** Add or update a spending budget (company / department / AI employee per month, or every single task). */
export function BudgetForm({ path, departments, employees }: { path: string; departments: { key: string; label: string }[]; employees: { id: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const id = useId();
  const [scope, setScope] = useState<Scope>("COMPANY");
  const [dept, setDept] = useState(departments[0]?.key ?? "");
  const [agent, setAgent] = useState(employees[0]?.id ?? "");
  const [limit, setLimit] = useState("");
  const [hardStop, setHardStop] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const scopeKey = scope === "DEPARTMENT" ? dept : scope === "AGENT" ? agent : "*";
      await api(path, { body: { scope, scopeKey, limitUsd: Number(limit), hardStop } });
      setLimit("");
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const scopes = SCOPES.filter((s) => s !== "AGENT" || employees.length > 0);
  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-3 rounded-lg border bg-surface-2/50 p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("costs.budgets.form.scope")} htmlFor={`${id}-scope`} hint={scope === "TASK" ? t("costs.budgets.form.taskHint") : t("costs.budgets.form.monthHint")}>
          <Select id={`${id}-scope`} value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
            {scopes.map((s) => (
              <option key={s} value={s}>
                {t(`costs.budgets.scope.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        {scope === "DEPARTMENT" ? (
          <Field label={t("costs.budgets.form.department")} htmlFor={`${id}-dept`}>
            <Select id={`${id}-dept`} value={dept} onChange={(e) => setDept(e.target.value)}>
              {departments.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : scope === "AGENT" ? (
          <Field label={t("costs.budgets.form.agent")} htmlFor={`${id}-agent`}>
            <Select id={`${id}-agent`} value={agent} onChange={(e) => setAgent(e.target.value)}>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <span className="hidden sm:block" />
        )}
        <Field label={t("costs.budgets.form.limit")} htmlFor={`${id}-limit`}>
          <Input id={`${id}-limit`} type="number" inputMode="decimal" min="0.01" step="0.01" required value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={hardStop} onChange={(e) => setHardStop(e.target.checked)} className="size-4 accent-[var(--primary)]" />
        {t("costs.budgets.form.hardStop")}
      </label>
      <div>
        <Button type="submit" size="sm" loading={busy} disabled={!limit || Number(limit) <= 0}>
          {t("costs.budgets.form.save")}
        </Button>
      </div>
      {error ? <FormError error={error} /> : null}
    </form>
  );
}
