import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { World } from "@/components/ui/world";
import { WorldIllustration } from "@/components/graphics/illustrations";
import { SiteContainer } from "@/components/site/section";
import { JsonLd } from "@/components/site/json-ld";
import { siteMetadata, siteOrigin } from "@/components/site/meta";
import { getLocale, getT } from "@/i18n/server";
import { DOC_ARTICLES, DOC_CATEGORIES, DOC_SECTIONS, docArticle } from "@/server/modules/site/content";

export async function generateMetadata({ params }: PageProps<"/[locale]/docs/[slug]">): Promise<Metadata> {
  const a = docArticle((await params).slug);
  if (!a) return {};
  const locale = await getLocale();
  const t = await getT(locale);
  return siteMetadata({ locale, path: `/docs/${a.slug}`, title: t(`site.docs.articles.${a.id}.title`), description: t(`site.docs.articles.${a.id}.summary`), type: "article" });
}

/** One documentation article with the full guide index beside it (collapsible above the article on phones). */
export default async function DocArticlePage({ params }: PageProps<"/[locale]/docs/[slug]">) {
  const a = docArticle((await params).slug);
  if (!a) notFound();
  const locale = await getLocale();
  const t = await getT(locale);
  const k = (s: string) => t(`site.docs.articles.${a.id}.${s}`);
  const i = DOC_ARTICLES.findIndex((x) => x.slug === a.slug);
  const next = DOC_ARTICLES[i + 1] ?? null;
  const origin = siteOrigin();
  const index = (
    <nav aria-label={t("site.docs.title")} className="grid gap-5">
      {DOC_CATEGORIES.map((c) => (
        <div key={c} className="grid gap-1">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{t(`site.docs.categories.${c}`)}</p>
          {DOC_ARTICLES.filter((x) => x.category === c).map((x) => (
            <Link
              key={x.slug}
              href={`/${locale}/docs/${x.slug}`}
              aria-current={x.slug === a.slug ? "page" : undefined}
              className="flex min-h-10 items-center rounded-lg px-2.5 text-[13.5px] text-muted-foreground hover:bg-muted/60 hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-foreground"
            >
              {t(`site.docs.articles.${x.id}.title`)}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
  return (
    <World name={a.world} ambient={false}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "TechArticle",
          headline: k("title"),
          description: k("summary"),
          inLanguage: locale,
          publisher: { "@type": "Organization", name: "Realy" },
          mainEntityOfPage: `${origin}/${locale}/docs/${a.slug}`,
        }}
      />
      <SiteContainer className="grid gap-10 pt-10 pb-20 sm:pt-14 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <details className="rounded-2xl border bg-surface p-4 lg:hidden">
            <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-medium">{t("site.docs.allGuides")}</summary>
            <div className="pt-3">{index}</div>
          </details>
          <div className="hidden lg:block">{index}</div>
        </aside>
        <article className="grid max-w-3xl gap-6">
          <Link href={`/${locale}/docs`} className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
            {t("site.docs.title")}
          </Link>
          <p className="eyebrow-rule">{t(`site.docs.categories.${a.category}`)}</p>
          <h1 className="font-display text-display-xl text-balance break-words">{k("title")}</h1>
          <p className="text-[17px] leading-relaxed text-muted-foreground">{k("summary")}</p>
          <WorldIllustration world={a.world} className="h-32 w-full max-w-md" />
          <div className="grid gap-8 border-t pt-8 text-[15.5px] leading-[1.75]">
            {DOC_SECTIONS.map((s, n) => (
              <section key={s} id={`step-${s}`} className="grid scroll-mt-24 gap-2">
                <h2 className="flex items-baseline gap-3 text-[19px] font-semibold tracking-tight">
                  <span className="font-mono text-[12px] text-muted-foreground">{String(n + 1).padStart(2, "0")}</span>
                  {k(`s${s}h`)}
                </h2>
                <p className="text-foreground/85">{k(`s${s}p`)}</p>
              </section>
            ))}
          </div>
          {next ? (
            <Link href={`/${locale}/docs/${next.slug}`} className="group mt-6 flex items-center justify-between gap-4 rounded-2xl border p-5 hover:bg-muted/40">
              <span className="grid gap-0.5">
                <span className="text-[12px] tracking-[0.12em] text-muted-foreground uppercase">{t("site.docs.next")}</span>
                <span className="text-[15px] font-medium">{t(`site.docs.articles.${next.id}.title`)}</span>
              </span>
              <ArrowRight className="size-5 shrink-0 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" aria-hidden />
            </Link>
          ) : null}
        </article>
      </SiteContainer>
    </World>
  );
}
