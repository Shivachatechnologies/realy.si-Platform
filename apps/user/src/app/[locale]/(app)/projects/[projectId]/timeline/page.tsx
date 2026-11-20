import type { Metadata } from "next";
import { Card, CardHeader } from "@/components/ui/card";
import { ProjectGantt } from "@/components/projects/gantt";
import { projectPage } from "@/components/work/project-page";
import { getT } from "@/i18n/server";
import { timelineTasks } from "@/server/modules/work/tasks";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.tabs.timeline") };
}

export default async function TimelinePage({ params }: PageProps<"/[locale]/projects/[projectId]/timeline">) {
  const { projectId } = await params;
  const t = await getT();
  const pg = await projectPage(projectId, "timeline");
  if (pg.gate) return pg.gate;
  const { locale, viewer, org, company, project, top } = pg;
  const { tasks, deps } = await timelineTasks(viewer.ctx, org.id, company.id, project.id);
  return (
    <div className="mx-auto grid max-w-[1600px] min-w-0 gap-4">
      {top}
      <Card variant="elevated">
        <CardHeader title={t("projectsGantt.title")} description={t("projectsGantt.hint")} />
        <ProjectGantt t={t} locale={locale} tasks={tasks} deps={deps} milestones={project.projectMilestones} hrefFor={(id) => `/${locale}/projects/tasks/${id}`} />
      </Card>
    </div>
  );
}
