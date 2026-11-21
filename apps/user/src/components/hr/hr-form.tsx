"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldSpec {
  /** Body key; dots build nested objects ("ratings.skills"). */
  name: string;
  label: string;
  type?: "text" | "email" | "url" | "tel" | "textarea" | "number" | "date" | "datetime" | "time" | "select" | "checkbox" | "multiselect" | "tags" | "file" | "money";
  options?: FieldOption[];
  required?: boolean;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: string;
  rows?: number;
  accept?: string;
  /** For file fields: maximum size in bytes (checked before upload). */
  maxBytes?: number;
  /** For file fields: put filename/contentBase64 at the top level instead of under `name`. */
  flatten?: boolean;
  /** Spans the full row in multi-column layouts. */
  full?: boolean;
}

/** Base64 of a file's bytes, in chunks (spreading a large array into String.fromCharCode overflows the stack). */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let node = obj;
  for (const p of parts.slice(0, -1)) node = (node[p] ??= {}) as Record<string, unknown>;
  node[parts[parts.length - 1]!] = value;
}

/**
 * Declarative form for HR records: renders fields, builds the JSON body (types converted, empty values omitted on create
 * and sent as "" on edit so they clear), calls the API, shows field and form errors, then refreshes or navigates.
 */
export function HrForm({
  endpoint,
  method = "POST",
  fields,
  submitLabel,
  initial = {},
  extra,
  redirectTo,
  columns = 2,
  resetOnSuccess = method === "POST",
  onDone,
  className,
  successMessage,
}: {
  endpoint: string;
  method?: "POST" | "PATCH" | "PUT";
  fields: FieldSpec[];
  submitLabel: string;
  initial?: Record<string, string | boolean | string[] | number | null | undefined>;
  extra?: Record<string, unknown>;
  /** Path after /{locale}; ":id" is replaced by the created record's id. */
  redirectTo?: string;
  columns?: 1 | 2 | 3;
  resetOnSuccess?: boolean;
  onDone?: () => void;
  className?: string;
  successMessage?: string;
}) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const isEdit = method !== "POST";

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setDone(false);
    const form = new FormData(e.currentTarget);
    const out: Record<string, unknown> = { ...(extra ?? {}) };
    for (const f of fields) {
      const type = f.type ?? "text";
      if (type === "checkbox") {
        setPath(out, f.name, form.get(f.name) === "on");
        continue;
      }
      if (type === "multiselect") {
        setPath(out, f.name, form.getAll(f.name).map(String));
        continue;
      }
      if (type === "file") {
        const file = form.get(f.name);
        if (file instanceof File && file.size > 0) {
          if (f.maxBytes && file.size > f.maxBytes) {
            setFieldErrors({ [f.name]: t("hr.form.fileTooLarge", { mb: Math.round(f.maxBytes / 1048576) }) });
            return;
          }
          const value = { filename: file.name, contentBase64: await fileToBase64(file) };
          if (f.flatten) Object.assign(out, value);
          else setPath(out, f.name, value);
        }
        continue;
      }
      const raw = String(form.get(f.name) ?? "").trim();
      if (!raw) {
        if (isEdit && type === "tags") setPath(out, f.name, []);
        else if (isEdit && type !== "number") setPath(out, f.name, "");
        continue;
      }
      if (type === "number") setPath(out, f.name, Number(raw));
      else if (type === "tags") setPath(out, f.name, raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean));
      else if (type === "datetime") setPath(out, f.name, new Date(raw).toISOString());
      else setPath(out, f.name, raw);
    }
    setBusy(true);
    try {
      const res = await api<{ id?: string } | null>(endpoint, { method, body: out });
      setDone(true);
      if (resetOnSuccess) formRef.current?.reset();
      onDone?.();
      if (redirectTo) router.push(`/${locale}${redirectTo.replace(":id", res?.id ?? "")}`);
      else router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors());
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const grid = columns === 1 ? "" : columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <form ref={formRef} onSubmit={submit} className={cn("grid gap-3", className)} noValidate={false}>
      <div className={cn("grid gap-3", grid)}>
        {fields.map((f) => {
          const id = `${uid}-${f.name}`;
          const type = f.type ?? "text";
          const init = initial[f.name];
          const common = { id, name: f.name, required: f.required, "aria-invalid": fieldErrors[f.name] ? true : undefined } as const;
          let control;
          if (type === "textarea") control = <Textarea {...common} rows={f.rows ?? 4} maxLength={f.maxLength} placeholder={f.placeholder} defaultValue={(init as string) ?? ""} />;
          else if (type === "select")
            control = (
              <Select {...common} defaultValue={(init as string) ?? ""}>
                {f.required ? null : <option value="">{t("common.none")}</option>}
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            );
          else if (type === "multiselect")
            control = (
              <Select {...common} multiple size={Math.min(6, Math.max(3, f.options?.length ?? 3))} defaultValue={(init as string[]) ?? []} className="h-auto">
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            );
          else if (type === "checkbox")
            control = (
              <label className="flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" id={id} name={f.name} defaultChecked={!!init} className="size-4" />
                <span className="text-muted-foreground">{f.hint ?? f.label}</span>
              </label>
            );
          else
            control = (
              <Input
                {...common}
                type={type === "datetime" ? "datetime-local" : type === "money" ? "text" : type === "tags" ? "text" : type}
                inputMode={type === "money" ? "decimal" : undefined}
                maxLength={f.maxLength}
                min={f.min}
                max={f.max}
                step={f.step}
                accept={f.accept}
                placeholder={f.placeholder ?? (type === "money" ? "0.00" : undefined)}
                defaultValue={type === "file" ? undefined : Array.isArray(init) ? init.join(", ") : init == null ? "" : String(init)}
              />
            );
          return (
            <Field key={f.name} label={f.label} htmlFor={id} hint={type === "checkbox" ? undefined : f.hint} error={fieldErrors[f.name]} className={f.full || type === "textarea" ? "sm:col-span-full" : undefined}>
              {control}
            </Field>
          );
        })}
      </div>
      <FormError error={error} />
      {done && successMessage ? <p className="text-xs text-success">{successMessage}</p> : null}
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? t("common.saving") : submitLabel}
        </Button>
      </div>
    </form>
  );
}
