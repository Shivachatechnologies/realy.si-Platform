import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, Workflow } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, Facts, guard } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { CopyButton } from "@/components/admin/copy-button";
import { WorkflowRunActions } from "@/components/admin/ai/ai-actions";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { canPlatform } from "@/server/modules/admin/access";
import { getWorkflowRunAdmin } from "@/server/modules/admin/workflows-admin";
import { requireViewer } from "@/server/session";

/** One workflow run: the execution trace step by step (data only with platform.data.read), approvals, actions. */
export default async function AdminWorkflowRunPage({ params }: PageProps<"/[locale]/workflows/runs/[runId]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { runId } = await params;
  const r = await guard(
    getWorkflowRunAdmin(viewer.ctx, runId).catch((e) => {
      if (isAppError(e) && e.code === "not_found") notFound();
      throw e;
    }),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const run = r.value;
  const canManage = await canPlatform(viewer.ctx, "platform.ai.manage");
  const n = (v: number) => formatNumber(v, locale);
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: run.workflow.name, href: `/${locale}/workflows/${run.workflow.id}` }, { label: t("admin.workflows.run") }]} />
      <AdminHeader
        icon={<Workflow />}
        title={`${run.workflow.name} · ${t("admin.workflows.run")}`}
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <StatusBadge domain="workflowRun" value={run.status}>{t(`admin.workflows.runStatus.${run.status}`)}</StatusBadge>
            <CopyButton value={run.id} showValue />
          </span>
        }
        description={run.organization.name}
        actions={canManage ? <WorkflowRunActions run={run} /> : null}
      />
      {run.error ? <Notice tone="danger">{run.error}</Notice> : null}
      <Card>
        <CardHeader title={t("admin.workflows.overview")} />
        <Facts
          rows={[
            [t("admin.workflows.trigger"), `${run.triggerType}${run.isTest ? ` · ${t("admin.workflows.test")}` : ""}`],
            [t("admin.workflows.event"), <span key="e" className="font-mono text-xs">{run.triggerEventId}</span>],
            [t("admin.workflows.depthLabel"), n(run.depth)],
            [t("admin.workflows.waitingFor"), run.waitingFor ?? "—"],
            [t("admin.ai.task.created"), <Timestamp key="c" value={run.createdAt} />],
            [t("admin.ai.task.started"), run.startedAt ? <Timestamp key="s" value={run.startedAt} /> : "—"],
            [t("admin.ai.task.completed"), run.finishedAt ? <Timestamp key="f" value={run.finishedAt} /> : "—"],
            [t("admin.workflows.deadLetter"), run.deadLetteredAt ? <Timestamp key="d" value={run.deadLetteredAt} /> : "—"],
            [t("admin.organizations.columns.name"), <Link key="o" className="hover:underline" href={`/${locale}/organizations/${run.organization.id}`}>{run.organization.name}</Link>],
          ]}
        />
      </Card>
      <Card>
        <CardHeader title={t("admin.workflows.trace")} description={run.sensitive ? t("admin.workflows.traceHint") : t("admin.workflows.traceHidden")} />
        {run.steps.length === 0 ? (
          <EmptyState title={t("admin.workflows.noSteps")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>#</Th>
                <Th>{t("admin.workflows.step")}</Th>
                <Th>{t("admin.ai.columns.status")}</Th>
                <Th>{t("admin.ai.task.duration")}</Th>
                <Th>{t("admin.ai.task.attempts")}</Th>
                {run.sensitive ? <Th>{t("admin.workflows.data")}</Th> : null}
              </Tr>
            </THead>
            <TBody>
              {run.steps.map((s, i) => (
                <Tr key={s.id}>
                  <Td className="text-xs tabular-nums">{i + 1}</Td>
                  <Td>
                    <div className="font-mono text-xs">{s.stepId}</div>
                    <div className="text-[11px] text-muted-foreground">{s.stepType}</div>
                  </Td>
                  <Td>
                    <StatusBadge domain="workflowStep" value={s.status}>{s.status}</StatusBadge>
                    {s.error ? <div className="max-w-80 truncate text-[11px] text-danger">{s.error}</div> : null}
                  </Td>
                  <Td className="text-xs tabular-nums">{s.durationMs === null ? "—" : `${n(s.durationMs)} ms`}</Td>
                  <Td className="text-xs tabular-nums">{n(s.attempts)}</Td>
                  {run.sensitive ? (
                    <Td className="max-w-md">
                      <pre className="max-h-32 overflow-auto text-[11px] whitespace-pre-wrap text-muted-foreground">{JSON.stringify({ input: s.input, output: s.output }, null, 1)}</pre>
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        {!run.sensitive ? (
          <CardBody>
            <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="size-3" />
              {t("admin.aiRequests.sensitiveHidden")}
            </p>
          </CardBody>
        ) : null}
      </Card>
      <Card>
        <CardHeader title={t("admin.ai.task.approvals")} description={t("admin.workflows.approvalsHint")} />
        {run.approvals.length === 0 ? (
          <EmptyState title={t("admin.ai.task.noApprovals")} />
        ) : (
          <Table>
            <TBody>
              {run.approvals.map((a) => (
                <Tr key={a.id}>
                  <Td className="text-sm">{run.sensitive ? a.title : <span className="font-mono text-xs">{a.stepId}</span>}</Td>
                  <Td>
                    <StatusBadge domain="approval" value={a.status}>{a.status}</StatusBadge>
                  </Td>
                  <Td className="text-xs">
                    <Timestamp value={a.createdAt} mode="relative" />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
