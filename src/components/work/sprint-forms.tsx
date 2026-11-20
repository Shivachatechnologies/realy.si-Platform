"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListPlus, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./actions";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function NewSprintForm({ base, projectId, suggestedName }: { base: string; projectId: string; suggestedName: string }) {
  const t = useT();
  const start = new Date();
  const empty = { name: suggestedName, goal: "", startDate: iso(start), endDate: iso(new Date(start.getTime() + 13 * 86_400_000)), capacityPoints: "" };
  const [f, setF] = useState(empty);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/projects/${projectId}/sprints`, { body: { ...f, capacityPoints: f.capacityPoints === "" ? null : Number(f.capacityPoints) } }), () => setF(empty));
      }}
      className="grid gap-2 p-3 sm:grid-cols-4"
    >
      <Field label={t("work.agile.sprintName")} htmlFor="sp-name">
        <Input id="sp-name" value={f.name} maxLength={120} required onChange={set("name")} />
      </Field>
      <Field label={t("work.startDate")} htmlFor="sp-start">
        <Input id="sp-start" type="date" required value={f.startDate} onChange={set("startDate")} />
      </Field>
      <Field label={t("work.agile.endDate")} htmlFor="sp-end">
        <Input id="sp-end" type="date" required value={f.endDate} onChange={set("endDate")} />
      </Field>
      <Field label={t("work.agile.capacity")} htmlFor="sp-cap" hint={t("work.agile.capacityHint")}>
        <Input id="sp-cap" type="number" min={0} value={f.capacityPoints} onChange={set("capacityPoints")} />
      </Field>
      <Field label={t("work.agile.goal")} htmlFor="sp-goal" className="sm:col-span-4">
        <Input id="sp-goal" value={f.goal} maxLength={2000} onChange={set("goal")} />
      </Field>
      <div className="sm:col-span-4">
        <Button type="submit" disabled={busy || !f.name.trim()}>
          <Plus aria-hidden />
          {t("work.agile.createSprint")}
        </Button>
      </div>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export interface PlanTask {
  id: string;
  title: string;
  priority: string;
  points: number | null;
  assigneeName: string | null;
}

/** Sprint planning: pick backlog tasks and move them into a sprint; shows the points against capacity. */
export function SprintPlanner({ base, locale, tasks, sprints }: { base: string; locale: string; tasks: PlanTask[]; sprints: { id: string; name: string; points: number; capacity: number | null }[] }) {
  const t = useT();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sprintId, setSprintId] = useState(sprints[0]?.id ?? "");
  const { busy, error, run } = useAction();
  const sprint = sprints.find((s) => s.id === sprintId);
  const pickedPoints = tasks.filter((x) => selected.has(x.id)).reduce((n, x) => n + (x.points ?? 0), 0);
  const after = (sprint?.points ?? 0) + pickedPoints;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div className="grid">
      {sprints.length ? (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 p-3 text-sm">
          <span>{t("work.agile.selected", { count: selected.size, points: pickedPoints })}</span>
          <Select aria-label={t("work.task.sprint")} className="h-8 w-auto text-xs" value={sprintId} onChange={(e) => setSprintId(e.target.value)}>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          {sprint?.capacity != null ? (
            <Badge tone={after > sprint.capacity ? "danger" : "neutral"}>{t("work.agile.capacityUse", { points: after, capacity: sprint.capacity })}</Badge>
          ) : null}
          <Button size="sm" disabled={busy || !selected.size || !sprintId} onClick={() => void run(() => api(`${base}/sprints/${sprintId}/tasks`, { body: { add: [...selected] } }), () => setSelected(new Set()))}>
            <ListPlus aria-hidden />
            {t("work.agile.moveToSprint")}
          </Button>
        </div>
      ) : null}
      <FormError error={error} />
      <ul className="grid divide-y">
        {tasks.map((x) => (
          <li key={x.id} className="flex items-center gap-2 px-4 py-2 text-sm">
            {sprints.length ? <input type="checkbox" aria-label={x.title} checked={selected.has(x.id)} onChange={() => toggle(x.id)} /> : null}
            <Link href={`/${locale}/projects/tasks/${x.id}`} className="min-w-0 flex-1 truncate hover:underline">
              {x.title}
            </Link>
            <Badge tone={x.priority === "URGENT" ? "danger" : x.priority === "HIGH" ? "warning" : "neutral"}>{t(`work.priority.${x.priority}`)}</Badge>
            <span className="w-24 truncate text-xs text-muted-foreground">{x.assigneeName ?? t("work.unassigned")}</span>
            <span className="w-12 text-end text-xs tabular-nums text-muted-foreground">{x.points ?? "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RemoveFromSprintButton({ base, sprintId, taskId }: { base: string; sprintId: string; taskId: string }) {
  const t = useT();
  const { busy, run } = useAction();
  return (
    <Button size="sm" variant="ghost" disabled={busy} aria-label={t("work.agile.removeFromSprint")} title={t("work.agile.removeFromSprint")} onClick={() => void run(() => api(`${base}/sprints/${sprintId}/tasks`, { body: { remove: [taskId] } }))}>
      <X aria-hidden />
    </Button>
  );
}

export function SprintControls({ base, locale, projectId, sprint, planned }: { base: string; locale: string; projectId: string; sprint: { id: string; status: string; name: string }; planned: { id: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [rollover, setRollover] = useState("backlog");
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {sprint.status === "PLANNED" ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => void run(() => api(`${base}/sprints/${sprint.id}/start`, { body: {} }))}>
              {t("work.agile.start")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => window.confirm(t("work.confirmDelete")) && void run(() => api(`${base}/sprints/${sprint.id}`, { method: "DELETE" }), () => router.push(`/${locale}/projects/${projectId}/sprints`))}
            >
              {t("work.delete")}
            </Button>
          </>
        ) : null}
        {sprint.status === "ACTIVE" ? (
          <>
            <Select aria-label={t("work.agile.rollover")} className="h-8 w-auto text-xs" value={rollover} onChange={(e) => setRollover(e.target.value)}>
              <option value="backlog">{t("work.agile.rolloverBacklog")}</option>
              {planned.map((s) => (
                <option key={s.id} value={s.id}>
                  {t("work.agile.rolloverTo", { name: s.name })}
                </option>
              ))}
            </Select>
            <Button size="sm" disabled={busy} onClick={() => window.confirm(t("work.agile.confirmComplete")) && void run(() => api(`${base}/sprints/${sprint.id}/complete`, { body: { rollover } }))}>
              {t("work.agile.complete")}
            </Button>
          </>
        ) : null}
      </div>
      <FormError error={error} />
    </div>
  );
}

export function EditSprintForm({ base, sprintId, initial }: { base: string; sprintId: string; initial: { name: string; goal: string; startDate: string; endDate: string; capacityPoints: string } }) {
  const t = useT();
  const [f, setF] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof initial) => (e: { target: { value: string } }) => (setSaved(false), setF((p) => ({ ...p, [k]: e.target.value })));
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/sprints/${sprintId}`, { method: "PATCH", body: { ...f, capacityPoints: f.capacityPoints === "" ? null : Number(f.capacityPoints) } }), () => setSaved(true));
      }}
      className="grid gap-2 sm:grid-cols-4"
    >
      <Field label={t("work.agile.sprintName")} htmlFor="es-name">
        <Input id="es-name" value={f.name} maxLength={120} required onChange={set("name")} />
      </Field>
      <Field label={t("work.startDate")} htmlFor="es-start">
        <Input id="es-start" type="date" required value={f.startDate} onChange={set("startDate")} />
      </Field>
      <Field label={t("work.agile.endDate")} htmlFor="es-end">
        <Input id="es-end" type="date" required value={f.endDate} onChange={set("endDate")} />
      </Field>
      <Field label={t("work.agile.capacity")} htmlFor="es-cap">
        <Input id="es-cap" type="number" min={0} value={f.capacityPoints} onChange={set("capacityPoints")} />
      </Field>
      <Field label={t("work.agile.goal")} htmlFor="es-goal" className="sm:col-span-4">
        <Textarea id="es-goal" rows={2} value={f.goal} maxLength={2000} onChange={set("goal")} />
      </Field>
      <div className="flex items-center gap-2 sm:col-span-4">
        <Button type="submit" variant="secondary" disabled={busy}>
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

export function RetroForm({ base, sprintId }: { base: string; sprintId: string }) {
  const t = useT();
  const [kind, setKind] = useState("WENT_WELL");
  const [text, setText] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/sprints/${sprintId}/retro`, { body: { kind, text } }), () => setText(""));
      }}
      className="grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)_auto] sm:items-end"
    >
      <Field label={t("work.retro.kind")} htmlFor="rt-kind">
        <Select id="rt-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {["WENT_WELL", "TO_IMPROVE", "ACTION"].map((k) => (
            <option key={k} value={k}>
              {t(`work.retro.kinds.${k}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.retro.text")} htmlFor="rt-text">
        <Input id="rt-text" value={text} maxLength={1000} required onChange={(e) => setText(e.target.value)} />
      </Field>
      <Button type="submit" variant="secondary" disabled={busy || !text.trim()}>
        <Plus aria-hidden />
        {t("work.retro.add")}
      </Button>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function RetroItemActions({ base, itemId, canDelete, canTask }: { base: string; itemId: string; canDelete: boolean; canTask: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <span className="flex items-center gap-1">
      {canTask ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api(`${base}/retro/${itemId}/task`, { body: {} }))}>
          {t("work.retro.toTask")}
        </Button>
      ) : null}
      {canDelete ? (
        <Button size="sm" variant="ghost" disabled={busy} aria-label={t("work.delete")} title={t("work.delete")} onClick={() => void run(() => api(`${base}/retro/${itemId}`, { method: "DELETE" }))}>
          <X aria-hidden />
        </Button>
      ) : null}
      <FormError error={error} />
    </span>
  );
}
