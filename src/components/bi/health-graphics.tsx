/**
 * Business-health graphics (server components, pure SVG): the health score dial, department score bars and the
 * forecast chart (actual weekly history as a solid line, the least-squares projection dashed on a hatched band).
 * Each has an accessible name and a hidden data table.
 */

export interface ForecastPoint {
  label: string;
  value: number | null;
  display: string;
}

const tone = (score: number | null) => (score === null ? "var(--muted-foreground)" : score >= 65 ? "var(--success)" : score >= 45 ? "var(--warning)" : "var(--danger)");

export function HealthDial({ score, label, caption }: { score: number | null; label: string; caption: string }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const arc = 0.75; // 270° gauge
  const filled = score === null ? 0 : (score / 100) * c * arc;
  return (
    <figure className="relative grid place-items-center">
      <svg viewBox="0 0 180 180" className="size-48 sm:size-56" role="img" aria-label={label}>
        <defs>
          <linearGradient id="health-dial" x1="0" x2="1" y1="1" y2="0">
            <stop offset="0%" style={{ stopColor: "var(--primary-2, var(--primary))" }} />
            <stop offset="100%" style={{ stopColor: tone(score) }} />
          </linearGradient>
        </defs>
        <g transform="rotate(135 90 90)">
          <circle cx="90" cy="90" r={r} fill="none" stroke="var(--border)" strokeWidth="12" strokeDasharray={`${c * arc} ${c}`} strokeLinecap="round" />
          <circle cx="90" cy="90" r={r} fill="none" stroke="url(#health-dial)" strokeWidth="12" strokeDasharray={`${filled} ${c}`} strokeLinecap="round" className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-1000" />
        </g>
        {Array.from({ length: 11 }, (_, i) => {
          const a = ((135 + i * 27) * Math.PI) / 180;
          return <line key={i} x1={90 + Math.cos(a) * 84} y1={90 + Math.sin(a) * 84} x2={90 + Math.cos(a) * 88} y2={90 + Math.sin(a) * 88} stroke="var(--border-strong, var(--border))" strokeWidth="1" />;
        })}
      </svg>
      <figcaption className="absolute inset-0 grid place-content-center text-center">
        <span className="numeral font-display text-6xl leading-none" style={{ color: tone(score) }}>
          {score ?? "—"}
        </span>
        <span className="mt-1 text-xs text-muted-foreground">{caption}</span>
      </figcaption>
    </figure>
  );
}

export function DepartmentBars({ rows, title }: { rows: { key: string; label: string; score: number | null; note: string; href: string }[]; title: string }) {
  return (
    <ul className="grid gap-3" aria-label={title}>
      {rows.map((r) => (
        <li key={r.key}>
          <a href={r.href} className="group grid gap-1.5 rounded-lg p-1 hover:bg-muted/50">
            <span className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium group-hover:underline">{r.label}</span>
              <span className="numeral font-mono text-xs" style={{ color: tone(r.score) }}>
                {r.score ?? "—"}
              </span>
            </span>
            <span className="relative h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className="absolute inset-y-0 start-0 rounded-full motion-safe:transition-[width] motion-safe:duration-700" style={{ width: `${r.score ?? 0}%`, background: tone(r.score) }} />
              <span className="absolute inset-y-0 start-1/2 w-px bg-background/80" />
            </span>
            <span className="text-[11px] text-muted-foreground">{r.note}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

const W = 600;
const H = 200;
const PAD = { top: 14, right: 10, bottom: 24, left: 10 };

export function ForecastChart({ title, history, projection, labels }: { title: string; history: ForecastPoint[]; projection: ForecastPoint[]; labels: { period: string; value: string; actual: string; projected: string } }) {
  const all = [...history, ...projection];
  const vals = all.map((p) => p.value).filter((v): v is number => v !== null);
  const max = Math.max(0, ...vals) || 1;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (all.length <= 1 ? innerW / 2 : (i / (all.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const line = (pts: { i: number; v: number | null }[]) =>
    pts.reduce((d, p, k) => (p.v === null ? d : `${d}${d && pts[k - 1]?.v !== null ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`), "");
  const hist = history.map((p, i) => ({ i, v: p.value }));
  const lastActual = [...hist].reverse().find((p) => p.v !== null);
  const proj = [...(lastActual ? [lastActual] : []), ...projection.map((p, k) => ({ i: history.length + k, v: p.value }))];
  const splitX = x(history.length - 0.5);
  return (
    <figure className="grid gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={title}>
        <defs>
          <pattern id="forecast-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--primary)" strokeOpacity="0.12" strokeWidth="3" />
          </pattern>
          <linearGradient id="forecast-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--primary)", stopOpacity: 0.22 }} />
            <stop offset="100%" style={{ stopColor: "var(--primary)", stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <rect x={splitX} y={PAD.top} width={W - PAD.right - splitX} height={innerH} fill="url(#forecast-hatch)" />
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} stroke="var(--border)" />
        {lastActual ? <path d={`${line(hist)}L${x(lastActual.i)},${PAD.top + innerH}L${x(hist.find((p) => p.v !== null)!.i)},${PAD.top + innerH}Z`} fill="url(#forecast-fill)" /> : null}
        <path d={line(hist)} fill="none" stroke="var(--primary)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <path d={line(proj)} fill="none" stroke="var(--primary)" strokeWidth="2" strokeDasharray="6 5" strokeLinecap="round" />
        {projection.map((p, k) => (p.value !== null ? <circle key={k} cx={x(history.length + k)} cy={y(p.value)} r="3" fill="var(--surface)" stroke="var(--primary)" strokeWidth="1.5" /> : null))}
        <text x={splitX + 6} y={PAD.top + 10} fontSize="10" fill="var(--muted-foreground)">
          {labels.projected}
        </text>
        <text x={PAD.left} y={H - 6} fontSize="10" fill="var(--muted-foreground)">
          {history[0]?.label}
        </text>
        <text x={W - PAD.right} y={H - 6} fontSize="10" textAnchor="end" fill="var(--muted-foreground)">
          {projection[projection.length - 1]?.label}
        </text>
      </svg>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.period}</th>
            <th scope="col">{labels.value}</th>
          </tr>
        </thead>
        <tbody>
          {history.map((p, i) => (
            <tr key={`h${i}`}>
              <td>
                {p.label} ({labels.actual})
              </td>
              <td>{p.display}</td>
            </tr>
          ))}
          {projection.map((p, i) => (
            <tr key={`p${i}`}>
              <td>
                {p.label} ({labels.projected})
              </td>
              <td>{p.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
