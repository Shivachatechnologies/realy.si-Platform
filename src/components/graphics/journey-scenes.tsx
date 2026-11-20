"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";
import { AiCore } from "@/components/motion/ai-core";
import { ParticleField } from "./particle-field";
import { AiAvatar } from "./ai-avatar";
import { hash } from "./color";

const STOP = new Set(
  "a an and are as at be by for from has have i in into is it its of on or our so that the their them they this to us we what when which who will with you your my me can do does not more most very also just about over than then there these those been being make makes help helps get our ours der die das und ein eine ist für mit von zu den dem des el la los las y de que en un una para".split(" "),
);

/** Distinct keywords of a typed idea (longest first), for the vision scene. */
export function ideaKeywords(text: string, max = 9): string[] {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w));
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, max);
}

/**
 * Vision scene: as the founder types the idea, its keywords drift out of the AI core into orbit (and leave when
 * deleted). Purely a reflection of the typed text — nothing is generated. Decorative; the textarea is the input.
 */
export function IdeaReactor({ text, className }: { text: string; className?: string }) {
  const reduced = useReducedMotion();
  const words = useMemo(() => ideaKeywords(text), [text]);
  return (
    <div aria-hidden className={cn("relative isolate aspect-square w-full overflow-hidden rounded-3xl border bg-[radial-gradient(circle_at_center,var(--world-soft,var(--accent)),transparent_70%)]", className)}>
      <div className="absolute inset-0 opacity-70">
        <ParticleField density={0.6} intensity={Math.min(1, 0.15 + words.length * 0.09)} />
      </div>
      <div className="absolute inset-[30%] grid place-items-center">
        <AiCore className="size-full" />
      </div>
      <AnimatePresence>
        {words.map((w, i) => {
          const a = ((hash(w) % 360) / 180) * Math.PI;
          const r = 34 + (i % 3) * 6;
          return (
            <motion.span
              key={w}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border bg-surface/85 px-2.5 py-1 text-xs font-medium whitespace-nowrap shadow-elev-2 backdrop-blur"
              style={{ left: `${50 + Math.cos(a) * r}%`, top: `${50 + Math.sin(a) * r}%` }}
              initial={reduced ? false : { opacity: 0, scale: 0.4, left: "50%", top: "50%" }}
              animate={{ opacity: 1, scale: 1, left: `${50 + Math.cos(a) * r}%`, top: `${50 + Math.sin(a) * r}%` }}
              exit={{ opacity: 0, scale: 0.4 }}
              transition={{ type: "spring", stiffness: 140, damping: 16 }}
            >
              {w}
            </motion.span>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export interface SceneItem {
  id: string;
  label: string;
  /** Ring: 0 inner (departments / research steps), 1 middle (products, projects), 2 outer (AI employees, workflows). */
  ring: 0 | 1 | 2;
  /** Live: running step, active AI employee. */
  active?: boolean;
  /** Done (completed step / created record). */
  done?: boolean;
  /** Draw as an AI avatar (workforce). */
  avatar?: { seed: string; department?: string | null };
  /** The item it connects to (else the centre). */
  parentId?: string;
}

/**
 * Materialisation scene for the AI journey: real records (research steps, departments, products, projects, AI
 * employees) appear one by one around the company core and connect to it — or to their department — as the run
 * creates them. Running items pulse; pending items stay ghosted. A list mirrors it for screen readers.
 */
export function MaterializeScene({ items, center, ariaLabel, className }: { items: SceneItem[]; center: string; ariaLabel: string; className?: string }) {
  const reduced = useReducedMotion();
  const pos = useMemo(() => {
    const byRing = [0, 1, 2].map((r) => items.filter((i) => i.ring === r));
    const m = new Map<string, { x: number; y: number }>();
    byRing.forEach((list, r) => {
      const radius = [20, 32, 43][r]!;
      list.forEach((it, k) => {
        const a = (k / Math.max(1, list.length)) * Math.PI * 2 - Math.PI / 2 + r * 0.35;
        m.set(it.id, { x: 50 + Math.cos(a) * radius, y: 50 + Math.sin(a) * radius * 0.82 });
      });
    });
    return m;
  }, [items]);
  return (
    <figure className={cn("relative isolate aspect-[4/3] w-full overflow-hidden rounded-3xl border bg-[radial-gradient(ellipse_at_center,var(--world-soft,var(--accent)),transparent_72%)]", className)} aria-label={ariaLabel}>
      <div aria-hidden className="absolute inset-0 opacity-50">
        <ParticleField density={0.35} intensity={items.some((i) => i.active) ? 0.8 : 0.2} links={false} />
      </div>
      <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full">
        {[20, 32, 43].map((r) => (
          <ellipse key={r} cx="50" cy="50" rx={r} ry={r * 0.82} fill="none" stroke="var(--border-strong)" strokeOpacity="0.5" strokeDasharray="0.6 1.6" vectorEffect="non-scaling-stroke" />
        ))}
        {items.map((it, i) => {
          const p = pos.get(it.id)!;
          const from = it.parentId ? pos.get(it.parentId) : null;
          return (
            <motion.line
              key={it.id}
              x1={from?.x ?? 50}
              y1={from?.y ?? 50}
              x2={p.x}
              y2={p.y}
              stroke={it.done || it.active ? "var(--world-accent, var(--primary))" : "var(--border-strong)"}
              strokeOpacity={it.done || it.active ? 0.7 : 0.35}
              strokeWidth="1.2"
              vectorEffect="non-scaling-stroke"
              strokeDasharray={it.done ? undefined : "3 4"}
              className={it.active ? "dash-flow" : undefined}
              initial={reduced ? false : { pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.15 + i * 0.07, ease: [0.16, 1, 0.3, 1] }}
            />
          );
        })}
      </svg>
      <div className="absolute start-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 justify-items-center gap-1 rtl:translate-x-1/2">
        <span className="grid size-14 place-items-center rounded-2xl bg-brand-gradient text-primary-foreground shadow-glow">
          <AiCore className="size-12" />
        </span>
        <span className="max-w-32 truncate rounded-full bg-surface/80 px-2 py-0.5 text-[11px] font-semibold backdrop-blur">{center}</span>
      </div>
      {items.map((it, i) => {
        const p = pos.get(it.id)!;
        return (
          <motion.div
            key={it.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            initial={reduced ? false : { opacity: 0, scale: 0.3, filter: "blur(6px)" }}
            animate={{ opacity: it.done || it.active ? 1 : 0.55, scale: 1, filter: "blur(0px)" }}
            transition={{ duration: 0.7, delay: 0.3 + i * 0.07, ease: [0.34, 1.4, 0.64, 1] }}
          >
            <div className={cn("flex items-center gap-1.5 rounded-full border bg-surface/90 py-1 ps-1 pe-2.5 text-[11px] font-medium shadow-elev-2 backdrop-blur", it.active && "border-primary shadow-glow")}>
              {it.avatar ? (
                <AiAvatar seed={it.avatar.seed} department={it.avatar.department} size={20} active={it.active} />
              ) : (
                <span className={cn("size-2.5 rounded-full", it.done ? "bg-success" : it.active ? "animate-pulse bg-primary" : "bg-border-strong")} />
              )}
              <span className="max-w-28 truncate">{it.label}</span>
            </div>
          </motion.div>
        );
      })}
      <figcaption className="sr-only">
        {ariaLabel}
        <ul>
          {items.map((it) => (
            <li key={it.id}>{it.label}</li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

/**
 * Launch: a cinematic hand-off into the Command Center — the screen floods with the world light, the core scales up,
 * then navigation happens. Reduced motion navigates immediately.
 */
export function LaunchButton({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [go, setGo] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (reduced) return router.push(href);
          setGo(true);
          router.prefetch(href);
          window.setTimeout(() => router.push(href), 1100);
        }}
        className="press inline-flex h-12 items-center gap-2 rounded-xl bg-brand-gradient px-6 text-[15px] font-medium text-primary-foreground shadow-glow transition-[filter] hover:brightness-110"
      >
        {children}
        <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
      </button>
      <AnimatePresence>
        {go ? (
          <motion.div
            key="launch"
            aria-hidden
            className="fixed inset-0 z-[80] grid place-items-center bg-background"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, ease: [0.65, 0, 0.35, 1] }}
          >
            <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 6, opacity: [0, 1, 0] }} transition={{ duration: 1.1, ease: [0.65, 0, 0.35, 1] }}>
              <AiCore className="size-40" />
            </motion.div>
            <motion.div className="absolute inset-0 bg-[radial-gradient(circle,var(--glow),transparent_60%)]" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0.4] }} transition={{ duration: 1.1 }} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
