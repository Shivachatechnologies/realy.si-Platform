import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isAppLocale } from "@/i18n/config";
import { getT } from "@/i18n/server";
import { SiteBlocks } from "@/components/sites/blocks";
import { chromeLabels, formLabels, getPublicPage, getPublicSite, siteAssetUrl } from "@/components/sites/public-data";
import { sitePath } from "@/server/modules/sites/schemas";
import { env } from "@/server/core/env";

const pathOf = (path: string[] | undefined) => (path ?? []).map((s) => decodeURIComponent(s)).join("/").toLowerCase();

export async function generateMetadata({ params }: PageProps<"/s/[siteSlug]/[[...path]]">): Promise<Metadata> {
  const { siteSlug, path } = await params;
  const [site, page] = await Promise.all([getPublicSite(siteSlug), getPublicPage(siteSlug, pathOf(path))]);
  if (!site || !page) return { robots: { index: false } };
  const c = page.content;
  const origin = env().APP_URL.replace(/\/$/, "");
  const og = c.seo.ogImage || site.seo.ogImage;
  const ogUrl = og.startsWith("asset:") ? `${origin}${siteAssetUrl(site)(og.slice(6))}` : null;
  const title = c.seo.title || c.title || site.name;
  const description = c.seo.description || site.seo.description || undefined;
  const url = `${origin}${sitePath(site.slug, page.slug)}`;
  return {
    title: page.slug ? title : { absolute: c.seo.title || site.seo.title || site.name },
    description,
    alternates: { canonical: url },
    robots: c.seo.noIndex || site.seo.noIndex ? { index: false, follow: !site.seo.noIndex } : undefined,
    openGraph: { type: "website", url, title, description, siteName: site.name, locale: site.locale.replace("-", "_"), ...(ogUrl ? { images: [{ url: ogUrl }] } : {}) },
    twitter: { card: ogUrl ? "summary_large_image" : "summary", title, description, ...(ogUrl ? { images: [ogUrl] } : {}) },
  };
}

/** A published page of a company website: server-rendered from the cached live snapshot (React elements only). */
export default async function SitePage({ params }: PageProps<"/s/[siteSlug]/[[...path]]">) {
  const { siteSlug, path } = await params;
  const [site, page] = await Promise.all([getPublicSite(siteSlug), getPublicPage(siteSlug, pathOf(path))]);
  if (!site || !page) notFound();
  const t = await getT(isAppLocale(site.locale) ? site.locale : "en-US");
  return (
    <SiteBlocks
      content={page.content}
      r={{ base: sitePath(site.slug), theme: site.theme, assetUrl: siteAssetUrl(site), products: page.products, customers: page.customers, mode: "live", form: { siteSlug: site.slug, pageId: page.id, labels: formLabels(t) }, labels: chromeLabels(t) }}
    />
  );
}
