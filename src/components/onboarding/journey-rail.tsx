import Link from "next/link";
import { Bot, Check, Compass, Building2, Rocket, Sparkles, Telescope } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = { welcome: Sparkles, vision: Compass, intelligence: Telescope, blueprint: Building2, workforce: Bot, launch: Rocket } as const;
export type RailStage = keyof typeof ICONS;

/**
 * The six-stage journey indicator: a luminous track with one node per stage. Reached stages are links (the founder can
 * look back); the current one glows; later ones stay quiet. Horizontal scroll on narrow screens, RTL-safe.
 */
export function JourneyRail({ locale, stages, current, reachable, labels, label }: { locale: string; stages: readonly RailStage[]; current: number; reachable: number; labels: string[]; label: string }) {
  const pct = stages.length > 1 ? ((current - 1) / (stages.length - 1)) * 100 : 0;
  return (
    <nav aria-label={label} className="relative">
      <div aria-hidden className="absolute inset-x-6 top-5 hidden h-px bg-border sm:block" />
      <div aria-hidden className="absolute start-6 top-5 hidden h-px bg-[linear-gradient(90deg,var(--primary),var(--primary-2,var(--primary)))] shadow-glow transition-[width] duration-700 sm:block rtl:bg-[linear-gradient(270deg,var(--primary),var(--primary-2,var(--primary)))]" style={{ width: `calc((100% - 3rem) * ${pct / 100})` }} />
      <ol className="relative flex snap-x gap-2 overflow-x-auto pb-1 sm:justify-between sm:gap-0 sm:overflow-visible">
        {stages.map((s, i) => {
          const n = i + 1;
          const Icon = ICONS[s];
          const done = n < current;
          const here = n === current;
          const node = (
            <>
              <span
                className={cn(
                  "relative grid size-10 shrink-0 place-items-center rounded-full border bg-surface transition-colors [&_svg]:size-4",
                  done && "border-success/50 text-success",
                  here && "border-primary bg-primary text-primary-foreground shadow-glow",
                  !done && !here && "text-muted-foreground",
                )}
              >
                {done ? <Check aria-hidden /> : <Icon aria-hidden />}
                {here ? <span aria-hidden className="absolute -inset-1 animate-pulse rounded-full border border-primary/40 motion-reduce:animate-none" /> : null}
              </span>
              <span className={cn("text-[11px] font-medium whitespace-nowrap", here ? "text-foreground" : "text-muted-foreground")}>
                <span className="tabular-nums">{n}</span> · {labels[i]}
              </span>
            </>
          );
          const cls = "flex min-w-[4.5rem] snap-start flex-col items-center gap-1.5 rounded-xl px-1 py-0.5 text-center";
          return (
            <li key={s} className="shrink-0">
              {n <= reachable && !here ? (
                <Link href={`/${locale}/onboarding?stage=${s}`} className={cn(cls, "hover:bg-muted/60 focus-visible:bg-muted/60")}>
                  {node}
                </Link>
              ) : (
                <span className={cls} aria-current={here ? "step" : undefined}>
                  {node}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Stage heading with plain-language guidance: what happens here, what the AI does, what comes next. */
export function StageIntro({ eyebrow, title, what, ai, next, labels }: { eyebrow: string; title: string; what: string; ai: string; next: string; labels: { what: string; ai: string; next: string } }) {
  return (
    <header className="grid gap-3">
      <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.12em] text-primary uppercase">
        <span aria-hidden className="h-px w-6 bg-primary" />
        {eyebrow}
      </p>
      <h1 className="font-display text-display-xl text-balance">{title}</h1>
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        {(
          [
            ["what", what],
            ["ai", ai],
            ["next", next],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-xl border bg-surface/70 px-3 py-2 backdrop-blur">
            <dt className="text-[11px] font-semibold text-muted-foreground uppercase">{labels[k]}</dt>
            <dd className="mt-0.5 text-pretty">{v}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}
