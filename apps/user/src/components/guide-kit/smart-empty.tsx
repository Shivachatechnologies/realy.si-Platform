import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Never-blank empty state: what would be here, why it helps, a working button to create the first item and an optional
 * "Let AI do it" action.
 */
export function SmartEmpty({ icon, title, body, primary, ai, className }: { icon?: ReactNode; title: ReactNode; body: ReactNode; primary?: ReactNode; ai?: ReactNode; className?: string }) {
  return (
    <div className={cn("grid justify-items-center gap-3 px-4 py-10 text-center animate-fade-up", className)}>
      {icon ? (
        <span aria-hidden className="grid size-12 place-items-center rounded-2xl border-gradient text-primary shadow-glow [--gradient-fill:linear-gradient(135deg,color-mix(in_oklch,var(--primary)_12%,var(--surface)),var(--surface))] [&_svg]:size-6">
          {icon}
        </span>
      ) : null}
      <div className="grid max-w-md gap-1">
        <p className="text-base font-semibold tracking-tight">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      {primary || ai ? <div className="flex flex-wrap items-start justify-center gap-2">{primary}{ai}</div> : null}
    </div>
  );
}
