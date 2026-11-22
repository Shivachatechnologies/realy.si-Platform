"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { EventFeed } from "./panels";
import { useCompanyEvents, type StreamItem } from "./use-company-events";

/** Re-render the Command Center at most this often while things happen (it reads metric snapshots, so it is cheap). */
const REFRESH_MIN_MS = 20_000;

/**
 * Real-time activity on the Command Center: the company's live event stream (SSE, fanned out over Redis by the
 * worker; polling fallback) as a feed, and a throttled server refresh when work, approvals, calls or domain events
 * change, so counts and panels follow the real state without a reload. Paused in hidden tabs by the stream itself.
 */
export function CommandLive({ base, max = 8, className }: { base: string; max?: number; className?: string }) {
  const router = useRouter();
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onItem = useCallback(
    (item: StreamItem) => {
      void item;
      if (timer.current) return;
      const wait = Math.max(1_500, last.current + REFRESH_MIN_MS - Date.now());
      timer.current = setTimeout(() => {
        timer.current = null;
        last.current = Date.now();
        if (document.visibilityState === "visible") router.refresh();
      }, wait);
    },
    [router],
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const stream = useCompanyEvents(base, { onItem });
  return <EventFeed items={stream.items} status={stream.status} max={max} className={className} />;
}
