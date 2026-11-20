import { cn } from "@/lib/utils";

/**
 * Realy mark: a precise geometric "R" monogram on the brand gradient tile — no mascots.
 * The gradient follows the surface tokens (indigo → violet in the app, amber → emerald in Realy Control).
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-grid size-6 shrink-0 place-items-center overflow-hidden rounded-[30%] bg-brand-gradient text-primary-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.3),0_2px_8px_-2px_var(--glow)]",
        className,
      )}
    >
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,oklch(1_0_0/0.35),transparent_60%)]" />
      <svg viewBox="0 0 24 24" className="relative size-[72%]" fill="none">
        <path d="M8 17.5V6.5h4.8a3.3 3.3 0 0 1 0 6.6H8m4.6 0 3.6 4.4" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** Mark + "Realy" wordmark. `product` adds a quiet product suffix (e.g. "Control"). */
export function BrandWordmark({ className, markClassName, product, name = "Realy" }: { className?: string; markClassName?: string; product?: string; name?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-[-0.02em]", className)}>
      <BrandMark className={markClassName} />
      <span>{name}</span>
      {product ? <span className="font-medium text-muted-foreground">{product}</span> : null}
    </span>
  );
}

/** Realy Control (admin console) mark: a shield on the control-room gradient. */
export function ControlMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-grid size-6 shrink-0 place-items-center overflow-hidden rounded-[30%] bg-[linear-gradient(135deg,oklch(0.24_0.02_250),oklch(0.14_0.01_250))] text-[oklch(0.82_0.15_75)] ring-1 ring-[oklch(0.82_0.15_75/0.35)] shadow-[0_2px_10px_-2px_oklch(0.8_0.15_75/0.45)]",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[68%]" fill="none">
        <path d="M12 3.2 5.5 5.8v5.4c0 4.1 2.7 7.6 6.5 8.8 3.8-1.2 6.5-4.7 6.5-8.8V5.8L12 3.2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="m9 12 2.1 2.1L15.2 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
