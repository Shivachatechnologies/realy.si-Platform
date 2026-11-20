"use client";

import { useEffect, useRef } from "react";
import { onThemeChange } from "./color";
import { prefersReducedMotion } from "@/components/motion/use-reduced-motion";

export interface CanvasFrame {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** Seconds since start. */
  t: number;
  /** Seconds since the previous frame (clamped). */
  dt: number;
  reduced: boolean;
}

/**
 * Canvas render loop with the boring parts done right: DPR-aware sizing (capped at 2), ResizeObserver, pauses while
 * off-screen or the tab is hidden, a single static frame under reduced motion, and `setup` re-run on theme change
 * (so token colours are re-read). `draw` returns false to stop the loop (e.g. a settled static scene).
 */
export function useCanvas(
  setup: (canvas: HTMLCanvasElement) => void,
  draw: (f: CanvasFrame) => boolean | void,
  deps: unknown[] = [],
) {
  const ref = useRef<HTMLCanvasElement>(null);
  const kickRef = useRef<() => void>(() => {});
  const drawRef = useRef(draw);
  const setupRef = useRef(setup);
  useEffect(() => {
    drawRef.current = draw;
    setupRef.current = setup;
  });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = prefersReducedMotion();
    let width = 0;
    let height = 0;
    let raf = 0;
    let visible = true;
    let running = false;
    const start = performance.now();
    let last = start;

    const size = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, r.width);
      height = Math.max(1, r.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const frame = (now: number) => {
      const t = (now - start) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const keep = drawRef.current({ ctx, width, height, t, dt, reduced });
      if (keep === false || reduced || !visible || document.hidden) {
        running = false;
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    size();
    setupRef.current(canvas);
    kickRef.current = kick;
    kick();

    const ro = new ResizeObserver(() => {
      size();
      if (reduced || !running) {
        running = false;
        kick();
      }
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) kick();
    });
    io.observe(canvas);
    const onVis = () => !document.hidden && kick();
    document.addEventListener("visibilitychange", onVis);
    const offTheme = onThemeChange(() => {
      setupRef.current(canvas);
      kick();
    });
    return () => {
      kickRef.current = () => {};
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      offTheme();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  /** `wake()` restarts a loop that stopped (draw returned false) — call it on interaction or data change. */
  return { ref, wake: () => kickRef.current() };
}
