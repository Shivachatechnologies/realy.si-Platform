"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-render the server page every few seconds while a task is queued or running, so status and output appear live. */
export function AutoRefresh({ active, intervalMs = 3000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);
  return null;
}
