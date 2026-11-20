"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { api } from "@/lib/api-client";

/** Run an API mutation, then refresh the server page; keeps busy/error state for the caller. */
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

/** A button that calls one endpoint (optionally after a confirm) and shows errors inline. */
export function ActionButton({
  path,
  method = "POST",
  body,
  label,
  confirm,
  variant = "secondary",
  size = "sm",
  icon,
  redirectTo,
  disabled,
}: {
  path: string;
  method?: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  label: ReactNode;
  confirm?: string;
  variant?: "default" | "secondary" | "ghost" | "danger";
  size?: "sm" | "default";
  icon?: ReactNode;
  redirectTo?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <span className="inline-grid gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={busy || disabled}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          void run(
            () => api(path, { method, body: body ?? (method === "DELETE" ? undefined : {}) }),
            () => {
              if (redirectTo) router.push(redirectTo);
            },
          );
        }}
      >
        {icon}
        {label}
      </Button>
      <FormError error={error} />
    </span>
  );
}
