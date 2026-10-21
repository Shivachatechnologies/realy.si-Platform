import type { Metadata } from "next";
import Link from "next/link";
import { MilestoneToggle, NewMilestoneForm, NewObjectiveForm, ObjectiveStatusSelect } from "@/components/objectives/objective-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { db } from "@/server/core/db";
import { listProjects } from "@/server/modules/companies/service";
import { listObjectives } from "@/server/modules/objectives/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.objectives.title") };
}

export default async function ObjectivesPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <div className="grid gap-1">
      <h1 className="text-lg font-semibold tracking-tight">{t("modules.objectives.title")}</h1>
      <p className="text-muted-foreground">{t("objectives.subtitle")}</p>
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
  const [canRead, canManage, canSeeProjects] = await Promise.all([
    can(viewer.ctx, "objectives.read", chain),
    can(viewer.ctx, "objectives.manage", chain),
    can(viewer.ctx, "projects.read", chain),
  ]);
  if (!canRead) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </div>
    );
  }
  const [objectives, projects] = await Promise.all([listObjectives(viewer.ctx, org.id, company.id), canSeeProjects ? listProjects(viewer.ctx, org.id, company.id) : []]);
  const base = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const statusLabels = { label: t("common.status"), ACTIVE: t("objectives.status.ACTIVE"), ACHIEVED: t("objectives.status.ACHIEVED"), ABANDONED: t("objectives.status.ABANDONED") };

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <Card>
        <CardHeader title={t("objectives.list")} description={t("objectives.count", { count: objectives.length })} />
        {canManage ? <NewObjectiveForm base={base} /> : null}
        {objectives.length === 0 ? <p className="p-4 text-muted-foreground">{t("objectives.empty")}</p> : null}
      </Card>
      {objectives.map((o) => {
        const done = o.milestones.filter((m) => m.completedAt).length;
        return (
          <Card key={o.id}>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {o.title}
                  {!canManage ? <Badge>{t(`objectives.status.${o.status}`)}</Badge> : null}
                </span>
              }
              description={[
                o.targetDate ? t("objectives.target", { date: formatDate(o.targetDate, locale, "UTC") }) : null,
                t("objectives.progress", { done, total: o.milestones.length }),
              ]
                .filter(Boolean)
                .join(" · ")}
              actions={canManage ? <ObjectiveStatusSelect base={base} objectiveId={o.id} status={o.status} labels={statusLabels} /> : null}
            />
            <CardBody className="grid gap-3">
              {o.milestones.length ? (
                <ul className="grid gap-1.5">
                  {o.milestones.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-2 text-sm">
                      {canManage ? <MilestoneToggle base={base} milestoneId={m.id} done={!!m.completedAt} label={m.title} /> : <span aria-hidden>{m.completedAt ? "✓" : "○"}</span>}
                      <span className={m.completedAt ? "text-muted-foreground line-through" : ""}>{m.title}</span>
                      {m.dueDate ? <span className="text-xs text-muted-foreground">{formatDate(m.dueDate, locale, "UTC")}</span> : null}
                      {m.project ? (
                        <Link href={`/${locale}/projects`} className="text-xs text-muted-foreground hover:underline">
                          {m.project.name}
                        </Link>
                      ) : null}
                      {m._count.tasks ? <Badge>{t("objectives.tasks", { count: m._count.tasks })}</Badge> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("objectives.noMilestones")}</p>
              )}
              {canManage && o.status === "ACTIVE" ? <NewMilestoneForm base={base} objectiveId={o.id} projects={projects.map((p) => ({ id: p.id, name: p.name }))} /> : null}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
