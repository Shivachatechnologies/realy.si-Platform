/**
 * Small, dependency-free SVG charts (server components). Every chart has an accessible name and a visually hidden
 * data table; missing values (null) are gaps.
 */

export interface ChartPoint {
  label: string;
  value: number | null;
  /** Formatted value for tooltips and the data table. */
  display: string;
}

const W = 600;
const H = 180;
const PAD = { top: 12, right: 8, bottom: 22, left: 8 };

function scale(points: ChartPoint[]) {
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const span = max - min || 1;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  return {
    x: (i: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW),
    y: (v: number) => PAD.top + innerH - ((v - min) / span) * innerH,
    zero: PAD.top + innerH - ((0 - min) / span) * innerH,
    innerW,
    min,
    max,
    hasData: vals.length > 0,
  };
}

function DataTable({ title, points, labels }: { title: string; points: ChartPoint[]; labels: { period: string; value: string } }) {
  return (
    <table className="sr-only">
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">{labels.period}</th>
          <th scope="col">{labels.value}</th>
        </tr>
      </thead>
      <tbody>
        {points.map((p, i) => (
          <tr key={i}>
            <td>{p.label}</td>
            <td>{p.display}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Line or bar chart over consecutive periods. */
export function TrendChart({
  title,
  points,
  type = "line",
  emptyLabel,
  tableLabels,
  maxLabel,
}: {
  title: string;
  points: ChartPoint[];
  type?: "line" | "bar";
  emptyLabel: string;
  tableLabels: { period: string; value: string };
  /** Formatted maximum, shown at the top-start corner. */
  maxLabel?: string;
}) {
  const s = scale(points);
  if (!s.hasData) return <p className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  const segments: string[][] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push(`${s.x(i).toFixed(1)},${s.y(p.value).toFixed(1)}`);
  });
  if (current.length) segments.push(current);
  const barW = Math.max(2, (s.innerW / Math.max(points.length, 1)) * 0.7);
  return (
    <figure className="grid gap-1">
      <div className="relative">
        {maxLabel ? <span className="absolute start-1 top-0 text-[10px] text-muted-foreground tabular">{maxLabel}</span> : null}
        <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full text-primary" role="img" aria-label={title} preserveAspectRatio="none">
          <line x1={PAD.left} x2={W - PAD.right} y1={s.zero} y2={s.zero} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {type === "bar"
            ? points.map((p, i) =>
                p.value === null ? null : (
                  <rect key={i} x={s.x(i) - barW / 2} width={barW} y={Math.min(s.y(p.value), s.zero)} height={Math.max(1, Math.abs(s.zero - s.y(p.value)))} rx={1.5} className="fill-current opacity-80">
                    <title>{`${p.label}: ${p.display}`}</title>
                  </rect>
                ),
              )
            : segments.map((seg, i) => <polyline key={i} points={seg.join(" ")} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
          {type === "line"
            ? points.map((p, i) =>
                p.value === null ? null : (
                  <circle key={i} cx={s.x(i)} cy={s.y(p.value)} r={points.length > 40 ? 0 : 2.5} className="fill-current">
                    <title>{`${p.label}: ${p.display}`}</title>
                  </circle>
                ),
              )
            : null}
        </svg>
      </div>
      <figcaption className="flex justify-between text-[10px] text-muted-foreground tabular" aria-hidden>
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </figcaption>
      <DataTable title={title} points={points} labels={tableLabels} />
    </figure>
  );
}

/** Tiny inline trend line (decorative; the value next to it carries the meaning). */
export function Sparkline({ values }: { values: (number | null)[] }) {
  const pts = values.map((v, i) => ({ label: String(i), value: v, display: "" }));
  const s = scale(pts);
  if (!s.hasData || values.length < 2) return null;
  const line = pts
    .map((p, i) => (p.value === null ? null : `${s.x(i).toFixed(1)},${s.y(p.value).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-6 w-20 text-primary" aria-hidden preserveAspectRatio="none">
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
