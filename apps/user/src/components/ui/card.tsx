import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const cardVariants = cva("min-w-0 rounded-lg border bg-surface", {
  variants: {
    variant: {
      /** Flat hairline surface — the classic look. */
      default: "shadow-elev-1",
      /** Raised with layered soft shadows. */
      elevated: "shadow-elev-2",
      /** Frosted glass over the aurora canvas. */
      glass: "glass shadow-elev-2",
      /** Highlighted: gradient hairline border and a soft accent glow. */
      highlight: "border-gradient shadow-glow [--gradient-fill:linear-gradient(180deg,color-mix(in_oklch,var(--primary)_6%,var(--surface)),var(--surface)_55%)]",
      /** Floating glass panel with a world-tinted hairline (over scenes and illustrations). */
      floating: "panel-float border-0 bg-transparent",
      /** Borderless immersive surface: soft world wash, no chrome. */
      immersive: "rounded-2xl border-transparent bg-[linear-gradient(160deg,var(--world-soft,var(--accent)),transparent_70%)]",
    },
    /** Hover lift for clickable cards. */
    interactive: { true: "hover-lift", false: "" },
  },
  defaultVariants: { variant: "default", interactive: false },
});

export function Card({ className, variant, interactive, ...props }: ComponentProps<"section"> & VariantProps<typeof cardVariants>) {
  return <section className={cn(cardVariants({ variant, interactive }), className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Optional leading icon (rendered in a soft accent tile). */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-4 py-3", className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? (
          <span aria-hidden className="mt-px grid size-6 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground [&_svg]:size-3.5">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {/* Actions wrap under the title on narrow screens instead of widening the page (filters, period pickers). */}
      {actions ? <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"footer">) {
  return <footer className={cn("flex items-center justify-end gap-2 border-t bg-surface-2/60 px-4 py-2.5 rounded-b-[inherit]", className)} {...props} />;
}
