import Link from "next/link";
import { CircleCheck, Lock, ShieldCheck } from "lucide-react";
import { BrandMark, BrandName, ControlMark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Aurora } from "@/components/motion/aurora";
import { AiCoreStage } from "@/components/graphics/ai-core-stage";
import { ParticleField } from "@/components/graphics/particle-field";
import { LiveDot } from "@/components/motion/live-dot";
import { getLocale, getT } from "@/i18n/server";

/**
 * Cinematic split-screen auth shell (Design DNA v2). Start column: a full-height scene — ambient particle field, the
 * procedural 3D intelligence core (client-only, SVG fallback under reduced motion / no WebGL) and the editorial
 * promise; end column: the frosted form card.
 * Both hero variants are rendered; a page that contains `data-surface="admin"` (the admin login) switches the shell
 * to the dark "Realy Control" look through CSS (:has) — see globals.css "Auth screens".
 */
export default async function AuthLayout({ children }: LayoutProps<"/[locale]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const userValues = [t("authHero.value1"), t("authHero.value2"), t("authHero.value3")];
  const adminValues = [t("authHero.adminValue1"), t("authHero.adminValue2"), t("authHero.adminValue3")];
  return (
    <div data-world="command" className="auth-shell relative isolate grid min-h-dvh bg-background text-foreground lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <Aurora />

      {/* Hero (desktop) */}
      <aside className="grain relative z-10 hidden min-h-dvh flex-col justify-between gap-10 overflow-hidden border-e bg-surface/30 p-10 lg:flex xl:p-14">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_45%_45%,var(--glow),transparent_70%)] opacity-50" />
        <div aria-hidden className="absolute inset-0 opacity-80">
          <ParticleField density={0.55} intensity={0.3} />
        </div>
        {/* The core is decorative; idle activity (no company data before sign-in). */}
        <AiCoreStage activity={0.25} nodes={9} className="pointer-events-none absolute -end-[18%] top-1/2 aspect-square w-[95%] -translate-y-1/2 opacity-95 xl:-end-[10%] xl:w-[85%]" />

        <div className="auth-variant-user">
          <Link href={`/${locale}`} className="relative flex w-fit items-center gap-2.5 text-[17px] font-semibold tracking-[-0.02em]">
            <BrandMark className="size-7" />
            <BrandName className="text-[19px]" />
          </Link>
          <div className="relative grid max-w-md gap-8">
            <div className="grid gap-5">
              <span className="glass inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                <LiveDot tone="primary" />
                {t("authHero.eyebrow")}
              </span>
              <h2 className="text-world animate-fade-up font-display text-hero text-balance">{t("common.promise")}</h2>
            </div>
            <ul className="stagger grid gap-2.5">
              {userValues.map((v) => (
                <li key={v} className="glass flex w-fit items-start gap-3 rounded-xl border px-3 py-2 text-sm">
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
          <div className="relative grid max-w-md gap-8">
            <div className="grid gap-4">
              <span className="inline-flex w-fit items-center gap-2 rounded-full border bg-surface/60 px-3 py-1 font-mono text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                <LiveDot tone="success" />
                {t("authHero.adminEyebrow")}
              </span>
              <h2 className="font-display text-display-xl text-balance">{t("authHero.adminPromise")}</h2>
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
                <BrandName />
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
          <div className="panel-float w-full max-w-md animate-fade-up p-6 sm:p-8">{children}</div>
        </main>
        <footer className="px-6 py-4 text-xs text-muted-foreground lg:hidden">{t("common.tagline")}</footer>
      </div>
    </div>
  );
}
