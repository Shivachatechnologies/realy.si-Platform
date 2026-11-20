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
import { formatDate } from "@/i18n/format";
import { BLOG_POSTS, BLOG_SECTIONS, blogPost } from "@/server/modules/site/content";

export async function generateMetadata({ params }: PageProps<"/[locale]/blog/posts/[slug]">): Promise<Metadata> {
  const post = blogPost((await params).slug);
  if (!post) return {};
  const locale = await getLocale();
  const t = await getT(locale);
  return siteMetadata({ locale, path: `/blog/posts/${post.slug}`, title: t(`site.blog.posts.${post.id}.title`), description: t(`site.blog.posts.${post.id}.excerpt`), type: "article", publishedTime: post.publishedAt });
}

export default async function BlogPostPage({ params }: PageProps<"/[locale]/blog/posts/[slug]">) {
  const post = blogPost((await params).slug);
  if (!post) notFound();
  const locale = await getLocale();
  const t = await getT(locale);
  const k = (s: string) => t(`site.blog.posts.${post.id}.${s}`);
  const others = BLOG_POSTS.filter((p) => p.slug !== post.slug);
  const origin = siteOrigin();
  return (
    <World name={post.world}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: k("title"),
          description: k("excerpt"),
          datePublished: post.publishedAt,
          inLanguage: locale,
          author: { "@type": "Organization", name: "Realy" },
          publisher: { "@type": "Organization", name: "Realy" },
          mainEntityOfPage: `${origin}/${locale}/blog/posts/${post.slug}`,
        }}
      />
      <article>
        <SiteContainer className="grid max-w-3xl gap-6 pt-10 pb-10 sm:pt-16">
          <Link href={`/${locale}/blog`} className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
            {t("site.blog.title")}
          </Link>
          <p className="text-[12px] tracking-[0.12em] text-muted-foreground uppercase">
            <time dateTime={post.publishedAt}>{formatDate(post.publishedAt, locale, "UTC", { dateStyle: "long" })}</time> · {t("site.blog.minutes", { count: post.minutes })}
          </p>
          <h1 className="font-display text-display-xl text-balance break-words">{k("title")}</h1>
          <p className="text-[18px] leading-relaxed text-muted-foreground">{k("excerpt")}</p>
          <WorldIllustration world={post.world} className="my-4 h-40 w-full sm:h-56" />
        </SiteContainer>
        <SiteContainer className="max-w-3xl pb-16">
          <div className="grid gap-6 text-[16.5px] leading-[1.75]">
            <p className="first-letter:float-start first-letter:me-2 first-letter:font-display first-letter:text-[3.6rem] first-letter:leading-[0.9]">{k("intro")}</p>
            {BLOG_SECTIONS.map((s) => (
              <section key={s} className="grid gap-3">
                <h2 className="mt-4 font-display text-display-lg">{k(`h${s}`)}</h2>
                <p>{k(`p${s}`)}</p>
              </section>
            ))}
          </div>
        </SiteContainer>
      </article>
      <section className="border-t py-14">
        <SiteContainer className="grid max-w-3xl gap-4">
          <p className="text-[12px] tracking-[0.12em] text-muted-foreground uppercase">{t("site.blog.more")}</p>
          {others.map((p) => (
            <Link key={p.slug} href={`/${locale}/blog/posts/${p.slug}`} className="group flex min-h-14 items-center justify-between gap-4 border-b py-3">
              <span className="font-display text-[1.4rem] leading-tight">{t(`site.blog.posts.${p.id}.title`)}</span>
              <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 rtl:-scale-x-100" aria-hidden />
            </Link>
          ))}
        </SiteContainer>
      </section>
    </World>
  );
}
