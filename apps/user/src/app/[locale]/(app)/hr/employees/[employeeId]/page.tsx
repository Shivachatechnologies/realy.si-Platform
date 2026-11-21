import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { ActionButton } from "@/components/hr/hr-action";
import { HrForm } from "@/components/hr/hr-form";
import { enumOptions, fileSize, LEAVE_TONE, minutesLabel, namedOptions, peopleOptions, STATUS_TONE } from "@/components/hr/options";
import { HrFrame, loadHr, personName } from "@/components/hr/shell";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatMoney } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { toMajor } from "@/server/modules/hr/access";
import { AiPanel } from "@/components/hr/ai-panel";
import { listSubjectTasks } from "@/server/modules/agents/service";
import {
  ACCEPTED_DOCUMENT_EXTENSIONS,
  DOCUMENT_CATEGORIES,
  EMPLOYMENT_TYPES,
  employeeOptions,
  getEmployee,
  linkableUsers,
  listDesignations,
  MAX_DOCUMENT_BYTES,
  STATUS_TRANSITIONS,
} from "@/server/modules/hr/employees";
import { onboardingOf } from "@/server/modules/hr/onboarding";
import { listDepartments, listTeams } from "@/server/modules/hr/org";
import { employeeCompensation, listStructures } from "@/server/modules/hr/payroll";
import { FEEDBACK_KINDS, GOAL_STATUSES, objectiveOptions, performanceOf, PLAN_STATUSES } from "@/server/modules/hr/performance";
import { attendanceOf, leaveBalances, listLeaveRequests, listLeaveTypes, listSchedules } from "@/server/modules/hr/time";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.employees.profile") };
}

const TABS = ["overview", "performance", "time", "documents", "onboarding", "history", "payroll"] as const;
type Tab = (typeof TABS)[number];

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ employeeId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { employeeId } = await params;
  const sp = await searchParams;
  const locale = await getLocale();
  const { t, viewer, org, company, access, base, tz } = await loadHr(locale);
  const allowed = !!access?.read;
  const frame = { t, locale, title: t("hr.employees.profile"), tab: "employees" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const e = await getEmployee(viewer.ctx, org.id, company.id, employeeId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const { manage, privileged, isManager, isSelf } = e.access;
  const canPerf = manage || isSelf || isManager;
  const visible: Tab[] = TABS.filter((k) => {
    if (k === "performance" || k === "time") return canPerf;
    if (k === "documents" || k === "onboarding") return privileged;
    if (k === "history") return privileged || isManager;
    if (k === "payroll") return access!.payrollRead;
    return true;
  });
  const tabParam = typeof sp.tab === "string" ? sp.tab : "overview";
  const tab: Tab = (visible as string[]).includes(tabParam) ? (tabParam as Tab) : "overview";
  const year = new Date().getUTCFullYear();
  const name = personName(e);
  const field = (label: string, value: ReactNode) => (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value || "—"}</dd>
    </div>
  );

  let body: ReactNode = null;
  if (tab === "overview") {
    const [departments, teams, people, designations, users, schedules] = manage
      ? await Promise.all([
          listDepartments(viewer.ctx, org.id, company.id),
          listTeams(viewer.ctx, org.id, company.id),
          employeeOptions(viewer.ctx, org.id, company.id),
          listDesignations(viewer.ctx, org.id, company.id),
          access!.usersRead ? linkableUsers(viewer.ctx, org.id, company.id) : Promise.resolve([]),
          listSchedules(viewer.ctx, org.id, company.id),
        ])
      : [[], [], [], [], [], []];
    const transitions = STATUS_TRANSITIONS[e.status];
    body = (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          <Card>
            <CardHeader title={t("hr.employees.jobInfo")} />
            <CardBody>
              <dl className="grid gap-3 sm:grid-cols-3">
                {field(t("hr.jobTitle"), e.title)}
                {field(t("hr.designation"), e.designation ? [e.designation.name, e.designation.level].filter(Boolean).join(" · ") : null)}
                {field(t("hr.department"), e.department?.name)}
                {field(t("hr.team"), e.team?.name)}
                {field(t("hr.manager"), e.manager ? <Link href={`/${locale}/hr/employees/${e.manager.id}`} className="hover:underline">{personName(e.manager)}</Link> : null)}
                {field(t("hr.employmentTypeLabel"), t(`hr.employmentType.${e.employmentType}`))}
                {field(t("hr.startDate"), e.startDate ? formatDate(e.startDate, locale, "UTC") : null)}
                {field(t("hr.endDate"), e.endDate ? formatDate(e.endDate, locale, "UTC") : null)}
                {field(t("hr.employeeNumber"), e.employeeNumber)}
                {field(t("hr.workEmail"), e.email)}
                {field(t("hr.phone"), e.phone)}
                {field(t("hr.location"), [e.location, e.timezone].filter(Boolean).join(" · "))}
                {field(t("hr.schedule"), e.workSchedule?.name)}
              </dl>
              {e.skills.length ? (
                <div className="mt-3 flex flex-wrap gap-1">
                  {e.skills.map((s) => (
                    <Badge key={s}>{s}</Badge>
                  ))}
                </div>
              ) : null}
              {e.bio ? <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{e.bio}</p> : null}
            </CardBody>
          </Card>
          {privileged ? (
            <Card>
              <CardHeader title={t("hr.employees.personalInfo")} description={t("hr.employees.personalHint")} />
              <CardBody>
                <dl className="grid gap-3 sm:grid-cols-3">
                  {field(t("hr.personalEmail"), e.personalEmail)}
                  {field(t("hr.dateOfBirth"), e.dateOfBirth ? formatDate(e.dateOfBirth, locale, "UTC") : null)}
                  {field(t("hr.address"), e.address)}
                  {field(t("hr.emergencyContact"), [e.emergencyName, e.emergencyPhone].filter(Boolean).join(" · "))}
                </dl>
                {isSelf && !manage ? (
                  <p className="mt-3 text-xs">
                    <Link href={`/${locale}/hr/me`} className="text-primary hover:underline">
                      {t("hr.me.editProfile")}
                    </Link>
                  </p>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
          {manage ? (
            <Card>
              <CardHeader title={t("hr.employees.edit")} />
              <CardBody>
                <HrForm
                  method="PATCH"
                  columns={3}
                  endpoint={`${base}/hr/employees/${e.id}`}
                  fields={[
                    { name: "firstName", label: t("hr.firstName"), required: true },
                    { name: "lastName", label: t("hr.lastName") },
                    { name: "email", label: t("hr.workEmail"), type: "email" },
                    { name: "phone", label: t("hr.phone"), type: "tel" },
                    { name: "employeeNumber", label: t("hr.employeeNumber") },
                    { name: "designationId", label: t("hr.designation"), type: "select", options: namedOptions(designations) },
                    { name: "title", label: t("hr.jobTitle") },
                    { name: "departmentId", label: t("hr.department"), type: "select", options: namedOptions(departments) },
                    { name: "teamId", label: t("hr.team"), type: "select", options: namedOptions(teams) },
                    { name: "managerId", label: t("hr.manager"), type: "select", options: peopleOptions(people.filter((p) => p.id !== e.id)) },
                    { name: "employmentType", label: t("hr.employmentTypeLabel"), type: "select", required: true, options: enumOptions(t, "hr.employmentType", EMPLOYMENT_TYPES) },
                    { name: "workScheduleId", label: t("hr.schedule"), type: "select", options: namedOptions(schedules) },
                    { name: "startDate", label: t("hr.startDate"), type: "date" },
                    { name: "location", label: t("hr.location") },
                    { name: "timezone", label: t("hr.timezone"), placeholder: "Europe/Ljubljana" },
                    { name: "skills", label: t("hr.skills"), type: "tags", hint: t("hr.tagsHint") },
                    { name: "personalEmail", label: t("hr.personalEmail"), type: "email" },
                    { name: "dateOfBirth", label: t("hr.dateOfBirth"), type: "date" },
                    { name: "address", label: t("hr.address") },
                    { name: "emergencyName", label: t("hr.emergencyName") },
                    { name: "emergencyPhone", label: t("hr.emergencyPhone"), type: "tel" },
                    { name: "bio", label: t("hr.bio"), type: "textarea", rows: 3 },
                  ]}
                  initial={{
                    firstName: e.firstName,
                    lastName: e.lastName,
                    email: e.email,
                    phone: e.phone,
                    employeeNumber: e.employeeNumber,
                    designationId: e.designationId,
                    title: e.title,
                    departmentId: e.departmentId,
                    teamId: e.teamId,
                    managerId: e.managerId,
                    employmentType: e.employmentType,
                    workScheduleId: e.workScheduleId,
                    startDate: e.startDate?.toISOString().slice(0, 10),
                    location: e.location,
                    timezone: e.timezone,
                    skills: e.skills,
                    personalEmail: e.personalEmail,
                    dateOfBirth: e.dateOfBirth?.toISOString().slice(0, 10),
                    address: e.address,
                    emergencyName: e.emergencyName,
                    emergencyPhone: e.emergencyPhone,
                    bio: e.bio,
                  }}
                  submitLabel={t("common.save")}
                />
              </CardBody>
            </Card>
          ) : null}
        </div>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("hr.employees.reports")} description={t("hr.org.reportsCount", { count: e.reports.length })} />
            <CardBody>
              {e.reports.length ? (
                <ul className="grid gap-1 text-sm">
                  {e.reports.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <Link href={`/${locale}/hr/employees/${r.id}`} className="hover:underline">
                        {personName(r)}
                      </Link>
                      <span className="truncate text-xs text-muted-foreground">{r.title}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("hr.employees.noReports")}</p>
              )}
            </CardBody>
          </Card>
          {manage ? (
            <Card>
              <CardHeader title={t("hr.employees.lifecycle")} description={t("hr.employees.lifecycleHint")} />
              <CardBody>
                {transitions.length ? (
                  <HrForm
                    columns={1}
                    endpoint={`${base}/hr/employees/${e.id}/status`}
                    fields={[
                      { name: "status", label: t("hr.employees.newStatus"), type: "select", required: true, options: enumOptions(t, "hr.status", transitions) },
                      { name: "date", label: t("hr.effectiveDate"), type: "date" },
                      { name: "note", label: t("hr.note"), type: "textarea", rows: 2 },
                      { name: "startChecklist", label: t("hr.employees.startChecklist"), type: "checkbox", hint: t("hr.employees.startChecklistHint") },
                    ]}
                    initial={{ status: transitions[0], startChecklist: true }}
                    resetOnSuccess={false}
                    submitLabel={t("hr.employees.changeStatus")}
                  />
                ) : null}
                {e.status === "TERMINATED" ? (
                  <div className="mt-3">
                    <ActionButton endpoint={`${base}/hr/employees/${e.id}`} method="DELETE" label={t("hr.employees.archiveRecord")} variant="danger" confirm={t("hr.confirmArchive")} redirectTo="/hr/employees" />
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t("hr.employees.platformUser")} description={t("hr.employees.platformUserHint")} />
            <CardBody className="grid gap-2 text-sm">
              {e.user ? (
                <p>
                  {e.user.name} <span className="text-xs text-muted-foreground">{e.user.email}</span>
                </p>
              ) : (
                <p className="text-muted-foreground">{t("hr.employees.notLinked")}</p>
              )}
              {manage && access!.usersRead ? (
                <>
                  <HrForm
                    columns={1}
                    endpoint={`${base}/hr/employees/${e.id}/user`}
                    fields={[{ name: "userId", label: t("hr.employees.user"), type: "select", required: true, options: users.map((u) => ({ value: u.id, label: `${u.name} — ${u.email}` })) }]}
                    initial={{ userId: e.userId ?? users[0]?.id }}
                    resetOnSuccess={false}
                    submitLabel={t("hr.employees.link")}
                  />
                  {e.userId ? <ActionButton endpoint={`${base}/hr/employees/${e.id}/user`} body={{ userId: null }} label={t("hr.employees.unlink")} variant="ghost" /> : null}
                </>
              ) : null}
              <Link href={`/${locale}/settings/members`} className="text-xs text-primary hover:underline">
                {t("hr.org.platformAccess")}
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    );
  } else if (tab === "performance") {
    const [perf, objectives] = await Promise.all([performanceOf(viewer.ctx, org.id, company.id, e.id), objectiveOptions(org.id, company.id)]);
    const lead = perf.access.canLead;
    body = (
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("hr.perf.kpis")} />
          <CardBody className="grid gap-3">
            {perf.kpis.length ? (
              <Table>
                <THead>
                  <Tr>
                    <Th>{t("hr.perf.kpi")}</Th>
                    <Th>{t("hr.perf.period")}</Th>
                    <Th className="text-end">{t("hr.perf.target")}</Th>
                    <Th className="text-end">{t("hr.perf.actual")}</Th>
                    {lead ? <Th /> : null}
                  </Tr>
                </THead>
                <TBody>
                  {perf.kpis.map((k) => (
                    <Tr key={k.id}>
                      <Td>{k.name}</Td>
                      <Td>{k.period}</Td>
                      <Td className="text-end">
                        {k.target} {k.unit}
                      </Td>
                      <Td className={cn("text-end", k.actual != null && (k.actual >= k.target ? "text-success" : "text-warning"))}>{k.actual ?? "—"}</Td>
                      {lead ? (
                        <Td>
                          <details>
                            <summary className="cursor-pointer text-xs text-muted-foreground">{t("hr.edit")}</summary>
                            <HrForm columns={1} method="PATCH" endpoint={`${base}/hr/kpis/${k.id}`} fields={[{ name: "actual", label: t("hr.perf.actual"), type: "number", step: "any" }]} initial={{ actual: k.actual }} submitLabel={t("common.save")} />
                            <ActionButton endpoint={`${base}/hr/kpis/${k.id}`} method="DELETE" label={t("hr.delete")} variant="ghost" confirm={t("hr.confirmDelete")} />
                          </details>
                        </Td>
                      ) : null}
                    </Tr>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.perf.noKpis")}</p>
            )}
            {lead ? (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">{t("hr.perf.addKpi")}</summary>
                <HrForm
                  className="mt-3"
                  endpoint={`${base}/hr/kpis`}
                  extra={{ employeeId: e.id }}
                  fields={[
                    { name: "name", label: t("hr.perf.kpi"), required: true },
                    { name: "period", label: t("hr.perf.period"), required: true, placeholder: `${year}-Q4` },
                    { name: "target", label: t("hr.perf.target"), type: "number", step: "any", required: true },
                    { name: "actual", label: t("hr.perf.actual"), type: "number", step: "any" },
                    { name: "unit", label: t("hr.perf.unit"), placeholder: "%" },
                  ]}
                  submitLabel={t("hr.add")}
                />
              </details>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("hr.perf.goals")} />
          <CardBody className="grid gap-3">
            {perf.goals.length ? (
              <ul className="grid gap-2">
                {perf.goals.map((g) => (
                  <li key={g.id} className="grid gap-1 rounded-md border p-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{g.title}</span>
                      <Badge tone={g.status === "COMPLETED" ? "success" : g.status === "AT_RISK" ? "danger" : "neutral"}>{t(`hr.goalStatus.${g.status}`)}</Badge>
                      {g.dueDate ? <span className="text-xs text-muted-foreground">{formatDate(g.dueDate, locale, "UTC")}</span> : null}
                    </div>
                    {g.objective ? <span className="text-xs text-muted-foreground">{t("hr.perf.supports", { objective: g.objective.title })}</span> : null}
                    <div className="h-1.5 rounded-full bg-muted">
                      <div className="h-1.5 rounded-full bg-primary" style={{ width: `${g.progress}%` }} />
                    </div>
                    {lead || isSelf ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground">{t("hr.perf.updateGoal")}</summary>
                        <HrForm
                          className="mt-2"
                          method="PATCH"
                          endpoint={`${base}/hr/goals/${g.id}`}
                          fields={[
                            { name: "progress", label: t("hr.perf.progress"), type: "number", min: 0, max: 100 },
                            { name: "status", label: t("common.status"), type: "select", required: true, options: enumOptions(t, "hr.goalStatus", GOAL_STATUSES) },
                          ]}
                          initial={{ progress: g.progress, status: g.status }}
                          submitLabel={t("common.save")}
                        />
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.perf.noGoals")}</p>
            )}
            {lead || isSelf ? (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">{t("hr.perf.addGoal")}</summary>
                <HrForm
                  className="mt-3"
                  endpoint={`${base}/hr/goals`}
                  extra={{ employeeId: e.id }}
                  fields={[
                    { name: "title", label: t("hr.perf.goal"), required: true },
                    { name: "dueDate", label: t("hr.dueDate"), type: "date" },
                    { name: "objectiveId", label: t("hr.perf.objective"), type: "select", options: objectives.map((o) => ({ value: o.id, label: o.title })) },
                    { name: "description", label: t("hr.org.description"), type: "textarea", rows: 2 },
                  ]}
                  submitLabel={t("hr.add")}
                />
              </details>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("hr.perf.reviews")} description={t("hr.perf.historyHint")} />
          <CardBody>
            {perf.reviews.length ? (
              <ul className="grid gap-3">
                {perf.reviews.map((r) => (
                  <li key={r.id} className="grid gap-1 rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.cycle.name}</span>
                      <Badge tone={r.status === "COMPLETED" ? "success" : "warning"}>{t(`hr.reviewStatus.${r.status}`)}</Badge>
                      {r.reviewer ? <span className="text-xs text-muted-foreground">{t("hr.perf.reviewer", { name: personName(r.reviewer) })}</span> : null}
                    </div>
                    {r.selfRating ? (
                      <p>
                        <span className="text-xs text-muted-foreground">{t("hr.perf.selfReview")}: </span>
                        {"★".repeat(r.selfRating)} <span className="whitespace-pre-wrap">{r.selfComments}</span>
                      </p>
                    ) : null}
                    {r.managerRating ? (
                      <p>
                        <span className="text-xs text-muted-foreground">{t("hr.perf.managerReview")}: </span>
                        {"★".repeat(r.managerRating)} <span className="whitespace-pre-wrap">{r.managerComments}</span>
                      </p>
                    ) : null}
                    {r.status !== "COMPLETED" && r.cycle.status === "ACTIVE" && (manage || (isManager && r.reviewerId)) && !isSelf ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-primary">{t("hr.perf.writeManagerReview")}</summary>
                        <HrForm
                          className="mt-2"
                          columns={1}
                          endpoint={`${base}/hr/reviews/${r.id}`}
                          extra={{ as: "manager" }}
                          fields={[
                            { name: "rating", label: t("hr.perf.rating"), type: "select", required: true, options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} — ${t(`hr.ratings.${n}`)}` })) },
                            { name: "comments", label: t("hr.perf.comments"), type: "textarea", required: true, rows: 4 },
                          ]}
                          submitLabel={t("hr.perf.submitReview")}
                        />
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.perf.noReviews")}</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("hr.perf.feedback")} />
          <CardBody className="grid gap-3">
            {perf.feedback.length ? (
              <ul className="grid gap-2">
                {perf.feedback.map((f) => (
                  <li key={f.id} className="grid gap-0.5 rounded-md border p-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge tone={f.kind === "PRAISE" ? "success" : f.kind === "CONSTRUCTIVE" ? "warning" : "neutral"}>{t(`hr.feedbackKind.${f.kind}`)}</Badge>
                      {f.isPrivate ? <Badge>{t("hr.perf.private")}</Badge> : null}
                      <span className="text-muted-foreground">{[f.authorName, formatDate(f.createdAt, locale, tz)].filter(Boolean).join(" · ")}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{f.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.perf.noFeedback")}</p>
            )}
            {!isSelf ? (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">{t("hr.perf.giveFeedback")}</summary>
                <HrForm
                  className="mt-3"
                  columns={1}
                  endpoint={`${base}/hr/feedback`}
                  extra={{ employeeId: e.id }}
                  fields={[
                    { name: "kind", label: t("hr.perf.kind"), type: "select", required: true, options: enumOptions(t, "hr.feedbackKind", FEEDBACK_KINDS) },
                    { name: "body", label: t("hr.perf.feedback"), type: "textarea", required: true, rows: 3 },
                    { name: "isPrivate", label: t("hr.perf.private"), type: "checkbox", hint: t("hr.perf.privateHint") },
                  ]}
                  initial={{ kind: "PRAISE" }}
                  submitLabel={t("hr.perf.send")}
                />
              </details>
            ) : null}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={t("hr.perf.plans")} />
          <CardBody className="grid gap-3">
            {perf.plans.length ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {perf.plans.map((p) => (
                  <li key={p.id} className="grid gap-1 rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{p.title}</span>
                      <Badge tone={p.status === "COMPLETED" ? "success" : "neutral"}>{t(`hr.planStatus.${p.status}`)}</Badge>
                      {p.dueDate ? <span className="text-xs text-muted-foreground">{formatDate(p.dueDate, locale, "UTC")}</span> : null}
                    </div>
                    {p.focusArea ? <span className="text-xs text-muted-foreground">{p.focusArea}</span> : null}
                    {p.actions ? <p className="whitespace-pre-wrap">{p.actions}</p> : null}
                    {lead ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground">{t("hr.edit")}</summary>
                        <HrForm
                          className="mt-2"
                          columns={1}
                          method="PATCH"
                          endpoint={`${base}/hr/development-plans/${p.id}`}
                          fields={[
                            { name: "status", label: t("common.status"), type: "select", required: true, options: enumOptions(t, "hr.planStatus", PLAN_STATUSES) },
                            { name: "actions", label: t("hr.perf.actions"), type: "textarea", rows: 4 },
                          ]}
                          initial={{ status: p.status, actions: p.actions }}
                          submitLabel={t("common.save")}
                        />
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.perf.noPlans")}</p>
            )}
            {lead ? (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">{t("hr.perf.addPlan")}</summary>
                <HrForm
                  className="mt-3"
                  endpoint={`${base}/hr/development-plans`}
                  extra={{ employeeId: e.id }}
                  fields={[
                    { name: "title", label: t("hr.perf.planTitle"), required: true },
                    { name: "focusArea", label: t("hr.perf.focusArea") },
                    { name: "dueDate", label: t("hr.dueDate"), type: "date" },
                    { name: "actions", label: t("hr.perf.actions"), type: "textarea", rows: 3, hint: t("hr.perf.actionsHint") },
                  ]}
                  submitLabel={t("hr.add")}
                />
              </details>
            ) : null}
          </CardBody>
        </Card>
      </div>
    );
  } else if (tab === "time") {
    const [balances, requests, attendance, leaveTypes] = await Promise.all([
      leaveBalances(viewer.ctx, org.id, company.id, e.id, year),
      listLeaveRequests(viewer.ctx, org.id, company.id, { employeeId: e.id }),
      attendanceOf(viewer.ctx, org.id, company.id, e.id),
      manage ? listLeaveTypes(viewer.ctx, org.id, company.id) : Promise.resolve([]),
    ]);
    body = (
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("hr.leave.balances", { year })} />
          <Table>
            <THead>
              <Tr>
                <Th>{t("hr.leave.type")}</Th>
                <Th className="text-end">{t("hr.leave.allowance")}</Th>
                <Th className="text-end">{t("hr.leave.taken")}</Th>
                <Th className="text-end">{t("hr.leave.pending")}</Th>
                <Th className="text-end">{t("hr.leave.remaining")}</Th>
              </Tr>
            </THead>
            <TBody>
              {balances.map((b) => (
                <Tr key={b.leaveType.id}>
                  <Td>{b.leaveType.name}</Td>
                  <Td className="text-end">{b.allowance || "∞"}</Td>
                  <Td className="text-end">{b.taken}</Td>
                  <Td className="text-end">{b.pending}</Td>
                  <Td className="text-end font-medium">{b.remaining ?? "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          {manage ? (
            <details className="border-t p-3">
              <summary className="cursor-pointer text-sm font-medium">{t("hr.leave.setAllowance")}</summary>
              <HrForm
                className="mt-3"
                endpoint={`${base}/hr/leave-allowances`}
                extra={{ employeeId: e.id }}
                fields={[
                  { name: "leaveTypeId", label: t("hr.leave.type"), type: "select", required: true, options: namedOptions(leaveTypes) },
                  { name: "year", label: t("hr.year"), type: "number", required: true, min: 2000, max: 2100 },
                  { name: "days", label: t("hr.leave.days"), type: "number", required: true, step: "0.5", min: 0 },
                ]}
                initial={{ year }}
                submitLabel={t("common.save")}
              />
            </details>
          ) : null}
        </Card>
        <Card>
          <CardHeader title={t("hr.leave.requests")} />
          <CardBody>
            {requests.length ? (
              <ul className="grid gap-1.5 text-sm">
                {requests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={LEAVE_TONE[r.status]}>{t(`hr.leaveStatus.${r.status}`)}</Badge>
                    <span>{r.leaveType.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(r.startDate, locale, "UTC")} – {formatDate(r.endDate, locale, "UTC")} · {t("hr.leave.daysCount", { count: r.days })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.leave.noRequests")}</p>
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={t("hr.time.attendance")} />
          {attendance.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("hr.date")}</Th>
                  <Th>{t("hr.time.in")}</Th>
                  <Th>{t("hr.time.out")}</Th>
                  <Th className="text-end">{t("hr.time.hours")}</Th>
                  <Th className="hidden sm:table-cell">{t("hr.note")}</Th>
                </Tr>
              </THead>
              <TBody>
                {attendance.map((a) => (
                  <Tr key={a.id}>
                    <Td>{formatDate(a.date, locale, "UTC")}</Td>
                    <Td>{formatDateTime(a.clockIn, locale, tz)}</Td>
                    <Td>{a.clockOut ? formatDateTime(a.clockOut, locale, tz) : <Badge tone="accent">{t("hr.time.working")}</Badge>}</Td>
                    <Td className="text-end tabular-nums">{a.minutes != null ? minutesLabel(a.minutes) : "—"}</Td>
                    <Td className="hidden sm:table-cell text-xs text-muted-foreground">{a.note}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("hr.time.noAttendance")}</p>
          )}
        </Card>
      </div>
    );
  } else if (tab === "documents") {
    body = (
      <Card>
        <CardHeader
          title={t("hr.docs.title")}
          description={t("hr.docs.hint", { types: ACCEPTED_DOCUMENT_EXTENSIONS.join(", ") })}
          actions={
            manage ? (
              <Link href={`/${locale}/hr/documents?employee=${e.id}`} className="text-xs font-medium text-primary hover:underline">
                {t("hr.docgen.generateFor")}
              </Link>
            ) : null
          }
        />
        <CardBody className="grid gap-3">
          {e.documents.length ? (
            <ul className="grid divide-y rounded-md border">
              {e.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <a href={`${base}/hr/documents/${d.id}${d.category === "letter" && d.mimeType === "text/html" ? "?view=1" : ""}`} target={d.category === "letter" ? "_blank" : undefined} rel="noreferrer" className="font-medium hover:underline">
                    {d.name}
                  </a>
                  <Badge>{t(`hr.docCategory.${d.category}`)}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {d.filename} · {fileSize(d.sizeBytes)} · {formatDate(d.createdAt, locale, tz)}
                  </span>
                  {manage ? (
                    <span className="ms-auto">
                      <ActionButton endpoint={`${base}/hr/documents/${d.id}`} method="DELETE" label={t("hr.delete")} variant="ghost" confirm={t("hr.confirmDelete")} />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("hr.docs.empty")}</p>
          )}
          <HrForm
            endpoint={`${base}/hr/employees/${e.id}/documents`}
            fields={[
              { name: "name", label: t("hr.docs.name"), required: true, maxLength: 200 },
              { name: "category", label: t("hr.docs.category"), type: "select", required: true, options: enumOptions(t, "hr.docCategory", DOCUMENT_CATEGORIES) },
              { name: "file", label: t("hr.docs.file"), type: "file", required: true, flatten: true, accept: ACCEPTED_DOCUMENT_EXTENSIONS.join(","), maxBytes: MAX_DOCUMENT_BYTES, full: true },
            ]}
            initial={{ category: "contract" }}
            submitLabel={t("hr.docs.upload")}
          />
        </CardBody>
      </Card>
    );
  } else if (tab === "onboarding") {
    const data = await onboardingOf(viewer.ctx, org.id, company.id, e.id);
    body = (
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("hr.onboarding.checklists")} />
          <CardBody className="grid gap-3">
            {data.checklists.length ? (
              <ul className="grid gap-2">
                {data.checklists.map((c) => (
                  <li key={c.id} className="grid gap-1 rounded-md border p-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/${locale}/hr/onboarding/${c.id}`} className="font-medium hover:underline">
                        {t(`hr.checklistKind.${c.kind}`)}
                      </Link>
                      <Badge tone={c.status === "COMPLETED" ? "success" : c.status === "CANCELLED" ? "neutral" : "accent"}>{t(`hr.checklistStatus.${c.status}`)}</Badge>
                      <span className="text-xs text-muted-foreground">{t("hr.onboarding.progress", { done: c.done, total: c.total })}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted">
                      <div className="h-1.5 rounded-full bg-primary" style={{ width: `${c.percent}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.onboarding.none")}</p>
            )}
            {manage ? (
              <HrForm
                endpoint={`${base}/hr/checklists`}
                extra={{ employeeId: e.id }}
                fields={[
                  { name: "kind", label: t("hr.onboarding.kind"), type: "select", required: true, options: enumOptions(t, "hr.checklistKind", ["ONBOARDING", "OFFBOARDING"]) },
                  { name: "startDate", label: t("hr.startDate"), type: "date" },
                ]}
                initial={{ kind: e.status === "OFFBOARDING" ? "OFFBOARDING" : "ONBOARDING" }}
                submitLabel={t("hr.onboarding.start")}
              />
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("hr.assets.assigned")} actions={manage ? <Link href={`/${locale}/hr/onboarding/assets`} className="text-xs text-primary hover:underline">{t("hr.assets.register")}</Link> : null} />
          <CardBody>
            {data.assets.length ? (
              <ul className="grid gap-1.5 text-sm">
                {data.assets.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.asset.name}</span>
                    <Badge>{a.asset.tag}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(a.assignedAt, locale, tz)} – {a.returnedAt ? formatDate(a.returnedAt, locale, tz) : t("hr.assets.current")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.assets.noneAssigned")}</p>
            )}
          </CardBody>
        </Card>
      </div>
    );
  } else if (tab === "history") {
    body = (
      <Card>
        <CardHeader title={t("hr.history.title")} />
        <CardBody>
          {e.history.length ? (
            <ol className="grid gap-2 border-s ps-4">
              {e.history.map((h) => (
                <li key={h.id} className="text-sm">
                  <span className="text-xs text-muted-foreground">{formatDateTime(h.createdAt, locale, tz)}</span>
                  <p>
                    {t(`hr.history.kinds.${h.kind}`)}
                    {h.kind === "status" || h.kind === "created" ? (
                      <>
                        {": "}
                        {h.fromValue ? `${t(`hr.status.${h.fromValue}`)} → ` : ""}
                        {h.toValue ? t(`hr.status.${h.toValue}`) : ""}
                      </>
                    ) : h.kind === "document" ? (
                      `: ${h.toValue ?? ""}`
                    ) : null}
                  </p>
                  {h.note ? <p className="text-xs text-muted-foreground">{h.note}</p> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">{t("hr.history.empty")}</p>
          )}
        </CardBody>
      </Card>
    );
  } else if (tab === "payroll") {
    const [comps, structures] = await Promise.all([employeeCompensation(viewer.ctx, org.id, company.id, e.id), access!.payrollManage ? listStructures(viewer.ctx, org.id, company.id) : Promise.resolve([])]);
    body = (
      <Card>
        <CardHeader title={t("hr.payroll.compensation")} description={t("hr.payroll.restricted")} />
        <CardBody className="grid gap-3">
          {comps.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("hr.payroll.effectiveFrom")}</Th>
                  <Th className="text-end">{t("hr.payroll.baseMonthly")}</Th>
                  <Th>{t("hr.payroll.structure")}</Th>
                  <Th>{t("hr.note")}</Th>
                </Tr>
              </THead>
              <TBody>
                {comps.map((c) => (
                  <Tr key={c.id}>
                    <Td>{formatDate(c.effectiveFrom, locale, "UTC")}</Td>
                    <Td className="text-end tabular-nums">{formatMoney({ amountMinor: c.baseMonthlyMinor, currency: c.currency }, locale)}</Td>
                    <Td>{c.structure?.name ?? "—"}</Td>
                    <Td className="text-xs text-muted-foreground">{c.note}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">{t("hr.payroll.noCompensation")}</p>
          )}
          {access!.payrollManage ? (
            <HrForm
              endpoint={`${base}/hr/payroll/compensation`}
              extra={{ employeeId: e.id }}
              fields={[
                { name: "baseMonthly", label: t("hr.payroll.baseMonthly"), type: "money", required: true },
                { name: "currency", label: t("hr.currency"), placeholder: company.baseCurrency, maxLength: 3 },
                { name: "effectiveFrom", label: t("hr.payroll.effectiveFrom"), type: "date", required: true },
                { name: "structureId", label: t("hr.payroll.structure"), type: "select", options: namedOptions(structures) },
                { name: "note", label: t("hr.note") },
              ]}
              initial={{ baseMonthly: comps[0] ? toMajor(comps[0].baseMonthlyMinor, comps[0].currency) : "" }}
              submitLabel={t("hr.payroll.addCompensation")}
            />
          ) : null}
        </CardBody>
      </Card>
    );
  }

  // AI HR assistant: onboarding plan (HR managers, onboarding tab) and performance review draft (leads, performance tab).
  const aiModes = tab === "onboarding" && manage ? (["onboarding_plan"] as const) : tab === "performance" && (manage || isManager) ? (["review_draft"] as const) : [];
  const aiTasks = aiModes.length && access!.agentsRun ? await listSubjectTasks(viewer.ctx, org.id, company.id, "hr_employee", e.id, 5).catch(() => []) : [];
  const aiPanel = aiModes.length ? (
    <AiPanel
      t={t}
      locale={locale}
      tz={tz}
      title={t("hr.ai.assistantTitle")}
      description={t(tab === "onboarding" ? "hr.ai.onboardingPlanHint" : "hr.ai.reviewDraftHint")}
      canRun={access!.agentsRun}
      actions={aiModes.map((mode) => ({ label: t(mode === "onboarding_plan" ? "hr.ai.onboardingPlan" : "hr.ai.reviewDraft"), endpoint: `${base}/hr/employees/${e.id}/assist`, body: { mode } }))}
      tasks={aiTasks}
    />
  ) : null;

  return (
    <HrFrame
      {...frame}
      title={name}
      subtitle={[e.title, e.department?.name].filter(Boolean).join(" · ") || undefined}
      actions={
        <>
          <Badge tone={STATUS_TONE[e.status]}>{t(`hr.status.${e.status}`)}</Badge>
          <Link href={`/${locale}/hr/employees`} className="text-sm text-muted-foreground hover:underline">
            {t("hr.employees.back")}
          </Link>
        </>
      }
    >
      <nav className="flex gap-1 overflow-x-auto text-sm" aria-label={t("hr.employees.profile")}>
        {visible.map((k) => (
          <Link
            key={k}
            href={`/${locale}/hr/employees/${e.id}?tab=${k}`}
            aria-current={tab === k ? "page" : undefined}
            className={cn("shrink-0 rounded-md px-3 py-1.5", tab === k ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}
          >
            {t(`hr.employees.tabs.${k}`)}
          </Link>
        ))}
      </nav>
      {body}
      {aiPanel}
    </HrFrame>
  );
}
