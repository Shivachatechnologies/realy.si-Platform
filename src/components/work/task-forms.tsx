"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Paperclip, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { PersonSelect, useAction, type Person } from "./actions";

import { PRIORITIES, TASK_STATUSES } from "./constants";
const RECURRENCES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
const MAX_BYTES = 5 * 1024 * 1024;

export interface Option {
  id: string;
  name: string;
}

export interface TaskValues {
  title: string;
  description: string;
  status: string;
  priority: string;
  assigneeId: string;
  startDate: string;
  dueDate: string;
  estimatePoints: string;
  labels: string;
  milestoneId: string;
  sprintId: string;
  featureId: string;
  recurrence: string;
  recurrenceInterval: string;
  recurrenceUntil: string;
}

const emptyTask: TaskValues = {
  title: "",
  description: "",
  status: "TODO",
  priority: "MEDIUM",
  assigneeId: "",
  startDate: "",
  dueDate: "",
  estimatePoints: "",
  labels: "",
  milestoneId: "",
  sprintId: "",
  featureId: "",
  recurrence: "",
  recurrenceInterval: "1",
  recurrenceUntil: "",
};

const payload = (f: TaskValues) => ({
  ...f,
  estimatePoints: f.estimatePoints === "" ? null : Number(f.estimatePoints),
  labels: f.labels
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean),
  recurrence: f.recurrence || null,
  recurrenceInterval: Number(f.recurrenceInterval) || 1,
});

/** Shared field set for creating and editing a task. */
function TaskFields({ f, set, setV, people, milestones, sprints, features, idp }: { f: TaskValues; set: (k: keyof TaskValues) => (e: { target: { value: string } }) => void; setV: (k: keyof TaskValues, v: string) => void; people: Person[]; milestones: Option[]; sprints: Option[]; features: Option[]; idp: string }) {
  const t = useT();
  return (
    <>
      <Field label={t("work.task.status")} htmlFor={`${idp}-status`}>
        <Select id={`${idp}-status`} value={f.status} onChange={set("status")}>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`work.taskStatus.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.task.priority")} htmlFor={`${idp}-priority`}>
        <Select id={`${idp}-priority`} value={f.priority} onChange={set("priority")}>
          {PRIORITIES.map((s) => (
            <option key={s} value={s}>
              {t(`work.priority.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.task.assignee")} htmlFor={`${idp}-assignee`}>
        <PersonSelect id={`${idp}-assignee`} people={people} value={f.assigneeId} onChange={(v) => setV("assigneeId", v)} />
      </Field>
      <Field label={t("work.task.estimate")} htmlFor={`${idp}-points`}>
        <Input id={`${idp}-points`} type="number" min={0} max={100} value={f.estimatePoints} onChange={set("estimatePoints")} />
      </Field>
      <Field label={t("work.startDate")} htmlFor={`${idp}-start`}>
        <Input id={`${idp}-start`} type="date" value={f.startDate} onChange={set("startDate")} />
      </Field>
      <Field label={t("work.dueDate")} htmlFor={`${idp}-due`}>
        <Input id={`${idp}-due`} type="date" value={f.dueDate} onChange={set("dueDate")} />
      </Field>
      <Field label={t("work.task.labels")} htmlFor={`${idp}-labels`} hint={t("work.task.labelsHint")}>
        <Input id={`${idp}-labels`} value={f.labels} maxLength={400} onChange={set("labels")} />
      </Field>
      {milestones.length ? (
        <Field label={t("work.task.milestone")} htmlFor={`${idp}-ms`}>
          <Select id={`${idp}-ms`} value={f.milestoneId} onChange={set("milestoneId")}>
            <option value="">{t("work.none")}</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {sprints.length ? (
        <Field label={t("work.task.sprint")} htmlFor={`${idp}-sprint`}>
          <Select id={`${idp}-sprint`} value={f.sprintId} onChange={set("sprintId")}>
            <option value="">{t("work.agile.backlog")}</option>
            {sprints.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {features.length ? (
        <Field label={t("work.task.feature")} htmlFor={`${idp}-feature`}>
          <Select id={`${idp}-feature`} value={f.featureId} onChange={set("featureId")}>
            <option value="">{t("work.none")}</option>
            {features.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label={t("work.task.recurrence")} htmlFor={`${idp}-rec`} hint={t("work.task.recurrenceHint")}>
        <Select id={`${idp}-rec`} value={f.recurrence} onChange={set("recurrence")}>
          <option value="">{t("work.task.noRepeat")}</option>
          {RECURRENCES.map((r) => (
            <option key={r} value={r}>
              {t(`work.recurrence.${r}`)}
            </option>
          ))}
        </Select>
      </Field>
      {f.recurrence ? (
        <>
          <Field label={t("work.task.every")} htmlFor={`${idp}-interval`}>
            <Input id={`${idp}-interval`} type="number" min={1} max={365} value={f.recurrenceInterval} onChange={set("recurrenceInterval")} />
          </Field>
          <Field label={t("work.task.until")} htmlFor={`${idp}-until`}>
            <Input id={`${idp}-until`} type="date" value={f.recurrenceUntil} onChange={set("recurrenceUntil")} />
          </Field>
        </>
      ) : null}
    </>
  );
}

export function NewTaskForm({
  base,
  people,
  projects,
  projectId,
  milestones = [],
  sprints = [],
  features = [],
  parentId,
  defaults,
}: {
  base: string;
  people: Person[];
  projects?: Option[];
  projectId?: string;
  milestones?: Option[];
  sprints?: Option[];
  features?: Option[];
  parentId?: string;
  defaults?: Partial<TaskValues>;
}) {
  const t = useT();
  const start = { ...emptyTask, ...defaults };
  const [f, setF] = useState<TaskValues>(start);
  const [project, setProject] = useState(projectId ?? "");
  const { busy, error, run } = useAction();
  const set = (k: keyof TaskValues) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const setV = (k: keyof TaskValues, v: string) => setF((p) => ({ ...p, [k]: v }));
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/tasks`, { body: { ...payload(f), projectId: project || null, parentId: parentId ?? null } }), () => setF(start));
      }}
      className="grid gap-3 p-3 sm:grid-cols-4"
    >
      <Field label={t("work.task.title")} htmlFor="nt-title" className="sm:col-span-2">
        <Input id="nt-title" value={f.title} maxLength={300} required onChange={set("title")} />
      </Field>
      {projects ? (
        <Field label={t("work.task.project")} htmlFor="nt-project" className="sm:col-span-2">
          <Select id="nt-project" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">{t("work.task.noProject")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <TaskFields f={f} set={set} setV={setV} people={people} milestones={project === projectId ? milestones : []} sprints={project === projectId ? sprints : []} features={features} idp="nt" />
      <div className="sm:col-span-4">
        <Field label={t("work.task.description")} htmlFor="nt-desc">
          <Textarea id="nt-desc" rows={2} value={f.description} maxLength={20000} onChange={set("description")} />
        </Field>
      </div>
      <div className="sm:col-span-4">
        <Button type="submit" disabled={busy || !f.title.trim()}>
          <Plus aria-hidden />
          {parentId ? t("work.task.addSubtask") : t("work.task.add")}
        </Button>
      </div>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function EditTaskForm({ base, taskId, people, milestones, sprints, features, initial }: { base: string; taskId: string; people: Person[]; milestones: Option[]; sprints: Option[]; features: Option[]; initial: TaskValues }) {
  const t = useT();
  const [f, setF] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const set = (k: keyof TaskValues) => (e: { target: { value: string } }) => (setSaved(false), setF((p) => ({ ...p, [k]: e.target.value })));
  const setV = (k: keyof TaskValues, v: string) => (setSaved(false), setF((p) => ({ ...p, [k]: v })));
  const blockers = error instanceof ApiError && Array.isArray(error.details?.blockers) ? (error.details.blockers as string[]) : [];
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/tasks/${taskId}`, { method: "PATCH", body: payload(f) }), () => setSaved(true));
      }}
      className="grid gap-3 sm:grid-cols-4"
    >
      <Field label={t("work.task.title")} htmlFor="et-title" className="sm:col-span-4">
        <Input id="et-title" value={f.title} maxLength={300} required onChange={set("title")} />
      </Field>
      <TaskFields f={f} set={set} setV={setV} people={people} milestones={milestones} sprints={sprints} features={features} idp="et" />
      <div className="sm:col-span-4">
        <Field label={t("work.task.description")} htmlFor="et-desc">
          <Textarea id="et-desc" rows={5} value={f.description} maxLength={20000} onChange={set("description")} />
        </Field>
      </div>
      <div className="flex items-center gap-2 sm:col-span-4">
        <Button type="submit" variant="secondary" disabled={busy || !f.title.trim()}>
          {t("common.save")}
        </Button>
        {saved ? <span className="text-xs text-success">{t("work.saved")}</span> : null}
      </div>
      <div className="sm:col-span-4">
        <FormError error={error} />
        {blockers.length ? <p className="mt-1 text-xs text-muted-foreground">{t("work.task.blockedBy", { tasks: blockers.join(", ") })}</p> : null}
      </div>
    </form>
  );
}

/** Quick add (title only) used on board columns and sprint backlogs. */
export function QuickTaskForm({ base, projectId, status, sprintId, label }: { base: string; projectId?: string; status?: string; sprintId?: string; label: string }) {
  const [title, setTitle] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/tasks`, { body: { title, projectId, status: status ?? "TODO", sprintId: sprintId ?? null } }), () => setTitle(""));
      }}
      className="grid gap-1"
    >
      <div className="flex gap-1">
        <Input aria-label={label} placeholder={label} className="h-8 text-xs" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
        <Button type="submit" size="sm" variant="ghost" disabled={busy || !title.trim()} aria-label={label} title={label}>
          <Plus aria-hidden />
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function DependencyForm({ base, taskId, candidates }: { base: string; taskId: string; candidates: Option[] }) {
  const t = useT();
  const [dependsOnId, setDep] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/tasks/${taskId}/dependencies`, { body: { dependsOnId } }), () => setDep(""));
      }}
      className="grid gap-2"
    >
      <div className="flex gap-2">
        <Select aria-label={t("work.task.waitsFor")} value={dependsOnId} onChange={(e) => setDep(e.target.value)}>
          <option value="">{t("work.task.chooseDependency")}</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" disabled={busy || !dependsOnId}>
          <Plus aria-hidden />
          {t("work.task.addDependency")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function RemoveDependencyButton({ base, taskId, dependsOnId }: { base: string; taskId: string; dependsOnId: string }) {
  const t = useT();
  const { busy, run } = useAction();
  return (
    <Button size="sm" variant="ghost" disabled={busy} aria-label={t("work.remove")} title={t("work.remove")} onClick={() => void run(() => api(`${base}/tasks/${taskId}/dependencies?dependsOnId=${dependsOnId}`, { method: "DELETE" }))}>
      <X aria-hidden />
    </Button>
  );
}

/** Comment box with @mentions: typing "@" opens a people picker; picked people are notified. */
export function CommentForm({ base, taskId, people }: { base: string; taskId: string; people: Person[] }) {
  const t = useT();
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<Person[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const { busy, error, run } = useAction();
  const onChange = (v: string) => {
    setBody(v);
    const caret = ref.current?.selectionStart ?? v.length;
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(v.slice(0, caret));
    setQuery(m ? m[2]!.toLowerCase() : null);
  };
  const pick = (p: Person) => {
    const caret = ref.current?.selectionStart ?? body.length;
    const before = body.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${p.name} `);
    setBody(before + body.slice(caret));
    setMentions((m) => (m.some((x) => x.id === p.id) ? m : [...m, p]));
    setQuery(null);
    ref.current?.focus();
  };
  const matches = query === null ? [] : people.filter((p) => p.name.toLowerCase().includes(query)).slice(0, 6);
  const active = mentions.filter((m) => body.includes(`@${m.name}`));
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/tasks/${taskId}/comments`, { body: { body, mentionIds: active.map((m) => m.id) } }), () => (setBody(""), setMentions([])));
      }}
      className="relative grid gap-2"
    >
      <Textarea ref={ref} aria-label={t("work.comment.label")} placeholder={t("work.comment.placeholder")} rows={3} value={body} maxLength={10000} onChange={(e) => onChange(e.target.value)} />
      {matches.length ? (
        <ul className="absolute top-full z-10 mt-1 grid w-64 rounded-md border bg-surface p-1 shadow-lg" role="listbox" aria-label={t("work.comment.mention")}>
          {matches.map((p) => (
            <li key={p.id}>
              <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 text-start text-sm hover:bg-muted" onClick={() => pick(p)}>
                <AtSign className="size-3" aria-hidden />
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="secondary" disabled={busy || !body.trim()}>
          {t("work.comment.post")}
        </Button>
        {active.length ? <span className="text-xs text-muted-foreground">{t("work.comment.willNotify", { names: active.map((m) => m.name).join(", ") })}</span> : null}
      </div>
      <FormError error={error} />
    </form>
  );
}

export function AttachmentForm({ base, taskId }: { base: string; taskId: string }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [tooBig, setTooBig] = useState(false);
  const { busy, error, run } = useAction();
  const upload = async (file: File) => {
    setTooBig(false);
    if (file.size > MAX_BYTES) return setTooBig(true);
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    await run(() => api(`${base}/tasks/${taskId}/attachments`, { body: { fileName: file.name, contentType: file.type || "application/octet-stream", data: btoa(bin) } }));
    if (input.current) input.current.value = "";
  };
  return (
    <div className="grid gap-2">
      <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
        <Paperclip className="size-4" aria-hidden />
        {busy ? t("work.attachment.uploading") : t("work.attachment.add")}
        <input ref={input} type="file" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      </label>
      <p className="text-xs text-muted-foreground">{t("work.attachment.limit")}</p>
      {tooBig ? <p className="text-xs text-danger">{t("errors.reasons.work_attachment_too_large")}</p> : null}
      <FormError error={error} />
    </div>
  );
}

export function TimeForm({ base, taskId, projectId }: { base: string; taskId?: string; projectId?: string }) {
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ workDate: today, hours: "", minutes: "", note: "" });
  const { busy, error, run } = useAction();
  const total = (Number(f.hours) || 0) * 60 + (Number(f.minutes) || 0);
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/time`, { body: { taskId, projectId, workDate: f.workDate, minutes: total, note: f.note } }), () => setF({ workDate: today, hours: "", minutes: "", note: "" }));
      }}
      className="grid gap-2 sm:grid-cols-[10rem_5rem_5rem_minmax(0,1fr)_auto] sm:items-end"
    >
      <Field label={t("work.time.date")} htmlFor="tf-date">
        <Input id="tf-date" type="date" required value={f.workDate} max={today} onChange={(e) => setF((p) => ({ ...p, workDate: e.target.value }))} />
      </Field>
      <Field label={t("work.time.hours")} htmlFor="tf-h">
        <Input id="tf-h" type="number" min={0} max={24} value={f.hours} onChange={(e) => setF((p) => ({ ...p, hours: e.target.value }))} />
      </Field>
      <Field label={t("work.time.minutes")} htmlFor="tf-m">
        <Input id="tf-m" type="number" min={0} max={59} value={f.minutes} onChange={(e) => setF((p) => ({ ...p, minutes: e.target.value }))} />
      </Field>
      <Field label={t("work.time.note")} htmlFor="tf-note">
        <Input id="tf-note" value={f.note} maxLength={500} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} />
      </Field>
      <Button type="submit" variant="secondary" disabled={busy || total < 1 || total > 1440}>
        <Plus aria-hidden />
        {t("work.time.log")}
      </Button>
      <div className="sm:col-span-5">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function DeleteIconButton({ url, label, confirm, redirectTo }: { url: string; label: string; confirm?: string; redirectTo?: string }) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <span className="inline-grid">
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        aria-label={label}
        title={label}
        onClick={() => (!confirm || window.confirm(confirm)) && void run(() => api(url, { method: "DELETE" }), () => (redirectTo ? router.push(redirectTo) : undefined))}
      >
        <Trash2 aria-hidden />
      </Button>
      <FormError error={error} />
    </span>
  );
}
