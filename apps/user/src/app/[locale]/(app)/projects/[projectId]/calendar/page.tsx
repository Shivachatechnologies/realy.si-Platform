import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { projectPage } from "@/components/work/project-page";
import { TaskCalendar } from "@/components/work/views";
import { getT } from "@/i18n/server";
import { monthRange } from "@/server/modules/work/calendar";
import { param } from "@/server/modules/work/shared";
import { calendarTasks } from "@/server/modules/work/tasks";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.tabs.calendar") };
}

export default async function ProjectCalendarPage({ params, searchParams }: PageProps<"/[locale]/projects/[projectId]/calendar">) {
  const { projectId } = await params;
  const raw = await searchParams;
  const t = await getT();
  const pg = await projectPage(projectId, "calendar");
  if (pg.gate) return pg.gate;
  const { locale, viewer, org, company, project, top } = pg;
  const r = monthRange(param(raw, "month"));
  const tasks = await calendarTasks(viewer.ctx, org.id, company.id, { from: r.from, to: r.to }, { projectId: project.id });
  const path = `/${locale}/projects/${project.id}/calendar`;
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {top}
      <Card>
        <TaskCalendar t={t} locale={locale} month={r.month} tasks={tasks} prevHref={`${path}?month=${r.prev}`} nextHref={`${path}?month=${r.next}`} todayHref={path} />
      </Card>
    </div>
  );
}
