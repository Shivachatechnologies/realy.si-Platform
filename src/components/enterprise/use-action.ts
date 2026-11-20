"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api-client";

/** Run a mutation, collect field errors, refresh server data on success. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  async function run<R>(fn: () => Promise<R>, after?: (r: R) => void) {
    setBusy(true);
    setError(null);
    setFields({});
    setDone(false);
    try {
      const r = await fn();
      setDone(true);
      after?.(r);
      router.refresh();
    } catch (e) {
      setError(e);
      if (e instanceof ApiError) setFields(e.fieldErrors());
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, fields, done, run, setError };
}
