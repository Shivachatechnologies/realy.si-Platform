import type { Metadata, Viewport } from "next";
import { Geist_Mono, IBM_Plex_Sans_Arabic, Inter, Noto_Sans_Devanagari, Sora } from "next/font/google";
import { connection } from "next/server";
import { directionOf, type AppLocale } from "@/i18n/config";
import { getClientMessages, getLocale, getT, LAZY_UNITS } from "@/i18n/server";
import { I18nProvider } from "@/i18n/client";
import { Providers } from "@/components/providers";
import "../globals.css";

/** Brand typography (Realy brand guidelines v1.0): Inter for body and UI, Sora for display and the wordmark. */
const inter = Inter({ variable: "--font-inter", subsets: ["latin", "latin-ext"], display: "swap" });
const display = Sora({ variable: "--font-sora", subsets: ["latin", "latin-ext"], weight: ["400", "600", "700", "800"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
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
  return {
    title: { default: t("authHero.adminTitle"), template: `%s · ${t("authHero.adminTitle")}` },
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

/** Control Center root layout (apps/admin): its own dense enterprise theme (src/app/globals.css), no marketing chrome. */
export default async function AdminRootLayout({ children }: LayoutProps<"/[locale]">) {
  // Render per request: required for the per-request CSP nonce and the console gate.
  await connection();
  const locale = await getLocale();
  // Only the namespaces this layout's own client components use; route groups add theirs (<ClientMessages>).
  const messages = await getClientMessages("[locale]", locale);
  const font = LOCALE_FONT[locale];
  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      className={`${inter.variable} ${display.variable} ${geistMono.variable} ${arabic.variable} ${devanagari.variable} h-full`}
      style={font ? ({ "--font-locale": font } as React.CSSProperties) : undefined}
    >
      <body className="min-h-full bg-background font-sans text-[13px] text-foreground antialiased" data-surface="admin">
        <I18nProvider locale={locale} messages={messages} lazy={LAZY_UNITS}>
          <Providers>{children}</Providers>
        </I18nProvider>
      </body>
    </html>
  );
}
