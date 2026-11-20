"use client";

import { useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Animated, accessible SVG charts shared by Sales OS and Finance OS. Values are plain numbers (major units are fine —
 * charts only compare magnitudes); every chart takes a `format` for labels and an `label` for its accessible name, and
 * renders a visually hidden data table for screen readers. Motion is skipped under reduced motion.
 */

export interface Series {
  name: string;
  values: number[];
  /** CSS color (token), e.g. "var(--success)". */
  color: string;
  /** Fill the area under the line. */
  area?: boolean;
  dashed?: boolean;
}

const W = 640;
const H = 220;
const PAD = { t: 14, r: 12, b: 28, l: 12 };

function scale(values: number[], zeroBased = true) {
  const min = Math.min(zeroBased ? 0 : Infinity, ...values);
  const max = Math.max(zeroBased ? 0 : -Infinity, ...values);
  const span = max - min || 1;
  return { min, max, y: (v: number) => PAD.t + (1 - (v - min) / span) * (H - PAD.t - PAD.b) };
}

/** Smooth path through points (monotone-ish cubic). */
export function smoothPath(points: [number, number][]) {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0]![0]},${points[0]![1]}`;
  let d = `M${points[0]![0]},${points[0]![1]}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}

function SrTable({ caption, labels, series, format }: { caption: string; labels: string[]; series: { name: string; values: number[] }[]; format: (v: number) => string }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">—</th>
          {series.map((s) => (
            <th key={s.name} scope="col">
              {s.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {labels.map((l, i) => (
          <tr key={l}>
            <th scope="row">{l}</th>
            {series.map((s) => (
              <td key={s.name}>{format(s.values[i] ?? 0)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Legend({ items }: { items: { name: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-hidden>
      {items.map((i) => (
        <li key={i.name} className="flex items-center gap-1.5">
          <span className={cn("inline-block h-0.5 w-4 rounded-full", i.dashed && "border-t-2 border-dashed bg-transparent")} style={i.dashed ? { borderColor: i.color } : { background: i.color }} />
          {i.name}
        </li>
      ))}
    </ul>
  );
}

/** Line/area chart over months with a hover read-out. */
export function LineChart({ labels, series, format, label, height = H, band }: {
  labels: string[];
  series: Series[];
  format: (v: number) => string;
  label: string;
  height?: number;
  /** Optional shaded range (e.g. forecast low/high). */
  band?: { low: number[]; high: number[]; color: string; name: string };
}) {
  const reduced = useReducedMotion();
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const all = [...series.flatMap((s) => s.values), ...(band ? [...band.low, ...band.high] : [])];
  const { y, min } = scale(all.length ? all : [0]);
  const n = Math.max(1, labels.length);
  const x = (i: number) => PAD.l + (n === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const zeroY = y(Math.max(0, min));
  const step = Math.max(1, Math.ceil(n / 8));
  return (
    <figure className="grid gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full overflow-visible" style={{ maxHeight: height }} onMouseLeave={() => setHover(null)}>
        <defs>
          {series.map((s, si) => (
            <linearGradient key={s.name} id={`${id}-g${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: s.color, stopOpacity: 0.28 }} />
              <stop offset="100%" style={{ stopColor: s.color, stopOpacity: 0 }} />
            </linearGradient>
          ))}
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + f * (H - PAD.t - PAD.b)} y2={PAD.t + f * (H - PAD.t - PAD.b)} stroke="var(--border)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY} stroke="var(--border-strong)" vectorEffect="non-scaling-stroke" />
        {band ? (
          <motion.path
            d={`${smoothPath(band.high.map((v, i) => [x(i), y(v)]))} L${band.low
              .map((v, i) => [x(i), y(v)] as [number, number])
              .reverse()
              .map(([a, b]) => `${a},${b}`)
              .join(" L")} Z`}
            fill={band.color}
            fillOpacity={0.14}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.3 }}
          />
        ) : null}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => [x(i), y(v)] as [number, number]);
          const d = smoothPath(pts);
          return (
            <g key={s.name}>
              {s.area && pts.length > 1 ? (
                <motion.path
                  d={`${d} L${pts[pts.length - 1]![0]},${zeroY} L${pts[0]![0]},${zeroY} Z`}
                  fill={`url(#${id}-g${si})`}
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.9, delay: 0.2 + si * 0.1 }}
                />
              ) : null}
              <motion.path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={2.25}
                strokeLinecap="round"
                strokeDasharray={s.dashed ? "5 5" : undefined}
                vectorEffect="non-scaling-stroke"
                initial={reduced || s.dashed ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.1, delay: si * 0.15, ease: [0.16, 1, 0.3, 1] }}
              />
            </g>
          );
        })}
        {labels.map((l, i) =>
          i % step === 0 || i === n - 1 ? (
            <text key={l} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {l}
            </text>
          ) : null,
        )}
        {labels.map((l, i) => (
          <rect key={`h-${l}`} x={x(i) - (W / n) / 2} y={0} width={W / n} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} />
        ))}
        {hover !== null ? (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--border-strong)" vectorEffect="non-scaling-stroke" />
            {series.map((s) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={3.5} fill="var(--surface)" stroke={s.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        ) : null}
      </svg>
      {hover !== null ? (
        <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums" aria-hidden>
          <span className="font-medium">{labels[hover]}</span>
          {series.map((s) => (
            <span key={s.name} style={{ color: s.color }}>
              {s.name}: {format(s.values[hover] ?? 0)}
            </span>
          ))}
          {band ? (
            <span className="text-muted-foreground">
              {band.name}: {format(band.low[hover] ?? 0)} – {format(band.high[hover] ?? 0)}
            </span>
          ) : null}
        </figcaption>
      ) : (
        <Legend items={[...series.map((s) => ({ name: s.name, color: s.color, dashed: s.dashed })), ...(band ? [{ name: band.name, color: band.color }] : [])]} />
      )}
      <SrTable caption={label} labels={labels} series={[...series, ...(band ? [{ name: `${band.name} (low)`, values: band.low }, { name: `${band.name} (high)`, values: band.high }] : [])]} format={format} />
    </figure>
  );
}

/** Grouped bars per period (e.g. money in vs. money out), growing from the baseline. */
export function BarsChart({ labels, series, format, label, height = 200 }: { labels: string[]; series: Series[]; format: (v: number) => string; label: string; height?: number }) {
  const reduced = useReducedMotion();
  const all = series.flatMap((s) => s.values);
  const { y } = scale(all.length ? all : [0]);
  const n = Math.max(1, labels.length);
  const slot = (W - PAD.l - PAD.r) / n;
  const bw = Math.min(26, (slot * 0.7) / Math.max(1, series.length));
  const zeroY = y(0);
  const step = Math.max(1, Math.ceil(n / 8));
  return (
    <figure className="grid gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full" style={{ maxHeight: height }}>
        <line x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY} stroke="var(--border-strong)" vectorEffect="non-scaling-stroke" />
        {labels.map((l, i) => (
          <g key={l}>
            {series.map((s, si) => {
              const v = s.values[i] ?? 0;
              const top = Math.min(y(v), zeroY);
              const h = Math.abs(zeroY - y(v));
              const bx = PAD.l + i * slot + slot / 2 - (bw * series.length) / 2 + si * bw;
              return (
                <motion.rect
                  key={s.name}
                  x={bx + 1}
                  width={Math.max(1, bw - 2)}
                  y={top}
                  height={h}
                  rx={3}
                  fill={s.color}
                  style={{ transformOrigin: `${bx}px ${zeroY}px` }}
                  initial={reduced ? false : { scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: 0.7, delay: i * 0.04 + si * 0.05, ease: [0.16, 1, 0.3, 1] }}
                >
                  <title>{`${l} · ${s.name}: ${format(v)}`}</title>
                </motion.rect>
              );
            })}
            {i % step === 0 || i === n - 1 ? (
              <text x={PAD.l + i * slot + slot / 2} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {l}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <Legend items={series.map((s) => ({ name: s.name, color: s.color }))} />
      <SrTable caption={label} labels={labels} series={series} format={format} />
    </figure>
  );
}

/** Semicircle gauge (e.g. profit margin) from `min` to `max`; the needle sweeps to the value. */
export function Gauge({ value, min = -0.5, max = 0.5, label, valueText, tone }: { value: number | null; min?: number; max?: number; label: string; valueText: string; tone: "success" | "warning" | "danger" | "neutral" }) {
  const reduced = useReducedMotion();
  const ratio = value === null ? 0.5 : Math.min(1, Math.max(0, (value - min) / (max - min)));
  const angle = -90 + ratio * 180;
  const color = { success: "var(--success)", warning: "var(--warning)", danger: "var(--danger)", neutral: "var(--muted-foreground)" }[tone];
  const arc = (from: number, to: number) => {
    const p = (a: number) => [100 + 80 * Math.cos(((a - 180) * Math.PI) / 180), 100 + 80 * Math.sin(((a - 180) * Math.PI) / 180)];
    const [x0, y0] = p(from * 180);
    const [x1, y1] = p(to * 180);
    return `M${x0},${y0} A80,80 0 0 1 ${x1},${y1}`;
  };
  return (
    <figure className="grid justify-items-center gap-1" role="img" aria-label={`${label}: ${valueText}`}>
      <svg viewBox="0 0 200 116" className="w-full max-w-[220px]" aria-hidden>
        <path d={arc(0, 0.5)} stroke="var(--danger)" strokeOpacity={0.25} strokeWidth={14} fill="none" strokeLinecap="round" />
        <path d={arc(0.5, 0.65)} stroke="var(--warning)" strokeOpacity={0.3} strokeWidth={14} fill="none" />
        <path d={arc(0.65, 1)} stroke="var(--success)" strokeOpacity={0.3} strokeWidth={14} fill="none" strokeLinecap="round" />
        <motion.path d={arc(0, ratio || 0.0001)} stroke={color} strokeWidth={14} fill="none" strokeLinecap="round" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }} />
        <motion.g style={{ originX: "100px", originY: "100px" }} initial={reduced ? false : { rotate: -90 }} animate={{ rotate: angle }} transition={{ type: "spring", stiffness: 60, damping: 12 }}>
          <line x1={100} y1={100} x2={100} y2={34} stroke="var(--foreground)" strokeWidth={2.5} strokeLinecap="round" />
        </motion.g>
        <circle cx={100} cy={100} r={6} fill="var(--foreground)" />
      </svg>
      <figcaption className="text-center">
        <span className="block text-xl font-semibold tabular-nums" style={{ color }}>
          {valueText}
        </span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </figcaption>
    </figure>
  );
}

/** Small circular score ring (0–100). */
export function ScoreRing({ score, tone, label }: { score: number; tone: "danger" | "warning" | "info"; label: string }) {
  const reduced = useReducedMotion();
  const c = 2 * Math.PI * 16;
  const color = { danger: "var(--danger)", warning: "var(--warning)", info: "var(--info)" }[tone];
  return (
    <svg viewBox="0 0 40 40" className="size-11 shrink-0" role="img" aria-label={label}>
      <circle cx={20} cy={20} r={16} fill="none" stroke="var(--muted)" strokeWidth={4} />
      <motion.circle
        cx={20}
        cy={20}
        r={16}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={c}
        transform="rotate(-90 20 20)"
        initial={reduced ? false : { strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - Math.min(100, Math.max(0, score)) / 100) }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
      />
      <text x={20} y={24} textAnchor="middle" className="fill-foreground text-[11px] font-semibold">
        {score}
      </text>
    </svg>
  );
}
