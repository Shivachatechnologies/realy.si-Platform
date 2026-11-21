"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { AiCore } from "@/components/motion/ai-core";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";
import { accentColors, onThemeChange } from "./color";

/** SVG fallback while the 3D chunk loads, without WebGL, or under reduced motion. */
function Fallback({ className }: { className?: string }) {
  return (
    <div className={cn("grid size-full place-items-center", className)}>
      <AiCore className="size-[70%] max-h-full max-w-full" />
    </div>
  );
}

const AiCore3D = dynamic(() => import("./ai-core-3d"), { ssr: false, loading: () => <Fallback /> });

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * The AI intelligence core as a procedural Three.js scene — loaded on demand (next/dynamic, ssr:false) only where it
 * carries meaning (auth, Command Center, AI journey). `activity` (0–1) must come from real workload (running/queued
 * AI tasks); `nodes` from real AI employees. Falls back to the SVG core under reduced motion, without WebGL, during
 * load, and pauses rendering when scrolled off-screen. Decorative: describe the data in surrounding text.
 */
export function AiCoreStage({ activity = 0, nodes = 6, className }: { activity?: number; nodes?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [ready, setReady] = useState<{ gl: boolean; colors: { a: [number, number, number]; b: [number, number, number] } } | null>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const p = accentColors(el);
      setReady({ gl: webglAvailable(), colors: { a: p.a, b: p.b } });
    };
    read();
    const off = onThemeChange(read);
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { rootMargin: "120px" });
    io.observe(el);
    return () => {
      off();
      io.disconnect();
    };
  }, []);

  return (
    <div ref={ref} aria-hidden className={cn("relative", className)}>
      {!ready || reduced || !ready.gl ? <Fallback /> : <AiCore3D activity={activity} nodes={nodes} colors={ready.colors} paused={!visible} />}
    </div>
  );
}
