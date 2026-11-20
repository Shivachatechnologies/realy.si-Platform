"use client";

import Link from "next/link";
import { AiCoreStage } from "@/components/graphics/ai-core-stage";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { SITE_DEPARTMENTS } from "@/server/modules/site/content";

/**
 * Homepage hero visual: the AI core (3D, client-only, SVG fallback under reduced motion / no WebGL) with the company's
 * departments in orbit. Each department chip links to its page. Nothing here is a metric: the core is shown idle.
 */
export function HeroVisual({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const n = SITE_DEPARTMENTS.length;
  return (
    <div className={cn("relative mx-auto aspect-square w-full max-w-[34rem]", className)}>
      {/* Orbits */}
      <svg viewBox="0 0 100 100" aria-hidden className="absolute inset-0 size-full text-border-strong">
        <defs>
          <linearGradient id="site-orbit" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--primary)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--primary-2)" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="0.15" strokeDasharray="0.6 1.4" />
        <circle cx="50" cy="50" r="38" fill="none" stroke="url(#site-orbit)" strokeWidth="0.3" className="site-orbit-spin" />
        <circle cx="50" cy="50" r="29" fill="none" stroke="currentColor" strokeWidth="0.12" />
      </svg>
      <div className="absolute inset-[22%]">
        <AiCoreStage activity={0} nodes={n} className="size-full" />
      </div>
      {/* Departments on the outer orbit */}
      <ul className="absolute inset-0">
        {SITE_DEPARTMENTS.map((d, i) => {
          const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
          const x = 50 + Math.cos(angle) * 44;
          const y = 50 + Math.sin(angle) * 44;
          return (
            <li key={d.key} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
              <Link
                href={`/${locale}/platform/${d.key}`}
                className="site-chip inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-surface/85 px-3 text-[12px] font-medium whitespace-nowrap shadow-elev-2 backdrop-blur transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-border-strong hover:shadow-elev-3 sm:text-[12.5px]"
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <span aria-hidden className="size-1.5 rounded-full bg-brand-gradient" />
                {t(`site.departments.${d.key}.name`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
