import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { HrForm } from "@/components/hr/hr-form";
import { CandidateKanban } from "@/components/hr/kanban";
import { enumOptions, namedOptions, peopleOptions, STAGE_TONE } from "@/components/hr/options";
import { HrFrame, loadHr, Pager, personName } from "@/components/hr/shell";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatMoney } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { EMPLOYMENT_TYPES, employeeOptions } from "@/server/modules/hr/employees";
import { listDepartments } from "@/server/modules/hr/org";
import { CANDIDATE_SOURCES, CANDIDATE_STAGES, JOB_STATUSES, listCandidates, listJobs, MAX_RESUME_BYTES, parseCandidateFilters, upcomingInterviews } from "@/server/modules/hr/recruiting";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.tabs.recruiting") };
}

const JOB_TONE = { DRAFT: "neutral", OPEN: "success", CLOSED: "neutral" } as const;

export default async function RecruitingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const { t, viewer, org, company, access, base, tz } = await loadHr(locale);
  const allowed = !!access?.manage;
  const frame = { t, locale, title: t("hr.recruiting.title"), subtitle: t("hr.recruiting.subtitle"), tab: "recruiting" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const raw = await searchParams;
  const view = raw.view === "list" ? "list" : "board";
  const filters = parseCandidateFilters(raw);
  const boardFilters = { ...filters, stage: filters.stage, page: 1 };
  const [jobs, candidates, departments, people, interviews] = await Promise.all([
    listJobs(viewer.ctx, org.id, company.id),
    view === "board" ? listCandidates(viewer.ctx, org.id, company.id, { ...boardFilters, sort: "score" }) : listCandidates(viewer.ctx, org.id, company.id, filters),
    listDepartments(viewer.ctx, org.id, company.id),
    employeeOptions(viewer.ctx, org.id, company.id),
    upcomingInterviews(viewer.ctx, org.id, company.id),
  ]);
  const money = (m: bigint | null, c: string) => (m == null ? null : formatMoney({ amountMinor: m, currency: c }, locale));
  const params = { view, q: filters.q, job: filters.job, stage: filters.stage, sort: filters.sort };
  const viewHref = (v: string) => `/${locale}/hr/recruiting?${new URLSearchParams(Object.entries({ ...params, view: v }).filter((e): e is [string, string] => !!e[1]))}`;
  const jobOptions = jobs.map((j) => ({ value: j.id, label: `${j.title} (${t(`hr.jobStatus.${j.status}`)})` }));
  return (
    <HrFrame
      {...frame}
      actions={
        <a href={`/${locale}/careers/${company.id}`} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
          {t("hr.recruiting.careersPage")}
        </a>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t("hr.recruiting.jobs")} description={t("hr.recruiting.jobsCount", { count: jobs.length })} />
          {jobs.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("hr.recruiting.job")}</Th>
                  <Th>{t("common.status")}</Th>
                  <Th className="text-end">{t("hr.recruiting.active")}</Th>
                  <Th className="hidden text-end sm:table-cell">{t("hr.recruiting.hired")}</Th>
                  <Th className="hidden md:table-cell">{t("hr.recruiting.salaryRange")}</Th>
                </Tr>
              </THead>
              <TBody>
                {jobs.map((j) => (
                  <Tr key={j.id}>
                    <Td>
                      <Link href={`/${locale}/hr/recruiting/jobs/${j.id}`} className="font-medium hover:underline">
                        {j.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">{[j.department?.name, j.location, t(`hr.employmentType.${j.employmentType}`)].filter(Boolean).join(" · ")}</div>
                    </Td>
                    <Td>
                      <Badge tone={JOB_TONE[j.status]}>{t(`hr.jobStatus.${j.status}`)}</Badge>
                    </Td>
                    <Td className="text-end">{j.active}</Td>
                    <Td className="hidden text-end sm:table-cell">
                      {j.hired}/{j.openings}
                    </Td>
                    <Td className="hidden text-xs md:table-cell">{[money(j.salaryMinMinor, j.currency), money(j.salaryMaxMinor, j.currency)].filter(Boolean).join(" – ") || "—"}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("hr.recruiting.noJobs")}</p>
          )}
          <details className="border-t">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("hr.recruiting.addJob")}</summary>
            <HrForm
              className="px-3 pb-3"
              endpoint={`${base}/hr/jobs`}
              redirectTo="/hr/recruiting/jobs/:id"
              fields={[
                { name: "title", label: t("hr.jobTitle"), required: true, maxLength: 160 },
                { name: "departmentId", label: t("hr.department"), type: "select", options: namedOptions(departments) },
                { name: "location", label: t("hr.location") },
                { name: "employmentType", label: t("hr.employmentTypeLabel"), type: "select", required: true, options: enumOptions(t, "hr.employmentType", EMPLOYMENT_TYPES) },
                { name: "openings", label: t("hr.recruiting.openings"), type: "number", min: 1, max: 500 },
                { name: "hiringManagerId", label: t("hr.recruiting.hiringManager"), type: "select", options: peopleOptions(people) },
                { name: "salaryMin", label: t("hr.recruiting.salaryMin", { currency: company.baseCurrency }), type: "money" },
                { name: "salaryMax", label: t("hr.recruiting.salaryMax", { currency: company.baseCurrency }), type: "money" },
                { name: "status", label: t("common.status"), type: "select", required: true, options: enumOptions(t, "hr.jobStatus", JOB_STATUSES) },
                { name: "remote", label: t("hr.recruiting.remote"), type: "checkbox", hint: t("hr.recruiting.remoteHint") },
                { name: "description", label: t("hr.recruiting.description"), type: "textarea", rows: 6, hint: t("hr.recruiting.descriptionHint") },
              ]}
              initial={{ employmentType: "FULL_TIME", status: "DRAFT", openings: 1 }}
              submitLabel={t("hr.recruiting.createJob")}
            />
          </details>
        </Card>
        <Card>
          <CardHeader title={t("hr.recruiting.upcomingInterviews")} />
          <CardBody>
            {interviews.length ? (
              <ul className="grid gap-2 text-sm">
                {interviews.map((i) => (
                  <li key={i.id} className="grid">
                    <Link href={`/${locale}/hr/recruiting/candidates/${i.candidate.id}`} className="font-medium hover:underline">
                      {personName(i.candidate)}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {i.candidate.job.title} · {t(`hr.interviewType.${i.type}`)} · {formatDateTime(i.scheduledAt, locale, tz)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.recruiting.noInterviews")}</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title={t("hr.recruiting.pipeline")}
          description={t("hr.recruiting.candidatesCount", { count: candidates.total })}
          actions={
            <div className="flex gap-1 text-xs">
              {(["board", "list"] as const).map((v) => (
                <Link key={v} href={viewHref(v)} aria-current={view === v ? "page" : undefined} className={cn("rounded-md px-2 py-1", view === v ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}>
                  {t(`hr.recruiting.views.${v}`)}
                </Link>
              ))}
            </div>
          }
        />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_12rem_10rem_9rem_auto]" action={`/${locale}/hr/recruiting`}>
          <input type="hidden" name="view" value={view} />
          <Input name="q" type="search" defaultValue={filters.q ?? ""} placeholder={t("hr.recruiting.searchPlaceholder")} aria-label={t("hr.search")} />
          <Select name="job" defaultValue={filters.job ?? ""} aria-label={t("hr.recruiting.job")}>
            <option value="">{t("hr.recruiting.allJobs")}</option>
            {jobOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select name="stage" defaultValue={filters.stage ?? ""} aria-label={t("hr.recruiting.stage")}>
            <option value="">{t("hr.recruiting.allStages")}</option>
            <option value="ACTIVE">{t("hr.recruiting.activeStages")}</option>
            {CANDIDATE_STAGES.map((s) => (
              <option key={s} value={s}>
                {t(`hr.stages.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="sort" defaultValue={filters.sort} aria-label={t("hr.sort")}>
            {(["applied", "score", "rating", "name"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`hr.recruiting.sorts.${s}`)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {t("hr.apply")}
          </Button>
        </form>
        <details className="border-b">
          <summary className="cursor-pointer p-3 text-sm font-medium">{t("hr.recruiting.addCandidate")}</summary>
          <HrForm
            className="px-3 pb-3"
            columns={3}
            endpoint={`${base}/hr/candidates`}
            redirectTo="/hr/recruiting/candidates/:id"
            fields={[
              { name: "jobId", label: t("hr.recruiting.job"), type: "select", required: true, options: jobOptions },
              { name: "firstName", label: t("hr.firstName"), required: true },
              { name: "lastName", label: t("hr.lastName") },
              { name: "email", label: t("hr.email"), type: "email", required: true },
              { name: "phone", label: t("hr.phone"), type: "tel" },
              { name: "linkedinUrl", label: t("hr.recruiting.linkedin"), type: "url" },
              { name: "source", label: t("hr.recruiting.source"), type: "select", required: true, options: enumOptions(t, "hr.source", CANDIDATE_SOURCES) },
              { name: "resume", label: t("hr.recruiting.resumePdf"), type: "file", accept: ".pdf,application/pdf", maxBytes: MAX_RESUME_BYTES },
              { name: "coverLetter", label: t("hr.recruiting.coverLetter"), type: "textarea", rows: 3 },
            ]}
            initial={{ source: "manual", jobId: filters.job ?? jobs.find((j) => j.status === "OPEN")?.id }}
            submitLabel={t("hr.recruiting.addCandidate")}
          />
        </details>
        {candidates.rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("hr.recruiting.noCandidates")}</p>
        ) : view === "board" ? (
          <CandidateKanban
            base={base}
            cards={candidates.rows.map((c) => ({ id: c.id, name: personName(c), job: c.job.title, stage: c.stage, aiScore: c.aiScore, rating: c.rating, applied: formatDate(c.appliedAt, locale, tz) }))}
          />
        ) : (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th>{t("hr.name")}</Th>
                  <Th>{t("hr.recruiting.job")}</Th>
                  <Th>{t("hr.recruiting.stage")}</Th>
                  <Th className="text-end">{t("hr.recruiting.aiScore")}</Th>
                  <Th className="hidden md:table-cell">{t("hr.recruiting.source")}</Th>
                  <Th className="hidden md:table-cell">{t("hr.recruiting.applied")}</Th>
                </Tr>
              </THead>
              <TBody>
                {candidates.rows.map((c) => (
                  <Tr key={c.id}>
                    <Td>
                      <Link href={`/${locale}/hr/recruiting/candidates/${c.id}`} className="font-medium hover:underline">
                        {personName(c)}
                      </Link>
                      <div className="text-xs text-muted-foreground">{c.email}</div>
                    </Td>
                    <Td>{c.job.title}</Td>
                    <Td>
                      <Badge tone={STAGE_TONE[c.stage]}>{t(`hr.stages.${c.stage}`)}</Badge>
                    </Td>
                    <Td className="text-end">{c.aiScore ?? "—"}</Td>
                    <Td className="hidden md:table-cell">{t(`hr.source.${c.source}`)}</Td>
                    <Td className="hidden md:table-cell">{formatDate(c.appliedAt, locale, tz)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pager locale={locale} path="/hr/recruiting" params={params} page={candidates.page} pages={candidates.pages} t={t} />
          </>
        )}
        {view === "board" && candidates.total > candidates.rows.length ? <p className="px-3 pb-3 text-xs text-muted-foreground">{t("hr.recruiting.boardLimited", { shown: candidates.rows.length, total: candidates.total })}</p> : null}
      </Card>
    </HrFrame>
  );
}
