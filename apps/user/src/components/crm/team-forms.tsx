"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./lead-forms";

/** Capacity settings of one sales team member (sales.manage). */
export function SalesRepForm({ base, ownerId, initial }: { base: string; ownerId: string; initial: { maxOpenDeals: string; maxOpenLeads: string; available: boolean; role: string } }) {
  const t = useT();
  const [f, setF] = useState(initial);
  const { busy, error, run } = useAction();
  const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v)) || 0));
  return (
    <form
      className="grid gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto_auto] sm:items-center"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/sales/team/${ownerId}`, { method: "PATCH", body: { maxOpenDeals: num(f.maxOpenDeals), maxOpenLeads: num(f.maxOpenLeads), available: f.available, role: f.role.trim() || null } }));
      }}
    >
      <Input aria-label={t("sales.team.role")} placeholder={t("sales.team.role")} className="h-8 text-xs" maxLength={100} value={f.role} onChange={(e) => setF((p) => ({ ...p, role: e.target.value }))} />
      <Input aria-label={t("sales.team.maxOpenDeals")} placeholder={t("sales.team.maxOpenDeals")} title={t("sales.team.maxOpenDeals")} type="number" min={0} className="h-8 text-xs" value={f.maxOpenDeals} onChange={(e) => setF((p) => ({ ...p, maxOpenDeals: e.target.value }))} />
      <Input aria-label={t("sales.team.maxOpenLeads")} placeholder={t("sales.team.maxOpenLeads")} title={t("sales.team.maxOpenLeads")} type="number" min={0} className="h-8 text-xs" value={f.maxOpenLeads} onChange={(e) => setF((p) => ({ ...p, maxOpenLeads: e.target.value }))} />
      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" className="size-4 accent-primary" checked={f.available} onChange={(e) => setF((p) => ({ ...p, available: e.target.checked }))} />
        {t("sales.team.available")}
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={busy}>
        {t("common.save")}
      </Button>
      <div className="sm:col-span-5">
        <FormError error={error} />
      </div>
    </form>
  );
}

/** Set (create or replace) this month's / quarter's revenue target for an owner. */
export function TargetQuickForm({ base, ownerId, month, quarter }: { base: string; ownerId: string; month: string; quarter: string }) {
  const t = useT();
  const [f, setF] = useState({ period: "MONTH", amount: "" });
  const { busy, error, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/crm/settings/targets`, { body: { ownerId, period: f.period, periodStart: f.period === "MONTH" ? month : quarter, amount: f.amount } }), () => setF((p) => ({ ...p, amount: "" })));
      }}
    >
      <Select aria-label={t("sales.team.period")} className="h-8 w-auto text-xs" value={f.period} onChange={(e) => setF((p) => ({ ...p, period: e.target.value }))}>
        <option value="MONTH">{t("sales.team.thisMonth")}</option>
        <option value="QUARTER">{t("sales.team.thisQuarter")}</option>
      </Select>
      <Input aria-label={t("sales.team.targetAmount")} placeholder={t("sales.team.targetAmount")} inputMode="decimal" className="h-8 w-28 text-xs" value={f.amount} required pattern="^\d{1,12}(\.\d{1,3})?$" onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} />
      <Button type="submit" size="sm" variant="ghost" disabled={busy || !f.amount}>
        {t("sales.team.setTarget")}
      </Button>
      <FormError error={error} />
    </form>
  );
}
