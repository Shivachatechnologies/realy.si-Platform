"use client";

import { createContext, useContext, useRef, type ReactNode, type PointerEvent } from "react";
import { motion, useMotionValue, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * Scroll parallax layer: moves `speed` × 100px against the scroll while its section crosses the viewport.
 * Negative speed moves with the scroll. Static under reduced motion.
 */
export function Parallax({ children, speed = 0.2, className }: { children: ReactNode; speed?: number; className?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [speed * 100, -speed * 100]);
  return (
    <motion.div ref={ref} style={reduced ? undefined : { y }} className={className}>
      {children}
    </motion.div>
  );
}

const DepthContext = createContext<{ mx: MotionValue<number>; my: MotionValue<number>; reduced: boolean } | null>(null);

/**
 * Pointer-depth scene: children wrapped in <DepthLayer depth={n}> shift with the pointer by `depth` pixels,
 * giving layered illustrations and 3D scenes a sense of depth. Static under reduced motion or touch.
 */
export function DepthScene({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  function move(e: PointerEvent<HTMLDivElement>) {
    if (reduced || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  }
  return (
    <div
      className={cn("relative", className)}
      onPointerMove={move}
      onPointerLeave={() => {
        mx.set(0);
        my.set(0);
      }}
    >
      <DepthContext.Provider value={{ mx, my, reduced }}>{children}</DepthContext.Provider>
    </div>
  );
}


export function DepthLayer({ children, depth = 12, className }: { children: ReactNode; depth?: number; className?: string }) {
  const ctx = useContext(DepthContext);
  const fallback = useMotionValue(0);
  const sx = useSpring(ctx?.mx ?? fallback, { stiffness: 120, damping: 20 });
  const sy = useSpring(ctx?.my ?? fallback, { stiffness: 120, damping: 20 });
  const x = useTransform(sx, (v) => v * depth);
  const y = useTransform(sy, (v) => v * depth);
  return (
    <motion.div style={ctx && !ctx.reduced ? { x, y } : undefined} className={className}>
      {children}
    </motion.div>
  );
}
