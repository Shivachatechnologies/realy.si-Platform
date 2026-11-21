"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Lock, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export type Level = "OFF" | "SUGGEST" | "ASK" | "AUTO";

/** A rule as the page passes it (money already in major units of `currency`). */
export interface RuleView {
  level: Level;
  inherited: boolean;
  hasRow: boolean;
  dailyLimit: number | null;
  perActionMax: string | null;
  dailyMax: string | null;
  monthlyMax: string | null;
  currency: string;
  hoursFrom: string | null;
  hoursTo: string | null;
  allowedDays: number[];
  allowedChannels: string[];
}

const LEVELS: Level[] = ["OFF", "SUGGEST", "ASK", "AUTO"];
const CHANNELS = ["email", "sms", "whatsapp", "phone", "chat", "social", "ads", "web"] as const;
const DAYS = [1, 2, 3, 4, 5, 6, 0];

/**
 * One action class of one department: a four-step slider (Off · Suggest · Ask me · Auto), the limits that apply in
 * Auto, and today's usage. Hard floors show Auto as locked; money classes ask for a per-action cap before Auto.
 */
export function PolicyRow({
  path,
  department,
  actionClass,
  rule,
  locked,
  isMoney,
  isRead,
  isCompanyRow,
  canManage,
  usage,
  paymentCap,
}: {
  path: string;
  department: string;
  actionClass: string;
  rule: RuleView;
  locked: boolean;
  isMoney: boolean;
  isRead: boolean;
  isCompanyRow: boolean;
  canManage: boolean;
  usage: string | null;
  paymentCap: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const [pendingLevel, setPendingLevel] = useState<Level>(rule.level);
  const levels = isRead ? (["OFF", "AUTO"] as Level[]) : LEVELS;
  const groupId = `lvl-${department}-${actionClass}`.replace(/\W/g, "_");

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { body: { department, actionClass, ...body } });
      router.refresh();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const keep = () => ({
    dailyLimit: rule.dailyLimit,
    perActionMax: rule.perActionMax,
    dailyMax: rule.dailyMax,
    monthlyMax: rule.monthlyMax,
    currency: rule.currency,
    hoursFrom: rule.hoursFrom,
    hoursTo: rule.hoursTo,
    allowedDays: rule.allowedDays,
    allowedChannels: rule.allowedChannels,
  });

  function choose(level: Level) {
    if (level === rule.level && !rule.inherited) return;
    if (level === "AUTO" && isMoney && !rule.perActionMax) {
      setPendingLevel("AUTO");
      setOpen(true);
      return;
    }
    void save({ level, ...keep() });
  }

  const limitSummary = [
    rule.dailyLimit ? t("autonomy.rules.perDay", { count: rule.dailyLimit }) : null,
    rule.perActionMax ? t("autonomy.rules.perAction", { amount: `${rule.perActionMax} ${rule.currency}` }) : null,
    rule.dailyMax ? t("autonomy.rules.perDayMoney", { amount: `${rule.dailyMax} ${rule.currency}` }) : null,
    rule.monthlyMax ? t("autonomy.rules.perMonthMoney", { amount: `${rule.monthlyMax} ${rule.currency}` }) : null,
    rule.hoursFrom && rule.hoursTo ? `${rule.hoursFrom}–${rule.hoursTo}` : null,
    rule.allowedDays.length ? rule.allowedDays.map((d) => t(`autonomy.days.${d}`)).join(" ") : null,
    rule.allowedChannels.length ? rule.allowedChannels.map((c) => t(`autonomy.channels.${c}`)).join(", ") : null,
  ].filter(Boolean);

  return (
    <div className="grid gap-2 border-b px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:items-center md:gap-4">
      <div className="grid min-w-0 gap-0.5">
        <span id={groupId} className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          {t(`autonomy.classes.${actionClass}`)}
          {rule.inherited && !isCompanyRow ? <Badge>{t("autonomy.rules.inherited")}</Badge> : null}
          {rule.inherited && isCompanyRow ? <Badge>{t("autonomy.rules.default")}</Badge> : null}
        </span>
        <span className="text-xs text-muted-foreground">{t(`autonomy.classesHelp.${actionClass}`)}</span>
      </div>
      <div className="grid min-w-0 gap-2">
        <div role="radiogroup" aria-labelledby={groupId} className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-md border bg-surface-2/60 p-0.5 text-xs">
          {levels.map((level) => {
            const isLocked = level === "AUTO" && locked;
            const active = rule.level === level;
            return (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!canManage || busy || isLocked}
                title={isLocked ? t("autonomy.rules.lockedHelp") : t(`autonomy.levelsHelp.${level}`)}
                onClick={() => choose(level)}
                className={cn(
                  "inline-flex min-h-9 items-center justify-center gap-1 rounded-[5px] px-2 py-1.5 font-medium transition-colors motion-reduce:transition-none",
                  active
                    ? level === "AUTO"
                      ? "bg-success text-primary-foreground shadow-elev-1"
                      : level === "OFF"
                        ? "bg-foreground/80 text-background shadow-elev-1"
                        : "bg-surface text-foreground shadow-elev-1"
                    : "text-muted-foreground hover:text-foreground",
                  (isLocked || !canManage) && !active && "cursor-not-allowed opacity-60",
                )}
              >
                {isLocked ? <Lock className="size-3" aria-hidden /> : null}
                {isRead ? t(level === "AUTO" ? "autonomy.levels.ON" : "autonomy.levels.OFF") : t(`autonomy.levels.${level}`)}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {locked ? (
            <span className="inline-flex items-center gap-1">
              <Lock className="size-3" aria-hidden />
              {t("autonomy.rules.locked")}
            </span>
          ) : null}
          {rule.level === "AUTO" && !isRead ? <span>{limitSummary.length ? limitSummary.join(" · ") : t("autonomy.rules.noLimits")}</span> : null}
          {usage ? <span className="tabular">{usage}</span> : null}
          {canManage && !isRead && !locked ? (
            <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => (setPendingLevel(rule.level === "AUTO" ? "AUTO" : rule.level), setOpen(true))}>
              <SlidersHorizontal className="size-3" aria-hidden />
              {t("autonomy.rules.limits")}
            </button>
          ) : null}
          {canManage && rule.hasRow ? (
            <button type="button" disabled={busy} className="text-primary hover:underline" onClick={() => void save({ level: null })}>
              {isCompanyRow ? t("autonomy.rules.reset") : t("autonomy.rules.useCompany")}
            </button>
          ) : null}
        </div>
        {error && !open ? <FormError error={error} /> : null}
      </div>
      {open ? (
        <LimitsDialog
          open={open}
          onOpenChange={setOpen}
          title={`${t(`autonomy.classes.${actionClass}`)} · ${t(`autonomy.levels.${pendingLevel}`)}`}
          rule={rule}
          isMoney={isMoney}
          paymentCap={paymentCap}
          error={error}
          onSave={(limits) => save({ level: pendingLevel, ...limits })}
        />
      ) : null}
    </div>
  );
}

function LimitsDialog({
  open,
  onOpenChange,
  title,
  rule,
  isMoney,
  paymentCap,
  error,
  onSave,
}: {
  error: unknown;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  rule: RuleView;
  isMoney: boolean;
  paymentCap: string | null;
  onSave: (limits: Record<string, unknown>) => Promise<boolean>;
}) {
  const t = useT();
  const [daily, setDaily] = useState(rule.dailyLimit?.toString() ?? "");
  const [perAction, setPerAction] = useState(rule.perActionMax ?? "");
  const [dailyMax, setDailyMax] = useState(rule.dailyMax ?? "");
  const [monthlyMax, setMonthlyMax] = useState(rule.monthlyMax ?? "");
  const [from, setFrom] = useState(rule.hoursFrom ?? "");
  const [to, setTo] = useState(rule.hoursTo ?? "");
  const [days, setDays] = useState<number[]>(rule.allowedDays);
  const [channels, setChannels] = useState<string[]>(rule.allowedChannels);
  const [busy, setBusy] = useState(false);
  const id = "limits";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await onSave({
      dailyLimit: daily ? Math.round(Number(daily)) : null,
      perActionMax: perAction || null,
      dailyMax: dailyMax || null,
      monthlyMax: monthlyMax || null,
      currency: rule.currency,
      hoursFrom: from || null,
      hoursTo: to || null,
      allowedDays: days,
      allowedChannels: channels,
    });
    setBusy(false);
    if (ok) onOpenChange(false);
  }

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={t("autonomy.limits.description")} closeLabel={t("common.close")}>
        <form onSubmit={submit} className="grid gap-4">
          <Field label={t("autonomy.limits.dailyLimit")} htmlFor={`${id}-daily`} hint={t("autonomy.limits.dailyLimitHelp")}>
            <Input id={`${id}-daily`} type="number" min={1} max={10000} inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value)} />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-medium">{t("autonomy.limits.money", { currency: rule.currency })}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label={t("autonomy.limits.perActionMax")} htmlFor={`${id}-pa`}>
                <Input id={`${id}-pa`} inputMode="decimal" pattern="\d{1,12}(\.\d{1,3})?" required={isMoney} value={perAction} onChange={(e) => setPerAction(e.target.value)} />
              </Field>
              <Field label={t("autonomy.limits.dailyMax")} htmlFor={`${id}-dm`}>
                <Input id={`${id}-dm`} inputMode="decimal" pattern="\d{1,12}(\.\d{1,3})?" value={dailyMax} onChange={(e) => setDailyMax(e.target.value)} />
              </Field>
              <Field label={t("autonomy.limits.monthlyMax")} htmlFor={`${id}-mm`}>
                <Input id={`${id}-mm`} inputMode="decimal" pattern="\d{1,12}(\.\d{1,3})?" value={monthlyMax} onChange={(e) => setMonthlyMax(e.target.value)} />
              </Field>
            </div>
            {isMoney ? <p className="text-xs text-muted-foreground">{t("autonomy.limits.capRequired")}</p> : null}
            {paymentCap ? <p className="text-xs text-muted-foreground">{t("autonomy.limits.paymentCap", { amount: paymentCap })}</p> : null}
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-medium">{t("autonomy.limits.hours")}</legend>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("autonomy.limits.from")} htmlFor={`${id}-from`}>
                <Input id={`${id}-from`} type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label={t("autonomy.limits.to")} htmlFor={`${id}-to`}>
                <Input id={`${id}-to`} type="time" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("autonomy.limits.days")}>
              {DAYS.map((d) => (
                <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => setDays(toggle(days, d))} className={cn("min-h-8 rounded-full border px-3 text-xs", days.includes(d) ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground")}>
                  {t(`autonomy.days.${d}`)}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("autonomy.limits.hoursHelp")}</p>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-medium">{t("autonomy.limits.channels")}</legend>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("autonomy.limits.channels")}>
              {CHANNELS.map((c) => (
                <button key={c} type="button" aria-pressed={channels.includes(c)} onClick={() => setChannels(toggle(channels, c))} className={cn("min-h-8 rounded-full border px-3 text-xs", channels.includes(c) ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground")}>
                  {t(`autonomy.channels.${c}`)}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("autonomy.limits.channelsHelp")}</p>
          </fieldset>
          {error ? <FormError error={error} /> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("autonomy.limits.cancel")}
            </Button>
            <Button type="submit" loading={busy}>
              {t("autonomy.limits.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
