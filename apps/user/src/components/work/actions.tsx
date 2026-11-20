"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

export interface Person {
  id: string;
  name: string;
}

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

/** A button that calls the API (optionally after a confirm prompt), then refreshes or navigates. */
export function ActionButton({
  url,
  method = "POST",
  body,
  confirm,
  redirectTo,
  children,
  variant = "secondary",
  size = "sm",
  title,
  className,
}: {
  url: string;
  method?: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  confirm?: string;
  redirectTo?: string;
  children: ReactNode;
  variant?: "default" | "secondary" | "ghost" | "danger";
  size?: "sm" | "default" | "icon";
  title?: string;
  className?: string;
}) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <span className="inline-grid gap-1">
      <Button
        type="button"
        size={size}
        variant={variant}
        disabled={busy}
        title={title}
        aria-label={title}
        className={className}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          void run(() => api(url, { method, body: body ?? (method === "DELETE" ? undefined : {}) }), () => (redirectTo ? router.push(redirectTo) : undefined));
        }}
      >
        {children}
      </Button>
      <FormError error={error} />
    </span>
  );
}

/** Starts an AI task attached to a record; the task list on the page shows its progress. */
export function AiButton({ url, body, label }: { url: string; body?: unknown; label: string }) {
  const { busy, error, run } = useAction();
  return (
    <span className="inline-grid gap-1">
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => api(url, { body: body ?? {} }))}>
        <Sparkles aria-hidden />
        {label}
      </Button>
      <FormError error={error} />
    </span>
  );
}

export function PersonSelect({ id, people, value, onChange, emptyLabel, className, name }: { id?: string; people: Person[]; value: string; onChange: (v: string) => void; emptyLabel?: string; className?: string; name?: string }) {
  const t = useT();
  return (
    <Select id={id} name={name} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel ?? t("work.unassigned")}</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}

/** Select that PATCHes one field immediately. */
export function InlineSelect({ url, field, value, options, label, method = "PATCH", className }: { url: string; field: string; value: string; options: { value: string; label: string }[]; label: string; method?: "PATCH" | "POST"; className?: string }) {
  const { busy, error, run } = useAction();
  return (
    <span className="inline-grid gap-1">
      <Select
        aria-label={label}
        className={className ?? "h-8 w-auto text-xs"}
        value={value}
        disabled={busy}
        onChange={(e) => void run(() => api(url, { method, body: { [field]: e.target.value === "" ? null : e.target.value } }))}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <FormError error={error} />
    </span>
  );
}
