import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { HelpMeButton } from "@/components/guide-kit/help-me";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { introLabels, latestSubjectTask } from "@/components/guide-kit/server";
import { HiringFunnel, TeamHealthStrip } from "@/components/hr/people-visuals";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { hiringPipeline, teamHealth } from "@/server/modules/hr/hiring";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AiPanel } from "@/components/hr/ai-panel";
import { HrForm } from "@/components/hr/hr-form";
import { HrFrame, loadHr, personName, Stat } from "@/components/hr/shell";
import { formatDate, formatDateTime, formatNumber } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { upcomingInterviews } from "@/server/modules/hr/recruiting";
import { headcountSummary } from "@/server/modules/hr/summary";
import { listLeaveRequests, whosOut } from "@/server/modules/hr/time";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.hr.title") };
}

export default async function HrOverviewPage() {
  const locale = await getLocale();
  const { t, viewer, org, company, access, base, tz } = await loadHr(locale);
  const allowed = !!access?.read;
  const frame = { t, locale, title: t("modules.hr.title"), subtitle: t("hr.subtitle"), tab: "overview" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const [summary, out, approvals, interviews, aiTasks] = await Promise.all([
    headcountSummary(viewer.ctx, org.id, company.id),
    whosOut(viewer.ctx, org.id, company.id, 30),
    listLeaveRequests(viewer.ctx, org.id, company.id, { view: "approvals" }),
    access!.manage ? upcomingInterviews(viewer.ctx, org.id, company.id) : Promise.resolve([]),
    access!.agentsRun || access!.manage ? listSubjectTasks(viewer.ctx, org.id, company.id, "hr_insights", company.id, 5).catch(() => []) : Promise.resolve([]),
  ]);
  // An empty HR area starts with the guided hiring journey ("Do you need to hire someone?").
  if (access!.manage && summary.headcount === 0 && summary.openPositions === 0 && summary.activeCandidates === 0) redirect(`/${locale}/hr/hire`);
  const [health, pipeline, helpTask] = await Promise.all([
    teamHealth(viewer.ctx, org.id, company.id),
    access!.manage ? hiringPipeline(viewer.ctx, org.id, company.id) : Promise.resolve(null),
    latestSubjectTask(viewer.ctx, org.id, company.id, "hr_overview", company.id),
  ]);
  const maxDept = Math.max(1, ...summary.byDepartment.map((d) => d.count));
  const n = (v: number) => formatNumber(v, locale);
  return (
    <HrFrame {...frame}>
      <PageIntro
        labels={introLabels(t)}
        what={t("hr.intro.overview.what")}
        why={t("hr.intro.overview.why")}
        can={t("hr.intro.overview.can")}
        next={access!.manage ? { label: t("hr.intro.overview.next"), href: `/${locale}/hr/hire` } : { label: t("hr.intro.overview.nextSelf"), href: `/${locale}/hr/me` }}
        accent="success"
      />
      <TeamHealthStrip
        data={health}
        labels={{ headcount: t("hr.hire.health.headcount"), onboarding: (n) => t("hr.hire.health.onboarding", { count: n }), onLeave: t("hr.hire.health.onLeave"), openRoles: t("hr.hire.health.openRoles"), applicants: t("hr.hire.health.applicants") }}
        hrefs={{ people: `/${locale}/hr/employees`, leave: `/${locale}/hr/leave`, hiring: `/${locale}/hr/hire` }}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {pipeline ? (
          <Card>
            <CardHeader title={t("hr.hire.pipeline.title")} description={t("hr.hire.pipeline.hintAll")} actions={<Link href={`/${locale}/hr/hire`} className="text-xs text-primary hover:underline">{t("hr.tabs.hire")}</Link>} />
            <CardBody>
              <HiringFunnel counts={pipeline} labels={{ APPLIED: t("hr.hire.stage.APPLIED"), SCREENING: t("hr.hire.stage.SCREENING"), INTERVIEW: t("hr.hire.stage.INTERVIEW"), OFFER: t("hr.hire.stage.OFFER"), HIRED: t("hr.hire.stage.HIRED") }} title={t("hr.hire.pipeline.title")} emptyText={t("hr.hire.pipeline.empty")} />
            </CardBody>
          </Card>
        ) : null}
        <Card>
          <CardHeader title={t("hr.hire.help.title")} description={t("hr.intro.overview.helpHint")} icon={<Sparkles />} />
          <CardBody>
            <HelpMeButton
              base={base}
              aiReady={aiConfigured() && !!access!.agentsRun}
              profile="people_analyst"
              subject={{ type: "hr_overview", id: company.id }}
              title="Help with my team"
              instructions="The person is on the HR overview page and is not an HR expert. Call read_headcount_summary and read_open_jobs, then explain in plain words how the team is doing (headcount, who is out, open roles, attrition) and the 3 most useful things to do next, each with the page in Realy.si where they can do it (/hr/hire to hire, /hr/leave for time off, /hr/onboarding for new people, /hr/performance for reviews)."
              initial={helpTask}
            />
          </CardBody>
        </Card>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("hr.metrics.headcount")} value={n(summary.headcount)} hint={t("hr.overview.onboardingCount", { count: summary.byStatus.ONBOARDING ?? 0 })} />
        <Stat label={t("hr.overview.newHires90")} value={n(summary.newHires90d)} />
        <Stat label={t("hr.overview.attrition12m")} value={`${formatNumber(summary.attrition12mPercent, locale)}%`} hint={t("hr.overview.leavers", { count: summary.leavers12m })} />
        <Stat label={t("hr.metrics.openPositions")} value={n(summary.openPositions)} hint={t("hr.overview.activeCandidates", { count: summary.activeCandidates })} />
        <Stat label={t("hr.overview.onLeaveToday")} value={n(summary.onLeaveToday)} />
        <Stat label={t("hr.overview.pendingLeave")} value={n(summary.pendingLeaveRequests)} />
        <Stat label={t("hr.overview.avgTenure")} value={summary.averageTenureYears == null ? "—" : t("hr.overview.years", { count: summary.averageTenureYears })} />
        <Stat label={t("hr.org.avgSpan")} value={summary.averageSpanOfControl ?? "—"} hint={t("hr.org.managersCount", { count: summary.managers })} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("hr.overview.byDepartment")} actions={<Link href={`/${locale}/organization`} className="text-xs text-primary hover:underline">{t("modules.organization.title")}</Link>} />
          <CardBody className="grid gap-2">
            {summary.byDepartment.length ? (
              summary.byDepartment.map((d) => (
                <div key={d.name ?? "none"} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-2 text-sm">
                  <span className="truncate">{d.name ?? t("hr.noDepartment")}</span>
                  <span className="h-2 rounded-full bg-muted">
                    <span className="block h-2 rounded-full bg-primary" style={{ width: `${(d.count / maxDept) * 100}%` }} />
                  </span>
                  <span className="text-end tabular-nums">{d.count}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.employees.empty")}</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("hr.overview.whosOut")} actions={<Link href={`/${locale}/hr/leave`} className="text-xs text-primary hover:underline">{t("hr.tabs.leave")}</Link>} />
          <CardBody>
            {out.length ? (
              <ul className="grid gap-1.5 text-sm">
                {out.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/${locale}/hr/employees/${r.employee.id}`} className="font-medium hover:underline">
                      {personName(r.employee)}
                    </Link>
                    <Badge>{r.leaveType.name}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(r.startDate, locale, "UTC")} – {formatDate(r.endDate, locale, "UTC")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.overview.nobodyOut")}</p>
            )}
          </CardBody>
        </Card>
        {approvals.length ? (
          <Card>
            <CardHeader title={t("hr.overview.awaitingApproval")} actions={<Link href={`/${locale}/hr/leave?view=approvals`} className="text-xs text-primary hover:underline">{t("hr.leave.review")}</Link>} />
            <CardBody>
              <ul className="grid gap-1.5 text-sm">
                {approvals.slice(0, 8).map((r) => (
                  <li key={r.id} className="flex flex-wrap gap-2">
                    <span className="font-medium">{personName(r.employee)}</span>
                    <span>{r.leaveType.name}</span>
                    <span className="text-xs text-muted-foreground">{t("hr.leave.daysCount", { count: r.days })}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}
        {access!.manage ? (
          <Card>
            <CardHeader title={t("hr.recruiting.upcomingInterviews")} actions={<Link href={`/${locale}/hr/recruiting`} className="text-xs text-primary hover:underline">{t("hr.tabs.recruiting")}</Link>} />
            <CardBody>
              {interviews.length ? (
                <ul className="grid gap-1.5 text-sm">
                  {interviews.map((i) => (
                    <li key={i.id} className="flex flex-wrap gap-2">
                      <Link href={`/${locale}/hr/recruiting/candidates/${i.candidate.id}`} className="font-medium hover:underline">
                        {personName(i.candidate)}
                      </Link>
                      <span className="text-muted-foreground">{i.candidate.job.title}</span>
                      <Badge>{t(`hr.interviewType.${i.type}`)}</Badge>
                      <span className="text-xs">{formatDateTime(i.scheduledAt, locale, tz)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("hr.recruiting.noInterviews")}</p>
              )}
            </CardBody>
          </Card>
        ) : null}
      </div>
      {access!.agentsRun ? (
        <div className="grid gap-3">
          <Card>
            <CardHeader title={t("hr.ai.analystTitle")} description={t("hr.ai.analystHint")} />
            <CardBody>
              <HrForm endpoint={`${base}/hr/assist/analyst`} columns={1} fields={[{ name: "question", label: t("hr.ai.question"), type: "textarea", rows: 2, required: true, placeholder: t("hr.ai.analystPlaceholder") }]} submitLabel={t("hr.ai.ask")} />
            </CardBody>
          </Card>
          <AiPanel t={t} locale={locale} tz={tz} title={t("hr.ai.analystAnswers")} description={t("hr.ai.analystAnswersHint")} actions={[]} tasks={aiTasks} canRun={false} />
        </div>
      ) : null}
    </HrFrame>
  );
}
