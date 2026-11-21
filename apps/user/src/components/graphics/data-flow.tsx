"use client";

import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { accentColors, rgba, type Palette } from "./color";
import { useCanvas } from "./use-canvas";

export interface FlowNode {
  id: string;
  label: string;
  /** Position in the box, 0–1 (logical: x is mirrored in RTL). */
  x: number;
  y: number;
  /** Optional real value shown under the label. */
  value?: ReactNode;
  icon?: ReactNode;
  href?: string;
}
export interface FlowLink {
  from: string;
  to: string;
  /** Real activity on this link (events, records, tasks in the period) — drives the particle rate. 0 = idle. */
  amount: number;
  label?: string;
}

interface Particle {
  link: number;
  t: number;
  speed: number;
}

/**
 * "Data moving through systems": canvas particles stream along curved paths between nodes, at a rate proportional to
 * each link's real `amount` (idle links stay dim). Nodes are HTML (focusable links, readable labels); a screen-reader
 * list describes every flow. Pauses off-screen; static paths under reduced motion.
 */
export function DataFlow({ nodes, links, className, height = 280, ariaLabel }: { nodes: FlowNode[]; links: FlowLink[]; className?: string; height?: number; ariaLabel: string }) {
  const parts = useRef<Particle[]>([]);
  const pal = useRef<Palette | null>(null);
  const acc = useRef<number[]>([]);
  const rtl = useRef(false);
  const max = Math.max(1, ...links.map((l) => l.amount));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const { ref } = useCanvas(
    (canvas) => {
      pal.current = accentColors(canvas);
      rtl.current = getComputedStyle(canvas).direction === "rtl";
    },
    ({ ctx, width, height: h, dt, reduced }) => {
      const p = pal.current;
      if (!p) return;
      ctx.clearRect(0, 0, width, h);
      const X = (x: number) => (rtl.current ? 1 - x : x) * width;
      const geo = links.map((l) => {
        const a = byId.get(l.from);
        const b = byId.get(l.to);
        if (!a || !b) return null;
        const x1 = X(a.x), y1 = a.y * h, x2 = X(b.x), y2 = b.y * h;
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const bend = Math.min(60, len * 0.18);
        return { x1, y1, x2, y2, cx: mx - (dy / len) * bend, cy: my + (dx / len) * bend };
      });
      const pt = (g: NonNullable<(typeof geo)[number]>, t: number) => {
        const u = 1 - t;
        return { x: u * u * g.x1 + 2 * u * t * g.cx + t * t * g.x2, y: u * u * g.y1 + 2 * u * t * g.cy + t * t * g.y2 };
      };
      // Paths
      geo.forEach((g, i) => {
        if (!g) return;
        const active = links[i]!.amount > 0;
        const grad = ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2);
        grad.addColorStop(0, rgba(p.a, active ? 0.45 : 0.14));
        grad.addColorStop(1, rgba(p.b, active ? 0.45 : 0.14));
        ctx.strokeStyle = grad;
        ctx.lineWidth = active ? 1 + (links[i]!.amount / max) * 2 : 1;
        ctx.setLineDash(active ? [] : [3, 5]);
        ctx.beginPath();
        ctx.moveTo(g.x1, g.y1);
        ctx.quadraticCurveTo(g.cx, g.cy, g.x2, g.y2);
        ctx.stroke();
        // arrowhead at 92%
        const a = pt(g, 0.9), b = pt(g, 0.94);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        ctx.setLineDash([]);
        ctx.fillStyle = rgba(p.b, active ? 0.8 : 0.3);
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(ang) * 4, b.y + Math.sin(ang) * 4);
        ctx.lineTo(b.x + Math.cos(ang + 2.5) * 5, b.y + Math.sin(ang + 2.5) * 5);
        ctx.lineTo(b.x + Math.cos(ang - 2.5) * 5, b.y + Math.sin(ang - 2.5) * 5);
        ctx.fill();
      });
      if (reduced) return false;
      // Spawn proportional to amount (log-scaled so one huge link does not drown the rest).
      links.forEach((l, i) => {
        if (!geo[i] || l.amount <= 0) return;
        const rate = 0.6 + (Math.log1p(l.amount) / Math.log1p(max)) * 5;
        acc.current[i] = (acc.current[i] ?? Math.random()) + rate * dt;
        while (acc.current[i]! >= 1) {
          acc.current[i]! -= 1;
          if (parts.current.length < 400) parts.current.push({ link: i, t: 0, speed: 0.22 + Math.random() * 0.2 });
        }
      });
      ctx.globalCompositeOperation = "lighter";
      parts.current = parts.current.filter((q) => {
        q.t += q.speed * dt;
        const g = geo[q.link];
        if (!g || q.t >= 1) return false;
        const { x, y } = pt(g, q.t);
        const fade = Math.sin(q.t * Math.PI);
        const r = 6;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
        glow.addColorStop(0, rgba(q.t < 0.5 ? p.a : p.b, 0.9 * fade));
        glow.addColorStop(1, rgba(q.t < 0.5 ? p.a : p.b, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        return true;
      });
      ctx.globalCompositeOperation = "source-over";
    },
    [JSON.stringify(nodes.map((n) => [n.id, n.x, n.y])), JSON.stringify(links)],
  );

  return (
    <figure className={cn("relative w-full", className)} style={{ height }} aria-label={ariaLabel}>
      <canvas ref={ref} aria-hidden className="absolute inset-0 size-full" />
      {nodes.map((n) => {
        const body = (
          <>
            {n.icon ? <span aria-hidden className="grid size-8 place-items-center rounded-xl border bg-surface text-primary shadow-elev-2 [&_svg]:size-4">{n.icon}</span> : <span aria-hidden className="size-2.5 rounded-full bg-primary shadow-glow" />}
            <span className="max-w-28 truncate text-[11px] font-medium">{n.label}</span>
            {n.value !== undefined ? <span className="numeral text-[11px] text-muted-foreground">{n.value}</span> : null}
          </>
        );
        const cls = "absolute grid -translate-x-1/2 -translate-y-1/2 justify-items-center gap-1 rounded-lg px-1.5 py-1 text-center rtl:translate-x-1/2";
        const style = { insetInlineStart: `${n.x * 100}%`, top: `${n.y * 100}%` };
        return n.href ? (
          <Link key={n.id} href={n.href} className={cn(cls, "transition-transform hover:scale-105 focus-visible:outline-2")} style={style}>
            {body}
          </Link>
        ) : (
          <div key={n.id} className={cls} style={style}>
            {body}
          </div>
        );
      })}
      <figcaption className="sr-only">
        {ariaLabel}
        <ul>
          {links.map((l) => (
            <li key={`${l.from}-${l.to}`}>
              {byId.get(l.from)?.label} → {byId.get(l.to)?.label}: {l.label ?? l.amount}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
