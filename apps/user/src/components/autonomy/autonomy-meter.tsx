import { cn } from "@/lib/utils";

const TONES = {
  OFF: "stroke-foreground/35",
  SUGGEST: "stroke-info",
  ASK: "stroke-warning",
  AUTO: "stroke-success",
} as const;
const DOTS = { OFF: "bg-foreground/35", SUGGEST: "bg-info", ASK: "bg-warning", AUTO: "bg-success" } as const;

/**
 * How independent a department is: a ring split by how many action classes sit at each level (from its real rules),
 * with the share on Auto in the middle. Server-rendered SVG, no animation.
 */
export function AutonomyMeter({
  counts,
  labels,
  size = 64,
  className,
}: {
  counts: Record<keyof typeof TONES, number>;
  labels: Record<keyof typeof TONES, string> & { summary: string };
  size?: number;
  className?: string;
}) {
  const total = Object.values(counts).reduce((s, n) => s + n, 0) || 1;
  const r = 15.9155; // circumference 100
  let offset = 25;
  const segments = (Object.keys(TONES) as (keyof typeof TONES)[])
    .filter((k) => counts[k] > 0)
    .map((k) => {
      const len = (counts[k] / total) * 100;
      const seg = { k, len, offset };
      offset -= len;
      return seg;
    });
  return (
    <figure className={cn("flex items-center gap-3", className)}>
      <svg viewBox="0 0 42 42" width={size} height={size} role="img" aria-label={labels.summary} className="shrink-0">
        <circle cx="21" cy="21" r={r} fill="none" className="stroke-muted" strokeWidth="5" />
        {segments.map((s) => (
          <circle key={s.k} cx="21" cy="21" r={r} fill="none" className={TONES[s.k]} strokeWidth="5" strokeDasharray={`${s.len} ${100 - s.len}`} strokeDashoffset={s.offset} />
        ))}
        <text x="21" y="23.5" textAnchor="middle" className="fill-foreground text-[8px] font-semibold tabular-nums">
          {Math.round((counts.AUTO / total) * 100)}%
        </text>
      </svg>
      <figcaption className="grid gap-0.5 text-[11px] text-muted-foreground">
        {(Object.keys(TONES) as (keyof typeof TONES)[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-full", DOTS[k])} />
            {labels[k]} · <span className="tabular">{counts[k]}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
