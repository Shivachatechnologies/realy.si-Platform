import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { ActionButton } from "@/components/hr/hr-action";
import { HrForm } from "@/components/hr/hr-form";
import { LEAVE_TONE, namedOptions, peopleOptions } from "@/components/hr/options";
import { HrFrame, loadHr, personName } from "@/components/hr/shell";
import { cn } from "@/lib/utils";
import { formatDate } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { enumParam } from "@/server/modules/hr/access";
import { employeeOptions } from "@/server/modules/hr/employees";
import { LEAVE_STATUSES, listHolidays, listLeaveRequests, listLeaveTypes, whosOut } from "@/server/modules/hr/time";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.tabs.leave") };
}

const VIEWS = ["approvals", "all", "mine"] as const;

export default async function LeavePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const { t, viewer, org, company, access, base } = await loadHr(locale);
  const allowed = !!access?.read;
  const frame = { t, locale, title: t("hr.leave.title"), subtitle: t("hr.leave.subtitle"), tab: "leave" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const raw = await searchParams;
  const view = enumParam(raw, "view", VIEWS) ?? (access!.manage ? "approvals" : access!.me ? "mine" : "all");
  const status = enumParam(raw, "status", LEAVE_STATUSES);
  const year = Number(typeof raw.year === "string" && /^\d{4}$/.test(raw.year) ? raw.year : new Date().getUTCFullYear());
  const manage = access!.manage;
  const [requests, types, holidays, out, people] = await Promise.all([
    listLeaveRequests(viewer.ctx, org.id, company.id, { view, status }),
    listLeaveTypes(viewer.ctx, org.id, company.id),
    listHolidays(viewer.ctx, org.id, company.id, year),
    whosOut(viewer.ctx, org.id, company.id, 30),
    manage ? employeeOptions(viewer.ctx, org.id, company.id) : Promise.resolve([]),
  ]);
  const myId = access!.me?.id;
  return (
    <HrFrame {...frame}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title={t("hr.leave.requests")}
            description={t("hr.leave.count", { count: requests.length })}
            actions={
              <div className="flex gap-1 text-xs">
                {VIEWS.map((v) => (
                  <Link key={v} href={`/${locale}/hr/leave?view=${v}`} aria-current={view === v ? "page" : undefined} className={cn("rounded-md px-2 py-1", view === v ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}>
                    {t(`hr.leave.views.${v}`)}
                  </Link>
                ))}
              </div>
            }
          />
          {view !== "approvals" ? (
            <div className="flex flex-wrap gap-1 border-b px-3 py-2 text-xs">
              <Link href={`/${locale}/hr/leave?view=${view}`} className={cn("rounded px-2 py-0.5", !status ? "bg-muted" : "hover:bg-muted/60")}>
                {t("common.all")}
              </Link>
              {LEAVE_STATUSES.map((s) => (
                <Link key={s} href={`/${locale}/hr/leave?view=${view}&status=${s}`} className={cn("rounded px-2 py-0.5", status === s ? "bg-muted" : "hover:bg-muted/60")}>
                  {t(`hr.leaveStatus.${s}`)}
                </Link>
              ))}
            </div>
          ) : null}
          {requests.length ? (
            <ul className="grid divide-y">
              {requests.map((r) => {
                const own = r.employee.id === myId;
                return (
                  <li key={r.id} className="grid gap-1 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/${locale}/hr/employees/${r.employee.id}?tab=time`} className="font-medium hover:underline">
                        {personName(r.employee)}
                      </Link>
                      <Badge>{r.leaveType.name}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(r.startDate, locale, "UTC")} – {formatDate(r.endDate, locale, "UTC")} · {t("hr.leave.daysCount", { count: r.days })}
                      </span>
                      <Badge tone={LEAVE_TONE[r.status]}>{t(`hr.leaveStatus.${r.status}`)}</Badge>
                    </div>
                    {r.reason ? <p className="text-xs text-muted-foreground">{r.reason}</p> : null}
                    {r.decisionNote ? <p className="text-xs">{t("hr.leave.decisionNote", { note: r.decisionNote })}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      {r.status === "PENDING" && !own ? (
                        <>
                          <ActionButton endpoint={`${base}/hr/leave-requests/${r.id}`} method="PATCH" body={{ decision: "APPROVED" }} label={t("hr.leave.approve")} variant="default" />
                          <details>
                            <summary className="cursor-pointer py-1 text-xs text-danger">{t("hr.leave.reject")}</summary>
                            <HrForm className="mt-1" columns={1} method="PATCH" endpoint={`${base}/hr/leave-requests/${r.id}`} extra={{ decision: "REJECTED" }} fields={[{ name: "note", label: t("hr.leave.rejectReason") }]} submitLabel={t("hr.leave.reject")} />
                          </details>
                        </>
                      ) : null}
                      {(r.status === "PENDING" || r.status === "APPROVED") && (own || manage) ? <ActionButton endpoint={`${base}/hr/leave-requests/${r.id}`} method="PATCH" body={{ decision: "CANCELLED" }} label={t("hr.leave.cancel")} variant="ghost" confirm={t("hr.leave.cancelConfirm")} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{view === "approvals" ? t("hr.leave.nothingToApprove") : t("hr.leave.noRequests")}</p>
          )}
        </Card>
        <div className="grid content-start gap-4">
          {access!.me || manage ? (
            <Card>
              <CardHeader title={t("hr.leave.request")} />
              <CardBody>
                {types.length ? (
                  <HrForm
                    columns={1}
                    endpoint={`${base}/hr/leave-requests`}
                    fields={[
                      ...(manage ? [{ name: "employeeId", label: t("hr.leave.forEmployee"), type: "select" as const, options: peopleOptions(people), hint: t("hr.leave.forEmployeeHint") }] : []),
                      { name: "leaveTypeId", label: t("hr.leave.type"), type: "select", required: true, options: namedOptions(types) },
                      { name: "startDate", label: t("hr.startDate"), type: "date", required: true },
                      { name: "endDate", label: t("hr.endDate"), type: "date", required: true },
                      { name: "halfDay", label: t("hr.leave.halfDay"), type: "checkbox", hint: t("hr.leave.halfDayHint") },
                      { name: "reason", label: t("hr.leave.reason"), type: "textarea", rows: 2 },
                    ]}
                    initial={{ leaveTypeId: types[0]?.id }}
                    submitLabel={t("hr.leave.submit")}
                    successMessage={t("hr.leave.submitted")}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">{t("hr.leave.noTypes")}</p>
                )}
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t("hr.overview.whosOut")} />
            <CardBody>
              {out.length ? (
                <ul className="grid gap-1 text-sm">
                  {out.map((r) => (
                    <li key={r.id} className="flex flex-wrap gap-2">
                      <span className="font-medium">{personName(r.employee)}</span>
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
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("hr.leave.types")} description={t("hr.leave.typesHint")} />
          {types.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("hr.org.name")}</Th>
                  <Th className="text-end">{t("hr.leave.yearlyAllowance")}</Th>
                  <Th>{t("hr.leave.paid")}</Th>
                  <Th>{t("hr.leave.approval")}</Th>
                  {manage ? <Th /> : null}
                </Tr>
              </THead>
              <TBody>
                {types.map((lt) => (
                  <Tr key={lt.id}>
                    <Td>{lt.name}</Td>
                    <Td className="text-end">{lt.yearlyAllowance || t("hr.leave.untracked")}</Td>
                    <Td>{lt.paid ? t("common.yes") : t("common.no")}</Td>
                    <Td>{lt.requiresApproval ? t("hr.leave.required") : t("hr.leave.auto")}</Td>
                    {manage ? (
                      <Td>
                        <details>
                          <summary className="cursor-pointer text-xs text-muted-foreground">{t("hr.edit")}</summary>
                          <HrForm
                            className="mt-2"
                            columns={1}
                            method="PATCH"
                            endpoint={`${base}/hr/leave-types/${lt.id}`}
                            fields={[
                              { name: "name", label: t("hr.org.name"), required: true },
                              { name: "yearlyAllowance", label: t("hr.leave.yearlyAllowance"), type: "number", step: "0.5", min: 0 },
                              { name: "paid", label: t("hr.leave.paid"), type: "checkbox", hint: t("hr.leave.paidHint") },
                              { name: "requiresApproval", label: t("hr.leave.approval"), type: "checkbox", hint: t("hr.leave.approvalHint") },
                            ]}
                            initial={{ name: lt.name, yearlyAllowance: lt.yearlyAllowance, paid: lt.paid, requiresApproval: lt.requiresApproval }}
                            submitLabel={t("common.save")}
                          />
                          <ActionButton endpoint={`${base}/hr/leave-types/${lt.id}`} method="DELETE" label={t("hr.archive")} variant="ghost" confirm={t("hr.confirmArchive")} />
                        </details>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("hr.leave.noTypes")}</p>
          )}
          {manage ? (
            <details className="border-t">
              <summary className="cursor-pointer p-3 text-sm font-medium">{t("hr.leave.addType")}</summary>
              <HrForm
                className="px-3 pb-3"
                endpoint={`${base}/hr/leave-types`}
                fields={[
                  { name: "name", label: t("hr.org.name"), required: true, placeholder: t("hr.leave.typePlaceholder") },
                  { name: "yearlyAllowance", label: t("hr.leave.yearlyAllowance"), type: "number", step: "0.5", min: 0, hint: t("hr.leave.allowanceHint") },
                  { name: "paid", label: t("hr.leave.paid"), type: "checkbox", hint: t("hr.leave.paidHint") },
                  { name: "requiresApproval", label: t("hr.leave.approval"), type: "checkbox", hint: t("hr.leave.approvalHint") },
                ]}
                initial={{ paid: true, requiresApproval: true, yearlyAllowance: 20 }}
                submitLabel={t("common.create")}
              />
            </details>
          ) : null}
        </Card>
        <Card>
          <CardHeader
            title={t("hr.leave.holidays", { year })}
            actions={
              <div className="flex gap-2 text-xs">
                <Link href={`/${locale}/hr/leave?view=${view}&year=${year - 1}`} className="hover:underline">
                  {year - 1}
                </Link>
                <Link href={`/${locale}/hr/leave?view=${view}&year=${year + 1}`} className="hover:underline">
                  {year + 1}
                </Link>
              </div>
            }
          />
          <CardBody className="grid gap-3">
            {holidays.length ? (
              <ul className="grid gap-1 text-sm">
                {holidays.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-2">
                    <span className="w-36 text-muted-foreground">{formatDate(h.date, locale, "UTC", { weekday: "short", day: "numeric", month: "short" })}</span>
                    <span>{h.name}</span>
                    {manage ? <ActionButton endpoint={`${base}/hr/holidays/${h.id}`} method="DELETE" label="×" variant="ghost" /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("hr.leave.noHolidays")}</p>
            )}
            {manage ? (
              <HrForm
                endpoint={`${base}/hr/holidays`}
                fields={[
                  { name: "name", label: t("hr.org.name"), required: true },
                  { name: "date", label: t("hr.date"), type: "date", required: true },
                ]}
                submitLabel={t("hr.leave.addHoliday")}
              />
            ) : null}
          </CardBody>
        </Card>
      </div>
    </HrFrame>
  );
}
