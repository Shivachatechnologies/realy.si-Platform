import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { TaskActions } from "@/components/agents/task-actions";
import { TaskStatusBadge } from "@/components/agents/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { aiConfigured, type Citation, type ToolCallRecord } from "@/server/modules/agents/runtime";
import { getTask } from "@/server/modules/agents/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.tasks.title") };
}

export default async function TaskPage({ params }: PageProps<"/[locale]/tasks/[taskId]">) {
  const { taskId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  if (!company) notFound();
  const task = await getTask(viewer.ctx, org.id, company.id, taskId).catch((err) => {
    if (isAppError(err) && (err.code === "not_found" || err.code === "forbidden")) notFound();
    throw err;
  });
  const canRun = await can(viewer.ctx, "agents.run", await companyChain(db(), org.id, company.id));
  const active = task.status === "QUEUED" || task.status === "RUNNING";
  const citations = task.citations as unknown as Citation[];
  const lookups = task.toolCalls as unknown as ToolCallRecord[];
  const tz = viewer.user.timezone;

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <AutoRefresh active={active} />
      <Link href={`/${locale}/tasks`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
        {t("agentTasks.back")}
      </Link>

      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              {task.title}
              <TaskStatusBadge status={task.status} label={t(`agentTasks.status.${task.status}`)} />
            </span>
          }
          description={
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              <span>{t(`profiles.${task.profile}.name`)}</span>
              <span>{formatDateTime(task.createdAt, locale, tz)}</span>
              {task.attempts > 1 ? <span>{t("agentTasks.attempts", { count: task.attempts })}</span> : null}
            </span>
          }
          actions={
            canRun ? (
              <TaskActions
                base={`/api/v1/organizations/${org.id}/companies/${company.id}/tasks/${task.id}`}
                canCancel={active}
                canRetry={(task.status === "FAILED" || task.status === "CANCELLED") && aiConfigured()}
              />
            ) : null
          }
        />
        <CardBody className="grid gap-2">
          <h2 className="text-sm font-medium">{t("agentTasks.instructions")}</h2>
          <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{task.instructions}</p>
        </CardBody>
      </Card>

      {task.status === "QUEUED" ? <Notice>{t("agentTasks.queued")}</Notice> : null}
      {task.status === "RUNNING" ? <Notice>{t("agentTasks.running")}</Notice> : null}
      {task.status === "FAILED" ? <Notice tone="danger">{t("agentTasks.failed", { message: task.errorMessage ?? task.errorCode ?? "" })}</Notice> : null}
      {task.status === "CANCELLED" ? <Notice tone="warning">{t("agentTasks.cancelled")}</Notice> : null}

      {task.output ? (
        <Card>
          <CardHeader title={t("agentTasks.deliverable")} description={t("agentTasks.reviewNote")} />
          <CardBody className="grid gap-3">
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{task.output}</div>
            {task.model ? (
              <p className="text-xs text-muted-foreground">
                {t("agentTasks.usage", { model: task.model, input: formatNumber(task.inputTokens ?? 0, locale), output: formatNumber(task.outputTokens ?? 0, locale) })}
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {task.status === "COMPLETED" ? (
        <Card>
          <CardHeader title={t("agentTasks.sources")} />
          <CardBody>
            {citations.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("agentTasks.noSources")}</p>
            ) : (
              <ol className="grid gap-1.5 text-sm">
                {citations.map((c) => (
                  <li key={c.ref} className="flex items-center gap-2">
                    <Badge className="font-mono">{c.ref}</Badge>
                    <Link className="hover:underline" href={`/${locale}/brain/${c.documentId}#passage-${c.passage}`}>
                      {c.title} · {t("agentTasks.passage", { n: c.passage })}
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      ) : null}

      {lookups.length ? (
        <Card>
          <CardHeader title={t("agentTasks.lookups")} />
          <CardBody>
            <ul className="grid gap-1 text-sm text-muted-foreground">
              {lookups.map((l, i) => (
                <li key={i}>
                  {l.error
                    ? t("agentTasks.lookupFailed", { tool: t(`workforce.toolNames.${l.tool}`), error: l.error })
                    : l.tool === "search_company_brain"
                      ? t("agentTasks.lookupBrain", { query: String(l.input.query ?? ""), count: l.results })
                      : t("agentTasks.lookupGraph", { count: l.results })}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
