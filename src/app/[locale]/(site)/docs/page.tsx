import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, BookOpen, ShieldCheck, Sparkles, Database } from "lucide-react";
import { World } from "@/components/ui/world";
import { SiteContainer, SiteHeading } from "@/components/site/section";
import { siteMetadata } from "@/components/site/meta";
import { getLocale, getT } from "@/i18n/server";
import { DOC_ARTICLES, DOC_CATEGORIES } from "@/server/modules/site/content";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getT(locale);
  return siteMetadata({ locale, path: "/docs", title: t("site.docs.title"), description: t("site.docs.lede") });
}

const ICONS = { start: BookOpen, ai: Sparkles, data: Database, trust: ShieldCheck } as const;

/** Documentation home: guides grouped by what the reader is trying to do. */
export default async function DocsIndex() {
  const locale = await getLocale();
  const t = await getT(locale);
  return (
    <World name="command" ambient={false}>
      <SiteContainer className="grid gap-14 pt-14 pb-20 sm:pt-20">
        <SiteHeading as="h1" eyebrow={t("site.docs.eyebrow")} title={t("site.docs.title")} lede={t("site.docs.lede")} />
        <div className="grid gap-6 md:grid-cols-2">
          {DOC_CATEGORIES.map((c) => {
            const Icon = ICONS[c];
            return (
              <section key={c} className="grid content-start gap-4 rounded-3xl border bg-surface p-6 sm:p-8">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-accent text-primary">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <h2 className="font-display text-display-lg">{t(`site.docs.categories.${c}`)}</h2>
                </div>
                <ul className="grid">
                  {DOC_ARTICLES.filter((a) => a.category === c).map((a) => (
                    <li key={a.slug} className="border-t first:border-t-0">
                      <Link href={`/${locale}/docs/${a.slug}`} className="group grid min-h-14 gap-0.5 py-3">
                        <span className="flex items-center justify-between gap-3 text-[15px] font-medium">
                          {t(`site.docs.articles.${a.id}.title`)}
                          <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" aria-hidden />
                        </span>
                        <span className="text-[13px] leading-relaxed text-muted-foreground">{t(`site.docs.articles.${a.id}.summary`)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        <Link href={`/${locale}/help`} className="group flex items-center justify-between gap-4 rounded-3xl border border-dashed p-6 hover:bg-muted/40">
          <span className="grid gap-1">
            <span className="text-[15px] font-medium">{t("site.docs.helpTitle")}</span>
            <span className="text-[13.5px] text-muted-foreground">{t("site.docs.helpBody")}</span>
          </span>
          <ArrowRight className="size-5 shrink-0 rtl:-scale-x-100" aria-hidden />
        </Link>
      </SiteContainer>
    </World>
  );
}
