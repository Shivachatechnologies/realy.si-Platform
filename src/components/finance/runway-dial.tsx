/**
 * Runway dial: a half-circle gauge of how many months the cash lasts at the current net burn (0–24 months shown),
 * with the critical (< 3), warning (< 6) and healthy zones. Pure SVG, server-safe; the needle only fades in.
 */
const MAX = 24;
const R = 80;
const CX = 100;
const CY = 96;

function polar(v: number) {
  const a = Math.PI * (1 - Math.min(MAX, Math.max(0, v)) / MAX);
  return { x: CX + R * Math.cos(a), y: CY - R * Math.sin(a) };
}

function arc(from: number, to: number) {
  const a = polar(from);
  const b = polar(to);
  return `M${a.x},${a.y} A${R},${R} 0 0 1 ${b.x},${b.y}`;
}

export function RunwayDial({ months, label, valueText, scaleLabels }: { months: number | null; label: string; valueText: string; scaleLabels: { critical: string; warning: string; healthy: string } }) {
  const v = months === null ? MAX : Math.min(MAX, months);
  const tip = polar(v);
  const tone = months === null || months >= 6 ? "var(--success)" : months >= 3 ? "var(--warning)" : "var(--danger)";
  return (
    <figure className="grid justify-items-center gap-1">
      <svg viewBox="0 0 200 120" role="img" aria-label={`${label}: ${valueText}`} className="w-full max-w-[18rem]">
        <path d={arc(0, 3)} stroke="var(--danger)" strokeWidth={14} fill="none" strokeOpacity={0.8} />
        <path d={arc(3, 6)} stroke="var(--warning)" strokeWidth={14} fill="none" strokeOpacity={0.8} />
        <path d={arc(6, MAX)} stroke="var(--success)" strokeWidth={14} fill="none" strokeOpacity={0.35} />
        <line x1={CX} y1={CY} x2={tip.x} y2={tip.y} stroke={tone} strokeWidth={4} strokeLinecap="round" className="animate-fade-in" />
        <circle cx={CX} cy={CY} r={7} fill={tone} />
        <text x={CX - R} y={CY + 18} textAnchor="middle" className="fill-muted-foreground text-[9px]">
          0
        </text>
        <text x={CX + R} y={CY + 18} textAnchor="middle" className="fill-muted-foreground text-[9px]">
          {MAX}+
        </text>
      </svg>
      <figcaption className="grid justify-items-center gap-1 text-center">
        <span className="font-display text-3xl" style={{ color: tone }}>
          {valueText}
        </span>
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="mt-1 flex flex-wrap justify-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span aria-hidden className="size-2 rounded-full bg-danger" />
            {scaleLabels.critical}
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="size-2 rounded-full bg-warning" />
            {scaleLabels.warning}
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="size-2 rounded-full bg-success" />
            {scaleLabels.healthy}
          </span>
        </span>
      </figcaption>
    </figure>
  );
}
