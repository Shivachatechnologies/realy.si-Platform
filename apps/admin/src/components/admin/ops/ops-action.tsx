"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useRouter } from "next/navigation";
import { ActionDialog, useAdminAction } from "../action-dialog";

/** One extra input of an ops action dialog (labels arrive translated from the server page). */
export interface OpsField {
  name: string;
  label: string;
  type: "text" | "textarea" | "select" | "number" | "checkboxes";
  options?: { value: string; label: string }[];
  required?: boolean;
  defaultValue?: string | string[];
  placeholder?: string;
  maxLength?: number;
  hint?: string;
  /** Send the text as a list (split on commas, spaces and new lines). */
  split?: boolean;
}

type Values = Record<string, string | string[]>;

function initial(fields: OpsField[]): Values {
  return Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? (f.type === "checkboxes" ? [] : "")]));
}

function FieldInput({ f, value, onChange, id }: { f: OpsField; value: string | string[]; onChange: (v: string | string[]) => void; id: string }) {
  if (f.type === "textarea") return <Textarea id={id} required={f.required} maxLength={f.maxLength} placeholder={f.placeholder} value={value as string} onChange={(e) => onChange(e.target.value)} />;
  if (f.type === "select")
    return (
      <Select id={id} required={f.required} value={value as string} onChange={(e) => onChange(e.target.value)}>
        {f.required ? null : <option value="">—</option>}
        {(f.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  if (f.type === "checkboxes")
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-1.5" role="group" aria-labelledby={`${id}-label`}>
        {(f.options ?? []).map((o) => {
          const list = value as string[];
          return (
            <label key={o.value} className="inline-flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={list.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...list, o.value] : list.filter((v) => v !== o.value))} />
              <span className="font-mono">{o.label}</span>
            </label>
          );
        })}
      </div>
    );
  return <Input id={id} type={f.type === "number" ? "number" : "text"} required={f.required} maxLength={f.maxLength} placeholder={f.placeholder} value={value as string} onChange={(e) => onChange(e.target.value)} />;
}

/**
 * An audited operations action: confirmation dialog with optional extra fields, a required reason, and a typed
 * confirmation phrase for destructive operations (`phrase`, computed on the server: in production it starts with
 * "PRODUCTION "). `download` saves the response body as a file instead of refreshing the page.
 */
export function OpsAction({
  label,
  title,
  description,
  path,
  method = "POST",
  body = {},
  fields = [],
  phrase,
  danger,
  production,
  variant = "secondary",
  icon,
  success,
  download,
  className,
}: {
  label: string;
  title: string;
  description?: ReactNode;
  path: string;
  method?: string;
  body?: Record<string, unknown>;
  fields?: OpsField[];
  phrase?: string;
  danger?: boolean;
  /** Show the production warning in the dialog. */
  production?: boolean;
  variant?: "default" | "secondary" | "ghost" | "danger";
  icon?: ReactNode;
  success?: string;
  download?: boolean;
  className?: string;
}) {
  const t = useT();
  const run = useAdminAction();
  const toast = useToast();
  const [values, setValues] = useState<Values>(() => initial(fields));
  const missing = fields.some((f) => f.required && (Array.isArray(values[f.name]) ? (values[f.name] as string[]).length === 0 : !String(values[f.name] ?? "").trim()));
  const payload = () => {
    const out: Record<string, unknown> = { ...body };
    for (const f of fields) {
      const v = values[f.name];
      if (f.type === "number") {
        if (v !== "") out[f.name] = Number(v);
      } else if (f.split && typeof v === "string") {
        out[f.name] = v.split(/[\s,]+/).filter(Boolean);
      } else if (Array.isArray(v) || (v ?? "") !== "") out[f.name] = v;
    }
    return out;
  };
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant={variant} className={className}>
          {icon}
          {label}
        </Button>
      }
      title={title}
      description={description}
      confirmLabel={label}
      phrase={phrase}
      danger={danger}
      canSubmit={!missing}
      onConfirm={async (reason, confirm) => {
        const data = { ...payload(), reason, ...(confirm !== undefined ? { confirm } : {}) };
        if (download) {
          const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(data), credentials: "same-origin" });
          if (!res.ok) {
            const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
            throw new Error(e?.error?.message ?? res.statusText);
          }
          const blob = await res.blob();
          const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "export.csv";
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = name;
          a.click();
          URL.revokeObjectURL(url);
          if (success) toast.success(success);
          setValues(initial(fields));
          return;
        }
        await run(path, method, data, { success });
        setValues(initial(fields));
      }}
    >
      {production ? <Notice tone="danger">{t("admin.system.env.productionWarning")}</Notice> : null}
      {fields.map((f) => (
        <Field key={f.name} label={f.label} htmlFor={`ops-${f.name}`} hint={f.hint}>
          <FieldInput f={f} id={`ops-${f.name}`} value={values[f.name] ?? ""} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
        </Field>
      ))}
    </ActionDialog>
  );
}

/** Timeline note box (no reason: a note is not a sensitive change; it is audited as an append). */
export function NoteForm({ path, label, placeholder }: { path: string; label: string; placeholder?: string }) {
  const t = useT();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <form
      className="grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim() || busy) return;
        setBusy(true);
        setError(null);
        try {
          await api(path, { method: "POST", body: { message: text.trim() } });
          setText("");
          router.refresh();
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Textarea aria-label={label} placeholder={placeholder} maxLength={5_000} value={text} onChange={(e) => setText(e.target.value)} />
      <FormError error={error} />
      <div className="flex justify-end">
        <Button size="sm" type="submit" disabled={busy || !text.trim()}>
          {busy ? t("common.loading") : label}
        </Button>
      </div>
    </form>
  );
}

/** One-click action without a reason (e.g. re-run read-only checks); disabled while running. */
export function OpsButton({ label, path, method = "POST", success, variant = "secondary", icon }: { label: string; path: string; method?: string; success?: string; variant?: "default" | "secondary" | "ghost"; icon?: ReactNode }) {
  const run = useAdminAction({ toastError: true });
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={busy}
      aria-busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await run(path, method, {}, { success });
        } catch {
          // toasted
        } finally {
          setBusy(false);
        }
      }}
    >
      {icon}
      {label}
    </Button>
  );
}
