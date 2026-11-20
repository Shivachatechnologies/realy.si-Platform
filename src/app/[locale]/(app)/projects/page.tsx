import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { workContext } from "@/components/work/context";
import { NewProjectForm } from "@/components/work/project-forms";
import { Empty, HEALTH_TONE, Pagination, Progress, PROJECT_STATUS_TONE, StatCard } from "@/components/work/ui";
import { ProjectsAreaTabs } from "@/components/work/views";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { listPeople } from "@/server/modules/work/shared";
import { listTemplates, listWorkProjects, parseProjectFilters, PROJECT_STATUSES } from "@/server/modules/work/projects";
import { workload } from "@/server/modules/work/tasks";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.projects.title") };
}

export default async function ProjectsPage({ searchParams }: PageProps<"/[locale]/projects">) {
  const t = await getT();
  const w = await workContext("projects", t("modules.projects.title"), t("work.projectsSubtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, base } = w;
  const raw = await searchParams;
  const filters = parseProjectFilters(raw);
  const filtered = !!(filters.q || filters.status || filters.owner || filters.archived);
  const [list, people, templates, load] = await Promise.all([
    listWorkProjects(viewer.ctx, org.id, company.id, filters),
    listPeople(viewer.ctx, org.id, company.id),
    canManage ? listTemplates(viewer.ctx, org.id, company.id) : null,
    workload(viewer.ctx, org.id, company.id),
  ]);
  const active = list.data.filter((p) => p.status === "ACTIVE").length;
  const overdue = list.data.reduce((n, p) => n + p.overdue, 0);
  const risks = list.data.reduce((n, p) => n + p.openRisks, 0);
  const templateOptions = templates
    ? [
        ...templates.builtIn.map((b) => ({
          value: b.key,
          label: b.key === "blank" ? t("work.templates.builtIn.blank.name") : `${t(`work.templates.builtIn.${b.key}.name`)} (${t("work.template.counts", { tasks: b.tasks, milestones: b.milestones })})`,
        })),
        ...templates.custom.map((c) => ({ value: c.id, label: `${c.name} (${t("work.template.counts", { tasks: c.tasks, milestones: c.milestones })})` })),
      ]
    : [];
  const sortHref = (sort: string) => {
    const q = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" && v && k !== "sort" && k !== "page" ? [[k, v]] : [])));
    q.set("sort", sort);
    return `/${locale}/projects?${q}`;
  };

  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {w.header}
      <ProjectsAreaTabs t={t} locale={locale} active="projects" />
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label={t("work.stats.projects")} value={list.total} />
        <StatCard label={t("work.stats.activeOnPage")} value={active} />
        <StatCard label={t("work.stats.overdueTasks")} value={overdue} tone={overdue ? "warning" : undefined} />
        <StatCard label={t("work.stats.openRisks")} value={risks} tone={risks ? "warning" : undefined} />
      </div>

      <Card>
        <CardHeader title={t("work.projectList")} description={t("projects.count", { count: list.total })} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_9rem_auto]" action={`/${locale}/projects`}>
          <Input name="q" type="search" defaultValue={filters.q ?? ""} maxLength={200} aria-label={t("work.search")} placeholder={t("work.searchProjects")} />
          <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("work.project.status")}>
            <option value="">{t("work.allStatuses")}</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`work.projectStatus.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="owner" defaultValue={filters.owner ?? ""} aria-label={t("work.project.owner")}>
            <option value="">{t("work.allOwners")}</option>
            <option value="me">{t("work.mine")}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select name="archived" defaultValue={filters.archived ? "1" : ""} aria-label={t("work.archived")}>
            <option value="">{t("work.activeOnly")}</option>
            <option value="1">{t("work.archived")}</option>
          </Select>
          <div className="flex gap-2">
            <input type="hidden" name="sort" value={filters.sort} />
            <Button type="submit" variant="secondary">
              {t("work.apply")}
            </Button>
            {filtered ? (
              <Link href={`/${locale}/projects`} className="self-center text-xs text-muted-foreground hover:underline">
                {t("work.clear")}
              </Link>
            ) : null}
          </div>
        </form>
        {canManage ? (
          <details className="border-b">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("work.project.new")}</summary>
            <NewProjectForm base={base} locale={locale} people={people} viewerId={viewer.user.id} templates={templateOptions} currency={company.baseCurrency} />
          </details>
        ) : null}
        {list.data.length === 0 ? (
          <Empty>{filtered ? t("common.noResults") : t("projects.empty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>
                  <Link href={sortHref("name")} className="hover:text-foreground">
                    {t("projects.name")}
                  </Link>
                </Th>
                <Th>
                  <Link href={sortHref("status")} className="hover:text-foreground">
                    {t("work.project.status")}
                  </Link>
                </Th>
                <Th>{t("work.project.health")}</Th>
                <Th>{t("work.project.owner")}</Th>
                <Th className="min-w-40">{t("work.project.progress")}</Th>
                <Th>
                  <Link href={sortHref("due")} className="hover:text-foreground">
                    {t("work.project.dueDate")}
                  </Link>
                </Th>
                <Th className="text-end">{t("work.stats.overdueTasks")}</Th>
                <Th className="text-end">{t("work.stats.openRisks")}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <Link href={`/${locale}/projects/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <span className="ms-2 text-xs text-muted-foreground">{p.workspace.name}</span>
                  </Td>
                  <Td>
                    <Badge tone={PROJECT_STATUS_TONE[p.status]}>{t(`work.projectStatus.${p.status}`)}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={HEALTH_TONE[p.health]}>{t(`work.health.${p.health}`)}</Badge>
                  </Td>
                  <Td className="text-muted-foreground">{p.owner?.name ?? "—"}</Td>
                  <Td>
                    <Progress value={p.progress} label={t("work.project.progressOf", { done: p.tasksDone, total: p.tasksTotal })} />
                  </Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{p.dueDate ? formatDate(p.dueDate, locale, "UTC") : "—"}</Td>
                  <Td className={`text-end tabular-nums ${p.overdue ? "text-danger" : "text-muted-foreground"}`}>{p.overdue}</Td>
                  <Td className={`text-end tabular-nums ${p.openRisks ? "text-warning" : "text-muted-foreground"}`}>{p.openRisks}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination
          path={`/${locale}/projects`}
          params={raw}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          labels={{ prev: t("common.previous"), next: t("common.next"), summary: t("work.pageOf", { page: list.page, pages: Math.max(1, Math.ceil(list.total / list.pageSize)) }) }}
        />
      </Card>

      {load.length ? (
        <Card>
          <CardHeader title={t("work.workload.title")} description={t("work.workload.description")} />
          <Table>
            <THead>
              <Tr>
                <Th>{t("work.workload.person")}</Th>
                <Th className="text-end">{t("work.workload.open")}</Th>
                <Th className="text-end">{t("work.workload.points")}</Th>
                <Th className="text-end">{t("work.workload.overdue")}</Th>
              </Tr>
            </THead>
            <TBody>
              {load.map((r) => (
                <Tr key={r.userId}>
                  <Td>
                    <Link href={`/${locale}/projects/tasks?assignee=${r.userId}&open=1`} className="hover:underline">
                      {r.name}
                    </Link>
                  </Td>
                  <Td className="text-end tabular-nums">{r.open}</Td>
                  <Td className="text-end tabular-nums">{r.points}</Td>
                  <Td className={`text-end tabular-nums ${r.overdue ? "text-danger" : ""}`}>{r.overdue}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
