"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Mail, MessageCircle, MonitorSmartphone, Save } from "lucide-react";
import { FormError } from "@/components/form-error";
import { Stepper } from "@/components/guide-kit/stepper";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useI18n } from "@/i18n/client";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { TestBriefingButton } from "./test-briefing";
import { WhatsAppVerify } from "./whatsapp-verify";

export interface SettingsValue {
  enabled: boolean;
  timezone: string;
  locale: string;
  morningTime: string;
  days: number[];
  eveningEnabled: boolean;
  eveningTime: string;
  weeklyEnabled: boolean;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  aiSummary: boolean;
  whatsappNumber: string;
}

const STEPS = ["when", "where", "whatsapp", "try"] as const;
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/**
 * Briefing settings in plain language. First visit: a guided journey (when → where → WhatsApp → try it), saved on
 * every step so it can be resumed. Later: the same questions on one page. Advanced options sit behind "Advanced".
 */
export function BriefingSettingsForm({
  apiBase,
  initial,
  guided,
  startStep,
  whatsapp,
  aiReady,
  emailNote,
}: {
  apiBase: string;
  initial: SettingsValue;
  guided: boolean;
  startStep: number;
  whatsapp: { connected: boolean; provider: string | null; businessNumber: string | null; verified: boolean; number: string | null };
  aiReady: boolean;
  emailNote: string | null;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<SettingsValue>(initial);
  const [step, setStep] = useState(guided ? Math.min(startStep, STEPS.length - 1) : -1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
    } catch {
      return [initial.timezone];
    }
  }, [initial.timezone]);
  const set = <K extends keyof SettingsValue>(k: K, val: SettingsValue[K]) => {
    setSaved(false);
    setV((p) => ({ ...p, [k]: val }));
  };
  const weekday = (d: number) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + d)));

  const save = async (extra: { completeSetup?: boolean } = {}) => {
    setBusy(true);
    setError(null);
    try {
      await api(`${apiBase}/briefing/settings`, { method: "PUT", body: { ...v, whatsappEnabled: v.whatsappEnabled && whatsapp.verified && v.whatsappNumber === (whatsapp.number ?? ""), ...extra } });
      setSaved(true);
      router.refresh();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const next = async () => {
    if (await save(step === STEPS.length - 1 ? { completeSetup: true } : {})) {
      if (step === STEPS.length - 1) router.push(`/${locale}/briefing`);
      else setStep(step + 1);
    }
  };

  const when = (
    <section className="grid gap-4" aria-labelledby="b-when">
      <div>
        <h2 id="b-when" className="font-display text-display-lg">{t("briefing.settings.when.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("briefing.settings.when.hint")}</p>
      </div>
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        {t("briefing.settings.enabled")}
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("briefing.settings.when.time")} htmlFor="b-time" hint={t("briefing.settings.when.timeHint")}>
          <Input id="b-time" type="time" value={v.morningTime} onChange={(e) => set("morningTime", e.target.value)} required />
        </Field>
        <Field label={t("briefing.settings.when.timezone")} htmlFor="b-tz" hint={t("briefing.settings.when.timezoneHint")}>
          <Select id="b-tz" value={v.timezone} onChange={(e) => set("timezone", e.target.value)}>
            {(zones.includes(v.timezone) ? zones : [v.timezone, ...zones]).map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[13px] font-medium">{t("briefing.settings.when.days")}</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEK.map((d) => {
            const on = v.days.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => set("days", on ? v.days.filter((x) => x !== d) : [...v.days, d])}
                className={cn("min-w-12 rounded-full border px-3 py-1.5 text-sm transition-colors", on ? "border-transparent bg-[var(--world-accent,var(--primary))] text-primary-foreground" : "hover:bg-muted")}
              >
                {weekday(d)}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{t("briefing.settings.when.daysHint")}</p>
      </fieldset>
    </section>
  );

  const channelCard = (icon: ReactNode, title: string, hint: string, control: ReactNode) => (
    <div className="flex items-start gap-3 rounded-xl border bg-surface p-3">
      <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-world/10 text-world [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
  const where = (
    <section className="grid gap-4" aria-labelledby="b-where">
      <div>
        <h2 id="b-where" className="font-display text-display-lg">{t("briefing.settings.where.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("briefing.settings.where.hint")}</p>
      </div>
      {channelCard(<MonitorSmartphone />, t("briefing.channels.IN_APP"), t("briefing.settings.where.inApp"), <CheckCircle2 className="size-5 text-success" aria-label={t("briefing.settings.always")} />)}
      {channelCard(
        <Mail />,
        t("briefing.channels.EMAIL"),
        emailNote ?? t("briefing.settings.where.email"),
        <input type="checkbox" aria-label={t("briefing.channels.EMAIL")} checked={v.emailEnabled} onChange={(e) => set("emailEnabled", e.target.checked)} />,
      )}
      {channelCard(
        <MessageCircle />,
        t("briefing.channels.WHATSAPP"),
        whatsapp.verified ? t("briefing.settings.where.whatsappReady", { number: whatsapp.number ?? "" }) : t("briefing.settings.where.whatsappSetup"),
        <input type="checkbox" aria-label={t("briefing.channels.WHATSAPP")} checked={v.whatsappEnabled && whatsapp.verified} disabled={!whatsapp.verified} onChange={(e) => set("whatsappEnabled", e.target.checked)} />,
      )}
    </section>
  );

  const wa = (
    <section className="grid gap-4" aria-labelledby="b-wa">
      <div>
        <h2 id="b-wa" className="font-display text-display-lg">{t("briefing.settings.whatsapp.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("briefing.settings.whatsapp.hint")}</p>
      </div>
      {!whatsapp.connected ? (
        <Notice tone="warning" title={t("briefing.settings.whatsapp.notConnected")} action={<Link className="text-sm text-primary hover:underline" href={`/${locale}/integrations/twilio`}>{t("briefing.settings.whatsapp.connect")}</Link>}>
          {t("briefing.settings.whatsapp.notConnectedHint")}
        </Notice>
      ) : null}
      <Field label={t("briefing.settings.whatsapp.number")} htmlFor="b-wa-number" hint={t("briefing.settings.whatsapp.numberHint")}>
        <Input id="b-wa-number" type="tel" inputMode="tel" dir="ltr" placeholder="+15551234567" value={v.whatsappNumber} onChange={(e) => set("whatsappNumber", e.target.value)} />
      </Field>
      {v.whatsappNumber && v.whatsappNumber === (whatsapp.number ?? "") ? (
        whatsapp.verified ? (
          <Notice tone="success">{t("briefing.settings.whatsapp.verified", { number: whatsapp.number ?? "" })}</Notice>
        ) : whatsapp.connected ? (
          <WhatsAppVerify apiBase={apiBase} />
        ) : null
      ) : v.whatsappNumber ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" onClick={() => save()} loading={busy}>
            <Save aria-hidden />
            {t("briefing.settings.whatsapp.saveNumber")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("briefing.settings.whatsapp.saveFirst")}</p>
        </div>
      ) : null}
      {guided ? <p className="text-xs text-muted-foreground">{t("briefing.settings.whatsapp.optional")}</p> : null}
    </section>
  );

  const advanced = (
    <details className="group rounded-xl border bg-surface/60 p-4" open={!guided && (v.eveningEnabled || !v.weeklyEnabled || !v.aiSummary)}>
      <summary className="cursor-pointer text-sm font-medium">{t("briefing.settings.advanced.title")}</summary>
      <div className="mt-4 grid gap-4">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={v.weeklyEnabled} onChange={(e) => set("weeklyEnabled", e.target.checked)} />
          <span>
            {t("briefing.settings.advanced.weekly")}
            <span className="block text-xs text-muted-foreground">{t("briefing.settings.advanced.weeklyHint")}</span>
          </span>
        </label>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={v.eveningEnabled} onChange={(e) => set("eveningEnabled", e.target.checked)} />
            <span>
              {t("briefing.settings.advanced.evening")}
              <span className="block text-xs text-muted-foreground">{t("briefing.settings.advanced.eveningHint")}</span>
            </span>
          </label>
          <Input aria-label={t("briefing.settings.advanced.eveningTime")} type="time" value={v.eveningTime} disabled={!v.eveningEnabled} onChange={(e) => set("eveningTime", e.target.value)} className="sm:w-32" />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={v.aiSummary} onChange={(e) => set("aiSummary", e.target.checked)} />
          <span>
            {t("briefing.settings.advanced.ai")}
            <span className="block text-xs text-muted-foreground">{aiReady ? t("briefing.settings.advanced.aiHint") : t("briefing.settings.advanced.aiOff")}</span>
          </span>
        </label>
        <Field label={t("briefing.settings.advanced.language")} htmlFor="b-lang" className="sm:max-w-xs">
          <Select id="b-lang" value={v.locale} onChange={(e) => set("locale", e.target.value)}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_NAMES[l]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </details>
  );

  const tryIt = (
    <section className="grid gap-4" aria-labelledby="b-try">
      <div>
        <h2 id="b-try" className="font-display text-display-lg">{t("briefing.settings.try.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("briefing.settings.try.hint")}</p>
      </div>
      <TestBriefingButton apiBase={apiBase} channels={["IN_APP", ...(v.emailEnabled ? (["EMAIL"] as const) : []), ...(v.whatsappEnabled && whatsapp.verified ? (["WHATSAPP"] as const) : [])]} whatsappReady={whatsapp.verified} variant="secondary" />
    </section>
  );

  if (guided && step >= 0) {
    const body = [when, where, wa, tryIt][step];
    return (
      <div className="grid gap-6">
        <Stepper label={t("briefing.settings.journey")} current={step} steps={STEPS.map((s) => ({ key: s, label: t(`briefing.settings.steps.${s}`) }))} />
        <div className="rounded-2xl border bg-surface p-4 shadow-elev-1 sm:p-6">{body}</div>
        {step === 0 ? advanced : null}
        <FormError error={error} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0 || busy}>
            <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
            {t("briefing.settings.back")}
          </Button>
          <div className="flex flex-wrap gap-2">
            {step === 2 ? (
              <Button variant="secondary" onClick={() => setStep(3)} disabled={busy}>
                {t("briefing.settings.skip")}
              </Button>
            ) : null}
            <Button onClick={next} loading={busy}>
              {step === STEPS.length - 1 ? t("briefing.settings.finish") : t("briefing.settings.continue")}
              {step === STEPS.length - 1 ? null : <ArrowRight aria-hidden className="rtl:-scale-x-100" />}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      {when}
      {where}
      {wa}
      {advanced}
      <FormError error={error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => save()} loading={busy}>
          <Save aria-hidden />
          {t("briefing.settings.save")}
        </Button>
        {saved ? <span className="text-sm text-success">{t("briefing.settings.saved")}</span> : null}
      </div>
      {tryIt}
    </div>
  );
}
