import { Lock, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LiveDot } from "@/components/motion/live-dot";
import { getLocale, getT } from "@/i18n/server";
import { ClientMessages } from "@/components/i18n/client-messages";

/** Control Center sign-in shell: a quiet two-column console screen (no product marketing, no sign-up). */
export default async function AdminAuthLayout({ children }: LayoutProps<"/[locale]">) {
  const t = await getT(await getLocale());
  const values = [t("authHero.adminValue1"), t("authHero.adminValue2"), t("authHero.adminValue3")];
  return (
    <ClientMessages scope="[locale]/(auth)">
      <div className="control-grid grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <aside className="hidden flex-col justify-between border-e bg-surface/60 p-10 lg:flex">
          <span className="flex w-fit items-center gap-2 text-sm font-semibold tracking-tight">
            <BrandMark tone="tile" className="size-6" />
            {t("authHero.adminTitle")}
          </span>
          <div className="grid max-w-md gap-6">
            <span className="inline-flex w-fit items-center gap-2 rounded-sm border bg-surface px-2 py-0.5 font-mono text-[11px] tracking-[0.08em] text-muted-foreground uppercase">
              <LiveDot tone="success" />
              {t("authHero.adminEyebrow")}
            </span>
            <h2 className="text-2xl font-semibold tracking-tight text-balance">{t("authHero.adminPromise")}</h2>
            <ul className="grid gap-2.5">
              {values.map((v) => (
                <li key={v} className="flex items-start gap-2.5">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span>{v}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="inline-flex w-fit items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden />
            {t("authHero.secureConnection")}
          </p>
        </aside>
        <div className="flex min-h-dvh flex-col bg-background">
          <header className="flex items-center justify-between gap-4 px-6 py-4">
            <span className="flex items-center gap-2 font-semibold tracking-tight lg:invisible">
              <BrandMark tone="tile" />
              {t("authHero.adminTitle")}
            </span>
            <LanguageSwitcher />
          </header>
          <main className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-16 lg:items-center lg:pt-0">
            <div className="w-full max-w-sm rounded-md border bg-surface p-6 shadow-elev-2">{children}</div>
          </main>
        </div>
      </div>
    </ClientMessages>
  );
}
