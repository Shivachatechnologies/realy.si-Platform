"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useErrorMessage } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** One-click mutation (status change, approve, archive...) with optional confirmation; refreshes or navigates after. */
export function ActionButton({
  endpoint,
  method = "POST",
  body,
  label,
  busyLabel,
  confirm,
  variant = "secondary",
  size = "sm",
  redirectTo,
  icon,
  disabled,
}: {
  endpoint: string;
  method?: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  label: string;
  busyLabel?: string;
  confirm?: string;
  variant?: "default" | "secondary" | "ghost" | "danger" | "link";
  size?: "default" | "sm" | "lg";
  redirectTo?: string;
  icon?: ReactNode;
  disabled?: boolean;
}) {
  const router = useRouter();
  const { locale } = useI18n();
  const message = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ id?: string; employeeId?: string } | null>(endpoint, { method, body: body ?? (method === "DELETE" ? undefined : {}) });
      if (redirectTo) router.push(`/${locale}${redirectTo.replace(":id", res?.id ?? res?.employeeId ?? "")}`);
      else router.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button type="button" variant={variant} size={size} onClick={run} disabled={busy || disabled}>
        {icon}
        {busy && busyLabel ? busyLabel : label}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** A select that PATCHes/POSTs one field on change (e.g. candidate stage, request status). */
export function InlineSelect({ endpoint, method = "PATCH", field, value, options, label, extra }: { endpoint: string; method?: "PATCH" | "POST"; field: string; value: string; options: { value: string; label: string }[]; label: string; extra?: Record<string, unknown> }) {
  const router = useRouter();
  const message = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <select
        aria-label={label}
        className="h-8 rounded-md border bg-surface px-2 pe-7 text-xs"
        value={value}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          setError(null);
          try {
            await api(endpoint, { method, body: { ...(extra ?? {}), [field]: e.target.value } });
            router.refresh();
          } catch (err) {
            setError(message(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => window.print()} className="print:hidden">
      {label}
    </Button>
  );
}
