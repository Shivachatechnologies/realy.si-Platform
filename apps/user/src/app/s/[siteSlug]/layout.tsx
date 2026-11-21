import type { Metadata, Viewport } from "next";
import { Geist_Mono, IBM_Plex_Sans_Arabic, Inter, Noto_Sans_Devanagari, Sora } from "next/font/google";
import { connection } from "next/server";
import { directionOf, isAppLocale } from "@/i18n/config";
import { getT } from "@/i18n/server";
import { SiteFooterView, SiteHeader, themeStyle } from "@/components/sites/blocks";
import { chromeLabels, getPublicSite, siteAssetUrl } from "@/components/sites/public-data";
import { sitePath } from "@/server/modules/sites/schemas";
import { env } from "@/server/core/env";
import "../../globals.css";

/**
 * Root layout of published company websites (/s/<slug>/…): outside [locale] so URLs stay clean, its own <html> in the
 * site's language, the company's theme and no app chrome. Offline sites and unknown slugs are 404.
 */
const inter = Inter({ variable: "--font-inter", subsets: ["latin", "latin-ext"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Sora({ variable: "--font-sora", subsets: ["latin", "latin-ext"], weight: ["400", "600", "700", "800"], display: "swap" });
const arabic = IBM_Plex_Sans_Arabic({ variable: "--font-arabic", subsets: ["arabic"], weight: ["400", "500", "600"] });
const devanagari = Noto_Sans_Devanagari({ variable: "--font-devanagari", subsets: ["devanagari"], weight: ["400", "500", "600"] });

export const viewport: Viewport = { themeColor: "#ffffff", colorScheme: "light" };

export async function generateMetadata({ params }: LayoutProps<"/s/[siteSlug]">): Promise<Metadata> {
  const { siteSlug } = await params;
  const site = await getPublicSite(siteSlug);
  if (!site) return { robots: { index: false } };
  const origin = env().APP_URL.replace(/\/$/, "");
  const logo = site.theme.logoAssetId ? siteAssetUrl(site)(site.theme.logoAssetId) : null;
  return {
    metadataBase: new URL(origin),
    title: { default: site.seo.title || site.name, template: `%s · ${site.name}` },
    description: site.seo.description || undefined,
    applicationName: site.name,
    robots: site.seo.noIndex ? { index: false, follow: false } : undefined,
    icons: logo ? { icon: logo } : undefined,
    alternates: { canonical: `${origin}${sitePath(site.slug)}` },
  };
}

export default async function SiteLayout({ children, params }: LayoutProps<"/s/[siteSlug]">) {
  // Render per request: required for the per-request CSP nonce (data comes from the cache).
  await connection();
  const { siteSlug } = await params;
  const site = await getPublicSite(siteSlug);
  // Unknown / offline site: a bare document; the page itself answers 404 (not-found.tsx renders inside this layout).
  if (!site)
    return (
      <html lang="en" className={inter.variable}>
        <body className="min-h-screen bg-white font-[family-name:var(--font-inter)] text-slate-900 antialiased">{children}</body>
      </html>
    );
  const locale = isAppLocale(site.locale) ? site.locale : "en-US";
  const t = await getT(locale);
  const r = { base: sitePath(site.slug), theme: site.theme, assetUrl: siteAssetUrl(site), products: {}, customers: {}, mode: "live" as const, labels: chromeLabels(t) };
  const logo = site.theme.logoAssetId ? r.assetUrl(site.theme.logoAssetId) : null;
  return (
    <html lang={locale} dir={directionOf(locale)} className={`${inter.variable} ${geistMono.variable} ${display.variable} ${arabic.variable} ${devanagari.variable}`}>
      <body className="min-h-screen bg-white text-[15px] text-slate-900 antialiased" style={themeStyle(site.theme)} data-site={site.slug}>
        <a href="#site-main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow">
          {t("sites.public.skip")}
        </a>
        {/* Blocks use container queries, so the editor's mobile preview and the live site lay out identically. */}
        <div className="@container min-h-screen">
          <SiteHeader name={site.name} nav={site.nav} r={r} logoUrl={logo} />
          <div id="site-main">{children}</div>
          <SiteFooterView name={site.name} footer={site.footer} r={r} />
        </div>
      </body>
    </html>
  );
}
