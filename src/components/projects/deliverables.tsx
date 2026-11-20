"use client";

import { useState, type FormEvent } from "react";
import { Check, ExternalLink, Plus, Send, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { PersonSelect, useAction } from "@/components/work/actions";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export interface DeliverableRow {
  id: string;
  title: string;
  status: "PLANNED" | "IN_PROGRESS" | "SUBMITTED" | "ACCEPTED" | "REJECTED";
  ownerName: string | null;
  milestoneTitle: string | null;
  due: string | null;
  overdue: boolean;
  url: string | null;
  reviewNote: string | null;
}

const TONE = { PLANNED: "neutral", IN_PROGRESS: "accent", SUBMITTED: "info", ACCEPTED: "success", REJECTED: "danger" } as const;
const STEPS = ["PLANNED", "IN_PROGRESS", "SUBMITTED", "ACCEPTED"] as const;

/** Deliverables of a project: a four-step track per deliverable, submit with a link, accept / reject (managers). */
export function DeliverableList({ base, rows, manage }: { base: string; rows: DeliverableRow[]; manage: boolean }) {
  const t = useT();
  if (!rows.length) return <p className="text-sm text-muted-foreground">{t("projectsDeliverables.empty")}</p>;
  return (
    <ul className="grid gap-2">
      {rows.map((d) => (
        <DeliverableItem key={d.id} base={base} d={d} manage={manage} />
      ))}
    </ul>
  );
}

function DeliverableItem({ base, d, manage }: { base: string; d: DeliverableRow; manage: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [link, setLink] = useState(d.url ?? "");
  const [submitting, setSubmitting] = useState(false);
  const step = d.status === "REJECTED" ? 2 : STEPS.indexOf(d.status as (typeof STEPS)[number]);
  return (
    <li className="grid gap-2 rounded-lg border bg-surface/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-sm font-medium">{d.title}</span>
        <Badge tone={TONE[d.status]}>{t(`projectsDeliverables.status.${d.status}`)}</Badge>
      </div>
      <ol className="grid grid-cols-4 gap-1" aria-label={t(`projectsDeliverables.status.${d.status}`)}>
        {STEPS.map((s, i) => (
          <li key={s} className={cn("h-1.5 rounded-full", i <= step ? (d.status === "REJECTED" && i === step ? "bg-danger" : "bg-primary") : "bg-muted")} title={t(`projectsDeliverables.status.${s}`)} />
        ))}
      </ol>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{d.ownerName ?? t("projectsDeliverables.noOwner")}</span>
        {d.milestoneTitle ? <span>◆ {d.milestoneTitle}</span> : null}
        {d.due ? <span className={d.overdue ? "text-danger" : ""}>{t("projectsDeliverables.due", { date: d.due })}</span> : null}
        {d.url ? (
          <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            <ExternalLink className="size-3" aria-hidden />
            {t("projectsDeliverables.openResult")}
          </a>
        ) : null}
      </p>
      {d.reviewNote ? <p className="rounded-md bg-muted px-2 py-1 text-xs">{d.reviewNote}</p> : null}
      {manage ? (
        <div className="flex flex-wrap items-center gap-1">
          {d.status === "PLANNED" || d.status === "REJECTED" ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api(`${base}/deliverables/${d.id}`, { method: "PATCH", body: { status: "IN_PROGRESS" } }))}>
              {t("projectsDeliverables.start")}
            </Button>
          ) : null}
          {d.status !== "SUBMITTED" && d.status !== "ACCEPTED" ? (
            submitting ? (
              <form
                className="flex w-full flex-wrap items-center gap-1"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  void run(() => api(`${base}/deliverables/${d.id}`, { method: "PATCH", body: { status: "SUBMITTED", url: link } }), () => setSubmitting(false));
                }}
              >
                <Input type="url" required pattern="https://.*" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} className="min-w-0 flex-1" aria-label={t("projectsDeliverables.link")} />
                <Button size="sm" type="submit" disabled={busy || !link}>
                  <Send aria-hidden />
                  {t("projectsDeliverables.submit")}
                </Button>
              </form>
            ) : (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setSubmitting(true)}>
                <Send aria-hidden />
                {t("projectsDeliverables.submit")}
              </Button>
            )
          ) : null}
          {d.status === "SUBMITTED" ? (
            <>
              <Button size="sm" disabled={busy} onClick={() => void run(() => api(`${base}/deliverables/${d.id}/review`, { body: { accept: true } }))}>
                <Check aria-hidden />
                {t("projectsDeliverables.accept")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  const note = window.prompt(t("projectsDeliverables.rejectNote"));
                  if (note !== null) void run(() => api(`${base}/deliverables/${d.id}/review`, { body: { accept: false, note } }));
                }}
              >
                <X aria-hidden />
                {t("projectsDeliverables.reject")}
              </Button>
            </>
          ) : null}
          <Button size="sm" variant="ghost" disabled={busy} aria-label={t("work.delete")} title={t("work.delete")} onClick={() => window.confirm(t("work.confirmDelete")) && void run(() => api(`${base}/deliverables/${d.id}`, { method: "DELETE" }))}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      ) : null}
      <FormError error={error} />
    </li>
  );
}

export function DeliverableForm({ base, projectId, people, milestones }: { base: string; projectId: string; people: { id: string; name: string }[]; milestones: { id: string; title: string }[] }) {
  const t = useT();
  const empty = { title: "", ownerId: "", milestoneId: "", dueDate: "" };
  const [f, setF] = useState(empty);
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/projects/${projectId}/deliverables`, { body: f }), () => setF(empty));
      }}
      className="grid gap-2 border-t pt-3 sm:grid-cols-2"
    >
      <Field label={t("projectsDeliverables.title")} htmlFor="dl-title" className="sm:col-span-2">
        <Input id="dl-title" value={f.title} maxLength={200} required onChange={(e) => setF({ ...f, title: e.target.value })} />
      </Field>
      <Field label={t("projectsDeliverables.owner")} htmlFor="dl-owner">
        <PersonSelect id="dl-owner" people={people} value={f.ownerId} onChange={(v) => setF({ ...f, ownerId: v })} />
      </Field>
      <Field label={t("work.dueDate")} htmlFor="dl-due">
        <Input id="dl-due" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
      </Field>
      {milestones.length ? (
        <Field label={t("projectsDeliverables.milestone")} htmlFor="dl-ms" className="sm:col-span-2">
          <Select id="dl-ms" value={f.milestoneId} onChange={(e) => setF({ ...f, milestoneId: e.target.value })}>
            <option value="">{t("projectsDeliverables.noMilestone")}</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={busy || !f.title.trim()}>
          <Plus aria-hidden />
          {t("projectsDeliverables.add")}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <FormError error={error} />
      </div>
    </form>
  );
}
