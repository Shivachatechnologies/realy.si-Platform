import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getLocale, getT } from "@/i18n/server";

export default async function AuthLayout({ children }: LayoutProps<"/[locale]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <Link href={`/${locale}`} className="flex items-center gap-2 font-semibold tracking-tight">
          <BrandMark />
          <span>{t("common.appName")}</span>
        </Link>
        <LanguageSwitcher />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
      <footer className="px-6 py-4 text-xs text-muted-foreground">{t("common.tagline")}</footer>
    </div>
  );
}
