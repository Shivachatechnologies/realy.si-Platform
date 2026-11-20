import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, Coins, FileText, GitBranch, Hourglass, Quote, Route, ShieldQuestion, Timer } from "lucide-react";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { TaskActions } from "@/components/agents/task-actions";
import { TaskStatusBadge } from "@/components/agents/status-badge";
import { DecisionCard } from "@/components/decisions/decision-card";
import { loadDecisionPreviews } from "@/components/decisions/load";
import { Markdown } from "@/components/guide/markdown";
import { DelegationNetwork } from "@/components/mission/delegation-network";
import { ExecutionTimeline } from "@/components/mission/execution-timeline";
import { AnimatedProgress } from "@/components/motion/animated-progress";
import { LiveDot } from "@/components/motion/live-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { aiConfigured, type Citation, type ToolCallRecord } from "@/server/modules/agents/runtime";
import { getTask, listChildTasks } from "@/server/modules/agents/service";
import { costMicros, microsToCents } from "@/server/modules/workforce/pricing";
import { listApprovals } from "@/server/modules/approvals/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.tasks.title") };
}

function duration(ms: number, t: (k: string, v?: Record<string, number>) => string) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return t("missionControl.detail.seconds", { s });
  const m = Math.floor(s / 60);
  return m < 60 ? t("missionControl.detail.minutes", { m, s: s % 60 }) : t("missionControl.detail.hours", { h: Math.floor(m / 60), m: m % 60 });
}

export default async function TaskPage({ params }: PageProps<"/[locale]/tasks/[taskId]">) {
  const { taskId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  if (!company) notFound();
  const task = await getTask(viewer.ctx, org.id, company.id, taskId).catch((err) => {
    if (isAppError(err) && (err.code === "not_found" || err.code === "forbidden")) notFound();
    throw err;
  });
  const chain = await companyChain(db(), org.id, company.id);
  const [canRun, canReadApprovals, canDecide] = await Promise.all([
    can(viewer.ctx, "agents.run", chain),
    can(viewer.ctx, "approvals.read", chain),
    can(viewer.ctx, "approvals.decide", chain),
  ]);
  const [employee, parent, children, creator] = await Promise.all([
    task.aiEmployeeId ? db().aiEmployee.findFirst({ where: { id: task.aiEmployeeId, companyId: company.id }, select: { id: true, name: true } }) : null,
    task.parentTaskId ? db().agentTask.findFirst({ where: { id: task.parentTaskId, companyId: company.id }, select: { id: true, title: true, status: true, profile: true, aiEmployeeId: true } }) : null,
    listChildTasks(viewer.ctx, org.id, company.id, task.id),
    db().user.findUnique({ where: { id: task.createdById }, select: { name: true } }),
  ]);
  const empIds = [...new Set([parent?.aiEmployeeId, ...children.map((c) => c.aiEmployeeId)].filter((v): v is string => !!v))];
  const empNames = new Map((empIds.length ? await db().aiEmployee.findMany({ where: { companyId: company.id, id: { in: empIds } }, select: { id: true, name: true } }) : []).map((e) => [e.id, e.name]));
  const approvals = canReadApprovals ? (await listApprovals(viewer.ctx, org.id, company.id)).filter((a) => a.taskId === task.id) : [];
  const tz = viewer.user.timezone;
  const { previews, names } = await loadDecisionPreviews(approvals, { organizationId: org.id, companyId: company.id, t, locale, currency: company.baseCurrency, timeZone: tz });
  const active = task.status === "QUEUED" || task.status === "RUNNING";
  const citations = task.citations as unknown as Citation[];
  const calls = task.toolCalls as unknown as ToolCallRecord[];
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const role = t(`profiles.${task.profile}.name`);
  const who = (profile: string, empId: string | null) => (empId && empNames.get(empId) ? `${empNames.get(empId)} · ${t(`profiles.${profile}.name`)}` : t(`profiles.${profile}.name`));
  const tokens = (task.inputTokens ?? 0) + (task.outputTokens ?? 0);
  const costCents = task.model ? microsToCents(costMicros(task.model, task.inputTokens ?? 0, task.outputTokens ?? 0)) : 0n;
  const ran = task.startedAt ? (task.completedAt ?? new Date()).getTime() - task.startedAt.getTime() : null;
  const pendingApprovals = approvals.filter((a) => a.status === "PENDING").length;
  const createdBy = parent ? t("missionControl.timeline.byTask", { title: parent.title }) : (creator?.name ?? t("activity.unknownActor"));

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <AutoRefresh active={active} />
      <Link href={`/${locale}/tasks`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
        {t("agentTasks.back")}
      </Link>

      <PageHeader
        icon={<Bot />}
        eyebrow={employee ? `${employee.name} · ${role}` : role}
        title={task.title}
        meta={
          <>
            <TaskStatusBadge status={task.status} label={t(`agentTasks.status.${task.status}`)} />
            {active ? <LiveDot tone="info" label={t(`agentTasks.status.${task.status}`)} /> : null}
            {employee ? (
              <Link className="text-xs text-muted-foreground hover:underline" href={`/${locale}/workforce/${employee.id}`}>
                {t("missionControl.detail.profileLink")}
              </Link>
            ) : null}
            {parent ? (
              <Link className="text-xs text-muted-foreground hover:underline" href={`/${locale}/tasks/${parent.id}`}>
                {t("agentTasks.delegatedBy", { title: parent.title })}
              </Link>
            ) : null}
            <span className="text-xs text-muted-foreground">{formatDateTime(task.createdAt, locale, tz)}</span>
            {task.attempts > 1 ? <Badge>{t("agentTasks.attempts", { count: task.attempts })}</Badge> : null}
          </>
        }
        actions={
          canRun ? (
            <TaskActions base={`${apiBase}/tasks/${task.id}`} canCancel={active} canRetry={(task.status === "FAILED" || task.status === "CANCELLED") && aiConfigured()} />
          ) : null
        }
      />

      {task.status === "QUEUED" ? <Notice>{t("agentTasks.queued")}</Notice> : null}
      {task.status === "FAILED" ? <Notice tone="danger">{t("agentTasks.failed", { message: task.errorMessage ?? task.errorCode ?? "" })}</Notice> : null}
      {task.status === "CANCELLED" ? <Notice tone="warning">{t("agentTasks.cancelled")}</Notice> : null}
      {pendingApprovals ? (
        <Notice tone="warning">
          {t("missionControl.detail.waitingApproval", { count: pendingApprovals })}{" "}
          <a href="#approvals" className="font-medium underline">
            {t("missionControl.detail.reviewNow")}
          </a>
        </Notice>
      ) : null}

      <StatGrid>
        <StatTile index={0} label={t("missionControl.detail.steps")} value={calls.length} icon={<Route />} hint={t("missionControl.detail.stepsHint")} />
        <StatTile index={1} label={t("missionControl.detail.tokens")} value={tokens} format="compact" icon={<Coins />} hint={task.model ? t("missionControl.detail.tokensHint", { input: formatNumber(task.inputTokens ?? 0, locale), output: formatNumber(task.outputTokens ?? 0, locale) }) : undefined} />
        <StatTile index={2} label={t("missionControl.detail.cost")} money={{ amountMinor: costCents, currency: "USD" }} icon={<Hourglass />} hint={task.model ?? undefined} />
        <StatTile index={3} label={t("missionControl.detail.duration")} value={ran === null ? "—" : duration(ran, t)} icon={<Timer />} live={task.status === "RUNNING"} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader icon={<FileText />} title={t("agentTasks.instructions")} />
            <CardBody>
              <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{task.instructions}</p>
            </CardBody>
          </Card>

          {task.status === "RUNNING" ? (
            <Card variant="glass">
              <CardBody className="grid gap-2">
                <AnimatedProgress label={t("agentTasks.running")} active />
                <p className="text-sm text-muted-foreground">{t("agentTasks.running")}</p>
              </CardBody>
            </Card>
          ) : null}

          {task.output ? (
            <Card variant="highlight">
              <CardHeader title={t("agentTasks.deliverable")} description={t("agentTasks.reviewNote")} />
              <CardBody className="grid gap-3">
                <Markdown text={task.output} className="text-sm leading-relaxed" />
                {task.model ? (
                  <p className="text-xs text-muted-foreground">
                    {t("agentTasks.usage", { model: task.model, input: formatNumber(task.inputTokens ?? 0, locale), output: formatNumber(task.outputTokens ?? 0, locale) })}
                  </p>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {task.status === "COMPLETED" || citations.length ? (
            <Card>
              <CardHeader icon={<Quote />} title={t("agentTasks.sources")} description={t("missionControl.detail.sourcesHint")} />
              <CardBody>
                {citations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("agentTasks.noSources")}</p>
                ) : (
                  <ol className="flex flex-wrap gap-2 text-sm">
                    {citations.map((c) => (
                      <li key={c.ref}>
                        <Link className="hover-lift inline-flex items-center gap-2 rounded-full border bg-surface-2/60 px-3 py-1 hover:border-primary" href={`/${locale}/brain/${c.documentId}#passage-${c.passage}`}>
                          <Badge className="font-mono">{c.ref}</Badge>
                          <span className="max-w-[16rem] truncate">{c.title}</span>
                          <span className="text-xs text-muted-foreground">{t("agentTasks.passage", { n: c.passage })}</span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}
              </CardBody>
            </Card>
          ) : null}

          {approvals.length ? (
            <section id="approvals" className="grid scroll-mt-20 gap-3">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <ShieldQuestion className="size-4 text-warning" aria-hidden /> {t("approvals.forTask")}
              </h2>
              {approvals.map((a) => (
                <DecisionCard key={a.id} a={a} preview={previews.get(a.id)!} t={t} locale={locale} timeZone={tz} apiBase={apiBase} canDecide={canDecide} decidedBy={a.decidedById ? names.get(a.decidedById) : null} />
              ))}
            </section>
          ) : null}
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader icon={<Route />} title={t("missionControl.timeline.title")} description={t("missionControl.timeline.hint")} />
            <CardBody>
              <ExecutionTimeline task={task} calls={calls} t={t} locale={locale} timeZone={tz} createdBy={createdBy} />
            </CardBody>
          </Card>

          {parent || children.length ? (
            <Card>
              <CardHeader icon={<GitBranch />} title={t("agentTasks.delegated")} description={t("missionControl.detail.networkHint")} />
              <CardBody className="grid gap-3">
                <DelegationNetwork
                  parent={parent ? { id: parent.id, title: parent.title, status: parent.status, who: who(parent.profile, parent.aiEmployeeId) } : null}
                  self={{ id: task.id, title: task.title, status: task.status, who: employee ? `${employee.name} · ${role}` : role }}
                  kids={children.map((c) => ({ id: c.id, title: c.title, status: c.status, who: who(c.profile, c.aiEmployeeId) }))}
                  locale={locale}
                  label={t("missionControl.detail.networkLabel")}
                  statusLabel={(s) => t(`agentTasks.status.${s}`)}
                />
                {children.length ? (
                  <ul className="divide-y rounded-md border text-sm">
                    {children.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <Link className="min-w-0 truncate hover:underline" href={`/${locale}/tasks/${c.id}`}>
                          {c.title}
                        </Link>
                        <TaskStatusBadge status={c.status} label={t(`agentTasks.status.${c.status}`)} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {task.status === "COMPLETED" && canRun ? (
            <Card variant="glass">
              <CardHeader title={t("missionControl.detail.nextTitle")} />
              <CardBody className="grid gap-2 text-sm">
                <p className="text-muted-foreground">{t("missionControl.detail.nextBody")}</p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm">
                    <Link href={`/${locale}/tasks${task.aiEmployeeId ? `?employee=${task.aiEmployeeId}` : `?profile=${task.profile}`}#composer`}>{t("missionControl.detail.followUp")}</Link>
                  </Button>
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/${locale}/plans`}>{t("missionControl.detail.repeat")}</Link>
                  </Button>
                </div>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
