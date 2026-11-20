import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, IBM_Plex_Sans_Arabic, Instrument_Serif, Noto_Sans_Devanagari } from "next/font/google";
import { connection } from "next/server";
import { directionOf, type AppLocale } from "@/i18n/config";
import { getLocale, getMessages, getT } from "@/i18n/server";
import { I18nProvider } from "@/i18n/client";
import { Providers } from "@/components/providers";
import "../globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
/** Editorial display face (hero titles, scene headlines, big numerals) — Latin only; other scripts fall back to the locale font. */
const display = Instrument_Serif({ variable: "--font-instrument", subsets: ["latin"], weight: "400", style: ["normal", "italic"], display: "swap" });
const arabic = IBM_Plex_Sans_Arabic({ variable: "--font-arabic", subsets: ["arabic"], weight: ["400", "500", "600"] });
const devanagari = Noto_Sans_Devanagari({ variable: "--font-devanagari", subsets: ["devanagari"], weight: ["400", "500", "600"] });

/** Script-specific primary font per locale; Latin text inside falls back to Geist. CJK uses system fonts. */
const LOCALE_FONT: Partial<Record<AppLocale, string>> = {
  "ar-AE": "var(--font-arabic), var(--font-geist-sans)",
  "hi-IN": "var(--font-devanagari), var(--font-geist-sans)",
  "zh-CN": "var(--font-geist-sans), 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei'",
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: { default: t("meta.title"), template: `%s · ${t("meta.title")}` }, description: t("meta.description") };
}

export const viewport: Viewport = {
  // Edge-to-edge on notched phones: the shell pads itself with env(safe-area-inset-*).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafb" },
    { media: "(prefers-color-scheme: dark)", color: "#16171c" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/[locale]">) {
  // Render per request: required for the per-request CSP nonce (see next.config.ts).
  await connection();
  const locale = await getLocale();
  const messages = await getMessages(locale);
  const font = LOCALE_FONT[locale];
  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} ${arabic.variable} ${devanagari.variable} h-full`}
      style={font ? ({ "--font-locale": font } as React.CSSProperties) : undefined}
    >
      <body className="min-h-full bg-background font-sans text-sm text-foreground antialiased" data-surface="app">
        <I18nProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </I18nProvider>
      </body>
    </html>
  );
}
