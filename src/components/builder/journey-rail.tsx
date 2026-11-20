import Link from "next/link";
import { Check } from "lucide-react";
import { AnimatedProgress } from "@/components/motion";
import { cn } from "@/lib/utils";

/** The 10-stage journey indicator. Stages the user can reach are links; the current one is highlighted. */
export function JourneyRail({ locale, stages, current, reachable, labels, progressLabel }: { locale: string; stages: readonly string[]; current: number; reachable: number; labels: string[]; progressLabel: string }) {
  return (
    <nav aria-label={progressLabel} className="grid gap-3">
      <AnimatedProgress value={current} max={stages.length} label={progressLabel} size="sm" />
      <ol className="flex gap-1.5 overflow-x-auto pb-1 text-xs">
        {stages.map((s, i) => {
          const n = i + 1;
          const content = (
            <>
              <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border text-[10px] tabular-nums", n < current && "border-success bg-success/10 text-success", n === current && "border-primary bg-primary text-primary-foreground")}>
                {n < current ? <Check className="size-3" aria-hidden /> : n}
              </span>
              <span className="whitespace-nowrap">{labels[i]}</span>
            </>
          );
          const cls = cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1", n === current ? "border-primary bg-accent text-accent-foreground" : "text-muted-foreground");
          return (
            <li key={s} className="shrink-0">
              {n <= reachable && n !== current ? (
                <Link href={`/${locale}/onboarding?${n === 1 ? "step=profile" : n === 2 ? "step=business" : `stage=${n}`}`} className={cn(cls, "hover:bg-muted")}>
                  {content}
                </Link>
              ) : (
                <span className={cls} aria-current={n === current ? "step" : undefined}>
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
