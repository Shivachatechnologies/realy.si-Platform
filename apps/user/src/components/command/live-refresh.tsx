"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-render the server page every few seconds while real work is running (paused when the tab is hidden). */
export function LiveRefresh({ active, intervalMs = 5000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);
  return null;
}
