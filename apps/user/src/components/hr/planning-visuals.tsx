import { cn } from "@/lib/utils";

/**
 * Workforce planning graphics (pure SVG / CSS, server-safe, from real plan rows):
 * - HeadcountTrajectory: today's headcount and the planned team size after each quarter (step line + people added).
 * - DepartmentBars: per department, people today vs planned additions.
 */

export function HeadcountTrajectory({
  current,
  quarters,
  title,
  todayLabel,
}: {
  current: number;
  quarters: { key: string; label: string; people: number; cost: string }[];
  title: string;
  todayLabel: string;
}) {
  const points = [{ key: "today", label: todayLabel, people: 0, total: current, cost: "" }];
  let total = current;
  for (const q of quarters) {
    total += q.people;
    points.push({ key: q.key, label: q.label, people: q.people, total, cost: q.cost });
  }
  const W = 640;
  const H = 220;
  const P = { t: 28, r: 24, b: 44, l: 24 };
  const max = Math.max(1, ...points.map((p) => p.total));
  const step = points.length > 1 ? (W - P.l - P.r) / (points.length - 1) : 0;
  const x = (i: number) => P.l + i * step;
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - v / max);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.total)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},${H - P.b} L${x(0)},${H - P.b} Z`;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="min-w-[420px]">
        <title>{title}</title>
        <defs>
          <linearGradient id="hc-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--primary)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} stroke="var(--border)" />
        {points.length > 1 ? <path d={area} fill="url(#hc-area)" className="animate-fade-in" /> : null}
        {points.length > 1 ? <path d={line} fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinejoin="round" /> : null}
        {points.map((p, i) => (
          <g key={p.key}>
            <circle cx={x(i)} cy={y(p.total)} r={i === 0 ? 6 : 5} fill={i === 0 ? "var(--foreground)" : "var(--primary)"} stroke="var(--surface)" strokeWidth={2}>
              <title>{`${p.label}: ${p.total}${p.people ? ` (+${p.people})` : ""}`}</title>
            </circle>
            <text x={x(i)} y={y(p.total) - 12} textAnchor="middle" className="fill-foreground text-[12px] font-semibold">
              {p.total}
            </text>
            {p.people ? (
              <text x={x(i)} y={H - P.b + 30} textAnchor="middle" className="fill-success text-[10px] font-medium">
                +{p.people}
                {p.cost ? ` · ${p.cost}` : ""}
              </text>
            ) : null}
            <text x={x(i)} y={H - P.b + 16} textAnchor="middle" className="fill-muted-foreground text-[11px]">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function DepartmentBars({
  rows,
  labels,
}: {
  rows: { key: string; name: string; current: number; planned: number; cost: string }[];
  labels: { current: string; planned: string };
}) {
  const max = Math.max(1, ...rows.map((r) => r.current + r.planned));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-foreground/70" />
          {labels.current}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-primary" />
          {labels.planned}
        </span>
      </div>
      <ul className="grid gap-2.5">
        {rows.map((r) => (
          <li key={r.key} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-medium">{r.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {r.current}
                {r.planned ? <span className="text-primary"> +{r.planned}</span> : null}
                {r.planned && r.cost ? ` · ${r.cost}` : ""}
              </span>
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${r.name}: ${labels.current} ${r.current}, ${labels.planned} ${r.planned}`}>
              <span className="h-full bg-foreground/70" style={{ width: `${(r.current / max) * 100}%` }} />
              <span className={cn("h-full bg-primary", r.current ? "border-s border-surface" : "")} style={{ width: `${(r.planned / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
