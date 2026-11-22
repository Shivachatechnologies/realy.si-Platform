import Link from "next/link";
import { notFound } from "next/navigation";
import { History, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, Facts, StatGrid, StatTile, guard } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { CopyButton } from "@/components/admin/copy-button";
import { WorkflowActions, WorkflowRunActions } from "@/components/admin/ai/ai-actions";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { canPlatform } from "@/server/modules/admin/access";
import { getWorkflowAdmin } from "@/server/modules/admin/workflows-admin";
import { requireViewer } from "@/server/session";

/** One workflow across tenants: status, trigger, autonomy, versions, runs with health, limits, audit and actions. */
export default async function AdminWorkflowPage({ params }: PageProps<"/[locale]/workflows/[workflowId]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { workflowId } = await params;
  const r = await guard(
    getWorkflowAdmin(viewer.ctx, workflowId).catch((e) => {
      if (isAppError(e) && e.code === "not_found") notFound();
      throw e;
    }),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const w = r.value;
  const canManage = await canPlatform(viewer.ctx, "platform.ai.manage");
  const n = (v: number) => formatNumber(v, locale);
  const base = `/${locale}/workflows`;
  const total = Object.values(w.counts30d).reduce<number>((a, v) => a + (v ?? 0), 0);
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: w.name }]} />
      <AdminHeader
        icon={<Workflow />}
        title={w.name}
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <StatusBadge domain="workflow" value={w.status}>{t(`admin.workflows.status.${w.status}`)}</StatusBadge>
            <CopyButton value={w.id} showValue />
          </span>
        }
        description={`${w.organization.name} · ${w.company.name}`}
        actions={canManage ? <WorkflowActions workflow={{ id: w.id, name: w.name, status: w.status, published: !!w.currentVersionId }} /> : null}
      />
      {!w.limits.automationsEnabled ? <Notice tone="danger" title={t("admin.workflows.killSwitchTitle")}>{t("admin.workflows.killSwitchBody")}</Notice> : null}
      <StatGrid>
        <StatTile label={t("admin.workflows.runs30d")} value={n(total)} />
        <StatTile label={t("admin.workflows.successRate")} value={w.successRate === null ? "—" : `${Math.round(w.successRate * 100)}%`} tone={w.successRate !== null && w.successRate < 0.9 ? "danger" : undefined} hint={t("admin.workflows.failedN", { count: w.counts30d.FAILED ?? 0 })} />
        <StatTile label={t("admin.workflows.medianDuration")} value={w.medianDurationMs === null ? "—" : `${n(Math.round(w.medianDurationMs / 1000))} s`} />
        <StatTile label={t("admin.workflows.limits")} value={`${n(w.limits.runsLastMinute)}/${n(w.limits.runsPerMinute)}`} hint={t("admin.workflows.limitsHint", { depth: w.limits.maxDepth })} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.workflows.overview")} />
          <Facts
            rows={[
              [t("admin.organizations.columns.name"), <Link key="o" className="hover:underline" href={`/${locale}/organizations/${w.organization.id}`}>{w.organization.name}</Link>],
              [t("admin.workflows.owner"), w.owner ? <Link key="ow" className="hover:underline" href={`/${locale}/users/${w.owner.id}`}>{w.owner.name ?? w.owner.id.slice(0, 8)}</Link> : "—"],
              [t("admin.workflows.trigger"), w.triggerType ? `${t(`admin.workflows.triggers.${w.triggerType}`)}${w.triggerKey ? ` · ${w.triggerKey}` : ""}` : "—"],
              [t("admin.workflows.autonomy"), <span key="a" className="font-mono text-xs">{w.autonomyMode}</span>],
              [t("admin.workflows.version"), w.currentVersion ? `v${w.currentVersion}` : t("admin.workflows.unpublished")],
              [t("admin.workflows.template"), w.templateKey ?? "—"],
              [t("admin.workflows.lastSlot"), w.lastScheduleSlot ?? "—"],
              [t("admin.aiWorkforce.created"), <Timestamp key="c" value={w.createdAt} />],
              [t("admin.workflows.updated"), <Timestamp key="u" value={w.updatedAt} />],
            ]}
          />
        </Card>
        <Card>
          <CardHeader icon={<History />} title={t("admin.workflows.versions")} />
          {w.versions.length === 0 ? (
            <EmptyState title={t("admin.workflows.unpublished")} />
          ) : (
            <Table>
              <TBody>
                {w.versions.map((v) => (
                  <Tr key={v.id}>
                    <Td className="font-mono text-xs">v{v.version}</Td>
                    <Td className="text-xs">
                      <Timestamp value={v.createdAt} />
                    </Td>
                    <Td>{v.id === w.currentVersionId ? <Badge tone="accent">{t("admin.workflows.current")}</Badge> : null}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title={t("admin.workflows.runs")} description={t("admin.workflows.runsHint")} />
        {w.runs.length === 0 ? (
          <EmptyState title={t("admin.workflows.noRuns")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.aiRequests.time")}</Th>
                <Th>{t("admin.ai.columns.status")}</Th>
                <Th>{t("admin.workflows.trigger")}</Th>
                <Th>{t("admin.ai.task.duration")}</Th>
                {canManage ? <Th className="text-end">{t("admin.common.actions")}</Th> : null}
              </Tr>
            </THead>
            <TBody>
              {w.runs.map((x) => (
                <Tr key={x.id}>
                  <Td className="text-xs">
                    <Link className="hover:underline" href={`${base}/runs/${x.id}`}>
                      <Timestamp value={x.createdAt} mode="relative" />
                    </Link>
                  </Td>
                  <Td>
                    <StatusBadge domain="workflowRun" value={x.status}>{t(`admin.workflows.runStatus.${x.status}`)}</StatusBadge>
                    {x.deadLetteredAt ? <Badge tone="danger" className="ms-1">{t("admin.workflows.deadLetter")}</Badge> : null}
                    {x.error ? <div className="max-w-80 truncate text-[11px] text-danger">{x.error}</div> : null}
                  </Td>
                  <Td className="text-xs">
                    {x.triggerType}
                    {x.isTest ? ` · ${t("admin.workflows.test")}` : ""}
                    {x.depth ? ` · ${t("admin.workflows.depth", { depth: x.depth })}` : ""}
                  </Td>
                  <Td className="text-xs tabular-nums">{x.startedAt && x.finishedAt ? `${n(Math.round((x.finishedAt.getTime() - x.startedAt.getTime()) / 1000))} s` : "—"}</Td>
                  {canManage ? (
                    <Td className="text-end">
                      <WorkflowRunActions run={x} />
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title={t("admin.ai.task.audit")} />
        {w.audit.length === 0 ? (
          <EmptyState title={t("admin.ai.task.noAudit")} />
        ) : (
          <Table>
            <TBody>
              {w.audit.map((a) => (
                <Tr key={a.id}>
                  <Td className="font-mono text-xs">{a.action}</Td>
                  <Td className="text-xs text-muted-foreground">{a.reason ?? "—"}</Td>
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
