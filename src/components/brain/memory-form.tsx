"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Pin, PinOff, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

export interface MemoryView {
  id: string;
  title: string;
  fact: string;
  source: string | null;
  departmentId: string | null;
  pinned: boolean;
}

const base = (o: string, c: string) => `/api/v1/organizations/${o}/companies/${c}/brain/memory`;

/** Create (no `memory`) or edit a company memory fact. */
export function MemoryForm({
  organizationId,
  companyId,
  departments,
  memory,
  onDone,
}: {
  organizationId: string;
  companyId: string;
  departments: { id: string; name: string }[];
  memory?: MemoryView;
  onDone?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [title, setTitle] = useState(memory?.title ?? "");
  const [fact, setFact] = useState(memory?.fact ?? "");
  const [source, setSource] = useState(memory?.source ?? "");
  const [departmentId, setDepartmentId] = useState(memory?.departmentId ?? "");
  const [pinned, setPinned] = useState(memory?.pinned ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const idp = memory ? `mem-${memory.id}` : "mem-new";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = { title, fact, source: source.trim() || null, departmentId: departmentId || null, pinned };
      if (memory) await api(`${base(organizationId, companyId)}/${memory.id}`, { method: "PATCH", body: payload });
      else await api(base(organizationId, companyId), { body: payload });
      if (!memory) {
        setTitle("");
        setFact("");
        setSource("");
        setPinned(false);
      }
      router.refresh();
      onDone?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("brain.memory.titleLabel")} htmlFor={`${idp}-title`}>
          <Input id={`${idp}-title`} value={title} required maxLength={160} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t("brain.memory.source")} htmlFor={`${idp}-source`} hint={t("brain.memory.sourceHint")}>
          <Input id={`${idp}-source`} value={source} maxLength={300} onChange={(e) => setSource(e.target.value)} />
        </Field>
      </div>
      <Field label={t("brain.memory.fact")} htmlFor={`${idp}-fact`}>
        <Textarea id={`${idp}-fact`} rows={3} value={fact} required maxLength={2000} onChange={(e) => setFact(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
        <Field label={t("brain.department")} htmlFor={`${idp}-department`}>
          <Select id={`${idp}-department`} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">{t("brain.noDepartment")}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="size-4" />
          {t("brain.memory.pinLabel")}
        </label>
      </div>
      <FormError error={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !title.trim() || !fact.trim()}>
          {memory ? <Save aria-hidden /> : <Plus aria-hidden />}
          {memory ? t("brain.save") : t("brain.memory.add")}
        </Button>
        {onDone ? (
          <Button type="button" variant="ghost" onClick={onDone}>
            <X aria-hidden />
            {t("brain.cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** One memory fact: display, and for managers pin/unpin, inline edit and delete. */
export function MemoryItem({
  organizationId,
  companyId,
  departments,
  memory,
  meta,
  canManage,
}: {
  organizationId: string;
  companyId: string;
  departments: { id: string; name: string }[];
  memory: MemoryView;
  /** Pre-formatted line: department, author, date. */
  meta: string;
  canManage: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const url = `${base(organizationId, companyId)}/${memory.id}`;

  async function run(call: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await call();
      router.refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <li className="px-4 py-3">
        <MemoryForm organizationId={organizationId} companyId={companyId} departments={departments} memory={memory} onDone={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {memory.pinned ? <Pin aria-label={t("brain.memory.pinned")} className="size-3.5 text-primary" /> : null}
          {memory.title}
        </p>
        <p className="whitespace-pre-wrap break-words text-sm">{memory.fact}</p>
        <p className="text-xs text-muted-foreground">
          {meta}
          {memory.source ? ` · ${t("brain.memory.sourceIs", { source: memory.source })}` : ""}
        </p>
        <FormError error={error} />
      </div>
      {canManage ? (
        <div className="flex shrink-0 gap-1">
          <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={memory.pinned ? t("brain.memory.unpin") : t("brain.memory.pin")} disabled={busy} onClick={() => run(() => api(url, { method: "PATCH", body: { pinned: !memory.pinned } }))}>
            {memory.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
          </Button>
          <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={t("brain.memory.edit")} disabled={busy} onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={t("brain.memory.delete")}
            disabled={busy}
            onClick={() => {
              if (window.confirm(t("brain.memory.confirmDelete"))) void run(() => api(url, { method: "DELETE" }));
            }}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ) : null}
    </li>
  );
}
