import Link from "next/link";
import { SearchX, Workflow } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, FilterBar, NextPage, QuickFilters, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { listWorkflowRunsAdmin, listWorkflowsAdmin, WORKFLOW_STATUSES } from "@/server/modules/admin/workflows-admin";
import { requireViewer } from "@/server/session";

/** Global workflows admin: every organization's workflows with 30-day run health, and the recent run explorer. */
export default async function AdminWorkflowsPage({ searchParams }: PageProps<"/[locale]/workflows">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const params = { q: sp(q.q), org: sp(q.org), status: sp(q.status), trigger: sp(q.trigger) };
  const runStatus = sp(q.runStatus);
  const r = await guard(Promise.all([listWorkflowsAdmin(viewer.ctx, { ...params, cursor: sp(q.cursor) }), listWorkflowRunsAdmin(viewer.ctx, { status: runStatus, org: params.org, cursor: sp(q.runCursor) })]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [w, runs] = r.value;
  const n = (v: number) => formatNumber(v, locale);
  const base = `/${locale}/workflows`;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader icon={<Workflow />} title={t("admin.workflows.title")} description={t("admin.workflows.subtitle")} why={t("admin.workflows.why")} />
      {!w.automationsEnabled ? (
        <Notice tone="danger" title={t("admin.workflows.killSwitchTitle")} action={<Link className="text-sm text-primary hover:underline" href={`/${locale}/controls`}>{t("admin.nav.controls")}</Link>}>
          {t("admin.workflows.killSwitchBody")}
        </Notice>
      ) : null}
      <StatGrid>
        {(["ACTIVE", "PAUSED", "DRAFT", "ARCHIVED"] as const).map((s) => (
          <StatTile key={s} label={t(`admin.workflows.status.${s}`)} value={n(w.counts[s] ?? 0)} href={`${base}?status=${s}`} />
        ))}
      </StatGrid>
      <Card>
        <QuickFilters base={base} name="status" value={params.status} params={params} label={t("admin.ai.columns.status")} options={[{ value: "", label: t("admin.common.all") }, ...WORKFLOW_STATUSES.map((s) => ({ value: s, label: t(`admin.workflows.status.${s}`), count: w.counts[s] ?? 0 }))]} />
        <FilterBar
          action={base}
          q={params.q}
          qLabel={t("admin.workflows.search")}
          values={params}
          submitLabel={t("admin.users.searchButton")}
          filters={[{ name: "trigger", label: t("admin.workflows.trigger"), options: (["event", "schedule", "webhook", "manual"] as const).map((x) => ({ value: x, label: t(`admin.workflows.triggers.${x}`) })) }]}
          extra={
            <>
              {params.status ? <input type="hidden" name="status" value={params.status} /> : null}
              {params.org ? <input type="hidden" name="org" value={params.org} /> : null}
            </>
          }
        />
        {w.data.length === 0 ? (
          <EmptyState icon={<SearchX />} title={t("admin.workflows.empty")} body={t("admin.common.tryOtherFilters")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.workflows.workflow")}</Th>
                <Th>{t("admin.organizations.columns.name")}</Th>
                <Th>{t("admin.ai.columns.status")}</Th>
                <Th>{t("admin.workflows.trigger")}</Th>
                <Th>{t("admin.workflows.autonomy")}</Th>
                <Th>{t("admin.workflows.runs30d")}</Th>
                <Th>{t("admin.workflows.successRate")}</Th>
                <Th>{t("admin.workflows.lastRun")}</Th>
              </Tr>
            </THead>
            <TBody>
              {w.data.map((x) => (
                <Tr key={x.id}>
                  <Td>
                    <Link href={`${base}/${x.id}`} className="font-medium hover:underline">
                      {x.name}
                    </Link>
                    <div className="text-[11px] text-muted-foreground">v{x.currentVersion}</div>
                  </Td>
                  <Td className="text-xs">
                    <Link className="hover:underline" href={`${base}?org=${x.organizationId}`}>
                      {x.organizationName}
                    </Link>
                    <div className="text-muted-foreground">{x.companyName}</div>
                  </Td>
                  <Td>
                    <StatusBadge domain="workflow" value={x.status}>{t(`admin.workflows.status.${x.status}`)}</StatusBadge>
                  </Td>
                  <Td className="text-xs">{x.triggerType ? t(`admin.workflows.triggers.${x.triggerType}`) : "—"}</Td>
                  <Td className="font-mono text-[11px]">{x.autonomyMode}</Td>
                  <Td className="text-xs tabular-nums">
                    {n(x.runs30d)}
                    {x.failed30d ? <span className="text-danger"> · {t("admin.workflows.failedN", { count: x.failed30d })}</span> : null}
                  </Td>
                  <Td className={x.successRate !== null && x.successRate < 0.9 ? "text-xs text-danger tabular-nums" : "text-xs tabular-nums"}>{x.successRate === null ? "—" : `${Math.round(x.successRate * 100)}%`}</Td>
                  <Td className="text-xs">
                    {x.lastRun ? (
                      <>
                        <Timestamp value={x.lastRun.at} mode="relative" />
                        <div>
                          <StatusBadge domain="workflowRun" value={x.lastRun.status}>{t(`admin.workflows.runStatus.${x.lastRun.status}`)}</StatusBadge>
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <NextPage base={base} params={params} cursor={w.nextCursor} label={t("common.next")} />
      </Card>
      <Card>
        <CardHeader title={t("admin.workflows.recentRuns")} description={t("admin.workflows.recentRunsHint")} />
        <QuickFilters base={base} name="runStatus" value={runStatus} params={params} label={t("admin.ai.columns.status")} options={[{ value: "", label: t("admin.common.all") }, ...(["FAILED", "WAITING", "RUNNING", "QUEUED", "SUCCEEDED", "CANCELLED"] as const).map((s) => ({ value: s, label: t(`admin.workflows.runStatus.${s}`) }))]} />
        {runs.data.length === 0 ? (
          <EmptyState title={t("admin.workflows.noRuns")} />
        ) : (
          <Table>
            <TBody>
              {runs.data.map((x) => (
                <Tr key={x.id}>
                  <Td className="text-xs">
                    <Link className="hover:underline" href={`${base}/runs/${x.id}`}>
                      <Timestamp value={x.createdAt} mode="relative" />
                    </Link>
                  </Td>
                  <Td>
                    <Link className="text-sm hover:underline" href={`${base}/${x.workflow.id}`}>
                      {x.workflow.name}
                    </Link>
                    <div className="text-[11px] text-muted-foreground">
                      {x.organizationName} · {x.triggerType}
                      {x.isTest ? ` · ${t("admin.workflows.test")}` : ""}
                    </div>
                  </Td>
                  <Td>
                    <StatusBadge domain="workflowRun" value={x.status}>{t(`admin.workflows.runStatus.${x.status}`)}</StatusBadge>
                    {x.error ? <div className="max-w-72 truncate text-[11px] text-danger">{x.error}</div> : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        {runs.nextCursor ? (
          <div className="flex justify-end border-t p-3">
            <Link className="text-xs font-medium text-primary hover:underline" href={`${base}?${new URLSearchParams(Object.entries({ ...params, runStatus, runCursor: runs.nextCursor }).filter((e): e is [string, string] => !!e[1]))}`}>
              {t("common.next")}
            </Link>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
