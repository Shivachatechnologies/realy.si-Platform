export interface KpiDelta {
  /** Percent change vs the previous period; null when the previous period was 0 (then `text` says "new"). */
  pct: number | null;
  direction: "up" | "down" | "flat";
  /** Is this direction good for this metric (null: neutral)? */
  good: boolean | null;
  text: string;
}

/** Percent change of `value` vs `previous`, judged by which direction is good. */
export function kpiDelta(value: number | null, previous: number | null, better: "up" | "down" = "up", fmt: (pct: number) => string, newLabel: string): KpiDelta | null {
  if (value === null || previous === null) return null;
  if (value === previous) return { pct: 0, direction: "flat", good: null, text: fmt(0) };
  const direction = value > previous ? "up" : "down";
  const good = direction === better;
  if (previous === 0) return { pct: null, direction, good, text: newLabel };
  const pct = ((value - previous) / previous) * 100;
  return { pct, direction, good, text: fmt(pct) };
}
