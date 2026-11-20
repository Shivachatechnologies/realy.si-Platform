"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import type { AgentTaskStatus } from "@/generated/prisma/enums";
import { TaskStatusBadge } from "@/components/agents/status-badge";
import { CitationList, type CitationItem } from "@/components/brain/citation-list";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

interface TaskView {
  id: string;
  status: AgentTaskStatus;
  output?: string | null;
  citations?: CitationItem[];
  errorMessage?: string | null;
}

const ACTIVE: AgentTaskStatus[] = ["QUEUED", "RUNNING"];

/**
 * Ask the Brain, embeddable anywhere: the question becomes an AI task that answers from the company's documents and
 * memory with source citations. `context` (plain text about the page/record) is passed to the AI; `subject` attaches
 * the task to a record so it also appears in that record's AI task list.
 */
export function AskBrain({
  organizationId,
  companyId,
  context,
  subject,
  title,
  placeholder,
  refreshOnDone = false,
}: {
  organizationId: string;
  companyId: string;
  context?: string;
  subject?: { type: string; id: string };
  title?: string;
  placeholder?: string;
  /** Re-render the server page when the answer is ready (e.g. to update a history list). */
  refreshOnDone?: boolean;
}) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const base = `/api/v1/organizations/${organizationId}/companies/${companyId}`;
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [task, setTask] = useState<TaskView | null>(null);
  const active = task ? ACTIVE.includes(task.status) : false;

  useEffect(() => {
    if (!task || !ACTIVE.includes(task.status)) return;
    const id = setTimeout(async () => {
      try {
        const next = await api<TaskView>(`${base}/tasks/${task.id}`);
        setTask(next);
        if (!ACTIVE.includes(next.status) && refreshOnDone) router.refresh();
      } catch (e) {
        setError(e);
        setTask((cur) => (cur ? { ...cur, status: "FAILED" } : cur));
      }
    }, 2500);
    return () => clearTimeout(id);
  }, [task, base, refreshOnDone, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<TaskView>(`${base}/brain/ask`, { body: { question, context: context?.slice(0, 2000) || undefined, subject } });
      setTask(created);
      if (refreshOnDone) router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title={title ?? t("brain.ask.title")} description={t("brain.ask.hint")} />
      <CardBody className="grid gap-3">
        <form onSubmit={submit} className="grid gap-2">
          <Field label={t("brain.ask.question")} htmlFor={`ask-brain-${subject?.id ?? "page"}`}>
            <Textarea
              id={`ask-brain-${subject?.id ?? "page"}`}
              rows={3}
              maxLength={2000}
              value={question}
              placeholder={placeholder ?? t("brain.ask.placeholder")}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </Field>
          <FormError error={error} />
          <div>
            <Button type="submit" disabled={busy || active || question.trim().length < 3}>
              <Sparkles aria-hidden />
              {busy ? t("brain.ask.sending") : t("brain.ask.submit")}
            </Button>
          </div>
        </form>
        {task ? (
          <section className="grid gap-2 rounded-md border p-3" aria-live="polite" aria-label={t("brain.ask.answer")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TaskStatusBadge status={task.status} label={t(`agentTasks.status.${task.status}`)} />
              <Link className="text-xs text-muted-foreground hover:underline" href={`/${locale}/tasks/${task.id}`}>
                {t("brain.ask.openTask")}
              </Link>
            </div>
            {active ? <p className="text-sm text-muted-foreground">{t("brain.ask.working")}</p> : null}
            {task.status === "FAILED" ? <Notice tone="danger">{t("agentTasks.failed", { message: task.errorMessage ?? "" })}</Notice> : null}
            {task.status === "CANCELLED" ? <Notice tone="warning">{t("agentTasks.cancelled")}</Notice> : null}
            {task.output ? <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{task.output}</div> : null}
            {task.status === "COMPLETED" ? (
              <div className="grid gap-1.5">
                <h3 className="text-xs font-medium uppercase text-muted-foreground">{t("agentTasks.sources")}</h3>
                <CitationList citations={task.citations ?? []} locale={locale} t={t} emptyText={t("agentTasks.noSources")} />
              </div>
            ) : null}
          </section>
        ) : null}
      </CardBody>
    </Card>
  );
}
