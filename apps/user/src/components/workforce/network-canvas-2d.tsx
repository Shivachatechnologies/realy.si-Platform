"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { hueOf, SIZE, type NetLayout } from "./network-layout";
import { PULSE_COLOR, type Pulse } from "./network-signals";

/**
 * 2D fallback of the company network (no WebGL, reduced motion or very small screens): the same radial layout seen
 * from above (humans on an outer offset), drawn on one canvas. Click selects the nearest node; wheel / pinch zooms.
 */
export function NetworkCanvas2D({
  layout,
  pulsesRef,
  selected,
  onSelect,
  onHover,
  reduced,
  paused,
  dark,
}: {
  layout: NetLayout;
  pulsesRef: MutableRefObject<Pulse[]>;
  selected: number | null;
  onSelect: (i: number) => void;
  onHover: (i: number | null, x: number, y: number) => void;
  reduced: boolean;
  paused: boolean;
  dark: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const zoom = useRef(1);
  const pan = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    // Humans (lower plane) are drawn as a second disc offset below the AI disc so both stay readable from above.
    const project = (i: number, w: number, h: number) => {
      const p = layout.placed[i]!;
      const human = p.node.kind === "human";
      const scale = (Math.min(w, h) / (layout.radius * 2.6 + 4)) * zoom.current;
      return { x: w / 2 + pan.current.x + p.x * scale * (human ? 0.55 : 1) + (human ? w * 0.32 : 0), y: h / 2 + pan.current.y + p.z * scale * (human ? 0.55 : 1) * 0.8, r: Math.max(2, SIZE[p.node.level] * scale * 1.3) };
    };
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const pts = layout.placed.map((_, i) => project(i, w, h));
      ctx.lineWidth = 1;
      ctx.strokeStyle = dark ? "rgba(142,162,255,0.22)" : "rgba(79,95,191,0.25)";
      ctx.beginPath();
      for (const [a, b] of layout.edges) {
        ctx.moveTo(pts[a]!.x, pts[a]!.y);
        ctx.lineTo(pts[b]!.x, pts[b]!.y);
      }
      ctx.stroke();
      const now = performance.now();
      layout.placed.forEach((p, i) => {
        const q = pts[i]!;
        const paused_ = p.node.status === "paused";
        const busy = p.node.status === "busy";
        const r = busy && !reduced ? q.r * (1 + 0.15 * Math.sin(now / 300 + i)) : q.r;
        ctx.beginPath();
        ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
        ctx.fillStyle = paused_ ? (dark ? "#555" : "#bbb") : `hsl(${hueOf(p.node.department)} ${p.node.kind === "human" ? 25 : busy ? 90 : 65}% ${dark ? 60 : 45}%)`;
        ctx.fill();
        if (i === selected) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = dark ? "#fff" : "#111827";
          ctx.stroke();
        }
      });
      // Labels for the top of the chart only (CEO, executives) to keep large orgs legible.
      ctx.font = "11px ui-sans-serif, system-ui";
      ctx.fillStyle = dark ? "rgba(255,255,255,0.85)" : "rgba(17,24,39,0.85)";
      ctx.textAlign = "center";
      layout.placed.forEach((p, i) => {
        if (p.node.level === "CEO" || (p.node.level === "EXECUTIVE" && layout.placed.length < 600)) ctx.fillText(p.node.name, pts[i]!.x, pts[i]!.y - pts[i]!.r - 4);
      });
      pulsesRef.current = pulsesRef.current.filter((p) => now - p.start < 1600 && p.from < pts.length && p.to < pts.length);
      for (const p of pulsesRef.current) {
        const t = reduced ? 1 : Math.min(1, (now - p.start) / 1600);
        const a = pts[p.from]!;
        const b = pts[p.to]!;
        ctx.beginPath();
        if (p.from === p.to) ctx.arc(a.x, a.y, a.r * (1.4 + t * 1.5), 0, Math.PI * 2);
        else ctx.arc(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 3, 0, Math.PI * 2);
        ctx.strokeStyle = ctx.fillStyle = PULSE_COLOR[p.kind];
        if (p.from === p.to) ctx.stroke();
        else ctx.fill();
      }
      if (!paused) raf = requestAnimationFrame(draw);
    };
    draw();
    const nearest = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      let best = -1;
      let bestD = Infinity;
      layout.placed.forEach((_, i) => {
        const q = project(i, canvas.clientWidth, canvas.clientHeight);
        const d = Math.hypot(q.x - x, q.y - y) - q.r;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return { index: bestD < 10 ? best : -1, x, y };
    };
    const click = (ev: MouseEvent) => {
      const n = nearest(ev);
      if (n.index >= 0) onSelect(n.index);
    };
    const move = (ev: MouseEvent) => {
      const n = nearest(ev);
      onHover(n.index >= 0 ? n.index : null, n.x, n.y);
    };
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      zoom.current = Math.min(8, Math.max(0.4, zoom.current * (ev.deltaY > 0 ? 0.9 : 1.1)));
      if (paused) draw();
    };
    let drag: { x: number; y: number } | null = null;
    const down = (ev: PointerEvent) => (drag = { x: ev.clientX - pan.current.x, y: ev.clientY - pan.current.y });
    const dragMove = (ev: PointerEvent) => {
      if (!drag || !(ev.buttons & 1)) return;
      pan.current = { x: ev.clientX - drag.x, y: ev.clientY - drag.y };
      if (paused) draw();
    };
    const up = () => (drag = null);
    canvas.addEventListener("click", click);
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", dragMove);
    window.addEventListener("pointerup", up);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("click", click);
      canvas.removeEventListener("mousemove", move);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", dragMove);
      window.removeEventListener("pointerup", up);
    };
  }, [layout, pulsesRef, selected, onSelect, onHover, reduced, paused, dark]);

  return <canvas ref={ref} className="size-full touch-none" aria-hidden />;
}
