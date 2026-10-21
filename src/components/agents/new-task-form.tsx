"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { PROFILE_KEYS } from "@/server/modules/agents/profiles";

export function NewTaskForm({
  organizationId,
  companyId,
  initialProfile,
  milestones = [],
}: {
  organizationId: string;
  companyId: string;
  initialProfile?: string;
  /** Open milestones the task can advance, labelled "Objective — Milestone". */
  milestones?: { id: string; label: string }[];
}) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const [profile, setProfile] = useState<string>(PROFILE_KEYS.includes(initialProfile as never) ? initialProfile! : PROFILE_KEYS[0]);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fields = error instanceof ApiError ? error.fieldErrors() : {};

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const task = await api<{ id: string }>(`/api/v1/organizations/${organizationId}/companies/${companyId}/tasks`, { body: { profile, title, instructions, milestoneId: milestoneId || undefined } });
      router.push(`/${locale}/tasks/${task.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title={t("agentTasks.new")} />
      <CardBody>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[16rem_minmax(0,1fr)]">
            <Field label={t("agentTasks.profile")} htmlFor="task-profile">
              <Select id="task-profile" value={profile} onChange={(e) => setProfile(e.target.value)}>
                {PROFILE_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {t(`profiles.${k}.name`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("agentTasks.taskTitle")} htmlFor="task-title" error={fields.title}>
              <Input id="task-title" value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} />
            </Field>
          </div>
          <Field label={t("agentTasks.instructions")} htmlFor="task-instructions" hint={t("agentTasks.instructionsHint")} error={fields.instructions}>
            <Textarea id="task-instructions" rows={5} value={instructions} maxLength={8000} required onChange={(e) => setInstructions(e.target.value)} />
          </Field>
          {milestones.length ? (
            <Field label={t("agentTasks.milestone")} htmlFor="task-milestone" hint={t("agentTasks.milestoneHint")}>
              <Select id="task-milestone" value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)}>
                <option value="">{t("agentTasks.noMilestone")}</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <FormError error={error} />
          <div>
            <Button type="submit" disabled={busy}>
              <Send aria-hidden className="rtl:-scale-x-100" />
              {busy ? t("agentTasks.submitting") : t("agentTasks.submit")}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
