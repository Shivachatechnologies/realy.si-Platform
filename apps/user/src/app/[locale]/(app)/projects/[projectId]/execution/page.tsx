import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { projectPage } from "@/components/work/project-page";
import { HEALTH_TONE, PRIORITY_TONE, Progress, StatCard, STATUS_TONE } from "@/components/work/ui";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { db } from "@/server/core/db";
import { executionStatus } from "@/server/modules/work/execution";
import { userNames } from "@/server/modules/work/shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.tabs.execution") };
}

/** Execution tracking: progress per milestone, ready and blocked work, root blockers and the computed health. */
export default async function ExecutionPage({ params }: PageProps<"/[locale]/projects/[projectId]/execution">) {
  const { projectId } = await params;
  const t = await getT();
  const pg = await projectPage(projectId, "execution");
  if (pg.gate) return pg.gate;
  const { locale, viewer, org, company, project, top } = pg;
  const s = await executionStatus(viewer.ctx, org.id, company.id, project.id);
  const names = await userNames(db(), [...s.ready, ...s.blocked, ...s.blockers].map((x) => x.assigneeId));
  const day = (d: Date | null) => (d ? formatDate(d, locale, "UTC") : "—");
  const who = (id: string | null) => (id ? (names.get(id) ?? "—") : t("work.execution.unassigned"));
  const taskLink = (id: string, title: string) => (
    <Link href={`/${locale}/projects/tasks/${id}`} className="font-medium hover:underline">
      {title}
    </Link>
  );
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {top}
      <p className="text-sm text-muted-foreground">{t("work.execution.intro")}</p>
      {s.objectives.length ? (
        <Notice tone="info" title={t("work.execution.objectives")}>
          {s.objectives.map((o, i) => (
            <span key={o.milestoneId}>
              {i ? " · " : ""}
              <Link href={`/${locale}/objectives/${o.objectiveId}`} className="underline">
                {o.objectiveTitle}
              </Link>
              {o.completedAt ? ` (${t("work.execution.milestoneDone")})` : ""}
            </span>
          ))}
        </Notice>
      ) : null}
      {s.complete ? <Notice tone="success">{t("work.execution.complete")}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label={t("work.execution.health")} value={<Badge tone={HEALTH_TONE[s.health]}>{t(`work.health.${s.health}`)}</Badge>} hint={s.health !== s.manualHealth ? t("work.execution.manualHealth", { health: t(`work.health.${s.manualHealth}`) }) : undefined} />
        <StatCard label={t("work.execution.progress")} value={`${s.totals.progress}%`} hint={t("work.execution.doneOf", { done: s.totals.done, total: s.totals.total })} />
        <StatCard label={t("work.execution.ready")} value={s.totals.ready} />
        <StatCard label={t("work.execution.blocked")} value={s.totals.blocked} tone={s.totals.blocked ? "warning" : undefined} />
        <StatCard label={t("work.execution.overdue")} value={s.totals.overdue} tone={s.totals.overdue ? "danger" : undefined} />
        <StatCard
          label={t("work.execution.projected")}
          value={s.complete ? "—" : day(s.projectedFinish)}
          tone={s.projectedLate ? "danger" : undefined}
          hint={s.complete ? undefined : t("work.execution.criticalDays", { count: s.criticalDays })}
        />
      </div>
      <Card>
        <CardHeader title={t("work.execution.blockersTitle")} description={t("work.execution.blockersHint")} />
        {s.blockers.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("work.execution.task")}</Th>
                <Th>{t("work.execution.owner")}</Th>
                <Th>{t("work.execution.due")}</Th>
                <Th className="text-end">{t("work.execution.waiting")}</Th>
                <Th>{t("work.execution.why")}</Th>
              </Tr>
            </THead>
            <TBody>
              {s.blockers.map((b) => (
                <Tr key={b.id}>
                  <Td>
                    {taskLink(b.id, b.title)} <Badge tone={STATUS_TONE[b.status]}>{t(`work.taskStatus.${b.status}`)}</Badge>
                    {b.externalProjectId ? <span className="block text-xs text-muted-foreground">{t("work.execution.otherProject")}</span> : null}
                  </Td>
                  <Td>{who(b.assigneeId)}</Td>
                  <Td>{day(b.dueDate)}</Td>
                  <Td className="text-end tabular-nums">{b.waiting}</Td>
                  <Td className="text-xs">{b.reasons.length ? b.reasons.map((r) => t(`work.execution.reasons.${r}`)).join(", ") : b.root ? "—" : t("work.execution.waitingItself")}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <CardBody>
            <p className="text-sm text-muted-foreground">{t("work.execution.noBlockers")}</p>
          </CardBody>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("work.execution.readyTitle")} description={t("work.execution.readyHint")} />
          {s.ready.length ? (
            <ul className="grid divide-y text-sm">
              {s.ready.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <Badge tone={PRIORITY_TONE[x.priority]}>{t(`work.priority.${x.priority}`)}</Badge>
                  <span className="min-w-0 flex-1 truncate">{taskLink(x.id, x.title)}</span>
                  <span className="text-xs text-muted-foreground">{who(x.assigneeId)}</span>
                  <span className="text-xs text-muted-foreground">{day(x.dueDate)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody>
              <p className="text-sm text-muted-foreground">{t("work.execution.noReady")}</p>
            </CardBody>
          )}
        </Card>
        <Card>
          <CardHeader title={t("work.execution.milestonesTitle")} />
          {s.milestones.length ? (
            <ul className="grid divide-y text-sm">
              {s.milestones.map((m) => (
                <li key={m.id} className="grid gap-1 px-4 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{m.title}</span>
                    {m.completedAt ? <Badge tone="success">{t("work.execution.milestoneDone")}</Badge> : m.late ? <Badge tone="danger">{t("work.execution.late")}</Badge> : null}
                    <span className="text-xs text-muted-foreground">{day(m.dueDate)}</span>
                  </div>
                  <Progress value={m.total ? (m.done / m.total) * 100 : 0} label={t("work.execution.doneOf", { done: m.done, total: m.total })} tone={m.late ? "danger" : undefined} />
                </li>
              ))}
            </ul>
          ) : (
            <CardBody>
              <p className="text-sm text-muted-foreground">{t("work.execution.noMilestones")}</p>
            </CardBody>
          )}
        </Card>
      </div>
      {s.stalled.length ? (
        <Card>
          <CardHeader title={t("work.execution.stalledTitle")} />
          <ul className="grid divide-y text-sm">
            {s.stalled.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <Badge tone={STATUS_TONE[x.status]}>{t(`work.taskStatus.${x.status}`)}</Badge>
                <span className="min-w-0 flex-1 truncate">{taskLink(x.id, x.title)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {s.truncated ? <p className="text-xs text-muted-foreground">{t("work.execution.truncated")}</p> : null}
    </div>
  );
}
