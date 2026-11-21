"use client";

import { useState } from "react";
import { Pause, Play, Rocket, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./ui";

/** Mirrors server/modules/marketing/run.ts → RUN_AUTONOMY (kept local: client code never imports server modules). */
const AUTONOMY = ["REVIEW_EVERYTHING", "APPROVE_PLAN", "FULL_AUTOPILOT"] as const;
type Autonomy = (typeof AUTONOMY)[number];
const PERIODS = [30, 60, 90] as const;

/** "Run my marketing": products + ideal customers + budget + how much the AI may do alone → one autonomous run. */
export function RunLauncher({ base, products, currency, defaultAudience }: { base: string; products: { id: string; name: string }[]; currency: string; defaultAudience: string }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [productIds, setProductIds] = useState<string[]>(products.slice(0, 1).map((p) => p.id));
  const [audience, setAudience] = useState(defaultAudience);
  const [regions, setRegions] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [budget, setBudget] = useState("");
  const [periodDays, setPeriodDays] = useState<(typeof PERIODS)[number]>(30);
  const [autonomy, setAutonomy] = useState<Autonomy>("APPROVE_PLAN");
  const [note, setNote] = useState("");
  const toggle = (id: string) => setProductIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(0, 10)));
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() =>
          api(`${base}/runs`, {
            body: {
              productIds,
              audience: audience.trim() || undefined,
              regions: regions.trim() || undefined,
              competitors: competitors.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 8),
              budget: budget.trim(),
              periodDays,
              autonomy,
              note: note.trim() || undefined,
            },
          }),
        );
      }}
    >
      {products.length ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t("marketing.run.form.products")}</legend>
          <div className="flex flex-wrap gap-2">
            {products.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input type="checkbox" className="accent-[var(--primary)]" checked={productIds.includes(p.id)} onChange={() => toggle(p.id)} />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="text-sm text-muted-foreground">{t("marketing.run.form.noProducts")}</p>
      )}
      <label className="grid gap-1 text-sm">
        <span className="font-medium">{t("marketing.run.form.audience")}</span>
        <Textarea rows={3} maxLength={2000} value={audience} onChange={(e) => setAudience(e.target.value)} placeholder={t("marketing.run.form.audiencePlaceholder")} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">{t("marketing.run.form.regions")}</span>
          <Input maxLength={300} value={regions} onChange={(e) => setRegions(e.target.value)} placeholder={t("marketing.run.form.regionsPlaceholder")} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">{t("marketing.run.form.competitors")}</span>
          <Input maxLength={900} value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder={t("marketing.run.form.competitorsPlaceholder")} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">{t("marketing.run.form.budget", { currency })}</span>
          <Input inputMode="decimal" pattern="^\d{1,12}(\.\d{1,2})?$" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">{t("marketing.run.form.period")}</span>
          <Select value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value) as (typeof PERIODS)[number])}>
            {PERIODS.map((d) => (
              <option key={d} value={d}>
                {t("marketing.run.form.days", { count: d })}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t("marketing.run.form.autonomy")}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {AUTONOMY.map((a) => (
            <label key={a} className="grid cursor-pointer gap-1 rounded-lg border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <span className="flex items-center gap-2 font-medium">
                <input type="radio" name="autonomy" className="accent-[var(--primary)]" checked={autonomy === a} onChange={() => setAutonomy(a)} />
                {t(`marketing.run.autonomy.${a}.name`)}
              </span>
              <span className="text-xs text-muted-foreground">{t(`marketing.run.autonomy.${a}.hint`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">{t("marketing.run.form.note")}</span>
        <Input maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("marketing.run.form.notePlaceholder")} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          <Rocket aria-hidden />
          {busy ? t("marketing.run.form.starting") : t("marketing.run.form.start")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("marketing.run.form.startHint")}</span>
      </div>
      <FormError error={error} />
    </form>
  );
}

/** Pause / resume / retry / cancel and autonomy changes for a run. */
export function RunControls({ path, status, autonomy }: { path: string; status: string; autonomy: Autonomy }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const act = (body: Record<string, unknown>, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    void run(() => api(`${path}/actions`, { body }));
  };
  const live = ["RESEARCHING", "PLANNING", "AWAITING_APPROVAL", "LAUNCHING", "RUNNING"].includes(status);
  const open = live || status === "BLOCKED" || status === "PAUSED";
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {live || status === "BLOCKED" ? (
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => act({ action: "pause" })}>
            <Pause aria-hidden />
            {t("marketing.run.controls.pause")}
          </Button>
        ) : null}
        {status === "PAUSED" ? (
          <Button type="button" size="sm" disabled={busy} onClick={() => act({ action: "resume" })}>
            <Play aria-hidden />
            {t("marketing.run.controls.resume")}
          </Button>
        ) : null}
        {status === "BLOCKED" || status === "FAILED" ? (
          <Button type="button" size="sm" disabled={busy} onClick={() => act({ action: "retry" })}>
            <RotateCcw aria-hidden />
            {t("marketing.run.controls.retry")}
          </Button>
        ) : null}
        {open ? (
          <>
            <label className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">{t("marketing.run.form.autonomy")}</span>
              <Select aria-label={t("marketing.run.form.autonomy")} className="h-8 w-auto text-xs" value={autonomy} disabled={busy} onChange={(e) => act({ action: "set_autonomy", autonomy: e.target.value })}>
                {AUTONOMY.map((a) => (
                  <option key={a} value={a}>
                    {t(`marketing.run.autonomy.${a}.name`)}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => act({ action: "cancel" }, t("marketing.run.controls.cancelConfirm"))}>
              <Square aria-hidden />
              {t("marketing.run.controls.cancel")}
            </Button>
          </>
        ) : null}
      </div>
      <FormError error={error} />
    </div>
  );
}
