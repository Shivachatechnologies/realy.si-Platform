import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "bg-muted text-muted-foreground",
      accent: "border-transparent bg-accent text-accent-foreground",
      success: "border-success/30 text-success",
      warning: "border-warning/40 text-warning",
      danger: "border-danger/40 text-danger",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function StatusDot({ tone }: { tone: "success" | "warning" | "danger" | "neutral" }) {
  const color = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", neutral: "bg-muted-foreground" }[tone];
  return <span aria-hidden className={cn("inline-block size-2 rounded-full", color)} />;
}
