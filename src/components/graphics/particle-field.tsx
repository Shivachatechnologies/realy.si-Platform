"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { accentColors, rgba, rng } from "./color";
import { useCanvas } from "./use-canvas";

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hue: 0 | 1;
}

/**
 * Ambient particle field (canvas): drifting motes in the current world's accent colours that link into a faint
 * mesh when close — the "living system" texture behind scenes. `density` scales the particle count (per 10k px²);
 * `intensity` (0–1) scales speed and link brightness — wire it to real activity where there is one.
 * Pauses off-screen; a single static frame under reduced motion. Decorative (aria-hidden).
 */
export function ParticleField({ className, density = 0.9, intensity = 0.5, links = true, seed = 7 }: { className?: string; density?: number; intensity?: number; links?: boolean; seed?: number }) {
  const parts = useRef<P[]>([]);
  const colors = useRef({ a: [120, 110, 255] as [number, number, number], b: [190, 110, 255] as [number, number, number] });
  const pointer = useRef<{ x: number; y: number } | null>(null);

  const { ref } = useCanvas(
    (canvas) => {
      const c = accentColors(canvas);
      colors.current = { a: c.a, b: c.b };
    },
    ({ ctx, width, height, dt, reduced }) => {
      const want = Math.min(220, Math.round(((width * height) / 10000) * density));
      if (parts.current.length !== want) {
        const r = rng(seed);
        parts.current = Array.from({ length: want }, () => ({
          x: r() * width,
          y: r() * height,
          vx: (r() - 0.5) * 12,
          vy: (r() - 0.5) * 12,
          r: 0.6 + r() * 1.6,
          hue: r() > 0.6 ? 1 : 0,
        }));
      }
      const speed = 0.4 + intensity * 1.6;
      ctx.clearRect(0, 0, width, height);
      const ps = parts.current;
      for (const p of ps) {
        if (!reduced) {
          p.x += p.vx * dt * speed;
          p.y += p.vy * dt * speed;
          if (pointer.current) {
            const dx = p.x - pointer.current.x;
            const dy = p.y - pointer.current.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < 9000) {
              p.x += (dx / Math.sqrt(d2 + 1)) * 30 * dt;
              p.y += (dy / Math.sqrt(d2 + 1)) * 30 * dt;
            }
          }
          if (p.x < -10) p.x = width + 10;
          if (p.x > width + 10) p.x = -10;
          if (p.y < -10) p.y = height + 10;
          if (p.y > height + 10) p.y = -10;
        }
      }
      if (links) {
        const max = 92;
        ctx.lineWidth = 0.6;
        for (let i = 0; i < ps.length; i++) {
          const a = ps[i]!;
          for (let j = i + 1; j < ps.length; j++) {
            const b = ps[j]!;
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < max * max) {
              ctx.strokeStyle = rgba(colors.current.a, (1 - Math.sqrt(d2) / max) * (0.12 + intensity * 0.18));
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.stroke();
            }
          }
        }
      }
      for (const p of ps) {
        ctx.fillStyle = rgba(p.hue ? colors.current.b : colors.current.a, 0.55);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    [density, intensity, links, seed],
  );

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={cn("pointer-events-auto absolute inset-0 size-full", className)}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        pointer.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      }}
      onPointerLeave={() => (pointer.current = null)}
    />
  );
}
