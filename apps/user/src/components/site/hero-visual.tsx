"use client";

import Link from "next/link";
import { JarvisCore } from "@/components/jarvis/jarvis-core";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { SITE_DEPARTMENTS } from "@/server/modules/site/content";

const silent = () => 0;

/**
 * Homepage hero visual: the live Realy AI Core (React Three Fiber on capable devices — phones at the lite tier — the
 * animated CSS core otherwise; still under reduced motion) inside HUD brackets and orbit rings, with the company's
 * departments in orbit (chips link to their pages on larger screens; the core's own nodes stand for them on phones).
 * Nothing here is a metric: the core idles with a decorative heartbeat.
 */
export function HeroVisual({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const n = SITE_DEPARTMENTS.length;
  return (
    <div className={cn("relative mx-auto aspect-square w-full", className)}>
      {/* HUD corner brackets */}
      <span aria-hidden className="absolute start-0 top-0 size-6 border-s border-t border-[color-mix(in_oklch,var(--jarvis-cyan)_55%,transparent)]" />
      <span aria-hidden className="absolute end-0 top-0 size-6 border-e border-t border-[color-mix(in_oklch,var(--jarvis-cyan)_55%,transparent)]" />
      <span aria-hidden className="absolute start-0 bottom-0 size-6 border-s border-b border-[color-mix(in_oklch,var(--jarvis-cyan)_55%,transparent)]" />
      <span aria-hidden className="absolute end-0 bottom-0 size-6 border-e border-b border-[color-mix(in_oklch,var(--jarvis-cyan)_55%,transparent)]" />
      <p aria-hidden className="jv-hud absolute start-8 top-1 flex items-center gap-2 text-[10px]">
        <span className="live-dot text-[var(--jarvis-cyan)]" data-pulse="true" />
        {t("site.home.hud.core")}
      </p>
      <p aria-hidden className="jv-hud absolute end-8 bottom-1 text-[10px]">{t("site.home.hud.departments", { count: n })}</p>

      {/* Orbits */}
      <svg viewBox="0 0 100 100" aria-hidden className="absolute inset-0 size-full">
        <defs>
          <linearGradient id="site-orbit" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--jarvis-cyan)" stopOpacity="0.7" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="46" fill="none" stroke="var(--jarvis-cyan)" strokeOpacity="0.25" strokeWidth="0.15" strokeDasharray="0.6 1.4" className="site-orbit-spin" />
        <circle cx="50" cy="50" r="41" fill="none" stroke="url(#site-orbit)" strokeWidth="0.3" className="site-orbit-spin [animation-direction:reverse] [animation-duration:90s]" />
      </svg>

      <div className="absolute inset-[7%]">
        <JarvisCore state="IDLE" level={silent} pulses={{}} activity={0.35} ambient priority={3} className="size-full" />
      </div>

      {/* Departments on the outer orbit (sm+; on phones the core's nodes stand for them) */}
      <ul className="absolute inset-0 hidden sm:block">
        {SITE_DEPARTMENTS.map((d, i) => {
          const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
          const x = 50 + Math.cos(angle) * 46;
          const y = 50 + Math.sin(angle) * 46;
          return (
            <li key={d.key} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
              <Link
                href={`/${locale}/platform/${d.key}`}
                className="site-chip jv-glass inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium whitespace-nowrap transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 sm:text-[12.5px]"
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <span aria-hidden className="size-1.5 rounded-full bg-[var(--jarvis-cyan)] shadow-[0_0_8px_var(--jarvis-cyan)]" />
                {t(`site.departments.${d.key}.name`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
