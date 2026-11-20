import Link from "next/link";
import { BrandMark, BrandName } from "@/components/brand";
import { getT } from "@/i18n/server";
import { SITE_DEPARTMENTS } from "@/server/modules/site/content";

/** Public site footer: product map, resources and a plain statement of what the platform is. */
export async function SiteFooter({ locale }: { locale: string }) {
  const t = await getT();
  const col = (title: string, links: { href: string; label: string }[]) => (
    <div className="grid content-start gap-1">
      <p className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{title}</p>
      {links.map((l) => (
        <Link key={l.href} href={`/${locale}${l.href}`} className="flex min-h-9 items-center text-[13.5px] text-foreground/80 transition-colors hover:text-foreground">
          {l.label}
        </Link>
      ))}
    </div>
  );
  return (
    <footer className="relative border-t pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-14 sm:px-6 lg:grid-cols-[1.2fr_2fr]">
        <div className="grid content-start gap-4">
          <Link href={`/${locale}`} className="flex items-center gap-2 font-semibold tracking-[-0.02em]">
            <BrandMark className="size-7" />
            <BrandName className="text-[19px]" />
          </Link>
          <p className="max-w-xs font-display text-[1.6rem] leading-[1.1] text-balance">{t("site.footer.tagline")}</p>
          <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">{t("site.footer.statement")}</p>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {col(t("site.footer.platform"), [
            { href: "/platform", label: t("site.nav.platform") },
            { href: "/ai-workforce", label: t("site.nav.workforce") },
            { href: "/pricing", label: t("site.nav.pricing") },
            { href: "/waitlist", label: t("site.nav.waitlist") },
          ])}
          {col(
            t("site.footer.departments"),
            SITE_DEPARTMENTS.slice(0, 5).map((d) => ({ href: `/platform/${d.key}`, label: t(`site.departments.${d.key}.name`) })),
          )}
          {col(
            t("site.footer.more"),
            SITE_DEPARTMENTS.slice(5).map((d) => ({ href: `/platform/${d.key}`, label: t(`site.departments.${d.key}.name`) })),
          )}
          {col(t("site.footer.resources"), [
            { href: "/docs", label: t("site.nav.docs") },
            { href: "/help", label: t("site.nav.help") },
            { href: "/blog", label: t("site.nav.blog") },
            { href: "/sign-in", label: t("site.nav.signIn") },
          ])}
        </div>
      </div>
      <div className="mx-auto mt-12 flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 border-t px-4 pt-6 text-xs text-muted-foreground sm:px-6">
        <span>{t("site.footer.copyright", { year: new Date().getFullYear() })}</span>
        <span>{t("site.footer.languages")}</span>
      </div>
    </footer>
  );
}
