import type { Metadata } from "next";
import { LOCALES } from "@/i18n/config";
import { env } from "@/server/core/env";

/** Absolute origin of the public site (APP_URL). */
export const siteOrigin = () => env().APP_URL.replace(/\/$/, "");

/**
 * Metadata for a public page: canonical URL, hreflang alternates for all five locales, OpenGraph and Twitter cards.
 * `path` is the page path after /{locale} ("" for the homepage).
 */
export function siteMetadata({ locale, path, title, description, type = "website", publishedTime }: { locale: string; path: string; title: string; description: string; type?: "website" | "article"; publishedTime?: string }): Metadata {
  const origin = siteOrigin();
  const url = `${origin}/${locale}${path}`;
  const image = `${origin}/${locale}/home/opengraph-image`;
  return {
    title,
    description,
    metadataBase: new URL(origin),
    alternates: {
      canonical: url,
      languages: { ...Object.fromEntries(LOCALES.map((l) => [l, `${origin}/${l}${path}`])), "x-default": `${origin}/en-US${path}` },
    },
    openGraph: {
      type,
      url,
      title,
      description,
      siteName: "Realy",
      locale: locale.replace("-", "_"),
      images: [{ url: image, width: 1200, height: 630, alt: title }],
      ...(publishedTime ? { publishedTime } : {}),
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    robots: { index: true, follow: true },
  };
}
