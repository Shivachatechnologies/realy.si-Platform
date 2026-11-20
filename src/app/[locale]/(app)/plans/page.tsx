import type { Metadata } from "next";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { ActionButton } from "@/components/workforce/action-button";
import { AiAvatar } from "@/components/workforce/avatar";
import { PageHeader } from "@/components/workforce/page-header";
import { ScheduleEditDialog } from "@/components/workforce/schedule-edit-dialog";
import { ScheduleForm } from "@/components/workforce/schedule-form";
import { PageState } from "@/components/workforce/states";
import { WorkforceTabs } from "@/components/workforce/workforce-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { DOMAIN_EVENTS } from "@/server/modules/events/catalog";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { listScheduleRuns, listSchedules } from "@/server/modules/workforce/schedules";
import { listEmployees } from "@/server/modules/workforce/service";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("plans.title") };
}

export default async function PlansPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <>
      <PageHeader title={t("plans.title")} subtitle={t("plans.subtitle")} />
      <WorkforceTabs locale={locale} active="plans" labels={{ employees: t("workforce.tabs.employees"), org: t("workforce.tabs.org"), hire: t("workforce.tabs.hire"), usage: t("workforce.tabs.usage"), plans: t("workforce.tabs.plans"), tasks: t("workforce.tabs.tasks") }} />
    </>
  );
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "agents.read", chain), can(viewer.ctx, "agents.manage", chain)]);
  if (!canRead) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;
  const [schedules, runs, employees] = await Promise.all([listSchedules(viewer.ctx, org.id, company.id), listScheduleRuns(viewer.ctx, org.id, company.id, 30), listEmployees(viewer.ctx, org.id, company.id)]);
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const tz = viewer.user.timezone;
  const pickable = employees.map((e) => ({ id: e.id, name: e.name, profileKey: e.profileKey }));
  const when = (s: (typeof schedules)[number]) => {
    if (s.kind === "EVENT") return t("plans.describe.event", { event: s.eventType ?? "" });
    if (s.frequency === "HOURLY") return t("plans.describe.hourly", { minute: (s.timeOfDay ?? "00:00").slice(3) });
    if (s.frequency === "WEEKLY") return t("plans.describe.weekly", { day: t(`plans.weekdays.${s.weekday ?? 1}`), time: s.timeOfDay ?? "" });
    return t("plans.describe.daily", { time: s.timeOfDay ?? "" });
  };

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <p className="text-xs text-muted-foreground">{t("plans.timezoneNote", { tz: company.timezone })}</p>
      {canManage ? (
        <Card>
          <CardHeader title={t("plans.new")} />
          <CardBody>
            {pickable.length === 0 ? (
              <div className="grid justify-items-start gap-2">
                <p className="text-sm text-muted-foreground">{t("plans.needsEmployee")}</p>
                <Button asChild size="sm">
                  <Link href={`/${locale}/workforce/hire`}>{t("workforce.hire.title")}</Link>
                </Button>
              </div>
            ) : (
              <ScheduleForm apiBase={apiBase} employees={pickable} eventTypes={DOMAIN_EVENTS} />
            )}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("plans.list")} description={t("plans.count", { count: schedules.length })} />
        {schedules.length === 0 ? (
          <CardBody className="text-sm text-muted-foreground">{t("plans.empty")}</CardBody>
        ) : (
          <ul className="divide-y">
            {schedules.map((s) => (
              <li key={s.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="grid min-w-0 gap-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {s.name}
                    <Badge tone={s.enabled ? "success" : "neutral"}>{s.enabled ? t("common.enabled") : t("common.disabled")}</Badge>
                    <Badge>{t(`plans.kinds.${s.kind}`)}</Badge>
                    {s.briefingMode ? <Badge tone="accent">{t(`intelligence.modes.${s.briefingMode}`)}</Badge> : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Link href={`/${locale}/workforce/${s.aiEmployee.id}`} className="flex items-center gap-1 hover:underline">
                      <AiAvatar id={s.aiEmployee.id} initials={s.aiEmployee.initials} size="sm" paused={s.aiEmployee.status === "PAUSED"} />
                      {s.aiEmployee.name}
                    </Link>
                    <span>{when(s)}</span>
                    <span>{s.lastRunAt ? t("plans.lastRun", { when: formatDateTime(s.lastRunAt, locale, tz), count: s.runCount }) : t("plans.neverRun")}</span>
                  </span>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{s.instructions}</p>
                </div>
                {canManage ? (
                  <div className="flex flex-wrap items-start gap-1">
                    <ActionButton path={`${apiBase}/workforce/schedules/${s.id}`} method="PATCH" body={{ enabled: !s.enabled }} variant="ghost">
                      {s.enabled ? t("plans.disable") : t("plans.enable")}
                    </ActionButton>
                    <ScheduleEditDialog
                      apiBase={apiBase}
                      employees={pickable}
                      eventTypes={DOMAIN_EVENTS}
                      scheduleId={s.id}
                      initial={{
                        aiEmployeeId: s.aiEmployeeId,
                        name: s.name,
                        kind: s.kind,
                        frequency: s.frequency ?? "DAILY",
                        timeOfDay: s.timeOfDay ?? "09:00",
                        weekday: s.weekday ?? 1,
                        eventType: s.eventType ?? DOMAIN_EVENTS[0],
                        instructions: s.instructions,
                        briefingMode: s.briefingMode ?? "",
                        enabled: s.enabled,
                      }}
                    />
                    <ActionButton path={`${apiBase}/workforce/schedules/${s.id}`} method="DELETE" variant="ghost" size="icon" confirm={t("plans.confirmDelete", { name: s.name })}>
                      <Trash2 aria-hidden />
                      <span className="sr-only">{t("plans.delete")}</span>
                    </ActionButton>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={t("plans.runs")} description={t("plans.runsHint")} />
        {runs.length === 0 ? (
          <CardBody className="text-sm text-muted-foreground">{t("plans.noRuns")}</CardBody>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("plans.columns.schedule")}</Th>
                <Th>{t("plans.columns.slot")}</Th>
                <Th>{t("plans.columns.result")}</Th>
                <Th>{t("plans.columns.when")}</Th>
              </Tr>
            </THead>
            <TBody>
              {runs.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-medium">{r.schedule.name}</Td>
                  <Td className="font-mono text-xs">{r.slot.startsWith("event:") ? t("plans.eventSlot") : r.slot}</Td>
                  <Td>
                    {r.taskId ? (
                      <Link className="text-primary hover:underline" href={`/${locale}/tasks/${r.taskId}`}>
                        {t("plans.viewTask")}
                      </Link>
                    ) : r.error ? (
                      <span className="text-xs text-danger">{t(`errors.reasons.${r.error}`) !== `errors.reasons.${r.error}` ? t(`errors.reasons.${r.error}`) : r.error}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("plans.pending")}</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.createdAt, locale, tz)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
