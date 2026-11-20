import type { Metadata } from "next";
import { Card, CardHeader } from "@/components/ui/card";
import { projectPage } from "@/components/work/project-page";
import { TaskFilterBar } from "@/components/work/task-filter";
import { NewTaskForm } from "@/components/work/task-forms";
import { Empty, Pagination } from "@/components/work/ui";
import { TaskTable } from "@/components/work/views";
import { getT } from "@/i18n/server";
import { listPeople } from "@/server/modules/work/shared";
import { listWorkTasks, parseTaskFilters, taskLabels } from "@/server/modules/work/tasks";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.tabs.list") };
}

export default async function ProjectListPage({ params, searchParams }: PageProps<"/[locale]/projects/[projectId]/list">) {
  const { projectId } = await params;
  const raw = await searchParams;
  const t = await getT();
  const pg = await projectPage(projectId, "list");
  if (pg.gate) return pg.gate;
  const { locale, viewer, org, company, canManage, base, project, top } = pg;
  const filters = { ...parseTaskFilters(raw), projectId: project.id };
  const path = `/${locale}/projects/${project.id}/list`;
  const [list, people, labels] = await Promise.all([listWorkTasks(viewer.ctx, org.id, company.id, filters), listPeople(viewer.ctx, org.id, company.id), taskLabels(org.id, company.id, project.id)]);
  const sortLink = (key: string) => {
    const q = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" && v && !["sort", "dir", "page"].includes(k) ? [[k, v]] : [])));
    q.set("sort", key);
    q.set("dir", filters.sort === key && filters.dir === "asc" ? "desc" : "asc");
    return `${path}?${q}`;
  };
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {top}
      <Card>
        <CardHeader title={t("work.tabs.list")} description={t("work.task.count", { count: list.total })} />
        <TaskFilterBar t={t} path={path} filters={filters} people={people} labels={labels} sprints={project.sprints.map((s) => ({ id: s.id, name: s.name }))} />
        {canManage && !project.archivedAt ? (
          <details className="border-b">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("work.task.add")}</summary>
            <NewTaskForm
              base={base}
              people={people}
              projectId={project.id}
              milestones={project.projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
              sprints={project.sprints.map((s) => ({ id: s.id, name: s.name }))}
            />
          </details>
        ) : null}
        {list.data.length ? <TaskTable t={t} locale={locale} rows={list.data} sortLink={sortLink} sort={filters.sort} dir={filters.dir} /> : <Empty>{t("work.task.empty")}</Empty>}
        <Pagination path={path} params={raw} page={list.page} pageSize={list.pageSize} total={list.total} labels={{ prev: t("common.previous"), next: t("common.next"), summary: t("work.pageOf", { page: list.page, pages: Math.max(1, Math.ceil(list.total / list.pageSize)) }) }} />
      </Card>
    </div>
  );
}
