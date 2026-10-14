import { cn } from "@/lib/utils";

/** Realy mark: a precise, geometric monogram — no mascots. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-6", className)}>
      <rect x="1" y="1" width="22" height="22" rx="6" className="fill-foreground" />
      <path d="M8 17V7h4.6a3.1 3.1 0 0 1 0 6.2H8m4.4 0L16 17" className="stroke-background" strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
