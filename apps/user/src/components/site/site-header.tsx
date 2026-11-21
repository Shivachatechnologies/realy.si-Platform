"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import { BrandMark, BrandName } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/platform", label: "site.nav.platform" },
  { href: "/ai-workforce", label: "site.nav.workforce" },
  { href: "/pricing", label: "site.nav.pricing" },
  { href: "/docs", label: "site.nav.docs" },
  { href: "/blog", label: "site.nav.blog" },
] as const;

/** Public site header: sticky glass bar, condensed after scrolling; full-screen menu on phones. */
export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isActive = (href: string) => pathname === `/${locale}${href}` || pathname.startsWith(`/${locale}${href}/`);
  const primary = signedIn ? { href: `/${locale}`, label: t("site.nav.openApp") } : { href: `/${locale}/sign-up`, label: t("site.nav.start") };

  return (
    <>
    <header
      className={cn(
        "sticky top-0 z-40 pt-[env(safe-area-inset-top)] transition-[background-color,box-shadow,border-color] duration-300",
        scrolled || open ? "glass border-b shadow-elev-1" : "border-b border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href={`/${locale}`} className="flex min-h-11 items-center gap-2 font-semibold tracking-[-0.02em]" onClick={() => setOpen(false)}>
          <BrandMark className="size-7" />
          <BrandName className="text-[19px]" />
        </Link>
        <nav aria-label={t("site.nav.label")} className="ms-6 hidden items-center gap-1 lg:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={`/${locale}${l.href}`}
              aria-current={isActive(l.href) ? "page" : undefined}
              className={cn(
                "rounded-full px-3.5 py-2 text-[13.5px] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground",
                isActive(l.href) && "bg-muted/70 font-medium text-foreground",
              )}
            >
              {t(l.label)}
            </Link>
          ))}
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <LanguageSwitcher className="hidden md:inline-flex" />
          {signedIn ? null : (
            <Link href={`/${locale}/sign-in`} className="hidden min-h-11 items-center rounded-full px-3.5 text-[13.5px] text-muted-foreground hover:text-foreground sm:inline-flex">
              {t("site.nav.signIn")}
            </Link>
          )}
          <Link
            href={primary.href}
            className="jv-cta press hidden min-h-10 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-medium transition-transform hover:scale-[1.02] sm:inline-flex"
          >
            {primary.label}
            <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </Link>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? t("site.nav.closeMenu") : t("site.nav.openMenu")}
            className="grid size-11 place-items-center rounded-full text-foreground hover:bg-muted lg:hidden"
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </div>
    </header>

      {/* Outside the header: its backdrop-filter would otherwise become the containing block of this fixed panel. */}
      <div
        id="site-menu"
        inert={!open}
        className={cn(
          "fixed inset-x-0 top-[calc(4rem+env(safe-area-inset-top))] bottom-0 z-30 overflow-y-auto bg-background/97 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] backdrop-blur-xl transition-[opacity,transform] duration-300 motion-reduce:transition-none lg:hidden",
          open ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0",
        )}
      >
        <nav aria-label={t("site.nav.label")} className="mx-auto grid max-w-md gap-1 pt-6">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={`/${locale}${l.href}`}
              onClick={() => setOpen(false)}
              aria-current={isActive(l.href) ? "page" : undefined}
              className="flex min-h-14 items-center justify-between border-b font-display text-[1.75rem] leading-none"
            >
              {t(l.label)}
              <ArrowRight className="size-5 text-muted-foreground rtl:-scale-x-100" aria-hidden />
            </Link>
          ))}
          <Link href={`/${locale}/help`} onClick={() => setOpen(false)} className="flex min-h-12 items-center text-muted-foreground">
            {t("site.nav.help")}
          </Link>
          <div className="mt-6 grid gap-2">
            <Link href={primary.href} onClick={() => setOpen(false)} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-foreground font-medium text-background">
              {primary.label}
              <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </Link>
            {signedIn ? null : (
              <Link href={`/${locale}/sign-in`} onClick={() => setOpen(false)} className="flex min-h-12 items-center justify-center rounded-full border font-medium">
                {t("site.nav.signIn")}
              </Link>
            )}
            <Link href={`/${locale}/waitlist`} onClick={() => setOpen(false)} className="flex min-h-12 items-center justify-center text-sm text-muted-foreground">
              {t("site.nav.waitlist")}
            </Link>
          </div>
          <div className="mt-4 flex min-h-12 items-center justify-center">
            <LanguageSwitcher className="text-sm [&_select]:min-h-11 [&_select]:text-sm" />
          </div>
        </nav>
      </div>
    </>
  );
}
