import Link from "next/link";
import { Sparkles } from "lucide-react";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { TaskStatusBadge } from "@/components/agents/status-badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { formatDateTime } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import { aiConfigured } from "@/server/modules/agents/runtime";
import type { AgentTaskStatus } from "@/generated/prisma/enums";
import { ActionButton } from "./hr-action";

export interface AiTaskRow {
  id: string;
  title: string;
  status: AgentTaskStatus;
  createdAt: Date;
  output: string | null;
}

/** AI actions on an HR record (buttons create agent tasks linked to it) and the tasks' live status and output. */
export function AiPanel({
  t,
  locale,
  tz,
  title,
  description,
  actions,
  tasks,
  canRun,
}: {
  t: Translate;
  locale: string;
  tz: string;
  title: string;
  description: string;
  actions: { label: string; endpoint: string; body: unknown }[];
  tasks: AiTaskRow[];
  canRun: boolean;
}) {
  const active = tasks.some((x) => x.status === "QUEUED" || x.status === "RUNNING");
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className="grid gap-3">
        <AutoRefresh active={active} />
        {!canRun ? null : aiConfigured() ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <ActionButton key={a.label} endpoint={a.endpoint} body={a.body} label={a.label} busyLabel={t("hr.ai.starting")} icon={<Sparkles aria-hidden />} />
            ))}
          </div>
        ) : (
          <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice>
        )}
        {tasks.length ? (
          <ul className="grid gap-3">
            {tasks.map((task) => (
              <li key={task.id} className="grid gap-1.5 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <TaskStatusBadge status={task.status} label={t(`agentTasks.status.${task.status}`)} />
                  <Link href={`/${locale}/tasks/${task.id}`} className="font-medium hover:underline">
                    {task.title}
                  </Link>
                  <span className="text-xs text-muted-foreground">{formatDateTime(task.createdAt, locale, tz)}</span>
                </div>
                {task.status === "COMPLETED" && task.output ? (
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">{t("hr.ai.showOutput")}</summary>
                    <div className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-sm">{task.output}</div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{t("agentTasks.reviewNote")}</p>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("hr.ai.none")}</p>
        )}
      </CardBody>
    </Card>
  );
}
