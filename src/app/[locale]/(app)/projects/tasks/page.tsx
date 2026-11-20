import type { Metadata } from "next";
import { Card, CardHeader } from "@/components/ui/card";
import { workContext } from "@/components/work/context";
import { TaskFilterBar } from "@/components/work/task-filter";
import { NewTaskForm } from "@/components/work/task-forms";
import { Empty, Pagination } from "@/components/work/ui";
import { ProjectsAreaTabs, TaskTable } from "@/components/work/views";
import { getT } from "@/i18n/server";
import { listProjects } from "@/server/modules/companies/service";
import { listPeople } from "@/server/modules/work/shared";
import { listWorkTasks, parseTaskFilters, taskLabels } from "@/server/modules/work/tasks";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.tabs.allTasks") };
}

export default async function AllTasksPage({ searchParams }: PageProps<"/[locale]/projects/tasks">) {
  const t = await getT();
  const w = await workContext("projects", t("modules.projects.title"), t("work.projectsSubtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, base } = w;
  const raw = await searchParams;
  const filters = parseTaskFilters(raw);
  const path = `/${locale}/projects/tasks`;
  const [list, people, labels, projects] = await Promise.all([
    listWorkTasks(viewer.ctx, org.id, company.id, filters),
    listPeople(viewer.ctx, org.id, company.id),
    taskLabels(org.id, company.id),
    listProjects(viewer.ctx, org.id, company.id),
  ]);
  const sortLink = (key: string) => {
    const q = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" && v && !["sort", "dir", "page"].includes(k) ? [[k, v]] : [])));
    q.set("sort", key);
    q.set("dir", filters.sort === key && filters.dir === "asc" ? "desc" : "asc");
    return `${path}?${q}`;
  };
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {w.header}
      <ProjectsAreaTabs t={t} locale={locale} active="tasks" />
      <Card>
        <CardHeader title={t("work.tabs.allTasks")} description={t("work.task.count", { count: list.total })} />
        <TaskFilterBar t={t} path={path} filters={filters} people={people} labels={labels} projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
        {canManage ? (
          <details className="border-b">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("work.task.add")}</summary>
            <NewTaskForm base={base} people={people} projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
          </details>
        ) : null}
        {list.data.length ? <TaskTable t={t} locale={locale} rows={list.data} showProject sortLink={sortLink} sort={filters.sort} dir={filters.dir} /> : <Empty>{t("work.task.empty")}</Empty>}
        <Pagination path={path} params={raw} page={list.page} pageSize={list.pageSize} total={list.total} labels={{ prev: t("common.previous"), next: t("common.next"), summary: t("work.pageOf", { page: list.page, pages: Math.max(1, Math.ceil(list.total / list.pageSize)) }) }} />
      </Card>
    </div>
  );
}
