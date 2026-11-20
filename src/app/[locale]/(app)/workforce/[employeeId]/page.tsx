import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pause, Pin, PinOff, Play, Trash2 } from "lucide-react";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { TaskStatusBadge } from "@/components/agents/status-badge";
import { ActionButton } from "@/components/workforce/action-button";
import { AssignTaskForm } from "@/components/workforce/assign-task-form";
import { AiAvatar } from "@/components/workforce/avatar";
import { EditEmployeeDialog } from "@/components/workforce/hire-dialog";
import { MemoryForm } from "@/components/workforce/memory-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatMoney, formatNumber, formatRelativeTime } from "@/i18n/format";
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
import { employeeStats, getEmployee, listMembers, listMemories } from "@/server/modules/workforce/service";
import { employeeMonthUsage } from "@/server/modules/workforce/usage";
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
  const [canManage, canRun] = await Promise.all([can(viewer.ctx, "agents.manage", chain), can(viewer.ctx, "agents.run", chain)]);
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
  const logs = await db().agentTask.findMany({
    where: { organizationId: org.id, companyId: company.id, aiEmployeeId: e.id, status: { in: ["COMPLETED", "FAILED"] } },
    orderBy: { id: "desc" },
    take: 15,
    select: { id: true, title: true, status: true, toolCalls: true, model: true, inputTokens: true, outputTokens: true, startedAt: true, completedAt: true, errorCode: true },
  });
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
  const pausedOrOver = e.status === "PAUSED" || usage.exhausted;
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
          <AiAvatar id={e.id} initials={e.initials} paused={e.status === "PAUSED"} size="lg" />
          <div className="grid min-w-0 gap-0.5">
            <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
              {e.name}
              <Badge tone={e.status === "ACTIVE" ? "success" : "neutral"}>{t(`workforce.status.${e.status}`)}</Badge>
            </h1>
            <p className="text-sm text-muted-foreground">
              {t(`profiles.${e.profileKey}.name`)} · {t(`workforce.departments.${e.department}`)}
            </p>
          </div>
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-start gap-2">
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

      {e.status === "PAUSED" ? <Notice tone="warning">{t("workforce.employee.pausedNotice")}</Notice> : null}
      {usage.exhausted ? <Notice tone="warning">{t("workforce.employee.overBudgetNotice")}</Notice> : null}

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
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("workforce.employee.configuration")} />
          <CardBody className="grid gap-2 text-sm">
            <p>
              <span className="text-muted-foreground">{t("workforce.form.autonomy")}: </span>
              {t(`workforce.autonomy.${e.autonomy}.name`)}
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
