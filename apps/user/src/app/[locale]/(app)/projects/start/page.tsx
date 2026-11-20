import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CalendarRange } from "lucide-react";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { introLabels } from "@/components/guide-kit/server";
import { Stepper } from "@/components/guide-kit/stepper";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { workContext } from "@/components/work/context";
import { KickoffAssign, KickoffDescribe, KickoffPlan } from "@/components/work/kickoff";
import { Timeline, ProjectsAreaTabs } from "@/components/work/views";
import { formatRelativeTime } from "@/i18n/format";
import { getT } from "@/i18n/server";
import { AppError } from "@/server/core/errors";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { getKickoff, listKickoffs } from "@/server/modules/work/kickoff";
import { projectSummary } from "@/server/modules/work/projects";
import { dayString, listPeople, today } from "@/server/modules/work/shared";
import { timelineTasks, workload } from "@/server/modules/work/tasks";
import { db } from "@/server/core/db";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.start.title") };
}

const STEPS = ["describe", "plan", "assign", "timeline"] as const;

export default async function ProjectStartPage({ searchParams }: PageProps<"/[locale]/projects/start">) {
  const t = await getT();
  const w = await workContext("projects", t("work.start.title"), t("work.start.subtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, canRunAgents } = w;
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const sp = await searchParams;
  const kId = typeof sp.k === "string" ? sp.k : undefined;
  const aiReady = aiConfigured() && canRunAgents;
  const intro = <PageIntro labels={introLabels(t)} what={t("work.start.intro.what")} why={t("work.start.intro.why")} can={t("work.start.intro.can")} accent="info" />;
  if (!canManage) {
    return (
      <div className="mx-auto grid max-w-[1100px] min-w-0 gap-4">
        {w.header}
        <Notice tone="warning">{t("work.start.manageOnly")}</Notice>
      </div>
    );
  }
  const stepper = (current: number, reached = current) => (
    <Stepper steps={STEPS.map((k, i) => ({ key: k, label: t(`work.start.steps.${k}`), href: i === 0 ? "?" : kId ? `?k=${kId}` : undefined }))} current={current} reached={reached} label={t("work.start.progress")} />
  );

  if (!kId) {
    const resume = await listKickoffs(viewer.ctx, org.id, company.id);
    return (
      <div className="mx-auto grid max-w-[1100px] min-w-0 gap-4">
        {w.header}
        <ProjectsAreaTabs t={t} locale={locale} active="start" />
        {intro}
        <Card variant="elevated">
          <CardHeader title={t("work.start.q.describe")} description={t("work.start.qHint.describe")} />
          <CardBody className="grid gap-5">
            {stepper(0)}
            <KickoffDescribe base={apiBase} aiReady={aiReady} />
          </CardBody>
        </Card>
        {resume.length ? (
          <Card>
            <CardHeader title={t("work.start.resume.title")} />
            <ul className="divide-y">
              {resume.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">{k.description}</span>
                  <Badge>{t(`work.start.steps.${k.step === "assign" ? "assign" : "plan"}`)}</Badge>
                  <span className="text-xs text-muted-foreground">{formatRelativeTime(k.updatedAt, locale)}</span>
                  <Link href={`?k=${k.id}`} className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "gap-1")}>
                    {t("work.start.resume.continue")} <ArrowRight className="rtl:-scale-x-100" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    );
  }

  const data = await getKickoff(viewer.ctx, org.id, company.id, kId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const { kickoff, task } = data;
  const current = kickoff.projectId ? (kickoff.step === "done" ? 3 : 2) : 1;
  let body: React.ReactNode = null;
  let title = t(`work.start.q.${STEPS[current]}`);
  if (current === 1) {
    const people = await listPeople(viewer.ctx, org.id, company.id);
    body = (
      <KickoffPlan
        base={apiBase}
        kickoffId={kickoff.id}
        initial={task ? { id: task.id, title: task.title, status: task.status, output: task.output, errorMessage: task.errorMessage } : null}
        people={people}
        start={dayString(kickoff.startDate ?? today())!}
      />
    );
  } else if (current === 2) {
    const [people, load, tasks] = await Promise.all([
      listPeople(viewer.ctx, org.id, company.id),
      workload(viewer.ctx, org.id, company.id),
      db().workTask.findMany({ where: { organizationId: org.id, companyId: company.id, projectId: kickoff.projectId!, archivedAt: null }, orderBy: { position: "asc" }, select: { id: true, title: true, assigneeId: true }, take: 200 }),
    ]);
    body = <KickoffAssign base={apiBase} kickoffId={kickoff.id} tasks={tasks} people={people.map((p) => ({ ...p, open: load.find((l) => l.userId === p.id)?.open ?? 0, overdue: load.find((l) => l.userId === p.id)?.overdue ?? 0 }))} />;
  } else {
    const [project, tl] = await Promise.all([projectSummary(viewer.ctx, org.id, company.id, kickoff.projectId!), timelineTasks(viewer.ctx, org.id, company.id, kickoff.projectId!)]);
    title = t("work.start.q.timeline");
    body = (
      <div className="grid gap-4">
        <Notice tone="success" title={t("work.start.done.title", { name: project.name })}>
          {t("work.start.done.body")}
        </Notice>
        <div className="rounded-lg border">
          <Timeline t={t} locale={locale} tasks={tl.tasks} deps={tl.deps} milestones={project.projectMilestones} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/${locale}/projects/${project.id}`} className={cn(buttonVariants(), "gap-1.5")}>
            <CalendarRange aria-hidden /> {t("work.start.done.open")}
          </Link>
          <Link href={`/${locale}/projects/${project.id}/board`} className={buttonVariants({ variant: "secondary" })}>
            {t("work.start.done.board")}
          </Link>
          <Link href="?" className={buttonVariants({ variant: "ghost" })}>
            {t("work.start.done.another")}
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {w.header}
      <ProjectsAreaTabs t={t} locale={locale} active="start" />
      {intro}
      <Card variant="elevated">
        <CardHeader title={title} description={t(`work.start.qHint.${STEPS[current]}`)} />
        <CardBody className="grid gap-5">
          {stepper(current)}
          <p className="rounded-md bg-surface-2/60 px-3 py-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{t("work.start.youSaid")}</span> {kickoff.description}
          </p>
          {body}
        </CardBody>
      </Card>
    </div>
  );
}
