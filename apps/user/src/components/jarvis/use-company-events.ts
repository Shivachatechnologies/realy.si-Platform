"use client";

import { useEffect, useRef, useState } from "react";
import type { StreamItem } from "@/server/modules/voiceos/stream";
import type { Department } from "@/server/modules/voiceos/catalog";

export type { StreamItem };
export type StreamStatus = "idle" | "connecting" | "live" | "reconnecting" | "closed" | "unsupported";

const KINDS = ["domain", "task", "run", "approval", "call"] as const;
const KEEP = 80;
/** Close the stream after this long in a hidden tab (saves server polling); it resumes with the cursor when visible. */
const HIDDEN_CLOSE_MS = 60_000;

/**
 * Live company events over Server-Sent Events (`/events/stream`): domain events and AI task / command run /
 * approval / call state changes the viewer may see. Reconnects with the last cursor (EventSource sends
 * Last-Event-ID; after a hidden-tab pause the cursor is passed explicitly). `onItem` is called once per new item.
 */
export function useCompanyEvents(base: string | null, opts: { enabled?: boolean; onItem?: (item: StreamItem) => void } = {}) {
  const enabled = opts.enabled ?? true;
  const [items, setItems] = useState<StreamItem[]>([]);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [pulses, setPulses] = useState<Partial<Record<Department, number>>>({});
  const onItem = useRef(opts.onItem);
  useEffect(() => {
    onItem.current = opts.onItem;
  }, [opts.onItem]);

  useEffect(() => {
    if (!base || !enabled) return;
    if (typeof EventSource === "undefined") {
      queueMicrotask(() => setStatus("unsupported"));
      return;
    }
    const seen = new Set<string>();
    let cursor: string | null = null;
    let es: EventSource | null = null;
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const receive = (e: MessageEvent<string>) => {
      if (e.lastEventId) cursor = e.lastEventId;
      let item: StreamItem;
      try {
        item = JSON.parse(e.data) as StreamItem;
      } catch {
        return;
      }
      if (seen.has(item.key)) return;
      seen.add(item.key);
      if (seen.size > 600) seen.delete(seen.values().next().value as string);
      setItems((prev) => [item, ...prev].slice(0, KEEP));
      const dept = item.kind === "domain" || item.kind === "task" ? item.department : item.kind === "call" ? "comms" : item.kind === "approval" || item.kind === "run" ? "ai" : null;
      if (dept) setPulses((p) => ({ ...p, [dept]: Date.now() }));
      onItem.current?.(item);
    };
    const open = () => {
      if (stopped || es) return;
      setStatus((s) => (s === "live" || s === "reconnecting" ? "reconnecting" : "connecting"));
      es = new EventSource(`${base}/events/stream${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      es.addEventListener("hello", (e) => {
        if ((e as MessageEvent).lastEventId) cursor = (e as MessageEvent).lastEventId;
        setStatus("live");
      });
      es.addEventListener("cursor", (e) => {
        if ((e as MessageEvent).lastEventId) cursor = (e as MessageEvent).lastEventId;
      });
      for (const k of KINDS) es.addEventListener(k, receive as EventListener);
      es.onerror = () => {
        // CLOSED: the server refused (e.g. 403) — EventSource will not retry by itself.
        if (es?.readyState === EventSource.CLOSED) {
          es = null;
          setStatus("closed");
        } else setStatus("reconnecting");
      };
    };
    const close = () => {
      es?.close();
      es = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenTimer = setTimeout(() => {
          close();
          setStatus("idle");
        }, HIDDEN_CLOSE_MS);
      } else {
        if (hiddenTimer) clearTimeout(hiddenTimer);
        hiddenTimer = null;
        open();
      }
    };
    open();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (hiddenTimer) clearTimeout(hiddenTimer);
      close();
    };
  }, [base, enabled]);

  return { items, status, pulses };
}
