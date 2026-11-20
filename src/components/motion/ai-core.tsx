"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Decorative animated "AI core": a breathing nucleus with orbiting agent nodes, drawn in the current surface's
 * accent tokens (indigo/violet in the app, amber/emerald under data-surface="admin"). Pure SVG + CSS transforms;
 * static under reduced motion. Purely decorative (aria-hidden) — use it in empty states and the auth screens.
 */
export function AiCore({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const core = `${id}-core`;
  const glow = `${id}-glow`;
  const ring = `${id}-ring`;
  const node = (cx: number, cy: number, r: number, delay = 0) => (
    <circle cx={cx} cy={cy} r={r} fill={`url(#${core})`} className="core-breathe" style={{ animationDelay: `${delay}s` }} />
  );
  return (
    <svg viewBox="0 0 200 200" aria-hidden className={cn("size-48", className)} fill="none">
      <defs>
        <radialGradient id={core}>
          <stop offset="0%" style={{ stopColor: "var(--surface)" }} />
          <stop offset="35%" style={{ stopColor: "var(--primary)" }} />
          <stop offset="100%" style={{ stopColor: "var(--primary-2)" }} />
        </radialGradient>
        <radialGradient id={glow}>
          <stop offset="0%" style={{ stopColor: "var(--primary)", stopOpacity: 0.45 }} />
          <stop offset="60%" style={{ stopColor: "var(--primary-2)", stopOpacity: 0.12 }} />
          <stop offset="100%" style={{ stopColor: "var(--primary-2)", stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id={ring} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: "var(--primary)", stopOpacity: 0.9 }} />
          <stop offset="100%" style={{ stopColor: "var(--primary-2)", stopOpacity: 0.15 }} />
        </linearGradient>
      </defs>

      <circle cx="100" cy="100" r="96" fill={`url(#${glow})`} className="core-breathe" />

      {/* outer dashed orbit */}
      <g className="orbit-spin-reverse">
        <circle cx="100" cy="100" r="84" stroke={`url(#${ring})`} strokeWidth="0.75" strokeDasharray="2 5" />
        {node(100, 16, 3.2, 0.4)}
        {node(173, 142, 2.4, 1.2)}
      </g>

      {/* middle orbit with linked agent nodes */}
      <g className="orbit-spin">
        <circle cx="100" cy="100" r="62" stroke={`url(#${ring})`} strokeWidth="0.9" opacity="0.7" />
        <path d="M100 100 L154 69 M100 100 L46 131 M100 100 L100 38" stroke={`url(#${ring})`} strokeWidth="0.6" opacity="0.55" />
        {node(154, 69, 4.2, 0)}
        {node(46, 131, 3.4, 0.8)}
        {node(100, 38, 2.8, 1.6)}
      </g>

      {/* inner fast orbit */}
      <g className="orbit-spin-fast">
        <circle cx="100" cy="100" r="38" stroke={`url(#${ring})`} strokeWidth="0.8" strokeDasharray="20 8" opacity="0.8" />
        {node(138, 100, 2.6, 0.3)}
        {node(62, 100, 2, 1)}
      </g>

      {/* nucleus */}
      <circle cx="100" cy="100" r="22" fill={`url(#${glow})`} className="core-breathe" />
      <circle cx="100" cy="100" r="13" fill={`url(#${core})`} />
      <circle cx="100" cy="100" r="13" stroke="var(--surface)" strokeOpacity="0.5" strokeWidth="0.8" />
    </svg>
  );
}

/** Alias: the same visual, named for orbit-style empty states. */
export const Orbit = AiCore;
