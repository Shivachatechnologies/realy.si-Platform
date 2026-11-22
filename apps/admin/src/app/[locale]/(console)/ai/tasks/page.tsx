import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { TaskActions } from "@/components/admin/ai/ai-actions";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { Download, ListChecks, OctagonAlert, SearchX } from "lucide-react";
import { AdminHeader, EmptyState, FilterBar, NextPage, QuickFilters, guard, sp } from "@/components/admin/kit";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { capabilitiesFor } from "@/server/modules/admin/access";
import { ADMIN_TASK_STATUSES, failureSummary, searchTasks } from "@/server/modules/admin/ai";
import { requireViewer } from "@/server/session";

/** AI task logs across organizations with failure list and execution control (cancel / retry). */
export default async function AdminAiTasksPage({ searchParams }: PageProps<"/[locale]/ai/tasks">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const query = await searchParams;
  const params = { q: sp(query.q), status: sp(query.status), profile: sp(query.profile), org: sp(query.org), errorCode: sp(query.errorCode), employee: sp(query.employee) };
  const r = await guard(Promise.all([searchTasks(viewer.ctx, { ...params, cursor: sp(query.cursor) }), failureSummary(viewer.ctx)]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [tasks, failures] = r.value;
  const caps = await capabilitiesFor(viewer.ctx, ["platform.ai.manage", "platform.data.export"]);
  const canManage = caps["platform.ai.manage"];
  const base = `/${locale}/ai/tasks`;
  const exportQs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader
        icon={<ListChecks />}
        title={t("admin.nav.aiTasks")}
        description={t("admin.ai.tasksSubtitle")}
        why={t("admin.ai.tasksWhy")}
        actions={
          canManage || caps["platform.data.export"] ? (
            <Button asChild size="sm" variant="secondary">
              <a href={`/api/v1/admin/ai/tasks/export${exportQs ? `?${exportQs}` : ""}`} download>
                <Download />
                {t("admin.aiRequests.exportCsv")}
              </a>
            </Button>
          ) : null
        }
      />
      {failures.length ? (
        <Card className="border-danger/30">
          <CardHeader icon={<OctagonAlert />} title={t("admin.ai.failures")} description={t("admin.ai.failuresHint")} />
          <div className="flex flex-wrap gap-2 p-3">
            {failures.map((f) => (
              <Link
                key={f.errorCode}
                href={`${base}?status=FAILED&errorCode=${f.errorCode}`}
                aria-current={params.errorCode === f.errorCode ? "true" : undefined}
                className="inline-flex items-center gap-2 rounded-full border border-danger/30 bg-danger/6 px-3 py-1 text-xs transition-colors hover:bg-danger/12 focus-visible:outline-2 aria-[current]:border-danger"
              >
                <span className="font-mono">{f.errorCode}</span>
                <span className="font-semibold tabular-nums text-danger">{formatNumber(f.count, locale)}</span>
              </Link>
            ))}
          </div>
        </Card>
      ) : null}
      <Card>
        <QuickFilters
          base={base}
          name="status"
          value={params.status}
          params={params}
          label={t("admin.ai.columns.status")}
          options={[{ value: "", label: t("admin.common.all") }, ...(["RUNNING", "QUEUED", "WAITING_APPROVAL", "PAUSED", "FAILED", "COMPLETED"] as const).map((s) => ({ value: s, label: t(`admin.ai.status.${s}`) }))]}
        />
        <FilterBar
          action={base}
          q={params.q}
          qLabel={t("admin.ai.searchTasks")}
          values={params}
          submitLabel={t("admin.users.searchButton")}
          filters={[
            { name: "status", label: t("admin.ai.columns.status"), options: ADMIN_TASK_STATUSES.map((s) => ({ value: s, label: t(`admin.ai.status.${s}`) })) },
            { name: "profile", label: t("admin.ai.columns.profile"), options: AGENT_PROFILES.map((p) => ({ value: p.key, label: p.key })) },
          ]}
          extra={
            <>
              {params.org ? <input type="hidden" name="org" value={params.org} /> : null}
              {params.employee ? <input type="hidden" name="employee" value={params.employee} /> : null}
            </>
          }
        />
        {tasks.data.length === 0 ? (
          <EmptyState icon={<SearchX />} title={t("admin.ai.noTasks")} body={t("admin.ai.noTasksHint")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.ai.columns.task")}</Th>
                <Th>{t("admin.organizations.columns.name")}</Th>
                <Th>{t("admin.ai.columns.status")}</Th>
                <Th>{t("admin.ai.columns.tokens")}</Th>
                <Th>{t("admin.audit.time")}</Th>
                {canManage ? <Th>{t("common.actions")}</Th> : null}
              </Tr>
            </THead>
            <TBody>
              {tasks.data.map((task) => (
                <Tr key={task.id}>
                  <Td>
                    <Link href={`${base}/${task.id}`} className="block max-w-80 truncate font-medium hover:underline">
                      {task.title}
                    </Link>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {task.id.slice(0, 8)} · {task.profile} · {task.model ?? "—"}
                    </div>
                  </Td>
                  <Td className="text-xs">
                    <Link href={`/${locale}/organizations/${task.organizationId}`} className="hover:underline">
                      {task.organizationName}
                    </Link>
                    <div className="text-muted-foreground">{task.company.name}</div>
                  </Td>
                  <Td>
                    <StatusBadge domain="aiTask" value={task.status} pulse={task.status === "RUNNING"}>
                      {t(`admin.ai.status.${task.status}`)}
                    </StatusBadge>
                    {task.errorCode ? (
                      <div className="max-w-56 truncate font-mono text-[11px] text-danger" title={task.errorMessage ?? undefined}>
                        {task.errorCode}
                      </div>
                    ) : null}
                  </Td>
                  <Td className="tabular text-xs">{formatNumber((task.inputTokens ?? 0) + (task.outputTokens ?? 0), locale)}</Td>
                  <Td className="text-xs whitespace-nowrap text-muted-foreground">
                    <Timestamp value={task.createdAt} />
                  </Td>
                  {canManage ? (
                    <Td>
                      <TaskActions task={task} compact />
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <NextPage base={base} params={params} cursor={tasks.nextCursor} label={t("common.next")} />
      </Card>
    </div>
  );
}
