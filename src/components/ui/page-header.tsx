import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { WorldIllustration } from "@/components/graphics/illustrations";
import type { WorldName } from "./world";

/**
 * Page header.
 * - `variant="default"` (unchanged): eyebrow, icon tile, title, description, actions, meta row.
 * - `variant="editorial"` (Design DNA v2): an asymmetric split — editorial display title in the serif face with the
 *   world-tinted eyebrow rule on the start side, the world's hand-drawn illustration (or any `illustration` node)
 *   floating on the end side, and a travelling data rail underneath. Pass `world` to pick the illustration (or set
 *   `illustration={false}` to omit it). Works in Server Components.
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
  variant = "default",
  world,
  illustration,
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
  variant?: "default" | "editorial";
  world?: WorldName;
  /** Editorial only: custom visual for the end column; false hides it. Defaults to the world's illustration. */
  illustration?: ReactNode | false;
}) {
  if (variant === "editorial") {
    const visual = illustration === false ? null : (illustration ?? (world ? <WorldIllustration world={world} className="w-full max-w-[19rem]" /> : null));
    return (
      <header className={cn("grid gap-5", className)}>
        <div className={cn("grid items-center gap-x-10 gap-y-6", visual ? "lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]" : "")}>
          <div className="min-w-0 animate-fade-up">
            {eyebrow ? <div className="eyebrow-rule mb-3">{eyebrow}</div> : null}
            <h1 className="font-display text-display-xl text-balance break-words">{title}</h1>
            {description ? <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{description}</p> : null}
            {meta ? <div className="mt-4 flex flex-wrap items-center gap-2">{meta}</div> : null}
            {actions ? <div className="mt-5 flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
          {visual ? <div className="hidden justify-self-end animate-fade-in sm:block">{visual}</div> : null}
        </div>
        <div className="data-rail" aria-hidden />
        {children}
      </header>
    );
  }
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
            <h1 className="text-xl font-semibold tracking-[-0.02em] break-words sm:text-2xl">{title}</h1>
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
