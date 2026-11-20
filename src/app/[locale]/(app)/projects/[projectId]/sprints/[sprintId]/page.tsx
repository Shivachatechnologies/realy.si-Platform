import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AiButton } from "@/components/work/actions";
import { AiPanel } from "@/components/work/ai-panel";
import { projectPage } from "@/components/work/project-page";
import { EditSprintForm, RemoveFromSprintButton, RetroForm, RetroItemActions, SprintControls } from "@/components/work/sprint-forms";
import { Facts, PRIORITY_TONE, STATUS_TONE, StatCard } from "@/components/work/ui";
import { BurndownChart } from "@/components/work/views";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { getSprint } from "@/server/modules/work/agile";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.agile.sprint") };
}

const KINDS = ["WENT_WELL", "TO_IMPROVE", "ACTION"] as const;

export default async function SprintPage({ params }: PageProps<"/[locale]/projects/[projectId]/sprints/[sprintId]">) {
  const { projectId, sprintId } = await params;
  const t = await getT();
  const pg = await projectPage(projectId, "sprints");
  if (pg.gate) return pg.gate;
  const { locale, viewer, org, company, canManage, canRunAgents, base, project, top, tz } = pg;
  const s = await getSprint(viewer.ctx, org.id, company.id, sprintId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  if (s.projectId !== project.id) notFound();
  const aiTasks = canRunAgents ? await listSubjectTasks(viewer.ctx, org.id, company.id, "sprint", s.id) : [];
  const manage = canManage && !project.archivedAt;
  const day = (d: Date | null) => (d ? formatDate(d, locale, "UTC") : "—");
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const last = s.burndown.series.filter((b) => b.remaining != null).at(-1);
  const behind = last && last.remaining! > last.ideal;
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {top}
      <Link href={`/${locale}/projects/${project.id}/sprints`} className="text-sm text-muted-foreground hover:underline">
        ← {t("work.agile.allSprints")}
      </Link>
      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              {s.name}
              <Badge tone={s.status === "ACTIVE" ? "accent" : s.status === "COMPLETED" ? "success" : "neutral"}>{t(`work.sprintStatus.${s.status}`)}</Badge>
            </span>
          }
          actions={
            <Link href={`/${locale}/projects/${project.id}/board?sprint=${s.id}`} className="text-xs text-muted-foreground hover:underline">
              {t("work.agile.openBoard")}
            </Link>
          }
        />
        <CardBody className="grid gap-4">
          {s.goal ? (
            <p className="text-sm">
              <span className="text-muted-foreground">{t("work.agile.goal")}: </span>
              {s.goal}
            </p>
          ) : null}
          <Facts
            cols={5}
            items={[
              [t("work.agile.dates"), `${day(s.startDate)} – ${day(s.endDate)}`],
              [t("work.agile.capacity"), s.capacityPoints ?? "—"],
              [t("work.agile.committed"), s.committedPoints ?? "—"],
              [t("work.agile.completed"), s.status === "COMPLETED" ? (s.completedPoints ?? 0) : s.totals.donePoints],
              [t("work.agile.scope"), s.totals.points],
            ]}
          />
          {manage ? <SprintControls base={base} locale={locale} projectId={project.id} sprint={s} planned={s.plannedSprints} /> : null}
          {manage && s.status !== "COMPLETED" ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium">{t("work.agile.editSprint")}</summary>
              <div className="pt-3">
                <EditSprintForm base={base} sprintId={s.id} initial={{ name: s.name, goal: s.goal ?? "", startDate: iso(s.startDate), endDate: iso(s.endDate), capacityPoints: s.capacityPoints == null ? "" : String(s.capacityPoints) }} />
              </div>
            </details>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t("work.agile.tasksDone")} value={`${s.totals.done}/${s.totals.tasks}`} />
        <StatCard label={t("work.agile.pointsDone")} value={`${s.totals.donePoints}/${s.totals.points}`} />
        <StatCard label={t("work.agile.trend")} value={last ? (behind ? t("work.agile.behind") : t("work.agile.onTrack")) : "—"} tone={last ? (behind ? "warning" : "success") : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title={t("work.agile.burndown")} description={t("work.agile.burndownHint")} />
          <CardBody>{s.status === "PLANNED" ? <p className="text-sm text-muted-foreground">{t("work.agile.burndownNotStarted")}</p> : <BurndownChart t={t} series={s.burndown.series} scope={s.burndown.scope} />}</CardBody>
        </Card>
        {canRunAgents ? (
          <AiPanel
            t={t}
            locale={locale}
            tz={tz}
            title={t("work.ai.title")}
            description={t("work.ai.sprintHint")}
            configured={aiConfigured()}
            tasks={aiTasks}
            actions={<AiButton url={`${base}/sprints/${s.id}/ai`} label={t("work.ai.analyzeSprint")} />}
          />
        ) : null}
      </div>

      <Card>
        <CardHeader title={t("work.agile.sprintTasks")} description={t("work.task.count", { count: s.tasks.length })} />
        {s.tasks.length ? (
          <ul className="grid divide-y">
            {s.tasks.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <Badge tone={STATUS_TONE[x.status]}>{t(`work.taskStatus.${x.status}`)}</Badge>
                <Link href={`/${locale}/projects/tasks/${x.id}`} className="min-w-0 flex-1 truncate hover:underline">
                  {x.title}
                </Link>
                <Badge tone={PRIORITY_TONE[x.priority]}>{t(`work.priority.${x.priority}`)}</Badge>
                <span className="w-28 truncate text-xs text-muted-foreground">{x.assignee?.name ?? t("work.unassigned")}</span>
                <span className="w-10 text-end text-xs tabular-nums text-muted-foreground">{x.estimatePoints ?? "—"}</span>
                {manage && s.status !== "COMPLETED" ? <RemoveFromSprintButton base={base} sprintId={s.id} taskId={x.id} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("work.agile.sprintEmpty")}</p>
        )}
      </Card>

      <Card>
        <CardHeader title={t("work.retro.title")} description={t("work.retro.hint")} />
        <CardBody className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-3">
            {KINDS.map((k) => (
              <section key={k} className="grid content-start gap-2 rounded-md border p-3">
                <h3 className="text-sm font-medium">{t(`work.retro.kinds.${k}`)}</h3>
                <ul className="grid gap-2 text-sm">
                  {s.retro
                    .filter((r) => r.kind === k)
                    .map((r) => (
                      <li key={r.id} className="grid gap-0.5 rounded bg-surface-2 p-2">
                        <span className="whitespace-pre-wrap">{r.text}</span>
                        <span className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
                          {r.authorName ?? ""}
                          {r.taskId ? (
                            <Link href={`/${locale}/projects/tasks/${r.taskId}`} className="hover:underline">
                              {t("work.retro.viewTask")}
                            </Link>
                          ) : null}
                          <RetroItemActions base={base} itemId={r.id} canDelete={manage || r.authorId === viewer.user.id} canTask={manage && k === "ACTION" && !r.taskId} />
                        </span>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
          {!project.archivedAt ? <RetroForm base={base} sprintId={s.id} /> : null}
        </CardBody>
      </Card>
    </div>
  );
}
