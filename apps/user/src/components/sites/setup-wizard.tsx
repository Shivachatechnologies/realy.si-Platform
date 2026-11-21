"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, FileText, LayoutTemplate, Palette, Rocket, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { LOCALE_NAMES, type AppLocale } from "@/i18n/config";
import { SITE_FONTS, SITE_LOCALES, SITE_RADII, SITE_STYLES, SITE_TEMPLATES, type SiteTheme, type SiteTemplate } from "@/server/modules/sites/schemas";
import { themeStyle } from "./blocks";

export interface SetupDefaults {
  name: string;
  tagline: string | null;
  slug: string;
  locale: string;
  theme: SiteTheme;
  hasBrandKit: boolean;
  products: { id: string; name: string }[];
  structure: { runId: string; pages: number } | null;
}

type Start = "ai" | "structure" | "template" | "blank";
const STEPS = ["name", "style", "content", "publish"] as const;

/**
 * Guided website setup: 1) name and address → 2) style from the brand (colour, font, logo) → 3) AI draft, Founder Kit
 * structure or a template → 4) create, then publish the home page and go online (or review first). Nothing is public
 * until the founder publishes.
 */
export function SetupWizard({ base, defaults, logos, aiReady, canRunAi }: { base: string; defaults: SetupDefaults; logos: { id: string; url: string; title: string | null }[]; aiReady: boolean; canRunAi: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(defaults.name);
  const [slug, setSlug] = useState(defaults.slug);
  const [siteLocale, setSiteLocale] = useState(defaults.locale);
  const [theme, setTheme] = useState<SiteTheme>(defaults.theme);
  const aiOk = aiReady && canRunAi;
  const [start, setStart] = useState<Start>(defaults.structure ? "structure" : aiOk ? "ai" : "template");
  const [template, setTemplate] = useState<SiteTemplate>(defaults.products.length ? "product" : "services");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<{ homePageId: string | null; aiStarted: boolean; aiError: string | null } | null>(null);
  const slugOk = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(slug);

  async function create() {
    setBusy("create");
    setError(null);
    try {
      const r = await api<{ homePageId: string | null; aiStarted: boolean; aiError: string | null }>(`${base}/sites`, { body: { name, slug, locale: siteLocale, theme, start, template } });
      setCreated(r);
      setStep(3);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function publishNow() {
    if (!created?.homePageId) return;
    setBusy("publish");
    setError(null);
    try {
      await api(`${base}/sites/pages/${created.homePageId}/actions`, { body: { action: "publish", note: t("sites.setup.firstPublishNote") } });
      await api(`${base}/sites/actions`, { body: { action: "go_online" } });
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  const set = <K extends keyof SiteTheme>(k: K, v: SiteTheme[K]) => setTheme({ ...theme, [k]: v });
  const logoUrl = logos.find((l) => l.id === theme.logoAssetId)?.url ?? null;
  const starts: { key: Start; icon: typeof Sparkles; disabled: boolean; hint: string }[] = [
    { key: "ai", icon: Wand2, disabled: !aiOk, hint: !aiReady ? t("sites.setup.aiMissing") : !canRunAi ? t("sites.setup.aiNoPermission") : t("sites.setup.startAiHint") },
    { key: "structure", icon: FileText, disabled: !defaults.structure, hint: defaults.structure ? t("sites.setup.startStructureHint", { count: defaults.structure.pages }) : t("sites.setup.noStructure") },
    { key: "template", icon: LayoutTemplate, disabled: false, hint: t("sites.setup.startTemplateHint") },
    { key: "blank", icon: FileText, disabled: false, hint: t("sites.setup.startBlankHint") },
  ];

  return (
    <section className="grid gap-5 rounded-2xl border bg-surface p-4 shadow-elev-2 sm:p-6" aria-labelledby="site-setup">
      <div className="grid gap-1">
        <h2 id="site-setup" className="font-display text-2xl">
          {t("sites.setup.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("sites.setup.subtitle")}</p>
      </div>
      <ol className="grid grid-cols-4 gap-2" aria-label={t("sites.setup.progress")}>
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className="grid gap-1.5">
            <span className={cn("h-1.5 rounded-full transition-colors", i <= step ? "bg-primary" : "bg-muted")} />
            <span className={cn("text-xs", i === step ? "font-medium text-foreground" : "text-muted-foreground")}>
              {i + 1}. {t(`sites.setup.steps.${s}`)}
            </span>
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="grid gap-4 sm:max-w-xl">
          <Field label={t("sites.fields.name")} htmlFor="ss-name">
            <Input id="ss-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("sites.fields.slug")} htmlFor="ss-slug" hint={t("sites.fields.slugHint", { path: `/s/${slug || "…"}` })} error={slug && !slugOk ? t("sites.fields.slugInvalid") : undefined}>
            <Input id="ss-slug" value={slug} maxLength={48} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} className="font-mono" />
          </Field>
          <Field label={t("sites.fields.locale")} htmlFor="ss-locale" hint={t("sites.fields.localeHint")}>
            <Select id="ss-locale" value={siteLocale} onChange={(e) => setSiteLocale(e.target.value)}>
              {SITE_LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_NAMES[l as AppLocale]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="grid content-start gap-4">
            {defaults.hasBrandKit ? (
              <Notice tone="success" title={t("sites.setup.fromBrand")}>
                {t("sites.setup.fromBrandBody")}
              </Notice>
            ) : (
              <Notice tone="info">{t("sites.setup.noBrandKit")}</Notice>
            )}
            <ThemeFields theme={theme} set={set} logos={logos} />
          </div>
          <ThemeSample theme={theme} name={name} tagline={defaults.tagline} logoUrl={logoUrl} cta={t("sites.tpl.ctaContact")} />
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid gap-4">
          <div role="radiogroup" aria-label={t("sites.setup.steps.content")} className="grid gap-3 sm:grid-cols-2">
            {starts.map((s) => (
              <button
                key={s.key}
                type="button"
                role="radio"
                aria-checked={start === s.key}
                disabled={s.disabled}
                onClick={() => setStart(s.key)}
                className={cn("grid gap-1.5 rounded-xl border p-4 text-start transition disabled:cursor-not-allowed disabled:opacity-55", start === s.key ? "border-primary bg-accent/50 shadow-elev-2" : "bg-surface hover:border-border-strong")}
              >
                <span className="flex items-center gap-2 font-medium">
                  <s.icon className="size-4 text-primary" aria-hidden />
                  {t(`sites.setup.start.${s.key}`)}
                  {start === s.key ? <Check className="ms-auto size-4 text-primary" aria-hidden /> : null}
                </span>
                <span className="text-xs text-muted-foreground">{s.hint}</span>
              </button>
            ))}
          </div>
          {start === "template" ? (
            <Field label={t("sites.setup.template")} htmlFor="ss-template">
              <Select id="ss-template" value={template} onChange={(e) => setTemplate(e.target.value as SiteTemplate)} className="sm:max-w-sm">
                {SITE_TEMPLATES.map((k) => (
                  <option key={k} value={k}>
                    {t(`sites.templates.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {start === "ai" ? <p className="text-xs text-muted-foreground">{t("sites.setup.aiApproval")}</p> : null}
        </div>
      ) : null}

      {step === 3 ? (
        created ? (
          <div className="grid gap-4">
            <Notice tone="success" title={t("sites.setup.createdTitle")}>
              {created.aiStarted ? t("sites.setup.createdAi") : t("sites.setup.createdBody")}
            </Notice>
            {created.aiError ? <Notice tone="warning">{t("sites.setup.aiFailed")}</Notice> : null}
            <div className="flex flex-wrap gap-2">
              {created.homePageId ? (
                <Button variant="luminous" onClick={publishNow} loading={busy === "publish"}>
                  <Rocket aria-hidden />
                  {t("sites.setup.publishNow")}
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => router.push(created.homePageId ? `/${locale}/website/pages/${created.homePageId}` : `/${locale}/website/pages`)}>
                {t("sites.setup.reviewFirst")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("sites.setup.publishHint")}</p>
          </div>
        ) : (
          <div className="grid gap-3 text-sm">
            <dl className="grid gap-2 rounded-xl border bg-surface-2/60 p-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">{t("sites.fields.name")}</dt>
                <dd className="font-medium">{name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("sites.fields.slug")}</dt>
                <dd className="font-mono">/s/{slug}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("sites.fields.font")}</dt>
                <dd>{t(`sites.fonts.${theme.font}`)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("sites.setup.steps.content")}</dt>
                <dd>{start === "template" ? t(`sites.templates.${template}`) : t(`sites.setup.start.${start}`)}</dd>
              </div>
            </dl>
            <p className="text-muted-foreground">{t("sites.setup.reviewNote")}</p>
          </div>
        )
      ) : null}

      <FormError error={error} />

      {!created ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
            <ArrowLeft aria-hidden className="rtl:rotate-180" />
            {t("sites.setup.back")}
          </Button>
          {step < 3 ? (
            <Button onClick={() => setStep(step + 1)} disabled={step === 0 && (!name.trim() || !slugOk)}>
              {t("sites.setup.next")}
              <ArrowRight aria-hidden className="rtl:rotate-180" />
            </Button>
          ) : (
            <Button variant="luminous" magnetic onClick={create} loading={busy === "create"}>
              <Sparkles aria-hidden />
              {t("sites.setup.create")}
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** Brand colour, accent, font, style, corners and logo (setup wizard and site settings). */
export function ThemeFields({ theme, set, logos }: { theme: SiteTheme; set: <K extends keyof SiteTheme>(k: K, v: SiteTheme[K]) => void; logos: { id: string; url: string; title: string | null }[] }) {
  const { t } = useI18n();
  const color = (k: "brandColor" | "accentColor", id: string) => (
    <Field label={t(`sites.fields.${k}`)} htmlFor={id}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={t(`sites.fields.${k}`)} value={theme[k]} onChange={(e) => set(k, e.target.value)} className="size-10 shrink-0 cursor-pointer rounded-md border bg-surface p-1" />
        <Input id={id} value={theme[k]} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && set(k, e.target.value)} className="font-mono" maxLength={7} />
      </div>
    </Field>
  );
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {color("brandColor", "th-brand")}
        {color("accentColor", "th-accent")}
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[13px] font-medium">{t("sites.fields.font")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {SITE_FONTS.map((f) => (
            <button key={f} type="button" aria-pressed={theme.font === f} onClick={() => set("font", f)} className={cn("grid gap-0.5 rounded-lg border p-3 text-start transition", theme.font === f ? "border-primary bg-accent/50" : "hover:border-border-strong")} style={{ ...themeStyle({ ...theme, font: f }) }}>
              <span className="font-[family-name:var(--site-heading)] text-lg leading-tight">Aa</span>
              <span className="text-xs text-muted-foreground">{t(`sites.fonts.${f}`)}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("sites.fields.style")} htmlFor="th-style">
          <Select id="th-style" value={theme.style} onChange={(e) => set("style", e.target.value as SiteTheme["style"])}>
            {SITE_STYLES.map((s) => (
              <option key={s} value={s}>
                {t(`sites.styles.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("sites.fields.radius")} htmlFor="th-radius">
          <Select id="th-radius" value={theme.radius} onChange={(e) => set("radius", e.target.value as SiteTheme["radius"])}>
            {SITE_RADII.map((s) => (
              <option key={s} value={s}>
                {t(`sites.radii.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[13px] font-medium">{t("sites.fields.logo")}</legend>
        {logos.length ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={!theme.logoAssetId} onClick={() => set("logoAssetId", null)} className={cn("grid h-14 min-w-14 place-items-center rounded-lg border px-3 text-xs", !theme.logoAssetId ? "border-primary bg-accent/50" : "hover:border-border-strong")}>
              {t("sites.fields.noLogo")}
            </button>
            {logos.slice(0, 12).map((l) => (
              <button key={l.id} type="button" aria-pressed={theme.logoAssetId === l.id} aria-label={l.title ?? t("sites.fields.logo")} onClick={() => set("logoAssetId", l.id)} className={cn("grid size-14 place-items-center overflow-hidden rounded-lg border bg-white p-1", theme.logoAssetId === l.id ? "border-primary ring-2 ring-primary/30" : "hover:border-border-strong")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={l.url} alt="" className="max-h-full max-w-full object-contain" />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("sites.fields.noLogos")}</p>
        )}
      </fieldset>
    </div>
  );
}

function ThemeSample({ theme, name, tagline, logoUrl, cta }: { theme: SiteTheme; name: string; tagline: string | null; logoUrl: string | null; cta: string }) {
  const { t } = useI18n();
  const bold = theme.style === "bold";
  return (
    <figure className="grid gap-2" aria-label={t("sites.setup.sample")}>
      <div className="overflow-hidden rounded-xl border bg-white text-slate-900 shadow-elev-3" style={themeStyle(theme)}>
        <div className="flex h-11 items-center gap-2 border-b border-slate-200 px-4 text-sm font-semibold">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-6 w-auto max-w-[5rem] object-contain" />
          ) : (
            <span className="grid size-6 place-items-center rounded-[calc(var(--site-radius)*0.5)] bg-[var(--site-brand)] text-[11px] text-[var(--site-brand-fg)]">{name.slice(0, 1).toUpperCase()}</span>
          )}
          <span className="truncate font-[family-name:var(--site-heading)]">{name}</span>
        </div>
        <div className={cn("grid gap-3 px-5 py-8", bold ? "bg-[var(--site-brand)] text-[var(--site-brand-fg)]" : theme.style === "soft" ? "bg-[radial-gradient(80%_120%_at_10%_0%,color-mix(in_oklch,var(--site-brand)_16%,white),white_70%)]" : "")}>
          <p className="font-[family-name:var(--site-heading)] text-2xl leading-tight font-bold tracking-tight">{tagline || name}</p>
          <p className={cn("text-sm", bold ? "opacity-85" : "text-slate-600")}>{t("sites.tpl.heroSubtitle")}</p>
          <span className={cn("inline-flex h-9 w-fit items-center rounded-[var(--site-radius)] px-4 text-xs font-semibold", bold ? "bg-white text-slate-900" : "bg-[var(--site-brand)] text-[var(--site-brand-fg)]")}>{cta}</span>
        </div>
        <div className="grid grid-cols-3 gap-2 p-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid gap-1.5 rounded-[var(--site-radius)] bg-slate-50 p-3 ring-1 ring-slate-200/70">
              <span className="size-5 rounded-[calc(var(--site-radius)*0.4)] bg-[color-mix(in_oklch,var(--site-brand)_18%,white)]" />
              <span className="h-1.5 w-3/4 rounded bg-slate-200" />
              <span className="h-1.5 w-1/2 rounded bg-slate-100" />
            </div>
          ))}
        </div>
        <div className="mx-4 mb-4 rounded-[var(--site-radius)] bg-[var(--site-accent)] p-3 text-xs font-medium text-[var(--site-accent-fg)]">{t("sites.tpl.ctaTitle")}</div>
      </div>
      <figcaption className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Palette className="size-3.5" aria-hidden />
        {t("sites.setup.sample")}
      </figcaption>
    </figure>
  );
}
