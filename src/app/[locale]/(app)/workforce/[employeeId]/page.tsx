import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pause, Pin, PinOff, Play, Trash2 } from "lucide-react";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { TaskStatusBadge } from "@/components/agents/status-badge";
import { ActionButton } from "@/components/workforce/action-button";
import { AssignTaskForm } from "@/components/workforce/assign-task-form";
import { AiAvatar } from "@/components/workforce/avatar";
import { AiAvatar as RoleAvatar } from "@/components/graphics/ai-avatar";
import { EditEmployeeDialog } from "@/components/workforce/hire-dialog";
import { MemoryForm } from "@/components/workforce/memory-form";
import { ProfileDialog } from "@/components/workforce/profile-dialog";
import { Sparkline } from "@/components/bi/charts";
import { SystemPulse } from "@/components/motion";
import { formatMetric } from "@/components/bi/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatRelativeTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { profileByKey } from "@/server/modules/agents/profiles";
import { aiConfigured, type ToolCallRecord } from "@/server/modules/agents/runtime";
import { listTasks } from "@/server/modules/agents/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { getTool, loadTools } from "@/server/modules/tools/registry";
import { toolsForAutonomy } from "@/server/modules/workforce/autonomy";
import { costMicros, microsToCents } from "@/server/modules/workforce/pricing";
import { listSchedules } from "@/server/modules/workforce/schedules";
import { directReports, employeeStats, getEmployee, kpisOf, listMembers, listMemories, listReports, performanceHistory, setupSteps } from "@/server/modules/workforce/service";
import { profileOptions, profileValues } from "@/server/modules/workforce/profile-options";
import { resolveRange } from "@/server/modules/bi/range";
import { metricValues, pickMetrics, visibleMetrics } from "@/server/modules/bi/service";
import { employeeMonthUsage } from "@/server/modules/workforce/usage";
import { AUTONOMY_MODE, delegationMode } from "@/server/modules/workforce/autonomy";
import { budgetRefusal, employeeBudget } from "@/server/modules/workforce/budgets";
import { workforcePerformance } from "@/server/modules/workforce/performance";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.workforce.title") };
}

export default async function EmployeePage({ params }: PageProps<"/[locale]/workforce/[employeeId]">) {
  await loadTools();
  const { employeeId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  if (!company) notFound();
  const e = await getEmployee(viewer.ctx, org.id, company.id, employeeId).catch((err) => {
    if (isAppError(err) && (err.code === "not_found" || err.code === "forbidden")) notFound();
    throw err;
  });
  const chain = await companyChain(db(), org.id, company.id);
  const [canManage, canRun, canAnalytics] = await Promise.all([can(viewer.ctx, "agents.manage", chain), can(viewer.ctx, "agents.run", chain), can(viewer.ctx, "analytics.read", chain)]);
  const [stats, usage, queued, running, done, memories, schedules, members] = await Promise.all([
    employeeStats(org.id, company.id, [e.id]).then((m) => m.get(e.id)!),
    employeeMonthUsage(org.id, company.id, e),
    listTasks(viewer.ctx, org.id, company.id, { aiEmployeeId: e.id, status: "QUEUED", limit: 20 }),
    listTasks(viewer.ctx, org.id, company.id, { aiEmployeeId: e.id, status: "RUNNING", limit: 20 }),
    listTasks(viewer.ctx, org.id, company.id, { aiEmployeeId: e.id, limit: 30 }),
    listMemories(viewer.ctx, org.id, company.id, e.id),
    listSchedules(viewer.ctx, org.id, company.id, { aiEmployeeId: e.id }),
    canManage ? listMembers(viewer.ctx, org.id, company.id) : Promise.resolve([]),
  ]);
  const kpis = kpisOf(e.kpis);
  const [budget, perf30, delegations] = await Promise.all([
    employeeBudget(org.id, company.id, e),
    workforcePerformance(org.id, company.id, [e], 30).then((p) => p.byEmployee.get(e.id)!),
    db().aiDelegation.findMany({
      where: { organizationId: org.id, companyId: company.id, OR: [{ fromEmployeeId: e.id }, { toEmployeeId: e.id }] },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { fromEmployee: { select: { id: true, name: true } }, toEmployee: { select: { id: true, name: true } } },
    }),
  ]);
  const overBudget = budgetRefusal(e.name, budget);
  const [history, reports, reportsTo, profileOpts, managerUser, kpiValues] = await Promise.all([
    performanceHistory(org.id, company.id, e.id, 12),
    directReports(org.id, company.id, e.id),
    listReports(viewer.ctx, org.id, company.id, { authorId: e.id, managerId: e.id, take: 30 }),
    canManage ? profileOptions(viewer.ctx, org.id, company.id, e, t) : Promise.resolve(null),
    !e.managerEmployeeId && e.managerUserId ? db().user.findUnique({ where: { id: e.managerUserId }, select: { name: true } }) : Promise.resolve(null),
    canAnalytics && kpis.length
      ? visibleMetrics(viewer.ctx, chain).then(async (all) => {
          const c = await db().company.findUnique({ where: { id: company.id }, select: { baseCurrency: true } });
          const scope = { organizationId: org.id, companyId: company.id, currency: c?.baseCurrency ?? "USD" };
          return { currency: scope.currency, values: await metricValues(pickMetrics(all, kpis.map((k) => k.key)), scope, resolveRange("30d")) };
        })
      : Promise.resolve(null),
  ]);
  const steps = setupSteps(e);
  const received = reportsTo.filter((r) => r.manager?.id === e.id);
  const written = reportsTo.filter((r) => r.aiEmployee.id === e.id);
  const logs = await db().agentTask.findMany({
    where: { organizationId: org.id, companyId: company.id, aiEmployeeId: e.id, status: { in: ["COMPLETED", "FAILED"] } },
    orderBy: { id: "desc" },
    take: 15,
    select: { id: true, title: true, status: true, toolCalls: true, model: true, inputTokens: true, outputTokens: true, startedAt: true, completedAt: true, errorCode: true },
  });
  // Skills in use: tool calls across the recent finished tasks (real usage, not configuration).
  const toolUsage = new Map<string, number>();
  for (const l of logs) for (const c of (l.toolCalls as unknown as ToolCallRecord[]) ?? []) toolUsage.set(c.tool, (toolUsage.get(c.tool) ?? 0) + 1);
  const usageRows = [...toolUsage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const usageMax = Math.max(1, ...usageRows.map((r) => r[1]));
  const profile = profileByKey(e.profileKey);
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const tz = viewer.user.timezone;
  const usd = (micros: number) => formatMoney({ amountMinor: microsToCents(micros), currency: "USD" }, locale);
  const toolLabel = (name: string) => {
    const label = t(`workforce.toolNames.${name}`);
    return label === `workforce.toolNames.${name}` ? name.replace(/_/g, " ") : label;
  };
  const allowed = profile ? (e.allowedTools.length ? profile.tools.filter((x) => e.allowedTools.includes(x)) : [...profile.tools]) : [];
  const effective = new Set(toolsForAutonomy(allowed, e.autonomy));
  const toolOptions = (profile?.tools ?? []).flatMap((name) => {
    const d = getTool(name);
    return d ? [{ name, label: toolLabel(name), needsApproval: d.autonomy !== "AUTONOMOUS" }] : [];
  });
  const seconds = (ms: number | null) => (ms === null ? "—" : formatNumber(ms / 1000, locale, { style: "unit", unit: "second", unitDisplay: "short", maximumFractionDigits: 0 }));
  const finished = stats.completed + stats.failed;
  const pausedOrOver = e.status === "PAUSED" || !!overBudget;
  const done10 = done.data.filter((x) => x.status !== "QUEUED" && x.status !== "RUNNING").slice(0, 10);

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <AutoRefresh active={queued.data.length + running.data.length > 0} intervalMs={5000} />
      <Link href={`/${locale}/workforce`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
        {t("workforce.employee.back")}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <RoleAvatar seed={e.id} department={e.department} size={64} active={running.data.length > 0} className={e.status === "PAUSED" ? "opacity-60 grayscale" : undefined} />
          <div className="grid min-w-0 gap-0.5">
            <h1 className="flex flex-wrap items-center gap-2 font-display text-3xl">
              {e.name}
              <Badge tone={e.status === "ACTIVE" ? "success" : "neutral"}>{t(`workforce.status.${e.status}`)}</Badge>
              {running.data.length ? <SystemPulse active label={t("workforce.live.workingNow")} /> : null}
            </h1>
            <p className="text-sm text-muted-foreground">
              {e.jobTitle ? `${e.jobTitle} · ` : ""}
              {t(`profiles.${e.profileKey}.name`)} · {t(`workforce.departments.${e.department}`)} · {t(`workforce.levels.${e.level}.name`)}
            </p>
            <p className="text-xs italic text-muted-foreground">{t(`workforce.personality.${e.department}`)}</p>
            <p className="text-xs text-muted-foreground">
              {t("workforce.profile.reportsTo")}:{" "}
              {e.manager ? (
                <Link className="text-primary hover:underline" href={`/${locale}/workforce/${e.manager.id}`}>
                  {e.manager.name}
                </Link>
              ) : (
                (managerUser?.name ?? t("workforce.org.founder"))
              )}
            </p>
          </div>
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-start gap-2">
            {profileOpts ? <ProfileDialog apiBase={apiBase} employeeId={e.id} initial={profileValues(e)} options={profileOpts} /> : null}
            <EditEmployeeDialog
              apiBase={apiBase}
              profileKey={e.profileKey}
              employeeId={e.id}
              tools={toolOptions}
              members={members}
              initial={{ name: e.name, initials: e.initials, instructions: e.instructions ?? "", skills: e.skills, allowedTools: e.allowedTools, runsAsUserId: e.runsAsUserId, autonomy: e.autonomy, monthlyTokenBudget: e.monthlyTokenBudget }}
            />
            <ActionButton path={`${apiBase}/workforce/employees/${e.id}/status`} body={{ status: e.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }}>
              {e.status === "ACTIVE" ? <Pause aria-hidden /> : <Play aria-hidden />}
              {e.status === "ACTIVE" ? t("workforce.employee.pause") : t("workforce.employee.resume")}
            </ActionButton>
            <ActionButton path={`${apiBase}/workforce/employees/${e.id}`} method="DELETE" variant="ghost" confirm={t("workforce.employee.confirmRemove", { name: e.name })} redirectTo="/workforce">
              <Trash2 aria-hidden />
              {t("workforce.employee.remove")}
            </ActionButton>
          </div>
        ) : null}
      </div>

      {!e.setupCompletedAt ? (
        <Notice
          tone="info"
          title={t("workforce.setup.pendingTitle")}
          action={
            canManage ? (
              <Link className="text-sm text-primary hover:underline" href={`/${locale}/workforce/${e.id}/setup`}>
                {t("workforce.setup.continue")}
              </Link>
            ) : null
          }
        >
          {t("workforce.setup.pending", { done: steps.filter((s) => s.done).length, total: steps.length })}
        </Notice>
      ) : null}
      {e.status === "PAUSED" ? <Notice tone="warning">{t("workforce.employee.pausedNotice")}</Notice> : null}
      {overBudget ? (
        <Notice tone="warning" action={<Link className="text-sm text-primary hover:underline" href={`/${locale}/workforce/performance`}>{t("workforce.tabs.performance")}</Link>}>
          {overBudget.code === "department_over_budget" ? t("workforce.budgets.departmentExhaustedNotice", { department: t(`workforce.departments.${e.department}`) }) : t("workforce.employee.overBudgetNotice")}
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t("workforce.employee.performance")} />
          <CardBody>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">{t("workforce.stats.completed")}</dt>
                <dd className="tabular text-lg font-semibold">{formatNumber(stats.completed, locale)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("workforce.stats.failed")}</dt>
                <dd className="tabular text-lg font-semibold">{formatNumber(stats.failed, locale)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("workforce.stats.successRate")}</dt>
                <dd className="tabular text-lg font-semibold">{finished ? formatNumber(stats.completed / finished, locale, { style: "percent" }) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("workforce.stats.avgDuration")}</dt>
                <dd className="tabular text-lg font-semibold">{seconds(stats.avgDurationMs)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("workforce.stats.approvalsRequested")}</dt>
                <dd className="tabular text-lg font-semibold">{formatNumber(stats.approvalsRequested, locale)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("workforce.stats.approvalsApproved")}</dt>
                <dd className="tabular text-lg font-semibold">{formatNumber(stats.approvalsApproved, locale)}</dd>
              </div>
            </dl>
            <dl className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">{t("workforce.performance.turnaround")} (30d)</dt>
                <dd className="tabular font-semibold">{perf30.medianTurnaroundMs === null ? "—" : formatNumber(Math.max(1, Math.round(perf30.medianTurnaroundMs / 60_000)), locale, { style: "unit", unit: "minute", unitDisplay: "short" })}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("workforce.performance.costPerTask")} (30d)</dt>
                <dd className="tabular font-semibold">{perf30.costPerCompletedMicros === null ? "—" : usd(perf30.costPerCompletedMicros)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("workforce.performance.delegated")} (30d)</dt>
                <dd className="tabular font-semibold">{formatNumber(perf30.delegated, locale)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("workforce.performance.escalations")} (30d)</dt>
                <dd className="tabular font-semibold">
                  {formatNumber(perf30.escalationsFiled, locale)}
                  {perf30.escalationsOpen ? <span className="ms-1 text-xs font-normal text-warning">{t("workforce.performance.openNow", { count: perf30.escalationsOpen })}</span> : null}
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("workforce.employee.usage")} description={t("workforce.employee.usageHint")} />
          <CardBody className="grid gap-2 text-sm">
            <p>
              <span className="tabular text-lg font-semibold">{formatNumber(usage.used, locale)}</span> <span className="text-muted-foreground">{t("workforce.employee.tokensThisMonth")}</span>
            </p>
            <p className="text-muted-foreground">{t("workforce.employee.estimatedCost", { cost: usd(stats.monthCostMicros) })}</p>
            <p className="text-muted-foreground">
              {usage.budget ? t("workforce.employee.budget", { budget: formatNumber(usage.budget, locale) }) : t("workforce.employee.noBudget")}
            </p>
            {budget.employee.costBudgetCents !== null ? (
              <p className="text-muted-foreground">
                {t("workforce.budgets.costOf", { used: formatMoney({ amountMinor: BigInt(budget.employee.costCentsUsed), currency: "USD" }, locale), budget: formatMoney({ amountMinor: BigInt(budget.employee.costBudgetCents), currency: "USD" }, locale) })}
              </p>
            ) : null}
            {budget.department ? (
              <p className="text-muted-foreground">
                {t("workforce.budgets.departmentLine", { department: t(`workforce.departments.${e.department}`) })}:{" "}
                {[
                  budget.department.costBudgetCents !== null ? t("workforce.budgets.costOf", { used: formatMoney({ amountMinor: BigInt(budget.department.costCentsUsed), currency: "USD" }, locale), budget: formatMoney({ amountMinor: BigInt(budget.department.costBudgetCents), currency: "USD" }, locale) }) : null,
                  budget.department.tokenBudget !== null ? t("workforce.budgets.tokensOf", { used: formatNumber(budget.department.tokensUsed, locale, { notation: "compact" }), budget: formatNumber(budget.department.tokenBudget, locale, { notation: "compact" }) }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            {budget.remainingTokens !== null ? <p className="text-xs text-muted-foreground">{t("workforce.budgets.runCap", { tokens: formatNumber(budget.remainingTokens, locale, { notation: "compact" }) })}</p> : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("workforce.employee.configuration")} />
          <CardBody className="grid gap-2 text-sm">
            <p>
              <span className="text-muted-foreground">{t("workforce.form.autonomy")}: </span>
              {t(`workforce.autonomy.${e.autonomy}.name`)} · {t(`workforce.autonomyModes.${AUTONOMY_MODE[e.autonomy]}`)}
            </p>
            <p className="text-xs text-muted-foreground">
              {AUTONOMY_MODE[e.autonomy] === "suggest" ? t("workforce.delegations.modeNone") : delegationMode(e.autonomy) === "propose" ? t("workforce.delegations.modePropose") : t("workforce.delegations.modeDirect")}
            </p>
            <p>
              <span className="text-muted-foreground">{t("workforce.form.runsAs")}: </span>
              {e.runsAs?.name ?? t("workforce.form.runsAsRequester")}
            </p>
            {e.skills.length ? (
              <div className="flex flex-wrap gap-1">
                {e.skills.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
              </div>
            ) : null}
            {e.instructions ? <p className="whitespace-pre-wrap break-words text-muted-foreground">{e.instructions}</p> : null}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("workforce.profile.title")} />
          <CardBody className="grid gap-3 text-sm">
            {e.jobDescription ? <p className="whitespace-pre-wrap break-words">{e.jobDescription}</p> : <p className="text-muted-foreground">{t("workforce.profile.noDescription")}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid content-start gap-1">
                <h3 className="text-xs font-medium text-muted-foreground">{t("workforce.profile.responsibilities")}</h3>
                {e.responsibilities.length ? (
                  <ul className="list-disc ps-5">
                    {e.responsibilities.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">—</p>
                )}
              </div>
              <div className="grid content-start gap-1">
                <h3 className="text-xs font-medium text-muted-foreground">{t("workforce.profile.goals")}</h3>
                {e.goals.length ? (
                  <ul className="list-disc ps-5">
                    {e.goals.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">—</p>
                )}
              </div>
            </div>
            <div className="grid gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">{t("workforce.profile.kpis")}</h3>
              {kpis.length === 0 ? (
                <p className="text-muted-foreground">{t("workforce.profile.noKpis")}</p>
              ) : (
                <ul className="grid gap-1">
                  {kpis.map((k) => {
                    const v = kpiValues?.values.find((x) => x.key === k.key);
                    const ok = v && v.value !== null ? (v.higherIsBetter === false ? v.value <= k.target : v.value >= k.target) : null;
                    return (
                      <li key={k.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2 py-1">
                        <span>{v ? t(v.labelKey) : k.key}</span>
                        <span className="flex items-center gap-2 tabular text-xs">
                          {v ? formatMetric(v.value, v.unit, locale, kpiValues!.currency) : "—"} / {v ? formatMetric(k.target, v.unit, locale, kpiValues!.currency) : formatNumber(k.target, locale)}
                          {ok === null ? null : <Badge tone={ok ? "success" : "warning"}>{ok ? t("workforce.profile.onTrack") : t("workforce.profile.offTrack")}</Badge>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {kpis.length && !kpiValues ? <p className="text-xs text-muted-foreground">{t("intelligence.needsAnalytics")}</p> : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("workforce.profile.model")}: {e.model ?? t("workforce.profile.platformDefault")}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title={t("workforce.profile.directReports")}
            actions={
              <Link className="text-xs text-primary hover:underline" href={`/${locale}/workforce/org`}>
                {t("workforce.org.open")}
              </Link>
            }
          />
          {reports.length === 0 ? (
            <CardBody className="text-sm text-muted-foreground">{t("workforce.profile.noReports")}</CardBody>
          ) : (
            <ul className="divide-y text-sm">
              {reports.map((r) => (
                <li key={r.id} className="flex items-center gap-2 px-4 py-2">
                  <AiAvatar id={r.id} initials={r.initials} size="sm" paused={r.status === "PAUSED"} />
                  <Link className="min-w-0 flex-1 truncate hover:underline" href={`/${locale}/workforce/${r.id}`}>
                    {r.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">{r.jobTitle ?? t(`profiles.${r.profileKey}.name`)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title={t("workforce.history.title")} description={t("workforce.history.hint")} actions={<Sparkline values={history.map((w) => w.completed)} />} />
        <Table>
          <THead>
            <Tr>
              <Th>{t("workforce.history.week")}</Th>
              <Th>{t("workforce.stats.completed")}</Th>
              <Th>{t("workforce.stats.failed")}</Th>
              <Th>{t("workforce.history.approvalRate")}</Th>
              <Th>{t("workforce.logs.cost")}</Th>
            </Tr>
          </THead>
          <TBody>
            {[...history].reverse().map((w) => (
              <Tr key={w.week}>
                <Td className="whitespace-nowrap">{formatDate(new Date(`${w.week}T00:00:00Z`), locale, "UTC")}</Td>
                <Td className="tabular">{formatNumber(w.completed, locale)}</Td>
                <Td className="tabular">{formatNumber(w.failed, locale)}</Td>
                <Td className="tabular">{w.approvalRate === null ? "—" : formatNumber(w.approvalRate, locale, { style: "percent" })}</Td>
                <Td className="tabular">{usd(w.costMicros)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>

      {delegations.length ? (
        <Card id="delegations">
          <CardHeader
            title={t("workforce.delegations.employeeTitle")}
            description={t("workforce.delegations.employeeHint")}
            actions={
              <Link className="text-sm text-primary hover:underline" href={`/${locale}/workforce/escalations#delegations`}>
                {t("workforce.tabs.escalations")}
              </Link>
            }
          />
          <ul className="divide-y text-sm">
            {delegations.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <Badge tone={d.status === "PROPOSED" ? "warning" : d.status === "CREATED" ? "success" : d.status === "FAILED" ? "danger" : "neutral"}>{t(`workforce.delegations.status.${d.status}`)}</Badge>
                <span className="text-muted-foreground">
                  {d.fromEmployee.name} → {d.toEmployee.name}
                </span>
                <span className="min-w-0 break-words font-medium" dir="auto">
                  {d.title}
                </span>
                <span className="text-xs text-muted-foreground">{formatRelativeTime(d.createdAt, locale)}</span>
                {d.childTaskId ? (
                  <Link className="text-xs text-primary hover:underline" href={`/${locale}/tasks/${d.childTaskId}`}>
                    {t("workforce.delegations.childTask")}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card id="reports">
        <CardHeader title={t("workforce.reports.title")} description={t("workforce.reports.hint")} />
        {received.length + written.length === 0 ? (
          <CardBody className="text-sm text-muted-foreground">{t("workforce.reports.empty")}</CardBody>
        ) : (
          <ul className="divide-y text-sm">
            {[...received, ...written.filter((w) => !received.some((r) => r.id === w.id))]
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
              .map((r) => (
                <li key={r.id} className="grid gap-1 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.kind === "ESCALATION" ? "warning" : "info"}>{t(`workforce.reports.kinds.${r.kind}`)}</Badge>
                    <span className="font-medium">{r.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.aiEmployee.id === e.id ? t("workforce.reports.to", { name: r.manager?.name ?? t("workforce.org.founder") }) : t("workforce.reports.from", { name: r.aiEmployee.name })} · {formatRelativeTime(r.createdAt, locale)}
                    </span>
                  </div>
                  <p className="line-clamp-4 whitespace-pre-wrap break-words text-muted-foreground">{r.body}</p>
                  <span className="flex flex-wrap gap-3 text-xs">
                    {r.taskId ? (
                      <Link className="text-primary hover:underline" href={`/${locale}/tasks/${r.taskId}`}>
                        {t("workforce.reports.sourceTask")}
                      </Link>
                    ) : null}
                    {r.escalationTaskId ? (
                      <Link className="text-primary hover:underline" href={`/${locale}/tasks/${r.escalationTaskId}`}>
                        {t("workforce.reports.escalationTask")}
                      </Link>
                    ) : null}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={t("workforce.skillsUsage.title")} description={t("workforce.skillsUsage.hint")} />
        <CardBody>
          {usageRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("workforce.skillsUsage.empty")}</p>
          ) : (
            <ul className="grid gap-1.5 text-sm" aria-label={t("workforce.skillsUsage.title")}>
              {usageRows.map(([tool, n]) => (
                <li key={tool} className="grid grid-cols-[10rem_minmax(0,1fr)_2.5rem] items-center gap-2">
                  <span className="truncate text-xs text-muted-foreground">{toolLabel(tool)}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${(n / usageMax) * 100}%` }} />
                  </span>
                  <span className="tabular text-end text-xs">{formatNumber(n, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("workforce.tools")} description={t("workforce.employee.toolsHint")} />
        <CardBody className="flex flex-wrap gap-1.5">
          {(profile?.tools ?? []).map((name) => {
            const d = getTool(name);
            const on = effective.has(name);
            return (
              <Badge key={name} tone={!on ? "neutral" : d && d.autonomy !== "AUTONOMOUS" ? "warning" : "success"} className={on ? undefined : "line-through opacity-60"}>
                {toolLabel(name)}
                {on && d && d.autonomy !== "AUTONOMOUS" ? ` · ${t("workforce.needsApproval")}` : ""}
              </Badge>
            );
          })}
        </CardBody>
      </Card>

      {canRun ? (
        <Card id="assign">
          <CardHeader title={t("workforce.employee.assignTitle", { name: e.name })} />
          <CardBody>
            {!aiConfigured() ? (
              <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice>
            ) : pausedOrOver ? (
              <Notice tone="warning">{e.status === "PAUSED" ? t("workforce.employee.pausedNotice") : t("workforce.employee.overBudgetNotice")}</Notice>
            ) : (
              <AssignTaskForm apiBase={apiBase} aiEmployeeId={e.id} />
            )}
          </CardBody>
        </Card>
      ) : null}

      <section className="grid gap-3 md:grid-cols-3" aria-label={t("workforce.employee.queue")}>
        {[
          { key: "queued", rows: queued.data },
          { key: "running", rows: running.data },
          { key: "done", rows: done10 },
        ].map((col) => (
          <Card key={col.key}>
            <CardHeader title={t(`workforce.queue.${col.key}`)} description={t("agentTasks.count", { count: col.rows.length })} />
            {col.rows.length === 0 ? (
              <CardBody className="text-sm text-muted-foreground">{t("workforce.queue.empty")}</CardBody>
            ) : (
              <ul className="divide-y">
                {col.rows.map((x) => (
                  <li key={x.id} className="grid gap-1 px-4 py-2 text-sm">
                    <Link href={`/${locale}/tasks/${x.id}`} className="font-medium hover:underline">
                      {x.title}
                    </Link>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <TaskStatusBadge status={x.status} label={t(`agentTasks.status.${x.status}`)} />
                      {formatRelativeTime(x.createdAt, locale)}
                      {x.parentTaskId ? <Badge>{t("workforce.queue.delegated")}</Badge> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </section>
      <p className="text-xs">
        <Link className="text-primary hover:underline" href={`/${locale}/tasks?employee=${e.id}`}>
          {t("workforce.employee.allTasks")}
        </Link>
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("workforce.memory.title")} description={t("workforce.memory.hint")} />
          <CardBody className="grid gap-3">
            {canManage ? <MemoryForm path={`${apiBase}/workforce/employees/${e.id}/memory`} /> : null}
            {memories.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("workforce.memory.empty")}</p>
            ) : (
              <ul className="grid gap-2">
                {memories.map((m) => (
                  <li key={m.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                    <div className="grid min-w-0 flex-1 gap-1">
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      <span className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        {m.pinned ? <Badge tone="accent">{t("workforce.memory.pinned")}</Badge> : null}
                        <span>{t(`workforce.memory.sources.${m.source}`)}</span>
                        {m.sourceTaskId ? (
                          <Link className="hover:underline" href={`/${locale}/tasks/${m.sourceTaskId}`}>
                            {t("workforce.memory.fromTask")}
                          </Link>
                        ) : null}
                        <span>{formatRelativeTime(m.createdAt, locale)}</span>
                      </span>
                    </div>
                    {canManage ? (
                      <div className="flex shrink-0 gap-1">
                        <ActionButton path={`${apiBase}/workforce/employees/${e.id}/memory/${m.id}`} method="PATCH" body={{ pinned: !m.pinned }} variant="ghost" size="icon">
                          {m.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                          <span className="sr-only">{m.pinned ? t("workforce.memory.unpin") : t("workforce.memory.pin")}</span>
                        </ActionButton>
                        <ActionButton path={`${apiBase}/workforce/employees/${e.id}/memory/${m.id}`} method="DELETE" variant="ghost" size="icon" confirm={t("workforce.memory.confirmDelete")}>
                          <Trash2 aria-hidden />
                          <span className="sr-only">{t("workforce.memory.delete")}</span>
                        </ActionButton>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title={t("plans.title")}
            actions={
              <Link className="text-xs text-primary hover:underline" href={`/${locale}/plans`}>
                {t("workforce.employee.manageSchedules")}
              </Link>
            }
          />
          {schedules.length === 0 ? (
            <CardBody className="text-sm text-muted-foreground">{t("plans.emptyForEmployee")}</CardBody>
          ) : (
            <ul className="divide-y text-sm">
              {schedules.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <span className="min-w-0 truncate">{s.name}</span>
                  <Badge tone={s.enabled ? "success" : "neutral"}>{s.enabled ? t("common.enabled") : t("common.disabled")}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title={t("workforce.employee.logs")} description={t("workforce.employee.logsHint")} />
        {logs.length === 0 ? (
          <CardBody className="text-sm text-muted-foreground">{t("workforce.employee.noLogs")}</CardBody>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("agentTasks.columns.title")}</Th>
                <Th>{t("agentTasks.columns.status")}</Th>
                <Th>{t("workforce.logs.toolCalls")}</Th>
                <Th>{t("workforce.logs.tokens")}</Th>
                <Th>{t("workforce.logs.cost")}</Th>
                <Th>{t("workforce.logs.duration")}</Th>
                <Th>{t("workforce.logs.finished")}</Th>
              </Tr>
            </THead>
            <TBody>
              {logs.map((l) => {
                const calls = (l.toolCalls as unknown as ToolCallRecord[]) ?? [];
                return (
                  <Tr key={l.id}>
                    <Td className="font-medium">
                      <Link className="hover:underline" href={`/${locale}/tasks/${l.id}`}>
                        {l.title}
                      </Link>
                    </Td>
                    <Td>
                      <TaskStatusBadge status={l.status} label={t(`agentTasks.status.${l.status}`)} />
                    </Td>
                    <Td className="tabular">
                      {formatNumber(calls.length, locale)}
                      {calls.some((c) => c.approvalId) ? <span className="ms-1 text-xs text-warning">· {t("workforce.logs.approvals", { count: calls.filter((c) => c.approvalId).length })}</span> : null}
                      {calls.some((c) => c.error) ? <span className="ms-1 text-xs text-danger">· {t("workforce.logs.errors", { count: calls.filter((c) => c.error).length })}</span> : null}
                    </Td>
                    <Td className="tabular">{formatNumber((l.inputTokens ?? 0) + (l.outputTokens ?? 0), locale)}</Td>
                    <Td className="tabular">{usd(costMicros(l.model, l.inputTokens ?? 0, l.outputTokens ?? 0))}</Td>
                    <Td className="tabular">{l.startedAt && l.completedAt ? seconds(l.completedAt.getTime() - l.startedAt.getTime()) : "—"}</Td>
                    <Td className="whitespace-nowrap text-muted-foreground">{l.completedAt ? formatDateTime(l.completedAt, locale, tz) : "—"}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
