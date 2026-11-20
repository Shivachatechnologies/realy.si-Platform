import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { TaskStatusBadge } from "@/components/agents/status-badge";
import { IssueList } from "@/components/bi/issue-list";
import { formatChange, formatMetric } from "@/components/bi/format";
import { MetricTile } from "@/components/bi/metric-tile";
import { ActionButton } from "@/components/workforce/action-button";
import { AiAvatar } from "@/components/workforce/avatar";
import { BriefingForm } from "@/components/workforce/briefing-form";
import { PageHeader } from "@/components/workforce/page-header";
import { PageState, Pager, qs } from "@/components/workforce/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { criticalIssues, type Issue } from "@/server/modules/bi/issues";
import { resolveRange } from "@/server/modules/bi/range";
import { metricContext, metricValues } from "@/server/modules/bi/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { BRIEFING_MODES, dailyBriefingSchedule, listBriefings } from "@/server/modules/workforce/briefings";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.intelligence.title") };
}

const BOARD = ["QUEUED", "RUNNING", "COMPLETED", "FAILED"] as const;

export default async function IntelligencePage({ searchParams }: PageProps<"/[locale]/intelligence">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = <PageHeader title={t("intelligence.title")} subtitle={t("intelligence.subtitle")} />;
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canRun, canManage, canAnalytics] = await Promise.all([
    can(viewer.ctx, "agents.read", chain),
    can(viewer.ctx, "agents.run", chain),
    can(viewer.ctx, "agents.manage", chain),
    can(viewer.ctx, "analytics.read", chain),
  ]);
  if (!canRead) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const scope = { organizationId: org.id, companyId: company.id };

  const [ceo, history, daily, delegated] = await Promise.all([
    db().aiEmployee.findFirst({ where: { ...scope, profileKey: "ai_ceo", archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, initials: true, status: true } }),
    listBriefings(viewer.ctx, org.id, company.id, { mode: sp.mode, limit: 10, cursor: sp.cursor }),
    dailyBriefingSchedule(org.id, company.id),
    db().agentTask.findMany({
      where: { ...scope, parentTask: { profile: { in: ["ai_ceo", "bi_analyst"] } } },
      orderBy: { id: "desc" },
      take: 60,
      select: { id: true, title: true, status: true, createdAt: true, aiEmployee: { select: { id: true, name: true, initials: true } } },
    }),
  ]);
  let live: { issues: Issue[]; tiles: Awaited<ReturnType<typeof metricValues>>; currency: string } | null = null;
  if (canAnalytics) {
    const mc = await metricContext(viewer.ctx, org.id, company.id);
    const tiles = await metricValues(mc.metrics, mc.scope, resolveRange("7d"));
    live = { issues: await criticalIssues(viewer.ctx, mc.chain, mc.scope, mc.metrics, tiles), tiles, currency: mc.scope.currency };
  }
  const selected = (sp.briefing ? history.data.find((b) => b.id === sp.briefing) : null) ?? history.data[0] ?? null;
  const selectedTask = selected?.task ?? null;
  const active = history.data.some((b) => b.task && (b.task.status === "QUEUED" || b.task.status === "RUNNING")) || delegated.some((d) => d.status === "QUEUED" || d.status === "RUNNING");
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const tz = viewer.user.timezone;
  const configured = aiConfigured();

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <AutoRefresh active={active} intervalMs={5000} />
      {header}
      {!configured ? <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice> : null}
      {!canAnalytics ? <Notice tone="warning">{t("intelligence.needsAnalytics")}</Notice> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={t("intelligence.ceo")}
            description={ceo ? t("intelligence.ceoActive", { name: ceo.name }) : t("intelligence.noCeo")}
            actions={
              ceo ? (
                <Link href={`/${locale}/workforce/${ceo.id}`} className="flex items-center gap-2 text-sm hover:underline">
                  <AiAvatar id={ceo.id} initials={ceo.initials} size="sm" paused={ceo.status === "PAUSED"} />
                  {ceo.name}
                </Link>
              ) : canManage ? (
                <Button asChild size="sm">
                  <Link href={`/${locale}/workforce/hire?profile=ai_ceo`}>{t("intelligence.hireCeo")}</Link>
                </Button>
              ) : null
            }
          />
          <CardBody className="grid gap-4">
            {canRun && configured && canAnalytics ? <BriefingForm apiBase={apiBase} modes={BRIEFING_MODES} /> : null}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t("intelligence.daily.label")}:</span>
              {daily ? (
                <>
                  <Badge tone={daily.enabled ? "success" : "neutral"}>{daily.enabled ? t("intelligence.daily.on", { time: daily.timeOfDay ?? "" }) : t("intelligence.daily.off")}</Badge>
                  {canManage ? (
                    <ActionButton path={`${apiBase}/workforce/schedules/${daily.id}`} method="PATCH" body={{ enabled: !daily.enabled }} variant="ghost">
                      {daily.enabled ? t("plans.disable") : t("plans.enable")}
                    </ActionButton>
                  ) : null}
                  <Link className="text-xs text-primary hover:underline" href={`/${locale}/plans`}>
                    {t("intelligence.daily.change")}
                  </Link>
                </>
              ) : ceo && canManage ? (
                <ActionButton
                  path={`${apiBase}/workforce/schedules`}
                  body={{ aiEmployeeId: ceo.id, name: t("intelligence.modes.DAILY"), kind: "RECURRING", frequency: "DAILY", timeOfDay: "08:00", instructions: "Focus on what changed since yesterday and what needs a decision today.", briefingMode: "DAILY" }}
                >
                  {t("intelligence.daily.enable")}
                </ActionButton>
              ) : (
                <span className="text-xs text-muted-foreground">{t("intelligence.daily.needsCeo")}</span>
              )}
            </div>

            {selected ? (
              <article className="grid gap-2 rounded-md border p-3" aria-labelledby="briefing-title">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="briefing-title" className="text-sm font-semibold">
                    {t(`intelligence.modes.${selected.mode}`)} · {formatDate(selected.createdAt, locale, tz)}
                  </h2>
                  {selectedTask ? (
                    <span className="flex items-center gap-2">
                      <TaskStatusBadge status={selectedTask.status} label={t(`agentTasks.status.${selectedTask.status}`)} />
                      <Link className="text-xs text-primary hover:underline" href={`/${locale}/tasks/${selectedTask.id}`}>
                        {t("intelligence.openTask")}
                      </Link>
                    </span>
                  ) : null}
                </div>
                {selectedTask?.output ? (
                  <>
                    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{selectedTask.output}</div>
                    <p className="text-xs text-muted-foreground">{t("agentTasks.reviewNote")}</p>
                  </>
                ) : selectedTask?.status === "FAILED" ? (
                  <Notice tone="danger">{t("agentTasks.failed", { message: selectedTask.errorMessage ?? "" })}</Notice>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("intelligence.writing")}</p>
                )}
                {(selected.issues as unknown as Issue[]).length ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-xs text-muted-foreground">{t("intelligence.issuesAtTime")}</summary>
                    <div className="pt-2">
                      <IssueList issues={selected.issues as unknown as Issue[]} t={t} locale={locale} emptyLabel="" />
                    </div>
                  </details>
                ) : null}
              </article>
            ) : (
              <p className="text-sm text-muted-foreground">{t("intelligence.noBriefings")}</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("intelligence.criticalIssues")} description={t("intelligence.criticalIssuesHint")} />
          <CardBody>{live ? <IssueList issues={live.issues} t={t} locale={locale} emptyLabel={t("intelligence.noIssues")} /> : <p className="text-sm text-muted-foreground">{t("intelligence.needsAnalytics")}</p>}</CardBody>
        </Card>
      </div>

      {live && live.tiles.length ? (
        <section className="grid gap-2" aria-labelledby="kpi-week">
          <h2 id="kpi-week" className="text-sm font-semibold text-muted-foreground">
            {t("intelligence.kpis")}
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            {live.tiles.slice(0, 12).map((m) => (
              <MetricTile
                key={m.key}
                label={t(m.labelKey)}
                value={formatMetric(m.value, m.unit, locale, live!.currency, { compact: true })}
                change={formatChange(m.changePct, locale)}
                trend={m.trend}
                href={m.href ? `/${locale}${m.href}` : null}
              />
            ))}
          </div>
        </section>
      ) : null}

      <Card>
        <CardHeader title={t("intelligence.board")} description={t("intelligence.boardHint")} />
        {delegated.length === 0 ? (
          <CardBody className="text-sm text-muted-foreground">{t("intelligence.boardEmpty")}</CardBody>
        ) : (
          <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-4">
            {BOARD.map((status) => {
              const col = delegated.filter((d) => d.status === status);
              return (
                <section key={status} className="grid content-start gap-2 rounded-md bg-surface-2 p-2" aria-label={t(`agentTasks.status.${status}`)}>
                  <h3 className="flex items-center justify-between px-1 text-xs font-medium text-muted-foreground">
                    {t(`agentTasks.status.${status}`)}
                    <span className="tabular">{col.length}</span>
                  </h3>
                  {col.map((d) => (
                    <Link key={d.id} href={`/${locale}/tasks/${d.id}`} className="grid gap-1 rounded-md border bg-surface p-2 text-sm hover:bg-muted/50">
                      <span className="font-medium">{d.title}</span>
                      {d.aiEmployee ? (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <AiAvatar id={d.aiEmployee.id} initials={d.aiEmployee.initials} size="sm" />
                          {d.aiEmployee.name}
                        </span>
                      ) : null}
                    </Link>
                  ))}
                </section>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title={t("intelligence.history")}
          actions={
            <nav className="flex flex-wrap gap-1 text-xs" aria-label={t("intelligence.mode")}>
              {[undefined, ...BRIEFING_MODES].map((m) => (
                <Link key={m ?? "all"} href={`/${locale}/intelligence${qs({ mode: m })}`} aria-current={sp.mode === m ? "page" : undefined} className={sp.mode === m ? "rounded-sm bg-muted px-2 py-1 font-medium" : "rounded-sm px-2 py-1 text-muted-foreground hover:bg-muted"}>
                  {m ? t(`intelligence.modes.${m}`) : t("common.all")}
                </Link>
              ))}
            </nav>
          }
        />
        {history.data.length === 0 ? (
          <CardBody className="text-sm text-muted-foreground">{t("intelligence.noBriefings")}</CardBody>
        ) : (
          <ul className="divide-y">
            {history.data.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <Link href={`/${locale}/intelligence${qs({ mode: sp.mode, cursor: sp.cursor, briefing: b.id })}`} className="min-w-0 hover:underline" aria-current={selected?.id === b.id ? "true" : undefined}>
                  <span className={selected?.id === b.id ? "font-semibold" : undefined}>{t(`intelligence.modes.${b.mode}`)}</span>
                  <span className="ms-2 text-xs text-muted-foreground">{formatDateTime(b.createdAt, locale, tz)}</span>
                </Link>
                <span className="flex items-center gap-2">
                  {b.scheduled ? <Badge>{t("intelligence.scheduled")}</Badge> : null}
                  <Badge>{t(`profiles.${b.profile}.name`)}</Badge>
                  {b.task ? <TaskStatusBadge status={b.task.status} label={t(`agentTasks.status.${b.task.status}`)} /> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Pager
          prevHref={sp.cursor ? `/${locale}/intelligence${qs({ mode: sp.mode })}` : null}
          nextHref={history.nextCursor ? `/${locale}/intelligence${qs({ mode: sp.mode, cursor: history.nextCursor })}` : null}
          labels={{ previous: t("agentTasks.firstPage"), next: t("common.next") }}
        />
      </Card>
    </div>
  );
}
