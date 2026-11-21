"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Check, GitMerge, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";

export const STAGES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"] as const;
const ACTIVITY_TYPES = ["CALL", "EMAIL", "MEETING", "NOTE", "TASK"] as const;

interface FieldDef {
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "DATE" | "SELECT";
  options: string[];
  required: boolean;
}
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;

export interface Owner {
  id: string;
  name: string;
}

export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run<R>(fn: () => Promise<R>, after?: (r: R) => void) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      after?.(r);
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

const isDuplicate = (err: unknown) => err instanceof ApiError && err.details?.reason === "lead_duplicate";

export function OwnerSelect({ id, owners, value, onChange, allowEmpty = true, className }: { id?: string; owners: Owner[]; value: string; onChange: (v: string) => void; allowEmpty?: boolean; className?: string }) {
  const t = useT();
  return (
    <Select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty ? <option value="">{t("crm.unassigned")}</option> : null}
      {owners.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </Select>
  );
}

export function NewLeadForm({ base, locale, owners, viewerId, sources = [], fields = [] }: { base: string; locale: string; owners: Owner[]; viewerId: string; sources?: string[]; fields?: FieldDef[] }) {
  const t = useT();
  const empty = { name: "", email: "", phone: "", account: "", source: "", value: "", notes: "", expectedCloseDate: "", probability: "", territory: "", tags: "", ownerId: owners.some((o) => o.id === viewerId) ? viewerId : "" };
  const [f, setF] = useState(empty);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const create = (allowDuplicate: boolean) =>
    run(
      () =>
        api(`${base}/leads`, {
          body: {
            ...f,
            tags: f.tags
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
            customFields: custom,
            probability: f.probability === "" ? undefined : Number(f.probability),
            allowDuplicate,
          },
        }),
      () => (setF(empty), setCustom({})),
    );
  const dupIds = isDuplicate(error) ? (((error as ApiError).details?.leadIds as string[] | undefined) ?? []) : [];
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void create(false);
      }}
      className="grid gap-2 border-b p-3 sm:grid-cols-3"
    >
      <Field label={t("crm.name")} htmlFor="lead-name">
        <Input id="lead-name" value={f.name} maxLength={200} required onChange={set("name")} />
      </Field>
      <Field label={t("crm.email")} htmlFor="lead-email">
        <Input id="lead-email" type="email" value={f.email} maxLength={254} onChange={set("email")} />
      </Field>
      <Field label={t("crm.phone")} htmlFor="lead-phone">
        <Input id="lead-phone" type="tel" value={f.phone} maxLength={40} onChange={set("phone")} />
      </Field>
      <Field label={t("crm.account")} htmlFor="lead-account">
        <Input id="lead-account" value={f.account} maxLength={200} onChange={set("account")} />
      </Field>
      <Field label={t("crm.source")} htmlFor="lead-source">
        <Input id="lead-source" value={f.source} maxLength={100} list="lead-source-list" placeholder={t("crm.sourcePlaceholder")} onChange={set("source")} />
        <datalist id="lead-source-list">
          {sources.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      <Field label={t("crm.owner")} htmlFor="lead-owner">
        <OwnerSelect id="lead-owner" owners={owners} value={f.ownerId} onChange={(v) => setF((p) => ({ ...p, ownerId: v }))} />
      </Field>
      <Field label={t("crm.value")} htmlFor="lead-value">
        <Input id="lead-value" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" value={f.value} onChange={set("value")} />
      </Field>
      <Field label={t("crm.probability")} htmlFor="lead-probability" hint={t("crm.probabilityHint")}>
        <Input id="lead-probability" type="number" min={0} max={100} step={1} value={f.probability} onChange={set("probability")} />
      </Field>
      <Field label={t("crm.expectedClose")} htmlFor="lead-close">
        <Input id="lead-close" type="date" value={f.expectedCloseDate} onChange={set("expectedCloseDate")} />
      </Field>
      <Field label={t("crm.fields.territory")} htmlFor="lead-territory">
        <Input id="lead-territory" value={f.territory} maxLength={100} onChange={set("territory")} />
      </Field>
      <Field label={t("crm.fields.tags")} htmlFor="lead-tags">
        <Input id="lead-tags" value={f.tags} maxLength={600} placeholder={t("crm.tagsPlaceholder")} onChange={set("tags")} />
      </Field>
      {fields.map((d) => (
        <Field key={d.key} label={d.required ? `${d.label} *` : d.label} htmlFor={`lead-cf-${d.key}`}>
          {d.type === "SELECT" ? (
            <Select id={`lead-cf-${d.key}`} value={custom[d.key] ?? ""} required={d.required} onChange={(e) => setCustom((c) => ({ ...c, [d.key]: e.target.value }))}>
              <option value="">{t("common.none")}</option>
              {d.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id={`lead-cf-${d.key}`}
              type={d.type === "NUMBER" ? "number" : d.type === "DATE" ? "date" : "text"}
              step="any"
              value={custom[d.key] ?? ""}
              required={d.required}
              maxLength={1000}
              onChange={(e) => setCustom((c) => ({ ...c, [d.key]: e.target.value }))}
            />
          )}
        </Field>
      ))}
      <div className="sm:col-span-3">
        <Field label={t("crm.notes")} htmlFor="lead-notes">
          <Textarea id="lead-notes" rows={2} value={f.notes} maxLength={5000} onChange={set("notes")} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
        <Button type="submit" disabled={busy || !f.name.trim()}>
          <Plus aria-hidden />
          {t("crm.addLead")}
        </Button>
        {dupIds.length ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void create(true)}>
            {t("crm.createAnyway")}
          </Button>
        ) : null}
        {dupIds.map((id) => (
          <Link key={id} href={`/${locale}/crm/${id}`} className="text-xs text-muted-foreground hover:underline">
            {t("crm.viewExisting")}
          </Link>
        ))}
      </div>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function LeadStageSelect({ base, leadId, stage }: { base: string; leadId: string; stage: string }) {
  const t = useT();
  const { busy, run } = useAction();
  return (
    <Select
      aria-label={t("crm.stage")}
      className="h-8 w-auto text-xs"
      value={stage}
      disabled={busy}
      onChange={(e) => void run(() => api(`${base}/leads/${leadId}`, { method: "PATCH", body: { stage: e.target.value } }))}
    >
      {STAGES.map((s) => (
        <option key={s} value={s}>
          {t(`crm.stages.${s}`)}
        </option>
      ))}
    </Select>
  );
}

export function CompleteFollowUpButton({ base, followUpId }: { base: string; followUpId: string }) {
  const t = useT();
  const { busy, run } = useAction();
  return (
    <Button size="sm" variant="ghost" disabled={busy} aria-label={t("crm.complete")} title={t("crm.complete")} onClick={() => void run(() => api(`${base}/follow-ups/${followUpId}/complete`, { body: {} }))}>
      <Check aria-hidden />
    </Button>
  );
}

export function NewFollowUpForm({ base, leadId }: { base: string; leadId: string }) {
  const t = useT();
  const [dueAt, setDueAt] = useState("");
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("MEDIUM");
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/leads/${leadId}/follow-ups`, { body: { dueAt, note, priority } }), () => (setDueAt(""), setNote(""), setPriority("MEDIUM")));
      }}
      className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_8rem_auto] sm:items-end"
    >
      <Field label={t("crm.dueDate")} htmlFor="fu-date">
        <Input id="fu-date" type="date" value={dueAt} required onChange={(e) => setDueAt(e.target.value)} />
      </Field>
      <Field label={t("crm.followUpNote")} htmlFor="fu-note">
        <Input id="fu-note" value={note} maxLength={1000} required placeholder={t("crm.followUpPlaceholder")} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Field label={t("crm.priority")} htmlFor="fu-priority">
        <Select id="fu-priority" value={priority} onChange={(e) => setPriority(e.target.value as (typeof PRIORITIES)[number])}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`crm.priorities.${p}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" variant="secondary" disabled={busy || !dueAt || !note.trim()}>
        <Plus aria-hidden />
        {t("crm.addFollowUp")}
      </Button>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function LeadNotesForm({ base, leadId, notes }: { base: string; leadId: string; notes: string }) {
  const t = useT();
  const [value, setValue] = useState(notes);
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/leads/${leadId}`, { method: "PATCH", body: { notes: value } }));
      }}
      className="grid gap-2"
    >
      <Field label={t("crm.notes")} htmlFor="lead-notes-edit">
        <Textarea id="lead-notes-edit" rows={4} value={value} maxLength={5000} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" disabled={busy || value === notes}>
          {t("common.save")}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => void run(() => api(`${base}/leads/${leadId}`, { method: "PATCH", body: { contacted: true } }))}>
          {t("crm.markContacted")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

/** Owner and deal fields: value, probability, expected close date. */
export function DealForm({
  base,
  leadId,
  owners,
  initial,
}: {
  base: string;
  leadId: string;
  owners: Owner[];
  initial: { ownerId: string; value: string; probability: string; expectedCloseDate: string };
}) {
  const t = useT();
  const [f, setF] = useState(initial);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof initial) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() =>
          api(`${base}/leads/${leadId}`, {
            method: "PATCH",
            body: { ownerId: f.ownerId || null, value: f.value || null, probability: f.probability === "" ? null : Number(f.probability), expectedCloseDate: f.expectedCloseDate || null },
          }),
        );
      }}
      className="grid gap-2 sm:grid-cols-4 sm:items-end"
    >
      <Field label={t("crm.owner")} htmlFor="deal-owner">
        <OwnerSelect id="deal-owner" owners={owners} value={f.ownerId} onChange={(v) => setF((p) => ({ ...p, ownerId: v }))} />
      </Field>
      <Field label={t("crm.value")} htmlFor="deal-value">
        <Input id="deal-value" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" value={f.value} onChange={set("value")} />
      </Field>
      <Field label={t("crm.probability")} htmlFor="deal-probability">
        <Input id="deal-probability" type="number" min={0} max={100} step={1} value={f.probability} placeholder={t("crm.stageDefault")} onChange={set("probability")} />
      </Field>
      <Field label={t("crm.expectedClose")} htmlFor="deal-close">
        <Input id="deal-close" type="date" value={f.expectedCloseDate} onChange={set("expectedCloseDate")} />
      </Field>
      <div className="sm:col-span-4">
        <Button type="submit" variant="secondary" disabled={busy || !dirty}>
          {t("common.save")}
        </Button>
      </div>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function ActivityForm({ base, leadId }: { base: string; leadId: string }) {
  const t = useT();
  const [type, setType] = useState<(typeof ACTIVITY_TYPES)[number]>("CALL");
  const [summary, setSummary] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(
          () => api(`${base}/leads/${leadId}/activities`, { body: { type, summary, occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined } }),
          () => (setSummary(""), setOccurredAt("")),
        );
      }}
      className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_13rem] sm:items-end"
    >
      <Field label={t("crm.activityType")} htmlFor="act-type">
        <Select id="act-type" value={type} onChange={(e) => setType(e.target.value as (typeof ACTIVITY_TYPES)[number])}>
          {ACTIVITY_TYPES.map((a) => (
            <option key={a} value={a}>
              {t(`crm.activityTypes.${a}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("crm.activitySummary")} htmlFor="act-summary">
        <Input id="act-summary" value={summary} maxLength={5000} required placeholder={t("crm.activityPlaceholder")} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <Field label={t("crm.occurredAt")} htmlFor="act-when" hint={t("crm.occurredAtHint")}>
        <Input id="act-when" type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
      </Field>
      <div className="sm:col-span-3">
        <Button type="submit" variant="secondary" disabled={busy || !summary.trim()}>
          <Plus aria-hidden />
          {t("crm.logActivity")}
        </Button>
      </div>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function MergeButton({ base, locale, primaryId, secondaryId, label }: { base: string; locale: string; primaryId: string; secondaryId: string; label: string }) {
  const t = useT();
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => {
          if (!window.confirm(t("crm.mergeConfirm", { name: label }))) return;
          void run(
            () => api(`${base}/leads/${primaryId}/merge`, { body: { secondaryId } }),
            () => router.replace(`/${locale}/crm/${primaryId}`),
          );
        }}
      >
        <GitMerge aria-hidden />
        {t("crm.mergeInto")}
      </Button>
      <FormError error={error} />
    </span>
  );
}

export function ArchiveLeadButton({ base, locale, leadId }: { base: string; locale: string; leadId: string }) {
  const t = useT();
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          if (!window.confirm(t("crm.archiveConfirm", { count: 1 }))) return;
          void run(
            () => api(`${base}/leads/bulk`, { body: { action: "archive", ids: [leadId] } }),
            () => router.replace(`/${locale}/crm`),
          );
        }}
      >
        <Archive aria-hidden />
        {t("crm.archive")}
      </Button>
      <FormError error={error} />
    </span>
  );
}

/** AI sales assistant: creates an agent task about this lead and opens it. */
export function LeadAssistant({ base, locale, leadId, hasEmail }: { base: string; locale: string; leadId: string; hasEmail: boolean }) {
  const t = useT();
  const router = useRouter();
  const [guidance, setGuidance] = useState("");
  const { busy, error, run } = useAction();
  const start = (mode: "brief" | "draft" | "send") =>
    run(
      () => api<{ id: string }>(`${base}/leads/${leadId}/assist`, { body: { mode, guidance: guidance.trim() || undefined } }),
      (task) => router.push(`/${locale}/tasks/${task.id}`),
    );
  return (
    <div className="grid gap-2">
      <Field label={t("crm.assistGuidance")} htmlFor="assist-guidance" hint={t("crm.assistHint")}>
        <Input id="assist-guidance" value={guidance} maxLength={1000} placeholder={t("crm.assistPlaceholder")} onChange={(e) => setGuidance(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => void start("brief")}>
          <Sparkles aria-hidden />
          {t("crm.assistBrief")}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void start("draft")}>
          {t("crm.assistDraft")}
        </Button>
        <Button type="button" variant="secondary" disabled={busy || !hasEmail} title={hasEmail ? undefined : t("crm.noEmail")} onClick={() => void start("send")}>
          {t("crm.assistSend")}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}
