"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, FileUp, Lightbulb, Plus, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { displayName, formatDate, formatMoney } from "@/i18n/format";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";
import { api, ApiError, setCookie } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { AiCore, Aurora, Reveal, TypingText } from "@/components/motion";
import { BriefForm, type BriefMode, type BriefValue } from "./brief-form";

export const WIZARD_STEPS = ["profile", "workspace", "plan", "business", "questions"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export interface PlanOption {
  key: string;
  name: string;
  description: string | null;
  price: { amountMinor: string; currency: string; interval: string; trialDays: number } | null;
}

interface Props {
  initialStep: WizardStep;
  user: { name: string; locale: string; timezone: string; countryCode: string | null };
  org: { id: string; name: string } | null;
  companies: { id: string; name: string; hasRun: boolean }[];
  currentCompany: { id: string; name: string } | null;
  countries: { code: string; defaultCurrency: string; defaultTimezone: string }[];
  currencies: string[];
  plans: PlanOption[];
  subscription: { planName: string; status: string; trialEndsAt: string | null; currentPeriodEnd: string | null } | null;
  canSeeBilling: boolean;
}

/** Signup onboarding: profile → workspace → plan → which business → essential questions → the AI Company Builder starts. */
export function OnboardingWizard(p: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>(p.initialStep);
  const [mode, setMode] = useState<BriefMode | null>(null);
  const [another, setAnother] = useState(false);
  const index = WIZARD_STEPS.indexOf(step);
  const go = (s: WizardStep) => {
    const finished = WIZARD_STEPS.slice(0, WIZARD_STEPS.indexOf(s));
    setStep(s);
    router.replace(`/${locale}/onboarding?step=${s}`, { scroll: false });
    // Saved server-side so a returning founder resumes here (best effort: the wizard keeps working offline of it).
    void api("/api/v1/me/onboarding", { method: "PATCH", body: { wizardStep: s, stage: s === "business" || s === "questions" ? 2 : 1, done: finished } }).catch(() => undefined);
  };
  const welcome = step === "profile" || step === "workspace" || step === "plan";

  return (
    <div className="grid gap-4">
      {welcome ? (
        <Card variant="glass" className="relative overflow-hidden">
          <Aurora className="pointer-events-none absolute inset-0 opacity-70" />
          <CardBody className="relative grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <Reveal className="grid gap-1.5">
              <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
                <TypingText text={t("builder.journey.stages.welcome.title")} />
              </h2>
              <p className="text-sm text-muted-foreground">{t("builder.journey.stages.welcome.what")}</p>
            </Reveal>
            <AiCore className="mx-auto size-24 sm:size-32" />
          </CardBody>
        </Card>
      ) : null}
      <ol className="flex flex-wrap gap-2 text-xs" aria-label={t("builder.onboarding.progress")}>
        {WIZARD_STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              disabled={i > index}
              onClick={() => i < index && go(s)}
              aria-current={s === step ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
                s === step ? "border-primary bg-accent text-accent-foreground" : i < index ? "hover:bg-muted" : "text-muted-foreground",
              )}
            >
              {i < index ? <Check className="size-3" aria-hidden /> : <span className="tabular-nums">{i + 1}</span>}
              {t(`builder.onboarding.steps.${s}`)}
            </button>
          </li>
        ))}
      </ol>
      {step === "profile" ? <ProfileStep {...p} onDone={async (newLocale) => {
            if (newLocale && newLocale !== locale) {
              await api("/api/v1/me/onboarding", { method: "PATCH", body: { wizardStep: "workspace", stage: 1, done: ["profile"] } }).catch(() => undefined);
              router.push(`/${newLocale}/onboarding?step=workspace`);
            } else go("workspace");
          }} /> : null}
      {step === "workspace" ? <WorkspaceStep org={p.org} onDone={() => (router.refresh(), go("plan"))} /> : null}
      {step === "plan" ? <PlanStep {...p} onDone={() => go("business")} /> : null}
      {step === "business" ? (
        <BusinessStep
          companies={p.companies}
          currentCompany={p.currentCompany}
          another={another}
          setAnother={setAnother}
          onChoose={(m) => {
            setMode(m);
            go("questions");
          }}
        />
      ) : null}
      {step === "questions" ? (
        mode && p.org ? (
          <QuestionsStep {...p} org={p.org} mode={mode} />
        ) : (
          <Notice tone="info" action={<Button size="sm" variant="secondary" onClick={() => go(p.org ? "business" : "workspace")}>{t("common.previous")}</Button>}>
            {t("builder.onboarding.chooseFirst")}
          </Notice>
        )
      ) : null}
    </div>
  );
}

function ProfileStep({ user, countries, onDone }: Props & { onDone: (locale?: string) => void | Promise<void> }) {
  const { t, locale } = useI18n();
  const timezones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  const sorted = useMemo(() => countries.map((c) => ({ code: c.code, name: displayName(c.code, "region", locale) })).sort((a, b) => a.name.localeCompare(b.name, locale)), [countries, locale]);
  const [name, setName] = useState(user.name);
  const [lang, setLang] = useState(user.locale);
  const [timezone, setTimezone] = useState(user.timezone === "UTC" ? Intl.DateTimeFormat().resolvedOptions().timeZone : user.timezone);
  const [country, setCountry] = useState(user.countryCode ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/me", { method: "PATCH", body: { name, locale: lang, timezone, countryCode: country || null } });
      await onDone(lang);
    } catch (err) {
      setError(err);
      if (err instanceof ApiError) setFields(err.fieldErrors());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title={t("builder.onboarding.profile.title")} description={t("builder.onboarding.profile.description")} />
      <CardBody>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field label={t("builder.onboarding.profile.name")} htmlFor="p-name" error={fields.name}>
            <Input id="p-name" required value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("common.language")} htmlFor="p-lang">
              <Select id="p-lang" value={lang} onChange={(e) => setLang(e.target.value)}>
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_NAMES[l]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("builder.onboarding.profile.timezone")} htmlFor="p-tz" error={fields.timezone}>
              <Select id="p-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("builder.onboarding.profile.country")} htmlFor="p-country">
              <Select id="p-country" value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="">{t("auth.selectCountry")}</option>
                {sorted.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <FormError error={error} />
          <div>
            <Button type="submit" loading={busy} disabled={!name.trim()}>
              {t("common.continue")}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function WorkspaceStep({ org, onDone }: { org: Props["org"]; onDone: () => void }) {
  const { t, locale } = useI18n();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ id: string }>("/api/v1/organizations", { body: { name, defaultLocale: locale } });
      setCookie("realy_org", created.id);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title={t("builder.onboarding.workspace.title")} description={t("onboarding.orgNameHint")} />
      <CardBody>
        {org ? (
          <div className="grid gap-3">
            <p className="text-sm">{t("builder.onboarding.workspace.existing", { name: org.name })}</p>
            <div>
              <Button onClick={onDone}>{t("common.continue")}</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <Field label={t("onboarding.orgName")} htmlFor="w-name">
              <Input id="w-name" required value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </Field>
            <FormError error={error} />
            <div>
              <Button type="submit" loading={busy} disabled={!name.trim()}>
                {t("builder.onboarding.workspace.create")}
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function PlanStep({ plans, subscription, canSeeBilling, user, onDone }: Props & { onDone: () => void }) {
  const { t, locale } = useI18n();
  return (
    <Card>
      <CardHeader title={t("builder.onboarding.plan.title")} description={t("builder.onboarding.plan.description")} />
      <CardBody className="grid gap-4">
        {subscription ? (
          <Notice tone="success" title={t("builder.onboarding.plan.current", { plan: subscription.planName })}>
            {t(`settings.billing.statuses.${subscription.status}`)}
            {subscription.trialEndsAt ? ` · ${t("builder.onboarding.plan.trialEnds", { date: formatDate(subscription.trialEndsAt, locale, user.timezone) })}` : ""}
            {!subscription.trialEndsAt && subscription.currentPeriodEnd ? ` · ${t("builder.onboarding.plan.renews", { date: formatDate(subscription.currentPeriodEnd, locale, user.timezone) })}` : ""}
          </Notice>
        ) : canSeeBilling ? (
          <Notice tone="info">{t("builder.onboarding.plan.none")}</Notice>
        ) : null}
        {plans.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => (
              <li key={plan.key} className="grid gap-1 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{plan.name}</span>
                  {subscription?.planName === plan.name ? <Badge tone="success">{t("builder.onboarding.plan.yours")}</Badge> : null}
                </div>
                {plan.description ? <p className="text-xs text-muted-foreground">{plan.description}</p> : null}
                <p className="text-sm tabular-nums">
                  {plan.price
                    ? `${formatMoney({ amountMinor: plan.price.amountMinor, currency: plan.price.currency }, locale)} / ${t(`builder.onboarding.plan.interval.${plan.price.interval}`)}`
                    : t("builder.onboarding.plan.unavailable")}
                </p>
                {plan.price?.trialDays ? <p className="text-xs text-muted-foreground">{t("builder.onboarding.plan.trialDays", { count: plan.price.trialDays })}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("builder.onboarding.plan.noPlans")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={onDone}>{t("common.continue")}</Button>
          {canSeeBilling ? (
            <Button asChild variant="secondary">
              <Link href={`/${locale}/settings/billing`}>{t("builder.onboarding.plan.billing")}</Link>
            </Button>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

const OPTIONS = [
  { mode: "NEW_IDEA", key: "new", icon: Lightbulb },
  { mode: "EXISTING", key: "existing", icon: Store },
  { mode: "IMPORT", key: "import", icon: FileUp },
] as const;

function BusinessStep({
  companies,
  currentCompany,
  another,
  setAnother,
  onChoose,
}: {
  companies: Props["companies"];
  currentCompany: Props["currentCompany"];
  another: boolean;
  setAnother: (v: boolean) => void;
  onChoose: (m: BriefMode) => void;
}) {
  const { t, locale } = useI18n();
  const hasCompanies = companies.length > 0;
  const current = currentCompany ? companies.find((c) => c.id === currentCompany.id) : null;
  const showTypes = !hasCompanies || another;
  return (
    <Card>
      <CardHeader title={t("builder.onboarding.business.title")} description={hasCompanies ? t("builder.onboarding.business.descriptionMore") : t("builder.onboarding.business.description")} />
      <CardBody className="grid gap-3">
        {showTypes ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {OPTIONS.map((o) => (
              <button key={o.key} type="button" onClick={() => onChoose(o.mode)} className="grid gap-1.5 rounded-md border p-3 text-start transition-colors hover:border-primary hover:bg-accent/40">
                <o.icon className="size-5 text-primary" aria-hidden />
                <span className="font-medium">{t(`builder.onboarding.business.${o.key}.title`)}</span>
                <span className="text-xs text-muted-foreground">{t(`builder.onboarding.business.${o.key}.description`)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => setAnother(true)} className="grid gap-1.5 rounded-md border p-3 text-start transition-colors hover:border-primary hover:bg-accent/40">
              <Plus className="size-5 text-primary" aria-hidden />
              <span className="font-medium">{t("builder.onboarding.business.another.title")}</span>
              <span className="text-xs text-muted-foreground">{t("builder.onboarding.business.another.description")}</span>
            </button>
            {current ? (
              <Link href={current.hasRun ? `/${locale}/builder` : `/${locale}/builder/new`} className="grid gap-1.5 rounded-md border p-3 text-start transition-colors hover:border-primary hover:bg-accent/40">
                <Building2 className="size-5 text-primary" aria-hidden />
                <span className="font-medium">{t("builder.onboarding.business.current.title", { name: current.name })}</span>
                <span className="text-xs text-muted-foreground">{current.hasRun ? t("builder.onboarding.business.current.hasRun") : t("builder.onboarding.business.current.description")}</span>
              </Link>
            ) : null}
          </div>
        )}
        {another && hasCompanies ? (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setAnother(false)}>
              {t("common.previous")}
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function QuestionsStep({ org, mode, countries, currencies, user }: Props & { org: { id: string; name: string }; mode: BriefMode }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const home = countries.find((c) => c.code === user.countryCode);
  return (
    <Card>
      <CardHeader title={t(`builder.onboarding.questions.${mode}`)} description={t("builder.onboarding.questions.description")} />
      <CardBody>
        <BriefForm
          mode={mode}
          countries={countries.map((c) => c.code)}
          currencies={currencies}
          defaultCurrency={home?.defaultCurrency ?? "USD"}
          defaultCountry={user.countryCode}
          submitLabel={t("builder.onboarding.questions.submit")}
          onSubmit={async (brief: BriefValue) => {
            const country = countries.find((c) => c.code === brief.countryCode);
            const r = await api<{ companyId: string; runId: string }>(`/api/v1/organizations/${org.id}/onboarding/business`, {
              body: {
                mode,
                brief,
                company: {
                  name: brief.name,
                  incorporationCountryCode: brief.countryCode,
                  operatingCountryCodes: brief.countryCode ? [brief.countryCode] : [],
                  targetMarketCodes: brief.targetMarketCodes,
                  baseCurrency: country?.defaultCurrency ?? brief.budgetCurrency,
                  timezone: country?.defaultTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
                  defaultLocale: locale,
                },
              },
            });
            setCookie("realy_company", r.companyId);
            await api("/api/v1/me/onboarding", { method: "PATCH", body: { runId: r.runId, stage: 3, wizardStep: "questions", done: ["profile", "workspace", "plan", "business", "questions"] } }).catch(() => undefined);
            router.push(`/${locale}/onboarding?stage=3`);
            router.refresh();
          }}
        />
      </CardBody>
    </Card>
  );
}
