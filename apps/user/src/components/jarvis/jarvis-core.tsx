"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { accentColors, onThemeChange, readTokens, toRgb } from "@/components/graphics/color";
import { CoreCss } from "@/components/graphics/core-css";
import { useCoreMode } from "@/components/graphics/core-quality";
import { DEPARTMENTS } from "@/server/modules/voiceos/catalog";
import { STATE_TUNING, type CoreVisualProps } from "./core-state";
import type { CorePalette } from "./jarvis-core-3d";

const JarvisCore3D = dynamic(() => import("./jarvis-core-3d"), { ssr: false, loading: () => null });

const PULSE_MS = 4_500;

/** Department heat (0–1) from the live event stream, re-evaluated a few times a second while a pulse fades. */
function useHeat(pulses: CoreVisualProps["pulses"], enabled: boolean): number[] {
  const [now, setNow] = useState(0);
  const latest = Math.max(0, ...Object.values(pulses).map((v) => v ?? 0));
  useEffect(() => {
    if (!enabled || !latest) return;
    const iv = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n - latest > PULSE_MS) clearInterval(iv);
    }, 250);
    return () => clearInterval(iv);
  }, [latest, enabled]);
  return DEPARTMENTS.map((d) => {
    const at = pulses[d] ?? 0;
    return at && now ? Math.max(0, 1 - (now - at) / PULSE_MS) : 0;
  });
}

/**
 * The Realy AI Core, driven by the console's real signals (state, audio level, department events, workload).
 *
 *   3D (React Three Fiber) where WebGL is available and the device is capable — phones included, at the "lite" tier
 *   (≤1.5 DPR, fewer particles, 30 fps) — and only for the one core holding the page's WebGL slot (`priority`).
 *   Animated CSS core everywhere else: compact (dock, tab bar), no WebGL, Data Saver, low memory, before the 3D chunk
 *   loads (also the server render, so there is no layout shift), or when the 3D scene could not keep up.
 *   Still CSS core under reduced motion.
 * Rendering pauses when the tab is hidden or the core is scrolled away. Decorative: the console states the same
 * information in text (state label, captions, event list).
 */
export function JarvisCore({
  className,
  compact = false,
  priority = 2,
  ambient = false,
  ...props
}: CoreVisualProps & { className?: string; compact?: boolean; priority?: number; ambient?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { mode, paused: offscreen } = useCoreMode(ref, { priority, allow3d: !compact });
  const [palette, setPalette] = useState<CorePalette | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || mode.kind !== "3d") return;
    const read = () => {
      const p = accentColors(el);
      const glow = getComputedStyle(el).getPropertyValue("--core-glow").trim();
      const t = readTokens(el, { warning: "--warning", success: "--success", danger: "--danger" });
      setPalette({ a: p.a, b: glow ? toRgb(glow) : p.b, warning: t.warning, success: t.success, danger: t.danger });
    };
    read();
    return onThemeChange(read);
  }, [mode.kind]);

  const heat = useHeat(props.pulses, mode.kind !== "3d" && !compact);
  const paused = offscreen || !!props.paused;
  const tune = STATE_TUNING[props.state];
  return (
    <div ref={ref} aria-hidden className={cn("relative", className)}>
      {mode.kind === "3d" && palette ? (
        <JarvisCore3D {...props} palette={palette} paused={paused} quality={mode.tier} ambient={ambient} />
      ) : (
        <CoreCss
          tone={tune.tone}
          speed={0.6 + tune.spin * 2 + props.activity * 0.6}
          nodes={DEPARTMENTS.length}
          heat={heat}
          level={props.level}
          live={props.state === "LISTENING" || props.state === "SPEAKING"}
          still={mode.kind === "reduced"}
          paused={paused}
          compact={compact}
        />
      )}
    </div>
  );
}
