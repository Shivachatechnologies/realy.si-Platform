import type { Metadata } from "next";
import Link from "next/link";
import { DeleteButton, EditObjectiveDialog, MilestoneToggle, NewKeyResultForm, NewMilestoneForm, NewObjectiveForm, ObjectiveStatusSelect } from "@/components/objectives/objective-forms";
import { KeyResultList } from "@/components/objectives/key-result-list";
import { ProgressBar } from "@/components/objectives/progress";
import { ObjectivesTabs } from "@/components/objectives/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { listProjects } from "@/server/modules/companies/service";
import { evaluateObjectives } from "@/server/modules/objectives/key-results";
import { departmentOptions, goalOptions, metricOptions, objectiveOwnerOptions } from "@/server/modules/objectives/pickers";
import { isUuid, listObjectives, OBJECTIVE_STATUSES, type ObjectiveFilters } from "@/server/modules/objectives/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.objectives.title") };
}

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

function filtersFrom(sp: SP): ObjectiveFilters {
  const status = first(sp.status);
  const goal = first(sp.goal);
  const dept = first(sp.department);
  const sort = first(sp.sort);
  return {
    q: first(sp.q)?.slice(0, 200),
    status: (OBJECTIVE_STATUSES as readonly string[]).includes(status ?? "") ? (status as ObjectiveFilters["status"]) : undefined,
    goalId: goal === "none" || isUuid(goal) ? goal : undefined,
    departmentId: isUuid(dept) ? dept : undefined,
    sort: sort === "target" || sort === "title" ? sort : "created",
  };
}

export default async function ObjectivesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <h1 className="text-lg font-semibold tracking-tight">{t("modules.objectives.title")}</h1>
        <p className="text-muted-foreground">{t("objectives.subtitle")}</p>
      </div>
      <ObjectivesTabs locale={locale} active="objectives" />
    </div>
  );
  if (!company) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      </div>
    );
  }
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage, canSeeProjects] = await Promise.all([can(viewer.ctx, "objectives.read", chain), can(viewer.ctx, "objectives.manage", chain), can(viewer.ctx, "projects.read", chain)]);
  if (!canRead) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </div>
    );
  }
  const filters = filtersFrom(await searchParams);
  const [objectives, projects, goals, departments, people, metrics] = await Promise.all([
    listObjectives(viewer.ctx, org.id, company.id, filters),
    canManage && canSeeProjects ? listProjects(viewer.ctx, org.id, company.id) : [],
    goalOptions(org.id, company.id),
    departmentOptions(org.id, company.id),
    canManage ? objectiveOwnerOptions(org.id, chain) : [],
    canManage ? metricOptions(viewer.ctx, chain, t) : [],
  ]);
  const evaluated = await evaluateObjectives(viewer.ctx, org.id, company.id, objectives, chain);
  const base = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const statusLabels = { label: t("common.status"), ACTIVE: t("objectives.status.ACTIVE"), ACHIEVED: t("objectives.status.ACHIEVED"), ABANDONED: t("objectives.status.ABANDONED") };
  const filtered = !!(filters.q || filters.status || filters.goalId || filters.departmentId);
  const pct = (v: number | null) => (v === null ? "—" : formatNumber(v, locale, { style: "percent", maximumFractionDigits: 0 }));

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <Card>
        <CardHeader title={t("objectives.list")} description={t("objectives.count", { count: objectives.length })} />
        {canManage ? <NewObjectiveForm base={base} goals={goals} departments={departments} people={people} /> : null}
        <form className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_9rem_12rem_12rem_9rem_auto] lg:items-end" role="search">
          <Input name="q" defaultValue={filters.q} placeholder={t("common.searchPlaceholder")} aria-label={t("common.searchPlaceholder")} />
          <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("common.status")}>
            <option value="">{t("common.all")}</option>
            {OBJECTIVE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`objectives.status.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="goal" defaultValue={filters.goalId ?? ""} aria-label={t("objectives.goal")}>
            <option value="">{t("objectives.allGoals")}</option>
            <option value="none">{t("objectives.noGoal")}</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
          <Select name="department" defaultValue={filters.departmentId ?? ""} aria-label={t("objectives.department")}>
            <option value="">{t("objectives.allDepartments")}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select name="sort" defaultValue={filters.sort} aria-label={t("objectives.sort.label")}>
            <option value="created">{t("objectives.sort.created")}</option>
            <option value="target">{t("objectives.sort.target")}</option>
            <option value="title">{t("objectives.sort.title")}</option>
          </Select>
          <Button type="submit" variant="secondary">
            {t("objectives.filter")}
          </Button>
        </form>
        {objectives.length === 0 ? <p className="p-4 text-muted-foreground">{filtered ? t("common.noResults") : t("objectives.empty")}</p> : null}
      </Card>
      {objectives.map((o, i) => {
        const done = o.milestones.filter((m) => m.completedAt).length;
        const progress = o.status === "ACHIEVED" ? 1 : (evaluated.objectives[i] ?? null);
        return (
          <Card key={o.id}>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {o.title}
                  {!canManage ? <Badge>{t(`objectives.status.${o.status}`)}</Badge> : null}
                  {o.goal ? <Badge tone="accent">{o.goal.title}</Badge> : null}
                  {o.department ? <Badge>{o.department.name}</Badge> : null}
                </span>
              }
              description={[
                o.owner ? t("objectives.ownedBy", { name: o.owner.name }) : null,
                o.targetDate ? t("objectives.target", { date: formatDate(o.targetDate, locale, "UTC") }) : null,
                t("objectives.progress", { done, total: o.milestones.length }),
              ]
                .filter(Boolean)
                .join(" · ")}
              actions={
                canManage ? (
                  <>
                    <ObjectiveStatusSelect base={base} objectiveId={o.id} status={o.status} labels={statusLabels} />
                    <EditObjectiveDialog
                      base={base}
                      goals={o.goal && !goals.some((g) => g.id === o.goal!.id) ? [...goals, { id: o.goal.id, name: o.goal.title }] : goals}
                      departments={departments}
                      people={people}
                      objective={{ id: o.id, title: o.title, description: o.description ?? "", startDate: iso(o.startDate), targetDate: iso(o.targetDate), goalId: o.goalId ?? "", ownerId: o.ownerId ?? "", departmentId: o.departmentId ?? "" }}
                    />
                    <DeleteButton endpoint={`${base}/objectives/${o.id}`} label={t("objectives.delete")} confirmText={t("objectives.deleteConfirm", { title: o.title })} />
                  </>
                ) : null
              }
            />
            <CardBody className="grid gap-4">
              {o.description ? <p className="text-sm text-muted-foreground">{o.description}</p> : null}
              <div className="grid gap-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t("objectives.overallProgress")}</span>
                  <span className="tabular">{pct(progress)}</span>
                </div>
                <ProgressBar value={progress} label={t("objectives.overallProgress")} />
              </div>
              <section className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{t("objectives.kr.heading")}</h3>
                  {canManage ? <NewKeyResultForm base={base} objectiveId={o.id} metrics={metrics} /> : null}
                </div>
                <KeyResultList t={t} locale={locale} currency={evaluated.currency} base={base} keyResults={o.keyResults} progress={evaluated.keyResults} canManage={canManage} metrics={metrics} />
              </section>
              <section className="grid gap-2">
                <h3 className="text-sm font-semibold">{t("objectives.milestones")}</h3>
                {o.milestones.length ? (
                  <ul className="grid gap-1.5">
                    {o.milestones.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center gap-2 text-sm">
                        {canManage ? <MilestoneToggle base={base} milestoneId={m.id} done={!!m.completedAt} label={m.title} /> : <span aria-hidden>{m.completedAt ? "✓" : "○"}</span>}
                        <span className={m.completedAt ? "text-muted-foreground line-through" : ""}>{m.title}</span>
                        {m.dueDate ? <span className="text-xs text-muted-foreground">{formatDate(m.dueDate, locale, "UTC")}</span> : null}
                        {m.project ? (
                          <Link href={`/${locale}/projects/${m.project.id}`} className="text-xs text-muted-foreground hover:underline">
                            {m.project.name}
                          </Link>
                        ) : null}
                        {m._count.tasks ? <Badge>{t("objectives.tasks", { count: m._count.tasks })}</Badge> : null}
                        {canManage && !m._count.tasks ? <DeleteButton endpoint={`${base}/milestones/${m.id}`} label={t("objectives.deleteMilestone")} confirmText={t("objectives.deleteMilestoneConfirm", { title: m.title })} /> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("objectives.noMilestones")}</p>
                )}
                {canManage && o.status === "ACTIVE" ? <NewMilestoneForm base={base} objectiveId={o.id} projects={projects.map((p) => ({ id: p.id, name: p.name }))} /> : null}
              </section>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
