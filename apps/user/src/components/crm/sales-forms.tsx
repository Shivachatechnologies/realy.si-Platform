"use client";

import { useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { OwnerPicker, useAction, type Owner } from "./kit";

/** Sales targets and commission rules (stored via /crm/settings/targets and /crm/settings/commission-rules). */

export function TargetForm({ base, owners, period, periodStart }: { base: string; owners: Owner[]; period: "MONTH" | "QUARTER"; periodStart: string }) {
  const t = useT();
  const empty = { ownerId: owners[0]?.id ?? "", period, periodStart, amount: "", dealsTarget: "" };
  const [f, setF] = useState(empty);
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(
          () => api(`${base}/crm/settings/targets`, { body: { ...f, dealsTarget: f.dealsTarget === "" ? undefined : Number(f.dealsTarget) } }),
          () => setF((p) => ({ ...p, amount: "", dealsTarget: "" })),
        );
      }}
      className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_9rem_10rem_10rem_8rem_auto] sm:items-end"
    >
      <Field label={t("crm.owner")} htmlFor="tg-owner">
        <OwnerPicker id="tg-owner" owners={owners} value={f.ownerId} onChange={(v) => setF((p) => ({ ...p, ownerId: v }))} emptyLabel={t("sales.targets.pickOwner")} />
      </Field>
      <Field label={t("sales.targets.period")} htmlFor="tg-period">
        <Select id="tg-period" value={f.period} onChange={(e) => setF((p) => ({ ...p, period: e.target.value as "MONTH" | "QUARTER" }))}>
          <option value="MONTH">{t("sales.targets.MONTH")}</option>
          <option value="QUARTER">{t("sales.targets.QUARTER")}</option>
        </Select>
      </Field>
      <Field label={t("sales.targets.starting")} htmlFor="tg-start" hint={t("sales.targets.startingHint")}>
        <Input id="tg-start" type="date" value={f.periodStart} required onChange={(e) => setF((p) => ({ ...p, periodStart: e.target.value }))} />
      </Field>
      <Field label={t("sales.targets.revenue")} htmlFor="tg-amount">
        <Input id="tg-amount" inputMode="decimal" pattern="\d{1,12}(\.\d{1,3})?" value={f.amount} required onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} />
      </Field>
      <Field label={t("sales.targets.deals")} htmlFor="tg-deals">
        <Input id="tg-deals" type="number" min={0} value={f.dealsTarget} onChange={(e) => setF((p) => ({ ...p, dealsTarget: e.target.value }))} />
      </Field>
      <Button type="submit" variant="secondary" disabled={busy || !f.ownerId || !f.amount}>
        <Plus aria-hidden />
        {t("sales.targets.save")}
      </Button>
      <div className="sm:col-span-6">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function CommissionRuleForm({ base, owners, pipelines }: { base: string; owners: Owner[]; pipelines: { id: string; name: string }[] }) {
  const t = useT();
  const empty = { name: "", rate: "", pipelineId: "", ownerId: "" };
  const [f, setF] = useState(empty);
  const [tiers, setTiers] = useState<{ from: string; rate: string }[]>([]);
  const { busy, error, run } = useAction();
  const bps = (pct: string) => Math.round(Number(pct) * 100);
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(
          () =>
            api(`${base}/crm/settings/commission-rules`, {
              body: { name: f.name, rateBps: bps(f.rate), pipelineId: f.pipelineId, ownerId: f.ownerId, tiers: tiers.filter((x) => x.from && x.rate).map((x) => ({ from: x.from, rateBps: bps(x.rate) })) },
            }),
          () => (setF(empty), setTiers([])),
        );
      }}
      className="grid gap-3 p-4"
    >
      <div className="grid gap-2 sm:grid-cols-4 sm:items-end">
        <Field label={t("sales.commissions.ruleName")} htmlFor="cr-name">
          <Input id="cr-name" value={f.name} maxLength={100} required onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />
        </Field>
        <Field label={t("sales.commissions.rate")} htmlFor="cr-rate">
          <Input id="cr-rate" type="number" min={0} max={100} step="0.01" value={f.rate} required onChange={(e) => setF((p) => ({ ...p, rate: e.target.value }))} />
        </Field>
        <Field label={t("crm.fields.pipeline")} htmlFor="cr-pipeline">
          <Select id="cr-pipeline" value={f.pipelineId} onChange={(e) => setF((p) => ({ ...p, pipelineId: e.target.value }))}>
            <option value="">{t("sales.commissions.allPipelines")}</option>
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("crm.owner")} htmlFor="cr-owner">
          <OwnerPicker id="cr-owner" owners={owners} value={f.ownerId} onChange={(v) => setF((p) => ({ ...p, ownerId: v }))} emptyLabel={t("sales.commissions.everyone")} />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{t("sales.commissions.tiers")}</legend>
        <p className="text-xs text-muted-foreground">{t("sales.commissions.tiersHint")}</p>
        {tiers.map((tier, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input aria-label={t("sales.commissions.tierFrom")} className="w-40" inputMode="decimal" placeholder={t("sales.commissions.tierFrom")} value={tier.from} onChange={(e) => setTiers((ts) => ts.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
            <Input aria-label={t("sales.commissions.rate")} className="w-28" type="number" min={0} max={100} step="0.01" placeholder="%" value={tier.rate} onChange={(e) => setTiers((ts) => ts.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
            <Button type="button" size="icon" variant="ghost" aria-label={t("crm.delete")} onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))}>
              <X aria-hidden />
            </Button>
          </div>
        ))}
        <div>
          <Button type="button" size="sm" variant="ghost" disabled={tiers.length >= 10} onClick={() => setTiers((ts) => [...ts, { from: "", rate: "" }])}>
            <Plus aria-hidden />
            {t("sales.commissions.addTier")}
          </Button>
        </div>
      </fieldset>
      <div>
        <Button type="submit" variant="secondary" disabled={busy || !f.name.trim() || f.rate === ""}>
          <Plus aria-hidden />
          {t("sales.commissions.addRule")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}
