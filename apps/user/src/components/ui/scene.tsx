import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Immersive, full-bleed scene section (Design DNA v2): breaks out of the page gutter, paints a soft world-tinted
 * stage with an optional `background` layer (e.g. <ParticleField/>, a 3D scene) and grain. Use for heroes and the
 * one or two "moments" of a page — not for every block.
 */
export function Scene({ children, background, className, contentClassName, bleed = true, grain = true }: { children: ReactNode; background?: ReactNode; className?: string; contentClassName?: string; bleed?: boolean; grain?: boolean }) {
  return (
    <section
      className={cn(
        "relative isolate overflow-hidden border-y bg-[radial-gradient(ellipse_80%_70%_at_20%_0%,var(--world-ambient-1,var(--aurora-1)),transparent_70%),radial-gradient(ellipse_60%_60%_at_100%_100%,var(--world-ambient-2,var(--aurora-2)),transparent_70%)]",
        bleed ? "scene-bleed" : "rounded-3xl border-x",
        grain && "grain",
        className,
      )}
    >
      {background ? <div aria-hidden className="absolute inset-0 -z-10">{background}</div> : null}
      <div className={cn("relative py-8 lg:py-12", contentClassName)}>{children}</div>
    </section>
  );
}

/**
 * Lightweight titled section without a card frame — editorial grouping (eyebrow + serif title + action), so pages can
 * use fewer boxes. `index` renders a quiet ordinal ("01") for narrative pages.
 */
export function Section({ title, eyebrow, description, action, index, children, className }: { title: ReactNode; eyebrow?: ReactNode; description?: ReactNode; action?: ReactNode; index?: number; children: ReactNode; className?: string }) {
  return (
    <section className={cn("grid gap-4", className)}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {eyebrow || index !== undefined ? (
            <div className="mb-1 flex items-center gap-2 text-micro text-muted-foreground uppercase">
              {index !== undefined ? <span className="numeral text-world">{String(index).padStart(2, "0")}</span> : null}
              {eyebrow}
            </div>
          ) : null}
          <h2 className="font-display text-display-lg">{title}</h2>
          {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** A big editorial figure: label, serif numeral, optional caption — for hero metrics without card chrome. */
export function Figure({ label, value, caption, className }: { label: ReactNode; value: ReactNode; caption?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-micro text-muted-foreground uppercase">{label}</div>
      <div className="numeral mt-1 font-display text-numeral">{value}</div>
      {caption ? <div className="mt-1 text-xs text-muted-foreground">{caption}</div> : null}
    </div>
  );
}
