import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { ActionButton } from "@/components/hr/hr-action";
import { HrForm } from "@/components/hr/hr-form";
import { LEAVE_TONE, namedOptions } from "@/components/hr/options";
import { HrFrame, loadHr, personName } from "@/components/hr/shell";
import { formatDate, formatDateTime, formatMoney } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { onboardingOf } from "@/server/modules/hr/onboarding";
import { myPayslips } from "@/server/modules/hr/payroll";
import { myPendingReviews } from "@/server/modules/hr/performance";
import { listRequests, policiesToAcknowledge } from "@/server/modules/hr/policies";
import { myInterviews } from "@/server/modules/hr/recruiting";
import { leaveBalances, listLeaveRequests, listLeaveTypes, myAttendance } from "@/server/modules/hr/time";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.tabs.me") };
}

export default async function MyHrPage() {
  const locale = await getLocale();
  const { t, viewer, org, company, access, base, tz } = await loadHr(locale);
  const allowed = !!access?.read;
  const frame = { t, locale, title: t("hr.me.title"), subtitle: t("hr.me.subtitle"), tab: "me" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const me = access!.me;
  if (!me) {
    return (
      <HrFrame {...frame}>
        <Notice tone="info">{t("hr.me.notLinked")}</Notice>
      </HrFrame>
    );
  }
  const year = new Date().getUTCFullYear();
  const [attendance, balances, requests, types, payslips, policies, reviews, interviews, myRequests, onboarding] = await Promise.all([
    myAttendance(viewer.ctx, org.id, company.id),
    leaveBalances(viewer.ctx, org.id, company.id, me.id, year),
    listLeaveRequests(viewer.ctx, org.id, company.id, { view: "mine" }),
    listLeaveTypes(viewer.ctx, org.id, company.id),
    myPayslips(viewer.ctx, org.id, company.id),
    policiesToAcknowledge(viewer.ctx, org.id, company.id),
    myPendingReviews(viewer.ctx, org.id, company.id),
    myInterviews(viewer.ctx, org.id, company.id),
    listRequests(viewer.ctx, org.id, company.id, { mine: true }),
    onboardingOf(viewer.ctx, org.id, company.id, me.id),
  ]);
  const openChecklists = onboarding.checklists.filter((c) => c.status === "IN_PROGRESS");
  return (
    <HrFrame
      {...frame}
      actions={
        <Link href={`/${locale}/hr/employees/${me.id}`} className="text-sm text-primary hover:underline">
          {t("hr.me.fullProfile")}
        </Link>
      }
    >
      {policies.length || reviews.self.length || openChecklists.length ? (
        <Card>
          <CardHeader title={t("hr.me.todo")} />
          <CardBody className="grid gap-3">
            {openChecklists.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/${locale}/hr/onboarding/${c.id}`} className="font-medium text-primary hover:underline">
                  {t(`hr.checklistKind.${c.kind}`)}
                </Link>
                <span className="text-xs text-muted-foreground">{t("hr.onboarding.progress", { done: c.done, total: c.total })}</span>
              </div>
            ))}
            {policies.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/${locale}/hr/policies/${p.id}`} className="font-medium hover:underline">
                  {p.title}
                </Link>
                <Badge tone="warning">{t("hr.policies.needsAck")}</Badge>
                <ActionButton endpoint={`${base}/hr/policies/${p.id}/acknowledge`} label={t("hr.policies.acknowledge")} />
              </div>
            ))}
            {reviews.self.map((r) => (
              <section key={r.id} id="reviews" className="grid gap-2 rounded-md border p-3">
                <p className="text-sm font-medium">{t("hr.perf.selfReviewFor", { cycle: r.cycle.name })}</p>
                <HrForm
                  columns={1}
                  endpoint={`${base}/hr/reviews/${r.id}`}
                  extra={{ as: "self" }}
                  fields={[
                    { name: "rating", label: t("hr.perf.rating"), type: "select", required: true, options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} — ${t(`hr.ratings.${n}`)}` })) },
                    { name: "comments", label: t("hr.perf.selfComments"), type: "textarea", required: true, rows: 5, hint: t("hr.perf.selfHint") },
                  ]}
                  submitLabel={t("hr.perf.submitReview")}
                />
              </section>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t("hr.time.myTime")} description={attendance.open ? t("hr.time.clockedInSince", { time: formatDateTime(attendance.open.clockIn, locale, tz) }) : t("hr.time.notClockedIn")} />
          <CardBody className="grid gap-3">
            {attendance.open ? <ActionButton endpoint={`${base}/hr/attendance/clock`} body={{ action: "out" }} label={t("hr.time.clockOut")} variant="default" size="default" /> : <ActionButton endpoint={`${base}/hr/attendance/clock`} body={{ action: "in" }} label={t("hr.time.clockIn")} variant="default" size="default" />}
            {attendance.recent.length ? (
              <ul className="grid gap-0.5 text-xs text-muted-foreground">
                {attendance.recent.slice(0, 5).map((a) => (
                  <li key={a.id}>
                    {formatDateTime(a.clockIn, locale, tz)} – {a.clockOut ? formatDateTime(a.clockOut, locale, tz) : "…"}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
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
          {!balances.length ? <p className="p-4 text-sm text-muted-foreground">{t("hr.leave.noTypes")}</p> : null}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("hr.leave.request")} />
          <CardBody className="grid gap-3">
            {types.length ? (
              <HrForm
                endpoint={`${base}/hr/leave-requests`}
                fields={[
                  { name: "leaveTypeId", label: t("hr.leave.type"), type: "select", required: true, options: namedOptions(types) },
                  { name: "halfDay", label: t("hr.leave.halfDay"), type: "checkbox", hint: t("hr.leave.halfDayHint") },
                  { name: "startDate", label: t("hr.startDate"), type: "date", required: true },
                  { name: "endDate", label: t("hr.endDate"), type: "date", required: true },
                  { name: "reason", label: t("hr.leave.reason"), type: "textarea", rows: 2 },
                ]}
                initial={{ leaveTypeId: types[0]?.id }}
                submitLabel={t("hr.leave.submit")}
                successMessage={t("hr.leave.submitted")}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.leave.noTypes")}</p>
            )}
            {requests.length ? (
              <ul className="grid gap-1.5 border-t pt-3 text-sm">
                {requests.slice(0, 10).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={LEAVE_TONE[r.status]}>{t(`hr.leaveStatus.${r.status}`)}</Badge>
                    <span>{r.leaveType.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(r.startDate, locale, "UTC")} – {formatDate(r.endDate, locale, "UTC")} · {t("hr.leave.daysCount", { count: r.days })}
                    </span>
                    {r.status === "PENDING" ? <ActionButton endpoint={`${base}/hr/leave-requests/${r.id}`} method="PATCH" body={{ decision: "CANCELLED" }} label={t("hr.leave.cancel")} variant="ghost" /> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("hr.me.payslips")} />
          <CardBody>
            {payslips.length ? (
              <ul className="grid gap-1.5 text-sm">
                {payslips.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/${locale}/hr/payroll/payslips/${p.id}`} className="font-medium hover:underline">
                      {p.run.period.name}
                    </Link>
                    <span className="text-xs text-muted-foreground">{formatDate(p.run.period.payDate, locale, "UTC")}</span>
                    <span className="tabular-nums">{formatMoney({ amountMinor: p.netMinor, currency: p.currency }, locale)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.me.noPayslips")}</p>
            )}
          </CardBody>
        </Card>
        {interviews.length || reviews.asReviewer.length ? (
          <Card>
            <CardHeader title={t("hr.me.asInterviewer")} />
            <CardBody className="grid gap-2 text-sm">
              {interviews.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{personName(i.candidate)}</span>
                  <span className="text-muted-foreground">{i.candidate.job.title}</span>
                  <span className="text-xs">{formatDateTime(i.scheduledAt, locale, tz)}</span>
                  <Link href={`/${locale}/hr/recruiting/interviews/${i.id}`} className="text-primary hover:underline">
                    {t("hr.recruiting.addScorecard")}
                  </Link>
                </div>
              ))}
              {reviews.asReviewer.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/${locale}/hr/employees/${r.employee.id}?tab=performance`} className="text-primary hover:underline">
                    {t("hr.perf.reviewOf", { name: personName(r.employee), cycle: r.cycle.name })}
                  </Link>
                  <Badge tone="warning">{t(`hr.reviewStatus.${r.status}`)}</Badge>
                </div>
              ))}
            </CardBody>
          </Card>
        ) : null}
        <Card>
          <CardHeader title={t("hr.requests.mine")} actions={<Link href={`/${locale}/hr/requests`} className="text-xs text-primary hover:underline">{t("hr.requests.new")}</Link>} />
          <CardBody>
            {myRequests.length ? (
              <ul className="grid gap-1.5 text-sm">
                {myRequests.slice(0, 8).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <span>{r.subject}</span>
                    <Badge>{t(`hr.requestStatus.${r.status}`)}</Badge>
                    {r.resolution ? <span className="text-xs text-muted-foreground">{r.resolution}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.requests.empty")}</p>
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={t("hr.me.editProfile")} description={t("hr.me.editProfileHint")} />
          <CardBody>
            <HrForm
              method="PATCH"
              columns={3}
              endpoint={`${base}/hr/me/profile`}
              fields={[
                { name: "phone", label: t("hr.phone"), type: "tel" },
                { name: "personalEmail", label: t("hr.personalEmail"), type: "email" },
                { name: "timezone", label: t("hr.timezone") },
                { name: "address", label: t("hr.address") },
                { name: "emergencyName", label: t("hr.emergencyName") },
                { name: "emergencyPhone", label: t("hr.emergencyPhone"), type: "tel" },
                { name: "skills", label: t("hr.skills"), type: "tags", hint: t("hr.tagsHint") },
                { name: "bio", label: t("hr.bio"), type: "textarea", rows: 3 },
              ]}
              initial={{ phone: me.phone, personalEmail: me.personalEmail, timezone: me.timezone, address: me.address, emergencyName: me.emergencyName, emergencyPhone: me.emergencyPhone, skills: me.skills, bio: me.bio }}
              submitLabel={t("common.save")}
            />
          </CardBody>
        </Card>
      </div>
    </HrFrame>
  );
}
