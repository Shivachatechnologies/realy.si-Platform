import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AiPanel } from "@/components/hr/ai-panel";
import { ActionButton, InlineSelect } from "@/components/hr/hr-action";
import { HrForm } from "@/components/hr/hr-form";
import { enumOptions, fileSize, namedOptions, peopleOptions, STAGE_TONE } from "@/components/hr/options";
import { HrFrame, loadHr, personName } from "@/components/hr/shell";
import { formatDate, formatDateTime, formatMoney } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { EMPLOYMENT_TYPES, employeeOptions } from "@/server/modules/hr/employees";
import { listDepartments, listTeams } from "@/server/modules/hr/org";
import { getCandidate, INTERVIEW_TYPES, MAX_RESUME_BYTES, RECOMMENDATIONS, SCORECARD_CRITERIA } from "@/server/modules/hr/recruiting";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.recruiting.candidate") };
}

const REC_TONE = { STRONG_NO: "danger", NO: "warning", YES: "success", STRONG_YES: "success" } as const;
const OFFER_TONE = { DRAFT: "neutral", SENT: "accent", ACCEPTED: "success", DECLINED: "danger" } as const;

export default async function CandidatePage({ params }: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = await params;
  const locale = await getLocale();
  const { t, viewer, org, company, access, base, tz } = await loadHr(locale);
  const allowed = !!access?.manage;
  const frame = { t, locale, title: t("hr.recruiting.candidate"), tab: "recruiting" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const c = await getCandidate(viewer.ctx, org.id, company.id, candidateId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const [people, departments, teams, tasks] = await Promise.all([
    employeeOptions(viewer.ctx, org.id, company.id),
    listDepartments(viewer.ctx, org.id, company.id),
    listTeams(viewer.ctx, org.id, company.id),
    access!.agentsRun ? listSubjectTasks(viewer.ctx, org.id, company.id, "hr_candidate", c.id).catch(() => []) : Promise.resolve([]),
  ]);
  const open = c.stage !== "HIRED" && c.stage !== "REJECTED" && !c.archivedAt;
  const cBase = `${base}/hr/candidates/${c.id}`;
  const ratingOptions = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} — ${t(`hr.ratings.${n}`)}` }));
  const acceptedOffer = c.offers.find((o) => o.status === "ACCEPTED") ?? c.offers[0];
  return (
    <HrFrame
      {...frame}
      title={personName(c)}
      subtitle={`${c.job.title} · ${t(`hr.source.${c.source}`)} · ${t("hr.recruiting.appliedOn", { date: formatDate(c.appliedAt, locale, tz) })}`}
      actions={
        <>
          {c.stage === "HIRED" || c.archivedAt ? (
            <Badge tone={STAGE_TONE[c.stage]}>{t(`hr.stages.${c.stage}`)}</Badge>
          ) : (
            <InlineSelect endpoint={cBase} field="stage" value={c.stage} label={t("hr.recruiting.stage")} options={enumOptions(t, "hr.stages", ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "REJECTED"])} />
          )}
          <Link href={`/${locale}/hr/recruiting/jobs/${c.job.id}`} className="text-sm text-muted-foreground hover:underline">
            {c.job.title}
          </Link>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("hr.recruiting.profile")} />
            <CardBody className="grid gap-3 text-sm">
              <dl className="grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">{t("hr.email")}</dt>
                  <dd>
                    <a href={`mailto:${c.email}`} className="hover:underline">
                      {c.email}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("hr.phone")}</dt>
                  <dd>{c.phone ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("hr.recruiting.linkedin")}</dt>
                  <dd className="truncate">{c.linkedinUrl ? <a href={c.linkedinUrl} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">{c.linkedinUrl.replace(/^https?:\/\//, "")}</a> : "—"}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">{t("hr.recruiting.rating")}</span>
                <InlineSelect endpoint={cBase} field="rating" value={c.rating ? String(c.rating) : ""} label={t("hr.recruiting.rating")} options={[{ value: "", label: "—" }, ...ratingOptions]} />
                {c.employee ? (
                  <Link href={`/${locale}/hr/employees/${c.employee.id}`} className="text-primary hover:underline">
                    {t("hr.recruiting.viewEmployee")}
                  </Link>
                ) : null}
              </div>
              {c.coverLetter ? (
                <details>
                  <summary className="cursor-pointer text-xs font-medium">{t("hr.recruiting.coverLetter")}</summary>
                  <p className="mt-2 whitespace-pre-wrap">{c.coverLetter}</p>
                </details>
              ) : null}
              {c.rejectedReason ? <p className="text-xs text-danger">{t("hr.recruiting.rejectedBecause", { reason: c.rejectedReason })}</p> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("hr.recruiting.resume")} description={c.resumeFilename ? `${c.resumeFilename} · ${fileSize(c.resumeSize ?? 0)}` : t("hr.recruiting.noResume")} actions={c.resumeFilename ? <a href={`${cBase}/resume`} className="text-xs text-primary hover:underline">{t("hr.download")}</a> : null} />
            <CardBody className="grid gap-3">
              {c.resumeText ? (
                <details>
                  <summary className="cursor-pointer text-xs font-medium">{t("hr.recruiting.resumeText")}</summary>
                  <pre className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded bg-surface-2 p-2 font-sans text-xs">{c.resumeText}</pre>
                </details>
              ) : c.resumeFilename ? (
                <p className="text-xs text-warning">{t("hr.recruiting.noResumeText")}</p>
              ) : null}
              <HrForm columns={1} endpoint={`${cBase}/resume`} fields={[{ name: "file", label: t("hr.recruiting.resumePdf"), type: "file", required: true, flatten: true, accept: ".pdf,application/pdf", maxBytes: MAX_RESUME_BYTES }]} submitLabel={c.resumeFilename ? t("hr.recruiting.replaceResume") : t("hr.recruiting.uploadResume")} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("hr.recruiting.notes")} />
            <CardBody className="grid gap-3">
              <HrForm columns={1} endpoint={`${cBase}/notes`} fields={[{ name: "body", label: t("hr.recruiting.addNote"), type: "textarea", rows: 2, required: true }]} submitLabel={t("hr.add")} />
              {c.notes.length ? (
                <ul className="grid gap-2">
                  {c.notes.map((n) => (
                    <li key={n.id} className="rounded-md border p-2 text-sm">
                      <p className="whitespace-pre-wrap">{n.body}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{[n.authorId ? c.userNames.get(n.authorId) : null, formatDateTime(n.createdAt, locale, tz)].filter(Boolean).join(" · ")}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("hr.recruiting.interviews")} />
            <CardBody className="grid gap-3">
              {c.interviews.length ? (
                <ul className="grid gap-2">
                  {c.interviews.map((i) => (
                    <li key={i.id} className="grid gap-1 rounded-md border p-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>{t(`hr.interviewType.${i.type}`)}</Badge>
                        <span className="font-medium">{formatDateTime(i.scheduledAt, locale, tz)}</span>
                        <span className="text-xs text-muted-foreground">{t("hr.recruiting.minutes", { count: i.durationMin })}</span>
                        <Badge tone={i.status === "COMPLETED" ? "success" : i.status === "CANCELLED" ? "neutral" : "accent"}>{t(`hr.interviewStatus.${i.status}`)}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{[i.interviewerIds.map((id) => c.interviewerNames.get(id)).filter(Boolean).join(", "), i.location].filter(Boolean).join(" · ")}</p>
                      {i.notes ? <p className="text-xs">{i.notes}</p> : null}
                      {i.status === "SCHEDULED" ? (
                        <div className="flex flex-wrap gap-2">
                          <ActionButton endpoint={`${base}/hr/interviews/${i.id}`} method="PATCH" body={{ status: "COMPLETED" }} label={t("hr.recruiting.markCompleted")} />
                          <ActionButton endpoint={`${base}/hr/interviews/${i.id}`} method="PATCH" body={{ status: "CANCELLED" }} label={t("hr.recruiting.cancelInterview")} variant="ghost" />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("hr.recruiting.noInterviewsYet")}</p>
              )}
              {open ? (
                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer text-sm font-medium">{t("hr.recruiting.scheduleInterview")}</summary>
                  <HrForm
                    className="mt-3"
                    endpoint={`${cBase}/interviews`}
                    fields={[
                      { name: "scheduledAt", label: t("hr.recruiting.when"), type: "datetime", required: true },
                      { name: "durationMin", label: t("hr.recruiting.duration"), type: "number", min: 5, max: 600 },
                      { name: "type", label: t("hr.recruiting.interviewTypeLabel"), type: "select", required: true, options: enumOptions(t, "hr.interviewType", INTERVIEW_TYPES) },
                      { name: "location", label: t("hr.recruiting.locationOrLink") },
                      { name: "interviewerIds", label: t("hr.recruiting.interviewers"), type: "multiselect", options: peopleOptions(people), hint: t("hr.recruiting.interviewersHint") },
                      { name: "notes", label: t("hr.note"), type: "textarea", rows: 2 },
                    ]}
                    initial={{ durationMin: 45, type: "VIDEO" }}
                    submitLabel={t("hr.recruiting.schedule")}
                  />
                </details>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("hr.recruiting.scorecards")} />
            <CardBody className="grid gap-3">
              {c.scorecards.length ? (
                <ul className="grid gap-2">
                  {c.scorecards.map((s) => (
                    <li key={s.id} className="grid gap-1 rounded-md border p-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={REC_TONE[s.recommendation]}>{t(`hr.recommendation.${s.recommendation}`)}</Badge>
                        <span className="text-xs text-muted-foreground">{[s.authorId ? c.userNames.get(s.authorId) : null, formatDateTime(s.createdAt, locale, tz)].filter(Boolean).join(" · ")}</span>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {Object.entries(s.ratings as Record<string, number>).map(([k, v]) => (
                          <span key={k}>
                            {t(`hr.criteria.${k}`)}: <span className="font-medium">{v}/5</span>
                          </span>
                        ))}
                      </div>
                      {s.comments ? <p className="whitespace-pre-wrap">{s.comments}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("hr.recruiting.noScorecards")}</p>
              )}
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">{t("hr.recruiting.addScorecard")}</summary>
                <HrForm
                  className="mt-3"
                  endpoint={`${cBase}/scorecards`}
                  fields={[
                    { name: "interviewId", label: t("hr.recruiting.interview"), type: "select", options: c.interviews.map((i) => ({ value: i.id, label: `${t(`hr.interviewType.${i.type}`)} · ${formatDateTime(i.scheduledAt, locale, tz)}` })) },
                    ...SCORECARD_CRITERIA.map((k) => ({ name: `ratings.${k}`, label: t(`hr.criteria.${k}`), type: "number" as const, min: 1, max: 5 })),
                    { name: "recommendation", label: t("hr.recruiting.recommendationLabel"), type: "select", required: true, options: enumOptions(t, "hr.recommendation", RECOMMENDATIONS) },
                    { name: "comments", label: t("hr.perf.comments"), type: "textarea", rows: 3 },
                  ]}
                  initial={{ recommendation: "YES" }}
                  submitLabel={t("hr.recruiting.submitScorecard")}
                />
              </details>
            </CardBody>
          </Card>
        </div>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("hr.recruiting.aiAssessment")} />
            <CardBody className="text-sm">
              {c.aiScore != null ? (
                <div className="grid gap-1">
                  <p className="text-2xl font-semibold">{c.aiScore}/100</p>
                  <p className="whitespace-pre-wrap">{c.aiSummary}</p>
                  {c.aiScoredAt ? <p className="text-xs text-muted-foreground">{formatDateTime(c.aiScoredAt, locale, tz)}</p> : null}
                </div>
              ) : (
                <p className="text-muted-foreground">{t("hr.recruiting.noAiScore")}</p>
              )}
            </CardBody>
          </Card>
          <AiPanel
            t={t}
            locale={locale}
            tz={tz}
            title={t("hr.ai.recruiterTitle")}
            description={t("hr.ai.candidateHint")}
            canRun={access!.agentsRun}
            actions={[
              { label: t("hr.ai.scoreCandidate"), endpoint: `${cBase}/assist`, body: { mode: "score" } },
              { label: t("hr.ai.interviewQuestions"), endpoint: `${cBase}/assist`, body: { mode: "questions" } },
            ]}
            tasks={tasks}
          />
          <Card>
            <CardHeader title={t("hr.recruiting.offers")} />
            <CardBody className="grid gap-3">
              {c.offers.length ? (
                <ul className="grid gap-2">
                  {c.offers.map((o) => (
                    <li key={o.id} className="grid gap-1 rounded-md border p-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{o.title}</span>
                        <Badge tone={OFFER_TONE[o.status]}>{t(`hr.offerStatus.${o.status}`)}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("hr.recruiting.yearly", { amount: formatMoney({ amountMinor: o.salaryMinor, currency: o.currency }, locale) })}
                        {o.startDate ? ` · ${t("hr.recruiting.startsOn", { date: formatDate(o.startDate, locale, "UTC") })}` : ""}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Link href={`/${locale}/hr/recruiting/offers/${o.id}/letter`} className="text-xs text-primary hover:underline">
                          {t("hr.recruiting.offerLetter")}
                        </Link>
                        {o.status === "DRAFT" ? <ActionButton endpoint={`${base}/hr/offers/${o.id}`} method="PATCH" body={{ status: "SENT" }} label={t("hr.recruiting.markSent")} /> : null}
                        {o.status === "SENT" ? (
                          <>
                            <ActionButton endpoint={`${base}/hr/offers/${o.id}`} method="PATCH" body={{ status: "ACCEPTED" }} label={t("hr.recruiting.markAccepted")} />
                            <ActionButton endpoint={`${base}/hr/offers/${o.id}`} method="PATCH" body={{ status: "DECLINED" }} label={t("hr.recruiting.markDeclined")} variant="ghost" />
                          </>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("hr.recruiting.noOffers")}</p>
              )}
              {open ? (
                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer text-sm font-medium">{t("hr.recruiting.createOffer")}</summary>
                  <HrForm
                    className="mt-3"
                    columns={1}
                    endpoint={`${cBase}/offers`}
                    fields={[
                      { name: "title", label: t("hr.jobTitle"), required: true },
                      { name: "salary", label: t("hr.recruiting.yearlySalary", { currency: c.job.currency }), type: "money", required: true },
                      { name: "startDate", label: t("hr.startDate"), type: "date" },
                      { name: "terms", label: t("hr.recruiting.terms"), type: "textarea", rows: 4 },
                    ]}
                    initial={{ title: c.job.title }}
                    submitLabel={t("hr.recruiting.createOffer")}
                  />
                </details>
              ) : null}
            </CardBody>
          </Card>
          {open ? (
            <Card>
              <CardHeader title={t("hr.recruiting.decision")} description={t("hr.recruiting.decisionHint")} />
              <CardBody className="grid gap-4">
                <HrForm
                  columns={1}
                  endpoint={`${cBase}/hire`}
                  redirectTo="/hr/employees/:id"
                  fields={[
                    { name: "title", label: t("hr.jobTitle"), placeholder: acceptedOffer?.title ?? c.job.title },
                    { name: "startDate", label: t("hr.startDate"), type: "date" },
                    { name: "departmentId", label: t("hr.department"), type: "select", options: namedOptions(departments) },
                    { name: "teamId", label: t("hr.team"), type: "select", options: namedOptions(teams) },
                    { name: "managerId", label: t("hr.manager"), type: "select", options: peopleOptions(people) },
                    { name: "employmentType", label: t("hr.employmentTypeLabel"), type: "select", options: enumOptions(t, "hr.employmentType", EMPLOYMENT_TYPES) },
                    { name: "note", label: t("hr.recruiting.decisionNote"), type: "textarea", rows: 2 },
                  ]}
                  initial={{ startDate: acceptedOffer?.startDate?.toISOString().slice(0, 10), departmentId: c.job.departmentId, managerId: c.job.hiringManagerId, employmentType: c.job.employmentType }}
                  submitLabel={t("hr.recruiting.hire")}
                />
                <details>
                  <summary className="cursor-pointer text-sm text-danger">{t("hr.recruiting.reject")}</summary>
                  <HrForm
                    className="mt-2"
                    columns={1}
                    method="PATCH"
                    endpoint={cBase}
                    extra={{ stage: "REJECTED" }}
                    fields={[{ name: "rejectedReason", label: t("hr.recruiting.rejectReason"), type: "textarea", rows: 2, required: true }]}
                    submitLabel={t("hr.recruiting.reject")}
                  />
                </details>
              </CardBody>
            </Card>
          ) : null}
          {!c.employee ? <ActionButton endpoint={cBase} method="DELETE" label={t("hr.recruiting.archiveCandidate")} variant="ghost" confirm={t("hr.confirmArchive")} redirectTo="/hr/recruiting" /> : null}
        </div>
      </div>
    </HrFrame>
  );
}
