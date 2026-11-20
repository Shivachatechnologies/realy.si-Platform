import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { getT } from "@/i18n/server";
import { AppError } from "@/server/core/errors";
import { projectSummary } from "@/server/modules/work/projects";
import { workContext } from "./context";
import { HEALTH_TONE, PROJECT_STATUS_TONE } from "./ui";
import { ProjectTabs } from "./views";

/** Loads a project sub-page: permissions, summary (404 when missing) and the header with tabs. */
export async function projectPage(projectId: string, active: string) {
  const t = await getT();
  const w = await workContext("projects", t("modules.projects.title"));
  if (w.gate) return { ...w, project: null, top: null } as const;
  const project = await projectSummary(w.viewer.ctx, w.org.id, w.company.id, projectId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const { locale } = w;
  const top = (
    <>
      <Link href={`/${locale}/projects`} className="text-sm text-muted-foreground hover:underline">
        ← {t("work.backToProjects")}
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold tracking-tight">{project.name}</h1>
        <Badge tone={PROJECT_STATUS_TONE[project.status]}>{t(`work.projectStatus.${project.status}`)}</Badge>
        <Badge tone={HEALTH_TONE[project.health]}>{t(`work.health.${project.health}`)}</Badge>
      </div>
      {project.archivedAt ? <Notice tone="warning">{t("work.project.archivedNotice")}</Notice> : null}
      <ProjectTabs t={t} locale={locale} projectId={project.id} active={active} />
    </>
  );
  return { ...w, project, top } as const;
}
