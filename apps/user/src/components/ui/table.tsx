import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Data table. Optional:
 * - `density`: "compact" | "default" | "comfortable" (cell padding);
 * - `stickyHeader`: the wrapper scrolls vertically (max height `maxHeight`, default 70vh) and THead stays pinned.
 */
export function Table({
  className,
  density = "default",
  stickyHeader = false,
  maxHeight,
  ...props
}: ComponentProps<"table"> & { density?: "compact" | "default" | "comfortable"; stickyHeader?: boolean; maxHeight?: string }) {
  return (
    <div
      data-density={density}
      data-sticky={stickyHeader ? "true" : undefined}
      className={cn("group/table relative w-full overflow-x-auto", stickyHeader && "overflow-y-auto overscroll-contain")}
      style={stickyHeader ? { maxHeight: maxHeight ?? "70vh" } : undefined}
    >
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}
export const THead = (p: ComponentProps<"thead">) => (
  <thead
    {...p}
    className={cn(
      "border-b bg-surface-2 group-data-[sticky=true]/table:sticky group-data-[sticky=true]/table:top-0 group-data-[sticky=true]/table:z-10 group-data-[sticky=true]/table:glass-strong group-data-[sticky=true]/table:shadow-[inset_0_-1px_0_var(--border)]",
      p.className,
    )}
  />
);
export const TBody = (p: ComponentProps<"tbody">) => <tbody {...p} className={cn("[&_tr:last-child]:border-0", p.className)} />;
export const Tr = (p: ComponentProps<"tr">) => (
  <tr {...p} className={cn("border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-accent/60", p.className)} />
);
export const Th = (p: ComponentProps<"th">) => (
  <th
    {...p}
    className={cn(
      "h-9 px-3 text-start align-middle text-xs font-medium text-muted-foreground whitespace-nowrap group-data-[density=compact]/table:h-8 group-data-[density=comfortable]/table:h-10",
      p.className,
    )}
  />
);
export const Td = (p: ComponentProps<"td">) => (
  <td
    {...p}
    className={cn(
      "px-3 py-2 align-middle group-data-[density=compact]/table:py-1 group-data-[density=compact]/table:text-[13px] group-data-[density=comfortable]/table:py-3",
      p.className,
    )}
  />
);
