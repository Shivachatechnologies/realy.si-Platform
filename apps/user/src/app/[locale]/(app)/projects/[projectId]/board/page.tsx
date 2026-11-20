import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { KanbanBoard, type BoardCard } from "@/components/work/kanban-board";
import { projectPage } from "@/components/work/project-page";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { listPeople, param } from "@/server/modules/work/shared";
import { boardTasks } from "@/server/modules/work/tasks";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.tabs.board") };
}

export default async function BoardPage({ params, searchParams }: PageProps<"/[locale]/projects/[projectId]/board">) {
  const { projectId } = await params;
  const raw = await searchParams;
  const t = await getT();
  const pg = await projectPage(projectId, "board");
  if (pg.gate) return pg.gate;
  const { locale, viewer, org, company, canManage, base, project, top } = pg;
  const sprint = param(raw, "sprint");
  const sprintId = project.sprints.some((s) => s.id === sprint) ? sprint : undefined;
  const assignee = param(raw, "assignee");
  const q = param(raw, "q");
  const [tasks, people] = await Promise.all([boardTasks(viewer.ctx, org.id, company.id, project.id, { sprintId, assignee, q }), listPeople(viewer.ctx, org.id, company.id)]);
  const today = new Date();
  const cards: BoardCard[] = tasks
    .filter((x) => x.status !== "CANCELLED")
    .map((x) => ({
      id: x.id,
      title: x.title,
      status: x.status,
      priority: x.priority,
      due: x.dueDate ? formatDate(x.dueDate, locale, "UTC", { day: "numeric", month: "short" }) : null,
      overdue: !!x.dueDate && x.dueDate < today && x.status !== "DONE",
      assigneeName: x.assignee?.name ?? null,
      points: x.estimatePoints,
      labels: x.labels,
      blocked: x.blocked,
      subtasks: x._count.subtasks,
      comments: x._count.comments,
      attachments: x._count.attachments,
      recurring: !!x.recurrence,
    }));
  return (
    <div className="mx-auto grid max-w-[1600px] min-w-0 gap-4">
      {top}
      <Card>
        <form className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_12rem_12rem_auto]" action={`/${locale}/projects/${project.id}/board`}>
          <Input name="q" type="search" defaultValue={q ?? ""} maxLength={200} aria-label={t("work.search")} placeholder={t("work.searchTasks")} />
          <Select name="sprint" defaultValue={sprintId ?? ""} aria-label={t("work.task.sprint")}>
            <option value="">{t("work.board.allWork")}</option>
            {project.sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select name="assignee" defaultValue={assignee ?? ""} aria-label={t("work.task.assignee")}>
            <option value="">{t("work.allAssignees")}</option>
            <option value="me">{t("work.mine")}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">
              {t("work.apply")}
            </Button>
            {sprintId || assignee || q ? (
              <Link href={`/${locale}/projects/${project.id}/board`} className="self-center text-xs text-muted-foreground hover:underline">
                {t("work.clear")}
              </Link>
            ) : null}
          </div>
        </form>
      </Card>
      <p className="text-xs text-muted-foreground">{t("work.board.hint")}</p>
      <KanbanBoard base={base} locale={locale} projectId={project.id} sprintId={sprintId} cards={cards} canManage={canManage && !project.archivedAt} />
    </div>
  );
}
