"use client";

import { useSyncExternalStore } from "react";

/**
 * Open/closed state of the Realy voice dock, shared by the dock itself and the mobile tab bar's centre "Realy" button
 * (both live in the app frame; this avoids threading a callback through the shell).
 */
let open = false;
let used = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function setDockOpen(v: boolean | ((prev: boolean) => boolean)) {
  const next = typeof v === "function" ? v(open) : v;
  if (next) used = true;
  if (next === open) return;
  open = next;
  emit();
}

export function useDockOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}

/** True once the person opened the dock in this page session (the dock then connects to the company). */
export function useDockUsed(): boolean {
  return useSyncExternalStore(subscribe, () => used, () => false);
}
