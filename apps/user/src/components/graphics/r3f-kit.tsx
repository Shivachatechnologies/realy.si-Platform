"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { downgradeCoreTier } from "./core-quality";

/**
 * Drives a `frameloop="demand"` canvas at a fixed cap (30 fps on phones, 60 elsewhere). Nothing is requested while
 * paused, so a hidden tab or an off-screen core costs no GPU time.
 */
export function FrameDriver({ fps, paused }: { fps: number; paused?: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (paused) return;
    const step = 1000 / fps;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < step - 1.5) return;
      last = now;
      invalidate();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fps, paused, invalidate]);
  return null;
}

/**
 * Lowers the pixel ratio when frames run slow (and raises it again with headroom), within `[min, max]` (also clamped to
 * the screen's own ratio). If even the minimum cannot hold ~20 fps, the page falls back to the CSS core.
 */
export function AdaptiveDpr({ min, max, fps }: { min: number; max: number; fps: number }) {
  const setDpr = useThree((s) => s.setDpr);
  const top = Math.min(max, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  const s = useRef({ acc: 0, n: 0, dpr: top, slow: 0 });
  useFrame((_, dt) => {
    const st = s.current;
    // Ignore the gap after a pause (tab hidden / scrolled away).
    if (dt > 0.5) return;
    st.acc += dt;
    st.n++;
    if (st.acc < 2) return;
    const avg = st.acc / st.n;
    st.acc = 0;
    st.n = 0;
    const budget = 1 / fps;
    if (avg > budget * 1.45 && st.dpr > min) {
      st.dpr = Math.max(min, st.dpr - 0.25);
      setDpr(st.dpr);
    } else if (avg < budget * 1.05 && st.dpr < top) {
      st.dpr = Math.min(top, st.dpr + 0.25);
      setDpr(st.dpr);
    }
    st.slow = st.dpr <= min && avg > 1 / 20 ? st.slow + 1 : 0;
    if (st.slow >= 2) downgradeCoreTier();
  });
  return null;
}
