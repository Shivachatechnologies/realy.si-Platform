import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { ActionButton } from "@/components/hr/hr-action";
import { HrForm } from "@/components/hr/hr-form";
import { minutesLabel, peopleOptions, weekStart } from "@/components/hr/options";
import { HrFrame, loadHr, personName } from "@/components/hr/shell";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { employeeOptions } from "@/server/modules/hr/employees";
import { listSchedules, myAttendance, timesheet } from "@/server/modules/hr/time";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("hr.tabs.time") };
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export default async function TimePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const { t, viewer, org, company, access, base, tz } = await loadHr(locale);
  const allowed = !!access?.read;
  const frame = { t, locale, title: t("hr.time.title"), subtitle: t("hr.time.subtitle"), tab: "time" as const, access, hasCompany: !!company, allowed };
  if (!company || !allowed) return <HrFrame {...frame}>{null}</HrFrame>;
  const raw = await searchParams;
  const week = typeof raw.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.week) ? weekStart(new Date(`${raw.week}T00:00:00Z`)) : weekStart(new Date());
  const shift = (days: number) => new Date(new Date(`${week}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const manage = access!.manage;
  const [sheet, mine, schedules, people] = await Promise.all([
    timesheet(viewer.ctx, org.id, company.id, week),
    myAttendance(viewer.ctx, org.id, company.id),
    listSchedules(viewer.ctx, org.id, company.id),
    manage ? employeeOptions(viewer.ctx, org.id, company.id) : Promise.resolve([]),
  ]);
  const weekdayName = (iso: number) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, iso)));
  return (
    <HrFrame {...frame}>
      {access!.me ? (
        <Card>
          <CardHeader title={t("hr.time.myTime")} description={mine.open ? t("hr.time.clockedInSince", { time: formatDateTime(mine.open.clockIn, locale, tz) }) : t("hr.time.notClockedIn")} />
          <CardBody className="flex flex-wrap items-center gap-3">
            {mine.open ? <ActionButton endpoint={`${base}/hr/attendance/clock`} body={{ action: "out" }} label={t("hr.time.clockOut")} variant="default" /> : <ActionButton endpoint={`${base}/hr/attendance/clock`} body={{ action: "in" }} label={t("hr.time.clockIn")} variant="default" />}
            <span className="text-xs text-muted-foreground">{t("hr.time.timezoneNote", { tz })}</span>
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader
          title={t("hr.time.timesheet")}
          description={t("hr.time.weekOf", { date: formatDate(`${week}T00:00:00Z`, locale, "UTC") })}
          actions={
            <div className="flex gap-2 text-xs">
              <Link href={`/${locale}/hr/time?week=${shift(-7)}`} className="hover:underline">
                {t("hr.time.prevWeek")}
              </Link>
              <Link href={`/${locale}/hr/time`} className="hover:underline">
                {t("hr.time.thisWeek")}
              </Link>
              <Link href={`/${locale}/hr/time?week=${shift(7)}`} className="hover:underline">
                {t("hr.time.nextWeek")}
              </Link>
            </div>
          }
        />
        {sheet.rows.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("hr.employee")}</Th>
                {sheet.days.map((d) => (
                  <Th key={d} className="text-end">
                    {formatDate(`${d}T00:00:00Z`, locale, "UTC", { weekday: "short", day: "numeric" })}
                  </Th>
                ))}
                <Th className="text-end">{t("hr.time.total")}</Th>
              </Tr>
            </THead>
            <TBody>
              {sheet.rows.map((r) => (
                <Tr key={r.employee.id}>
                  <Td>
                    <Link href={`/${locale}/hr/employees/${r.employee.id}?tab=time`} className="hover:underline">
                      {personName(r.employee)}
                    </Link>
                    {r.open ? <Badge tone="accent" className="ms-2">{t("hr.time.working")}</Badge> : null}
                  </Td>
                  {r.perDay.map((m, i) => (
                    <Td key={i} className={cn("text-end tabular-nums", !m && "text-muted-foreground")}>
                      {m ? minutesLabel(m) : "·"}
                    </Td>
                  ))}
                  <Td className="text-end font-medium tabular-nums">{minutesLabel(r.total)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("hr.time.noPeople")}</p>
        )}
        {manage ? (
          <details className="border-t">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("hr.time.addManual")}</summary>
            <HrForm
              className="px-3 pb-3"
              columns={3}
              endpoint={`${base}/hr/attendance`}
              fields={[
                { name: "employeeId", label: t("hr.employee"), type: "select", required: true, options: peopleOptions(people) },
                { name: "date", label: t("hr.date"), type: "date", required: true },
                { name: "clockIn", label: t("hr.time.in"), type: "time", required: true },
                { name: "clockOut", label: t("hr.time.out"), type: "time", required: true },
                { name: "note", label: t("hr.note"), full: true },
              ]}
              submitLabel={t("hr.add")}
            />
          </details>
        ) : null}
        {manage && sheet.sessions.length ? (
          <details className="border-t">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("hr.time.sessions", { count: sheet.sessions.length })}</summary>
            <ul className="grid gap-1 px-3 pb-3 text-xs">
              {sheet.sessions.map((s) => {
                const p = sheet.rows.find((r) => r.employee.id === s.employeeId)?.employee;
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p ? personName(p) : ""}</span>
                    <span>
                      {formatDateTime(s.clockIn, locale, tz)} – {s.clockOut ? formatDateTime(s.clockOut, locale, tz) : "…"}
                    </span>
                    {s.note ? <span className="text-muted-foreground">{s.note}</span> : null}
                    <ActionButton endpoint={`${base}/hr/attendance/${s.id}`} method="DELETE" label={t("hr.delete")} variant="ghost" confirm={t("hr.confirmDelete")} />
                  </li>
                );
              })}
            </ul>
          </details>
        ) : null}
      </Card>
      <Card>
        <CardHeader title={t("hr.time.schedules")} description={t("hr.time.schedulesHint")} />
        <CardBody className="grid gap-3">
          {schedules.length ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {schedules.map((s) => (
                <li key={s.id} className="grid gap-1 rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    {s.isDefault ? <Badge tone="success">{t("hr.onboarding.default")}</Badge> : null}
                    <span className="text-xs text-muted-foreground">{t("hr.org.peopleCount", { count: s._count.employees })}</span>
                    {manage ? (
                      <span className="ms-auto">
                        <ActionButton endpoint={`${base}/hr/schedules/${s.id}`} method="DELETE" label={t("hr.archive")} variant="ghost" confirm={t("hr.confirmArchive")} />
                      </span>
                    ) : null}
                  </div>
                  <span className="text-xs">
                    {s.weekdays.map((d) => weekdayName(d)).join(", ")} · {s.startTime}–{s.endTime} · {t("hr.time.breakMinutes", { count: s.breakMinutes })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("hr.time.noSchedules")}</p>
          )}
          {manage ? (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">{t("hr.time.addSchedule")}</summary>
              <HrForm
                className="mt-3"
                columns={3}
                endpoint={`${base}/hr/schedules`}
                fields={[
                  { name: "name", label: t("hr.org.name"), required: true },
                  { name: "startTime", label: t("hr.time.start"), type: "time", required: true },
                  { name: "endTime", label: t("hr.time.end"), type: "time", required: true },
                  { name: "weekdays", label: t("hr.time.weekdays"), type: "multiselect", options: WEEKDAYS.map((d) => ({ value: String(d), label: weekdayName(d) })) },
                  { name: "breakMinutes", label: t("hr.time.break"), type: "number", min: 0, max: 240 },
                  { name: "isDefault", label: t("hr.onboarding.default"), type: "checkbox", hint: t("hr.time.defaultHint") },
                ]}
                initial={{ startTime: "09:00", endTime: "17:00", weekdays: ["1", "2", "3", "4", "5"], breakMinutes: 60 }}
                submitLabel={t("common.create")}
              />
              <p className="mt-2 text-xs text-muted-foreground">{t("hr.time.assignHint")}</p>
            </details>
          ) : null}
        </CardBody>
      </Card>
    </HrFrame>
  );
}
