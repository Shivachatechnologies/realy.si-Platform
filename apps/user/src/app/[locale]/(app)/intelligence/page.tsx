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
import { AskCeoForm } from "@/components/workforce/ask-ceo-form";
import { BriefingCard } from "@/components/workforce/briefing-card";
import { CeoActions, type CeoActionsData } from "@/components/workforce/ceo-actions";
import { IntelligenceTabs } from "@/components/workforce/intelligence-tabs";
import { CompanyNetwork } from "@/components/workforce/company-network";
import { HeaderStrip } from "@/components/workforce/header-strip";
import { Aurora, LiveDot, SystemPulse, TypingText, AnimatedProgress } from "@/components/motion";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
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
import { businessHealth } from "@/server/modules/bi/health";
import { DoThisButton } from "@/components/bi/do-this-button";
import { insightCommand, insightText } from "@/components/bi/insight-text";
import { resolveRange } from "@/server/modules/bi/range";
import { metricContext, metricValues } from "@/server/modules/bi/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { BRIEFING_MODES, dailyBriefingSchedule, listBriefings } from "@/server/modules/workforce/briefings";
import type { BriefingSections } from "@/server/modules/workforce/briefing-card";
import { SUGGESTED_QUESTIONS, listConversations } from "@/server/modules/workforce/ceo-chat";
import { listEmployees, listMembers } from "@/server/modules/workforce/service";
import { companyNetwork } from "@/server/modules/workforce/network";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.intelligence.title") };
}

const BOARD = ["QUEUED", "RUNNING", "COMPLETED", "FAILED"] as const;

export default async function IntelligencePage({ searchParams }: PageProps<"/[locale]/intelligence">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <>
      <PageHeader title={t("intelligence.title")} subtitle={t("intelligence.subtitle")} />
      <IntelligenceTabs locale={locale} active="overview" labels={{ overview: t("intelligence.tabs.overview"), ceo: t("intelligence.tabs.ceo"), growth: t("intelligence.tabs.growth") }} />
    </>
  );
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canRun, canManage, canAnalytics, canProjects, canApprovalsRead, canDecide] = await Promise.all([
    can(viewer.ctx, "agents.read", chain),
    can(viewer.ctx, "agents.run", chain),
    can(viewer.ctx, "agents.manage", chain),
    can(viewer.ctx, "analytics.read", chain),
    can(viewer.ctx, "projects.manage", chain),
    can(viewer.ctx, "approvals.read", chain),
    can(viewer.ctx, "approvals.decide", chain),
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
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const canObjectives = await can(viewer.ctx, "objectives.read", chain);
  const [activity, objectives, recommendations, network] = await Promise.all([
    db().agentTask.findMany({
      where: { ...scope, status: { in: ["RUNNING", "QUEUED"] } },
      orderBy: [{ status: "desc" }, { createdAt: "asc" }],
      take: 8,
      select: { id: true, title: true, status: true, startedAt: true, profile: true, aiEmployee: { select: { id: true, name: true, initials: true } } },
    }),
    canObjectives ? db().objective.findMany({ where: { ...scope, status: "ACTIVE" }, orderBy: { targetDate: "asc" }, take: 4, select: { id: true, title: true, milestones: { select: { completedAt: true } } } }) : Promise.resolve(null),
    canAnalytics ? db().growthInsight.findMany({ where: { ...scope, status: "OPEN" }, orderBy: [{ severity: "desc" }, { createdAt: "desc" }], take: 4, select: { id: true, signal: true, severity: true, taskId: true } }) : Promise.resolve(null),
    companyNetwork(viewer.ctx, chain, org.id, company.id),
  ]);
  const runningCount = activity.filter((a) => a.status === "RUNNING").length;
  const [threads, team, members, workTasks, aiTasks, approvals] = await Promise.all([
    listConversations(viewer.ctx, org.id, company.id, { limit: 5 }),
    listEmployees(viewer.ctx, org.id, company.id),
    listMembers(viewer.ctx, org.id, company.id),
    canProjects
      ? db().workTask.findMany({
          where: { ...scope, archivedAt: null, status: { notIn: ["DONE", "CANCELLED"] } },
          orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
          take: 15,
          select: { id: true, title: true, priority: true, assigneeId: true, dueDate: true },
        })
      : Promise.resolve([]),
    db().agentTask.findMany({ where: { ...scope, status: { in: ["QUEUED", "FAILED"] } }, orderBy: { id: "desc" }, take: 10, select: { id: true, title: true, status: true, aiEmployeeId: true } }),
    canApprovalsRead ? db().approval.findMany({ where: { ...scope, status: "PENDING", expiresAt: { gt: now } }, orderBy: { expiresAt: "asc" }, take: 10, select: { id: true, summary: true, risk: true } }) : Promise.resolve([]),
  ]);
  const actionsData: CeoActionsData = {
    employees: team.map((e) => ({ id: e.id, name: e.name, status: e.status, autonomy: e.autonomy, monthlyTokenBudget: e.monthlyTokenBudget })),
    members,
    workTasks: workTasks.map((w) => ({ id: w.id, title: w.title, priority: w.priority, assigneeId: w.assigneeId, dueDate: w.dueDate ? w.dueDate.toISOString().slice(0, 10) : null, overdue: !!w.dueDate && w.dueDate < today })),
    aiTasks,
    approvals,
    can: { run: canRun, manageAgents: canManage, projects: canProjects, decide: canDecide },
  };
  const selected = (sp.briefing ? history.data.find((b) => b.id === sp.briefing) : null) ?? history.data[0] ?? null;
  const selectedTask = selected?.task ?? null;
  const active = history.data.some((b) => b.task && (b.task.status === "QUEUED" || b.task.status === "RUNNING")) || delegated.some((d) => d.status === "QUEUED" || d.status === "RUNNING");
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const tz = viewer.user.timezone;
  const configured = aiConfigured();
  const health = canAnalytics ? await businessHealth(viewer.ctx, org.id, company.id).catch(() => null) : null;
  const topInsight = health?.insights[0] ?? null;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <AutoRefresh active={active} intervalMs={5000} />
      {header}
      {!configured ? <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice> : null}
      {!canAnalytics ? <Notice tone="warning">{t("intelligence.needsAnalytics")}</Notice> : null}
      <HeaderStrip
        t={t}
        what={t("intelligence.strip.what")}
        why={t("intelligence.strip.why")}
        can={t("intelligence.strip.can")}
        next={ceo ? t("intelligence.strip.nextAsk") : t("intelligence.strip.nextHire")}
        action={
          ceo ? (
            <Button asChild size="sm">
              <Link href={`/${locale}/intelligence/ceo`}>{t("intelligence.chat.title")}</Link>
            </Button>
          ) : canManage ? (
            <Button asChild size="sm">
              <Link href={`/${locale}/workforce/hire?profile=ai_ceo`}>{t("intelligence.hireCeo")}</Link>
            </Button>
          ) : null
        }
      />

      {health ? (
        <section className="grid gap-4 rounded-2xl border bg-surface/70 p-4 backdrop-blur sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center" aria-labelledby="intel-health">
          <Link href={`/${locale}/analytics/health`} className="flex items-end gap-3">
            <span className={`numeral font-display text-5xl leading-none ${health.score === null ? "text-muted-foreground" : health.score >= 65 ? "text-success" : health.score >= 45 ? "text-warning" : "text-danger"}`}>{health.score ?? "—"}</span>
            <span className="pb-1 text-xs text-muted-foreground">{t("analytics.health.outOf")}</span>
          </Link>
          <div className="grid gap-1">
            <h2 id="intel-health" className="text-sm font-semibold">
              {t("command.ops.healthTitle")} · {t(`analytics.health.verdict.${health.score === null ? "unknown" : health.score >= 65 ? "strong" : health.score >= 45 ? "steady" : "weak"}`)}
            </h2>
            <p className="text-sm text-muted-foreground">{topInsight ? insightText(t, topInsight) : t("analytics.health.noInsights")}</p>
            <Link href={`/${locale}/analytics/health`} className="text-xs text-primary hover:underline">
              {t("command.ops.openHealth")}
            </Link>
          </div>
          {topInsight ? <DoThisButton base={apiBase} command={insightCommand(t, topInsight)} disabledReason={!configured ? t("guide.ai.notConfigured") : !canRun ? t("guide.ai.forbidden") : null} /> : null}
        </section>
      ) : null}

      <section className="relative isolate overflow-hidden rounded-xl border" aria-labelledby="command-center">
        <Aurora className="absolute inset-0 -z-10" />
        <div className="grid gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="command-center" className="text-base font-semibold tracking-tight">
              {t("intelligence.center.title")}
            </h2>
            <SystemPulse active={runningCount > 0} label={t("intelligence.center.pulse", { count: runningCount })} detail={activity.length - runningCount ? t("workforce.live.queued", { count: activity.length - runningCount }) : undefined} />
          </div>
          {live ? (
            <StatGrid>
              {(["finance.revenue", "finance.cash_balance", "crm.open_pipeline", "crm.new_leads"] as const).map((k, i) => {
                const m = live!.tiles.find((x) => x.key === k);
                if (!m) return null;
                return (
                  <StatTile
                    key={k}
                    index={i}
                    label={t(m.labelKey)}
                    {...(m.unit === "money" ? { money: { amountMinor: Math.round(m.value ?? 0), currency: live!.currency } } : { value: m.value ?? undefined })}
                    delta={m.changePct === null ? null : m.changePct / 100}
                    deltaLabel={t("intelligence.center.vsPrev")}
                    positive={m.higherIsBetter === false ? "down" : "up"}
                    href={m.href ? `/${locale}${m.href}` : undefined}
                  />
                );
              })}
              <StatTile index={4} label={t("intelligence.center.aiWorking")} value={runningCount} live={runningCount > 0} href={`/${locale}/tasks?status=RUNNING`} highlight={runningCount > 0} />
            </StatGrid>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Card variant="glass">
              <CardHeader title={t("intelligence.network.title")} description={t("intelligence.network.hint")} />
              <CardBody className="grid place-items-center">
                {network.departments.length ? <CompanyNetwork data={network} t={t} locale={locale} companyName={company.name} /> : <p className="text-sm text-muted-foreground">{t("intelligence.network.empty")}</p>}
              </CardBody>
            </Card>
            <div className="grid content-start gap-4">
              <Card variant="glass">
                <CardHeader title={t("intelligence.center.activity")} description={t("intelligence.center.activityHint")} />
                {activity.length === 0 ? (
                  <CardBody className="text-sm text-muted-foreground">{t("intelligence.center.idle")}</CardBody>
                ) : (
                  <ul className="divide-y text-sm">
                    {activity.map((a) => (
                      <li key={a.id}>
                        <Link href={`/${locale}/tasks/${a.id}`} className="flex items-center gap-2 px-4 py-2 hover:bg-muted/40">
                          {a.aiEmployee ? <AiAvatar id={a.aiEmployee.id} initials={a.aiEmployee.initials} size="sm" working={a.status === "RUNNING"} /> : <LiveDot tone="neutral" pulse={false} />}
                          <span className="grid min-w-0 flex-1">
                            <span className="truncate text-xs text-muted-foreground">{a.aiEmployee?.name ?? t(`profiles.${a.profile}.name`)}</span>
                            {a.status === "RUNNING" ? <TypingText text={a.title} className="truncate" /> : <span className="truncate">{a.title}</span>}
                          </span>
                          <LiveDot tone={a.status === "RUNNING" ? "primary" : "warning"} pulse={a.status === "RUNNING"} label={t(`agentTasks.status.${a.status}`)} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              {recommendations ? (
                <Card variant="glass">
                  <CardHeader
                    title={t("intelligence.center.recommendations")}
                    actions={
                      <Link className="text-xs text-primary hover:underline" href={`/${locale}/intelligence/growth`}>
                        {t("intelligence.tabs.growth")}
                      </Link>
                    }
                  />
                  <CardBody className="text-sm">
                    {recommendations.length === 0 ? (
                      <p className="text-muted-foreground">{t("growth.open.empty")}</p>
                    ) : (
                      <ul className="grid gap-1.5">
                        {recommendations.map((r) => (
                          <li key={r.id} className="flex items-center gap-2">
                            <LiveDot tone={r.severity === "CRITICAL" ? "danger" : r.severity === "WARNING" ? "warning" : "info"} pulse={r.severity === "CRITICAL"} />
                            <Link className="min-w-0 flex-1 truncate hover:underline" href={r.taskId ? `/${locale}/tasks/${r.taskId}` : `/${locale}/intelligence/growth`}>
                              {t(`growth.signals.${r.signal}.title`)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>
              ) : null}
              {objectives ? (
                <Card variant="glass">
                  <CardHeader
                    title={t("intelligence.center.goals")}
                    actions={
                      <Link className="text-xs text-primary hover:underline" href={`/${locale}/objectives/goals`}>
                        {t("analytics.ceo.openGoals")}
                      </Link>
                    }
                  />
                  <CardBody className="grid gap-2 text-sm">
                    {objectives.length === 0 ? (
                      <p className="text-muted-foreground">{t("analytics.ceo.noObjectives")}</p>
                    ) : (
                      objectives.map((o) => {
                        const done = o.milestones.filter((m) => m.completedAt).length;
                        return (
                          <div key={o.id} className="grid gap-1">
                            <span className="flex justify-between gap-2">
                              <span className="truncate">{o.title}</span>
                              <span className="text-xs text-muted-foreground">{t("analytics.ceo.milestones", { done, total: o.milestones.length })}</span>
                            </span>
                            <AnimatedProgress value={o.milestones.length ? (done / o.milestones.length) * 100 : 0} label={o.title} />
                          </div>
                        );
                      })
                    )}
                  </CardBody>
                </Card>
              ) : null}
            </div>
          </div>
        </div>
      </section>

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
                {selected.sections && (selected.sections as unknown as BriefingSections).generatedAt ? <BriefingCard s={selected.sections as unknown as BriefingSections} t={t} locale={locale} /> : null}
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

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader
            title={t("intelligence.chat.title")}
            description={t("intelligence.chat.subtitle")}
            actions={
              <Link className="text-xs text-primary hover:underline" href={`/${locale}/intelligence/ceo`}>
                {t("intelligence.chat.allThreads")}
              </Link>
            }
          />
          <CardBody className="grid gap-3">
            {canRun && configured ? <AskCeoForm apiBase={apiBase} suggestions={SUGGESTED_QUESTIONS.map((k) => t(`intelligence.chat.suggestions.${k}`))} compact /> : <p className="text-sm text-muted-foreground">{configured ? t("errors.forbidden") : t("agentTasks.notConfigured")}</p>}
            {threads.data.length ? (
              <ul className="grid gap-1 text-sm">
                {threads.data.map((c) => (
                  <li key={c.id}>
                    <Link className="hover:underline" href={`/${locale}/intelligence/ceo?c=${c.id}`}>
                      {c.title}
                    </Link>
                    <span className="ms-2 text-xs text-muted-foreground">{formatDateTime(c.updatedAt, locale, tz)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={t("intelligence.actions.title")} description={t("intelligence.actions.hint")} />
          <CardBody>
            <CeoActions apiBase={apiBase} data={actionsData} />
          </CardBody>
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
