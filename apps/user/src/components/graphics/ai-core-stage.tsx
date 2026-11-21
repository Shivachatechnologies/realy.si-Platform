"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { accentColors, onThemeChange, toRgb } from "./color";
import { CoreCss } from "./core-css";
import { useCoreMode } from "./core-quality";

const AiCore3D = dynamic(() => import("./ai-core-3d"), { ssr: false, loading: () => null });

/**
 * The AI intelligence core — loaded on demand (next/dynamic, ssr:false) only where it carries meaning (auth, Command
 * Center, AI journey). `activity` (0–1) must come from real workload (running/queued AI tasks); `nodes` from real AI
 * employees. 3D on capable devices (phones at the "lite" tier: ≤1.5 DPR, fewer particles, 30 fps) when it holds the
 * page's single WebGL slot; otherwise — and on the server, during load, without WebGL or on low-end devices — the
 * animated CSS core at the same size (no layout shift); the still CSS core under reduced motion. Pauses rendering
 * when hidden or scrolled off-screen. Decorative: describe the data in surrounding text.
 */
export function AiCoreStage({ activity = 0, nodes = 6, className, priority = 2 }: { activity?: number; nodes?: number; className?: string; priority?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { mode, paused } = useCoreMode(ref, { priority });
  const [colors, setColors] = useState<{ a: [number, number, number]; b: [number, number, number] } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || mode.kind !== "3d") return;
    const read = () => {
      const p = accentColors(el);
      const glow = getComputedStyle(el).getPropertyValue("--core-glow").trim();
      setColors({ a: p.a, b: glow ? toRgb(glow) : p.b });
    };
    read();
    return onThemeChange(read);
  }, [mode.kind]);

  const act = Math.max(0, Math.min(1, activity));
  return (
    <div ref={ref} aria-hidden className={cn("relative", className)}>
      {mode.kind === "3d" && colors ? (
        <AiCore3D activity={act} nodes={nodes} colors={colors} paused={paused} quality={mode.tier} />
      ) : (
        <CoreCss speed={0.9 + act * 2} nodes={nodes} still={mode.kind === "reduced"} paused={paused} />
      )}
    </div>
  );
}
