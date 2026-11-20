"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** Set or remove a department's monthly AI budget (tokens and/or USD). Enforced before and during every run. */
export function DepartmentBudgetForm({ path, department, tokens, costCents }: { path: string; department: string; tokens: number | null; costCents: number | null }) {
  const t = useT();
  const router = useRouter();
  const [tok, setTok] = useState(tokens?.toString() ?? "");
  const [usd, setUsd] = useState(costCents === null ? "" : (costCents / 100).toString());
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const id = `budget-${department}`;

  async function save(body: { monthlyTokenBudget: number | null; monthlyCostBudgetCents: number | null }) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api(path, { body: { department, ...body } });
      setSaved(true);
      router.refresh();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void save({ monthlyTokenBudget: tok ? Math.round(Number(tok)) : null, monthlyCostBudgetCents: usd ? Math.round(Number(usd) * 100) : null });
  }

  return (
    <form onSubmit={submit} className="grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        <label htmlFor={`${id}-usd`} className="grid gap-1 text-xs text-muted-foreground">
          {t("workforce.budgets.usdPerMonth")}
          <Input id={`${id}-usd`} type="number" min={0.01} step={0.01} inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} className="h-9" />
        </label>
        <label htmlFor={`${id}-tok`} className="grid gap-1 text-xs text-muted-foreground">
          {t("workforce.budgets.tokensPerMonth")}
          <Input id={`${id}-tok`} type="number" min={1000} step={1000} inputMode="numeric" value={tok} onChange={(e) => setTok(e.target.value)} className="h-9" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {t("workforce.budgets.save")}
        </Button>
        {tokens !== null || costCents !== null ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void save({ monthlyTokenBudget: null, monthlyCostBudgetCents: null }).then((ok) => {
              if (!ok) return;
              setTok("");
              setUsd("");
            })}>
            {t("workforce.budgets.remove")}
          </Button>
        ) : null}
        {saved ? <span className="text-xs text-success" role="status">{t("workforce.budgets.saved")}</span> : null}
      </div>
      {error ? <FormError error={error} /> : null}
    </form>
  );
}
