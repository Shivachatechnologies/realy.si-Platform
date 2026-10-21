"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

function useSubmit(run: () => Promise<unknown>, reset: () => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await run();
      reset();
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, submit };
}

export function NewObjectiveForm({ base }: { base: string }) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const { busy, error, submit } = useSubmit(
    () => api(`${base}/objectives`, { body: { title, targetDate: targetDate || undefined } }),
    () => (setTitle(""), setTargetDate("")),
  );
  return (
    <form onSubmit={submit} className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
      <Field label={t("objectives.title")} htmlFor="objective-title">
        <Input id="objective-title" value={title} maxLength={200} required placeholder={t("objectives.titlePlaceholder")} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={t("objectives.targetDate")} htmlFor="objective-date">
        <Input id="objective-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
      </Field>
      <Button type="submit" disabled={busy || !title.trim()}>
        <Plus aria-hidden />
        {t("objectives.create")}
      </Button>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
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
