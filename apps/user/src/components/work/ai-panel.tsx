import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { formatDateTime } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import { TASK_TONE } from "./ui";

interface AiTaskRow {
  id: string;
  title: string;
  status: keyof typeof TASK_TONE;
  createdAt: Date;
  output: string | null;
}

/** AI tasks attached to a record (listSubjectTasks), with the latest completed output shown inline. */
export function AiPanel({ t, locale, tz, title, description, configured, tasks, actions }: { t: Translate; locale: string; tz: string; title: string; description?: string; configured: boolean; tasks: AiTaskRow[]; actions: ReactNode }) {
  const latest = tasks.find((x) => x.status === "COMPLETED" && x.output);
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className="grid gap-3">
        {configured ? <div className="flex flex-wrap gap-2">{actions}</div> : <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice>}
        {tasks.length ? (
          <ul className="grid gap-1 text-sm">
            {tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={TASK_TONE[task.status]}>{t(`agentTasks.status.${task.status}`)}</Badge>
                <Link href={`/${locale}/tasks/${task.id}`} className="hover:underline">
                  {task.title}
                </Link>
                <span className="text-xs text-muted-foreground">{formatDateTime(task.createdAt, locale, tz)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {latest ? (
          <details className="rounded-md border bg-surface-2 p-3 text-sm" open>
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">{latest.title}</summary>
            <div className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap">{latest.output}</div>
          </details>
        ) : null}
      </CardBody>
    </Card>
  );
}
