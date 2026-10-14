"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand";
import { ADMIN_NAV, NAV, type NavItem } from "./nav";

/** Link with active state. `pathname` null = unknown (static shell), rendered without highlighting. */
function NavLinkBase({ item, onNavigate, pathname }: { item: NavItem; onNavigate?: () => void; pathname: string | null }) {
  const { t, locale } = useI18n();
  const href = `/${locale}${item.href}`;
  const active = pathname !== null && (item.href === "" ? pathname === `/${locale}` : pathname === href || pathname.startsWith(`${href}/`));
  const Icon = item.icon;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active && "bg-muted font-medium text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden />
      <span className="truncate">{t(item.label)}</span>
      {item.phase ? (
        <span className="ms-auto font-mono text-[10px] text-muted-foreground/70" title={t("common.comingInPhase", { phase: item.phase })}>
          {t("nav.phaseShort", { phase: item.phase })}
        </span>
      ) : null}
    </Link>
  );
}

function NavLinkWithPath(props: { item: NavItem; onNavigate?: () => void }) {
  return <NavLinkBase {...props} pathname={usePathname()} />;
}

/** The pathname is request data on dynamic routes, so it streams in behind Suspense; the shell renders without highlight. */
export function NavLink(props: { item: NavItem; onNavigate?: () => void }) {
  return (
    <Suspense fallback={<NavLinkBase {...props} pathname={null} />}>
      <NavLinkWithPath {...props} />
    </Suspense>
  );
}

export function Sidebar({ adminSlot, onNavigate }: { adminSlot?: ReactNode; onNavigate?: () => void }) {
  const { t, locale } = useI18n();
  return (
    <nav aria-label={t("nav.commandCenter")} className="flex h-full flex-col gap-4 overflow-y-auto px-3 py-3">
      <Link href={`/${locale}`} className="flex items-center gap-2 px-2 py-1 font-semibold tracking-tight" onClick={onNavigate}>
        <BrandMark className="size-5" />
        <span>{t("common.appName")}</span>
      </Link>
      {NAV.map((section, i) => (
        <div key={section.label ?? i} className="grid gap-0.5">
          {section.label ? (
            <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">{t(section.label)}</div>
          ) : null}
          {section.items.map((item) => (
            <NavLink key={item.href} item={item} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
      {adminSlot ? <div className="mt-auto grid gap-0.5 border-t pt-3">{adminSlot}</div> : null}
    </nav>
  );
}

/** Admin entry; rendered by the server only for platform principals. Owns its (non-serializable) icon. */
export function AdminNavLink() {
  return <NavLink item={ADMIN_NAV} />;
}
