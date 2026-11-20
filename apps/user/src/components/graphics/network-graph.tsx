"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { accentColors, hash, rgba, rng, type Palette } from "./color";
import { useCanvas } from "./use-canvas";

export type GraphTone = "a" | "b" | "success" | "warning" | "info" | "danger" | "fg";

export interface GraphGroup {
  key: string;
  label: string;
  tone: GraphTone;
  /** Ring the group settles on (0 = centre, 1 = outer edge). */
  ring: number;
  /** Shape drawn for the group's nodes. */
  shape?: "circle" | "square" | "diamond" | "hex" | "ring";
}
export interface GraphNode {
  id: string;
  label: string;
  group: string;
  /** Relative importance (1 = normal); scales the radius. */
  weight?: number;
  href?: string;
  /** One line shown in the detail panel / screen-reader list (real data, e.g. "12 open deals"). */
  meta?: string;
  /** Pinned at the centre (the company itself). */
  center?: boolean;
}
export interface GraphLink {
  source: string;
  target: string;
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  fixed: boolean;
  /** Group anchor angle. */
  ang: number;
}

const TONES: Record<GraphTone, keyof Palette> = { a: "a", b: "b", success: "success", warning: "warning", info: "info", danger: "danger", fg: "fg" };

function shapePath(ctx: CanvasRenderingContext2D, shape: GraphGroup["shape"], x: number, y: number, r: number) {
  ctx.beginPath();
  if (shape === "square") ctx.roundRect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7, r * 0.35);
  else if (shape === "diamond") {
    ctx.moveTo(x, y - r * 1.1);
    ctx.lineTo(x + r * 1.1, y);
    ctx.lineTo(x, y + r * 1.1);
    ctx.lineTo(x - r * 1.1, y);
    ctx.closePath();
  } else if (shape === "hex") {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  } else ctx.arc(x, y, r, 0, Math.PI * 2);
}

/**
 * Interactive force-directed network (canvas). Groups settle on rings around a pinned centre; links pull related
 * nodes together; hover highlights a node's neighbourhood, drag moves nodes, click selects (or follows `href` when no
 * `onSelect` is given). The layout cools and the loop stops when settled (no idle CPU). Every node is also listed
 * for screen readers and keyboard users (focusable buttons/links) — the canvas is a visual of the same data.
 */
export function NetworkGraph({
  nodes,
  links,
  groups,
  ariaLabel,
  height = 460,
  className,
  selectedId,
  onSelect,
  labelThreshold = 1.4,
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  groups: GraphGroup[];
  ariaLabel: string;
  height?: number;
  className?: string;
  selectedId?: string | null;
  onSelect?: (node: GraphNode | null) => void;
  /** Nodes with weight ≥ this always show their label (others on hover). */
  labelThreshold?: number;
}) {
  const router = useRouter();
  const groupByKey = useMemo(() => new Map(groups.map((g, i) => [g.key, { ...g, i }])), [groups]);
  const sim = useRef<SimNode[]>([]);
  const alpha = useRef(1);
  const pal = useRef<Palette | null>(null);
  const view = useRef({ s: 1, ox: 0, oy: 0 });
  const hover = useRef<string | null>(null);
  const drag = useRef<{ id: string; moved: boolean } | null>(null);
  const [hovered, setHovered] = useState<SimNode | null>(null);
  const selectedRef = useRef<string | null>(selectedId ?? null);

  const dataKey = useMemo(() => JSON.stringify([nodes.map((n) => [n.id, n.group, n.weight]), links.map((l) => [l.source, l.target])]), [nodes, links]);
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of links) {
      if (!m.has(l.source)) m.set(l.source, new Set());
      if (!m.has(l.target)) m.set(l.target, new Set());
      m.get(l.source)!.add(l.target);
      m.get(l.target)!.add(l.source);
    }
    return m;
  }, [links]);

  const { ref, wake } = useCanvas(
    (canvas) => {
      pal.current = accentColors(canvas);
    },
    ({ ctx, width, height: h, t, reduced }) => {
      const p = pal.current;
      if (!p) return false;
      const ns = sim.current;
      const byId = new Map(ns.map((n) => [n.id, n]));
      const R = Math.min(width, h) / 2 - 24;
      // ── physics (in a 200-unit virtual radius; reduced motion runs it to convergence in one frame) ──
      const steps = reduced ? 240 : alpha.current > 0.004 ? 1 : 0;
      for (let s = 0; s < steps; s++) {
        const a = reduced ? Math.max(0.02, 1 - s / 240) : alpha.current;
        for (let i = 0; i < ns.length; i++) {
          const n = ns[i]!;
          for (let j = i + 1; j < ns.length; j++) {
            const m = ns[j]!;
            let dx = n.x - m.x;
            let dy = n.y - m.y;
            let d2 = dx * dx + dy * dy;
            if (d2 > 160 * 160) continue;
            if (d2 < 1) {
              dx = Math.random() - 0.5;
              dy = Math.random() - 0.5;
              d2 = 1;
            }
            const f = (260 * a) / d2;
            const d = Math.sqrt(d2);
            n.vx += (dx / d) * f;
            n.vy += (dy / d) * f;
            m.vx -= (dx / d) * f;
            m.vy -= (dy / d) * f;
          }
        }
        for (const l of links) {
          const s1 = byId.get(l.source);
          const s2 = byId.get(l.target);
          if (!s1 || !s2) continue;
          const dx = s2.x - s1.x;
          const dy = s2.y - s1.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const k = ((d - 46) / d) * 0.035 * a;
          s1.vx += dx * k;
          s1.vy += dy * k;
          s2.vx -= dx * k;
          s2.vy -= dy * k;
        }
        for (const n of ns) {
          if (n.fixed || drag.current?.id === n.id) {
            n.vx = n.vy = 0;
            if (n.center) n.x = n.y = 0;
            continue;
          }
          const g = groupByKey.get(n.group);
          const ring = (g?.ring ?? 0.6) * 200;
          const tx = Math.cos(n.ang) * ring;
          const ty = Math.sin(n.ang) * ring;
          n.vx += (tx - n.x) * 0.012 * a;
          n.vy += (ty - n.y) * 0.012 * a;
          n.vx *= 0.82;
          n.vy *= 0.82;
          n.x += n.vx;
          n.y += n.vy;
        }
        if (!reduced) alpha.current *= 0.985;
      }
      // ── fit to the box (smoothed) ──
      let maxR = 60;
      for (const n of ns) maxR = Math.max(maxR, Math.hypot(n.x, n.y) + n.r);
      const targetS = R / maxR;
      view.current.s += (targetS - view.current.s) * (reduced ? 1 : 0.12);
      view.current.ox = width / 2;
      view.current.oy = h / 2;
      const { s, ox, oy } = view.current;
      const X = (x: number) => ox + x * s;
      const Y = (y: number) => oy + y * s;

      ctx.clearRect(0, 0, width, h);
      // orbit rings
      ctx.lineWidth = 1;
      for (const g of groups) {
        if (g.ring <= 0) continue;
        ctx.strokeStyle = rgba(p.fg, 0.05);
        ctx.setLineDash([2, 6]);
        ctx.beginPath();
        ctx.arc(ox, oy, g.ring * 200 * s, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      const focus = hover.current ?? selectedRef.current;
      const near = focus ? adjacency.get(focus) ?? new Set<string>() : null;
      // links
      for (const l of links) {
        const s1 = byId.get(l.source);
        const s2 = byId.get(l.target);
        if (!s1 || !s2) continue;
        const lit = focus && (l.source === focus || l.target === focus);
        const c1 = p[TONES[groupByKey.get(s1.group)?.tone ?? "a"]];
        const c2 = p[TONES[groupByKey.get(s2.group)?.tone ?? "b"]];
        const grad = ctx.createLinearGradient(X(s1.x), Y(s1.y), X(s2.x), Y(s2.y));
        const al = focus ? (lit ? 0.75 : 0.05) : 0.22;
        grad.addColorStop(0, rgba(c1, al));
        grad.addColorStop(1, rgba(c2, al));
        ctx.strokeStyle = grad;
        ctx.lineWidth = lit ? 1.6 : 0.9;
        ctx.beginPath();
        ctx.moveTo(X(s1.x), Y(s1.y));
        ctx.lineTo(X(s2.x), Y(s2.y));
        ctx.stroke();
        // a signal travelling along lit links
        if (lit && !reduced) {
          const f = (t * 0.8 + (hash(l.source + l.target) % 100) / 100) % 1;
          ctx.fillStyle = rgba(c2, 0.9);
          ctx.beginPath();
          ctx.arc(X(s1.x + (s2.x - s1.x) * f), Y(s1.y + (s2.y - s1.y) * f), 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // nodes
      for (const n of ns) {
        const g = groupByKey.get(n.group);
        const c = p[TONES[g?.tone ?? "a"]];
        const dim = focus && focus !== n.id && !near?.has(n.id);
        const x = X(n.x);
        const y = Y(n.y);
        const r = n.r * Math.max(0.75, Math.min(1.3, s * 1.2));
        if (!dim && (n.center || (n.weight ?? 1) >= labelThreshold || focus === n.id)) {
          const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
          glow.addColorStop(0, rgba(c, n.center ? 0.45 : 0.28));
          glow.addColorStop(1, rgba(c, 0));
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
        shapePath(ctx, n.center ? "circle" : g?.shape, x, y, r);
        if (g?.shape === "ring" && !n.center) {
          ctx.strokeStyle = rgba(c, dim ? 0.2 : 0.95);
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = rgba(p.surface, 0.9);
          ctx.fill();
        } else {
          const fill = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
          fill.addColorStop(0, rgba([255, 255, 255], dim ? 0.15 : 0.55));
          fill.addColorStop(0.35, rgba(c, dim ? 0.25 : 1));
          fill.addColorStop(1, rgba(c, dim ? 0.15 : 0.75));
          ctx.fillStyle = fill;
          ctx.fill();
        }
        if (selectedRef.current === n.id) {
          ctx.strokeStyle = rgba(p.fg, 0.8);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, r + 4 + (reduced ? 0 : Math.sin(t * 3) * 1.2), 0, Math.PI * 2);
          ctx.stroke();
        }
        const showLabel = !dim && (n.center || (n.weight ?? 1) >= labelThreshold || focus === n.id || near?.has(n.id));
        if (showLabel) {
          ctx.font = `${n.center ? 600 : 500} ${n.center ? 13 : 11}px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = "center";
          const label = n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label;
          ctx.fillStyle = rgba(p.surface, 0.75);
          const w = ctx.measureText(label).width;
          ctx.fillRect(x - w / 2 - 3, y + r + 4, w + 6, 15);
          ctx.fillStyle = rgba(p.fg, focus === n.id || n.center ? 1 : 0.78);
          ctx.fillText(label, x, y + r + 15);
        }
      }
      const animating = !!(focus && !reduced);
      return reduced ? false : alpha.current > 0.004 || animating || Math.abs(targetS - s) > 0.002;
    },
    [dataKey, groups],
  );

  // (Re)build the simulation when data changes, keeping positions of nodes that survive.
  useEffect(() => {
    const prev = new Map(sim.current.map((n) => [n.id, n]));
    const groupCounts = new Map<string, number>();
    const groupIndex = new Map<string, number>();
    for (const n of nodes) groupCounts.set(n.group, (groupCounts.get(n.group) ?? 0) + 1);
    const ng = Math.max(1, groups.length);
    sim.current = nodes.map((n) => {
      const g = groupByKey.get(n.group);
      const gi = g?.i ?? 0;
      const idx = groupIndex.get(n.group) ?? 0;
      groupIndex.set(n.group, idx + 1);
      const count = groupCounts.get(n.group) ?? 1;
      // Each group owns a sector; nodes spread across it.
      const sector = (Math.PI * 2) / ng;
      const ang = gi * sector - Math.PI / 2 + ((idx + 0.5) / count - 0.5) * sector * 0.85;
      const ring = n.center ? 0 : (g?.ring ?? 0.6);
      const r = rng(hash(n.id));
      const old = prev.get(n.id);
      const radius = n.center ? 16 : 4 + Math.min(10, Math.sqrt(n.weight ?? 1) * 4.2);
      return {
        ...n,
        x: old?.x ?? Math.cos(ang) * ring * 200 + (r() - 0.5) * 20,
        y: old?.y ?? Math.sin(ang) * ring * 200 + (r() - 0.5) * 20,
        vx: 0,
        vy: 0,
        r: radius,
        fixed: !!n.center,
        ang,
      };
    });
    alpha.current = 1;
    wake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  useEffect(() => {
    selectedRef.current = selectedId ?? null;
    wake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function pick(e: React.PointerEvent<HTMLCanvasElement>): SimNode | null {
    const rect = e.currentTarget.getBoundingClientRect();
    const { s, ox, oy } = view.current;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    let best: SimNode | null = null;
    let bestD = Infinity;
    for (const n of sim.current) {
      const d = Math.hypot(ox + n.x * s - px, oy + n.y * s - py);
      if (d < n.r * 1.3 + 8 && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  function activate(n: GraphNode | null) {
    if (onSelect) onSelect(n);
    else if (n?.href) router.push(n.href);
  }

  const groupCounts = groups.map((g) => ({ ...g, count: nodes.filter((n) => n.group === g.key).length }));

  return (
    <div className={cn("relative", className)}>
      <canvas
        ref={ref}
        role="img"
        aria-label={ariaLabel}
        className={cn("block w-full touch-none select-none", hovered ? "cursor-pointer" : "cursor-grab")}
        style={{ height }}
        onPointerMove={(e) => {
          if (drag.current) {
            const n = sim.current.find((m) => m.id === drag.current!.id);
            if (n) {
              const rect = e.currentTarget.getBoundingClientRect();
              const { s, ox, oy } = view.current;
              n.x = (e.clientX - rect.left - ox) / s;
              n.y = (e.clientY - rect.top - oy) / s;
              drag.current.moved = true;
              alpha.current = Math.max(alpha.current, 0.25);
              wake();
            }
            return;
          }
          const n = pick(e);
          if ((n?.id ?? null) !== hover.current) {
            hover.current = n?.id ?? null;
            setHovered(n);
            wake();
          }
        }}
        onPointerDown={(e) => {
          const n = pick(e);
          if (n && !n.center) {
            drag.current = { id: n.id, moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d?.moved) return;
          activate(pick(e));
        }}
        onPointerLeave={() => {
          hover.current = null;
          setHovered(null);
          wake();
        }}
      />
      {hovered ? (
        <div className="pointer-events-none absolute start-3 top-3 max-w-64 rounded-lg border bg-surface/90 px-3 py-2 text-xs shadow-elev-3 backdrop-blur">
          <div className="font-medium">{hovered.label}</div>
          <div className="text-muted-foreground">
            {groupByKey.get(hovered.group)?.label}
            {hovered.meta ? ` · ${hovered.meta}` : ""}
          </div>
        </div>
      ) : null}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label={ariaLabel}>
        {groupCounts.map((g) => (
          <li key={g.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-full" style={{ background: g.tone === "a" ? "var(--world-accent, var(--primary))" : g.tone === "b" ? "var(--world-accent-2, var(--primary-2))" : `var(--${g.tone === "fg" ? "foreground" : g.tone})` }} />
            {g.label}
            <span className="numeral text-foreground">{g.count}</span>
          </li>
        ))}
      </ul>
      <div className="sr-only">
        {groups.map((g) => {
          const list = nodes.filter((n) => n.group === g.key);
          if (!list.length) return null;
          return (
            <section key={g.key}>
              <h3>{g.label}</h3>
              <ul>
                {list.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => activate(n)} onFocus={() => { hover.current = n.id; wake(); }} onBlur={() => { hover.current = null; wake(); }}>
                      {n.label}
                      {n.meta ? ` — ${n.meta}` : ""}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
