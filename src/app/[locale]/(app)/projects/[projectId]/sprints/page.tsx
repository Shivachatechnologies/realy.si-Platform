import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { projectPage } from "@/components/work/project-page";
import { NewSprintForm, SprintPlanner } from "@/components/work/sprint-forms";
import { QuickTaskForm } from "@/components/work/task-forms";
import { Progress, StatCard } from "@/components/work/ui";
import { VelocityChart } from "@/components/work/views";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { projectAgile } from "@/server/modules/work/agile";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.tabs.sprints") };
}

const SPRINT_TONE = { PLANNED: "neutral", ACTIVE: "accent", COMPLETED: "success" } as const;

export default async function SprintsPage({ params }: PageProps<"/[locale]/projects/[projectId]/sprints">) {
  const { projectId } = await params;
  const t = await getT();
  const pg = await projectPage(projectId, "sprints");
  if (pg.gate) return pg.gate;
  const { locale, viewer, org, company, canManage, base, project, top } = pg;
  const a = await projectAgile(viewer.ctx, org.id, company.id, project.id);
  const manage = canManage && !project.archivedAt;
  const day = (d: Date) => formatDate(d, locale, "UTC");
  const open = a.sprints.filter((s) => s.status !== "COMPLETED");
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {top}
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label={t("work.agile.avgVelocity")} value={a.avgVelocity ?? "—"} hint={t("work.agile.pointsPerSprint")} />
        <StatCard label={t("work.agile.backlogSize")} value={a.backlog.length} hint={t("work.pointsShort", { count: a.backlogPoints })} />
        <StatCard label={t("work.agile.activeSprint")} value={a.sprints.find((s) => s.status === "ACTIVE")?.name ?? "—"} />
        <StatCard label={t("work.agile.completedSprints")} value={a.sprints.filter((s) => s.status === "COMPLETED").length} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title={t("work.agile.sprints")} />
          {a.sprints.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("work.agile.sprintName")}</Th>
                  <Th>{t("work.task.status")}</Th>
                  <Th>{t("work.agile.dates")}</Th>
                  <Th className="min-w-36">{t("work.agile.points")}</Th>
                </Tr>
              </THead>
              <TBody>
                {a.sprints.map((s) => (
                  <Tr key={s.id}>
                    <Td>
                      <Link href={`/${locale}/projects/${project.id}/sprints/${s.id}`} className="font-medium hover:underline">
                        {s.name}
                      </Link>
                      {s.goal ? <p className="max-w-80 truncate text-xs text-muted-foreground">{s.goal}</p> : null}
                    </Td>
                    <Td>
                      <Badge tone={SPRINT_TONE[s.status]}>{t(`work.sprintStatus.${s.status}`)}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-muted-foreground">
                      {day(s.startDate)} – {day(s.endDate)}
                    </Td>
                    <Td>
                      <Progress value={s.points ? (s.donePoints / s.points) * 100 : 0} label={t("work.agile.pointsOf", { done: s.donePoints, total: s.points })} />
                      {s.capacityPoints != null ? <span className={`text-xs ${s.points > s.capacityPoints ? "text-danger" : "text-muted-foreground"}`}>{t("work.agile.capacityUse", { points: s.points, capacity: s.capacityPoints })}</span> : null}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("work.agile.noSprints")}</p>
          )}
          {manage ? (
            <details className="border-t">
              <summary className="cursor-pointer p-3 text-sm font-medium">{t("work.agile.createSprint")}</summary>
              <NewSprintForm base={base} projectId={project.id} suggestedName={t("work.agile.sprintN", { n: a.sprints.length + 1 })} />
            </details>
          ) : null}
        </Card>
        <Card>
          <CardHeader title={t("work.agile.velocity")} description={t("work.agile.velocityHint")} />
          <CardBody>
            <VelocityChart t={t} data={a.velocity} />
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title={t("work.agile.backlog")} description={t("work.agile.backlogHint")} />
        {manage ? (
          <div className="border-b p-3">
            <QuickTaskForm base={base} projectId={project.id} status="BACKLOG" label={t("work.agile.addToBacklog")} />
          </div>
        ) : null}
        {a.backlog.length ? (
          <SprintPlanner
            base={base}
            locale={locale}
            tasks={a.backlog.map((x) => ({ id: x.id, title: x.title, priority: x.priority, points: x.estimatePoints, assigneeName: x.assignee?.name ?? null }))}
            sprints={manage ? open.map((s) => ({ id: s.id, name: s.name, points: s.points, capacity: s.capacityPoints })) : []}
          />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("work.agile.backlogEmpty")}</p>
        )}
      </Card>
    </div>
  );
}
