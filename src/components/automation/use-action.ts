"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Run an API mutation with busy/error state, then refresh the server components. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run<R>(fn: () => Promise<R>, after?: (r: R) => void) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      after?.(r);
      router.refresh();
      return r;
    } catch (err) {
      setError(err);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}
