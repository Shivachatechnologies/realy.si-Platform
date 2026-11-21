"use client";

import { useRef, type ReactNode, type PointerEvent } from "react";
import { motion, useMotionValue, useSpring } from "motion/react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * Magnetic hover: the child drifts toward the pointer (fine pointers only) and springs back on leave.
 * `strength` is the fraction of the pointer offset applied (0.25 = subtle). Static under reduced motion.
 */
export function Magnetic({ children, strength = 0.28, className }: { children: ReactNode; strength?: number; className?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const x = useSpring(useMotionValue(0), { stiffness: 260, damping: 18, mass: 0.4 });
  const y = useSpring(useMotionValue(0), { stiffness: 260, damping: 18, mass: 0.4 });

  function move(e: PointerEvent) {
    if (reduced || e.pointerType !== "mouse" || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  }
  function leave() {
    x.set(0);
    y.set(0);
  }
  return (
    <motion.span ref={ref} onPointerMove={move} onPointerLeave={leave} style={reduced ? undefined : { x, y }} className={cn("inline-flex", className)}>
      {children}
    </motion.span>
  );
}
