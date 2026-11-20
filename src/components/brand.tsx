import { cn } from "@/lib/utils";

/**
 * Realy "R" mark — Realy brand guidelines v1.0 (§02 Construction): one stroke T = 20 units, bowl radii 30/10,
 * leg and lower block at a 1.5:1 rise (≈56°), 16-unit leaf curve on both top-left corners, soft outer corners.
 * Path data is shared with the favicon (src/app/icon.svg) and OpenGraph images.
 */
export const R_MARK_VIEWBOX = "-1.2 -1.2 96.4 102.4";
export const R_MARK_PATHS = [
  // Bar + bowl + lower bar (its left end follows the leg angle).
  "M0 16A16 16 0 0 1 16 0H64A30 30 0 1 1 64 60H45.33L32 40H64A10 10 0 0 0 64 20H0Z",
  // Leg.
  "M32 40H52L92 100H72Z",
  // Lower block.
  "M0 66A16 16 0 0 1 16 50H25.67L59 100H0Z",
] as const;

/** Realy Blue (#1764FF) — the logo colour on light and dark backgrounds. */
export const REALY_BLUE = "#1764ff";

/**
 * The R mark. `tone`: "brand" (Realy Blue, default — use on light and dark surfaces), "mono" (currentColor, e.g. white
 * on Realy Blue or single-colour print), "tile" (white mark on the blue app-icon tile).
 */
export function BrandMark({ className, tone = "brand" }: { className?: string; tone?: "brand" | "mono" | "tile" }) {
  const svg = (fill: string, cls: string) => (
    <svg viewBox={R_MARK_VIEWBOX} className={cls} aria-hidden focusable="false">
      {R_MARK_PATHS.map((d) => (
        <path key={d} d={d} fill={fill} stroke={fill} strokeWidth={2.4} strokeLinejoin="round" />
      ))}
    </svg>
  );
  if (tone === "tile") {
    return (
      <span aria-hidden className={cn("inline-grid size-6 shrink-0 place-items-center rounded-[22%] bg-[linear-gradient(135deg,#2f78ff,#0b4fe6)]", className)}>
        {svg("#ffffff", "size-[62%]")}
      </span>
    );
  }
  return <span aria-hidden className={cn("inline-grid size-6 shrink-0 place-items-center", className)}>{svg(tone === "mono" ? "currentColor" : REALY_BLUE, "size-full")}</span>;
}

/** "Realy.si" wordmark — Sora Bold, ".si" in Realy Blue (white/current colour when `mono`). */
export function BrandName({ className, mono }: { className?: string; mono?: boolean }) {
  return (
    <span className={cn("font-display font-bold tracking-[-0.03em]", className)} translate="no">
      Realy<span className={mono ? undefined : "text-[#1764ff]"}>.si</span>
    </span>
  );
}

/** Horizontal lockup: R mark + "Realy.si" (mark ≈ 1.32 × cap height, gap ≈ 0.34 × cap). `product` adds a quiet suffix. */
export function BrandWordmark({ className, markClassName, product, mono }: { className?: string; markClassName?: string; product?: string; mono?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-[0.3em]", className)}>
      <BrandMark className={cn("size-[1.05em]", markClassName)} tone={mono ? "mono" : "brand"} />
      <BrandName mono={mono} />
      {product ? <span className="ms-1 font-medium text-muted-foreground">{product}</span> : null}
    </span>
  );
}

/** Realy Control (admin console) mark: the brand R mark on a Midnight tile. */
export function ControlMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-grid size-6 shrink-0 place-items-center rounded-[22%] bg-[#0b1220] ring-1 ring-[#1764ff]/40", className)}>
      <svg viewBox={R_MARK_VIEWBOX} className="size-[60%]" aria-hidden focusable="false">
        {R_MARK_PATHS.map((d) => (
          <path key={d} d={d} fill={REALY_BLUE} stroke={REALY_BLUE} strokeWidth={2.4} strokeLinejoin="round" />
        ))}
      </svg>
    </span>
  );
}
