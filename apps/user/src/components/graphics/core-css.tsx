"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type CoreTone = "accent" | "warning" | "success" | "danger";

/** Deterministic particle layout (no Math.random during render). */
const PARTICLES = Array.from({ length: 18 }, (_, i) => {
  const a = (i * 137.5 * Math.PI) / 180;
  const r = 30 + ((i * 53) % 19);
  return {
    x: 50 + Math.cos(a) * r,
    y: 50 + Math.sin(a) * r * 0.82,
    dx: Math.round(Math.cos(a + 1.2) * (6 + (i % 4) * 3)),
    dy: Math.round(Math.sin(a + 1.2) * (6 + (i % 3) * 3)),
    dur: 7 + (i % 5) * 1.6,
    delay: -((i * 0.83) % 7),
    size: 2 + (i % 3),
  };
});

/**
 * The animated CSS/HTML AI Core — the fallback for phones without WebGL or with little power, the compact dock and
 * the tab-bar button, and the first paint before the 3D scene loads. Rotating tilted orbital rings, a pulsing nucleus,
 * expanding energy waves, a radar sweep, drifting particles and orbiting nodes — all CSS transforms/opacity (GPU
 * composited, no per-frame JavaScript) except the optional audio level, written to a CSS variable per frame only
 * while `live`. `still` (reduced motion) keeps the glow and the composition but nothing moves. Decorative.
 */
export function CoreCss({
  tone = "accent",
  speed = 1,
  nodes = 8,
  heat,
  level,
  live = false,
  still = false,
  paused = false,
  compact = false,
  className,
}: {
  tone?: CoreTone;
  /** Rotation speed multiplier (state/workload driven). */
  speed?: number;
  /** Orbiting nodes (departments / AI employees). */
  nodes?: number;
  /** 0–1 per node: lights a node (and draws its beam) from a real event. */
  heat?: number[];
  /** Real audio level 0–1, read per frame while `live`. */
  level?: () => number;
  live?: boolean;
  still?: boolean;
  paused?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (!live || !level || still || paused) {
      el.style.setProperty("--jc-lvl", "0");
      return;
    }
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      smooth += (level() - smooth) * 0.35;
      el.style.setProperty("--jc-lvl", smooth.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, level, still, paused]);

  const n = Math.max(3, Math.min(16, Math.round(nodes)));
  const particles = compact ? PARTICLES.slice(0, 6) : PARTICLES;
  return (
    <div
      ref={root}
      aria-hidden
      className={cn("jc", className)}
      data-tone={tone}
      data-still={still || undefined}
      data-paused={paused || undefined}
      data-compact={compact || undefined}
      style={{ "--jc-speed": String(1 / Math.max(0.2, speed)) } as CSSProperties}
    >
      <div className="jc-halo" />
      <div className="jc-sweep" />
      <div className="jc-ring jc-ring-dash" />
      <div className="jc-ring jc-ring-thin" />
      <div className="jc-tilt jc-tilt-a">
        <div className="jc-orbit-ring" />
      </div>
      <div className="jc-tilt jc-tilt-b">
        <div className="jc-orbit-ring jc-orbit-ring-b" />
      </div>
      <div className="jc-tilt jc-tilt-c">
        <div className="jc-orbit-ring" />
      </div>
      <div className="jc-wave" />
      <div className="jc-wave jc-wave-2" />
      {!compact ? (
        <div className="jc-nodes">
          {Array.from({ length: n }, (_, i) => {
            const a = (i / n) * 360;
            const h = heat?.[i] ?? 0;
            return (
              <span key={i} className="jc-node-arm" style={{ transform: `rotate(${a}deg)` }}>
                {h > 0.02 ? <span className="jc-beam" style={{ opacity: h * 0.7 }} /> : null}
                <span className="jc-node" data-hot={h > 0.02 || undefined} style={h > 0.02 ? ({ "--jc-heat": h.toFixed(2) } as CSSProperties) : undefined} />
              </span>
            );
          })}
        </div>
      ) : null}
      <div className="jc-particles">
        {particles.map((p, i) => (
          <span
            key={i}
            className="jc-particle"
            style={
              {
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: p.size,
                height: p.size,
                "--dx": `${p.dx}px`,
                "--dy": `${p.dy}px`,
                animationDuration: `${p.dur}s`,
                animationDelay: `${p.delay}s`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="jc-nucleus">
        <div className="jc-facet" />
      </div>
    </div>
  );
}
