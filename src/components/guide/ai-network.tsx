"use client";

import { useId } from "react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

export interface NetworkNode {
  id: string;
  label: string;
  active: boolean;
  status: string;
  /** Delegated by this node id (child task). */
  parent?: string | null;
}

const initials = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? "")
    .join("")
    .toUpperCase();

/**
 * The AI team working on one command, drawn from real tasks: the command at the centre, each assigned AI employee
 * around it, and delegated child tasks one ring further out. Links animate only while that task is running
 * (static under reduced motion). Accessible as a labelled image with a text list of who is doing what.
 */
export function AiNetwork({ nodes, className }: { nodes: NetworkNode[]; className?: string }) {
  const { t } = useI18n();
  const uid = useId().replace(/:/g, "");
  const roots = nodes.filter((n) => !n.parent);
  const kids = nodes.filter((n) => n.parent);
  const W = 320;
  const H = kids.length ? 220 : 170;
  const cx = W / 2;
  const cy = H / 2;
  const pos = new Map<string, { x: number; y: number }>();
  roots.forEach((n, i) => {
    const a = (Math.PI * 2 * i) / Math.max(1, roots.length) - Math.PI / 2;
    pos.set(n.id, { x: cx + Math.cos(a) * 72, y: cy + Math.sin(a) * (kids.length ? 62 : 52) });
  });
  kids.forEach((n, i) => {
    const p = pos.get(n.parent!) ?? { x: cx, y: cy };
    const a = Math.atan2(p.y - cy, p.x - cx) + (i % 2 ? 0.5 : -0.5) * (1 + Math.floor(i / 2) * 0.4);
    pos.set(n.id, { x: Math.min(W - 18, Math.max(18, p.x + Math.cos(a) * 52)), y: Math.min(H - 18, Math.max(18, p.y + Math.sin(a) * 44)) });
  });
  const tone = (n: NetworkNode) => (n.status === "FAILED" ? "var(--danger)" : n.status === "COMPLETED" ? "var(--success)" : "var(--primary)");
  const summary = nodes.map((n) => `${n.label}: ${t(`guide.task.status.${n.status}`)}`).join(", ");

  return (
    <figure className={cn("relative", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("guide.command.network", { summary })} className="h-auto w-full max-w-sm">
        <defs>
          <radialGradient id={`${uid}-c`}>
            <stop offset="0%" style={{ stopColor: "var(--surface)" }} />
            <stop offset="45%" style={{ stopColor: "var(--primary)" }} />
            <stop offset="100%" style={{ stopColor: "var(--primary-2)" }} />
          </radialGradient>
        </defs>
        {nodes.map((n) => {
          const p = pos.get(n.id)!;
          const from = n.parent ? pos.get(n.parent)! : { x: cx, y: cy };
          return (
            <line
              key={`l-${n.id}`}
              x1={from.x}
              y1={from.y}
              x2={p.x}
              y2={p.y}
              stroke={tone(n)}
              strokeOpacity={n.active ? 0.8 : 0.35}
              strokeWidth={n.active ? 1.6 : 1}
              strokeDasharray={n.active ? "4 4" : undefined}
              className={n.active ? "motion-safe:animate-[dash_1.2s_linear_infinite]" : undefined}
            />
          );
        })}
        <circle cx={cx} cy={cy} r={18} fill={`url(#${uid}-c)`} className="core-breathe" />
        <circle cx={cx} cy={cy} r={26} fill="none" stroke="var(--primary)" strokeOpacity="0.25" strokeDasharray="2 4" className="orbit-spin" style={{ transformOrigin: `${cx}px ${cy}px` }} />
        {nodes.map((n) => {
          const p = pos.get(n.id)!;
          const r = n.parent ? 12 : 16;
          return (
            <g key={n.id}>
              {n.active ? <circle cx={p.x} cy={p.y} r={r + 5} fill="none" stroke={tone(n)} strokeOpacity="0.35" className="core-breathe" /> : null}
              <circle cx={p.x} cy={p.y} r={r} fill="var(--surface)" stroke={tone(n)} strokeWidth="1.6" />
              <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize={n.parent ? 8 : 10} fontWeight={600} fill="var(--foreground)">
                {initials(n.label)}
              </text>
            </g>
          );
        })}
      </svg>
      <style>{`@keyframes dash { to { stroke-dashoffset: -16; } }`}</style>
    </figure>
  );
}
