"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { DEPARTMENTS } from "@/server/modules/voiceos/catalog";
import type { CoreVisualProps } from "./core-state";

const PULSE_MS = 4_500;
const TONE: Record<string, string> = { ALERT: "var(--warning)", SUCCESS: "var(--success)" };

/**
 * SVG AI Core — fallback for reduced motion, devices without WebGL or with little power, and the compact dock.
 * The same states and real signals as the 3D core: ring speed/colour from the state, nucleus scale from the real
 * audio level (rAF, skipped under reduced motion), department dots from live events.
 */
export function JarvisCoreSvg({ state, level, pulses, paused, reducedMotion, className, compact = false }: CoreVisualProps & { reducedMotion: boolean; className?: string; compact?: boolean }) {
  const id = useId().replace(/:/g, "");
  const nucleus = useRef<SVGCircleElement>(null);
  const halo = useRef<SVGCircleElement>(null);
  const [now, setNow] = useState(0);

  // Audio-reactive nucleus (direct DOM writes; no React render per frame).
  useEffect(() => {
    if (reducedMotion || paused || (state !== "LISTENING" && state !== "SPEAKING")) {
      nucleus.current?.setAttribute("r", "26");
      halo.current?.setAttribute("r", "40");
      return;
    }
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      smooth += (level() - smooth) * 0.35;
      nucleus.current?.setAttribute("r", String(26 + smooth * 14));
      halo.current?.setAttribute("r", String(40 + smooth * 26));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, level, paused, reducedMotion]);

  // Department dots fade over a few seconds after an event.
  const latest = Math.max(0, ...Object.values(pulses).map((v) => v ?? 0));
  useEffect(() => {
    if (!latest) return;
    const iv = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n - latest > PULSE_MS) clearInterval(iv);
    }, 250);
    return () => clearInterval(iv);
  }, [latest]);

  const color = TONE[state] ?? "var(--world-accent, var(--primary))";
  const spin = state === "THINKING" ? "jarvis-spin-fast" : state === "IDLE" ? "jarvis-spin-slow" : "jarvis-spin";
  const animate = !reducedMotion && !paused;
  return (
    <svg viewBox="0 0 200 200" aria-hidden className={cn("size-full", className)} fill="none" data-state={state}>
      <defs>
        <radialGradient id={`${id}-n`}>
          <stop offset="0%" style={{ stopColor: "var(--surface)" }} />
          <stop offset="40%" style={{ stopColor: color }} />
          <stop offset="100%" style={{ stopColor: "var(--world-accent-2, var(--primary-2))" }} />
        </radialGradient>
        <radialGradient id={`${id}-h`}>
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.45 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      <style>{`
        @keyframes jarvis-rot { to { transform: rotate(360deg) } }
        .jarvis-spin-slow { animation: jarvis-rot 28s linear infinite; transform-origin: 100px 100px }
        .jarvis-spin { animation: jarvis-rot 12s linear infinite; transform-origin: 100px 100px }
        .jarvis-spin-fast { animation: jarvis-rot 3.5s linear infinite; transform-origin: 100px 100px }
        .jarvis-rev { animation-direction: reverse }
        @media (prefers-reduced-motion: reduce) { .jarvis-spin-slow, .jarvis-spin, .jarvis-spin-fast { animation: none } }
      `}</style>
      <circle ref={halo} cx="100" cy="100" r="40" fill={`url(#${id}-h)`} />
      <g className={animate ? spin : undefined}>
        <circle cx="100" cy="100" r="62" stroke={color} strokeOpacity="0.55" strokeWidth="1.2" strokeDasharray="3 7" />
      </g>
      <g className={animate ? `${spin} jarvis-rev` : undefined}>
        <ellipse cx="100" cy="100" rx="78" ry="30" stroke="var(--world-accent-2, var(--primary-2))" strokeOpacity="0.45" strokeWidth="1" transform="rotate(-24 100 100)" />
      </g>
      <g className={animate ? spin : undefined}>
        <ellipse cx="100" cy="100" rx="78" ry="30" stroke={color} strokeOpacity="0.35" strokeWidth="1" transform="rotate(36 100 100)" />
      </g>
      {!compact
        ? DEPARTMENTS.map((d, i) => {
            const a = (i / DEPARTMENTS.length) * Math.PI * 2 - Math.PI / 2;
            const at = pulses[d] ?? 0;
            const heat = at && now ? Math.max(0, 1 - (now - at) / PULSE_MS) : 0;
            const x = 100 + Math.cos(a) * 88;
            const y = 100 + Math.sin(a) * 88;
            return (
              <g key={d}>
                {heat > 0.02 ? <line x1="100" y1="100" x2={x} y2={y} stroke="var(--world-accent-2, var(--primary-2))" strokeOpacity={heat * 0.6} strokeWidth="1" /> : null}
                <circle cx={x} cy={y} r={3 + heat * 3} fill={heat > 0.02 ? "var(--world-accent-2, var(--primary-2))" : "var(--muted-foreground)"} fillOpacity={0.35 + heat * 0.65} />
              </g>
            );
          })
        : null}
      <circle ref={nucleus} cx="100" cy="100" r="26" fill={`url(#${id}-n)`} />
    </svg>
  );
}
