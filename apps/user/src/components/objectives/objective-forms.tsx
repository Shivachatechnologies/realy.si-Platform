"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

export interface Option {
  id: string;
  name: string;
}
export interface MetricOption {
  key: string;
  label: string;
  unit: string;
}

export function useSubmit(run: () => Promise<unknown>, reset: () => void = () => {}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await run();
      reset();
      router.refresh();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, submit };
}

function OptionSelect({ id, label, value, onChange, options, none }: { id: string; label: string; value: string; onChange: (v: string) => void; options: Option[]; none: string }) {
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{none}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

interface ObjectiveFields {
  title: string;
  description: string;
  startDate: string;
  targetDate: string;
  goalId: string;
  ownerId: string;
  departmentId: string;
}

function ObjectiveFieldset({ prefix, v, set, goals, departments, people }: { prefix: string; v: ObjectiveFields; set: (p: Partial<ObjectiveFields>) => void; goals: Option[]; departments: Option[]; people: Option[] }) {
  const t = useT();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("objectives.title")} htmlFor={`${prefix}-title`} className="sm:col-span-2">
        <Input id={`${prefix}-title`} value={v.title} maxLength={200} required placeholder={t("objectives.titlePlaceholder")} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label={t("objectives.description")} htmlFor={`${prefix}-desc`} className="sm:col-span-2">
        <Textarea id={`${prefix}-desc`} value={v.description} maxLength={2000} rows={2} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      <OptionSelect id={`${prefix}-goal`} label={t("objectives.goal")} value={v.goalId} onChange={(goalId) => set({ goalId })} options={goals} none={t("objectives.noGoal")} />
      <OptionSelect id={`${prefix}-owner`} label={t("objectives.owner")} value={v.ownerId} onChange={(ownerId) => set({ ownerId })} options={people} none={t("objectives.noOwner")} />
      <OptionSelect id={`${prefix}-dept`} label={t("objectives.department")} value={v.departmentId} onChange={(departmentId) => set({ departmentId })} options={departments} none={t("objectives.noDepartment")} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("objectives.startDate")} htmlFor={`${prefix}-start`}>
          <Input id={`${prefix}-start`} type="date" value={v.startDate} onChange={(e) => set({ startDate: e.target.value })} />
        </Field>
        <Field label={t("objectives.targetDate")} htmlFor={`${prefix}-target`}>
          <Input id={`${prefix}-target`} type="date" value={v.targetDate} onChange={(e) => set({ targetDate: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

const emptyObjective = (goalId = ""): ObjectiveFields => ({ title: "", description: "", startDate: "", targetDate: "", goalId, ownerId: "", departmentId: "" });

export function NewObjectiveForm({ base, goals = [], departments = [], people = [], defaultGoalId = "" }: { base: string; goals?: Option[]; departments?: Option[]; people?: Option[]; defaultGoalId?: string }) {
  const t = useT();
  const [v, setV] = useState<ObjectiveFields>(emptyObjective(defaultGoalId));
  const [open, setOpen] = useState(false);
  const { busy, error, submit } = useSubmit(
    () => api(`${base}/objectives`, { body: { ...v, description: v.description || undefined } }),
    () => setV(emptyObjective(defaultGoalId)),
  );
  return (
    <form onSubmit={submit} className="grid gap-3 border-b p-3">
      {open ? (
        <ObjectiveFieldset prefix="objective-new" v={v} set={(p) => setV({ ...v, ...p })} goals={goals} departments={departments} people={people} />
      ) : (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-end">
          <Field label={t("objectives.title")} htmlFor="objective-title">
            <Input id="objective-title" value={v.title} maxLength={200} required placeholder={t("objectives.titlePlaceholder")} onChange={(e) => setV({ ...v, title: e.target.value })} />
          </Field>
          <Field label={t("objectives.targetDate")} htmlFor="objective-date">
            <Input id="objective-date" type="date" value={v.targetDate} onChange={(e) => setV({ ...v, targetDate: e.target.value })} />
          </Field>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || !v.title.trim()}>
          <Plus aria-hidden />
          {t("objectives.create")}
        </Button>
        {!open ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
            {t("objectives.moreDetails")}
          </Button>
        ) : null}
      </div>
      <FormError error={error} />
    </form>
  );
}

export function EditObjectiveDialog({ base, objective, goals, departments, people }: { base: string; objective: { id: string } & ObjectiveFields; goals: Option[]; departments: Option[]; people: Option[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<ObjectiveFields>(objective);
  const { busy, error, submit } = useSubmit(() => api(`${base}/objectives/${objective.id}`, { method: "PATCH", body: v }));
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), o && setV(objective))}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={t("objectives.editLabel")}>
          <Pencil aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent title={t("objectives.edit")} closeLabel={t("common.close")} className="max-w-2xl">
        <form onSubmit={async (e) => (await submit(e)) && setOpen(false)} className="grid gap-3">
          <ObjectiveFieldset prefix={`objective-${objective.id}`} v={v} set={(p) => setV({ ...v, ...p })} goals={goals} departments={departments} people={people} />
          <FormError error={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !v.title.trim()}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Delete with a confirmation; shows the error inline. */
export function DeleteButton({ endpoint, label, confirmText, onDone }: { endpoint: string; label: string; confirmText: string; onDone?: () => void }) {
  const [error, setError] = useState<unknown>(null);
  const { busy, submit } = useSubmit(async () => {
    try {
      await api(endpoint, { method: "DELETE" });
      onDone?.();
    } catch (err) {
      setError(err);
      throw err;
    }
  });
  return (
    <span className="inline-grid gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground hover:text-danger"
        aria-label={label}
        title={label}
        disabled={busy}
        onClick={() => {
          setError(null);
          if (window.confirm(confirmText)) void submit();
        }}
      >
        <Trash2 aria-hidden />
      </Button>
      {error ? (
        <span className="max-w-64">
          <FormError error={error} />
        </span>
      ) : null}
    </span>
  );
}

export function NewMilestoneForm({ base, objectiveId, projects }: { base: string; objectiveId: string; projects: { id: string; name: string }[] }) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [projectId, setProjectId] = useState("");
  const { busy, error, submit } = useSubmit(
    () => api(`${base}/milestones`, { body: { objectiveId, title, dueDate: dueDate || undefined, projectId: projectId || undefined } }),
    () => (setTitle(""), setDueDate(""), setProjectId("")),
  );
  return (
    <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_12rem_auto] sm:items-end">
      <Field label={t("objectives.milestone")} htmlFor={`ms-title-${objectiveId}`}>
        <Input id={`ms-title-${objectiveId}`} value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={t("objectives.dueDate")} htmlFor={`ms-date-${objectiveId}`}>
        <Input id={`ms-date-${objectiveId}`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </Field>
      <Field label={t("objectives.project")} htmlFor={`ms-project-${objectiveId}`}>
        <Select id={`ms-project-${objectiveId}`} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">{t("objectives.noProject")}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" variant="secondary" disabled={busy || !title.trim()}>
        <Plus aria-hidden />
        {t("objectives.addMilestone")}
      </Button>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function MilestoneToggle({ base, milestoneId, done, label }: { base: string; milestoneId: string; done: boolean; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <input
      type="checkbox"
      className="size-4 accent-primary"
      aria-label={label}
      checked={done}
      disabled={busy}
      onChange={async (e) => {
        setBusy(true);
        try {
          await api(`${base}/milestones/${milestoneId}/done`, { method: "PUT", body: { done: e.target.checked } });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

export function ObjectiveStatusSelect({ base, objectiveId, status, labels }: { base: string; objectiveId: string; status: string; labels: Record<string, string> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Select
      aria-label={labels.label}
      className="h-8 w-auto text-xs"
      value={status}
      disabled={busy}
      onChange={async (e) => {
        setBusy(true);
        try {
          await api(`${base}/objectives/${objectiveId}/status`, { method: "PUT", body: { status: e.target.value } });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {["ACTIVE", "ACHIEVED", "ABANDONED"].map((s) => (
        <option key={s} value={s}>
          {labels[s]}
        </option>
      ))}
    </Select>
  );
}

// ───────────── Key results ─────────────

interface KrFields {
  title: string;
  source: "METRIC" | "MANUAL";
  metricKey: string;
  unit: string;
  baseline: string;
  target: string;
  current: string;
  direction: "INCREASE" | "DECREASE";
}

const emptyKr: KrFields = { title: "", source: "MANUAL", metricKey: "", unit: "", baseline: "0", target: "", current: "", direction: "INCREASE" };
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function KrFieldset({ prefix, v, set, metrics, editing }: { prefix: string; v: KrFields; set: (p: Partial<KrFields>) => void; metrics: MetricOption[]; editing: boolean }) {
  const t = useT();
  const metric = metrics.find((m) => m.key === v.metricKey);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("objectives.kr.title")} htmlFor={`${prefix}-title`} className="sm:col-span-2">
        <Input id={`${prefix}-title`} value={v.title} maxLength={200} required placeholder={t("objectives.kr.titlePlaceholder")} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      {!editing ? (
        <Field label={t("objectives.kr.source")} htmlFor={`${prefix}-source`}>
          <Select id={`${prefix}-source`} value={v.source} onChange={(e) => set({ source: e.target.value as KrFields["source"] })}>
            <option value="MANUAL">{t("objectives.kr.sources.MANUAL")}</option>
            <option value="METRIC" disabled={!metrics.length}>
              {t("objectives.kr.sources.METRIC")}
            </option>
          </Select>
        </Field>
      ) : null}
      {v.source === "METRIC" && !editing ? (
        <Field label={t("objectives.kr.metric")} htmlFor={`${prefix}-metric`} hint={metric ? t(`objectives.kr.unitHint.${metric.unit}`) : undefined}>
          <Select id={`${prefix}-metric`} value={v.metricKey} required onChange={(e) => set({ metricKey: e.target.value })}>
            <option value="">{t("objectives.kr.chooseMetric")}</option>
            {metrics.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : v.source === "MANUAL" ? (
        <Field label={t("objectives.kr.unit")} htmlFor={`${prefix}-unit`}>
          <Input id={`${prefix}-unit`} value={v.unit} maxLength={30} placeholder={t("objectives.kr.unitPlaceholder")} onChange={(e) => set({ unit: e.target.value })} />
        </Field>
      ) : null}
      <Field label={t("objectives.kr.direction")} htmlFor={`${prefix}-dir`}>
        <Select id={`${prefix}-dir`} value={v.direction} onChange={(e) => set({ direction: e.target.value as KrFields["direction"] })}>
          <option value="INCREASE">{t("objectives.kr.directions.INCREASE")}</option>
          <option value="DECREASE">{t("objectives.kr.directions.DECREASE")}</option>
        </Select>
      </Field>
      <div className="grid grid-cols-3 gap-2 sm:col-span-2">
        <Field label={t("objectives.kr.baseline")} htmlFor={`${prefix}-base`}>
          <Input id={`${prefix}-base`} type="number" step="any" inputMode="decimal" value={v.baseline} onChange={(e) => set({ baseline: e.target.value })} />
        </Field>
        <Field label={t("objectives.kr.target")} htmlFor={`${prefix}-target`}>
          <Input id={`${prefix}-target`} type="number" step="any" inputMode="decimal" required value={v.target} onChange={(e) => set({ target: e.target.value })} />
        </Field>
        {v.source === "MANUAL" ? (
          <Field label={t("objectives.kr.current")} htmlFor={`${prefix}-current`}>
            <Input id={`${prefix}-current`} type="number" step="any" inputMode="decimal" value={v.current} onChange={(e) => set({ current: e.target.value })} />
          </Field>
        ) : null}
      </div>
    </div>
  );
}

export function NewKeyResultForm({ base, objectiveId, metrics }: { base: string; objectiveId: string; metrics: MetricOption[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<KrFields>(emptyKr);
  const { busy, error, submit } = useSubmit(
    () =>
      api(`${base}/objectives/${objectiveId}/key-results`, {
        body: { title: v.title, source: v.source, metricKey: v.source === "METRIC" ? v.metricKey : null, unit: v.unit || null, baseline: Number(v.baseline || 0), target: Number(v.target), current: numOrNull(v.current), direction: v.direction },
      }),
    () => setV(emptyKr),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plus aria-hidden />
          {t("objectives.kr.add")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("objectives.kr.add")} description={t("objectives.kr.addHint")} closeLabel={t("common.close")}>
        <form onSubmit={async (e) => (await submit(e)) && setOpen(false)} className="grid gap-3">
          <KrFieldset prefix={`kr-new-${objectiveId}`} v={v} set={(p) => setV({ ...v, ...p })} metrics={metrics} editing={false} />
          <FormError error={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !v.title.trim() || v.target === ""}>
              {t("objectives.kr.add")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Edit a key result (display units: money in major units). */
export function EditKeyResultDialog({ base, keyResult, metrics }: { base: string; keyResult: { id: string } & KrFields; metrics: MetricOption[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<KrFields>(keyResult);
  const { busy, error, submit } = useSubmit(() =>
    api(`${base}/key-results/${keyResult.id}`, {
      method: "PATCH",
      body: { title: v.title, unit: v.source === "MANUAL" ? v.unit || null : undefined, baseline: Number(v.baseline || 0), target: Number(v.target), current: v.source === "MANUAL" ? numOrNull(v.current) : undefined, direction: v.direction },
    }),
  );
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), o && setV(keyResult))}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" aria-label={t("objectives.kr.edit")} title={t("objectives.kr.edit")}>
          <Pencil aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent title={t("objectives.kr.edit")} closeLabel={t("common.close")}>
        <form onSubmit={async (e) => (await submit(e)) && setOpen(false)} className="grid gap-3">
          <KrFieldset prefix={`kr-${keyResult.id}`} v={v} set={(p) => setV({ ...v, ...p })} metrics={metrics} editing />
          <FormError error={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !v.title.trim() || v.target === ""}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
