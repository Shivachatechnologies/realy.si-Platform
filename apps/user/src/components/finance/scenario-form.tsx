"use client";

import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./ui";

export interface ScenarioValues {
  name: string;
  revenueGrowth: string;
  expenseChange: string;
  months: string;
  oneOffs: { month: string; amount: string; label: string }[];
}

/** Named what-if scenario: monthly revenue growth, expense change and one-off items. */
export function ScenarioForm({ base, id, initial }: { base: string; id?: string; initial?: ScenarioValues }) {
  const t = useT();
  const empty: ScenarioValues = { name: "", revenueGrowth: "0", expenseChange: "0", months: "12", oneOffs: [] };
  const [v, setV] = useState<ScenarioValues>(initial ?? empty);
  const { busy, error, run } = useAction();
  const setOne = (i: number, k: "month" | "amount" | "label", value: string) => setV((p) => ({ ...p, oneOffs: p.oneOffs.map((o, j) => (j === i ? { ...o, [k]: value } : o)) }));
  return (
    <form
      className="grid gap-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const body = { name: v.name, revenueGrowth: Number(v.revenueGrowth || 0), expenseChange: Number(v.expenseChange || 0), months: Number(v.months || 12), oneOffs: v.oneOffs };
        void run(() => (id ? api(`${base}/scenarios/${id}`, { method: "PATCH", body }) : api(`${base}/scenarios`, { body })), () => !id && setV(empty));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t("finance.fields.name")} htmlFor={`sc-name-${id ?? "new"}`}>
          <Input id={`sc-name-${id ?? "new"}`} required maxLength={80} value={v.name} onChange={(e) => setV((p) => ({ ...p, name: e.target.value }))} />
        </Field>
        <Field label={t("finance.scenarios.revenueGrowth")} htmlFor={`sc-g-${id ?? "new"}`} hint={t("finance.scenarios.revenueGrowthHint")}>
          <Input id={`sc-g-${id ?? "new"}`} type="number" step="0.1" min={-100} max={1000} value={v.revenueGrowth} onChange={(e) => setV((p) => ({ ...p, revenueGrowth: e.target.value }))} />
        </Field>
        <Field label={t("finance.scenarios.expenseChange")} htmlFor={`sc-e-${id ?? "new"}`} hint={t("finance.scenarios.expenseChangeHint")}>
          <Input id={`sc-e-${id ?? "new"}`} type="number" step="0.1" min={-100} max={1000} value={v.expenseChange} onChange={(e) => setV((p) => ({ ...p, expenseChange: e.target.value }))} />
        </Field>
        <Field label={t("finance.scenarios.months")} htmlFor={`sc-m-${id ?? "new"}`}>
          <Input id={`sc-m-${id ?? "new"}`} type="number" min={1} max={36} value={v.months} onChange={(e) => setV((p) => ({ ...p, months: e.target.value }))} />
        </Field>
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">{t("finance.scenarios.oneOffs")}</p>
        {v.oneOffs.map((o, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[9rem_9rem_minmax(0,1fr)_2.5rem]">
            <Input type="month" required value={o.month} aria-label={t("finance.cashflow.month")} onChange={(e) => setOne(i, "month", e.target.value)} />
            <Input inputMode="decimal" required pattern="-?\d{1,13}([.]\d{1,3})?" value={o.amount} placeholder="-5000" aria-label={t("finance.fields.amount")} onChange={(e) => setOne(i, "amount", e.target.value)} />
            <Input required maxLength={120} value={o.label} placeholder={t("finance.scenarios.oneOffLabel")} aria-label={t("finance.scenarios.oneOffLabel")} onChange={(e) => setOne(i, "label", e.target.value)} />
            <Button type="button" variant="ghost" size="icon" aria-label={t("finance.delete")} onClick={() => setV((p) => ({ ...p, oneOffs: p.oneOffs.filter((_, j) => j !== i) }))}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">{t("finance.scenarios.oneOffHint")}</p>
        <div>
          <Button type="button" size="sm" variant="secondary" disabled={v.oneOffs.length >= 50} onClick={() => setV((p) => ({ ...p, oneOffs: [...p.oneOffs, { month: new Date().toISOString().slice(0, 7), amount: "", label: "" }] }))}>
            <Plus aria-hidden />
            {t("finance.scenarios.addOneOff")}
          </Button>
        </div>
      </div>
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? t("common.saving") : id ? t("common.save") : t("finance.scenarios.create")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}
