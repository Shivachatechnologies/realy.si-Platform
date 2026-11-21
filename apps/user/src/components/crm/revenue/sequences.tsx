"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CheckSquare, Mail, Pause, Play, Plus, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "../kit";

export interface StepDraft {
  kind: "EMAIL" | "TASK";
  delayDays: number;
  subject: string;
  body: string;
}

/** Starter steps written in plain language (the user edits them before activating). */
export function starterSteps(t: (k: string) => string): StepDraft[] {
  return [
    { kind: "EMAIL", delayDays: 0, subject: t("crm.rev.seq.starter.s1"), body: t("crm.rev.seq.starter.b1") },
    { kind: "EMAIL", delayDays: 3, subject: t("crm.rev.seq.starter.s2"), body: t("crm.rev.seq.starter.b2") },
    { kind: "TASK", delayDays: 2, subject: "", body: t("crm.rev.seq.starter.t3") },
    { kind: "EMAIL", delayDays: 4, subject: t("crm.rev.seq.starter.s4"), body: t("crm.rev.seq.starter.b4") },
  ];
}

/** Create or edit a sequence: name + ordered steps (email / reminder) with waiting days. */
export function SequenceEditor({ base, locale, id, initial }: { base: string; locale: string; id?: string; initial?: { name: string; description: string; stopOnReply: boolean; steps: StepDraft[] } }) {
  const t = useT();
  const router = useRouter();
  const { busy, error, run } = useAction();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [stopOnReply, setStopOnReply] = useState(initial?.stopOnReply ?? true);
  const [steps, setSteps] = useState<StepDraft[]>(initial?.steps ?? starterSteps(t));
  const set = (i: number, patch: Partial<StepDraft>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) =>
    setSteps((s) => {
      const n = [...s];
      const [x] = n.splice(i, 1);
      n.splice(i + d, 0, x!);
      return n;
    });
  const dayAt = steps.map((_, i) => steps.slice(0, i + 1).reduce((sum, x) => sum + x.delayDays, 0));
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const payload = { name, description: description || undefined, stopOnReply, steps };
        void run(
          () => (id ? api(`${base}/crm/sequences/${id}`, { method: "PATCH", body: payload }) : api<{ id: string }>(`${base}/crm/sequences`, { body: payload })),
          (r) => (!id && r && typeof r === "object" && "id" in r ? router.push(`/${locale}/crm/sequences/${(r as { id: string }).id}`) : undefined),
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("crm.rev.seq.name")} htmlFor="s-name">
          <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder={t("crm.rev.seq.namePlaceholder")} />
        </Field>
        <Field label={t("crm.rev.seq.description")} htmlFor="s-desc">
          <Input id="s-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </Field>
      </div>
      <label className="flex min-h-9 items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={stopOnReply} onChange={(e) => setStopOnReply(e.target.checked)} />
        {t("crm.rev.seq.stopOnReply")}
      </label>
      <p className="text-xs text-muted-foreground">{t("crm.rev.seq.mergeHint")}</p>
      <ol className="relative grid gap-3 border-s-2 border-dashed border-primary/30 ps-5">
        {steps.map((s, i) => {
          return (
            <li key={i} className="relative grid gap-2 rounded-xl border bg-surface p-3 shadow-elev-1">
              <span aria-hidden className="absolute -start-[1.95rem] top-4 grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {i + 1}
              </span>
              <div className="flex flex-wrap items-end gap-2">
                <Field label={t("crm.rev.seq.kind")} htmlFor={`k-${i}`} className="w-40">
                  <Select id={`k-${i}`} value={s.kind} onChange={(e) => set(i, { kind: e.target.value as StepDraft["kind"] })}>
                    <option value="EMAIL">{t("crm.rev.seq.kinds.EMAIL")}</option>
                    <option value="TASK">{t("crm.rev.seq.kinds.TASK")}</option>
                  </Select>
                </Field>
                <Field label={t("crm.rev.seq.wait")} htmlFor={`d-${i}`} className="w-32">
                  <Input id={`d-${i}`} type="number" min={0} max={90} value={s.delayDays} onChange={(e) => set(i, { delayDays: Math.max(0, Math.min(90, Number(e.target.value) || 0)) })} />
                </Field>
                <span className="pb-2 text-xs text-muted-foreground">{t("crm.rev.seq.dayN", { day: dayAt[i]! })}</span>
                <div className="ms-auto flex gap-1">
                  <Button type="button" size="icon" variant="ghost" aria-label={t("crm.rev.seq.up")} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" aria-label={t("crm.rev.seq.down")} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" aria-label={t("crm.rev.seq.remove")} disabled={steps.length === 1} onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
              {s.kind === "EMAIL" ? (
                <Input aria-label={t("crm.rev.outreach.subject")} placeholder={t("crm.rev.outreach.subject")} value={s.subject} maxLength={200} required onChange={(e) => set(i, { subject: e.target.value })} />
              ) : null}
              <Textarea aria-label={s.kind === "EMAIL" ? t("crm.rev.outreach.body") : t("crm.rev.seq.taskNote")} placeholder={s.kind === "EMAIL" ? t("crm.rev.outreach.body") : t("crm.rev.seq.taskNote")} rows={s.kind === "EMAIL" ? 5 : 2} value={s.body} maxLength={10_000} required onChange={(e) => set(i, { body: e.target.value })} />
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={steps.length >= 10} onClick={() => setSteps((s) => [...s, { kind: "EMAIL", delayDays: 3, subject: "", body: "" }])}>
          <Plus aria-hidden />
          {t("crm.rev.seq.addStep")}
        </Button>
        <Button type="submit" disabled={busy} aria-busy={busy}>
          {t(id ? "crm.rev.save" : "crm.rev.seq.create")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

/** Activate (with an explicit choice about automatic sending), pause or archive. */
export function SequenceControls({ base, locale, id, status, canSend }: { base: string; locale: string; id: string; status: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED"; canSend: boolean }) {
  const t = useT();
  const router = useRouter();
  const { busy, error, run } = useAction();
  const [autoSend, setAutoSend] = useState(false);
  const post = (body: Record<string, unknown>, after?: () => void) => void run(() => api(`${base}/crm/sequences/${id}/status`, { body }), after);
  return (
    <div className="grid gap-3">
      {status !== "ACTIVE" ? (
        <div className="grid gap-2 rounded-lg border p-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4" checked={autoSend} disabled={!canSend} onChange={(e) => setAutoSend(e.target.checked)} />
            <span>
              <span className="font-medium">{t("crm.rev.seq.autoSend")}</span>
              <span className="block text-muted-foreground">{t(canSend ? "crm.rev.seq.autoSendHint" : "crm.rev.seq.autoSendNoChannel")}</span>
            </span>
          </label>
          <Button
            type="button"
            variant="luminous"
            disabled={busy}
            onClick={() => {
              if (autoSend && !window.confirm(t("crm.rev.seq.confirmAuto"))) return;
              post({ status: "ACTIVE", autoSend });
            }}
          >
            <Play aria-hidden />
            {t("crm.rev.seq.activate")}
          </Button>
        </div>
      ) : (
        <Button type="button" variant="secondary" disabled={busy} onClick={() => post({ status: "PAUSED" })}>
          <Pause aria-hidden />
          {t("crm.rev.seq.pause")}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          if (!window.confirm(t("crm.rev.seq.confirmArchive"))) return;
          post({ status: "ARCHIVED" }, () => router.push(`/${locale}/crm/sequences`));
        }}
      >
        <Trash2 aria-hidden />
        {t("crm.rev.seq.archive")}
      </Button>
      <FormError error={error} />
    </div>
  );
}

export interface PersonOption {
  id: string;
  type: "lead" | "contact";
  label: string;
}

/** Pick leads/contacts (with an email) to enroll. */
export function EnrollPicker({ base, id, people }: { base: string; id: string; people: PersonOption[] }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ enrolled: number; skipped: number } | null>(null);
  const shown = people.filter((p) => !q || p.label.toLowerCase().includes(q.toLowerCase())).slice(0, 100);
  const toggle = (k: string) => setPicked((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));
  return (
    <div className="grid gap-3">
      <Input aria-label={t("crm.search")} placeholder={t("crm.rev.seq.searchPeople")} value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="grid max-h-72 gap-1 overflow-y-auto rounded-lg border p-1">
        {shown.map((p) => {
          const k = `${p.type}:${p.id}`;
          return (
            <li key={k}>
              <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-muted">
                <input type="checkbox" className="size-4" checked={picked.has(k)} onChange={() => toggle(k)} />
                <span className="truncate text-sm">{p.label}</span>
                <span className="ms-auto text-xs text-muted-foreground">{t(`crm.rev.outreach.groups.${p.type}`)}</span>
              </label>
            </li>
          );
        })}
        {!shown.length ? <li className="p-3 text-sm text-muted-foreground">{t("crm.rev.seq.noPeople")}</li> : null}
      </ul>
      <Button
        type="button"
        disabled={!picked.size || busy}
        onClick={() => {
          const ids = [...picked];
          void run(
            () =>
              api<{ enrolled: number; skipped: number }>(`${base}/crm/sequences/${id}/enroll`, {
                body: { leadIds: ids.filter((x) => x.startsWith("lead:")).map((x) => x.slice(5)), contactIds: ids.filter((x) => x.startsWith("contact:")).map((x) => x.slice(8)) },
              }),
            (r) => {
              setResult(r);
              setPicked(new Set());
            },
          );
        }}
      >
        <UserPlus aria-hidden />
        {t("crm.rev.seq.enroll", { count: picked.size })}
      </Button>
      {result ? <p role="status" className="text-sm text-success">{t("crm.rev.seq.enrolled", { enrolled: result.enrolled, skipped: result.skipped })}</p> : null}
      <FormError error={error} />
    </div>
  );
}

/** Enroll one record into a sequence (from a lead/contact page). */
export function EnrollOne({ base, sequences, leadId, contactId }: { base: string; sequences: { id: string; name: string }[]; leadId?: string; contactId?: string }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [seq, setSeq] = useState(sequences[0]?.id ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  if (!sequences.length) return <p className="text-sm text-muted-foreground">{t("crm.rev.seq.noneActive")}</p>;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Select aria-label={t("crm.rev.seq.pick")} value={seq} onChange={(e) => setSeq(e.target.value)} className="min-w-0 flex-1">
          {sequences.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          disabled={!seq || busy}
          onClick={() =>
            void run(
              () => api<{ enrolled: number }>(`${base}/crm/sequences/${seq}/enroll`, { body: leadId ? { leadIds: [leadId] } : { contactIds: [contactId] } }),
              (r) => setMsg(r.enrolled ? t("crm.rev.seq.enrolledOne") : t("crm.rev.seq.alreadyIn")),
            )
          }
        >
          <UserPlus aria-hidden />
          {t("crm.rev.seq.start")}
        </Button>
      </div>
      {msg ? <p role="status" className="text-sm text-muted-foreground">{msg}</p> : null}
      <FormError error={error} />
    </div>
  );
}

export function StopEnrollmentButton({ base, id }: { base: string; id: string }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <span className="inline-flex flex-col">
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api(`${base}/crm/enrollments/${id}`, { method: "DELETE" }))}>
        <X aria-hidden />
        {t("crm.rev.seq.stop")}
      </Button>
      <FormError error={error} />
    </span>
  );
}

export const STEP_ICON = { EMAIL: Mail, TASK: CheckSquare } as const;
