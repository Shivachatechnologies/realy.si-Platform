import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AiPanel } from "@/components/hr/ai-panel";
import { ActionButton } from "@/components/hr/hr-action";
import { HrForm } from "@/components/hr/hr-form";
import { CandidateKanban } from "@/components/hr/kanban";
import { enumOptions, namedOptions, peopleOptions } from "@/components/hr/options";
import { HrFrame, loadHr, personName } from "@/components/hr/shell";
import { formatDate, formatMoney } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { toMajor } from "@/server/modules/hr/access";
import { EMPLOYMENT_TYPES, employeeOptions } from "@/server/modules/hr/employees";
import { listDepartments } from "@/server/modules/hr/org";
import { getJob } from "@/server/modules/hr/recruiting";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.recruiting.job") };
}

export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const locale = await getLocale();
  const { t, viewer, org, company, access, base, tz } = await loadHr(locale);
  const allowed = !!access?.manage;
  const frame = { t, locale, title: t("hr.recruiting.job"), tab: "recruiting" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const job = await getJob(viewer.ctx, org.id, company.id, jobId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const [departments, people, tasks] = await Promise.all([
    listDepartments(viewer.ctx, org.id, company.id),
    employeeOptions(viewer.ctx, org.id, company.id),
    access!.agentsRun ? listSubjectTasks(viewer.ctx, org.id, company.id, "hr_job", job.id).catch(() => []) : Promise.resolve([]),
  ]);
  const money = (m: bigint | null) => (m == null ? null : formatMoney({ amountMinor: m, currency: job.currency }, locale));
  return (
    <HrFrame
      {...frame}
      title={job.title}
      subtitle={[job.department?.name, job.location, t(`hr.employmentType.${job.employmentType}`), job.remote ? t("hr.recruiting.remote") : null].filter(Boolean).join(" · ")}
      actions={
        <>
          <Badge tone={job.status === "OPEN" ? "success" : "neutral"}>{t(`hr.jobStatus.${job.status}`)}</Badge>
          {job.status !== "OPEN" ? <ActionButton endpoint={`${base}/hr/jobs/${job.id}`} method="PATCH" body={{ status: "OPEN" }} label={t("hr.recruiting.publish")} variant="default" /> : null}
          {job.status === "OPEN" ? <ActionButton endpoint={`${base}/hr/jobs/${job.id}`} method="PATCH" body={{ status: "CLOSED" }} label={t("hr.recruiting.close")} confirm={t("hr.recruiting.closeConfirm")} /> : null}
          {job.status === "OPEN" ? (
            <a href={`/${locale}/careers/${company.id}/${job.id}`} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
              {t("hr.recruiting.viewPosting")}
            </a>
          ) : null}
          <Link href={`/${locale}/hr/recruiting`} className="text-sm text-muted-foreground hover:underline">
            {t("hr.recruiting.back")}
          </Link>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t("hr.recruiting.description")} description={[money(job.salaryMinMinor), money(job.salaryMaxMinor)].filter(Boolean).join(" – ") || undefined} />
          <CardBody>
            {job.description ? <div className="whitespace-pre-wrap text-sm">{job.description}</div> : <p className="text-sm text-muted-foreground">{t("hr.recruiting.noDescription")}</p>}
            <p className="mt-3 text-xs text-muted-foreground">
              {[job.hiringManager ? t("hr.recruiting.hiringManagerIs", { name: personName(job.hiringManager) }) : null, t("hr.recruiting.openingsCount", { count: job.openings }), job.publishedAt ? t("hr.recruiting.publishedOn", { date: formatDate(job.publishedAt, locale, tz) }) : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </CardBody>
        </Card>
        <AiPanel
          t={t}
          locale={locale}
          tz={tz}
          title={t("hr.ai.recruiterTitle")}
          description={t("hr.ai.jobHint")}
          canRun={access!.agentsRun}
          actions={[{ label: t("hr.ai.draftJobDescription"), endpoint: `${base}/hr/jobs/${job.id}/assist`, body: {} }]}
          tasks={tasks}
        />
      </div>
      <Card>
        <CardHeader title={t("hr.recruiting.pipeline")} description={t("hr.recruiting.candidatesCount", { count: job.candidates.length })} />
        {job.candidates.length ? (
          <CandidateKanban base={base} cards={job.candidates.map((c) => ({ id: c.id, name: personName(c), job: c.email, stage: c.stage, aiScore: c.aiScore, rating: c.rating, applied: formatDate(c.appliedAt, locale, tz) }))} />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("hr.recruiting.noCandidatesForJob")}</p>
        )}
      </Card>
      <Card>
        <CardHeader title={t("hr.recruiting.editJob")} />
        <CardBody>
          <HrForm
            method="PATCH"
            endpoint={`${base}/hr/jobs/${job.id}`}
            fields={[
              { name: "title", label: t("hr.jobTitle"), required: true },
              { name: "departmentId", label: t("hr.department"), type: "select", options: namedOptions(departments) },
              { name: "location", label: t("hr.location") },
              { name: "employmentType", label: t("hr.employmentTypeLabel"), type: "select", required: true, options: enumOptions(t, "hr.employmentType", EMPLOYMENT_TYPES) },
              { name: "openings", label: t("hr.recruiting.openings"), type: "number", min: 1 },
              { name: "hiringManagerId", label: t("hr.recruiting.hiringManager"), type: "select", options: peopleOptions(people) },
              { name: "salaryMin", label: t("hr.recruiting.salaryMin", { currency: job.currency }), type: "money" },
              { name: "salaryMax", label: t("hr.recruiting.salaryMax", { currency: job.currency }), type: "money" },
              { name: "remote", label: t("hr.recruiting.remote"), type: "checkbox", hint: t("hr.recruiting.remoteHint") },
              { name: "description", label: t("hr.recruiting.description"), type: "textarea", rows: 12 },
            ]}
            initial={{
              title: job.title,
              departmentId: job.departmentId,
              location: job.location,
              employmentType: job.employmentType,
              openings: job.openings,
              hiringManagerId: job.hiringManagerId,
              salaryMin: toMajor(job.salaryMinMinor, job.currency),
              salaryMax: toMajor(job.salaryMaxMinor, job.currency),
              remote: job.remote,
              description: job.description,
            }}
            submitLabel={t("common.save")}
          />
        </CardBody>
      </Card>
    </HrFrame>
  );
}
