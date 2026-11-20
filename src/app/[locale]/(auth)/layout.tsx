import Link from "next/link";
import { CircleCheck, Lock, ShieldCheck } from "lucide-react";
import { BrandMark, ControlMark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { AiCore } from "@/components/motion/ai-core";
import { Aurora } from "@/components/motion/aurora";
import { LiveDot } from "@/components/motion/live-dot";
import { getLocale, getT } from "@/i18n/server";

/**
 * Split-screen auth shell. Start column: the animated AI core and the product promise; end column: the form card.
 * Both hero variants are rendered; a page that contains `data-surface="admin"` (the admin login) switches the shell
 * to the dark "Realy Control" look through CSS (:has) — see globals.css "Auth screens".
 */
export default async function AuthLayout({ children }: LayoutProps<"/[locale]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const userValues = [t("authHero.value1"), t("authHero.value2"), t("authHero.value3")];
  const adminValues = [t("authHero.adminValue1"), t("authHero.adminValue2"), t("authHero.adminValue3")];
  return (
    <div className="auth-shell relative isolate grid min-h-dvh bg-background text-foreground lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <Aurora />

      {/* Hero (desktop) */}
      <aside className="relative z-10 hidden min-h-dvh flex-col justify-between gap-10 overflow-hidden border-e bg-surface/40 p-10 lg:flex xl:p-14">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_30%_35%,var(--glow),transparent_70%)] opacity-40"
        />

        <div className="auth-variant-user">
          <Link href={`/${locale}`} className="relative flex w-fit items-center gap-2.5 text-[17px] font-semibold tracking-[-0.02em]">
            <BrandMark className="size-7" />
            {t("common.appName")}
          </Link>
          <div className="relative grid max-w-lg gap-8">
            <AiCore className="size-60 animate-fade-in xl:size-72" />
            <div className="grid gap-4">
              <span className="inline-flex w-fit items-center gap-2 rounded-full border bg-surface/60 px-3 py-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                <LiveDot tone="primary" />
                {t("authHero.eyebrow")}
              </span>
              <h2 className="text-gradient animate-fade-up text-3xl leading-[1.1] font-semibold tracking-[-0.03em] xl:text-4xl">{t("common.promise")}</h2>
            </div>
            <ul className="stagger grid gap-3">
              {userValues.map((v) => (
                <li key={v} className="flex items-start gap-3 text-sm">
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span>{v}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="relative text-xs text-muted-foreground">{t("common.tagline")}</p>
        </div>

        <div className="auth-variant-admin">
          <span className="relative flex w-fit items-center gap-2.5 text-[17px] font-semibold tracking-[-0.02em]">
            <ControlMark className="size-7" />
            {t("authHero.adminTitle")}
          </span>
          <div className="relative grid max-w-lg gap-8">
            <AiCore className="size-60 xl:size-72" />
            <div className="grid gap-4">
              <span className="inline-flex w-fit items-center gap-2 rounded-full border bg-surface/60 px-3 py-1 font-mono text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                <LiveDot tone="success" />
                {t("authHero.adminEyebrow")}
              </span>
              <h2 className="text-3xl leading-[1.1] font-semibold tracking-[-0.03em] xl:text-4xl">{t("authHero.adminPromise")}</h2>
            </div>
            <ul className="stagger grid gap-3">
              {adminValues.map((v) => (
                <li key={v} className="flex items-start gap-3 text-sm">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span>{v}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="relative inline-flex w-fit items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden />
            {t("authHero.secureConnection")}
          </p>
        </div>
      </aside>

      {/* Form column */}
      <div className="relative z-10 flex min-h-dvh flex-col">
        <header className="flex items-center justify-between gap-4 px-6 py-5">
          <span className="lg:invisible">
            <span className="auth-variant-user">
              <Link href={`/${locale}`} className="flex items-center gap-2 font-semibold tracking-[-0.02em]">
                <BrandMark />
                <span>{t("common.appName")}</span>
              </Link>
            </span>
            <span className="auth-variant-admin">
              <span className="flex items-center gap-2 font-semibold tracking-[-0.02em]">
                <ControlMark />
                <span>{t("authHero.adminTitle")}</span>
              </span>
            </span>
          </span>
          <LanguageSwitcher />
        </header>
        <main className="flex flex-1 items-start justify-center px-4 pt-[6vh] pb-16 lg:items-center lg:pt-0">
          <div className="w-full max-w-md animate-fade-up rounded-xl border glass-strong p-6 shadow-elev-3 sm:p-8">{children}</div>
        </main>
        <footer className="px-6 py-4 text-xs text-muted-foreground lg:hidden">{t("common.tagline")}</footer>
      </div>
    </div>
  );
}
