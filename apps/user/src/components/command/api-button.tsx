"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** Calls the API once (POST/PATCH/PUT with an optional body), then refreshes the page or opens `redirectTo`. */
export function ApiButton({
  path,
  method = "POST",
  body,
  confirm,
  redirectTo,
  children,
  variant = "secondary",
  size = "sm",
}: {
  path: string;
  method?: "POST" | "PATCH" | "PUT";
  body?: unknown;
  confirm?: string;
  /** Path after /{locale}; `{sessionId}` is replaced from the response. */
  redirectTo?: string;
  children: ReactNode;
  variant?: "default" | "secondary" | "ghost" | "danger" | "link";
  size?: "default" | "sm" | "icon";
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
      const res = await api<{ sessionId?: string } | null>(path, { method, body: body ?? {} });
      if (redirectTo) router.push(`/${locale}${redirectTo.replace("{sessionId}", res?.sessionId ?? "")}`);
      else router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-grid gap-1">
      <Button type="button" variant={variant} size={size} loading={busy} onClick={run}>
        {children}
      </Button>
      {error ? <FormError error={error} /> : null}
    </span>
  );
}
