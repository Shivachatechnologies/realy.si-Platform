"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";

/**
 * A button that calls the API once (POST/PATCH/DELETE with an optional body), then refreshes the page or navigates.
 * Shows a localized error below itself.
 */
export function ActionButton({
  path,
  method = "POST",
  body,
  confirm,
  redirectTo,
  children,
  variant = "secondary",
  size = "sm",
  className,
}: {
  path: string;
  method?: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  confirm?: string;
  /** Path after /{locale}; `{id}` is replaced with the response's id. */
  redirectTo?: string;
  children: ReactNode;
  variant?: "default" | "secondary" | "ghost" | "danger" | "link";
  size?: "default" | "sm" | "icon";
  className?: string;
}) {
  const router = useRouter();
  const { locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ id?: string } | null>(path, { method, body: body ?? (method === "DELETE" ? undefined : {}) });
      if (redirectTo) router.push(`/${locale}${redirectTo.replace("{id}", res?.id ?? "")}`);
      else router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-grid gap-1">
      <Button type="button" variant={variant} size={size} disabled={busy} onClick={run} className={className}>
        {children}
      </Button>
      {error ? <FormError error={error} /> : null}
    </span>
  );
}
