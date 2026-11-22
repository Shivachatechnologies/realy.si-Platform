"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Pause, Play } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { LiveDot } from "@/components/motion/live-dot";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";

/**
 * "Realy Control" visualizations: dependency-free SVG animated with motion (transform/opacity/path length only).
 * Every chart renders exactly the numbers it is given, has an accessible name, and a visually hidden data table.
 * Motion is skipped when the OS asks for reduced motion.
 */

export type VizTone = "primary" | "success" | "danger" | "warning" | "info" | "muted";
export type VizFormat = "integer" | "compact" | "usdMicros" | "percent";

const COLOR: Record<VizTone, string> = {
  primary: "var(--primary)",
  success: "var(--success)",
  danger: "var(--danger)",
  warning: "var(--warning)",
  info: "var(--info)",
  muted: "var(--muted-foreground)",
};

export function useVizFormat() {
  const { locale } = useI18n();
  return useMemo(() => {
    const int = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
    const pct = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
    const usd = (micros: number) =>
      new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: micros < 10_000_000 ? 2 : 0 }).format(micros / 1_000_000);
    return (v: number, f: VizFormat = "integer") => (f === "compact" ? compact.format(v) : f === "usdMicros" ? usd(v) : f === "percent" ? pct.format(v) : int.format(v));
  }, [locale]);
}

function useDayLabel() {
  const { locale } = useI18n();
  return useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });
    return (day: string) => f.format(new Date(`${day}T00:00:00Z`));
  }, [locale]);
}

function linePath(values: number[], w: number, h: number, pad = 2) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = pts.length ? `${line} L${pts[pts.length - 1]![0].toFixed(2)},${h} L${pts[0]![0].toFixed(2)},${h} Z` : "";
  return { line, area, pts, max };
}

/** Tiny trend line for KPI tiles. */
export function Sparkline({ values, label, tone = "primary", className }: { values: number[]; label: string; tone?: VizTone; className?: string }) {
  const id = useId();
  const reduce = useReducedMotion();
  const W = 120;
  const H = 32;
  const { line, area } = linePath(values, W, H);
  const empty = values.every((v) => v === 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className={cn("h-8 w-full overflow-visible", className)}>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={COLOR[tone]} stopOpacity={0.28} />
          <stop offset="100%" stopColor={COLOR[tone]} stopOpacity={0} />
        </linearGradient>
      </defs>
      {empty ? (
        <line x1="2" x2={W - 2} y1={H - 2} y2={H - 2} stroke="var(--border-strong)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      ) : (
        <>
          <motion.path d={area} fill={`url(#${id}-g)`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.3 }} />
          <motion.path
            d={line}
            fill="none"
            stroke={COLOR[tone]}
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          />
        </>
      )}
    </svg>
  );
}

export interface TrendSeries {
  label: string;
  values: number[];
  tone?: VizTone;
  format?: VizFormat;
}

/** Area/line chart over days with a keyboard- and pointer-driven crosshair and a hidden data table. */
export function TrendChart({ days, series, title, height = 180, className }: { days: string[]; series: TrendSeries[]; title: string; height?: number; className?: string }) {
  const id = useId();
  const reduce = useReducedMotion();
  const fmt = useVizFormat();
  const dayLabel = useDayLabel();
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const W = 640;
  const H = height;
  const P = { t: 10, b: 22 };
  const innerH = H - P.t - P.b;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const step = days.length > 1 ? W / (days.length - 1) : 0;
  const x = (i: number) => i * step;
  const y = (v: number) => P.t + innerH - (v / max) * innerH;
  const hasData = series.some((s) => s.values.some((v) => v > 0));
  const at = hover ?? days.length - 1;
  const onMove = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !days.length) return;
    let ratio = (clientX - r.left) / r.width;
    if (document.dir === "rtl") ratio = 1 - ratio;
    setHover(Math.max(0, Math.min(days.length - 1, Math.round(ratio * (days.length - 1)))));
  };
  return (
    <figure className={cn("grid gap-2", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-hidden>
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: COLOR[s.tone ?? "primary"] }} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-medium tabular-nums">{fmt(s.values[at] ?? 0, s.format)}</span>
          </span>
        ))}
        <span className="ms-auto text-muted-foreground tabular-nums">{days[at] ? dayLabel(days[at]) : ""}</span>
      </div>
      <div className="relative">
        <svg
          ref={ref}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block w-full touch-none overflow-visible rtl:-scale-x-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring rounded-sm"
          style={{ height: H }}
          role="img"
          aria-label={title}
          tabIndex={0}
          onPointerMove={(e) => onMove(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              const dir = (e.key === "ArrowRight" ? 1 : -1) * (document.dir === "rtl" ? -1 : 1);
              setHover((h) => Math.max(0, Math.min(days.length - 1, (h ?? days.length - 1) + dir)));
            }
          }}
          onBlur={() => setHover(null)}
        >
          <defs>
            {series.map((s, i) => (
              <linearGradient key={i} id={`${id}-${i}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={COLOR[s.tone ?? "primary"]} stopOpacity={0.24} />
                <stop offset="100%" stopColor={COLOR[s.tone ?? "primary"]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {[0.25, 0.5, 0.75, 1].map((g) => (
            <line key={g} x1={0} x2={W} y1={y(max * g)} y2={y(max * g)} stroke="var(--border)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" vectorEffect="non-scaling-stroke" />
          {hasData
            ? series.map((s, i) => {
                const pts = s.values.map((v, j) => `${x(j).toFixed(2)},${y(v).toFixed(2)}`);
                const line = `M${pts.join(" L")}`;
                const area = `${line} L${x(s.values.length - 1)},${y(0)} L0,${y(0)} Z`;
                return (
                  <g key={s.label}>
                    {i === 0 ? <motion.path d={area} fill={`url(#${id}-${i})`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, delay: 0.25 }} /> : null}
                    <motion.path
                      d={line}
                      fill="none"
                      stroke={COLOR[s.tone ?? "primary"]}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      initial={reduce ? false : { pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 1.2, delay: i * 0.15, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </g>
                );
              })
            : null}
          {hasData ? <line x1={x(at)} x2={x(at)} y1={P.t} y2={y(0)} stroke="var(--foreground)" strokeOpacity={hover === null ? 0 : 0.35} vectorEffect="non-scaling-stroke" /> : null}
        </svg>
        {hasData
          ? series.map((s) => (
              <span
                key={s.label}
                aria-hidden
                className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface transition-[left,top] duration-150 rtl:translate-x-1/2"
                style={{ insetInlineStart: `${days.length > 1 ? (at / (days.length - 1)) * 100 : 50}%`, top: y(s.values[at] ?? 0), background: COLOR[s.tone ?? "primary"] }}
              />
            ))
          : null}
        {!hasData ? <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">—</div> : null}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums" aria-hidden>
        <span>{days[0] ? dayLabel(days[0]) : ""}</span>
        <span>{days[Math.floor(days.length / 2)] ? dayLabel(days[Math.floor(days.length / 2)]!) : ""}</span>
        <span>{days.length ? dayLabel(days[days.length - 1]!) : ""}</span>
      </div>
      {/* A table ignores width:1px, so the screen-reader copy is clipped by a wrapper (no RTL overflow). */}
      <div className="sr-only">
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">—</th>
              {series.map((s) => (
                <th key={s.label} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => (
              <tr key={d}>
                <th scope="row">{dayLabel(d)}</th>
                {series.map((s) => (
                  <td key={s.label}>{fmt(s.values[i] ?? 0, s.format)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

export interface RingCheck {
  key: string;
  label: string;
  /** ok / failing / not configured (optional services). */
  state: "ok" | "down" | "off";
}

/** Animated system status ring: one arc per real check, colored by its state, with the verdict in the middle. */
export function StatusRing({ checks, center, sub, size = 180 }: { checks: RingCheck[]; center: ReactNode; sub?: ReactNode; size?: number }) {
  const reduce = useReducedMotion();
  const R = 70;
  const C = 2 * Math.PI * R;
  const gap = checks.length > 1 ? 10 : 0;
  const seg = C / Math.max(1, checks.length) - gap;
  const tone = (s: RingCheck["state"]) => (s === "ok" ? COLOR.success : s === "down" ? COLOR.danger : "var(--border-strong)");
  const anyDown = checks.some((c) => c.state === "down");
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 180 180" className="absolute inset-0 size-full -rotate-90" role="img" aria-label={checks.map((c) => `${c.label}: ${c.state}`).join(", ")}>
        <circle cx="90" cy="90" r={R} fill="none" stroke="var(--border)" strokeWidth="10" opacity={0.5} />
        {checks.map((c, i) => (
          <motion.circle
            key={c.key}
            cx="90"
            cy="90"
            r={R}
            fill="none"
            stroke={tone(c.state)}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${seg} ${C - seg}`}
            initial={reduce ? false : { strokeDashoffset: -(i * (seg + gap)) + seg, opacity: 0 }}
            animate={{ strokeDashoffset: -(i * (seg + gap)), opacity: 1 }}
            transition={{ duration: 0.9, delay: 0.1 + i * 0.12, ease: [0.16, 1, 0.3, 1] }}
          />
        ))}
        <circle cx="90" cy="90" r="84" fill="none" stroke={anyDown ? COLOR.danger : COLOR.primary} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 6" className={reduce ? undefined : "orbit-spin"} />
      </svg>
      <div className="relative grid place-items-center text-center">
        <div className="text-2xl font-semibold tracking-tight">{center}</div>
        {sub ? <div className="mt-0.5 max-w-28 text-[11px] text-muted-foreground">{sub}</div> : null}
      </div>
    </div>
  );
}

/** Semicircle gauge (queue depth, coverage …). `max` defines the full scale. */
export function Gauge({ value, max, label, display, tone = "primary", sub }: { value: number; max: number; label: string; display: ReactNode; tone?: VizTone; sub?: ReactNode }) {
  const reduce = useReducedMotion();
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const L = Math.PI * 40;
  return (
    <div className="grid justify-items-center gap-1 text-center">
      <svg viewBox="0 0 100 58" className="w-full max-w-36" role="img" aria-label={`${label}: ${typeof display === "string" ? display : value}`}>
        <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="var(--muted)" strokeWidth="8" strokeLinecap="round" />
        <motion.path
          d="M10 50 A40 40 0 0 1 90 50"
          fill="none"
          stroke={COLOR[tone]}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={L}
          initial={reduce ? false : { strokeDashoffset: L }}
          animate={{ strokeDashoffset: L * (1 - ratio) }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="-mt-6 text-lg font-semibold tabular-nums">{display}</div>
      <div className="text-xs font-medium">{label}</div>
      {sub ? <div className="text-[11px] text-muted-foreground tabular-nums">{sub}</div> : null}
    </div>
  );
}

export interface BarItem {
  key: string;
  label: ReactNode;
  value: number;
  display?: ReactNode;
  href?: string;
  tone?: VizTone;
}

/** Ranked horizontal bars (by organization, model, action …). */
export function BarList({ items, tone = "primary", label, empty }: { items: BarItem[]; tone?: VizTone; label: string; empty?: ReactNode }) {
  const reduce = useReducedMotion();
  const fmt = useVizFormat();
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <>{empty ?? null}</>;
  return (
    <ul className="grid gap-1.5" aria-label={label}>
      {items.map((it, i) => {
        const inner = (
          <>
            <motion.span
              aria-hidden
              className="absolute inset-y-0 start-0 rounded-md"
              style={{ background: `color-mix(in oklch, ${COLOR[it.tone ?? tone]} 16%, transparent)`, width: `${Math.max(2, (it.value / max) * 100)}%`, transformOrigin: "var(--origin, left)" }}
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.7, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
            />
            <span className="relative min-w-0 truncate">{it.label}</span>
            <span className="relative ms-auto shrink-0 font-medium tabular-nums">{it.display ?? fmt(it.value)}</span>
          </>
        );
        const cls = "relative flex items-center gap-3 rounded-md px-2.5 py-1.5 text-sm [--origin:left] rtl:[--origin:right]";
        return (
          <li key={it.key}>
            {it.href ? (
              <Link href={it.href} className={cn(cls, "transition-colors hover:bg-muted/60 focus-visible:outline-2")}>
                {inner}
              </Link>
            ) : (
              <div className={cls}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One horizontal bar split by share with a legend (status distribution). */
export function StackedBar({ segments, label }: { segments: { key: string; label: string; value: number; tone: VizTone; href?: string }[]; label: string }) {
  const reduce = useReducedMotion();
  const fmt = useVizFormat();
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <div className="grid gap-2">
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${label}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
        {total > 0
          ? segments
              .filter((s) => s.value > 0)
              .map((s, i) => (
                <motion.span
                  key={s.key}
                  className="h-full origin-left rtl:origin-right"
                  style={{ width: `${(s.value / total) * 100}%`, background: COLOR[s.tone] }}
                  initial={reduce ? false : { scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.6, delay: i * 0.08 }}
                />
              ))
          : null}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segments.map((s) => {
          const body = (
            <>
              <span aria-hidden className="size-2 rounded-full" style={{ background: COLOR[s.tone] }} />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-medium tabular-nums">{fmt(s.value)}</span>
            </>
          );
          return (
            <li key={s.key}>
              {s.href ? (
                <Link href={s.href} className="inline-flex items-center gap-1.5 rounded-sm hover:underline">
                  {body}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * AI fleet: one cell per AI employee (active = emerald, paused = muted). When there are more employees than cells,
 * each cell stands for a fixed group size (shown in the legend). Running tasks light up cells with a live pulse.
 */
/** 64 cells; when there are more employees, one cell stands for ceil(total / 64) of them (the server shows that in `legend`). */
const fleetCellSize = (total: number) => Math.max(1, Math.ceil(total / 64));

export function FleetGrid({ active, paused, running, legend }: { active: number; paused: number; running: number; legend: ReactNode }) {
  const reduce = useReducedMotion();
  const per = fleetCellSize(active + paused);
  const a = Math.ceil(active / per);
  const p = Math.ceil(paused / per);
  const live = Math.min(a, Math.ceil(running / per));
  const cells = [...Array.from({ length: a }, (_, i) => (i < live ? "live" : "active")), ...Array.from({ length: p }, () => "paused")];
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1" aria-hidden>
        {cells.length === 0
          ? Array.from({ length: 16 }, (_, i) => <span key={i} className="aspect-square rounded-[3px] border border-dashed" />)
          : cells.map((c, i) => (
              <motion.span
                key={i}
                className={cn("relative aspect-square rounded-[3px]", c === "paused" ? "bg-muted-foreground/25" : "bg-success/70", c === "live" && "bg-success")}
                initial={reduce ? false : { opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.35, delay: Math.min(i, 40) * 0.012 }}
              >
                {c === "live" ? <span className="live-dot absolute inset-0 m-auto size-full rounded-[3px] text-success" data-pulse="true" /> : null}
              </motion.span>
            ))}
      </div>
      <div className="text-[11px] text-muted-foreground">{legend}</div>
    </div>
  );
}

/**
 * Keeps a server-rendered page live: refreshes it every `seconds` while the tab is visible. The admin can pause it.
 * Shows when the data was last loaded.
 */
export function AutoRefresh({
  seconds = 30,
  loadedAt,
  timeZone,
  label,
  pausedLabel,
  pauseLabel,
  resumeLabel,
}: {
  seconds?: number;
  /** Server render time (ms) — refreshed with every reload. */
  loadedAt: number;
  timeZone: string;
  label: string;
  pausedLabel: string;
  pauseLabel: string;
  resumeLabel: string;
}) {
  const router = useRouter();
  const { locale } = useI18n();
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(t);
  }, [on, seconds, router]);
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "medium", timeZone }).format(loadedAt);
  return (
    <span className="inline-flex items-center gap-2 rounded-full border bg-surface/60 py-1 ps-2.5 pe-1 text-xs backdrop-blur">
      <LiveDot tone={on ? "success" : "neutral"} pulse={on} />
      <span className="text-muted-foreground" aria-live="polite">
        {on ? label : pausedLabel} {time ? <span className="tabular-nums">· {time}</span> : null}
      </span>
      <button
        type="button"
        onClick={() => setOn((v) => !v)}
        aria-pressed={!on}
        aria-label={on ? pauseLabel : resumeLabel}
        className="grid size-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2"
      >
        {on ? <Pause className="size-3" aria-hidden /> : <Play className="size-3" aria-hidden />}
      </button>
    </span>
  );
}
