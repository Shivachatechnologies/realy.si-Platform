"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./ui";

type Option = { id: string; name: string };
const TRIGGERS = ["manual", "form.submitted", "lead.created"] as const;

export function SequenceForm({ base, locale, forms, initial }: { base: string; locale: string; forms: Option[]; initial?: { id: string; name: string; description: string; trigger: string; triggerFormId: string } }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState(initial ?? { name: "", description: "", trigger: "form.submitted", triggerFormId: "" });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      className="grid gap-3 p-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        const body = { name: f.name, description: f.description, trigger: f.trigger, triggerFormId: f.trigger === "form.submitted" ? f.triggerFormId || null : null };
        void run(
          () => (initial ? api(`${base}/sequences/${initial.id}`, { method: "PATCH", body }) : api<{ id: string }>(`${base}/sequences`, { body })),
          (r) => !initial && router.push(`/${locale}/marketing/automation/${(r as { id: string }).id}`),
        );
      }}
    >
      <Field label={t("marketing.automation.name")} htmlFor="sq-name">
        <Input id="sq-name" value={f.name} maxLength={200} required onChange={set("name")} />
      </Field>
      <Field label={t("marketing.automation.trigger")} htmlFor="sq-trigger">
        <Select id="sq-trigger" value={f.trigger} onChange={set("trigger")}>
          {TRIGGERS.map((x) => (
            <option key={x} value={x}>
              {t(`marketing.automation.triggers.${x}`)}
            </option>
          ))}
        </Select>
      </Field>
      {f.trigger === "form.submitted" ? (
        <Field label={t("marketing.automation.form")} htmlFor="sq-form">
          <Select id="sq-form" value={f.triggerFormId} onChange={set("triggerFormId")}>
            <option value="">{t("marketing.automation.anyForm")}</option>
            {forms.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <div />
      )}
      <Field label={t("marketing.automation.description")} htmlFor="sq-desc" className="sm:col-span-3">
        <Input id="sq-desc" value={f.description} maxLength={2000} onChange={set("description")} />
      </Field>
      <p className="text-xs text-muted-foreground sm:col-span-3">{t("marketing.automation.consentNote")}</p>
      <div className="sm:col-span-3">
        <Button type="submit" size="sm" disabled={busy || !f.name.trim()}>
          {initial ? <Save aria-hidden /> : <Plus aria-hidden />}
          {initial ? t("common.save") : t("marketing.automation.create")}
        </Button>
      </div>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function StepForm({ base, sequenceId, initial }: { base: string; sequenceId: string; initial?: { id: string; delayHours: number; subject: string; body: string } }) {
  const t = useT();
  const empty = { delayHours: "24", subject: "", body: "" };
  const [f, setF] = useState(initial ? { delayHours: String(initial.delayHours), subject: initial.subject, body: initial.body } : empty);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const id = initial?.id ?? "new";
  return (
    <form
      className="grid gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const body = { delayHours: Number(f.delayHours || 0), subject: f.subject, body: f.body };
        void run(
          () => (initial ? api(`${base}/sequences/${sequenceId}/steps/${initial.id}`, { method: "PATCH", body }) : api(`${base}/sequences/${sequenceId}/steps`, { body })),
          () => !initial && setF(empty),
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label={t("marketing.automation.delayHours")} htmlFor={`st-delay-${id}`}>
          <Input id={`st-delay-${id}`} type="number" min={0} max={8760} required value={f.delayHours} onChange={set("delayHours")} />
        </Field>
        <Field label={t("marketing.email.subject")} htmlFor={`st-subject-${id}`}>
          <Input id={`st-subject-${id}`} value={f.subject} maxLength={250} required onChange={set("subject")} />
        </Field>
      </div>
      <Field label={t("marketing.email.body")} htmlFor={`st-body-${id}`} hint={t("marketing.email.mergeTags", { tags: "{{firstName}} {{email}} {{sender}}" })}>
        <Textarea id={`st-body-${id}`} rows={6} value={f.body} maxLength={50_000} required onChange={set("body")} />
      </Field>
      <div>
        <Button type="submit" size="sm" disabled={busy || !f.subject.trim() || !f.body.trim()}>
          {initial ? <Save aria-hidden /> : <Plus aria-hidden />}
          {initial ? t("common.save") : t("marketing.automation.addStep")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function EnrollForm({ base, sequenceId, segments }: { base: string; sequenceId: string; segments: Option[] }) {
  const t = useT();
  const [segmentId, setSegmentId] = useState(segments[0]?.id ?? "");
  const [result, setResult] = useState<{ enrolled: number; skipped: number } | null>(null);
  const { busy, error, run } = useAction();
  if (!segments.length) return <p className="p-4 text-xs text-muted-foreground">{t("marketing.audience.empty")}</p>;
  return (
    <form
      className="grid gap-2 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api<{ enrolled: number; skipped: number }>(`${base}/sequences/${sequenceId}/enrollments`, { body: { kind: "segment", segmentId } }), setResult);
      }}
    >
      <div className="flex gap-2">
        <Select value={segmentId} aria-label={t("marketing.email.segment")} onChange={(e) => setSegmentId(e.target.value)}>
          {segments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" className="h-9" disabled={busy || !segmentId}>
          <UserPlus aria-hidden />
          {t("marketing.automation.enroll")}
        </Button>
      </div>
      {result ? <p className="text-xs">{t("marketing.automation.enrolledResult", { enrolled: result.enrolled, skipped: result.skipped })}</p> : null}
      <FormError error={error} />
    </form>
  );
}
