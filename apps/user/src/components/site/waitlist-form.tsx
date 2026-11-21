"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Check } from "lucide-react";
import { FormError } from "@/components/form-error";
import { SuccessBurst } from "@/components/motion/success-burst";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { SITE_DEPARTMENTS, type SiteDepartmentKey } from "@/server/modules/site/content";

const TEAM_SIZES = ["solo", "2-10", "11-50", "51-200", "200+"] as const;

/**
 * Waitlist sign-up. `compact` shows only the email (homepage band); the full form asks a few optional questions.
 * Success is shown only after the server stored the entry.
 */
export function WaitlistForm({ compact = false, source }: { compact?: boolean; source: string }) {
  const { t, locale } = useI18n();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [interests, setInterests] = useState<SiteDepartmentKey[]>([]);
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!consent) return;
    setPending(true);
    setError(null);
    try {
      await api("/api/public/waitlist", {
        method: "POST",
        body: {
          email,
          name: name || undefined,
          company: company || undefined,
          role: role || undefined,
          teamSize: teamSize || undefined,
          interests,
          note: note || undefined,
          locale,
          source,
          consent: true,
          website: website || undefined,
        },
      });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="grid justify-items-center gap-3 rounded-3xl border bg-surface/80 p-8 text-center shadow-float backdrop-blur">
        <SuccessBurst active label={t("site.waitlist.successTitle")} size={72} />
        <p className="font-display text-3xl">{t("site.waitlist.successTitle")}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{t("site.waitlist.successBody")}</p>
      </div>
    );
  }

  const toggle = (k: SiteDepartmentKey) => setInterests((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const consentBox = (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[12.5px] leading-relaxed text-muted-foreground">
      <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]" />
      <span>{t("site.waitlist.consent")}</span>
    </label>
  );
  const honeypot = (
    <div aria-hidden className="absolute -start-[9999px] top-auto size-px overflow-hidden">
      <label htmlFor={`wl-website-${source}`}>Website</label>
      <input id={`wl-website-${source}`} tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
    </div>
  );

  if (compact) {
    return (
      <form onSubmit={submit} className="relative grid gap-3">
        {honeypot}
        <div className="flex flex-col gap-2 rounded-3xl border bg-surface/85 p-2 shadow-float backdrop-blur sm:flex-row sm:rounded-full">
          <label htmlFor={`wl-email-${source}`} className="sr-only">
            {t("site.waitlist.email")}
          </label>
          <input
            id={`wl-email-${source}`}
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("site.waitlist.emailPlaceholder")}
            className="min-h-12 min-w-0 flex-1 rounded-full bg-transparent px-4 text-base outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" size="xl" loading={pending} disabled={!consent} className="rounded-full">
            {t("site.waitlist.submit")}
            <ArrowRight className="rtl:-scale-x-100" aria-hidden />
          </Button>
        </div>
        {consentBox}
        <FormError error={error} />
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="relative grid gap-5 rounded-3xl border bg-surface/85 p-5 shadow-float backdrop-blur sm:p-8">
      {honeypot}
      <Field label={t("site.waitlist.email")} htmlFor="wl-email">
        <Input id="wl-email" type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("site.waitlist.emailPlaceholder")} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("site.waitlist.name")} htmlFor="wl-name">
          <Input id="wl-name" autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("site.waitlist.company")} htmlFor="wl-company">
          <Input id="wl-company" autoComplete="organization" maxLength={160} value={company} onChange={(e) => setCompany(e.target.value)} />
        </Field>
        <Field label={t("site.waitlist.role")} htmlFor="wl-role">
          <Input id="wl-role" autoComplete="organization-title" maxLength={120} value={role} onChange={(e) => setRole(e.target.value)} placeholder={t("site.waitlist.rolePlaceholder")} />
        </Field>
        <Field label={t("site.waitlist.teamSize")} htmlFor="wl-size">
          <Select id="wl-size" value={teamSize} onChange={(e) => setTeamSize(e.target.value)}>
            <option value="">{t("site.waitlist.choose")}</option>
            {TEAM_SIZES.map((s) => (
              <option key={s} value={s}>
                {t(`site.waitlist.teamSizes.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-[13px] font-medium text-foreground/90">{t("site.waitlist.interests")}</legend>
        <div className="flex flex-wrap gap-2">
          {SITE_DEPARTMENTS.map((d) => {
            const on = interests.includes(d.key);
            return (
              <button
                key={d.key}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(d.key)}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-[13px] transition-colors",
                  on ? "border-transparent bg-foreground text-background" : "hover:border-border-strong hover:bg-muted/60",
                )}
              >
                {on ? <Check className="size-3.5" aria-hidden /> : null}
                {t(`site.departments.${d.key}.name`)}
              </button>
            );
          })}
        </div>
      </fieldset>
      <Field label={t("site.waitlist.note")} htmlFor="wl-note" hint={t("site.waitlist.noteHint")}>
        <Textarea id="wl-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {consentBox}
      <FormError error={error} />
      <Button type="submit" size="xl" variant="luminous" loading={pending} disabled={!consent} className="justify-self-start">
        {t("site.waitlist.submit")}
        <ArrowRight className="rtl:-scale-x-100" aria-hidden />
      </Button>
      <p className="text-[12px] text-muted-foreground">{t("site.waitlist.privacy")}</p>
    </form>
  );
}
