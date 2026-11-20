import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Eye, FileCheck2, Fingerprint, Globe2, Building2, PauseCircle, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { World } from "@/components/ui/world";
import { WorldIllustration } from "@/components/graphics/illustrations";
import { AiAvatar } from "@/components/graphics/ai-avatar";
import { HeroVisual } from "@/components/site/hero-visual";
import { ProductShowcase } from "@/components/site/product-showcase";
import { ScrollReveal } from "@/components/site/scroll-reveal";
import { SiteContainer, SiteHeading } from "@/components/site/section";
import { WaitlistForm } from "@/components/site/waitlist-form";
import { JsonLd } from "@/components/site/json-ld";
import { siteMetadata, siteOrigin } from "@/components/site/meta";
import { getLocale, getT } from "@/i18n/server";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { SITE_DEPARTMENTS } from "@/server/modules/site/content";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getT(locale);
  return { ...siteMetadata({ locale, path: "", title: t("site.home.metaTitle"), description: t("site.home.metaDescription") }), title: { absolute: t("site.home.metaTitle") } };
}

const STORY = ["s1", "s2", "s3", "s4"] as const;
const TRUST = [
  { key: "t1", icon: ShieldCheck },
  { key: "t2", icon: FileCheck2 },
  { key: "t3", icon: Fingerprint },
  { key: "t4", icon: PauseCircle },
  { key: "t5", icon: Building2 },
  { key: "t6", icon: Globe2 },
] as const;
const LADDER = [
  { key: "read", icon: Eye, tone: "bg-success" },
  { key: "change", icon: Workflow, tone: "bg-warning" },
  { key: "external", icon: ShieldCheck, tone: "bg-danger" },
] as const;

/** Public homepage (served at /{locale} for signed-out visitors via the proxy rewrite, and at /{locale}/home). */
export default async function HomePage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const roles = AGENT_PROFILES.length;
  const featured = ["ai_ceo", "cmo", "ai_cfo", "sdr", "recruiter", "support_agent", "product_manager"];
  const origin = siteOrigin();

  return (
    <World name="command" ambient={false}>
      <JsonLd
        data={[
          { "@context": "https://schema.org", "@type": "Organization", name: "Realy", url: `${origin}/${locale}`, logo: `${origin}/favicon.ico` },
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "Realy",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            description: t("site.home.metaDescription"),
            url: `${origin}/${locale}`,
            inLanguage: ["en-US", "de-DE", "ar-AE", "hi-IN", "zh-CN"],
          },
        ]}
      />

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="site-hero-light pointer-events-none absolute inset-0 -z-10" />
        <div aria-hidden className="grain pointer-events-none absolute inset-0 -z-10" />
        <SiteContainer wide className="grid items-center gap-10 pt-10 pb-16 sm:pt-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-6 lg:pt-20 lg:pb-24">
          <div className="grid gap-7 animate-fade-up">
            <p className="eyebrow-rule">{t("site.home.eyebrow")}</p>
            <h1 className="font-display text-hero text-balance break-words">
              <span className="block">{t("site.home.titleA")}</span>
              <span className="block">{t("site.home.titleB")}</span>
              <span className="text-world block italic">{t("site.home.titleC")}</span>
            </h1>
            <p className="max-w-xl text-[16.5px] leading-relaxed text-pretty text-muted-foreground sm:text-[18px]">{t("site.home.lede")}</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href={`/${locale}/sign-up`} className="press inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[15px] font-medium text-background shadow-elev-3 transition-transform hover:scale-[1.02]">
                {t("site.home.ctaPrimary")}
                <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
              </Link>
              <Link href="#how" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border bg-surface/70 px-6 text-[15px] font-medium backdrop-blur hover:bg-surface">
                {t("site.home.ctaSecondary")}
              </Link>
            </div>
            <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              {t("site.home.heroNote")}
            </p>
          </div>
          <div className="px-6 sm:px-10 lg:px-0">
            <HeroVisual />
          </div>
        </SiteContainer>
      </section>

      {/* ── Story: how a company runs on Realy ── */}
      <section id="how" className="scroll-mt-20 border-t py-20 sm:py-28">
        <SiteContainer className="grid gap-14">
          <ScrollReveal>
            <SiteHeading eyebrow={t("site.home.story.eyebrow")} title={t("site.home.story.title")} lede={t("site.home.story.lede")} />
          </ScrollReveal>
          <ol className="relative grid gap-10 md:grid-cols-4 md:gap-6">
            <span aria-hidden className="data-rail absolute inset-x-0 top-5 hidden md:block" />
            {STORY.map((s, i) => (
              <li key={s} className="relative">
                <ScrollReveal delay={i * 0.08} className="grid gap-3">
                  <span className="relative grid size-10 place-items-center rounded-full border bg-surface font-mono text-[13px] shadow-elev-2">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="text-[17px] font-semibold tracking-tight">{t(`site.home.story.${s}.title`)}</h3>
                  <p className="text-[14px] leading-relaxed text-muted-foreground">{t(`site.home.story.${s}.body`)}</p>
                </ScrollReveal>
              </li>
            ))}
          </ol>
        </SiteContainer>
      </section>

      {/* ── Interactive product showcase ── */}
      <section className="relative border-t bg-muted/25 py-20 sm:py-28">
        <SiteContainer className="grid gap-12">
          <ScrollReveal>
            <SiteHeading eyebrow={t("site.showcase.eyebrow")} title={t("site.showcase.title")} lede={t("site.showcase.lede")} />
          </ScrollReveal>
          <ProductShowcase />
        </SiteContainer>
      </section>

      {/* ── Departments ── */}
      <section className="border-t py-20 sm:py-28">
        <SiteContainer className="grid gap-12">
          <ScrollReveal className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <SiteHeading eyebrow={t("site.home.departments.eyebrow")} title={t("site.home.departments.title")} lede={t("site.home.departments.lede")} />
            <Link href={`/${locale}/platform`} className="inline-flex min-h-11 shrink-0 items-center gap-2 text-[14px] font-medium text-primary hover:underline">
              {t("site.home.departments.all")}
              <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </Link>
          </ScrollReveal>
          <ul className="grid border-t">
            {SITE_DEPARTMENTS.map((d, i) => (
              <li key={d.key} className="border-b">
                <World name={d.world} ambient={false}>
                  <Link href={`/${locale}/platform/${d.key}`} className="group grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-4 py-5 sm:grid-cols-[3rem_minmax(0,0.9fr)_minmax(0,1.1fr)_7rem] sm:gap-6">
                    <span className="font-mono text-[12px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                    <span className="font-display text-[1.65rem] leading-none transition-colors group-hover:text-[var(--world-accent,var(--primary))] sm:text-[2rem]">{t(`site.departments.${d.key}.name`)}</span>
                    <span className="hidden text-[14px] leading-relaxed text-muted-foreground sm:block">{t(`site.departments.${d.key}.tagline`)}</span>
                    <span className="relative hidden h-16 overflow-hidden sm:block">
                      <WorldIllustration world={d.world} className="absolute inset-0 size-full opacity-70 transition-[opacity,transform] duration-500 group-hover:scale-110 group-hover:opacity-100" />
                    </span>
                    <ArrowRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-1 sm:hidden rtl:-scale-x-100 rtl:group-hover:-translate-x-1" aria-hidden />
                    <span className="col-span-full -mt-2 text-[13.5px] leading-relaxed text-muted-foreground sm:hidden">{t(`site.departments.${d.key}.tagline`)}</span>
                  </Link>
                </World>
              </li>
            ))}
          </ul>
        </SiteContainer>
      </section>

      {/* ── AI workforce + autonomy ladder ── */}
      <section className="relative overflow-hidden border-t py-20 sm:py-28">
        <div aria-hidden className="site-hero-light pointer-events-none absolute inset-0 -z-10 opacity-60" />
        <SiteContainer className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <ScrollReveal className="grid gap-8">
            <SiteHeading eyebrow={t("site.home.workforce.eyebrow")} title={t("site.home.workforce.title")} lede={t("site.home.workforce.lede", { count: roles })} />
            <ul className="flex flex-wrap gap-2">
              {featured.map((k) => (
                <li key={k} className="inline-flex min-h-11 items-center gap-2 rounded-full border bg-surface/80 py-1 ps-1 pe-3.5 text-[13px] shadow-elev-1 backdrop-blur">
                  <AiAvatar seed={k} size={30} />
                  {t(`profiles.${k}.name`)}
                </li>
              ))}
            </ul>
            <Link href={`/${locale}/ai-workforce`} className="inline-flex min-h-11 items-center gap-2 justify-self-start text-[14px] font-medium text-primary hover:underline">
              {t("site.home.workforce.cta", { count: roles })}
              <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </Link>
          </ScrollReveal>
          <ScrollReveal delay={0.1}>
            <div className="panel-float grid gap-1 p-2">
              <p className="px-4 pt-4 pb-2 text-[12px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{t("site.home.ladder.title")}</p>
              {LADDER.map((l) => {
                const Icon = l.icon;
                return (
                  <div key={l.key} className="flex items-start gap-4 rounded-2xl p-4 transition-colors hover:bg-muted/50">
                    <span className="relative mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl border bg-surface shadow-elev-1">
                      <Icon className="size-[1.1rem]" aria-hidden />
                      <span aria-hidden className={`absolute -end-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-surface ${l.tone}`} />
                    </span>
                    <div className="grid gap-1">
                      <p className="text-[15px] font-semibold">{t(`site.home.ladder.${l.key}.title`)}</p>
                      <p className="text-[13.5px] leading-relaxed text-muted-foreground">{t(`site.home.ladder.${l.key}.body`)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollReveal>
        </SiteContainer>
      </section>

      {/* ── Trust & control ── */}
      <section className="border-t bg-muted/25 py-20 sm:py-28">
        <SiteContainer className="grid gap-12">
          <ScrollReveal>
            <SiteHeading eyebrow={t("site.home.trust.eyebrow")} title={t("site.home.trust.title")} lede={t("site.home.trust.lede")} />
          </ScrollReveal>
          <div className="grid gap-px overflow-hidden rounded-3xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {TRUST.map(({ key, icon: Icon }) => (
              <div key={key} className="grid content-start gap-3 bg-surface p-6 sm:p-7">
                <Icon className="size-5 text-primary" aria-hidden />
                <h3 className="text-[16px] font-semibold tracking-tight">{t(`site.home.trust.${key}.title`)}</h3>
                <p className="text-[14px] leading-relaxed text-muted-foreground">{t(`site.home.trust.${key}.body`)}</p>
              </div>
            ))}
          </div>
        </SiteContainer>
      </section>

      {/* ── Pricing teaser ── */}
      <section className="border-t py-20 sm:py-24">
        <SiteContainer className="grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_auto]">
          <SiteHeading eyebrow={t("site.nav.pricing")} title={t("site.home.pricing.title")} lede={t("site.home.pricing.lede")} />
          <Link href={`/${locale}/pricing`} className="press inline-flex min-h-12 items-center justify-center gap-2 rounded-full border bg-surface px-6 text-[15px] font-medium shadow-elev-2 hover:bg-muted">
            {t("site.home.pricing.cta")}
            <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </Link>
        </SiteContainer>
      </section>

      {/* ── Final call to action ── */}
      <section className="relative overflow-hidden border-t py-24 sm:py-32">
        <div aria-hidden className="site-hero-light pointer-events-none absolute inset-0 -z-10" />
        <SiteContainer className="grid justify-items-center gap-8 text-center">
          <Sparkles className="size-6 text-primary" aria-hidden />
          <h2 className="max-w-3xl font-display text-display-xl text-balance">{t("site.home.final.title")}</h2>
          <p className="max-w-xl text-[16px] leading-relaxed text-muted-foreground">{t("site.home.final.lede")}</p>
          <div className="w-full max-w-lg text-start">
            <WaitlistForm compact source="home" />
          </div>
          <p className="text-[13px] text-muted-foreground">
            {t("site.home.final.orStart")}{" "}
            <Link href={`/${locale}/sign-up`} className="font-medium text-foreground underline underline-offset-4">
              {t("site.home.ctaPrimary")}
            </Link>
          </p>
        </SiteContainer>
      </section>
    </World>
  );
}
