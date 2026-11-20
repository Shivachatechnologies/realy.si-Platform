"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { useI18n } from "@/i18n/client";

export interface MapFlow {
  id: string;
  name: string;
  triggerLabel: string;
  steps: string[];
  moreSteps: number;
  runs24h: number;
  runs30d: number;
  failed30d: number;
  running: number;
}

/**
 * Automation map: one lane per active workflow — trigger node → its steps — drawn in SVG. Pulses travel along a lane
 * when that workflow ran in the last 24 hours (faster with more runs); real counts are shown on each lane.
 */
export function AutomationMap({ flows, locale }: { flows: MapFlow[]; locale: string }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const laneH = 64;
  const nodeW = 132;
  const gap = 34;
  const maxSteps = Math.max(1, ...flows.map((f) => f.steps.length + (f.moreSteps ? 1 : 0)));
  const W = 20 + (nodeW + gap) * (maxSteps + 1) + 120;
  const H = flows.length * laneH + 10;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: Math.min(W, 900) }} className="h-auto w-full" role="img" aria-label={t("workflows.map.aria", { count: flows.length })}>
        <defs>
          <linearGradient id="am-trigger" x1="0" x2="1">
            <stop offset="0%" stopColor="var(--primary)" />
            <stop offset="100%" stopColor="color-mix(in oklch, var(--primary) 60%, var(--info))" />
          </linearGradient>
        </defs>
        {flows.map((f, li) => {
          const y = li * laneH + 12;
          const nodes = [f.triggerLabel, ...f.steps, ...(f.moreSteps ? [t("workflows.map.more", { count: f.moreSteps })] : [])];
          const endX = 20 + (nodeW + gap) * (nodes.length - 1) + nodeW;
          const cy = y + 20;
          const dur = Math.max(1.2, 4 - Math.log2(1 + f.runs24h));
          return (
            <g key={f.id}>
              <title>{f.name}</title>
              <line x1={20 + nodeW / 2} x2={endX - nodeW / 2} y1={cy} y2={cy} stroke="var(--border-strong, var(--border))" strokeWidth={2} strokeDasharray="4 4" />
              {nodes.map((label, i) => {
                const x = 20 + i * (nodeW + gap);
                return (
                  <motion.g key={i} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: li * 0.08 + i * 0.06 }}>
                    <rect x={x} y={y} width={nodeW} height={40} rx={10} fill={i === 0 ? "url(#am-trigger)" : "var(--surface)"} stroke={i === 0 ? "transparent" : "var(--border)"} />
                    <text x={x + nodeW / 2} y={cy} dominantBaseline="middle" textAnchor="middle" className={i === 0 ? "fill-white text-[11px] font-medium" : "fill-foreground text-[11px]"}>
                      {label.length > 20 ? `${label.slice(0, 19)}…` : label}
                    </text>
                  </motion.g>
                );
              })}
              {f.runs24h > 0 && !reduced
                ? [0, 1].map((k) => (
                    <motion.circle key={k} r={4} cy={cy} fill="var(--success)" initial={{ cx: 20 + nodeW, opacity: 0 }} animate={{ cx: [20 + nodeW, endX - nodeW], opacity: [0, 1, 1, 0] }} transition={{ duration: dur, repeat: Infinity, delay: k * (dur / 2), ease: "linear" }} />
                  ))
                : null}
              <Link href={`/${locale}/workflows/${f.id}`}>
                <text x={endX + 14} y={cy - 7} className="fill-foreground text-[12px] font-medium hover:underline">
                  {f.name.length > 22 ? `${f.name.slice(0, 21)}…` : f.name}
                </text>
                <text x={endX + 14} y={cy + 9} className={f.failed30d ? "fill-danger text-[10px]" : "fill-muted-foreground text-[10px]"}>
                  {t("workflows.map.counts", { day: f.runs24h, month: f.runs30d, failed: f.failed30d })}
                </text>
              </Link>
              {f.running ? <circle cx={endX + 6} cy={cy - 11} r={3} className="fill-success" /> : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
