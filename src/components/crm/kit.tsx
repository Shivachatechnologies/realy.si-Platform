"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction, type Owner } from "./lead-forms";

/** Shared client building blocks of the CRM & Sales UI. */

export { useAction, type Owner };

export interface CustomFieldDef {
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "DATE" | "SELECT";
  options: string[];
  required: boolean;
}
export type CustomValues = Record<string, string>;

/** Inputs for the custom fields of an entity (values as strings; the server validates and converts). */
export function CustomFieldInputs({ defs, values, onChange, idPrefix }: { defs: CustomFieldDef[]; values: CustomValues; onChange: (v: CustomValues) => void; idPrefix: string }) {
  const t = useT();
  if (!defs.length) return null;
  return (
    <>
      {defs.map((d) => {
        const id = `${idPrefix}-cf-${d.key}`;
        const v = values[d.key] ?? "";
        const set = (value: string) => onChange({ ...values, [d.key]: value });
        return (
          <Field key={d.key} label={d.required ? `${d.label} *` : d.label} htmlFor={id}>
            {d.type === "SELECT" ? (
              <Select id={id} value={v} required={d.required} onChange={(e) => set(e.target.value)}>
                <option value="">{t("common.none")}</option>
                {d.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id={id} type={d.type === "NUMBER" ? "number" : d.type === "DATE" ? "date" : "text"} step="any" value={v} required={d.required} maxLength={1000} onChange={(e) => set(e.target.value)} />
            )}
          </Field>
        );
      })}
    </>
  );
}

/** Comma-separated tag editor. */
export function TagInput({ id, value, onChange }: { id: string; value: string[]; onChange: (tags: string[]) => void }) {
  const t = useT();
  const [text, setText] = useState(value.join(", "));
  return (
    <Input
      id={id}
      value={text}
      maxLength={600}
      placeholder={t("crm.tagsPlaceholder")}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 30),
        );
      }}
    />
  );
}

export function OwnerPicker({ id, owners, value, onChange, emptyLabel }: { id?: string; owners: Owner[]; value: string; onChange: (v: string) => void; emptyLabel?: string }) {
  const t = useT();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel ?? t("crm.unassigned")}</option>
      {owners.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </Select>
  );
}

/** A button that confirms, calls the API and then refreshes (or navigates). */
export function ActionButton({
  url,
  method = "POST",
  body,
  confirm,
  label,
  icon,
  variant = "ghost",
  size = "sm",
  redirectTo,
}: {
  url: string;
  method?: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  confirm?: string;
  label: string;
  icon?: "archive" | "trash" | "check" | "x";
  variant?: "default" | "secondary" | "ghost" | "danger";
  size?: "sm" | "default" | "icon";
  redirectTo?: string;
}) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  const Icon = icon === "archive" ? Archive : icon === "trash" ? Trash2 : icon === "check" ? Check : icon === "x" ? X : null;
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        size={size}
        variant={variant}
        disabled={busy}
        title={label}
        aria-label={label}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          void run(
            () => api(url, { method, body: body ?? (method === "DELETE" ? undefined : {}) }),
            () => (redirectTo ? router.replace(redirectTo) : undefined),
          );
        }}
      >
        {Icon ? <Icon aria-hidden /> : null}
        {size === "icon" ? null : label}
      </Button>
      <FormError error={error} />
    </span>
  );
}

/** AI actions on a record: each button creates an agent task (subject linked) and opens it. */
export function AiActions({ url, locale, actions, extra }: { url: string; locale: string; actions: { mode: string; label: string }[]; extra?: Record<string, unknown> }) {
  const t = useT();
  const router = useRouter();
  const [guidance, setGuidance] = useState("");
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      <Field label={t("crm.assistGuidance")} htmlFor="ai-guidance" hint={t("crm.ai.hint")}>
        <Input id="ai-guidance" value={guidance} maxLength={1000} placeholder={t("crm.assistPlaceholder")} onChange={(e) => setGuidance(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        {actions.map((a, i) => (
          <Button
            key={a.mode}
            type="button"
            variant={i === 0 ? "default" : "secondary"}
            disabled={busy}
            onClick={() =>
              void run(
                () => api<{ id: string }>(url, { body: { ...(a.mode ? { mode: a.mode } : {}), ...extra, guidance: guidance.trim() || undefined } }),
                (task) => router.push(`/${locale}/tasks/${task.id}`),
              )
            }
          >
            {i === 0 ? <Sparkles aria-hidden /> : null}
            {a.label}
          </Button>
        ))}
      </div>
      <FormError error={error} />
    </div>
  );
}

export type BulkAction =
  | { kind: "assign"; owners: Owner[] }
  | { kind: "tag" }
  | { kind: "archive" }
  | { kind: "select"; action: string; field: string; label: string; options: { value: string; label: string }[] };

/** A table with row selection and a bulk-action bar. Cells are rendered on the server. */
export function BulkTable({
  url,
  columns,
  rows,
  actions,
  canManage,
}: {
  url: string;
  columns: { label: string; align?: "end" }[];
  rows: { id: string; label: string; cells: ReactNode[] }[];
  actions: BulkAction[];
  canManage: boolean;
}) {
  const t = useT();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<string, string>>({});
  const [tag, setTag] = useState("");
  const { busy, error, run } = useAction();
  const ids = [...selected].filter((id) => rows.some((r) => r.id === id));
  const all = rows.length > 0 && ids.length === rows.length;
  const bulk = (body: Record<string, unknown>) => run(() => api(url, { body: { ...body, ids } }), () => setSelected(new Set()));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div className="grid">
      {canManage && ids.length ? (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 p-3 text-sm" role="region" aria-label={t("crm.bulkActions")}>
          <span className="font-medium">{t("crm.selected", { count: ids.length })}</span>
          {actions.map((a) => {
            if (a.kind === "assign") {
              return (
                <span key="assign" className="flex items-center gap-1">
                  <Select aria-label={t("crm.owner")} className="h-8 w-auto text-xs" value={values.owner ?? ""} onChange={(e) => setValues((v) => ({ ...v, owner: e.target.value }))}>
                    <option value="">{t("crm.unassigned")}</option>
                    {a.owners.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void bulk({ action: "assign", ownerId: values.owner || null })}>
                    {t("crm.assign")}
                  </Button>
                </span>
              );
            }
            if (a.kind === "select") {
              return (
                <span key={a.action} className="flex items-center gap-1">
                  <Select aria-label={a.label} className="h-8 w-auto text-xs" value={values[a.action] ?? a.options[0]?.value ?? ""} onChange={(e) => setValues((v) => ({ ...v, [a.action]: e.target.value }))}>
                    {a.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void bulk({ action: a.action, [a.field]: (values[a.action] ?? a.options[0]?.value) || null })}>
                    {a.label}
                  </Button>
                </span>
              );
            }
            if (a.kind === "tag") {
              return (
                <span key="tag" className="flex items-center gap-1">
                  <Input aria-label={t("crm.tag")} className="h-8 w-28 text-xs" value={tag} maxLength={40} placeholder={t("crm.tag")} onChange={(e) => setTag(e.target.value)} />
                  <Button size="sm" variant="secondary" disabled={busy || !tag.trim()} onClick={() => void bulk({ action: "tag", tag: tag.trim() })}>
                    {t("crm.addTag")}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy || !tag.trim()} onClick={() => void bulk({ action: "tag", tag: tag.trim(), remove: true })}>
                    {t("crm.removeTag")}
                  </Button>
                </span>
              );
            }
            return (
              <Button
                key="archive"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t("crm.archiveManyConfirm", { count: ids.length }))) void bulk({ action: "archive" });
                }}
              >
                <Archive aria-hidden />
                {t("crm.archive")}
              </Button>
            );
          })}
          <div className="basis-full">
            <FormError error={error} />
          </div>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              {canManage ? (
                <th className="w-8 p-2">
                  <input type="checkbox" className="size-4 accent-primary" aria-label={t("crm.selectAll")} checked={all} onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))} />
                </th>
              ) : null}
              {columns.map((c) => (
                <th key={c.label} className={c.align === "end" ? "p-2 text-end font-medium" : "p-2 text-start font-medium"}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} className={selected.has(r.id) ? "bg-muted/40" : undefined}>
                {canManage ? (
                  <td className="p-2">
                    <input type="checkbox" className="size-4 accent-primary" aria-label={r.label} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                ) : null}
                {r.cells.map((c, i) => (
                  <td key={i} className={columns[i]?.align === "end" ? "p-2 text-end tabular-nums" : "p-2"}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Save the current list filters as a named segment. */
export function SaveSegment({ base, entity, filters }: { base: string; entity: "LEAD" | "CONTACT" | "ACCOUNT" | "DEAL"; filters: Record<string, string> }) {
  const t = useT();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();
  if (!Object.keys(filters).length) return null;
  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {t("crm.segments.save")}
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-1"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/crm/settings/segments`, { body: { entity, name, filters } }), () => (setName(""), setOpen(false)));
      }}
    >
      <Input aria-label={t("crm.segments.name")} className="h-8 w-40 text-xs" value={name} maxLength={100} required placeholder={t("crm.segments.name")} onChange={(e) => setName(e.target.value)} />
      <Button type="submit" size="sm" variant="secondary" disabled={busy || !name.trim()}>
        {t("common.save")}
      </Button>
      <FormError error={error} />
    </form>
  );
}
