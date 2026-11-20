"use client";

import { motion } from "motion/react";
import { Check, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { AiCore } from "./ai-core";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * Premium loading sequence for real long-running work (AI runs, generation, imports): the AI core breathes while a
 * checklist shows what is happening. Progress is never invented: pass `current` (index of the step in progress,
 * from real status) — steps before it are done; omit it to show the steps as a plan with an indeterminate bar.
 */
export function LoadingSequence({ title, steps, current, className }: { title: string; steps: string[]; current?: number | null; className?: string }) {
  const reduced = useReducedMotion();
  const known = typeof current === "number";
  return (
    <div role="status" aria-live="polite" className={cn("grid justify-items-center gap-5 text-center", className)}>
      <div className="relative">
        <AiCore className="size-28" />
        {reduced ? null : <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-primary/10 [animation-duration:2.4s]" />}
      </div>
      <p className="font-display text-display-lg">{title}</p>
      <div className="h-1 w-56 overflow-hidden rounded-full bg-muted">
        {known ? (
          <motion.div
            className="progress-sheen h-full rounded-full bg-brand-gradient"
            initial={false}
            animate={{ width: `${Math.round(((current! + 0.5) / Math.max(1, steps.length)) * 100)}%` }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          />
        ) : (
          <div className="progress-indeterminate h-full w-full rounded-full bg-brand-gradient" />
        )}
      </div>
      <ol className="grid w-full max-w-sm gap-2 text-start text-sm">
        {steps.map((s, i) => {
          const state = !known ? "plan" : i < current! ? "done" : i === current ? "active" : "todo";
          return (
            <li key={s} className={cn("flex items-center gap-2.5 transition-opacity", state === "todo" && "opacity-45", state === "plan" && "opacity-80")}>
              <span aria-hidden className={cn("grid size-5 shrink-0 place-items-center rounded-full border", state === "done" && "border-success bg-success/15 text-success", state === "active" && "border-primary text-primary")}>
                {state === "done" ? <Check className="size-3" /> : state === "active" ? <LoaderCircle className="size-3 animate-spin" /> : <span className="size-1 rounded-full bg-current" />}
              </span>
              <span className={cn(state === "active" && "font-medium")}>{s}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
