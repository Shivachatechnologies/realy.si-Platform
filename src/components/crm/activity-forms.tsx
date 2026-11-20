"use client";

import { useRef, useState, type FormEvent } from "react";
import { Paperclip, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { OwnerPicker, useAction, type Owner } from "./kit";

/** Log activities, add follow-ups and upload attachments on contacts, accounts, deals (attachments: leads too). */

const TYPES = ["CALL", "EMAIL", "MEETING", "NOTE", "TASK"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
const MAX_BYTES = 5 * 1024 * 1024;

export function CrmActivityForm({ base, subjectType, subjectId }: { base: string; subjectType: "contact" | "account" | "deal"; subjectId: string }) {
  const t = useT();
  const [type, setType] = useState<(typeof TYPES)[number]>("CALL");
  const [subject, setSubject] = useState("");
  const [summary, setSummary] = useState("");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(
          () =>
            api(`${base}/crm/activities`, {
              body: {
                subjectType,
                subjectId,
                type,
                subject: subject.trim() || undefined,
                summary,
                occurredAt: when ? new Date(when).toISOString() : undefined,
                durationMin: duration ? Number(duration) : undefined,
              },
            }),
          () => (setSummary(""), setSubject(""), setWhen(""), setDuration("")),
        );
      }}
      className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_13rem_6rem] sm:items-end"
    >
      <Field label={t("crm.activityType")} htmlFor="ca-type">
        <Select id="ca-type" value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}>
          {TYPES.map((a) => (
            <option key={a} value={a}>
              {t(`crm.activityTypes.${a}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("crm.activities.subject")} htmlFor="ca-subject">
        <Input id="ca-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <Field label={t("crm.occurredAt")} htmlFor="ca-when" hint={t("crm.occurredAtHint")}>
        <Input id="ca-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </Field>
      <Field label={t("crm.activities.duration")} htmlFor="ca-dur">
        <Input id="ca-dur" type="number" min={0} max={1440} value={duration} onChange={(e) => setDuration(e.target.value)} />
      </Field>
      <div className="sm:col-span-4">
        <Field label={t("crm.activitySummary")} htmlFor="ca-summary">
          <Input id="ca-summary" value={summary} maxLength={5000} required placeholder={t("crm.activityPlaceholder")} onChange={(e) => setSummary(e.target.value)} />
        </Field>
      </div>
      <div className="sm:col-span-4">
        <Button type="submit" variant="secondary" disabled={busy || !summary.trim()}>
          <Plus aria-hidden />
          {t("crm.logActivity")}
        </Button>
      </div>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function CrmFollowUpForm({ base, subjectType, subjectId, owners, defaultAssignee }: { base: string; subjectType: "contact" | "account" | "deal"; subjectId: string; owners: Owner[]; defaultAssignee?: string }) {
  const t = useT();
  const [dueAt, setDueAt] = useState("");
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("MEDIUM");
  const [assigneeId, setAssigneeId] = useState(defaultAssignee ?? "");
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(
          () => api(`${base}/crm/follow-ups`, { body: { subjectType, subjectId, dueAt: dueAt.length > 10 ? new Date(dueAt).toISOString() : dueAt, note, priority, assigneeId } }),
          () => (setDueAt(""), setNote("")),
        );
      }}
      className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_8rem_10rem_auto] sm:items-end"
    >
      <Field label={t("crm.dueDate")} htmlFor="cf-date">
        <Input id="cf-date" type="datetime-local" value={dueAt} required onChange={(e) => setDueAt(e.target.value)} />
      </Field>
      <Field label={t("crm.followUpNote")} htmlFor="cf-note">
        <Input id="cf-note" value={note} maxLength={1000} required placeholder={t("crm.followUpPlaceholder")} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Field label={t("crm.priority")} htmlFor="cf-priority">
        <Select id="cf-priority" value={priority} onChange={(e) => setPriority(e.target.value as (typeof PRIORITIES)[number])}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`crm.priorities.${p}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("crm.followUpAssignee")} htmlFor="cf-assignee">
        <OwnerPicker id="cf-assignee" owners={owners} value={assigneeId} onChange={setAssigneeId} emptyLabel={t("crm.followUpRecordOwner")} />
      </Field>
      <Button type="submit" variant="secondary" disabled={busy || !dueAt || !note.trim()}>
        <Plus aria-hidden />
        {t("crm.addFollowUp")}
      </Button>
      <div className="sm:col-span-5">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function FollowUpToggle({ base, id, completed }: { base: string; id: string; completed: boolean }) {
  const t = useT();
  const { busy, run } = useAction();
  return (
    <input
      type="checkbox"
      className="size-4 accent-primary"
      checked={completed}
      disabled={busy}
      aria-label={t("crm.complete")}
      onChange={() => void run(() => api(`${base}/crm/follow-ups/${id}`, { method: "PATCH", body: { completed: !completed } }))}
    />
  );
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function AttachmentUpload({ base, subjectType, subjectId }: { base: string; subjectType: "lead" | "contact" | "account" | "deal"; subjectId: string }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          className="sr-only"
          id={`att-${subjectId}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setTooLarge(file.size > MAX_BYTES);
            if (file.size > MAX_BYTES) return;
            void run(async () => api(`${base}/crm/attachments`, { body: { subjectType, subjectId, name: file.name, mimeType: file.type || "application/octet-stream", data: await toBase64(file) } }));
          }}
        />
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
          <Paperclip aria-hidden />
          {busy ? t("crm.attachments.uploading") : t("crm.attachments.upload")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("crm.attachments.limit")}</span>
      </div>
      {tooLarge ? <p className="text-xs text-danger">{t("errors.reasons.crm_attachment_too_large")}</p> : null}
      <FormError error={error instanceof ApiError ? error : error ? new ApiError("internal_error", String(error)) : null} />
    </div>
  );
}
