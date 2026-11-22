import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, GitBranch, ListChecks, Lock, Receipt, ShieldCheck, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, AuditTimeline, EmptyState, Facts, StatGrid, StatTile, guard, usd } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { CopyButton } from "@/components/admin/copy-button";
import { RejectApprovalButton, TaskActions } from "@/components/admin/ai/ai-actions";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { getAdminTask } from "@/server/modules/admin/ai-tasks";
import { requireViewer } from "@/server/session";

/** One AI task: input, context, steps, tool calls, cost turns, request log, approvals, children, audit, actions. */
export default async function AdminAiTaskPage({ params }: PageProps<"/[locale]/ai/tasks/[taskId]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { taskId } = await params;
  const r = await guard(
    getAdminTask(viewer.ctx, taskId).catch((e) => {
      if (isAppError(e) && e.code === "not_found") notFound();
      throw e;
    }),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const task = r.value;
  const n = (v: number) => formatNumber(v, locale);
  const base = `/${locale}/ai`;
  const tz = viewer.user.timezone;
  const duration = task.startedAt && task.completedAt ? task.completedAt.getTime() - task.startedAt.getTime() : null;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: task.title.slice(0, 60) }]} />
      <AdminHeader
        icon={<ListChecks />}
        title={task.title}
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <StatusBadge domain="aiTask" value={task.status} pulse={task.status === "RUNNING"}>
              {t(`admin.ai.status.${task.status}`)}
            </StatusBadge>
            <CopyButton value={task.id} showValue />
          </span>
        }
        description={`${task.organization.name} · ${task.company.name} · ${task.profile}`}
        actions={
          <>
            {task.canManage ? <TaskActions task={task} candidates={task.reassignCandidates} /> : null}
            <Button asChild size="sm" variant="ghost">
              <a href={`/api/v1/admin/ai/tasks/${task.id}/export`} download>
                <Download />
                {t("admin.ai.task.exportLog")}
              </a>
            </Button>
          </>
        }
      />
      {task.status === "PAUSED" ? <Notice tone="warning" title={t("admin.ai.task.pausedTitle")}>{t("admin.ai.task.pausedBody", { from: task.pause.pausedFrom ?? "—" })}</Notice> : null}
      {task.errorCode ? (
        <Notice tone="danger" title={task.errorCode} action={<Link className="text-sm text-primary hover:underline" href={`${base}/requests?task=${task.id}&window=30d`}>{t("admin.ai.task.investigate")}</Link>}>
          {task.errorMessage ?? "—"}
        </Notice>
      ) : null}
      <StatGrid>
        <StatTile label={t("admin.ai.columns.cost")} value={usd(task.costMicros, locale)} hint={t("admin.ai.task.ledgerTurns", { count: task.ledger.length })} />
        <StatTile label={t("admin.ai.columns.tokens")} value={n((task.inputTokens ?? 0) + (task.outputTokens ?? 0))} hint={`${n(task.inputTokens ?? 0)} / ${n(task.outputTokens ?? 0)}`} />
        <StatTile label={t("admin.ai.task.attempts")} value={n(task.attempts)} hint={t("admin.ai.task.requestRows", { count: task.requests.length })} href={`${base}/requests?task=${task.id}&window=30d`} />
        <StatTile label={t("admin.ai.task.duration")} value={duration === null ? "—" : `${n(Math.round(duration / 1000))} s`} hint={task.model ?? undefined} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.ai.task.overview")} />
          <Facts
            rows={[
              [t("admin.organizations.columns.name"), <Link key="o" className="hover:underline" href={`/${locale}/organizations/${task.organization.id}`}>{task.organization.name}</Link>],
              [t("admin.ai.task.company"), task.company.name],
              [t("admin.aiWorkforce.employee"), task.employee ? <Link key="e" className="hover:underline" href={`${base}/workforce/${task.employee.id}`}>{task.employee.name}</Link> : "—"],
              [t("admin.ai.columns.profile"), <span key="p" className="font-mono">{task.profile}</span>],
              [t("admin.aiModels.model"), <span key="m" className="font-mono">{task.model ?? "—"}</span>],
              [t("admin.ai.task.requester"), task.requester ? <Link key="r" className="hover:underline" href={`/${locale}/users/${task.requester.id}`}>{task.requester.name ?? task.requester.email ?? task.requester.id.slice(0, 8)}</Link> : "—"],
              [t("admin.ai.task.created"), <Timestamp key="c" value={task.createdAt} />],
              [t("admin.ai.task.started"), task.startedAt ? <Timestamp key="s" value={task.startedAt} /> : "—"],
              [t("admin.ai.task.completed"), task.completedAt ? <Timestamp key="d" value={task.completedAt} /> : "—"],
              [t("admin.ai.task.depth"), n(task.depth)],
              [t("admin.ai.task.origin"), task.scheduleRun ? t("admin.ai.task.fromSchedule", { slot: task.scheduleRun.slot }) : task.parent ? t("admin.ai.task.delegated") : t("admin.ai.task.manual")],
              [t("admin.ai.task.parking"), task.park.parkOnApproval ? t("admin.ai.task.parks", { count: task.park.parks, waiting: task.park.waitingFor.length }) : "—"],
              [t("admin.ai.task.context"), t("admin.ai.task.summaries", { count: task.contextSummaries })],
              [t("admin.ai.task.subject"), task.subject ? <span key="sub" className="font-mono text-xs">{`${task.subject.type}:${task.subject.id?.slice(0, 8)}`}</span> : "—"],
            ]}
          />
        </Card>
        <Card>
          <CardHeader icon={<GitBranch />} title={t("admin.ai.task.family")} description={t("admin.ai.task.familyHint")} />
          {task.parent ? (
            <p className="border-b px-4 py-2 text-xs">
              {t("admin.ai.task.parent")}:{" "}
              <Link className="font-medium hover:underline" href={`${base}/tasks/${task.parent.id}`}>
                {task.parent.title}
              </Link>{" "}
              <StatusBadge domain="aiTask" value={task.parent.status}>{t(`admin.ai.status.${task.parent.status}`)}</StatusBadge>
            </p>
          ) : null}
          {task.children.length === 0 ? (
            <EmptyState title={t("admin.ai.task.noChildren")} />
          ) : (
            <Table>
              <TBody>
                {task.children.map((c) => (
                  <Tr key={c.id}>
                    <Td>
                      <Link className="text-sm hover:underline" href={`${base}/tasks/${c.id}`}>
                        {c.title}
                      </Link>
                      <div className="font-mono text-[11px] text-muted-foreground">{c.profile}</div>
                    </Td>
                    <Td>
                      <StatusBadge domain="aiTask" value={c.status}>{t(`admin.ai.status.${c.status}`)}</StatusBadge>
                      {c.errorCode ? <div className="font-mono text-[11px] text-danger">{c.errorCode}</div> : null}
                    </Td>
                    <Td className="text-xs tabular-nums">{n((c.inputTokens ?? 0) + (c.outputTokens ?? 0))}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title={t("admin.ai.task.input")} description={task.sensitive ? t("admin.ai.task.inputHint") : undefined} />
        {task.sensitive ? (
          <CardBody className="grid gap-3">
            <pre className="max-h-72 overflow-auto rounded-md bg-surface-2 p-3 text-xs whitespace-pre-wrap">{task.content.instructions}</pre>
            {task.content.output ? (
              <>
                <p className="text-xs font-medium">{t("admin.ai.task.output")}</p>
                <pre className="max-h-96 overflow-auto rounded-md bg-surface-2 p-3 text-xs whitespace-pre-wrap">{task.content.output}</pre>
              </>
            ) : null}
          </CardBody>
        ) : (
          <CardBody>
            <Notice title={t("admin.ai.task.contentHidden")}>
              <span className="inline-flex items-center gap-1">
                <Lock className="size-3" />
                {t("admin.ai.task.contentHiddenBody", { instructions: n(task.content.lengths?.instructions ?? 0), output: n(task.content.lengths?.output ?? 0) })}
              </span>
            </Notice>
          </CardBody>
        )}
      </Card>
      <Card>
        <CardHeader icon={<Wrench />} title={t("admin.ai.task.toolCalls")} description={t("admin.ai.task.toolCallsHint", { count: task.content.toolCalls.length })} />
        {task.content.toolCalls.length === 0 ? (
          <EmptyState title={t("admin.ai.task.noToolCalls")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>#</Th>
                <Th>{t("admin.ai.task.tool")}</Th>
                <Th>{t("admin.ai.task.result")}</Th>
                {task.sensitive ? <Th>{t("admin.ai.task.toolInput")}</Th> : null}
              </Tr>
            </THead>
            <TBody>
              {task.content.toolCalls.map((c, i) => (
                <Tr key={i}>
                  <Td className="tabular-nums text-xs">{i + 1}</Td>
                  <Td className="font-mono text-xs">{c.tool ?? "—"}</Td>
                  <Td className="text-xs">
                    {c.error ? <span className="text-danger">{c.error === "hidden" ? t("admin.ai.task.toolError") : c.error}</span> : c.approvalId ? <Badge tone="warning">{t("admin.ai.task.approvalFiled")}</Badge> : c.autonomousActionId ? <Badge tone="info">{t("admin.ai.task.autonomous")}</Badge> : t("admin.ai.task.results", { count: c.results ?? 0 })}
                  </Td>
                  {task.sensitive ? <Td className="max-w-md truncate font-mono text-[11px] text-muted-foreground">{JSON.stringify((c as { input?: unknown }).input ?? {})}</Td> : null}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<Receipt />} title={t("admin.ai.task.costTurns")} description={t("admin.ai.task.costTurnsHint")} />
          {task.ledger.length === 0 ? (
            <EmptyState title={t("admin.ai.task.noLedger")} />
          ) : (
            <Table>
              <TBody>
                {task.ledger.map((l) => (
                  <Tr key={l.id}>
                    <Td className="text-xs whitespace-nowrap" title={formatDateTime(l.occurredAt, locale, tz)}>
                      {formatRelativeTime(l.occurredAt, locale)}
                    </Td>
                    <Td className="font-mono text-[11px]">{l.model ?? l.provider}</Td>
                    <Td className="text-xs tabular-nums">
                      {n(l.inputTokens)} / {n(l.outputTokens)}
                      {l.cachedTokens ? <span className="text-muted-foreground"> · {t("admin.aiRequests.cached", { count: l.cachedTokens })}</span> : null}
                    </Td>
                    <Td className="text-xs tabular-nums">{usd(l.costMicros, locale)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title={t("admin.ai.task.requestLog")} description={t("admin.ai.task.requestLogHint")} />
          {task.requests.length === 0 ? (
            <EmptyState title={t("admin.aiRequests.noRequests")} body={t("admin.ai.task.requestLogEmpty")} />
          ) : (
            <Table>
              <TBody>
                {task.requests.map((q) => (
                  <Tr key={q.id}>
                    <Td className="text-xs">
                      <Link className="hover:underline" href={`${base}/requests?id=${q.id}&task=${task.id}&window=30d`}>
                        <Timestamp value={q.createdAt} mode="relative" />
                      </Link>
                    </Td>
                    <Td className="font-mono text-[11px]">{q.servedModel ?? q.requestedModel}</Td>
                    <Td>
                      <StatusBadge domain="aiRequest" value={q.status}>{t(`admin.aiRequests.status.${q.status}`)}</StatusBadge>
                      {q.errorCode ? <div className="font-mono text-[11px] text-danger">{q.errorCode}</div> : null}
                    </Td>
                    <Td className="text-xs tabular-nums">{q.latencyMs === null ? "—" : `${n(q.latencyMs)} ms`}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader icon={<ShieldCheck />} title={t("admin.ai.task.approvals")} description={t("admin.ai.task.approvalsHint")} />
        {task.approvals.length === 0 ? (
          <EmptyState title={t("admin.ai.task.noApprovals")} />
        ) : (
          <Table>
            <TBody>
              {task.approvals.map((a) => (
                <Tr key={a.id}>
                  <Td>
                    <div className="text-sm">{task.sensitive ? a.summary : a.tool}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {a.tool} · {a.risk}
                    </div>
                  </Td>
                  <Td>
                    <StatusBadge domain="approval" value={a.status}>{a.status}</StatusBadge>
                    {a.error ? <div className="text-[11px] text-danger">{task.sensitive ? a.error : t("admin.ai.task.toolError")}</div> : null}
                  </Td>
                  <Td className="text-xs">
                    <Timestamp value={a.createdAt} mode="relative" />
                  </Td>
                  <Td className="text-end">{task.canManage && a.status === "PENDING" ? <RejectApprovalButton approvalId={a.id} title={a.tool} /> : null}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title={t("admin.ai.task.audit")} description={t("admin.ai.task.auditHint")} />
        {task.audit.length === 0 ? (
          <EmptyState title={t("admin.ai.task.noAudit")} />
        ) : (
          <AuditTimeline
            items={task.audit.map((a) => ({
              id: a.id,
              who: a.actor?.name ?? a.actor?.email ?? (a.actorType === "SYSTEM" ? t("admin.ai.task.system") : a.actorType),
              action: a.action,
              security: a.category === "ADMIN" || a.category === "SECURITY",
              reason: a.reason,
              iso: a.createdAt.toISOString(),
              exact: formatDateTime(a.createdAt, locale, tz),
              relative: formatRelativeTime(a.createdAt, locale),
            }))}
          />
        )}
      </Card>
    </div>
  );
}
