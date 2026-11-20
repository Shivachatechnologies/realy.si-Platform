"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "./use-reduced-motion";

const RAYS = 12;

/**
 * Completion effect: a check mark draws inside a ring while light particles burst outward. Shown while `active`;
 * `onDone` fires after ~1.6 s (use it to clear the state). The `label` is announced politely to screen readers.
 * Reduced motion: a static check with the label.
 */
export function SuccessBurst({ active, label, onDone, className, size = 88 }: { active: boolean; label?: string; onDone?: () => void; className?: string; size?: number }) {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!active || !onDone) return;
    const id = window.setTimeout(onDone, 1600);
    return () => window.clearTimeout(id);
  }, [active, onDone]);

  return (
    <div role="status" aria-live="polite" className={cn("pointer-events-none relative grid place-items-center", className)} style={{ width: size, height: size }}>
      {active && label ? <span className="sr-only">{label}</span> : null}
      <AnimatePresence>
        {active ? (
          <motion.svg
            key="burst"
            viewBox="0 0 100 100"
            width={size}
            height={size}
            aria-hidden
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: reduced ? 0 : 0.45, ease: [0.34, 1.4, 0.64, 1] }}
            className="overflow-visible text-success"
          >
            <circle cx="50" cy="50" r="30" fill="color-mix(in oklch, currentColor 14%, transparent)" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" />
            <motion.path
              d="M37 51 L46 60 L64 41"
              fill="none"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: reduced ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.5, delay: 0.15, ease: [0.65, 0, 0.35, 1] }}
            />
            {reduced
              ? null
              : Array.from({ length: RAYS }, (_, i) => {
                  const a = (i / RAYS) * Math.PI * 2;
                  return (
                    <motion.circle
                      key={i}
                      r={i % 3 === 0 ? 2.4 : 1.6}
                      fill={i % 2 ? "var(--primary)" : "currentColor"}
                      initial={{ cx: 50, cy: 50, opacity: 1 }}
                      animate={{ cx: 50 + Math.cos(a) * 48, cy: 50 + Math.sin(a) * 48, opacity: 0 }}
                      transition={{ duration: 0.9, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    />
                  );
                })}
            {reduced ? null : (
              <motion.circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" strokeWidth="2" initial={{ r: 30, opacity: 0.6 }} animate={{ r: 50, opacity: 0 }} transition={{ duration: 0.9, ease: "easeOut" }} />
            )}
          </motion.svg>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
