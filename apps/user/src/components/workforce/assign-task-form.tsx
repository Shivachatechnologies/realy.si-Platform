"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";

/** Assign a task to one AI employee. */
export function AssignTaskForm({ apiBase, aiEmployeeId }: { apiBase: string; aiEmployeeId: string }) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fields = error instanceof ApiError ? error.fieldErrors() : {};

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const task = await api<{ id: string }>(`${apiBase}/tasks`, { body: { aiEmployeeId, title, instructions } });
      router.push(`/${locale}/tasks/${task.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <Field label={t("agentTasks.taskTitle")} htmlFor="assign-title" error={fields.title}>
        <Input id="assign-title" value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={t("agentTasks.instructions")} htmlFor="assign-instructions" hint={t("agentTasks.instructionsHint")} error={fields.instructions}>
        <Textarea id="assign-instructions" rows={4} maxLength={8000} required value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </Field>
      <FormError error={error} />
      <div>
        <Button type="submit" disabled={busy}>
          <Send aria-hidden className="rtl:-scale-x-100" />
          {busy ? t("agentTasks.submitting") : t("agentTasks.submit")}
        </Button>
      </div>
    </form>
  );
}
