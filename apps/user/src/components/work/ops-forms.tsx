"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { PersonSelect, useAction, type Person } from "./actions";

const SCHEDULES = ["NONE", "DAILY", "WEEKLY", "MONTHLY"] as const;
const ASSET_STATUSES = ["AVAILABLE", "IN_USE", "MAINTENANCE", "RETIRED"] as const;
const SEVERITIES = ["SEV1", "SEV2", "SEV3", "SEV4"] as const;

interface Step {
  title: string;
  detail: string;
}

/** Ordered step list editor (add, remove, reorder). */
function StepsEditor({ steps, onChange }: { steps: Step[]; onChange: (s: Step[]) => void }) {
  const t = useT();
  const update = (i: number, patch: Partial<Step>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => {
    const n = [...steps];
    [n[i], n[i + d]] = [n[i + d]!, n[i]!];
    onChange(n);
  };
  return (
    <ol className="grid gap-2">
      {steps.map((s, i) => (
        <li key={i} className="grid gap-1 rounded-md border p-2 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:items-start">
          <span className="pt-2 text-center text-sm font-semibold text-muted-foreground">{i + 1}</span>
          <div className="grid gap-1">
            <Input aria-label={t("work.ops.stepTitle", { n: i + 1 })} placeholder={t("work.ops.stepTitlePlaceholder")} value={s.title} maxLength={300} onChange={(e) => update(i, { title: e.target.value })} />
            <Textarea aria-label={t("work.ops.stepDetail", { n: i + 1 })} placeholder={t("work.ops.stepDetailPlaceholder")} rows={2} className="min-h-12" value={s.detail} maxLength={5000} onChange={(e) => update(i, { detail: e.target.value })} />
          </div>
          <div className="flex gap-1 sm:flex-col">
            <Button type="button" size="icon" variant="ghost" disabled={i === 0} aria-label={t("work.ops.moveUp")} onClick={() => move(i, -1)}>
              <ArrowUp aria-hidden />
            </Button>
            <Button type="button" size="icon" variant="ghost" disabled={i === steps.length - 1} aria-label={t("work.ops.moveDown")} onClick={() => move(i, 1)}>
              <ArrowDown aria-hidden />
            </Button>
            <Button type="button" size="icon" variant="ghost" disabled={steps.length === 1} aria-label={t("work.remove")} onClick={() => onChange(steps.filter((_, j) => j !== i))}>
              <X aria-hidden />
            </Button>
          </div>
        </li>
      ))}
      <li>
        <Button type="button" size="sm" variant="secondary" onClick={() => onChange([...steps, { title: "", detail: "" }])}>
          <Plus aria-hidden />
          {t("work.ops.addStep")}
        </Button>
      </li>
    </ol>
  );
}

const cleanSteps = (steps: Step[]) => steps.filter((s) => s.title.trim()).map((s) => ({ title: s.title.trim(), ...(s.detail.trim() ? { detail: s.detail.trim() } : {}) }));

export function ProcessForm({ base, locale, people }: { base: string; locale: string; people: Person[] }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState({ title: "", description: "", category: "", ownerId: "" });
  const [steps, setSteps] = useState<Step[]>([{ title: "", detail: "" }]);
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api<{ id: string }>(`${base}/operations/processes`, { body: { ...f, steps: cleanSteps(steps) } }), (p) => router.push(`/${locale}/operations/processes/${p.id}`));
      }}
      className="grid gap-3 p-3 sm:grid-cols-3"
    >
      <Field label={t("work.ops.processTitle")} htmlFor="pr-title">
        <Input id="pr-title" value={f.title} maxLength={200} required onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} />
      </Field>
      <Field label={t("work.ops.category")} htmlFor="pr-cat">
        <Input id="pr-cat" value={f.category} maxLength={80} onChange={(e) => setF((p) => ({ ...p, category: e.target.value }))} />
      </Field>
      <Field label={t("work.ops.owner")} htmlFor="pr-owner">
        <PersonSelect id="pr-owner" people={people} value={f.ownerId} onChange={(v) => setF((p) => ({ ...p, ownerId: v }))} emptyLabel={t("work.none")} />
      </Field>
      <Field label={t("work.product.description")} htmlFor="pr-desc" className="sm:col-span-3">
        <Textarea id="pr-desc" rows={2} value={f.description} maxLength={5000} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} />
      </Field>
      <div className="grid gap-1 sm:col-span-3">
        <span className="text-sm font-medium">{t("work.ops.steps")}</span>
        <StepsEditor steps={steps} onChange={setSteps} />
      </div>
      <div className="sm:col-span-3">
        <Button type="submit" disabled={busy || !f.title.trim() || !cleanSteps(steps).length}>
          <Plus aria-hidden />
          {t("work.ops.addProcess")}
        </Button>
      </div>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function ProcessVersionForm({ base, processId, initial }: { base: string; processId: string; initial: Step[] }) {
  const t = useT();
  const [steps, setSteps] = useState<Step[]>(initial.length ? initial : [{ title: "", detail: "" }]);
  const [note, setNote] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/operations/processes/${processId}/versions`, { body: { steps: cleanSteps(steps), changeNote: note } }), () => setNote(""));
      }}
      className="grid gap-3"
    >
      <StepsEditor steps={steps} onChange={setSteps} />
      <Field label={t("work.ops.changeNote")} htmlFor="pv-note">
        <Input id="pv-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" disabled={busy || !cleanSteps(steps).length}>
          {t("work.ops.saveVersion")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function ProcessMetaForm({ base, processId, people, initial }: { base: string; processId: string; people: Person[]; initial: { title: string; description: string; category: string; ownerId: string } }) {
  const t = useT();
  const [f, setF] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/operations/processes/${processId}`, { method: "PATCH", body: f }), () => setSaved(true));
      }}
      className="grid gap-2 sm:grid-cols-3"
    >
      <Field label={t("work.ops.processTitle")} htmlFor="pm-title">
        <Input id="pm-title" value={f.title} maxLength={200} required onChange={(e) => (setSaved(false), setF((p) => ({ ...p, title: e.target.value })))} />
      </Field>
      <Field label={t("work.ops.category")} htmlFor="pm-cat">
        <Input id="pm-cat" value={f.category} maxLength={80} onChange={(e) => (setSaved(false), setF((p) => ({ ...p, category: e.target.value })))} />
      </Field>
      <Field label={t("work.ops.owner")} htmlFor="pm-owner">
        <PersonSelect id="pm-owner" people={people} value={f.ownerId} onChange={(v) => (setSaved(false), setF((p) => ({ ...p, ownerId: v })))} emptyLabel={t("work.none")} />
      </Field>
      <Field label={t("work.product.description")} htmlFor="pm-desc" className="sm:col-span-3">
        <Textarea id="pm-desc" rows={2} value={f.description} maxLength={5000} onChange={(e) => (setSaved(false), setF((p) => ({ ...p, description: e.target.value })))} />
      </Field>
      <div className="flex items-center gap-2 sm:col-span-3">
        <Button type="submit" variant="secondary" disabled={busy || !f.title.trim()}>
          {t("common.save")}
        </Button>
        {saved ? <span className="text-xs text-success">{t("work.saved")}</span> : null}
      </div>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function ChecklistForm({ base, locale, people, checklistId, initial }: { base: string; locale: string; people: Person[]; checklistId?: string; initial?: { title: string; description: string; items: string; schedule: string; nextRunOn: string; assigneeId: string } }) {
  const t = useT();
  const router = useRouter();
  const empty = { title: "", description: "", items: "", schedule: "WEEKLY", nextRunOn: "", assigneeId: "" };
  const [f, setF] = useState(initial ?? empty);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => (setSaved(false), setF((p) => ({ ...p, [k]: e.target.value })));
  const items = f.items
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const body = { ...f, items };
        void run(
          () => (checklistId ? api(`${base}/operations/checklists/${checklistId}`, { method: "PATCH", body }) : api<{ id: string }>(`${base}/operations/checklists`, { body })),
          (r) => (checklistId ? setSaved(true) : router.push(`/${locale}/operations/checklists/${(r as { id: string }).id}`)),
        );
      }}
      className="grid gap-3 p-3 sm:grid-cols-4"
    >
      <Field label={t("work.ops.checklistTitle")} htmlFor="cl-title" className="sm:col-span-2">
        <Input id="cl-title" value={f.title} maxLength={200} required onChange={set("title")} />
      </Field>
      <Field label={t("work.ops.schedule")} htmlFor="cl-schedule">
        <Select id="cl-schedule" value={f.schedule} onChange={set("schedule")}>
          {SCHEDULES.map((s) => (
            <option key={s} value={s}>
              {t(`work.ops.schedules.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.ops.nextRun")} htmlFor="cl-next" hint={t("work.ops.nextRunHint")}>
        <Input id="cl-next" type="date" value={f.nextRunOn} disabled={f.schedule === "NONE"} onChange={set("nextRunOn")} />
      </Field>
      <Field label={t("work.task.assignee")} htmlFor="cl-assignee">
        <PersonSelect id="cl-assignee" people={people} value={f.assigneeId} onChange={(v) => (setSaved(false), setF((p) => ({ ...p, assigneeId: v })))} />
      </Field>
      <Field label={t("work.product.description")} htmlFor="cl-desc" className="sm:col-span-3">
        <Input id="cl-desc" value={f.description} maxLength={2000} onChange={set("description")} />
      </Field>
      <Field label={t("work.ops.items")} htmlFor="cl-items" hint={t("work.ops.itemsHint")} className="sm:col-span-4">
        <Textarea id="cl-items" rows={6} value={f.items} onChange={set("items")} />
      </Field>
      <div className="flex items-center gap-2 sm:col-span-4">
        <Button type="submit" variant={checklistId ? "secondary" : "default"} disabled={busy || !f.title.trim() || !items.length || items.length > 100}>
          {checklistId ? t("common.save") : t("work.ops.addChecklist")}
        </Button>
        {saved ? <span className="text-xs text-success">{t("work.saved")}</span> : null}
      </div>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function RunItemToggle({ base, runId, itemId, done, label }: { base: string; runId: string; itemId: string; done: boolean; label: string }) {
  const { busy, error, run } = useAction();
  return (
    <span className="grid gap-1">
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={done} disabled={busy} onChange={(e) => void run(() => api(`${base}/operations/runs/${runId}`, { method: "PATCH", body: { itemId, done: e.target.checked } }))} />
        <span className={done ? "text-muted-foreground line-through" : ""}>{label}</span>
      </label>
      <FormError error={error} />
    </span>
  );
}

export interface AssetValues {
  name: string;
  assetTag: string;
  category: string;
  serialNumber: string;
  location: string;
  status: string;
  assignedToId: string;
  purchaseDate: string;
  cost: string;
  notes: string;
}

export function AssetForm({ base, people, currency, assetId, initial, onDone }: { base: string; people: Person[]; currency: string; assetId?: string; initial?: AssetValues; onDone?: () => void }) {
  const t = useT();
  const empty: AssetValues = { name: "", assetTag: "", category: "", serialNumber: "", location: "", status: "AVAILABLE", assignedToId: "", purchaseDate: "", cost: "", notes: "" };
  const [f, setF] = useState<AssetValues>(initial ?? empty);
  const { busy, error, run } = useAction();
  const set = (k: keyof AssetValues) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const id = assetId ?? "new";
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => (assetId ? api(`${base}/operations/assets/${assetId}`, { method: "PATCH", body: f }) : api(`${base}/operations/assets`, { body: f })), () => (assetId ? onDone?.() : setF(empty)));
      }}
      className="grid gap-2 p-3 sm:grid-cols-4"
    >
      <Field label={t("work.ops.assetName")} htmlFor={`as-name-${id}`}>
        <Input id={`as-name-${id}`} value={f.name} maxLength={200} required onChange={set("name")} />
      </Field>
      <Field label={t("work.ops.assetTag")} htmlFor={`as-tag-${id}`}>
        <Input id={`as-tag-${id}`} value={f.assetTag} maxLength={60} onChange={set("assetTag")} />
      </Field>
      <Field label={t("work.ops.category")} htmlFor={`as-cat-${id}`}>
        <Input id={`as-cat-${id}`} value={f.category} maxLength={80} onChange={set("category")} />
      </Field>
      <Field label={t("work.ops.serial")} htmlFor={`as-serial-${id}`}>
        <Input id={`as-serial-${id}`} value={f.serialNumber} maxLength={120} onChange={set("serialNumber")} />
      </Field>
      <Field label={t("work.ops.location")} htmlFor={`as-loc-${id}`}>
        <Input id={`as-loc-${id}`} value={f.location} maxLength={200} onChange={set("location")} />
      </Field>
      <Field label={t("work.task.status")} htmlFor={`as-status-${id}`}>
        <Select id={`as-status-${id}`} value={f.status} onChange={set("status")}>
          {ASSET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`work.ops.assetStatus.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.ops.assignedTo")} htmlFor={`as-assignee-${id}`}>
        <PersonSelect id={`as-assignee-${id}`} people={people} value={f.assignedToId} onChange={(v) => setF((p) => ({ ...p, assignedToId: v }))} />
      </Field>
      <Field label={t("work.ops.purchaseDate")} htmlFor={`as-date-${id}`}>
        <Input id={`as-date-${id}`} type="date" value={f.purchaseDate} onChange={set("purchaseDate")} />
      </Field>
      <Field label={t("work.ops.cost", { currency })} htmlFor={`as-cost-${id}`}>
        <Input id={`as-cost-${id}`} inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" value={f.cost} onChange={set("cost")} />
      </Field>
      <Field label={t("work.ops.notes")} htmlFor={`as-notes-${id}`} className="sm:col-span-3">
        <Input id={`as-notes-${id}`} value={f.notes} maxLength={4000} onChange={set("notes")} />
      </Field>
      <div className="flex gap-2 sm:col-span-4">
        <Button type="submit" variant="secondary" disabled={busy || !f.name.trim()}>
          {assetId ? t("common.save") : t("work.ops.addAsset")}
        </Button>
        {onDone ? (
          <Button type="button" variant="ghost" onClick={onDone}>
            {t("common.cancel")}
          </Button>
        ) : null}
      </div>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function AssetEditor(props: { base: string; people: Person[]; currency: string; assetId: string; initial: AssetValues }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (open)
    return (
      <div className="rounded-md border">
        <AssetForm {...props} onDone={() => setOpen(false)} />
      </div>
    );
  return (
    <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
      {t("work.edit")}
    </Button>
  );
}

export function IncidentForm({ base, locale, people, projects }: { base: string; locale: string; people: Person[]; projects: { id: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [f, setF] = useState({ title: "", description: "", severity: "SEV3", ownerId: "", projectId: "", occurredAt: local });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const occurredAt = f.occurredAt ? new Date(f.occurredAt).toISOString() : undefined;
        void run(() => api<{ id: string }>(`${base}/operations/incidents`, { body: { ...f, occurredAt } }), (i) => router.push(`/${locale}/operations/incidents/${i.id}`));
      }}
      className="grid gap-2 p-3 sm:grid-cols-4"
    >
      <Field label={t("work.ops.incidentTitle")} htmlFor="ic-title" className="sm:col-span-2">
        <Input id="ic-title" value={f.title} maxLength={200} required onChange={set("title")} />
      </Field>
      <Field label={t("work.ops.severity")} htmlFor="ic-sev">
        <Select id="ic-sev" value={f.severity} onChange={set("severity")}>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {t(`work.ops.severities.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.ops.occurredAt")} htmlFor="ic-at">
        <Input id="ic-at" type="datetime-local" value={f.occurredAt} max={local} onChange={set("occurredAt")} />
      </Field>
      <Field label={t("work.ops.owner")} htmlFor="ic-owner">
        <PersonSelect id="ic-owner" people={people} value={f.ownerId} onChange={(v) => setF((p) => ({ ...p, ownerId: v }))} emptyLabel={t("work.none")} />
      </Field>
      <Field label={t("work.task.project")} htmlFor="ic-project">
        <Select id="ic-project" value={f.projectId} onChange={set("projectId")}>
          <option value="">{t("work.none")}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.product.description")} htmlFor="ic-desc" className="sm:col-span-4">
        <Textarea id="ic-desc" rows={3} value={f.description} maxLength={10000} onChange={set("description")} />
      </Field>
      <div className="sm:col-span-4">
        <Button type="submit" disabled={busy || !f.title.trim()}>
          <Plus aria-hidden />
          {t("work.ops.logIncident")}
        </Button>
      </div>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function IncidentEditForm({ base, incidentId, people, initial }: { base: string; incidentId: string; people: Person[]; initial: { title: string; description: string; severity: string; status: string; ownerId: string; postmortem: string } }) {
  const t = useT();
  const [f, setF] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof initial) => (e: { target: { value: string } }) => (setSaved(false), setF((p) => ({ ...p, [k]: e.target.value })));
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/operations/incidents/${incidentId}`, { method: "PATCH", body: f }), () => setSaved(true));
      }}
      className="grid gap-3 sm:grid-cols-4"
    >
      <Field label={t("work.ops.incidentTitle")} htmlFor="ie-title" className="sm:col-span-4">
        <Input id="ie-title" value={f.title} maxLength={200} required onChange={set("title")} />
      </Field>
      <Field label={t("work.task.status")} htmlFor="ie-status">
        <Select id="ie-status" value={f.status} onChange={set("status")}>
          {["OPEN", "INVESTIGATING", "MITIGATED", "RESOLVED", "CLOSED"].map((s) => (
            <option key={s} value={s}>
              {t(`work.ops.incidentStatus.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.ops.severity")} htmlFor="ie-sev">
        <Select id="ie-sev" value={f.severity} onChange={set("severity")}>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {t(`work.ops.severities.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.ops.owner")} htmlFor="ie-owner" className="sm:col-span-2">
        <PersonSelect id="ie-owner" people={people} value={f.ownerId} onChange={(v) => (setSaved(false), setF((p) => ({ ...p, ownerId: v })))} emptyLabel={t("work.none")} />
      </Field>
      <Field label={t("work.product.description")} htmlFor="ie-desc" className="sm:col-span-4">
        <Textarea id="ie-desc" rows={3} value={f.description} maxLength={10000} onChange={set("description")} />
      </Field>
      <Field label={t("work.ops.postmortem")} htmlFor="ie-pm" hint={t("work.ops.postmortemHint")} className="sm:col-span-4">
        <Textarea id="ie-pm" rows={10} value={f.postmortem} maxLength={50000} onChange={set("postmortem")} placeholder={t("work.ops.postmortemPlaceholder")} />
      </Field>
      <div className="flex items-center gap-2 sm:col-span-4">
        <Button type="submit" variant="secondary" disabled={busy || !f.title.trim()}>
          {t("common.save")}
        </Button>
        {saved ? <span className="text-xs text-success">{t("work.saved")}</span> : null}
      </div>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}
