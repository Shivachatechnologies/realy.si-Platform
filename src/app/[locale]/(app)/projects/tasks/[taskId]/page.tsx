import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Lock, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { InlineSelect } from "@/components/work/actions";
import { workContext } from "@/components/work/context";
import { TASK_STATUSES } from "@/components/work/constants";
import { AttachmentForm, CommentForm, DeleteIconButton, DependencyForm, EditTaskForm, NewTaskForm, RemoveDependencyButton, TimeForm } from "@/components/work/task-forms";
import { Facts, PRIORITY_TONE, STATUS_TONE } from "@/components/work/ui";
import { getT } from "@/i18n/server";
import { formatDate, formatDateTime, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import { listPeople } from "@/server/modules/work/shared";
import { getWorkTask } from "@/server/modules/work/tasks";
import { DiscussInChannel } from "@/components/comms/task-discussion";
import { discussionChannels, getTaskDiscussion } from "@/server/modules/comms/discussions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.task.detail") };
}

export default async function TaskPage({ params }: PageProps<"/[locale]/projects/tasks/[taskId]">) {
  const { taskId } = await params;
  const t = await getT();
  const w = await workContext("projects", t("modules.projects.title"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, base, tz } = w;
  const task = await getWorkTask(viewer.ctx, org.id, company.id, taskId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const [people, milestones, sprints, features, candidates] = await Promise.all([
    listPeople(viewer.ctx, org.id, company.id),
    task.projectId ? db().projectMilestone.findMany({ where: { projectId: task.projectId, companyId: company.id }, orderBy: { dueDate: "asc" }, select: { id: true, title: true } }) : [],
    task.projectId ? db().sprint.findMany({ where: { projectId: task.projectId, companyId: company.id, status: { not: "COMPLETED" } }, orderBy: { startDate: "asc" }, select: { id: true, name: true } }) : [],
    db().productFeature.findMany({ where: { organizationId: org.id, companyId: company.id, archivedAt: null }, orderBy: { title: "asc" }, take: 300, select: { id: true, title: true } }),
    canManage
      ? db().workTask.findMany({
          where: { companyId: company.id, projectId: task.projectId, archivedAt: null, id: { not: task.id }, status: { not: "CANCELLED" }, NOT: { id: { in: task.dependsOn.map((d) => d.dependsOn.id) } } },
          orderBy: { createdAt: "desc" },
          take: 300,
          select: { id: true, title: true },
        })
      : [],
  ]);
  // Communication link (optional: hidden when the viewer can't use Communication).
  const [discussionState, discussChannels] = await Promise.all([
    getTaskDiscussion(viewer.ctx, org.id, company.id, task.id).catch(() => undefined),
    discussionChannels(viewer.ctx, org.id, company.id).catch(() => []),
  ]);
  const commsBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const day = (d: Date | null) => (d ? formatDate(d, locale, "UTC") : "—");
  const hours = (m: number) => t("work.hoursValue", { hours: Math.round((m / 60) * 10) / 10 });
  const overdue = task.dueDate && task.dueDate < new Date() && task.status !== "DONE" && task.status !== "CANCELLED";
  const backHref = task.project ? `/${locale}/projects/${task.project.id}/board` : `/${locale}/projects/tasks`;
  const kb = (n: number) => `${formatNumber(Math.max(1, Math.round(n / 1024)), locale)} KB`;

  return (
    <div className="mx-auto grid max-w-[1100px] min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground" aria-label={t("work.breadcrumb")}>
          <Link href={`/${locale}/projects`} className="hover:underline">
            {t("modules.projects.title")}
          </Link>
          {task.project ? (
            <>
              <span aria-hidden>/</span>
              <Link href={backHref} className="hover:underline">
                {task.project.name}
              </Link>
            </>
          ) : null}
          {task.parent ? (
            <>
              <span aria-hidden>/</span>
              <Link href={`/${locale}/projects/tasks/${task.parent.id}`} className="hover:underline">
                {task.parent.title}
              </Link>
            </>
          ) : null}
        </nav>
        {canManage ? <DeleteIconButton url={`${base}/tasks/${task.id}`} label={t("work.task.archive")} confirm={t("work.task.confirmArchive")} redirectTo={backHref} /> : null}
      </div>

      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              {task.title}
              <Badge tone={PRIORITY_TONE[task.priority]}>{t(`work.priority.${task.priority}`)}</Badge>
              {task.recurrence ? (
                <Badge>
                  <Repeat className="size-3" aria-hidden />
                  {t(`work.recurrence.${task.recurrence}`)}
                  {task.recurrenceInterval > 1 ? ` ×${task.recurrenceInterval}` : ""}
                </Badge>
              ) : null}
              {task.blocked ? (
                <Badge tone="warning">
                  <Lock className="size-3" aria-hidden />
                  {t("work.task.blocked")}
                </Badge>
              ) : null}
            </span>
          }
          actions={
            canManage ? (
              <InlineSelect url={`${base}/tasks/${task.id}`} field="status" value={task.status} label={t("work.task.status")} options={TASK_STATUSES.map((s) => ({ value: s, label: t(`work.taskStatus.${s}`) }))} />
            ) : (
              <Badge tone={STATUS_TONE[task.status]}>{t(`work.taskStatus.${task.status}`)}</Badge>
            )
          }
        />
        <CardBody className="grid gap-4">
          {task.blocked ? <Notice tone="warning">{t("work.task.blockedNotice")}</Notice> : null}
          <Facts
            cols={4}
            items={[
              [t("work.task.assignee"), task.assignee?.name ?? t("work.unassigned")],
              [t("work.startDate"), day(task.startDate)],
              [t("work.dueDate"), <span key="due" className={overdue ? "text-danger" : undefined}>{day(task.dueDate)}</span>],
              [t("work.task.estimate"), task.estimatePoints ?? "—"],
              [t("work.task.sprint"), task.sprint ? <Link key="s" href={`/${locale}/projects/${task.projectId}/sprints/${task.sprint.id}`} className="hover:underline">{task.sprint.name}</Link> : "—"],
              [t("work.task.milestone"), task.milestone?.title ?? "—"],
              [t("work.task.feature"), task.feature ? <Link key="f" href={`/${locale}/product/features/${task.feature.id}`} className="hover:underline">{task.feature.title}</Link> : "—"],
              [t("work.time.logged"), hours(task.loggedMinutes)],
              [t("work.task.labels"), task.labels.length ? task.labels.join(", ") : "—"],
              [t("work.task.createdBy"), task.createdByName ?? "—"],
              [t("projects.created"), formatDateTime(task.createdAt, locale, tz)],
              [t("work.task.completedAt"), task.completedAt ? formatDateTime(task.completedAt, locale, tz) : "—"],
            ]}
          />
          {task.description ? <p className="whitespace-pre-wrap text-sm">{task.description}</p> : null}
          {canManage ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium">{t("work.task.edit")}</summary>
              <div className="pt-3">
                <EditTaskForm
                  base={base}
                  taskId={task.id}
                  people={people}
                  milestones={milestones.map((m) => ({ id: m.id, name: m.title }))}
                  sprints={sprints}
                  features={features.map((f) => ({ id: f.id, name: f.title }))}
                  initial={{
                    title: task.title,
                    description: task.description ?? "",
                    status: task.status,
                    priority: task.priority,
                    assigneeId: task.assigneeId ?? "",
                    startDate: iso(task.startDate),
                    dueDate: iso(task.dueDate),
                    estimatePoints: task.estimatePoints == null ? "" : String(task.estimatePoints),
                    labels: task.labels.join(", "),
                    milestoneId: task.milestoneId ?? "",
                    sprintId: task.sprintId ?? "",
                    featureId: task.featureId ?? "",
                    recurrence: task.recurrence ?? "",
                    recurrenceInterval: String(task.recurrenceInterval),
                    recurrenceUntil: iso(task.recurrenceUntil),
                  }}
                />
              </div>
            </details>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("work.task.subtasks")} description={t("work.task.subtaskCount", { count: task.subtasks.length })} />
          {task.subtasks.length ? (
            <ul className="grid divide-y">
              {task.subtasks.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                  <Badge tone={STATUS_TONE[s.status]}>{t(`work.taskStatus.${s.status}`)}</Badge>
                  <Link href={`/${locale}/projects/tasks/${s.id}`} className={`min-w-0 flex-1 truncate hover:underline ${s.status === "DONE" ? "text-muted-foreground line-through" : ""}`}>
                    {s.title}
                  </Link>
                  <span className="text-xs text-muted-foreground">{s.assignee?.name ?? ""}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {canManage && !task.parentId ? (
            <details className="border-t">
              <summary className="cursor-pointer p-3 text-sm font-medium">{t("work.task.addSubtask")}</summary>
              <NewTaskForm base={base} people={people} projectId={task.projectId ?? undefined} parentId={task.id} defaults={{ assigneeId: task.assigneeId ?? "" }} />
            </details>
          ) : null}
        </Card>

        <Card>
          <CardHeader title={t("work.task.dependencies")} description={t("work.task.dependenciesHint")} />
          <CardBody className="grid gap-3 text-sm">
            <div className="grid gap-1">
              <p className="text-xs font-medium text-muted-foreground">{t("work.task.waitsFor")}</p>
              {task.dependsOn.length ? (
                <ul className="grid gap-1">
                  {task.dependsOn.map((d) => (
                    <li key={d.id} className="flex items-center gap-2">
                      <Badge tone={STATUS_TONE[d.dependsOn.status]}>{t(`work.taskStatus.${d.dependsOn.status}`)}</Badge>
                      <Link href={`/${locale}/projects/tasks/${d.dependsOn.id}`} className="min-w-0 flex-1 truncate hover:underline">
                        {d.dependsOn.title}
                      </Link>
                      {canManage ? <RemoveDependencyButton base={base} taskId={task.id} dependsOnId={d.dependsOn.id} /> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t("work.none")}</p>
              )}
            </div>
            <div className="grid gap-1">
              <p className="text-xs font-medium text-muted-foreground">{t("work.task.blocks")}</p>
              {task.blocks.length ? (
                <ul className="grid gap-1">
                  {task.blocks.map((d) => (
                    <li key={d.id} className="flex items-center gap-2">
                      <Badge tone={STATUS_TONE[d.task.status]}>{t(`work.taskStatus.${d.task.status}`)}</Badge>
                      <Link href={`/${locale}/projects/tasks/${d.task.id}`} className="min-w-0 flex-1 truncate hover:underline">
                        {d.task.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t("work.none")}</p>
              )}
            </div>
            {canManage && candidates.length ? <DependencyForm base={base} taskId={task.id} candidates={candidates.map((c) => ({ id: c.id, name: c.title }))} /> : null}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("work.attachment.title")} />
          <CardBody className="grid gap-3">
            {task.attachments.length ? (
              <ul className="grid gap-1 text-sm">
                {task.attachments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2">
                    <a href={`${base}/attachments/${a.id}`} className="flex min-w-0 flex-1 items-center gap-1 truncate hover:underline" download={a.fileName}>
                      <Download className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{a.fileName}</span>
                    </a>
                    <span className="text-xs text-muted-foreground">
                      {kb(a.sizeBytes)} · {a.uploadedByName ?? ""}
                    </span>
                    {canManage ? <DeleteIconButton url={`${base}/attachments/${a.id}`} label={t("work.delete")} confirm={t("work.confirmDelete")} /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("work.attachment.empty")}</p>
            )}
            {canManage ? <AttachmentForm base={base} taskId={task.id} /> : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("work.time.title")} description={t("work.time.loggedTotal", { hours: hours(task.loggedMinutes) })} />
          <CardBody className="grid gap-3">
            {task.projectId ? <TimeForm base={base} taskId={task.id} /> : <p className="text-sm text-muted-foreground">{t("errors.reasons.work_time_no_project")}</p>}
            {task.timeEntries.length ? (
              <ul className="grid gap-1 text-sm">
                {task.timeEntries.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">{day(e.workDate)}</span>
                    <span className="font-medium">{hours(e.minutes)}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {e.userName ?? ""}
                      {e.note ? ` · ${e.note}` : ""}
                    </span>
                    {canManage || e.userId === viewer.user.id ? <DeleteIconButton url={`${base}/time/${e.id}`} label={t("work.delete")} confirm={t("work.confirmDelete")} /> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title={t("work.comment.title")}
          description={t("work.comment.count", { count: task.comments.length })}
          actions={
            discussionState ? (
              <DiscussInChannel base={commsBase} locale={locale} taskId={task.id} discussion={discussionState.discussion} channels={discussChannels} canPost={discussionState.canPost} />
            ) : null
          }
        />
        <CardBody className="grid gap-4">
          {task.comments.length ? (
            <ol className="grid gap-3 border-s ps-4">
              {task.comments.map((c) => (
                <li key={c.id} className="grid gap-0.5 text-sm">
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{c.authorName ?? "—"}</span>
                    {formatDateTime(c.createdAt, locale, tz)}
                    {canManage || c.authorId === viewer.user.id ? <DeleteIconButton url={`${base}/comments/${c.id}`} label={t("work.delete")} confirm={t("work.confirmDelete")} /> : null}
                  </span>
                  <p className="whitespace-pre-wrap break-words">{c.body}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">{t("work.comment.empty")}</p>
          )}
          <CommentForm base={base} taskId={task.id} people={people} />
        </CardBody>
      </Card>
    </div>
  );
}
