import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Progress indicator of a guided journey: numbered steps, the current one highlighted, finished ones checked.
 * Steps with an href are links (going back is always safe; going forward only to reached steps).
 */
export function Stepper({ steps, current, label, reached }: { steps: { key: string; label: string; href?: string }[]; current: number; label: string; reached?: number }) {
  const max = reached ?? current;
  return (
    <nav aria-label={label} className="overflow-x-auto">
      <ol className="flex min-w-max items-center gap-1 text-xs sm:text-sm">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          const clickable = !!s.href && i <= max && !active;
          const inner = (
            <>
              <span
                aria-hidden
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold transition-colors",
                  done && "border-success/40 bg-success/10 text-success",
                  active && "border-transparent bg-brand-gradient text-primary-foreground shadow-glow",
                  !done && !active && "text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={cn("whitespace-nowrap", active ? "font-medium text-foreground" : "text-muted-foreground")}>{s.label}</span>
            </>
          );
          return (
            <li key={s.key} className="flex items-center gap-1" aria-current={active ? "step" : undefined}>
              {clickable ? (
                <a href={s.href} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-muted">
                  {inner}
                </a>
              ) : (
                <span className="flex items-center gap-1.5 px-1.5 py-1">{inner}</span>
              )}
              {i < steps.length - 1 ? <span aria-hidden className={cn("h-px w-4 sm:w-8", i < current ? "bg-success/50" : "bg-border")} /> : null}
            </li>
          );
        })}
      </ol>
      <p className="sr-only">{`${current + 1} / ${steps.length}`}</p>
    </nav>
  );
}
