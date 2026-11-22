"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { GuidePanel } from "./guide-panel";
import { companyApi, useGuideScope } from "./guide-scope";

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/**
 * Universal AI Guide: a floating launcher (bottom-end) and a glass side panel that knows the current page.
 * Keyboard: Shift+? toggles the panel, Escape closes it, ⌘J / Ctrl+J opens the full AI Command workspace.
 */
export function GuideLauncher() {
  const { t, locale } = useI18n();
  const scope = useGuideScope();
  const base = companyApi(scope);
  const pathname = usePathname() ?? `/${locale}`;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCommand = pathname.replace(/^\/[^/]+/, "").startsWith("/command");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen(false);
        router.push(`/${locale}/command`);
        return;
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
        opener.current?.focus();
        return;
      }
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !isTyping(e.target)) {
        e.preventDefault();
        setMounted(true);
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, router, locale]);

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("nav button, button, a, textarea")?.focus();
  }, [open]);

  if (onCommand) return null;

  return (
    <>
      <button
        ref={opener}
        type="button"
        onClick={() => {
          setMounted(true);
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-controls="ai-guide-panel"
        aria-keyshortcuts="Shift+?"
        className={cn(
          "group fixed end-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-40 flex size-12 items-center justify-center gap-2 rounded-full bg-brand-gradient text-sm lg:end-5 lg:bottom-5 lg:w-auto lg:justify-start lg:ps-3.5 lg:pe-4 font-semibold text-primary-foreground shadow-glow transition-[transform,opacity] duration-300 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-safe:hover:-translate-y-0.5",
          open && "pointer-events-none translate-y-2 opacity-0",
        )}
      >
        <span aria-hidden className="relative grid size-6 place-items-center">
          <span className="absolute inset-0 rounded-full bg-primary-foreground/25 motion-safe:animate-live" />
          <Sparkles className="relative size-4" />
        </span>
        <span className="sr-only lg:not-sr-only">{t("guide.launcher")}</span>
      </button>

      {/* Clipping layer: the closed panel sits translated off-screen; without it, mobile browsers widen the layout
          viewport to include the panel (horizontal scroll on phones). */}
      <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
        <div
          id="ai-guide-panel"
        ref={panel}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        inert={!open}
        className={cn(
          "glass-strong pointer-events-auto absolute inset-y-0 end-0 w-[min(26rem,100%)] border-s shadow-elev-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
          open ? "translate-x-0" : "translate-x-full rtl:-translate-x-full",
        )}
      >
        {mounted ? (
          <GuidePanel
            base={base}
            pathname={pathname}
            titleId={titleId}
            onClose={() => {
              setOpen(false);
              opener.current?.focus();
            }}
          />
        ) : null}
        </div>
      </div>
    </>
  );
}
