"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { displayName } from "@/i18n/format";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";
import { api, ApiError, setCookie } from "@/lib/api-client";
import { Aurora, Reveal, TypingText } from "@/components/motion";
import { AiCoreStage } from "@/components/graphics/ai-core-stage";
import { ParticleField } from "@/components/graphics/particle-field";

interface Props {
  user: { name: string; locale: string; timezone: string; countryCode: string | null };
  org: { id: string; name: string } | null;
  countries: string[];
  /** Where "Begin" goes when the founder already has a run (resume). */
  resumeStage: string | null;
}

/**
 * Stage 1 — Welcome: an immersive AI environment (3D core, particles, aurora; SVG fallback under reduced motion or
 * without WebGL) and the only setup a founder needs before describing the business: their name and language and, if
 * they have none yet, the workspace that will own the company. Everything is saved server-side.
 */
export function WelcomeStage({ user, org, countries, resumeStage }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const sorted = useMemo(() => countries.map((code) => ({ code, name: displayName(code, "region", locale) })).sort((a, b) => a.name.localeCompare(b.name, locale)), [countries, locale]);
  const [name, setName] = useState(user.name);
  const [lang, setLang] = useState(user.locale);
  const [country, setCountry] = useState(user.countryCode ?? "");
  const [workspace, setWorkspace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function begin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const timezone = user.timezone === "UTC" ? Intl.DateTimeFormat().resolvedOptions().timeZone : user.timezone;
      await api("/api/v1/me", { method: "PATCH", body: { name, locale: lang, timezone, countryCode: country || null } });
      if (!org) {
        const created = await api<{ id: string }>("/api/v1/organizations", { body: { name: workspace, defaultLocale: lang } });
        setCookie("realy_org", created.id);
      }
      const next = resumeStage ?? "vision";
      await api("/api/v1/me/onboarding", { method: "PATCH", body: { journeyStage: next } });
      router.push(`/${lang}/onboarding?stage=${next}`);
      router.refresh();
    } catch (err) {
      setError(err);
      if (err instanceof ApiError) setFields(err.fieldErrors());
      setBusy(false);
    }
  }

  return (
    <section className="relative isolate overflow-hidden rounded-[2rem] border bg-surface/40 shadow-elev-3">
      <Aurora className="pointer-events-none absolute inset-0 opacity-80" />
      <div aria-hidden className="absolute inset-0 opacity-70">
        <ParticleField density={0.8} intensity={0.4} />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_70%_30%,var(--glow),transparent_60%)] opacity-40" />
      <div className="relative grid gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-10 lg:p-12">
        <div className="grid gap-5">
          <Reveal className="grid gap-3">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">{t("onboarding.journey.welcome.eyebrow")}</p>
            <h1 className="font-display text-[clamp(2rem,6vw,3.6rem)] leading-[1.02] text-balance">
              <TypingText text={t("onboarding.journey.welcome.title")} />
            </h1>
            <p className="max-w-prose text-pretty text-muted-foreground">{t("onboarding.journey.welcome.lead")}</p>
          </Reveal>
          <ol className="grid gap-2 text-sm sm:grid-cols-3">
            {(["one", "two", "three"] as const).map((k, i) => (
              <Reveal as="li" key={k} index={i + 2} className="rounded-xl border bg-surface/70 px-3 py-2 backdrop-blur">
                <span className="block text-[11px] font-semibold text-primary tabular-nums">0{i + 1}</span>
                {t(`onboarding.journey.welcome.promise.${k}`)}
              </Reveal>
            ))}
          </ol>
          <form onSubmit={begin} className="grid gap-3 rounded-2xl border bg-surface/80 p-4 shadow-elev-2 backdrop-blur" noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("onboarding.journey.welcome.name")} htmlFor="w-name" error={fields.name}>
                <Input id="w-name" required value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" />
              </Field>
              <Field label={t("common.language")} htmlFor="w-lang">
                <Select id="w-lang" value={lang} onChange={(e) => setLang(e.target.value)}>
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {LOCALE_NAMES[l]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("onboarding.journey.welcome.country")} htmlFor="w-country">
                <Select id="w-country" value={country} onChange={(e) => setCountry(e.target.value)}>
                  <option value="">{t("auth.selectCountry")}</option>
                  {sorted.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {org ? (
                <div className="grid content-end gap-1 text-sm">
                  <span className="text-xs text-muted-foreground">{t("onboarding.journey.welcome.workspace")}</span>
                  <span className="font-medium">{org.name}</span>
                </div>
              ) : (
                <Field label={t("onboarding.orgName")} htmlFor="w-org" hint={t("onboarding.orgNameHint")}>
                  <Input id="w-org" required value={workspace} onChange={(e) => setWorkspace(e.target.value)} maxLength={120} placeholder={t("onboarding.journey.welcome.workspacePlaceholder")} />
                </Field>
              )}
            </div>
            <FormError error={error} />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="xl" variant="luminous" magnetic loading={busy} disabled={!name.trim() || (!org && !workspace.trim())}>
                {resumeStage ? t("onboarding.journey.welcome.resume") : t("onboarding.journey.welcome.begin")}
                <ArrowRight aria-hidden className="rtl:rotate-180" />
              </Button>
              <span className="text-xs text-muted-foreground">{t("onboarding.journey.welcome.time")}</span>
            </div>
          </form>
        </div>
        <div className="relative order-first mx-auto w-full max-w-[22rem] lg:order-none lg:max-w-none">
          <div aria-hidden className="absolute inset-[12%] rounded-full bg-[radial-gradient(circle,var(--glow),transparent_70%)] blur-2xl" />
          <AiCoreStage activity={0.35} nodes={6} className="relative mx-auto aspect-square w-full max-w-[26rem]" />
          <p className="sr-only">{t("onboarding.journey.welcome.coreLabel")}</p>
        </div>
      </div>
    </section>
  );
}
