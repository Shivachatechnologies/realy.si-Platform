import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Blocks, Brain, ClipboardCheck, LayoutDashboard, Network, Workflow } from "lucide-react";
import { World } from "@/components/ui/world";
import { WorldIllustration } from "@/components/graphics/illustrations";
import { ProductShowcase } from "@/components/site/product-showcase";
import { ScrollReveal } from "@/components/site/scroll-reveal";
import { SiteContainer, SiteHeading } from "@/components/site/section";
import { siteMetadata } from "@/components/site/meta";
import { getLocale, getT } from "@/i18n/server";
import { SITE_DEPARTMENTS } from "@/server/modules/site/content";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getT(locale);
  return siteMetadata({ locale, path: "/platform", title: t("site.platform.metaTitle"), description: t("site.platform.lede") });
}

const CORE = [
  { key: "command", icon: LayoutDashboard },
  { key: "approvals", icon: ClipboardCheck },
  { key: "brain", icon: Brain },
  { key: "graph", icon: Network },
  { key: "workflows", icon: Workflow },
  { key: "integrations", icon: Blocks },
] as const;

/** Platform overview: the shared core every department runs on, the product tour and the department map. */
export default async function PlatformPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  return (
    <World name="command" ambient={false}>
      <section className="relative overflow-hidden">
        <div aria-hidden className="site-hero-light pointer-events-none absolute inset-0 -z-10" />
        <SiteContainer className="grid gap-8 pt-14 pb-16 sm:pt-20">
          <SiteHeading as="h1" eyebrow={t("site.platform.eyebrow")} title={t("site.platform.title")} lede={t("site.platform.lede")} />
        </SiteContainer>
      </section>

      <section className="border-t py-20">
        <SiteContainer className="grid gap-12">
          <SiteHeading eyebrow={t("site.platform.core.eyebrow")} title={t("site.platform.core.title")} lede={t("site.platform.core.lede")} />
          <div className="grid gap-px overflow-hidden rounded-3xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {CORE.map(({ key, icon: Icon }) => (
              <div key={key} className="grid content-start gap-3 bg-surface p-6 sm:p-7">
                <span className="grid size-10 place-items-center rounded-xl bg-accent text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="text-[16px] font-semibold tracking-tight">{t(`site.platform.core.${key}.title`)}</h3>
                <p className="text-[14px] leading-relaxed text-muted-foreground">{t(`site.platform.core.${key}.body`)}</p>
              </div>
            ))}
          </div>
        </SiteContainer>
      </section>

      <section className="border-t bg-muted/25 py-20">
        <SiteContainer className="grid gap-12">
          <SiteHeading eyebrow={t("site.showcase.eyebrow")} title={t("site.showcase.title")} lede={t("site.showcase.lede")} />
          <ProductShowcase />
        </SiteContainer>
      </section>

      <section className="border-t py-20">
        <SiteContainer className="grid gap-12">
          <SiteHeading eyebrow={t("site.home.departments.eyebrow")} title={t("site.platform.departmentsTitle")} lede={t("site.home.departments.lede")} />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SITE_DEPARTMENTS.map((d, i) => (
              <li key={d.key}>
                <ScrollReveal delay={(i % 3) * 0.06}>
                  <World name={d.world} ambient={false}>
                    <Link href={`/${locale}/platform/${d.key}`} className="group panel-float grid h-full gap-4 overflow-hidden p-6 transition-transform duration-300 hover:-translate-y-1">
                      <WorldIllustration world={d.world} className="h-28 w-full transition-transform duration-500 group-hover:scale-105" />
                      <div className="grid gap-1.5">
                        <h3 className="font-display text-[1.7rem] leading-none">{t(`site.departments.${d.key}.name`)}</h3>
                        <p className="text-[13.5px] leading-relaxed text-muted-foreground">{t(`site.departments.${d.key}.tagline`)}</p>
                      </div>
                      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--world-accent,var(--primary))]">
                        {t("site.platform.explore")}
                        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" aria-hidden />
                      </span>
                    </Link>
                  </World>
                </ScrollReveal>
              </li>
            ))}
          </ul>
        </SiteContainer>
      </section>
    </World>
  );
}
