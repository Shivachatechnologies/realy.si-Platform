import { cn } from "@/lib/utils";

/** The slow, GPU-friendly aurora painted behind a canvas (fixed by default; static under reduced motion). */
export function Aurora({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("aurora", className)}>
      <span />
      <span />
      <span />
    </div>
  );
}
