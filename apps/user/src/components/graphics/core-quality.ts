"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";

/**
 * Adaptive quality for the AI Core visuals (AiCoreStage, JarvisCore).
 *
 *   "full" — desktop/laptop: 3D at up to 1.75 DPR, full particle field, 60 fps.
 *   "lite" — phones and small tablets with WebGL: 3D at ≤1.5 DPR, ~40% of the particles, 30 fps cap, no MSAA.
 *   "css"  — no WebGL, Data Saver, ≤2 GB device memory, or a 3D scene that could not hold 20 fps: the animated CSS core.
 *
 * Reduced motion is handled by the callers (a gentle, non-moving CSS core). Device signals that Safari does not expose
 * (deviceMemory) are simply absent there; hardwareConcurrency is not used as a low-end signal because iOS reports a
 * capped value on capable phones.
 */
export type CoreTier = "full" | "lite" | "css";

let cachedTier: CoreTier | null = null;
let gpuDowngraded = false;

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    // Free the probe context right away (browsers cap live contexts per page).
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function detectCoreTier(): CoreTier {
  if (gpuDowngraded) return "css";
  if (cachedTier) return cachedTier;
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const lowEnd = !!n.connection?.saveData || (n.deviceMemory !== undefined && n.deviceMemory <= 2) || (n.hardwareConcurrency !== undefined && n.hardwareConcurrency < 2);
  if (lowEnd || !webglAvailable()) cachedTier = "css";
  else {
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const small = Math.min(window.innerWidth, window.innerHeight) < 768;
    cachedTier = coarse || small ? "lite" : "full";
  }
  return cachedTier;
}

/** A 3D scene that could not keep up calls this: every core on the page falls back to the animated CSS core. */
export function downgradeCoreTier() {
  gpuDowngraded = true;
  emit();
}

export const TIER_SETTINGS: Record<Exclude<CoreTier, "css">, { dpr: [number, number]; fps: number; particles: number; antialias: boolean }> = {
  full: { dpr: [0.75, 1.75], fps: 60, particles: 1, antialias: true },
  lite: { dpr: [0.75, 1.5], fps: 30, particles: 0.4, antialias: false },
};

/* ── One WebGL context per page ──
 * Every 3D core claims the slot with a priority; only the highest (earliest on a tie) renders WebGL, the others show
 * the CSS core. The holder's <Canvas> unmount disposes its renderer and loses the context (React Three Fiber). */
const claims = new Map<symbol, number>();
const listeners = new Set<() => void>();
let holder: symbol | null = null;
function emit() {
  let best: symbol | null = null;
  let bestP = -Infinity;
  for (const [k, p] of claims) if (p > bestP) [best, bestP] = [k, p];
  holder = best;
  listeners.forEach((l) => l());
}
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

function useGlSlot(want: boolean, priority: number): boolean {
  const [key] = useState(() => Symbol("core"));
  useEffect(() => {
    if (!want) return;
    claims.set(key, priority);
    emit();
    return () => {
      claims.delete(key);
      emit();
    };
  }, [want, priority, key]);
  const current = useSyncExternalStore(subscribe, () => holder, () => null);
  const downgraded = useSyncExternalStore(subscribe, () => gpuDowngraded, () => false);
  return want && !downgraded && current === key;
}

const subscribeVisibility = (cb: () => void) => {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
};

export type CoreMode = { kind: "3d"; tier: Exclude<CoreTier, "css"> } | { kind: "css" } | { kind: "reduced" };

/**
 * Decide how a core renders: 3D (with its quality tier), the animated CSS core, or the still core (reduced motion).
 * The 3D decision waits for the browser to be idle after first paint so the core never competes with the page's
 * text for LCP; until then (and on the server) the CSS core is shown at the same size, so nothing shifts.
 * `paused` is true while the tab is hidden or the core is scrolled away.
 */
export function useCoreMode(ref: RefObject<HTMLElement | null>, { priority = 1, allow3d = true }: { priority?: number; allow3d?: boolean } = {}) {
  const reduced = useReducedMotion();
  const hidden = useSyncExternalStore(subscribeVisibility, () => document.visibilityState === "hidden", () => false);
  const [tier, setTier] = useState<CoreTier | null>(null);
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Safari < 18 has no requestIdleCallback.
    const hasIdle = typeof window.requestIdleCallback === "function";
    const decide = () => setTier(detectCoreTier());
    const idle = hasIdle ? window.requestIdleCallback(decide, { timeout: 1500 }) : window.setTimeout(decide, 400);
    const io = new IntersectionObserver(([e]) => setOnScreen(!!e?.isIntersecting), { rootMargin: "120px" });
    io.observe(el);
    return () => {
      if (hasIdle) window.cancelIdleCallback(idle);
      else clearTimeout(idle);
      io.disconnect();
    };
  }, [ref]);

  const wants3d = allow3d && !reduced && tier !== null && tier !== "css";
  const granted = useGlSlot(wants3d, priority);
  const mode: CoreMode = reduced ? { kind: "reduced" } : granted && tier && tier !== "css" ? { kind: "3d", tier } : { kind: "css" };
  return { mode, paused: hidden || !onScreen, reduced };
}
