import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CmsPage } from "@/components/cms/cms-page";
import { PlatformBanner } from "@/components/cms/platform-banner";
import { siteMetadata } from "@/components/site/meta";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { getPublishedPage } from "@/server/modules/cms/public";

/** Public CMS page (Admin → Content): published snapshots only, cached ~1 minute, rendered without raw HTML. */
export async function generateMetadata({ params }: PageProps<"/[locale]/pages/[slug]">): Promise<Metadata> {
  const locale = await getLocale();
  const { slug } = await params;
  const page = await getPublishedPage(slug, locale);
  if (!page) return {};
  const v = page.variant;
  const meta = siteMetadata({
    locale,
    path: `/pages/${page.slug}`,
    title: v.seoTitle || v.title,
    description: v.seoDescription || v.summary,
    type: page.kind === "POST" ? "article" : "website",
    publishedTime: page.kind === "POST" ? (page.publishedAt ?? undefined) : undefined,
  });
  const og = v.ogImage ? (v.ogImage.startsWith("media:") ? page.media[v.ogImage] : v.ogImage) : null;
  return {
    ...meta,
    ...(og ? { openGraph: { ...meta.openGraph, images: [{ url: og, alt: v.title }] }, twitter: { ...meta.twitter, images: [og] } } : {}),
    ...(v.noIndex ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function CmsPublicPage({ params }: PageProps<"/[locale]/pages/[slug]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { slug } = await params;
  const page = await getPublishedPage(slug, locale);
  if (!page) notFound();
  return (
    <>
      <PlatformBanner />
      <CmsPage
        variant={page.variant}
        media={page.media}
        locale={page.locale}
        isPost={page.kind === "POST"}
        publishedLabel={page.kind === "POST" && page.publishedAt ? t("cms.publishedOn", { date: formatDate(page.publishedAt, locale, "UTC", { dateStyle: "long" }) }) : undefined}
      />
    </>
  );
}
