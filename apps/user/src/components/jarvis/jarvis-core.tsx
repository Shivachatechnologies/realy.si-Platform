"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";
import { accentColors, onThemeChange, readTokens } from "@/components/graphics/color";
import type { CoreVisualProps } from "./core-state";
import type { CorePalette } from "./jarvis-core-3d";
import { JarvisCoreSvg } from "./jarvis-core-svg";

const JarvisCore3D = dynamic(() => import("./jarvis-core-3d"), { ssr: false, loading: () => null });

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Little memory/cores or data saver → the SVG core. */
function lowEnd(): boolean {
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return (n.deviceMemory !== undefined && n.deviceMemory <= 2) || (n.hardwareConcurrency !== undefined && n.hardwareConcurrency <= 2) || !!n.connection?.saveData;
}

const subscribeVisibility = (cb: () => void) => {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
};

/**
 * The Realy AI Core: a React Three Fiber scene (orbital rings, particles, energy waves, department nodes) driven by
 * the console's real signals, with an SVG fallback under reduced motion, without WebGL, on low-end devices and in
 * compact mode. Rendering pauses when the tab is hidden or the core is scrolled away. Decorative: the console states
 * the same information in text (state label, captions, event list).
 */
export function JarvisCore({ className, compact = false, ...props }: CoreVisualProps & { className?: string; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const hidden = useSyncExternalStore(subscribeVisibility, () => document.visibilityState === "hidden", () => false);
  const [env, setEnv] = useState<{ gl: boolean; palette: CorePalette } | null>(null);
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const p = accentColors(el);
      const t = readTokens(el, { warning: "--warning", success: "--success", danger: "--danger" });
      setEnv({ gl: !compact && webglAvailable() && !lowEnd(), palette: { a: p.a, b: p.b, warning: t.warning, success: t.success, danger: t.danger } });
    };
    read();
    const off = onThemeChange(read);
    const io = new IntersectionObserver(([e]) => setOnScreen(!!e?.isIntersecting), { rootMargin: "80px" });
    io.observe(el);
    return () => {
      off();
      io.disconnect();
    };
  }, [compact]);

  const paused = hidden || !onScreen || !!props.paused;
  return (
    <div ref={ref} aria-hidden className={cn("relative", className)}>
      {env?.gl && !reduced ? (
        <JarvisCore3D {...props} palette={env.palette} paused={paused} />
      ) : (
        <JarvisCoreSvg {...props} paused={paused} reducedMotion={reduced} compact={compact} />
      )}
    </div>
  );
}
