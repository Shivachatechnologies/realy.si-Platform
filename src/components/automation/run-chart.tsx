"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/client";

export interface RunDay {
  date: string;
  succeeded: number;
  failed: number;
  other: number;
}

/**
 * Runs per day as stacked bars (succeeded / failed / still open) on one axis. Status colours come from the design
 * tokens and are always paired with the legend + tooltip text; an sr-only table carries the same numbers.
 */
export function RunChart({ days }: { days: RunDay[] }) {
  const { t, locale } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 180;
  const pad = { l: 28, r: 8, t: 10, b: 22 };
  const max = Math.max(1, ...days.map((d) => d.succeeded + d.failed + d.other));
  const step = (W - pad.l - pad.r) / days.length;
  const bw = Math.max(6, Math.min(28, step - 8));
  const y = (v: number) => ((H - pad.t - pad.b) * v) / max;
  const fmt = (d: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const ticks = [0, Math.ceil(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
  const series = [
    { key: "succeeded" as const, color: "var(--success)", label: t("workflows.monitor.succeeded") },
    { key: "failed" as const, color: "var(--danger)", label: t("workflows.monitor.failed") },
    { key: "other" as const, color: "color-mix(in oklch, var(--muted-foreground) 45%, transparent)", label: t("workflows.monitor.open") },
  ];
  const h = hover !== null ? days[hover] : null;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t("workflows.monitor.chartAria")} onMouseLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={H - pad.b - y(v)} y2={H - pad.b - y(v)} stroke="var(--border)" strokeWidth={1} strokeDasharray={v ? "2 4" : undefined} />
              <text x={pad.l - 6} y={H - pad.b - y(v)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[10px] tabular-nums">
                {v}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const x = pad.l + i * step + (step - bw) / 2;
            let base = H - pad.b;
            const segs = series
              .map((s) => ({ ...s, v: d[s.key] }))
              .filter((s) => s.v > 0)
              .map((s, k, arr) => {
                const hgt = Math.max(2, y(s.v) - (k < arr.length - 1 ? 2 : 0));
                const top = base - hgt;
                base = top - 2;
                const last = k === arr.length - 1;
                return <path key={s.key} d={last ? `M${x},${top + hgt} V${top + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${top + hgt} Z` : `M${x},${top} h${bw} v${hgt} h${-bw} Z`} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.45} />;
              });
            return (
              <g key={d.date}>
                {segs}
                {i % Math.ceil(days.length / 7) === 0 || i === days.length - 1 ? (
                  <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                    {fmt(d.date)}
                  </text>
                ) : null}
                <rect x={pad.l + i * step} y={pad.t} width={step} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${fmt(d.date)}: ${d.succeeded} / ${d.failed} / ${d.other}`} />
              </g>
            );
          })}
        </svg>
        {h && hover !== null ? (
          <div className="pointer-events-none absolute top-0 z-10 rounded-md border bg-surface px-2.5 py-1.5 text-xs shadow-lg" style={{ insetInlineStart: `${Math.min(80, Math.max(0, ((pad.l + hover * step) / W) * 100))}%` }}>
            <p className="font-medium">{fmt(h.date)}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center gap-1.5 tabular-nums">
                <span className="size-2 rounded-sm" style={{ background: s.color }} />
                {s.label}: {h[s.key]}
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <table className="sr-only">
        <caption>{t("workflows.monitor.chartAria")}</caption>
        <thead>
          <tr>
            <th>{t("workflows.monitor.day")}</th>
            {series.map((s) => (
              <th key={s.key}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.succeeded}</td>
              <td>{d.failed}</td>
              <td>{d.other}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
