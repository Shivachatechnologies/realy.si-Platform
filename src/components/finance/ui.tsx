"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

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

export interface Option {
  value: string;
  label: string;
}

export interface FieldSpec {
  name: string;
  label: string;
  type?: "text" | "email" | "number" | "date" | "amount" | "select" | "textarea" | "checkbox" | "month";
  options?: Option[];
  /** Label of the empty option of a select (omit for no empty option). */
  emptyLabel?: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  /** Grid columns the field spans (of 3 on wide screens). */
  span?: 1 | 2 | 3;
  min?: number;
  max?: number;
  step?: number | "any";
  maxLength?: number;
}

type Values = Record<string, string | boolean>;

/**
 * Generic create/edit form for finance records. Values are posted as JSON: numbers for number fields, booleans for
 * checkboxes; empty optional fields are omitted on create and sent as null on update (to clear them).
 */
export function ResourceForm({
  endpoint,
  method = "POST",
  fields,
  initial = {},
  submitLabel,
  extra,
  redirectTo,
  reset = method === "POST",
  onDone,
  className,
}: {
  endpoint: string;
  method?: "POST" | "PATCH" | "PUT";
  fields: FieldSpec[];
  initial?: Values;
  submitLabel: string;
  /** Fixed values merged into the body. */
  extra?: Record<string, unknown>;
  /** Navigate after success; ":id" is replaced by the created record's id. */
  redirectTo?: string;
  reset?: boolean;
  onDone?: () => void;
  className?: string;
}) {
  const t = useT();
  const router = useRouter();
  const defaults = Object.fromEntries(fields.map((f) => [f.name, initial[f.name] ?? (f.type === "checkbox" ? false : "")])) as Values;
  const [values, setValues] = useState<Values>(defaults);
  const { busy, error, run } = useAction();
  const set = (name: string, v: string | boolean) => setValues((p) => ({ ...p, [name]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { ...extra };
    for (const f of fields) {
      const v = values[f.name];
      if (f.type === "checkbox") body[f.name] = !!v;
      else if (v === "" || v === undefined) {
        if (method !== "POST") body[f.name] = null;
      } else body[f.name] = f.type === "number" ? Number(v) : v;
    }
    void run(
      () => api<{ id?: string }>(endpoint, { method, body }),
      (r) => {
        if (reset) setValues(defaults);
        onDone?.();
        if (redirectTo) router.push(redirectTo.replace(":id", r?.id ?? ""));
      },
    );
  };
  return (
    <form onSubmit={submit} className={cn("grid gap-3 sm:grid-cols-3", className)}>
      {fields.map((f) => {
        const id = `rf-${f.name}`;
        const v = values[f.name];
        const span = f.span === 3 ? "sm:col-span-3" : f.span === 2 ? "sm:col-span-2" : "";
        if (f.type === "checkbox") {
          return (
            <label key={f.name} className={cn("flex items-center gap-2 self-end pb-2 text-sm", span)}>
              <input type="checkbox" checked={!!v} onChange={(e) => set(f.name, e.target.checked)} className="size-4" />
              {f.label}
            </label>
          );
        }
        return (
          <Field key={f.name} label={f.label} htmlFor={id} hint={f.hint} className={span}>
            {f.type === "select" ? (
              <Select id={id} value={String(v)} required={f.required} onChange={(e) => set(f.name, e.target.value)}>
                {f.emptyLabel !== undefined ? <option value="">{f.emptyLabel}</option> : null}
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : f.type === "textarea" ? (
              <Textarea id={id} rows={3} value={String(v)} required={f.required} maxLength={f.maxLength ?? 5000} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />
            ) : (
              <Input
                id={id}
                type={f.type === "amount" ? "text" : (f.type ?? "text")}
                inputMode={f.type === "amount" ? "decimal" : undefined}
                pattern={f.type === "amount" ? "-?\\d{1,13}([.]\\d{1,3})?" : undefined}
                value={String(v)}
                required={f.required}
                min={f.min}
                max={f.max}
                step={f.step}
                maxLength={f.maxLength ?? (f.type === "amount" ? 18 : 300)}
                placeholder={f.placeholder}
                onChange={(e) => set(f.name, e.target.value)}
              />
            )}
          </Field>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
        <Button type="submit" disabled={busy}>
          {busy ? t("common.saving") : submitLabel}
        </Button>
      </div>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

/** Button that calls an endpoint (optionally after a confirmation) and refreshes the page. */
export function ActionButton({
  endpoint,
  method = "POST",
  body,
  label,
  confirm,
  variant = "secondary",
  size = "sm",
  redirectTo,
  icon,
}: {
  endpoint: string;
  method?: "POST" | "DELETE" | "PATCH" | "PUT";
  body?: unknown;
  label: string;
  confirm?: string;
  variant?: "default" | "secondary" | "ghost" | "danger";
  size?: "sm" | "default";
  redirectTo?: string;
  icon?: ReactNode;
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
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          void run(
            () => api<{ id?: string }>(endpoint, { method, body: body ?? (method === "DELETE" ? undefined : {}) }),
            (r) => redirectTo && router.push(redirectTo.replace(":id", r?.id ?? "")),
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

/** A trigger button that opens a dialog with arbitrary (usually form) content. */
export function FormDialog({ trigger, title, description, children, variant = "secondary", size = "sm" }: { trigger: ReactNode; title: string; description?: string; children: ReactNode; variant?: "default" | "secondary" | "ghost"; size?: "sm" | "default" }) {
  const t = useT();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant={variant} size={size}>
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent title={title} description={description} closeLabel={t("common.close")} className="max-w-2xl">
        {children}
      </DialogContent>
    </Dialog>
  );
}
