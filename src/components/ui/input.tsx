import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const fieldControl =
  "flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldControl, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldControl, "min-h-20 py-2", className)} {...props} />;
}

/** Native select: accessible, keyboard-friendly and RTL-correct by default. */
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(fieldControl, "pe-8", className)} {...props} />;
}
