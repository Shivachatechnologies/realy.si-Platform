import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ActionButton } from "@/components/admin/action-dialog";
import { AdminHeader, Empty, FilterBar, NextPage, guard, sp } from "@/components/admin/kit";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatNumber } from "@/i18n/format";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { AGENT_TASK_STATUSES } from "@/server/modules/agents/statuses";
import { canPlatform } from "@/server/modules/admin/access";
import { failureSummary, searchTasks } from "@/server/modules/admin/ai";
import { requireViewer } from "@/server/session";

/** AI task logs across organizations with failure list and execution control (cancel / retry). */
export default async function AdminAiTasksPage({ searchParams }: PageProps<"/[locale]/admin/ai/tasks">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const query = await searchParams;
  const params = { q: sp(query.q), status: sp(query.status), profile: sp(query.profile), org: sp(query.org), errorCode: sp(query.errorCode) };
  const r = await guard(Promise.all([searchTasks(viewer.ctx, { ...params, cursor: sp(query.cursor) }), failureSummary(viewer.ctx)]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [tasks, failures] = r.value;
  const canManage = await canPlatform(viewer.ctx, "platform.ai.manage");
  const base = `/${locale}/admin/ai/tasks`;
  const tz = viewer.user.timezone;
  return (
    <div className="grid gap-4">
      <AdminHeader title={t("admin.nav.aiTasks")} description={t("admin.ai.tasksSubtitle")} />
      {failures.length ? (
        <Card>
          <CardHeader title={t("admin.ai.failures")} description={t("admin.ai.failuresHint")} />
          <div className="flex flex-wrap gap-2 p-3">
            {failures.map((f) => (
              <Link key={f.errorCode} href={`${base}?status=FAILED&errorCode=${f.errorCode}`} className="rounded-md border px-2 py-1 text-xs hover:bg-muted">
                <span className="font-mono">{f.errorCode}</span> <span className="tabular text-danger">{formatNumber(f.count, locale)}</span>
              </Link>
            ))}
          </div>
        </Card>
      ) : null}
      <Card>
        <FilterBar
          action={base}
          q={params.q}
          qLabel={t("admin.ai.searchTasks")}
          values={params}
          submitLabel={t("admin.users.searchButton")}
          filters={[
            { name: "status", label: t("admin.ai.columns.status"), options: AGENT_TASK_STATUSES.map((s) => ({ value: s, label: t(`admin.ai.status.${s}`) })) },
            { name: "profile", label: t("admin.ai.columns.profile"), options: AGENT_PROFILES.map((p) => ({ value: p.key, label: p.key })) },
          ]}
          extra={params.org ? <input type="hidden" name="org" value={params.org} /> : null}
        />
        {tasks.data.length === 0 ? (
          <Empty>{t("admin.ai.noTasks")}</Empty>
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
                    <div className="max-w-80 truncate font-medium">{task.title}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {task.id.slice(0, 8)} · {task.profile} · {task.model ?? "—"}
                    </div>
                  </Td>
                  <Td className="text-xs">
                    <Link href={`/${locale}/admin/organizations/${task.organizationId}`} className="hover:underline">
                      {task.organizationName}
                    </Link>
                    <div className="text-muted-foreground">{task.company.name}</div>
                  </Td>
                  <Td>
                    <Badge tone={task.status === "FAILED" ? "danger" : task.status === "COMPLETED" ? "success" : task.status === "CANCELLED" ? "neutral" : "accent"}>{t(`admin.ai.status.${task.status}`)}</Badge>
                    {task.errorCode ? (
                      <div className="max-w-56 truncate font-mono text-[11px] text-danger" title={task.errorMessage ?? undefined}>
                        {task.errorCode}
                      </div>
                    ) : null}
                  </Td>
                  <Td className="tabular text-xs">{formatNumber((task.inputTokens ?? 0) + (task.outputTokens ?? 0), locale)}</Td>
                  <Td className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(task.createdAt, locale, tz)}</Td>
                  {canManage ? (
                    <Td>
                      {task.status === "QUEUED" || task.status === "RUNNING" ? (
                        <ActionButton label={t("admin.ai.cancel")} title={`${t("admin.ai.cancel")}: ${task.title}`} path={`/api/v1/admin/ai/tasks/${task.id}/cancel`} method="POST" />
                      ) : task.status === "FAILED" || task.status === "CANCELLED" ? (
                        <ActionButton label={t("admin.ai.retry")} title={`${t("admin.ai.retry")}: ${task.title}`} path={`/api/v1/admin/ai/tasks/${task.id}/retry`} method="POST" />
                      ) : null}
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
