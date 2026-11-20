"use client";

import type { ReactNode } from "react";
import { motion, type Variants } from "motion/react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "./use-reduced-motion";

const container = (step: number, delay: number): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: step, delayChildren: delay } },
});
const item: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.985 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

/**
 * Staggered entrance driven by `motion`: children wrapped in <StaggerItem> rise in one after another when the group
 * scrolls into view (once). Reduced motion renders statically. Use for below-the-fold groups; above the fold the CSS
 * `stagger` class is cheaper.
 */
export function Stagger({ children, className, step = 0.07, delay = 0, as = "div" }: { children: ReactNode; className?: string; step?: number; delay?: number; as?: "div" | "ul" | "ol" | "section" }) {
  const reduced = useReducedMotion();
  if (reduced) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }
  const M = motion[as];
  return (
    <M className={className} variants={container(step, delay)} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.15 }}>
      {children}
    </M>
  );
}

export function StaggerItem({ children, className, as = "div" }: { children: ReactNode; className?: string; as?: "div" | "li" | "article" }) {
  const reduced = useReducedMotion();
  if (reduced) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }
  const M = motion[as];
  return (
    <M className={cn(className)} variants={item}>
      {children}
    </M>
  );
}
