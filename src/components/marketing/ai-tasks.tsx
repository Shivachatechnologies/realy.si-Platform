import type { ReactNode } from "react";
import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import type { Translate } from "@/i18n/translate";
import { formatDateTime } from "@/i18n/format";
import { StatusBadge } from "./shell";

export interface AiTaskRow {
  id: string;
  title: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  createdAt: Date;
  output: string | null;
  errorCode: string | null;
}

/** AI tasks attached to a record, with live refresh while running, the output, and an optional action per completed task. */
export function AiTaskList({ tasks, locale, tz, t, aiReady, action, showOutput = true }: { tasks: AiTaskRow[]; locale: string; tz: string; t: Translate; aiReady: boolean; action?: (task: AiTaskRow) => ReactNode; showOutput?: boolean }) {
  return (
    <div className="grid gap-2">
      <AutoRefresh active={tasks.some((x) => x.status === "QUEUED" || x.status === "RUNNING")} />
      {!aiReady ? <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice> : null}
      {tasks.length === 0 ? <p className="text-xs text-muted-foreground">{t("marketing.ai.none")}</p> : null}
      <ul className="grid gap-2">
        {tasks.map((task) => (
          <li key={task.id} className="grid gap-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge status={task.status} label={t(`agentTasks.status.${task.status}`)} />
              <Link href={`/${locale}/tasks/${task.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {task.title}
              </Link>
              <span className="text-xs text-muted-foreground">{formatDateTime(task.createdAt, locale, tz)}</span>
            </div>
            {task.status === "FAILED" && task.errorCode ? <p className="text-xs text-danger">{task.errorCode}</p> : null}
            {showOutput && task.status === "COMPLETED" && task.output ? (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-2 font-sans text-xs">{task.output}</pre>
            ) : null}
            {task.status === "COMPLETED" && task.output && action ? <div className="flex flex-wrap gap-2">{action(task)}</div> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
