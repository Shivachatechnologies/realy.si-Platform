import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Premium page header: optional eyebrow (section / status), icon tile, title, description, actions and a meta row
 * (badges, live indicators). Fades up on mount. Works in Server Components.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  icon,
  actions,
  meta,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  /** Rendered under the header (e.g. tabs). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("grid gap-4 animate-fade-up", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? (
            <span
              aria-hidden
              className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg border-gradient text-primary shadow-glow [--gradient-fill:linear-gradient(135deg,color-mix(in_oklch,var(--primary)_12%,var(--surface)),var(--surface))] [&_svg]:size-5"
            >
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            {eyebrow ? <div className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-primary uppercase">{eyebrow}</div> : null}
            <h1 className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">{title}</h1>
            {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
            {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
