"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Lock, Pencil, Pin, PinOff, Plus, Save, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export interface MemoryView {
  id: string;
  title: string;
  fact: string;
  source: string | null;
  departmentId: string | null;
  pinned: boolean;
  layer?: string;
  scope?: string;
  sensitivity?: string;
  readPermission?: string | null;
  /** ISO date (yyyy-mm-dd) or null. */
  expiresOn?: string | null;
}

/** Layers a person can pick for a hand-written fact (mirrors HUMAN_LAYERS on the server). */
export const HUMAN_LAYER_OPTIONS = ["COMPANY", "KNOWLEDGE", "PRODUCT", "BRAND", "CUSTOMER", "DEPARTMENT"] as const;
export const SENSITIVITY_OPTIONS = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;

const base = (o: string, c: string) => `/api/v1/organizations/${o}/companies/${c}/brain/memory`;

/** Create (no `memory`) or edit a company memory fact. */
export function MemoryForm({
  organizationId,
  companyId,
  departments,
  readPermissions = [],
  memory,
  onDone,
}: {
  organizationId: string;
  companyId: string;
  departments: { id: string; name: string }[];
  /** Permissions that can gate a fact (e.g. finance.read); empty hides the control. */
  readPermissions?: string[];
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
  const editableLayer = !memory?.layer || (HUMAN_LAYER_OPTIONS as readonly string[]).includes(memory.layer);
  const [layer, setLayer] = useState(memory?.layer && editableLayer ? memory.layer : "COMPANY");
  const [sensitivity, setSensitivity] = useState(memory?.sensitivity ?? "INTERNAL");
  const [readPermission, setReadPermission] = useState(memory?.readPermission ?? "");
  const [expiresOn, setExpiresOn] = useState(memory?.expiresOn ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const idp = memory ? `mem-${memory.id}` : "mem-new";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        title,
        fact,
        source: source.trim() || null,
        departmentId: departmentId || null,
        pinned,
        ...(editableLayer ? { layer } : {}),
        sensitivity,
        ...(readPermissions.length ? { readPermission: readPermission || null } : {}),
        expiresAt: expiresOn ? new Date(`${expiresOn}T23:59:59Z`).toISOString() : null,
      };
      if (memory) await api(`${base(organizationId, companyId)}/${memory.id}`, { method: "PATCH", body: payload });
      else await api(base(organizationId, companyId), { body: payload });
      if (!memory) {
        setTitle("");
        setFact("");
        setSource("");
        setPinned(false);
        setExpiresOn("");
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
      <details className="rounded-md border px-3 py-2 text-sm" open={Boolean(memory && (memory.readPermission || memory.expiresOn || (memory.sensitivity && memory.sensitivity !== "INTERNAL")))}>
        <summary className="cursor-pointer select-none font-medium">{t("brain.memory.governance")}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {editableLayer ? (
            <Field label={t("brain.memory.layerLabel")} htmlFor={`${idp}-layer`}>
              <Select id={`${idp}-layer`} value={layer} onChange={(e) => setLayer(e.target.value)}>
                {HUMAN_LAYER_OPTIONS.map((l) => (
                  <option key={l} value={l}>
                    {t(`brain.memory.layers.${l}`)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label={t("brain.memory.sensitivityLabel")} htmlFor={`${idp}-sensitivity`}>
            <Select id={`${idp}-sensitivity`} value={sensitivity} onChange={(e) => setSensitivity(e.target.value)}>
              {SENSITIVITY_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {t(`brain.memory.sensitivity.${l}`)}
                </option>
              ))}
            </Select>
          </Field>
          {readPermissions.length ? (
            <Field label={t("brain.memory.readPermissionLabel")} htmlFor={`${idp}-perm`} hint={t("brain.memory.readPermissionHint")}>
              <Select id={`${idp}-perm`} value={readPermission} onChange={(e) => setReadPermission(e.target.value)}>
                <option value="">{t("brain.memory.noExtraPermission")}</option>
                {readPermissions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label={t("brain.memory.expiresLabel")} htmlFor={`${idp}-expires`} hint={t("brain.memory.expiresHint")}>
            <Input id={`${idp}-expires`} type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </Field>
        </div>
      </details>
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
  readPermissions = [],
  memory,
  meta,
  canManage,
  focused = false,
}: {
  organizationId: string;
  companyId: string;
  departments: { id: string; name: string }[];
  readPermissions?: string[];
  memory: MemoryView;
  /** Pre-formatted line: department, author, date. */
  meta: string;
  canManage: boolean;
  focused?: boolean;
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
        <MemoryForm organizationId={organizationId} companyId={companyId} departments={departments} readPermissions={readPermissions} memory={memory} onDone={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li id={`m-${memory.id}`} className={cn("flex items-start gap-3 px-4 py-3", focused && "bg-accent/40")}>
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          {memory.pinned ? <Pin aria-label={t("brain.memory.pinned")} className="size-3.5 text-primary" /> : null}
          <span className="min-w-0 break-words">{memory.title}</span>
          {memory.layer ? <Badge>{t(`brain.memory.layers.${memory.layer}`)}</Badge> : null}
          {memory.scope && memory.scope !== "COMPANY" ? <Badge tone="info">{t(`brain.memory.scopes.${memory.scope}`)}</Badge> : null}
          {memory.sensitivity === "CONFIDENTIAL" || memory.sensitivity === "RESTRICTED" ? (
            <Badge tone={memory.sensitivity === "RESTRICTED" ? "danger" : "warning"}>
              <Lock aria-hidden className="size-3" />
              {t(`brain.memory.sensitivity.${memory.sensitivity}`)}
            </Badge>
          ) : null}
          {memory.readPermission ? <Badge tone="warning">{t("brain.memory.needsPermission", { permission: memory.readPermission })}</Badge> : null}
          {memory.expiresOn ? <Badge>{t("brain.memory.expiresOn", { date: memory.expiresOn })}</Badge> : null}
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
