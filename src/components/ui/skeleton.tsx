import { cn } from "@/lib/utils";

/** Shimmering placeholder (static under reduced motion). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("shimmer rounded-md", className)} />;
}

/** Text-line placeholders. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("grid gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={cn("shimmer h-3 rounded-sm", i === lines - 1 ? "w-3/5" : "w-full")} />
      ))}
    </div>
  );
}
