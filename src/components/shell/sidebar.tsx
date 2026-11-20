"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, Suspense, useContext, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ADMIN_NAV, NAV, type NavItem } from "./nav";

/** Collapsed (icon-only) rail state, provided by the frame. */
const SidebarState = createContext<{ collapsed: boolean; touch: boolean }>({ collapsed: false, touch: false });
export const useSidebarCollapsed = () => useContext(SidebarState).collapsed;

/** Link with active state. `pathname` null = unknown (static shell), rendered without highlighting. */
function NavLinkBase({ item, onNavigate, pathname }: { item: NavItem; onNavigate?: () => void; pathname: string | null }) {
  const { t, locale } = useI18n();
  const { collapsed, touch } = useContext(SidebarState);
  const href = `/${locale}${item.href}`;
  const active = pathname !== null && (item.href === "" ? pathname === `/${locale}` : pathname === href || pathname.startsWith(`${href}/`));
  const Icon = item.icon;
  const label = t(item.label);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        "group/nav relative z-[1] flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors duration-150 hover:bg-muted/70 hover:text-foreground",
        active && "font-medium text-foreground hover:bg-transparent",
        collapsed && "justify-center px-0",
        touch && "h-11 gap-3 px-3 text-sm",
      )}
    >
      <Icon
        className={cn("size-4 shrink-0 transition-colors rtl:-scale-x-100", active ? "text-primary" : "text-muted-foreground/90 group-hover/nav:text-foreground")}
        aria-hidden
      />
      <span className={cn("truncate", collapsed && "sr-only")}>{label}</span>
      {item.phase && !collapsed ? (
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

/**
 * The active pill: one element that slides to the current link (transform/height transitions).
 * Measured after each navigation, whenever the list resizes (collapse, admin slot) and when a link's aria-current changes.
 */
function ActiveIndicator({ container }: { container: RefObject<HTMLDivElement | null> }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = container.current;
    const pill = ref.current;
    if (!root || !pill) return;
    const place = () => {
      const target = root.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!target) {
        pill.style.opacity = "0";
        return;
      }
      const first = pill.dataset.placed !== "true";
      if (first) pill.style.transition = "none";
      pill.style.opacity = "1";
      pill.style.height = `${target.offsetHeight}px`;
      pill.style.transform = `translateY(${target.offsetTop}px)`;
      if (first) {
        pill.dataset.placed = "true";
        requestAnimationFrame(() => {
          pill.style.transition = "";
        });
      }
    };
    const raf = requestAnimationFrame(place);
    const ro = new ResizeObserver(place);
    ro.observe(root);
    // Links resolve their active state behind their own Suspense boundaries; follow aria-current as it lands.
    const mo = new MutationObserver(place);
    mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-current"] });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
  }, [pathname, container]);
  return (
    <div
      ref={ref}
      aria-hidden
      className="nav-indicator pointer-events-none absolute inset-x-0 top-0 rounded-md border border-border/70 bg-surface opacity-0 shadow-elev-1"
    >
      <span className="absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-brand-gradient" />
    </div>
  );
}

export function Sidebar({
  adminSlot,
  onNavigate,
  collapsed = false,
  onToggleCollapsed,
  touch = false,
}: {
  adminSlot?: ReactNode;
  onNavigate?: () => void;
  /** Icon-only rail (desktop). */
  collapsed?: boolean;
  /** Renders the collapse toggle when given. */
  onToggleCollapsed?: () => void;
  /** Touch layout (mobile drawer): 44px rows. */
  touch?: boolean;
}) {
  const { t, locale } = useI18n();
  const list = useRef<HTMLDivElement>(null);
  return (
    <SidebarState.Provider value={{ collapsed, touch }}>
      <nav aria-label={t("nav.commandCenter")} className="flex h-full flex-col">
        <div className={cn("flex h-14 shrink-0 items-center gap-2 px-3", collapsed && "justify-center px-2")}>
          <Link
            href={`/${locale}`}
            className={cn("flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 font-semibold tracking-[-0.02em]", collapsed && "px-0")}
            onClick={onNavigate}
            title={collapsed ? t("common.appName") : undefined}
          >
            <BrandMark className="size-6" />
            <span className={cn("truncate text-[15px]", collapsed && "sr-only")}>{t("common.appName")}</span>
          </Link>
          {onToggleCollapsed && !collapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="ms-auto rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t("shell.collapseSidebar")}
              title={t("shell.collapseSidebar")}
            >
              <PanelLeftClose className="size-4 rtl:-scale-x-100" aria-hidden />
            </button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
          <div ref={list} className={cn("relative grid gap-4", collapsed && "gap-2")}>
            <Suspense fallback={null}>
              <ActiveIndicator container={list} />
            </Suspense>
            {NAV.map((section, i) => (
              <div key={section.label ?? i} className="grid gap-0.5">
                {section.label ? (
                  collapsed ? (
                    <div aria-hidden className="mx-2 mb-1 h-px bg-border" />
                  ) : (
                    <div className="px-2 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground/75 uppercase">{t(section.label)}</div>
                  )
                ) : null}
                {section.items.map((item) => (
                  <NavLink key={item.href} item={item} onNavigate={onNavigate} />
                ))}
              </div>
            ))}
            {adminSlot ? <div className="grid gap-0.5 border-t pt-3 empty:hidden">{adminSlot}</div> : null}
          </div>
        </div>
        {touch ? (
          <div className="flex min-h-14 shrink-0 items-center border-t px-4">
            <LanguageSwitcher signedIn className="min-h-11 text-sm [&_select]:min-h-11 [&_select]:text-sm" />
          </div>
        ) : null}
        {onToggleCollapsed && collapsed ? (
          <div className="flex shrink-0 justify-center border-t p-2">
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t("shell.expandSidebar")}
              title={t("shell.expandSidebar")}
            >
              <PanelLeftOpen className="size-4 rtl:-scale-x-100" aria-hidden />
            </button>
          </div>
        ) : null}
      </nav>
    </SidebarState.Provider>
  );
}

/** Admin entry; rendered by the server only for platform principals. Owns its (non-serializable) icon. */
export function AdminNavLink() {
  return <NavLink item={ADMIN_NAV} />;
}
