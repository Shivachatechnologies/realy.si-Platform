"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

const STAGES = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED"] as const;
type Stage = (typeof STAGES)[number];

/**
 * Hiring pipeline as a flowing funnel (inline SVG + motion): one band per stage sized by the real number of people in
 * it, bands grow in with a stagger and small dots flow down between stages that have people. Reduced motion → static.
 */
export function HiringFunnel({ counts, labels, title, emptyText }: { counts: Record<Stage, number>; labels: Record<Stage, string>; title: string; emptyText?: ReactNode }) {
  const reduced = useReducedMotion();
  const max = Math.max(1, ...STAGES.map((s) => counts[s]));
  const total = STAGES.reduce((n, s) => n + counts[s], 0);
  if (!total && emptyText) return <div className="p-4 text-sm text-muted-foreground">{emptyText}</div>;
  const W = 600;
  const rowH = 40;
  const H = STAGES.length * rowH;
  const inner = W - 220;
  const fills = ["var(--primary)", "color-mix(in oklch, var(--primary) 80%, var(--info))", "color-mix(in oklch, var(--primary) 55%, var(--info))", "color-mix(in oklch, var(--info) 70%, var(--success))", "var(--success)"];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${STAGES.map((s) => `${labels[s]} ${counts[s]}`).join(", ")}`} className="h-auto w-full">
      {STAGES.map((s, i) => {
        const w = Math.max(28, (counts[s] / max) * inner);
        const x = 110 + (inner - w) / 2;
        const y = i * rowH + 4;
        const cx = 110 + inner / 2;
        const flows = i < STAGES.length - 1 && counts[s] > 0 && counts[STAGES[i + 1]!] > 0;
        return (
          <g key={s}>
            <motion.rect
              y={y}
              height={rowH - 12}
              rx={10}
              fill={fills[i]}
              opacity={counts[s] ? 0.92 : 0.16}
              initial={reduced ? false : { width: 0, x: cx }}
              animate={{ width: w, x }}
              transition={{ type: "spring", stiffness: 120, damping: 20, delay: i * 0.08 }}
            />
            <text x={cx} y={y + (rowH - 12) / 2} dominantBaseline="middle" textAnchor="middle" className={counts[s] ? "fill-white text-[13px] font-semibold tabular-nums" : "fill-muted-foreground text-[13px] font-semibold tabular-nums"}>
              {counts[s]}
            </text>
            <text x={4} y={y + (rowH - 12) / 2} dominantBaseline="middle" className="fill-muted-foreground text-[11px]">
              {labels[s]}
            </text>
            {flows && !reduced
              ? [0, 1, 2].map((k) => (
                  <motion.circle
                    key={k}
                    r={2.5}
                    cx={cx + (k - 1) * 14}
                    fill={fills[i + 1]}
                    initial={{ cy: y + rowH - 12, opacity: 0 }}
                    animate={{ cy: [y + rowH - 12, y + rowH + 2], opacity: [0, 1, 0] }}
                    transition={{ duration: 1.4, repeat: Infinity, delay: k * 0.45 + i * 0.2, ease: "easeInOut" }}
                  />
                ))
              : null}
          </g>
        );
      })}
    </svg>
  );
}
