"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Pause, Play, Plus, RotateCcw, Sparkles, X, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./use-action";

export function NewWorkflowForm({ base, locale, templates, defaultTemplate }: { base: string; locale: string; templates: { key: string; name: string }[]; defaultTemplate?: string }) {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState(defaultTemplate ? (templates.find((x) => x.key === defaultTemplate)?.name ?? "") : "");
  const [description, setDescription] = useState("");
  const [templateKey, setTemplateKey] = useState(defaultTemplate ?? "");
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(
      () => api<{ id: string }>(`${base}/workflows`, { body: { name, description: description || undefined, templateKey: templateKey || undefined } }),
      (wf) => router.push(`/${locale}/workflows/${wf.id}`),
    );
  };
  return (
    <form onSubmit={submit} className="grid gap-3 p-3 sm:grid-cols-2">
      <Field label={t("workflows.name")} htmlFor="wf-name">
        <Input id="wf-name" value={name} required maxLength={160} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("workflows.startFrom")} htmlFor="wf-template">
        <Select
          id="wf-template"
          value={templateKey}
          onChange={(e) => {
            setTemplateKey(e.target.value);
            const tpl = templates.find((x) => x.key === e.target.value);
            if (tpl && !name.trim()) setName(tpl.name);
          }}
        >
          <option value="">{t("workflows.blank")}</option>
          {templates.map((tpl) => (
            <option key={tpl.key} value={tpl.key}>
              {tpl.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Field label={t("workflows.description")} htmlFor="wf-description">
          <Textarea id="wf-description" rows={2} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy || !name.trim()}>
          <Plus aria-hidden />
          {t("workflows.create")}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function WorkflowStatusControls({ base, workflowId, status, published }: { base: string; workflowId: string; status: string; published: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const set = (next: "ACTIVE" | "PAUSED" | "ARCHIVED") => run(() => api(`${base}/workflows/${workflowId}/status`, { method: "POST", body: { status: next } }));
  if (status === "ARCHIVED") return null;
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap gap-2">
        {status === "ACTIVE" ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void set("PAUSED")}>
            <Pause aria-hidden />
            {t("workflows.pause")}
          </Button>
        ) : (
          <Button type="button" disabled={busy || !published} title={published ? undefined : t("workflows.publishFirst")} onClick={() => void set("ACTIVE")}>
            <Play aria-hidden />
            {t("workflows.enable")}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (confirm(t("workflows.archiveConfirm"))) void set("ARCHIVED");
          }}
        >
          <Archive aria-hidden />
          {t("workflows.archive")}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}

/** Test run with a sample event payload (key/value pairs → event.data). */
export function TestRunDialog({ base, locale, workflowId, sampleKeys, hasPublished }: { base: string; locale: string; workflowId: string; sampleKeys: string[]; hasPublished: boolean }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ k: string; v: string }[]>(sampleKeys.length ? sampleKeys.map((k) => ({ k, v: "" })) : [{ k: "name", v: "" }]);
  const [entityId, setEntityId] = useState("");
  const [useDraft, setUseDraft] = useState(true);
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const data = Object.fromEntries(rows.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v]));
    void run(
      () => api<{ id: string | null }>(`${base}/workflows/${workflowId}/test`, { body: { data, entityId: entityId || undefined, useDraft: useDraft || !hasPublished } }),
      (r) => {
        setOpen(false);
        if (r.id) router.push(`/${locale}/workflows/runs/${r.id}`);
      },
    );
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary">
          <FlaskConical aria-hidden />
          {t("workflows.testRun")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("workflows.testRun")} description={t("workflows.testRunHelp")} closeLabel={t("common.close")} className="max-w-xl">
        <form onSubmit={submit} className="grid gap-3">
          <Notice tone="warning">{t("workflows.testRunWarning")}</Notice>
          <Field label={t("workflows.testEntityId")} htmlFor="test-entity" hint={t("workflows.testEntityHint")}>
            <Input id="test-entity" value={entityId} maxLength={200} onChange={(e) => setEntityId(e.target.value)} />
          </Field>
          <div className="grid gap-2">
            <p className="text-sm font-medium">{t("workflows.testData")}</p>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[10rem_minmax(0,1fr)_auto] gap-2">
                <Input value={r.k} aria-label={t("workflows.testKey")} maxLength={64} placeholder="field" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} />
                <Input value={r.v} aria-label={t("workflows.testValue")} maxLength={2000} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
                <Button type="button" size="icon" variant="ghost" aria-label={t("workflows.builder.remove")} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <X aria-hidden />
                </Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => setRows([...rows, { k: "", v: "" }])}>
              <Plus aria-hidden />
              {t("workflows.addField")}
            </Button>
          </div>
          {hasPublished ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={useDraft} onChange={(e) => setUseDraft(e.target.checked)} />
              {t("workflows.testUseDraft")}
            </label>
          ) : null}
          <div>
            <Button type="submit" disabled={busy}>
              <FlaskConical aria-hidden />
              {busy ? t("workflows.running") : t("workflows.runTest")}
            </Button>
          </div>
          <FormError error={error} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WorkflowSettingsForm({ base, workflowId, name: initialName, description: initialDescription, ownerId: initialOwner, users }: { base: string; workflowId: string; name: string; description: string; ownerId: string; users: { id: string; name: string }[] }) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [ownerId, setOwnerId] = useState(initialOwner);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    void run(() => api(`${base}/workflows/${workflowId}`, { method: "PATCH", body: { name, description: description || null, ...(ownerId !== initialOwner ? { ownerId } : {}) } }), () => setSaved(true));
  };
  return (
    <form onSubmit={submit} className="grid gap-3 p-4">
      <Field label={t("workflows.name")} htmlFor="set-name">
        <Input id="set-name" value={name} required maxLength={160} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("workflows.description")} htmlFor="set-description">
        <Textarea id="set-description" rows={2} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label={t("workflows.owner")} htmlFor="set-owner" hint={t("workflows.ownerHint")}>
        <Select id="set-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" disabled={busy || !name.trim()}>
          {t("common.save")}
        </Button>
        {saved ? <Check className="size-4 text-success" aria-label={t("workflows.builder.saved")} /> : null}
      </div>
      <FormError error={error} />
    </form>
  );
}

export function AiDraftForm({ base, locale, workflowId }: { base: string; locale: string; workflowId: string }) {
  const t = useT();
  const router = useRouter();
  const [description, setDescription] = useState("");
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(
      () => api<{ id: string }>(`${base}/workflows/${workflowId}/ai-draft`, { body: { description } }),
      (task) => router.push(`/${locale}/tasks/${task.id}`),
    );
  };
  return (
    <form onSubmit={submit} className="grid gap-2">
      <Field label={t("workflows.ai.describe")} htmlFor="ai-describe" hint={t("workflows.ai.hint")}>
        <Textarea id="ai-describe" rows={3} value={description} minLength={10} maxLength={4000} placeholder={t("workflows.ai.placeholder")} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" disabled={busy || description.trim().length < 10}>
          <Sparkles aria-hidden />
          {t("workflows.ai.draft")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function RunControls({ base, runId, status }: { base: string; runId: string; status: string }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap gap-2">
        {status === "FAILED" || status === "CANCELLED" ? (
          <Button type="button" disabled={busy} onClick={() => void run(() => api(`${base}/workflow-runs/${runId}/retry`, { method: "POST", body: {} }))}>
            <RotateCcw aria-hidden />
            {t("workflows.runs.retry")}
          </Button>
        ) : null}
        {status === "QUEUED" || status === "WAITING" ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              if (confirm(t("workflows.runs.cancelConfirm"))) void run(() => api(`${base}/workflow-runs/${runId}/cancel`, { method: "POST", body: {} }));
            }}
          >
            <X aria-hidden />
            {t("workflows.runs.cancel")}
          </Button>
        ) : null}
      </div>
      <FormError error={error} />
    </div>
  );
}

export function ApprovalDecision({ base, approvalId }: { base: string; approvalId: string }) {
  const t = useT();
  const [note, setNote] = useState("");
  const { busy, error, run } = useAction();
  const decide = (decision: "approve" | "reject") => run(() => api(`${base}/workflow-approvals/${approvalId}`, { body: { decision, note: note || undefined } }));
  return (
    <div className="grid gap-2">
      <Input value={note} maxLength={1000} placeholder={t("workflows.approvals.notePlaceholder")} aria-label={t("workflows.approvals.note")} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => void decide("approve")}>
          <Check aria-hidden />
          {t("workflows.approvals.approve")}
        </Button>
        <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => void decide("reject")}>
          <X aria-hidden />
          {t("workflows.approvals.reject")}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}

/** Dead-letter row: retry from the failed step, or dismiss it from the list. */
export function DeadLetterActions({ base, runId }: { base: string; runId: string }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <div className="grid content-start gap-1">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => void run(() => api(`${base}/workflow-runs/${runId}/retry`, { method: "POST", body: {} }))}>
          <RotateCcw aria-hidden />
          {t("workflows.runs.retry")}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => api(`${base}/workflow-runs/${runId}/dismiss`, { method: "POST", body: {} }))}>
          <Archive aria-hidden />
          {t("workflows.runs.dismiss")}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}

/** Re-run a finished run from a chosen step (that step and every later step run again). */
export function RerunFromStep({ base, runId, steps, defaultStep }: { base: string; runId: string; steps: { id: string; label: string }[]; defaultStep?: string }) {
  const t = useT();
  const [stepId, setStepId] = useState(defaultStep ?? steps[0]?.id ?? "");
  const { busy, error, run } = useAction();
  if (!steps.length) return null;
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="h-8 w-auto max-w-full" value={stepId} aria-label={t("workflows.runs.rerunFrom")} onChange={(e) => setStepId(e.target.value)}>
          {steps.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || !stepId}
          onClick={() => {
            if (confirm(t("workflows.runs.rerunConfirm"))) void run(() => api(`${base}/workflow-runs/${runId}/rerun`, { method: "POST", body: { stepId } }));
          }}
        >
          <Play aria-hidden />
          {t("workflows.runs.rerunFrom")}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}
