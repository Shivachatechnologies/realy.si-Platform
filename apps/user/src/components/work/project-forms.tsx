"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { PersonSelect, useAction, type Person } from "./actions";

const STATUSES = ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
const HEALTH = ["ON_TRACK", "AT_RISK", "OFF_TRACK"] as const;
const RISK_STATUSES = ["OPEN", "MITIGATING", "CLOSED", "OCCURRED"] as const;
const SCALE = [1, 2, 3, 4, 5] as const;

export interface TemplateOption {
  value: string;
  label: string;
}

export function NewProjectForm({ base, locale, people, viewerId, templates, currency }: { base: string; locale: string; people: Person[]; viewerId: string; templates: TemplateOption[]; currency: string }) {
  const t = useT();
  const router = useRouter();
  const empty = { name: "", description: "", template: "blank", status: "PLANNED", ownerId: people.some((p) => p.id === viewerId) ? viewerId : "", startDate: "", dueDate: "", budget: "" };
  const [f, setF] = useState(empty);
  const [members, setMembers] = useState<string[]>([]);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(
          () => api<{ id: string }>(`${base}/projects`, { body: { ...f, memberIds: members, currency } }),
          (p) => router.push(`/${locale}/projects/${p.id}`),
        );
      }}
      className="grid gap-3 p-3 sm:grid-cols-3"
    >
      <Field label={t("work.project.name")} htmlFor="np-name">
        <Input id="np-name" value={f.name} maxLength={120} required onChange={set("name")} />
      </Field>
      <Field label={t("work.project.template")} htmlFor="np-template" hint={t("work.project.templateHint")}>
        <Select id="np-template" value={f.template} onChange={set("template")}>
          {templates.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.project.status")} htmlFor="np-status">
        <Select id="np-status" value={f.status} onChange={set("status")}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`work.projectStatus.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.project.owner")} htmlFor="np-owner">
        <PersonSelect id="np-owner" people={people} value={f.ownerId} onChange={(v) => setF((p) => ({ ...p, ownerId: v }))} emptyLabel={t("work.none")} />
      </Field>
      <Field label={t("work.project.startDate")} htmlFor="np-start" hint={t("work.project.startHint")}>
        <Input id="np-start" type="date" value={f.startDate} onChange={set("startDate")} />
      </Field>
      <Field label={t("work.project.dueDate")} htmlFor="np-due">
        <Input id="np-due" type="date" value={f.dueDate} onChange={set("dueDate")} />
      </Field>
      <Field label={t("work.project.budgetIn", { currency })} htmlFor="np-budget">
        <Input id="np-budget" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" value={f.budget} onChange={set("budget")} />
      </Field>
      <Field label={t("work.project.members")} htmlFor="np-members" hint={t("work.project.membersHint")} className="sm:col-span-2">
        <select
          id="np-members"
          multiple
          className="min-h-20 w-full rounded-md border border-input bg-surface px-2 py-1 text-sm"
          value={members}
          onChange={(e) => setMembers([...e.target.selectedOptions].map((o) => o.value))}
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="sm:col-span-3">
        <Field label={t("work.project.description")} htmlFor="np-desc">
          <Textarea id="np-desc" rows={2} value={f.description} maxLength={5000} onChange={set("description")} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
        <Button type="submit" disabled={busy || !f.name.trim()}>
          <Plus aria-hidden />
          {t("work.project.create")}
        </Button>
      </div>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

export interface ProjectEditValues {
  name: string;
  description: string;
  status: string;
  health: string;
  ownerId: string;
  startDate: string;
  dueDate: string;
  budget: string;
}

export function EditProjectForm({ base, projectId, people, initial, currency }: { base: string; projectId: string; people: Person[]; initial: ProjectEditValues; currency: string }) {
  const t = useT();
  const [f, setF] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const set = (k: keyof ProjectEditValues) => (e: { target: { value: string } }) => (setSaved(false), setF((p) => ({ ...p, [k]: e.target.value })));
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/projects/${projectId}`, { method: "PATCH", body: f }), () => setSaved(true));
      }}
      className="grid gap-3 sm:grid-cols-4"
    >
      <Field label={t("work.project.name")} htmlFor="ep-name" className="sm:col-span-2">
        <Input id="ep-name" value={f.name} maxLength={120} required onChange={set("name")} />
      </Field>
      <Field label={t("work.project.status")} htmlFor="ep-status">
        <Select id="ep-status" value={f.status} onChange={set("status")}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`work.projectStatus.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.project.health")} htmlFor="ep-health">
        <Select id="ep-health" value={f.health} onChange={set("health")}>
          {HEALTH.map((s) => (
            <option key={s} value={s}>
              {t(`work.health.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.project.owner")} htmlFor="ep-owner">
        <PersonSelect id="ep-owner" people={people} value={f.ownerId} onChange={(v) => (setSaved(false), setF((p) => ({ ...p, ownerId: v })))} emptyLabel={t("work.none")} />
      </Field>
      <Field label={t("work.project.startDate")} htmlFor="ep-start">
        <Input id="ep-start" type="date" value={f.startDate} onChange={set("startDate")} />
      </Field>
      <Field label={t("work.project.dueDate")} htmlFor="ep-due">
        <Input id="ep-due" type="date" value={f.dueDate} onChange={set("dueDate")} />
      </Field>
      <Field label={t("work.project.budgetIn", { currency })} htmlFor="ep-budget">
        <Input id="ep-budget" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" value={f.budget} onChange={set("budget")} />
      </Field>
      <div className="sm:col-span-4">
        <Field label={t("work.project.description")} htmlFor="ep-desc">
          <Textarea id="ep-desc" rows={3} value={f.description} maxLength={5000} onChange={set("description")} />
        </Field>
      </div>
      <div className="flex items-center gap-2 sm:col-span-4">
        <Button type="submit" variant="secondary" disabled={busy || !f.name.trim()}>
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

export function MemberForm({ base, projectId, people, currency }: { base: string; projectId: string; people: Person[]; currency: string }) {
  const t = useT();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");
  const [rate, setRate] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/projects/${projectId}/members`, { body: { userId, role, hourlyRate: rate } }), () => (setUserId(""), setRole(""), setRate("")));
      }}
      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_9rem_auto] sm:items-end"
    >
      <Field label={t("work.member.person")} htmlFor="mf-user">
        <PersonSelect id="mf-user" people={people} value={userId} onChange={setUserId} emptyLabel={t("work.member.choose")} />
      </Field>
      <Field label={t("work.member.role")} htmlFor="mf-role">
        <Input id="mf-role" value={role} maxLength={80} onChange={(e) => setRole(e.target.value)} />
      </Field>
      <Field label={t("work.member.rate", { currency })} htmlFor="mf-rate">
        <Input id="mf-rate" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" value={rate} onChange={(e) => setRate(e.target.value)} />
      </Field>
      <Button type="submit" variant="secondary" disabled={busy || !userId}>
        <Plus aria-hidden />
        {t("work.member.add")}
      </Button>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function MilestoneForm({ base, projectId }: { base: string; projectId: string }) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/projects/${projectId}/milestones`, { body: { title, dueDate } }), () => (setTitle(""), setDueDate("")));
      }}
      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end"
    >
      <Field label={t("work.milestone.title")} htmlFor="ms-title">
        <Input id="ms-title" value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={t("work.dueDate")} htmlFor="ms-due">
        <Input id="ms-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </Field>
      <Button type="submit" variant="secondary" disabled={busy || !title.trim()}>
        <Plus aria-hidden />
        {t("work.milestone.add")}
      </Button>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function MilestoneActions({ base, milestoneId, done }: { base: string; milestoneId: string; done: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <span className="flex items-center gap-1">
      <Button size="sm" variant="ghost" disabled={busy} title={done ? t("work.reopen") : t("work.markDone")} aria-label={done ? t("work.reopen") : t("work.markDone")} onClick={() => void run(() => api(`${base}/milestones/${milestoneId}`, { method: "PATCH", body: { done: !done } }))}>
        {done ? <Undo2 aria-hidden /> : <Check aria-hidden />}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        title={t("work.delete")}
        aria-label={t("work.delete")}
        onClick={() => window.confirm(t("work.confirmDelete")) && void run(() => api(`${base}/milestones/${milestoneId}`, { method: "DELETE" }))}
      >
        <Trash2 aria-hidden />
      </Button>
      <FormError error={error} />
    </span>
  );
}

export interface RiskValues {
  title: string;
  description: string;
  probability: number;
  impact: number;
  mitigation: string;
  ownerId: string;
  status: string;
}

export function RiskForm({ base, projectId, riskId, people, initial, onDone }: { base: string; projectId: string; riskId?: string; people: Person[]; initial?: RiskValues; onDone?: () => void }) {
  const t = useT();
  const empty: RiskValues = { title: "", description: "", probability: 3, impact: 3, mitigation: "", ownerId: "", status: "OPEN" };
  const [f, setF] = useState<RiskValues>(initial ?? empty);
  const { busy, error, run } = useAction();
  const set = (k: keyof RiskValues) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: k === "probability" || k === "impact" ? Number(e.target.value) : e.target.value }));
  const id = riskId ?? "new";
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(
          () => (riskId ? api(`${base}/risks/${riskId}`, { method: "PATCH", body: f }) : api(`${base}/projects/${projectId}/risks`, { body: f })),
          () => (riskId ? onDone?.() : setF(empty)),
        );
      }}
      className="grid gap-2 sm:grid-cols-4"
    >
      <Field label={t("work.risk.title")} htmlFor={`rk-title-${id}`} className="sm:col-span-2">
        <Input id={`rk-title-${id}`} value={f.title} maxLength={200} required onChange={set("title")} />
      </Field>
      <Field label={t("work.risk.probability")} htmlFor={`rk-p-${id}`}>
        <Select id={`rk-p-${id}`} value={f.probability} onChange={set("probability")}>
          {SCALE.map((n) => (
            <option key={n} value={n}>
              {n} · {t(`work.risk.scaleP.${n}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.risk.impact")} htmlFor={`rk-i-${id}`}>
        <Select id={`rk-i-${id}`} value={f.impact} onChange={set("impact")}>
          {SCALE.map((n) => (
            <option key={n} value={n}>
              {n} · {t(`work.risk.scaleI.${n}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.risk.owner")} htmlFor={`rk-owner-${id}`}>
        <PersonSelect id={`rk-owner-${id}`} people={people} value={f.ownerId} onChange={(v) => setF((p) => ({ ...p, ownerId: v }))} emptyLabel={t("work.none")} />
      </Field>
      <Field label={t("work.risk.status")} htmlFor={`rk-status-${id}`}>
        <Select id={`rk-status-${id}`} value={f.status} onChange={set("status")}>
          {RISK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`work.riskStatus.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("work.risk.mitigation")} htmlFor={`rk-mit-${id}`} className="sm:col-span-2">
        <Input id={`rk-mit-${id}`} value={f.mitigation} maxLength={4000} onChange={set("mitigation")} />
      </Field>
      <Field label={t("work.risk.description")} htmlFor={`rk-desc-${id}`} className="sm:col-span-4">
        <Textarea id={`rk-desc-${id}`} rows={2} value={f.description} maxLength={4000} onChange={set("description")} />
      </Field>
      <div className="flex gap-2 sm:col-span-4">
        <Button type="submit" variant="secondary" disabled={busy || !f.title.trim()}>
          {riskId ? t("common.save") : (
            <>
              <Plus aria-hidden />
              {t("work.risk.add")}
            </>
          )}
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

/** Risk row actions: edit inline or delete. */
export function RiskEditor({ base, projectId, riskId, people, initial }: { base: string; projectId: string; riskId: string; people: Person[]; initial: RiskValues }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();
  if (open) return <div className="w-full rounded-md border p-3"><RiskForm base={base} projectId={projectId} riskId={riskId} people={people} initial={initial} onDone={() => setOpen(false)} /></div>;
  return (
    <span className="flex items-center gap-1">
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {t("work.edit")}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} title={t("work.delete")} aria-label={t("work.delete")} onClick={() => window.confirm(t("work.confirmDelete")) && void run(() => api(`${base}/risks/${riskId}`, { method: "DELETE" }))}>
        <Trash2 aria-hidden />
      </Button>
      <FormError error={error} />
    </span>
  );
}

export function ExpenseForm({ base, projectId, currency }: { base: string; projectId: string; currency: string }) {
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ description: "", amount: "", incurredOn: today });
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/projects/${projectId}/expenses`, { body: f }), () => setF({ description: "", amount: "", incurredOn: today }));
      }}
      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_10rem_auto] sm:items-end"
    >
      <Field label={t("work.expense.description")} htmlFor="ex-desc">
        <Input id="ex-desc" value={f.description} maxLength={300} required onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} />
      </Field>
      <Field label={t("work.expense.amount", { currency })} htmlFor="ex-amount">
        <Input id="ex-amount" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" required value={f.amount} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} />
      </Field>
      <Field label={t("work.expense.date")} htmlFor="ex-date">
        <Input id="ex-date" type="date" required value={f.incurredOn} onChange={(e) => setF((p) => ({ ...p, incurredOn: e.target.value }))} />
      </Field>
      <Button type="submit" variant="secondary" disabled={busy || !f.description.trim() || !f.amount}>
        <Plus aria-hidden />
        {t("work.expense.add")}
      </Button>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function SaveTemplateForm({ base, projectId, locale }: { base: string; projectId: string; locale: string }) {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/projects/${projectId}/template`, { body: { name, description } }), () => router.push(`/${locale}/projects/templates`));
      }}
      className="grid gap-2 sm:grid-cols-[14rem_minmax(0,1fr)_auto] sm:items-end"
    >
      <Field label={t("work.template.name")} htmlFor="st-name">
        <Input id="st-name" value={name} maxLength={120} required onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("work.template.description")} htmlFor="st-desc">
        <Input id="st-desc" value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Button type="submit" variant="secondary" disabled={busy || !name.trim()}>
        {t("work.template.save")}
      </Button>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}
