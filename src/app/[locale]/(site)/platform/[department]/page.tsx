import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ShieldCheck, Sparkles } from "lucide-react";
import { World } from "@/components/ui/world";
import { WorldIllustration } from "@/components/graphics/illustrations";
import { AiAvatar } from "@/components/graphics/ai-avatar";
import { ScrollReveal } from "@/components/site/scroll-reveal";
import { SiteContainer } from "@/components/site/section";
import { JsonLd } from "@/components/site/json-ld";
import { siteMetadata, siteOrigin } from "@/components/site/meta";
import { getLocale, getT } from "@/i18n/server";
import { DEPARTMENT_FEATURES, SITE_DEPARTMENTS, siteDepartment } from "@/server/modules/site/content";

export async function generateMetadata({ params }: PageProps<"/[locale]/platform/[department]">): Promise<Metadata> {
  const { department } = await params;
  const d = siteDepartment(department);
  if (!d) return {};
  const locale = await getLocale();
  const t = await getT(locale);
  return siteMetadata({ locale, path: `/platform/${d.key}`, title: t("site.departments.metaTitle", { name: t(`site.departments.${d.key}.name`) }), description: t(`site.departments.${d.key}.intro`) });
}

/** One department of the platform: what it covers, which AI roles work there and what always waits for a person. */
export default async function DepartmentPage({ params }: PageProps<"/[locale]/platform/[department]">) {
  const { department } = await params;
  const d = siteDepartment(department);
  if (!d) notFound();
  const locale = await getLocale();
  const t = await getT(locale);
  const idx = SITE_DEPARTMENTS.findIndex((x) => x.key === d.key);
  const next = SITE_DEPARTMENTS[(idx + 1) % SITE_DEPARTMENTS.length]!;
  const name = t(`site.departments.${d.key}.name`);
  const origin = siteOrigin();

  return (
    <World name={d.world}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: t("site.nav.platform"), item: `${origin}/${locale}/platform` },
            { "@type": "ListItem", position: 2, name, item: `${origin}/${locale}/platform/${d.key}` },
          ],
        }}
      />
      <SiteContainer className="grid items-center gap-10 pt-10 pb-16 sm:pt-16 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="grid gap-6 animate-fade-up">
          <Link href={`/${locale}/platform`} className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
            {t("site.nav.platform")}
          </Link>
          <p className="eyebrow-rule">{t("site.departments.eyebrow")}</p>
          <h1 className="font-display text-hero text-balance break-words">{name}</h1>
          <p className="text-world max-w-xl font-display text-display-lg italic">{t(`site.departments.${d.key}.tagline`)}</p>
          <p className="max-w-xl text-[16px] leading-relaxed text-muted-foreground">{t(`site.departments.${d.key}.intro`)}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href={`/${locale}/sign-up`} className="press inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[15px] font-medium text-background shadow-elev-3">
              {t("site.home.ctaPrimary")}
              <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </Link>
            <Link href={`/${locale}/docs`} className="inline-flex min-h-12 items-center justify-center rounded-full border bg-surface/70 px-6 text-[15px] font-medium hover:bg-surface">
              {t("site.departments.readDocs")}
            </Link>
          </div>
        </div>
        <div className="panel-float hidden p-8 sm:block">
          <WorldIllustration world={d.world} className="mx-auto w-full max-w-sm" />
        </div>
      </SiteContainer>

      <section className="border-t py-16 sm:py-20">
        <SiteContainer className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <h2 className="font-display text-display-lg">{t("site.departments.whatYouGet")}</h2>
          <ul className="grid gap-px overflow-hidden rounded-3xl border bg-border sm:grid-cols-2">
            {DEPARTMENT_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-3 bg-surface p-5 sm:p-6">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklch,var(--world-accent)_16%,transparent)] text-[var(--world-accent)]">
                  <Check className="size-3.5" aria-hidden />
                </span>
                <span className="text-[14.5px] leading-relaxed">{t(`site.departments.${d.key}.${f}`)}</span>
              </li>
            ))}
          </ul>
        </SiteContainer>
      </section>

      <section className="border-t bg-muted/25 py-16 sm:py-20">
        <SiteContainer className="grid gap-10 lg:grid-cols-2">
          <ScrollReveal className="grid content-start gap-5">
            <p className="eyebrow-rule">
              <Sparkles className="size-3.5" aria-hidden />
              {t("site.departments.aiTitle")}
            </p>
            <p className="text-[16px] leading-relaxed">{t(`site.departments.${d.key}.ai`)}</p>
            <ul className="grid gap-2">
              {d.profiles.map((p) => (
                <li key={p} className="flex items-center gap-3 rounded-2xl border bg-surface p-3">
                  <AiAvatar seed={p} size={38} />
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium">{t(`profiles.${p}.name`)}</p>
                    <p className="text-[12.5px] leading-snug text-muted-foreground">{t(`profiles.${p}.summary`)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </ScrollReveal>
          <ScrollReveal delay={0.08} className="grid content-start gap-5">
            <p className="eyebrow-rule">
              <ShieldCheck className="size-3.5" aria-hidden />
              {t("site.departments.approvalTitle")}
            </p>
            <div className="panel-float p-6">
              <p className="text-[16px] leading-relaxed">{t(`site.departments.${d.key}.approval`)}</p>
              <p className="mt-4 border-t pt-4 text-[13px] leading-relaxed text-muted-foreground">{t("site.departments.approvalNote")}</p>
            </div>
          </ScrollReveal>
        </SiteContainer>
      </section>

      <section className="border-t py-14">
        <SiteContainer>
          <Link href={`/${locale}/platform/${next.key}`} className="group flex items-center justify-between gap-4 rounded-3xl border p-6 transition-colors hover:bg-muted/40 sm:p-8">
            <span className="grid gap-1">
              <span className="text-[12px] tracking-[0.12em] text-muted-foreground uppercase">{t("site.departments.next")}</span>
              <span className="font-display text-display-lg">{t(`site.departments.${next.key}.name`)}</span>
            </span>
            <ArrowRight className="size-6 shrink-0 transition-transform group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" aria-hidden />
          </Link>
        </SiteContainer>
      </section>
    </World>
  );
}
