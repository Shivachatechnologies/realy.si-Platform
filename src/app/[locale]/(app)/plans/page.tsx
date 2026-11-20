import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CalendarDays, ListChecks, Repeat, Trash2, Zap } from "lucide-react";
import { PlanComposer } from "@/components/ai-plans/plan-composer";
import { WeekCalendar } from "@/components/ai-plans/week-calendar";
import { HelpMeButton } from "@/components/guide-kit/help-me";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { SmartEmpty } from "@/components/guide-kit/smart-empty";
import { introLabels, latestSubjectTask } from "@/components/guide-kit/server";
import { ActionButton } from "@/components/workforce/action-button";
import { AiAvatar } from "@/components/workforce/avatar";
import { ScheduleEditDialog } from "@/components/workforce/schedule-edit-dialog";
import { PageState } from "@/components/workforce/states";
import { WorkforceTabs } from "@/components/workforce/workforce-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { getDraft } from "@/server/modules/cockpit/drafts";
import { DOMAIN_EVENTS } from "@/server/modules/events/catalog";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { listScheduleRuns, listSchedules } from "@/server/modules/workforce/schedules";
import { listEmployees } from "@/server/modules/workforce/service";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("plans.title") };
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export default async function PlansPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <PageHeader icon={<CalendarClock />} eyebrow={t("aiPlans.eyebrow")} title={t("plans.title")} description={t("plans.subtitle")}>
      <WorkforceTabs locale={locale} active="plans" labels={{ employees: t("workforce.tabs.employees"), org: t("workforce.tabs.org"), hire: t("workforce.tabs.hire"), usage: t("workforce.tabs.usage"), plans: t("workforce.tabs.plans"), tasks: t("workforce.tabs.tasks") }} />
    </PageHeader>
  );
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage, canRun] = await Promise.all([can(viewer.ctx, "agents.read", chain), can(viewer.ctx, "agents.manage", chain), can(viewer.ctx, "agents.run", chain)]);
  if (!canRead) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;
  const [schedules, runs, employees, draft, helpTask] = await Promise.all([
    listSchedules(viewer.ctx, org.id, company.id),
    listScheduleRuns(viewer.ctx, org.id, company.id, 30),
    listEmployees(viewer.ctx, org.id, company.id),
    canManage ? getDraft(viewer.ctx, org.id, company.id, "plans.editor").catch(() => null) : null,
    canRun ? latestSubjectTask(viewer.ctx, org.id, company.id, "ai_plans", company.id) : null,
  ]);
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const tz = viewer.user.timezone;
  const pickable = employees.map((e) => ({ id: e.id, name: e.name, profileKey: e.profileKey }));
  const eventLabel = (ev: string) => {
    const k = `timeline.events.${ev.replace(/\./g, "_")}`;
    return t(k) === k ? ev : t(k);
  };
  const when = (s: (typeof schedules)[number]) => {
    if (s.kind === "EVENT") return t("aiPlans.sentence.event", { event: eventLabel(s.eventType ?? "") });
    if (s.frequency === "HOURLY") return t("aiPlans.sentence.hourly", { minute: (s.timeOfDay ?? "00:00").slice(3) });
    if (s.frequency === "WEEKLY") return t("aiPlans.sentence.weekly", { day: t(`plans.weekdays.${s.weekday ?? 1}`), time: s.timeOfDay ?? "" });
    return t("aiPlans.sentence.daily", { time: s.timeOfDay ?? "" });
  };
  const todayWeekday = WD[new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: company.timezone ?? "UTC" }).format(new Date())] ?? 1;
  const enabled = schedules.filter((s) => s.enabled);
  const perWeek = enabled.reduce((n, s) => n + (s.kind === "EVENT" ? 0 : s.frequency === "HOURLY" ? 168 : s.frequency === "DAILY" ? 7 : 1), 0);

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <PageIntro
        labels={introLabels(t)}
        accent="success"
        what={t("aiPlans.intro.what")}
        why={t("aiPlans.intro.why")}
        can={t("aiPlans.intro.can")}
        next={canManage && pickable.length ? { label: t("aiPlans.intro.next"), href: "#plan-editor" } : { label: t("workforce.hire.title"), href: `/${locale}/workforce/hire` }}
      />
      <StatGrid>
        <StatTile index={0} label={t("aiPlans.stats.active")} value={enabled.length} icon={<CalendarDays />} hint={t("aiPlans.stats.paused", { count: schedules.length - enabled.length })} />
        <StatTile index={1} label={t("aiPlans.stats.perWeek")} value={perWeek} icon={<Repeat />} hint={t("aiPlans.stats.perWeekHint")} />
        <StatTile index={2} label={t("aiPlans.stats.triggers")} value={enabled.filter((s) => s.kind === "EVENT").length} icon={<Zap />} hint={t("aiPlans.stats.triggersHint")} />
        <StatTile index={3} label={t("aiPlans.stats.runs")} value={runs.length} icon={<ListChecks />} hint={t("aiPlans.stats.runsHint")} />
      </StatGrid>

      <Card variant="elevated">
        <CardHeader icon={<CalendarDays />} title={t("aiPlans.calendar.title")} description={t("plans.timezoneNote", { tz: company.timezone })} />
        <CardBody>
          {schedules.length ? (
            <WeekCalendar
              plans={schedules.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled, kind: s.kind, frequency: s.frequency, timeOfDay: s.timeOfDay, weekday: s.weekday, eventLabel: s.eventType ? eventLabel(s.eventType) : null, employee: { id: s.aiEmployee.id, name: s.aiEmployee.name } }))}
              todayWeekday={todayWeekday}
              locale={locale}
              labels={{
                weekday: (n) => t(`plans.weekdays.${n}`),
                hourly: (minute) => t("aiPlans.calendar.hourly", { minute }),
                events: t("aiPlans.calendar.events"),
                eventsEmpty: t("aiPlans.calendar.eventsEmpty"),
                paused: t("common.disabled"),
                today: t("timeline.today"),
                nothing: t("aiPlans.calendar.nothing"),
              }}
            />
          ) : (
            <SmartEmpty
              icon={<CalendarClock />}
              title={t("aiPlans.empty.title")}
              body={t("aiPlans.empty.body")}
              primary={
                canManage && pickable.length ? (
                  <Button asChild size="sm">
                    <a href="#plan-editor">{t("aiPlans.intro.next")}</a>
                  </Button>
                ) : (
                  <Button asChild size="sm">
                    <Link href={`/${locale}/workforce/hire`}>{t("workforce.hire.title")}</Link>
                  </Button>
                )
              }
            />
          )}
        </CardBody>
      </Card>

      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card variant="highlight" id="plan-editor" className="scroll-mt-20">
            <CardHeader icon={<CalendarClock />} title={t("aiPlans.composer.title")} description={t("aiPlans.composer.subtitle")} />
            <CardBody>
              {pickable.length === 0 ? (
                <div className="grid justify-items-start gap-2">
                  <p className="text-sm text-muted-foreground">{t("plans.needsEmployee")}</p>
                  <Button asChild size="sm">
                    <Link href={`/${locale}/workforce/hire`}>{t("workforce.hire.title")}</Link>
                  </Button>
                </div>
              ) : (
                <PlanComposer
                  apiBase={apiBase}
                  employees={employees.map((e) => ({ id: e.id, name: e.name, initials: e.initials, profileKey: e.profileKey, department: e.department }))}
                  eventTypes={DOMAIN_EVENTS}
                  draft={draft ? { step: draft.step, data: draft.data } : null}
                  timezone={company.timezone ?? "UTC"}
                />
              )}
            </CardBody>
          </Card>
          {canRun ? (
            <Card variant="glass">
              <CardHeader title={t("aiPlans.help.title")} description={t("aiPlans.help.hint")} />
              <CardBody>
                <HelpMeButton
                  base={apiBase}
                  aiReady={aiConfigured()}
                  profile="ai_ceo"
                  subject={{ type: "ai_plans", id: company.id }}
                  title="Suggest a weekly rhythm for my AI team"
                  instructions={`The person is on the AI Plans page (recurring AI work) and is not technical. Their AI employees: ${employees.map((e) => `${e.name} (${e.profileKey})`).join("; ") || "none"}. Existing plans: ${schedules.map((s) => `"${s.name}" — ${when(s)} by ${s.aiEmployee.name}`).join("; ") || "none"}. Read the company's objectives, then suggest up to 4 recurring plans (or event triggers) that would help most. For each, write one plain sentence like "Every Monday at 09:00, have <employee> …" plus the exact instructions to paste into the plan editor. Do not repeat existing plans.`}
                  initial={helpTask}
                />
              </CardBody>
            </Card>
          ) : null}
        </div>
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
                    <Badge tone={s.enabled ? "success" : "neutral"} pulse={s.enabled}>
                      {s.enabled ? t("common.enabled") : t("common.disabled")}
                    </Badge>
                    <Badge>{t(`plans.kinds.${s.kind}`)}</Badge>
                    {s.briefingMode ? <Badge tone="accent">{t(`intelligence.modes.${s.briefingMode}`)}</Badge> : null}
                  </span>
                  <p className="text-sm">{t("aiPlans.sentence.full", { when: when(s), name: s.aiEmployee.name, role: t(`profiles.${s.aiEmployee.profileKey}.name`), job: s.name })}</p>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Link href={`/${locale}/workforce/${s.aiEmployee.id}`} className="flex items-center gap-1 hover:underline">
                      <AiAvatar id={s.aiEmployee.id} initials={s.aiEmployee.initials} size="sm" paused={s.aiEmployee.status === "PAUSED"} />
                      {s.aiEmployee.name}
                    </Link>
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
