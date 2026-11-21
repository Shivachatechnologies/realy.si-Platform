"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, CheckSquare, ClipboardCheck, LayoutDashboard, Menu, Sparkles, Users, X, type LucideIcon } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { PlanLockBadge } from "@/components/billing/upgrade-prompt";
import { JarvisCore } from "@/components/jarvis/jarvis-core";
import { setDockOpen, useDockOpen } from "@/components/jarvis/dock-store";

interface Tab {
  /** i18n key */
  label: string;
  /** path after /{locale}; "" = Command Center */
  href: string;
  icon: LucideIcon;
}

/** Bottom tab bar destinations on phones and tablets (below lg); everything else lives behind "More" (the slide-over nav). */
export const MOBILE_TABS: Tab[] = [
  { label: "shell.tabs.command", href: "", icon: LayoutDashboard },
  { label: "shell.tabs.approvals", href: "/approvals", icon: ClipboardCheck },
  { label: "shell.tabs.tasks", href: "/tasks", icon: CheckSquare },
  { label: "shell.tabs.workforce", href: "/workforce", icon: Users },
];

const isActive = (pathname: string | null, locale: string, href: string) => {
  if (pathname === null) return false;
  const full = `/${locale}${href}`;
  return href === "" ? pathname === full : pathname === full || pathname.startsWith(`${full}/`);
};

function TabLink({ tab, pathname, locked = false }: { tab: Tab; pathname: string | null; locked?: boolean }) {
  const { t, locale } = useI18n();
  const active = isActive(pathname, locale, tab.href);
  const Icon = tab.icon;
  return (
    <Link
      href={`/${locale}${tab.href}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/tab relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-medium text-muted-foreground transition-colors active:bg-muted/70",
        active && "text-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-0 h-[3px] w-8 rounded-b-full bg-brand-gradient opacity-0 transition-opacity duration-200",
          active && "opacity-100",
        )}
      />
      <span className={cn("grid size-8 place-items-center rounded-lg transition-colors", active && "bg-accent text-primary")}>
        <Icon className="size-[1.15rem] rtl:-scale-x-100" aria-hidden />
      </span>
      <span className="max-w-full truncate leading-none">{t(tab.label)}</span>
      {locked ? <PlanLockBadge className="absolute end-2 top-1.5" /> : null}
    </Link>
  );
}

const silent = () => 0;

/**
 * The tab bar's centre "Realy" voice button: the animated AI Core (CSS — the page's one WebGL context stays with the
 * page's own core). Opens the voice dock (push-to-talk); on the console itself it is the current page.
 */
function RealyTab({ pathname }: { pathname: string | null }) {
  const { t, locale } = useI18n();
  const open = useDockOpen();
  const onConsole = pathname !== null && isActive(pathname, locale, "/realy");
  const body = (
    <>
      <span className={cn("jv-glass jv-talk-glow relative -mt-7 grid size-[3.75rem] place-items-center rounded-full shadow-elev-3", (open || onConsole) && "border-[var(--jarvis-cyan)]")}>
        <JarvisCore state="IDLE" level={silent} pulses={{}} activity={0} compact className="size-12" />
      </span>
      <span className={cn("max-w-full truncate leading-none", (open || onConsole) && "text-foreground")}>{t("jarvis.dock.title")}</span>
    </>
  );
  const cls = "press relative flex min-h-14 min-w-0 flex-col items-center justify-end gap-1 px-1 pb-1 text-[11px] font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
  if (onConsole)
    return (
      <Link href={`/${locale}/realy`} aria-current="page" aria-label={t("jarvis.dock.title")} className={cls}>
        {body}
      </Link>
    );
  return (
    <button type="button" onClick={() => setDockOpen((v) => !v)} aria-expanded={open} aria-label={open ? t("jarvis.dock.close") : t("jarvis.dock.open")} className={cls}>
      {body}
    </button>
  );
}

function Tabs({ pathname, onMore, moreOpen, lockedHrefs = [] }: { pathname: string | null; onMore: () => void; moreOpen: boolean; lockedHrefs?: string[] }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto grid max-w-xl grid-cols-[repeat(2,minmax(0,1fr))_4.25rem_repeat(3,minmax(0,1fr))] gap-0.5 px-1.5">
      {MOBILE_TABS.slice(0, 2).map((tab) => (
        <TabLink key={tab.href} tab={tab} pathname={pathname} locked={lockedHrefs.includes(tab.href)} />
      ))}
      <RealyTab pathname={pathname} />
      {MOBILE_TABS.slice(2).map((tab) => (
        <TabLink key={tab.href} tab={tab} pathname={pathname} locked={lockedHrefs.includes(tab.href)} />
      ))}
      <button
        type="button"
        onClick={onMore}
        aria-expanded={moreOpen}
        aria-haspopup="dialog"
        className={cn(
          "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-medium text-muted-foreground transition-colors active:bg-muted/70",
          moreOpen && "text-foreground",
        )}
      >
        <span className={cn("grid size-8 place-items-center rounded-lg", moreOpen && "bg-accent text-primary")}>
          <Menu className="size-[1.15rem]" aria-hidden />
        </span>
        <span className="max-w-full truncate leading-none">{t("shell.tabs.more")}</span>
      </button>
    </div>
  );
}

function TabsWithPath(props: { onMore: () => void; moreOpen: boolean; lockedHrefs?: string[] }) {
  return <Tabs {...props} pathname={usePathname()} />;
}

/**
 * Bottom tab bar (below lg): the four places a founder returns to most, the centre "Realy" voice button, and "More"
 * for the full navigation drawer.
 * Respects the home-indicator safe area; every target is at least 56px tall.
 */
export function MobileTabBar({ onMore, moreOpen, lockedHrefs }: { onMore: () => void; moreOpen: boolean; lockedHrefs?: string[] }) {
  const { t } = useI18n();
  return (
    <nav
      aria-label={t("shell.mobileNavigation")}
      className="glass-strong fixed inset-x-0 bottom-0 z-30 border-t pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] shadow-[0_-8px_30px_-12px_oklch(0_0_0/0.25)] lg:hidden"
    >
      <Suspense fallback={<Tabs pathname={null} onMore={onMore} moreOpen={moreOpen} lockedHrefs={lockedHrefs} />}>
        <TabsWithPath onMore={onMore} moreOpen={moreOpen} lockedHrefs={lockedHrefs} />
      </Suspense>
    </nav>
  );
}

function CommandSheet({ hidden }: { hidden: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => input.current?.focus());
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = q.trim();
    setOpen(false);
    setQ("");
    router.push(`/${locale}/command${text ? `?q=${encodeURIComponent(text)}` : ""}`);
  }

  if (hidden) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="press fixed start-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 inline-flex min-h-12 items-center gap-2 rounded-full bg-brand-gradient ps-3.5 pe-4 text-sm font-medium text-primary-foreground shadow-glow lg:hidden"
      >
        <Sparkles className="size-4" aria-hidden />
        {t("shell.askAi")}
      </button>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-[oklch(0.12_0.02_275/0.45)] backdrop-blur-[2px] transition-opacity duration-200 lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("shell.askAiTitle")}
        inert={!open}
        className={cn(
          "glass-strong fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-elev-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none lg:hidden",
          open ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" />
        <div className="mb-2 flex items-center gap-2">
          <span aria-hidden className="grid size-8 place-items-center rounded-xl bg-brand-gradient text-primary-foreground shadow-glow">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t("shell.askAiTitle")}</p>
            <p className="truncate text-xs text-muted-foreground">{t("shell.askAiHint")}</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ms-auto grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label={t("common.close")}
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <form onSubmit={submit} className="flex items-end gap-2 rounded-2xl border bg-surface p-2 focus-within:border-ring">
          <label htmlFor="mobile-command" className="sr-only">
            {t("shell.askAiTitle")}
          </label>
          <textarea
            id="mobile-command"
            ref={input}
            value={q}
            rows={2}
            maxLength={2000}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) submit(e);
            }}
            placeholder={t("dna.command.entryPlaceholder")}
            className="min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-base outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            className="grid size-11 shrink-0 place-items-center rounded-xl bg-foreground text-background"
            aria-label={t("dna.command.entryGo")}
          >
            <ArrowUp className="size-5" aria-hidden />
          </button>
        </form>
      </div>
    </>
  );
}

function CommandSheetWithPath() {
  const { locale } = useI18n();
  const pathname = usePathname();
  return <CommandSheet hidden={pathname === `/${locale}/command` || pathname.startsWith(`/${locale}/command/`)} />;
}

/** Sticky AI command entry on phones: a floating "Ask AI" button above the tab bar that opens a bottom sheet → /command?q=. */
export function MobileCommandEntry() {
  return (
    <Suspense fallback={null}>
      <CommandSheetWithPath />
    </Suspense>
  );
}
