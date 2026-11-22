import type { Metadata, Viewport } from "next";
import { Geist_Mono, IBM_Plex_Sans_Arabic, Inter, Noto_Sans_Devanagari, Sora } from "next/font/google";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { directionOf, type AppLocale } from "@/i18n/config";
import { getClientMessages, getLocale, getT, LAZY_UNITS } from "@/i18n/server";
import { I18nProvider } from "@/i18n/client";
import { Providers } from "@/components/providers";
import { CookieNotice } from "@/components/legal/cookie-notice";
import { parseTheme, THEME_COLOR, THEME_COOKIE, themeAttr } from "@/components/theme/theme";
import "../globals.css";

/** Brand typography (Realy brand guidelines v1.0): Inter for body and UI, Sora for display and the wordmark. */
const inter = Inter({ variable: "--font-inter", subsets: ["latin", "latin-ext"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
/** Display face (headlines, wordmark, big numerals) — Latin only; other scripts fall back to the locale font. */
const display = Sora({ variable: "--font-sora", subsets: ["latin", "latin-ext"], weight: ["400", "600", "700", "800"], display: "swap" });
const arabic = IBM_Plex_Sans_Arabic({ variable: "--font-arabic", subsets: ["arabic"], weight: ["400", "500", "600"] });
const devanagari = Noto_Sans_Devanagari({ variable: "--font-devanagari", subsets: ["devanagari"], weight: ["400", "500", "600"] });

/** Script-specific primary font per locale; Latin text inside falls back to Inter. CJK uses system fonts. */
const LOCALE_FONT: Partial<Record<AppLocale, string>> = {
  "ar-AE": "var(--font-arabic), var(--font-inter)",
  "hi-IN": "var(--font-devanagari), var(--font-inter)",
  "zh-CN": "var(--font-inter), 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei'",
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: { default: t("meta.title"), template: `%s · ${t("meta.title")}` }, description: t("meta.description") };
}

export async function generateViewport(): Promise<Viewport> {
  const attr = themeAttr(parseTheme((await cookies()).get(THEME_COOKIE)?.value));
  return {
    // Edge-to-edge on notched phones: the shell pads itself with env(safe-area-inset-*).
    viewportFit: "cover",
    themeColor: attr
      ? THEME_COLOR[attr]
      : [
          { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
          { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
        ],
  };
}

export default async function RootLayout({ children }: LayoutProps<"/[locale]">) {
  // Render per request: required for the per-request CSP nonce (see next.config.ts).
  await connection();
  const locale = await getLocale();
  // Only the namespaces this layout's own client components use; route groups add theirs (<ClientMessages>).
  const messages = await getClientMessages("[locale]", locale);
  const font = LOCALE_FONT[locale];
  // JARVIS (dark) is the default look; "light" and "system" are opt-in (components/theme/theme-switch.tsx).
  const theme = themeAttr(parseTheme((await cookies()).get(THEME_COOKIE)?.value));
  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      data-theme={theme}
      className={`${inter.variable} ${geistMono.variable} ${display.variable} ${arabic.variable} ${devanagari.variable} h-full`}
      style={font ? ({ "--font-locale": font } as React.CSSProperties) : undefined}
    >
      <body className="min-h-full bg-background font-sans text-sm text-foreground antialiased" data-surface="app">
        <I18nProvider locale={locale} messages={messages} lazy={LAZY_UNITS}>
          <Providers>{children}</Providers>
          {/* Strictly necessary cookies only, so an informational notice — not a consent gate (see the component). */}
          <CookieNotice />
        </I18nProvider>
      </body>
    </html>
  );
}
