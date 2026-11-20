import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CalendarClock, Sparkles, UserCheck, UserPlus, Users } from "lucide-react";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { introLabels, latestSubjectTask } from "@/components/guide-kit/server";
import { Stepper } from "@/components/guide-kit/stepper";
import { Term } from "@/components/guide-kit/term";
import { HelpMeButton } from "@/components/guide-kit/help-me";
import {
  AddCandidateForm,
  BackLink,
  CandidateQuickActions,
  DescribeStep,
  HireForm,
  InterviewScheduler,
  InterviewStatusButtons,
  NextStepButton,
  PublishStep,
  RoleStep,
  ScreenButton,
} from "@/components/hr/hire-journey";
import { Avatar, HiringFunnel, TeamHealthStrip } from "@/components/hr/people-visuals";
import { HrFrame, loadHr, personName } from "@/components/hr/shell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatDateTime, formatRelativeTime } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { AppError } from "@/server/core/errors";
import { env } from "@/server/core/env";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { employeeOptions } from "@/server/modules/hr/employees";
import { getHiringJourney, HIRING_STEPS, hiringPipeline, listHiringJourneys, screeningStatus, teamHealth, type HiringStep } from "@/server/modules/hr/hiring";
import { listDepartments } from "@/server/modules/hr/org";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.hire.title") };
}

const STORED_TO_STEP: Record<string, HiringStep> = { describe: "describe", publish: "publish", candidates: "candidates", interviews: "interviews", hire: "hire", done: "hire" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function HirePage({ searchParams }: PageProps<"/[locale]/hr/hire">) {
  const locale = await getLocale();
  const { t, viewer, org, company, access, base, tz } = await loadHr(locale);
  const allowed = !!access?.manage;
  const frame = { t, locale, title: t("hr.hire.title"), subtitle: t("hr.hire.subtitle"), tab: "hire" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const sp = await searchParams;
  const jobId = one(sp.job);
  const askedStep = one(sp.step) as HiringStep | undefined;
  const aiReady = aiConfigured() && !!access!.agentsRun;

  const [health, journeys] = await Promise.all([teamHealth(viewer.ctx, org.id, company.id), listHiringJourneys(viewer.ctx, org.id, company.id)]);
  const healthStrip = (
    <TeamHealthStrip
      data={health}
      labels={{ headcount: t("hr.hire.health.headcount"), onboarding: (n) => t("hr.hire.health.onboarding", { count: n }), onLeave: t("hr.hire.health.onLeave"), openRoles: t("hr.hire.health.openRoles"), applicants: t("hr.hire.health.applicants") }}
      hrefs={{ people: `/${locale}/hr/employees`, leave: `/${locale}/hr/leave`, hiring: `/${locale}/hr/recruiting` }}
    />
  );
  const stepLabels = HIRING_STEPS.map((k) => ({ key: k, label: t(`hr.hire.steps.${k}`) }));
  const intro = (next?: { label: string; href: string }) => (
    <PageIntro labels={introLabels(t)} what={t("hr.hire.intro.what")} why={t("hr.hire.intro.why")} can={t("hr.hire.intro.can")} next={next} accent="success" />
  );

  // ── Steps 1–2: before a job exists ─────────────────────────────────────────────────────────────────────────────
  if (!jobId) {
    const step = askedStep === "role" ? 1 : 0;
    const departments = step === 1 ? await listDepartments(viewer.ctx, org.id, company.id) : [];
    return (
      <HrFrame {...frame}>
        {intro(step === 0 ? { label: t("hr.hire.need.yes"), href: `?step=role` } : undefined)}
        {healthStrip}
        <Card variant="elevated">
          <CardHeader title={t(`hr.hire.q.${HIRING_STEPS[step]}`)} description={t(`hr.hire.qHint.${HIRING_STEPS[step]}`)} />
          <CardBody className="grid gap-5">
            <Stepper steps={stepLabels.map((s, i) => ({ ...s, href: i === 0 ? "?" : undefined }))} current={step} label={t("hr.hire.progress")} />
            {step === 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Link href="?step=role" className="hover-lift grid gap-1 rounded-lg border-gradient p-4 shadow-glow [--gradient-fill:linear-gradient(135deg,color-mix(in_oklch,var(--primary)_8%,var(--surface)),var(--surface))]">
                  <span className="flex items-center gap-2 font-medium">
                    <UserPlus className="size-4 text-primary" aria-hidden /> {t("hr.hire.need.yes")} <Badge tone="brand" shape="pill">{t("hr.hire.recommended")}</Badge>
                  </span>
                  <span className="text-sm text-muted-foreground">{t("hr.hire.need.yesHint")}</span>
                </Link>
                <Link href={`/${locale}/hr/employees`} className="hover-lift grid gap-1 rounded-lg border p-4">
                  <span className="flex items-center gap-2 font-medium">
                    <Users className="size-4 text-muted-foreground" aria-hidden /> {t("hr.hire.need.no")}
                  </span>
                  <span className="text-sm text-muted-foreground">{t("hr.hire.need.noHint")}</span>
                </Link>
              </div>
            ) : (
              <>
                <BackLink href="?" label={t("hr.hire.back")} />
                <RoleStep base={base} departments={departments.map((d) => ({ id: d.id, name: d.name }))} />
              </>
            )}
          </CardBody>
        </Card>
        {journeys.length ? (
          <Card>
            <CardHeader title={t("hr.hire.resume.title")} description={t("hr.hire.resume.hint")} />
            <ul className="divide-y">
              {journeys.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{j.job.title}</span>
                    <span className="ms-2 text-xs text-muted-foreground">{t("hr.hire.resume.at", { step: t(`hr.hire.steps.${STORED_TO_STEP[j.step] ?? "describe"}`) })}</span>
                  </span>
                  <Badge tone={j.job.status === "OPEN" ? "success" : "neutral"}>{t(`hr.jobStatus.${j.job.status}`)}</Badge>
                  <span className="text-xs text-muted-foreground">{t("hr.hire.resume.candidates", { count: j.candidates })}</span>
                  <span className="text-xs text-muted-foreground">{formatRelativeTime(j.updatedAt, locale)}</span>
                  <Link href={`?job=${j.jobId}`} className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "gap-1")}>
                    {t("hr.hire.resume.continue")} <ArrowRight className="rtl:-scale-x-100" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </HrFrame>
    );
  }

  // ── Steps 3–7: working on a real job ───────────────────────────────────────────────────────────────────────────
  const data = await getHiringJourney(viewer.ctx, org.id, company.id, jobId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const { job, journey, interviews } = data;
  if (!journey) notFound();
  const reached = HIRING_STEPS.indexOf(STORED_TO_STEP[journey.step] ?? "describe");
  const askedIdx = askedStep ? HIRING_STEPS.indexOf(askedStep) : -1;
  const current = askedIdx >= 2 && askedIdx <= reached ? askedIdx : reached;
  const step = HIRING_STEPS[current]!;
  const steps = stepLabels.map((s, i) => ({ ...s, href: i >= 2 ? `?job=${job.id}&step=${s.key}` : i === 0 ? "?" : undefined }));
  const candidateIds = job.candidates.map((c) => c.id);
  const [describeTask, screening, pipeline, people] = await Promise.all([
    step === "describe" ? latestSubjectTask(viewer.ctx, org.id, company.id, "hr_job", job.id) : Promise.resolve(null),
    step === "candidates" ? screeningStatus(viewer.ctx, org.id, company.id, candidateIds) : Promise.resolve({ active: 0, completed: 0, failed: 0 }),
    hiringPipeline(viewer.ctx, org.id, company.id, job.id),
    step === "interviews" || step === "hire" ? employeeOptions(viewer.ctx, org.id, company.id) : Promise.resolve([]),
  ]);
  const careersUrl = `${env().APP_URL.replace(/\/$/, "")}/${locale}/careers/${company.id}/${job.id}`;
  const stageLabels = { APPLIED: t("hr.hire.stage.APPLIED"), SCREENING: t("hr.hire.stage.SCREENING"), INTERVIEW: t("hr.hire.stage.INTERVIEW"), OFFER: t("hr.hire.stage.OFFER"), HIRED: t("hr.hire.stage.HIRED") };
  const active = job.candidates.filter((c) => c.stage !== "HIRED" && c.stage !== "REJECTED");
  const unscored = active.filter((c) => c.aiScore == null && (c.stage === "APPLIED" || c.stage === "SCREENING")).length;
  const peopleOpts = people.map((p) => ({ id: p.id, name: personName(p) }));
  const upcoming = interviews.filter((i) => i.status === "SCHEDULED");

  return (
    <HrFrame {...frame}>
      {intro()}
      <AutoRefresh active={screening.active > 0} intervalMs={5000} />
      <Card variant="elevated">
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              {job.title} <Badge tone={job.status === "OPEN" ? "success" : "neutral"}>{t(`hr.jobStatus.${job.status}`)}</Badge>
            </span>
          }
          description={t(`hr.hire.qHint.${step}`)}
          actions={
            <Link href={`/${locale}/hr/recruiting/jobs/${job.id}`} className="text-xs text-primary hover:underline">
              {t("hr.hire.openJob")}
            </Link>
          }
        />
        <CardBody className="grid gap-5">
          <Stepper steps={steps} current={current} reached={reached} label={t("hr.hire.progress")} />
          <h2 className="text-base font-semibold tracking-tight">{t(`hr.hire.q.${step}`)}</h2>

          {step === "describe" ? <DescribeStep base={base} jobId={job.id} brief={journey.brief} description={job.description} initial={describeTask} aiReady={aiReady} /> : null}

          {step === "publish" ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <PublishStep base={base} jobId={job.id} open={job.status === "OPEN"} careersUrl={careersUrl} />
              <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md border bg-surface-2/50 p-3 text-sm" aria-label={t("hr.hire.publish.preview")}>
                {job.description || t("hr.hire.publish.noDescription")}
              </div>
            </div>
          ) : null}

          {step === "candidates" ? (
            <div className="grid gap-5">
              <p className="text-sm text-muted-foreground">
                <Term explain={t("hr.hire.terms.aiScore")} label={t("hr.hire.whatsThis")}>
                  {t("hr.hire.terms.aiScoreWord")}
                </Term>{" "}
                · {t("hr.hire.candidates.approvalNote")}{" "}
                <Link href={`/${locale}/approvals`} className="text-primary hover:underline">
                  {t("hr.hire.candidates.approvals")}
                </Link>
              </p>
              <ScreenButton base={base} jobId={job.id} unscored={unscored} active={screening.active} />
              {job.candidates.length ? (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {job.candidates
                    .filter((c) => c.stage !== "REJECTED")
                    .map((c) => (
                      <li key={c.id} className="hover-lift flex min-w-0 items-center gap-3 rounded-lg border bg-surface p-3">
                        <Avatar first={c.firstName} last={c.lastName} ring={c.aiScore != null && c.aiScore >= 70 ? "success" : undefined} />
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <Link href={`/${locale}/hr/recruiting/candidates/${c.id}`} className="truncate font-medium hover:underline">
                            {personName(c)}
                          </Link>
                          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <Badge>{stageLabels[c.stage as keyof typeof stageLabels] ?? c.stage}</Badge>
                            {c.aiScore != null ? <Badge tone={c.aiScore >= 70 ? "success" : c.aiScore >= 40 ? "warning" : "danger"}>{t("hr.hire.candidates.score", { score: c.aiScore })}</Badge> : <span>{t("hr.hire.candidates.notScored")}</span>}
                          </span>
                        </span>
                        {c.stage !== "HIRED" ? <CandidateQuickActions base={base} candidateId={c.id} jobId={job.id} canInterview={c.stage !== "OFFER"} /> : null}
                      </li>
                    ))}
                </ul>
              ) : (
                <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-6 text-center">
                  <UserPlus className="size-6 text-primary" aria-hidden />
                  <p className="font-medium">{t("hr.hire.candidates.emptyTitle")}</p>
                  <p className="max-w-md text-sm text-muted-foreground">{t("hr.hire.candidates.emptyBody")}</p>
                  {job.status !== "OPEN" ? (
                    <Link href={`?job=${job.id}&step=publish`} className="text-sm text-primary hover:underline">
                      {t("hr.hire.candidates.publishFirst")}
                    </Link>
                  ) : null}
                </div>
              )}
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">{t("hr.hire.candidates.addTitle")}</summary>
                <div className="mt-3">
                  <AddCandidateForm base={base} jobId={job.id} />
                </div>
              </details>
              <div>
                <NextStepButton base={base} jobId={job.id} step="interviews" label={t("hr.hire.candidates.next")} />
              </div>
            </div>
          ) : null}

          {step === "interviews" ? (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <InterviewScheduler
                base={base}
                preselect={one(sp.candidate)}
                candidates={active.filter((c) => c.stage !== "OFFER").map((c) => ({ id: c.id, name: personName(c) }))}
                interviewers={peopleOpts}
              />
              <div className="grid content-start gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <CalendarClock className="size-4 text-primary" aria-hidden /> {t("hr.hire.interviews.upcoming")}
                </h3>
                {upcoming.length ? (
                  <ul className="grid gap-2">
                    {upcoming.map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                        <Avatar first={i.candidate.firstName} last={i.candidate.lastName} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{personName(i.candidate)}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(i.scheduledAt, locale, tz)} · {t(`hr.interviewType.${i.type}`)}
                          </span>
                        </span>
                        <InterviewStatusButtons base={base} interviewId={i.id} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("hr.hire.interviews.none")}</p>
                )}
                <div className="pt-2">
                  <NextStepButton base={base} jobId={job.id} step="hire" label={t("hr.hire.interviews.next")} />
                </div>
              </div>
            </div>
          ) : null}

          {step === "hire" ? (
            <div className="grid gap-4">
              <HireForm
                base={base}
                jobId={job.id}
                candidates={active.filter((c) => c.stage === "INTERVIEW" || c.stage === "OFFER" || c.stage === "SCREENING").map((c) => ({ id: c.id, name: personName(c) }))}
                managers={peopleOpts}
              />
              {data.hiredEmployees.length ? (
                <div className="grid gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <UserCheck className="size-4 text-success" aria-hidden /> {t("hr.hire.hire.hiredList")}
                  </h3>
                  <ul className="flex flex-wrap gap-2">
                    {job.candidates
                      .filter((c) => c.stage === "HIRED")
                      .map((c) => {
                        const emp = data.hiredEmployees.find((h) => h.id === c.id)?.employeeId;
                        return (
                          <li key={c.id} className="flex items-center gap-2 rounded-full border py-1 ps-1 pe-3 text-sm">
                            <Avatar first={c.firstName} last={c.lastName} size="sm" ring="success" />
                            {emp ? (
                              <Link href={`/${locale}/hr/employees/${emp}`} className="hover:underline">
                                {personName(c)}
                              </Link>
                            ) : (
                              personName(c)
                            )}
                          </li>
                        );
                      })}
                  </ul>
                  {journey.completedAt ? null : <NextStepButton base={base} jobId={job.id} step="done" label={t("hr.hire.hire.finish")} variant="secondary" />}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title={t("hr.hire.pipeline.title")} description={t("hr.hire.pipeline.hint")} />
          <CardBody>
            <HiringFunnel counts={pipeline} labels={stageLabels} title={t("hr.hire.pipeline.title")} emptyText={t("hr.hire.pipeline.empty")} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("hr.hire.help.title")} description={t("hr.hire.help.hint")} icon={<Sparkles />} />
          <CardBody>
            <HelpMeButton
              base={base}
              aiReady={aiReady}
              profile="recruiter"
              subject={{ type: "hr_hiring", id: job.id }}
              title={`Hiring help: ${job.title}`}
              instructions={`The person is hiring for "${job.title}" (job id ${job.id}, status ${job.status}) and is at the step "${step}" of a guided hiring flow (role → job description → publish → find candidates → interviews → hire & onboard). They are not an HR expert. Read the job (read_open_jobs) and, if candidates exist, read them (read_candidate). Explain in plain words what to do next at this step, with concrete suggestions (e.g. where to share the job, which candidates look strongest and why, good interview questions). Do not make changes without proposing them for approval.`}
              initial={await latestSubjectTask(viewer.ctx, org.id, company.id, "hr_hiring", job.id)}
            />
          </CardBody>
        </Card>
      </div>
      {healthStrip}
    </HrFrame>
  );
}
