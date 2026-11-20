"use client";

import type { CSSProperties, ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

/** A timeline bar that grows from its start date into place (staggered by row); static under reduced motion. */
export function GrowBar({ index, className, style, title, children }: { index: number; className?: string; style?: CSSProperties; title?: string; children?: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.span
      className={className}
      style={{ ...style, transformOrigin: "var(--grow-origin, left)" }}
      title={title}
      initial={reduced ? false : { scaleX: 0, opacity: 0.4 }}
      animate={{ scaleX: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 140, damping: 22, delay: Math.min(index, 30) * 0.03 }}
    >
      {children}
    </motion.span>
  );
}

/** Fade/slide-in wrapper for lists of cards. */
export function Appear({ index = 0, className, children }: { index?: number; className?: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div className={className} initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: Math.min(index, 12) * 0.05, ease: [0.16, 1, 0.3, 1] }}>
      {children}
    </motion.div>
  );
}
