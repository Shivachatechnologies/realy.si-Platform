"use client";

import { useId, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";

export interface SeriesDatum {
  /** Short axis label (e.g. "Nov 3"). */
  label: string;
  value: number | null;
  /** Formatted value for tooltips / screen readers. */
  display: string;
}

/**
 * Animated area chart for a real metric series: the line draws in, the area fades up, hovering (or focusing) shows a
 * crosshair with the exact value. Null buckets break the line (no invented values). A data table is rendered for
 * screen readers. Inherits the world accent.
 */
export function GrowthChart({ data, height = 180, className, ariaLabel }: { data: SeriesDatum[]; height?: number; className?: string; ariaLabel: string }) {
  const id = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = height;
  const pad = { t: 16, b: 22, x: 8 };
  const vals = data.map((d) => d.value).filter((v): v is number => v !== null);
  const max = Math.max(1, ...vals);
  const min = Math.min(0, ...vals);
  const x = (i: number) => pad.x + (i / Math.max(1, data.length - 1)) * (W - pad.x * 2);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min || 1)) * (H - pad.t - pad.b);
  // Segments of consecutive non-null points.
  const segs: number[][] = [];
  let cur: number[] = [];
  data.forEach((d, i) => {
    if (d.value === null) {
      if (cur.length) segs.push(cur);
      cur = [];
    } else cur.push(i);
  });
  if (cur.length) segs.push(cur);
  const line = (idx: number[]) => idx.map((i, k) => `${k ? "L" : "M"}${x(i).toFixed(1)} ${y(data[i]!.value!).toFixed(1)}`).join(" ");
  const area = (idx: number[]) => `${line(idx)} L${x(idx[idx.length - 1]!).toFixed(1)} ${H - pad.b} L${x(idx[0]!).toFixed(1)} ${H - pad.b} Z`;
  const h = hover !== null ? data[hover] : null;

  return (
    <figure className={cn("relative", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full overflow-visible"
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setHover((v) => Math.min(data.length - 1, (v ?? -1) + 1));
          if (e.key === "ArrowLeft") setHover((v) => Math.max(0, (v ?? data.length) - 1));
        }}
        onBlur={() => setHover(null)}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const rel = (e.clientX - r.left) / r.width;
          setHover(Math.max(0, Math.min(data.length - 1, Math.round(rel * (data.length - 1)))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--world-accent, var(--primary))" stopOpacity="0.32" />
            <stop offset="1" stopColor="var(--world-accent, var(--primary))" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}l`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--world-accent, var(--primary))" />
            <stop offset="1" stopColor="var(--world-accent-2, var(--primary-2))" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={pad.x} x2={W - pad.x} y1={pad.t + (1 - f) * (H - pad.t - pad.b)} y2={pad.t + (1 - f) * (H - pad.t - pad.b)} stroke="var(--border)" strokeDasharray="2 6" />
        ))}
        {segs.map((s, i) => (
          <motion.path key={`a${i}`} d={area(s)} fill={`url(#${id}a)`} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, delay: 0.3 }} />
        ))}
        {segs.map((s, i) =>
          s.length > 1 ? (
            <motion.path key={`l${i}`} d={line(s)} fill="none" stroke={`url(#${id}l)`} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.3, ease: [0.65, 0, 0.35, 1] }} />
          ) : (
            <circle key={`l${i}`} cx={x(s[0]!)} cy={y(data[s[0]!]!.value!)} r="3" fill="var(--world-accent, var(--primary))" />
          ),
        )}
        {hover !== null && h ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--border-strong)" />
            {h.value !== null ? <circle cx={x(hover)} cy={y(h.value)} r="5" fill="var(--surface)" stroke="var(--world-accent, var(--primary))" strokeWidth="2.5" /> : null}
          </g>
        ) : null}
        {data.map((d, i) =>
          i === 0 || i === data.length - 1 || i === Math.floor(data.length / 2) ? (
            <text key={i} x={x(i)} y={H - 4} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} className="fill-muted-foreground text-[11px]">
              {d.label}
            </text>
          ) : null,
        )}
      </svg>
      {h ? (
        <div className="pointer-events-none absolute top-0 rounded-md border bg-surface/95 px-2 py-1 text-xs shadow-elev-2 backdrop-blur" style={{ insetInlineStart: `clamp(0px, calc(${(x(hover!) / W) * 100}% - 40px), calc(100% - 90px))` }}>
          <div className="text-muted-foreground">{h.label}</div>
          <div className="numeral font-medium">{h.display}</div>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <tbody>
          {data.map((d, i) => (
            <tr key={i}>
              <th scope="row">{d.label}</th>
              <td>{d.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
