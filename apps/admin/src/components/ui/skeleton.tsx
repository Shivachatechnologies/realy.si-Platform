import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Loading placeholder block (for `loading.tsx` and Suspense fallbacks). Hidden from assistive tech. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)} {...props} />;
}

/** `rows` text lines of decreasing width. */
export function SkeletonText({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("grid gap-2", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: `${100 - ((i * 17) % 45)}%` }} />
      ))}
    </div>
  );
}

/** A table-shaped placeholder: a header bar and `rows` rows of `cols` cells. */
export function SkeletonTable({ rows = 6, cols = 4, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("grid gap-2 rounded-xl border bg-surface p-4", className)}>
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className="h-3" />
          ))}
        </div>
      ))}
    </div>
  );
}
