"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
/** Current `location.search`, hydration-safe (empty on the server, real value after hydration). */
export function useLocationSearch(): string {
  return useSyncExternalStore(subscribe, () => window.location.search, () => "");
}
