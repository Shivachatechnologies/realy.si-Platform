import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap tabular-nums",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground",
        accent: "border-transparent bg-accent text-accent-foreground",
        success: "border-success/30 bg-success/8 text-success",
        warning: "border-warning/40 bg-warning/8 text-warning",
        danger: "border-danger/40 bg-danger/8 text-danger",
        info: "border-info/30 bg-info/8 text-info",
        /** Solid brand gradient for "AI" / "New" markers. */
        brand: "border-transparent bg-brand-gradient text-primary-foreground",
      },
      /** Pill shape instead of the default soft rectangle. */
      shape: { default: "", pill: "rounded-full px-2" },
    },
    defaultVariants: { tone: "neutral", shape: "default" },
  },
);

/** `pulse` prepends a live dot in the badge's color (animated unless reduced motion is requested). */
export function Badge({
  className,
  tone,
  shape,
  pulse = false,
  children,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { pulse?: boolean }) {
  return (
    <span className={cn(badgeVariants({ tone, shape }), className)} {...props}>
      {pulse ? <span aria-hidden className="live-dot size-1.5" data-pulse="true" /> : null}
      {children}
    </span>
  );
}

export function StatusDot({ tone, pulse = false }: { tone: "success" | "warning" | "danger" | "neutral" | "info"; pulse?: boolean }) {
  const color = { success: "text-success", warning: "text-warning", danger: "text-danger", neutral: "text-muted-foreground", info: "text-info" }[tone];
  return <span aria-hidden className={cn("live-dot size-2", color)} data-pulse={pulse ? "true" : undefined} />;
}
