import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { World } from "@/components/ui/world";
import { WorldIllustration } from "@/components/graphics/illustrations";
import { SiteContainer, SiteHeading } from "@/components/site/section";
import { siteMetadata } from "@/components/site/meta";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { BLOG_POSTS } from "@/server/modules/site/content";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getT(locale);
  return siteMetadata({ locale, path: "/blog", title: t("site.blog.title"), description: t("site.blog.lede") });
}

/** The Realy journal: product essays written by the team (content in-repo, translated with the site). */
export default async function BlogIndex() {
  const locale = await getLocale();
  const t = await getT(locale);
  const [lead, ...rest] = BLOG_POSTS;
  return (
    <World name="command" ambient={false}>
      <SiteContainer className="grid gap-14 pt-14 pb-20 sm:pt-20">
        <SiteHeading as="h1" eyebrow={t("site.blog.eyebrow")} title={t("site.blog.title")} lede={t("site.blog.lede")} />
        {lead ? (
          <World name={lead.world} ambient={false}>
            <Link href={`/${locale}/blog/posts/${lead.slug}`} className="group panel-float grid gap-8 overflow-hidden p-6 sm:p-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-center">
              <div className="grid gap-4">
                <p className="text-[12px] tracking-[0.12em] text-muted-foreground uppercase">
                  <time dateTime={lead.publishedAt}>{formatDate(lead.publishedAt, locale, "UTC", { dateStyle: "long" })}</time> · {t("site.blog.minutes", { count: lead.minutes })}
                </p>
                <h2 className="font-display text-display-xl text-balance">{t(`site.blog.posts.${lead.id}.title`)}</h2>
                <p className="max-w-xl text-[15.5px] leading-relaxed text-muted-foreground">{t(`site.blog.posts.${lead.id}.excerpt`)}</p>
                <span className="inline-flex items-center gap-1.5 text-[14px] font-medium text-primary">
                  {t("site.blog.read")}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" aria-hidden />
                </span>
              </div>
              <WorldIllustration world={lead.world} className="hidden w-full max-w-sm justify-self-end sm:block" />
            </Link>
          </World>
        ) : null}
        <ul className="grid gap-4 md:grid-cols-2">
          {rest.map((p) => (
            <li key={p.slug}>
              <World name={p.world} ambient={false} className="h-full">
                <Link href={`/${locale}/blog/posts/${p.slug}`} className="group grid h-full content-start gap-4 rounded-3xl border bg-surface p-6 transition-colors hover:bg-muted/40 sm:p-8">
                  <WorldIllustration world={p.world} className="h-24 w-full" />
                  <p className="text-[12px] tracking-[0.12em] text-muted-foreground uppercase">
                    <time dateTime={p.publishedAt}>{formatDate(p.publishedAt, locale, "UTC", { dateStyle: "long" })}</time> · {t("site.blog.minutes", { count: p.minutes })}
                  </p>
                  <h2 className="font-display text-display-lg text-balance">{t(`site.blog.posts.${p.id}.title`)}</h2>
                  <p className="text-[14px] leading-relaxed text-muted-foreground">{t(`site.blog.posts.${p.id}.excerpt`)}</p>
                </Link>
              </World>
            </li>
          ))}
        </ul>
      </SiteContainer>
    </World>
  );
}
