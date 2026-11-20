import Link from "next/link";
import { BarChart3, CalendarClock, Compass, Eye, Image as ImageIcon, Lightbulb, Megaphone, PenLine, Send, SlidersHorizontal } from "lucide-react";
import type { Translate } from "@/i18n/translate";
import { formatNumber } from "@/i18n/format";
import { cn } from "@/lib/utils";

/** Mirrors server/modules/marketing/lifecycle.ts → StageState (kept local so this file stays free of server imports). */
export interface LifecycleStageView {
  key: "research" | "strategy" | "content" | "graphics" | "campaign" | "schedule" | "publish" | "monitor" | "analyze" | "optimize";
  value: number;
  pending: number;
  attention: number;
  href: string;
}

const ICONS = { research: Compass, strategy: Lightbulb, content: PenLine, graphics: ImageIcon, campaign: Megaphone, schedule: CalendarClock, publish: Send, monitor: Eye, analyze: BarChart3, optimize: SlidersHorizontal } as const;

/** Serpentine placement on large screens: 1→5 on the first row, 6→10 back along the second (static class names for Tailwind). */
const PLACE = ["lg:col-start-1 lg:row-start-1", "lg:col-start-2 lg:row-start-1", "lg:col-start-3 lg:row-start-1", "lg:col-start-4 lg:row-start-1", "lg:col-start-5 lg:row-start-1", "lg:col-start-5 lg:row-start-2", "lg:col-start-4 lg:row-start-2", "lg:col-start-3 lg:row-start-2", "lg:col-start-2 lg:row-start-2", "lg:col-start-1 lg:row-start-2"];

/**
 * The marketing department as one closed loop (Research → … → Optimize), drawn from real record counts. Each stage links
 * to where that work happens; stages waiting on a person carry a warning marker. Server-safe; animation is CSS-only and
 * stops under reduced motion.
 */
export function LifecycleLoop({ stages, t, locale }: { stages: LifecycleStageView[]; t: Translate; locale: string }) {
  const firstIdle = stages.findIndex((s) => s.value === 0 && s.pending === 0);
  return (
    <section className="glass relative overflow-hidden rounded-xl border p-4 shadow-elev-1 sm:p-5" aria-labelledby="mkt-loop-title">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-brand-gradient opacity-70" />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow-rule mb-1">{t("marketing.lifecycle.eyebrow")}</p>
          <h2 id="mkt-loop-title" className="font-display text-display-lg">
            {t("marketing.lifecycle.title")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("marketing.lifecycle.subtitle")}</p>
        </div>
        {firstIdle >= 0 ? (
          <Link href={`/${locale}${stages[firstIdle]!.href}`} className="rounded-md border bg-surface px-3 py-2 text-xs font-medium hover:bg-muted">
            {t("marketing.lifecycle.nextGap", { stage: t(`marketing.lifecycle.stages.${stages[firstIdle]!.key}.name`) })}
          </Link>
        ) : null}
      </div>
      <div className="relative">
        <svg aria-hidden viewBox="0 0 1000 200" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 hidden h-full w-full rtl:-scale-x-100 lg:block">
          <path d="M100 50 H900 C 975 50 975 150 900 150 H100 C 25 150 25 50 100 50" fill="none" stroke="var(--border)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <path d="M100 50 H900 C 975 50 975 150 900 150 H100 C 25 150 25 50 100 50" fill="none" stroke="var(--primary)" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="6 18" vectorEffect="non-scaling-stroke" className="dash-flow" />
        </svg>
        <ol className="relative grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-x-6 lg:gap-y-8">
          {stages.map((s, i) => {
            const Icon = ICONS[s.key];
            return (
              <li key={s.key} className={cn("min-w-0", PLACE[i])}>
                <Link
                  href={`/${locale}${s.href}`}
                  className={cn(
                    "group relative grid h-full min-h-28 gap-1 rounded-lg border bg-surface/90 p-3 backdrop-blur transition hover:-translate-y-0.5 hover:shadow-elev-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                    s.attention > 0 && "border-warning/60",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                      <span className="tabular-nums text-primary">{String(i + 1).padStart(2, "0")}</span>
                      {t(`marketing.lifecycle.stages.${s.key}.name`)}
                    </span>
                    <Icon className="size-4 shrink-0 text-primary/80" aria-hidden />
                  </span>
                  <span className="font-display text-display tabular-nums">{formatNumber(s.value, locale)}</span>
                  <span className="text-xs text-muted-foreground">{t(`marketing.lifecycle.stages.${s.key}.value`)}</span>
                  {s.pending > 0 || s.attention > 0 ? (
                    <span className="mt-1 flex flex-wrap gap-1 text-[11px]">
                      {s.pending > 0 ? <span className="rounded-full bg-accent px-2 py-0.5 tabular-nums">{t(`marketing.lifecycle.stages.${s.key}.pending`, { count: s.pending })}</span> : null}
                      {s.attention > 0 && s.attention !== s.pending ? <span className="rounded-full bg-warning/15 px-2 py-0.5 text-warning tabular-nums">{t(`marketing.lifecycle.stages.${s.key}.attention`, { count: s.attention })}</span> : null}
                    </span>
                  ) : s.value === 0 ? (
                    <span className="mt-1 text-[11px] text-muted-foreground">{t(`marketing.lifecycle.stages.${s.key}.empty`)}</span>
                  ) : null}
                  {s.attention > 0 ? <span aria-label={t("marketing.lifecycle.needsYou")} className="absolute -top-1 -end-1 size-2.5 rounded-full bg-warning ring-2 ring-surface" /> : null}
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
