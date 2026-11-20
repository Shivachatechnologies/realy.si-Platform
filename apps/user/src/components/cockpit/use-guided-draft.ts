"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";

export type DraftValue = string | number | boolean | null | string[];
export type DraftData = Record<string, DraftValue>;

/**
 * Save & resume for a guided journey: keeps the answers and the current step, and saves them on the server (debounced)
 * so the person can leave and continue later on any device. `clear()` forgets them once the record is created.
 */
export function useGuidedDraft<T extends DraftData>(base: string, flowKey: string, defaults: T, initial?: { step: number; data: Record<string, unknown> } | null) {
  const [data, setData] = useState<T>(() => ({ ...defaults, ...((initial?.data ?? {}) as Partial<T>) }));
  const [step, setStepState] = useState(initial?.step ?? 0);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">(initial ? "saved" : "idle");
  const dirty = useRef(false);
  const url = `${base}/guided-drafts/${flowKey}`;

  useEffect(() => {
    if (!dirty.current) return;
    setSaved("saving");
    const h = setTimeout(() => {
      api(url, { method: "PUT", body: { step, data } })
        .then(() => setSaved("saved"))
        .catch(() => setSaved("error"));
    }, 700);
    return () => clearTimeout(h);
  }, [url, step, data]);

  const set = useCallback(<K extends keyof T>(k: K, v: T[K]) => {
    dirty.current = true;
    setData((d) => ({ ...d, [k]: v }));
  }, []);
  const patch = useCallback((p: Partial<T>) => {
    dirty.current = true;
    setData((d) => ({ ...d, ...p }));
  }, []);
  const setStep = useCallback((s: number) => {
    dirty.current = true;
    setStepState(s);
  }, []);
  const clear = useCallback(async () => {
    dirty.current = false;
    setData({ ...defaults });
    setStepState(0);
    setSaved("idle");
    await api(url, { method: "DELETE" }).catch(() => undefined);
  }, [url, defaults]);

  return { data, set, patch, step, setStep, saved, clear, resumed: !!initial };
}
