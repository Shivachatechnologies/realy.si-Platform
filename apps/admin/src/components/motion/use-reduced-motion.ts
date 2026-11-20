"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(cb: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

/** True when the OS asks for reduced motion. Server render assumes motion is allowed (CSS also guards). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !!window.matchMedia?.(QUERY).matches,
    () => false,
  );
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.(QUERY).matches;
}
