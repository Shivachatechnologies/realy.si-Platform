"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  Bot,
  Building2,
  CreditCard,
  Gauge,
  LayoutDashboard,
  Plug,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  children?: { href: string; label: string }[];
}

/** Admin Control Center sections (labels under admin.nav.*). */
export const ADMIN_SECTIONS: Item[] = [
  { href: "", label: "overview", icon: LayoutDashboard },
  { href: "/users", label: "users", icon: Users },
  { href: "/organizations", label: "companies", icon: Building2 },
  { href: "/ai", label: "ai", icon: Bot, children: [{ href: "/ai", label: "aiOverview" }, { href: "/ai/tasks", label: "aiTasks" }, { href: "/ai/usage", label: "aiUsage" }] },
  {
    href: "/pricing",
    label: "billing",
    icon: CreditCard,
    children: [{ href: "/pricing", label: "pricing" }, { href: "/subscriptions", label: "subscriptions" }, { href: "/countries", label: "countries" }],
  },
  { href: "/controls", label: "features", icon: SlidersHorizontal, children: [{ href: "/controls", label: "controls" }, { href: "/flags", label: "flags" }] },
  { href: "/integrations", label: "integrations", icon: Plug },
  { href: "/system", label: "system", icon: Gauge },
  { href: "/audit", label: "securityAudit", icon: ShieldCheck, children: [{ href: "/audit", label: "audit" }, { href: "/security", label: "security" }] },
  { href: "/settings", label: "settings", icon: Settings },
];

function isActive(pathname: string | null, base: string, href: string) {
  if (pathname === null) return false;
  const full = `${base}${href}`;
  return href === "" ? pathname === base : pathname === full || pathname.startsWith(`${full}/`);
}

function SidebarBase({ pathname }: { pathname: string | null }) {
  const { t, locale } = useI18n();
  const base = `/${locale}/admin`;
  return (
    <ul className="flex gap-1 overflow-x-auto pb-1 lg:grid lg:gap-0.5 lg:overflow-visible lg:pb-0">
      {ADMIN_SECTIONS.map((s) => {
        const sectionActive = isActive(pathname, base, s.href) || !!s.children?.some((c) => isActive(pathname, base, c.href));
        const Icon = s.icon;
        return (
          <li key={s.label} className="shrink-0">
            <Link
              href={`${base}${s.href}`}
              aria-current={sectionActive && !s.children ? "page" : undefined}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                sectionActive && "bg-muted font-medium text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span>{t(`admin.nav.${s.label}`)}</span>
            </Link>
            {s.children && sectionActive ? (
              <ul className="ms-6 mt-0.5 hidden gap-0.5 border-s ps-2 lg:grid">
                {s.children.map((c) => {
                  const active = pathname === `${base}${c.href}` || (c.href !== s.href && isActive(pathname, base, c.href));
                  return (
                    <li key={c.href}>
                      <Link
                        href={`${base}${c.href}`}
                        aria-current={active ? "page" : undefined}
                        className={cn("block rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground", active && "font-medium text-foreground")}
                      >
                        {t(`admin.nav.${c.label}`)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function SidebarWithPath() {
  return <SidebarBase pathname={usePathname()} />;
}

export function AdminSidebar() {
  const { t } = useI18n();
  return (
    <nav aria-label={t("admin.title")} className="lg:sticky lg:top-4">
      <Suspense fallback={<SidebarBase pathname={null} />}>
        <SidebarWithPath />
      </Suspense>
    </nav>
  );
}

/** Global admin search box; "/" or Ctrl/⌘+K focuses it from anywhere in the console. */
export function AdminSearchBox({ initial = "" }: { initial?: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(initial);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      role="search"
      className="relative w-full max-w-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/${locale}/admin/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        ref={ref}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        maxLength={200}
        placeholder={t("admin.search.placeholder")}
        aria-label={t("admin.search.placeholder")}
        className="h-8 w-full rounded-md border bg-surface ps-8 pe-12 text-xs placeholder:text-muted-foreground"
      />
      <kbd className="pointer-events-none absolute end-2 top-1/2 hidden -translate-y-1/2 rounded border px-1 font-mono text-[10px] text-muted-foreground sm:inline">⌘K</kbd>
    </form>
  );
}

