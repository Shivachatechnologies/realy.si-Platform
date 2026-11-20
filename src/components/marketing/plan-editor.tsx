"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** Same values as the server lists (client files never import server modules). */
const CHANNELS = ["email", "linkedin", "x", "instagram", "facebook", "seo", "content", "google_ads", "meta_ads", "events", "referral", "other"] as const;
const METRICS = ["leads", "impressions", "engagement", "clicks", "posts", "emails_sent", "spend", "traffic", "customers"] as const;
const ROLES = ["awareness", "consideration", "conversion", "retention"] as const;

export interface PlanEditorValue {
  id?: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  budget: string;
  positioning: string;
  audience: string;
  messaging: string;
  objectives: { metric: (typeof METRICS)[number]; target: number; label: string }[];
  channels: { channel: (typeof CHANNELS)[number]; role: (typeof ROLES)[number]; budget: string; cadence: string; rationale: string }[];
  researchIds: string[];
}

const toMinor = (v: string) => (/^\d{1,12}(\.\d{1,2})?$/.test(v.trim()) ? Math.round(Number(v) * 100) : 0);

/** Create or edit a marketing plan: period, budget, positioning, objectives and the channel mix with its budget split. */
export function PlanEditor({ base, locale, currency, initial, research }: { base: string; locale: string; currency: string; initial: PlanEditorValue; research: { id: string; title: string; kind: string }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<PlanEditorValue>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof PlanEditorValue>(k: K, val: PlanEditorValue[K]) => {
    setSaved(false);
    setV((p) => ({ ...p, [k]: val }));
  };
  const total = toMinor(v.budget);
  const allocated = useMemo(() => v.channels.reduce((s, c) => s + toMinor(c.budget), 0), [v.channels]);
  const money = (minor: number) => new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
  const over = total > 0 && allocated > total;
  const unusedChannels = CHANNELS.filter((c) => !v.channels.some((x) => x.channel === c));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      name: v.name.trim(),
      periodStart: v.periodStart,
      periodEnd: v.periodEnd,
      budget: v.budget.trim(),
      positioning: v.positioning,
      audience: v.audience,
      messaging: v.messaging,
      objectives: v.objectives.filter((o) => o.target > 0).map((o) => ({ ...o, label: o.label.trim() })),
      channels: v.channels.map((c) => ({ ...c, budget: c.budget.trim() })),
      researchIds: v.researchIds,
    };
    try {
      if (v.id) {
        await api(`${base}/plans/${v.id}`, { method: "PATCH", body: payload });
        setSaved(true);
        router.refresh();
      } else {
        const p = await api<{ id: string }>(`${base}/plans`, { body: payload });
        router.push(`/${locale}/marketing/strategy/${p.id}`);
        return;
      }
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={save} className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("marketing.strategy.form.name")} htmlFor="plan-name" className="sm:col-span-2">
          <Input id="plan-name" required maxLength={160} value={v.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label={t("marketing.strategy.form.start")} htmlFor="plan-start">
          <Input id="plan-start" type="date" required value={v.periodStart} onChange={(e) => set("periodStart", e.target.value)} />
        </Field>
        <Field label={t("marketing.strategy.form.end")} htmlFor="plan-end">
          <Input id="plan-end" type="date" required min={v.periodStart} value={v.periodEnd} onChange={(e) => set("periodEnd", e.target.value)} />
        </Field>
        <Field label={t("marketing.strategy.form.budget", { currency })} htmlFor="plan-budget" hint={t("marketing.strategy.form.budgetHint")}>
          <Input id="plan-budget" inputMode="decimal" pattern="^\d{1,12}(\.\d{1,2})?$" value={v.budget} onChange={(e) => set("budget", e.target.value)} />
        </Field>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Field label={t("marketing.strategy.form.positioning")} htmlFor="plan-positioning" hint={t("marketing.strategy.form.positioningHint")}>
          <Textarea id="plan-positioning" rows={4} maxLength={3000} value={v.positioning} onChange={(e) => set("positioning", e.target.value)} />
        </Field>
        <Field label={t("marketing.strategy.form.audience")} htmlFor="plan-audience" hint={t("marketing.strategy.form.audienceHint")}>
          <Textarea id="plan-audience" rows={4} maxLength={3000} value={v.audience} onChange={(e) => set("audience", e.target.value)} />
        </Field>
        <Field label={t("marketing.strategy.form.messaging")} htmlFor="plan-messaging" hint={t("marketing.strategy.form.messagingHint")}>
          <Textarea id="plan-messaging" rows={4} maxLength={3000} value={v.messaging} onChange={(e) => set("messaging", e.target.value)} />
        </Field>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[13px] font-medium">{t("marketing.strategy.form.objectives")}</legend>
        {v.objectives.map((o, i) => (
          <div key={i} className="grid grid-cols-[1fr_7rem_auto] gap-2 sm:grid-cols-[12rem_8rem_1fr_auto]">
            <Select aria-label={t("marketing.studio.goals.metricLabel")} value={o.metric} onChange={(e) => set("objectives", v.objectives.map((x, j) => (j === i ? { ...x, metric: e.target.value as (typeof METRICS)[number] } : x)))}>
              {METRICS.map((m) => (
                <option key={m} value={m}>
                  {t(`marketing.studio.goals.metric.${m}`)}
                </option>
              ))}
            </Select>
            <Input aria-label={t("marketing.studio.goals.target")} type="number" min={1} step="any" required value={o.target || ""} onChange={(e) => set("objectives", v.objectives.map((x, j) => (j === i ? { ...x, target: Number(e.target.value) } : x)))} />
            <Input aria-label={t("marketing.strategy.form.objectiveLabel")} placeholder={t("marketing.strategy.form.objectiveLabel")} maxLength={160} className="col-span-2 sm:col-span-1" value={o.label} onChange={(e) => set("objectives", v.objectives.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <Button type="button" variant="ghost" size="sm" aria-label={t("marketing.common.delete")} className="row-start-1 col-start-3 sm:col-start-4" onClick={() => set("objectives", v.objectives.filter((_, j) => j !== i))}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        {v.objectives.length < 12 ? (
          <Button type="button" variant="secondary" size="sm" className="justify-self-start" onClick={() => set("objectives", [...v.objectives, { metric: "leads", target: 0, label: "" }])}>
            <Plus aria-hidden />
            {t("marketing.strategy.form.addObjective")}
          </Button>
        ) : null}
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-[13px] font-medium">{t("marketing.strategy.form.channels")}</legend>
        <div className="grid gap-1">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={t("marketing.strategy.form.allocated", { allocated: money(allocated), total: money(total) })}>
            {v.channels.map((c, i) => {
              const share = total > 0 ? toMinor(c.budget) / Math.max(total, allocated) : 0;
              return share > 0 ? <span key={c.channel} className="h-full" style={{ width: `${share * 100}%`, background: `color-mix(in oklch, var(--primary) ${100 - ((i * 13) % 70)}%, var(--surface))` }} /> : null;
            })}
          </div>
          <p className={cn("text-xs", over ? "text-danger" : "text-muted-foreground")}>
            {t("marketing.strategy.form.allocated", { allocated: money(allocated), total: money(total) })}
            {over ? ` — ${t("marketing.strategy.form.overBudget")}` : ""}
          </p>
        </div>
        {v.channels.map((c, i) => (
          <div key={c.channel} className="grid gap-2 rounded-lg border bg-surface p-3 sm:grid-cols-[10rem_10rem_8rem_1fr_auto]">
            <Select aria-label={t("marketing.common.channel")} value={c.channel} onChange={(e) => set("channels", v.channels.map((x, j) => (j === i ? { ...x, channel: e.target.value as (typeof CHANNELS)[number] } : x)))}>
              {[c.channel, ...unusedChannels].map((ch) => (
                <option key={ch} value={ch}>
                  {t(`marketing.channels.${ch}`)}
                </option>
              ))}
            </Select>
            <Select aria-label={t("marketing.strategy.form.role")} value={c.role} onChange={(e) => set("channels", v.channels.map((x, j) => (j === i ? { ...x, role: e.target.value as (typeof ROLES)[number] } : x)))}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`marketing.strategy.role.${r}`)}
                </option>
              ))}
            </Select>
            <Input aria-label={t("marketing.strategy.form.channelBudget")} placeholder={t("marketing.strategy.form.channelBudget")} inputMode="decimal" pattern="^\d{1,12}(\.\d{1,2})?$" value={c.budget} onChange={(e) => set("channels", v.channels.map((x, j) => (j === i ? { ...x, budget: e.target.value } : x)))} />
            <Input aria-label={t("marketing.strategy.form.cadence")} placeholder={t("marketing.strategy.form.cadence")} maxLength={160} value={c.cadence} onChange={(e) => set("channels", v.channels.map((x, j) => (j === i ? { ...x, cadence: e.target.value } : x)))} />
            <Button type="button" variant="ghost" size="sm" aria-label={t("marketing.common.delete")} onClick={() => set("channels", v.channels.filter((_, j) => j !== i))}>
              <Trash2 aria-hidden />
            </Button>
            <Input aria-label={t("marketing.strategy.form.rationale")} placeholder={t("marketing.strategy.form.rationale")} maxLength={1000} className="sm:col-span-5" value={c.rationale} onChange={(e) => set("channels", v.channels.map((x, j) => (j === i ? { ...x, rationale: e.target.value } : x)))} />
          </div>
        ))}
        {unusedChannels.length ? (
          <Button type="button" variant="secondary" size="sm" className="justify-self-start" onClick={() => set("channels", [...v.channels, { channel: unusedChannels[0]!, role: "awareness", budget: "", cadence: "", rationale: "" }])}>
            <Plus aria-hidden />
            {t("marketing.strategy.form.addChannel")}
          </Button>
        ) : null}
      </fieldset>

      {research.length ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-[13px] font-medium">{t("marketing.strategy.form.research")}</legend>
          <div className="flex flex-wrap gap-2">
            {research.map((r) => {
              const on = v.researchIds.includes(r.id);
              return (
                <label key={r.id} className={cn("flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm", on ? "border-primary bg-accent" : "bg-surface")}>
                  <input type="checkbox" className="size-4" checked={on} onChange={() => set("researchIds", on ? v.researchIds.filter((x) => x !== r.id) : [...v.researchIds, r.id].slice(0, 12))} />
                  <span className="text-[11px] text-muted-foreground">{t(`marketing.intelligence.kind.${r.kind}`)}</span>
                  {r.title}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || !v.name.trim() || !v.periodStart || !v.periodEnd}>
          <Save aria-hidden />
          {v.id ? t("marketing.strategy.form.save") : t("marketing.strategy.form.create")}
        </Button>
        {saved ? <span className="text-xs text-success">{t("marketing.strategy.form.saved")}</span> : null}
      </div>
      <FormError error={error} />
    </form>
  );
}
