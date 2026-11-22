import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, CalendarClock, Lock, MemoryStick, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, Td, Tr } from "@/components/ui/table";
import { AdminHeader, Avatar, EmptyState, Facts, SectionLink, StatGrid, StatTile, guard, usd } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { CopyButton } from "@/components/admin/copy-button";
import { EmployeeAdmin } from "@/components/admin/ai/employee-admin";
import { EmployeeLifecycle, EmployeeMemoryActions, EmployeeProfileEditor } from "@/components/admin/ai/ai-actions";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { getControls } from "@/server/core/platform-controls";
import { getEmployeeDetail } from "@/server/modules/admin/ai-ops";
import { MODEL_PRICES } from "@/server/modules/workforce/pricing";
import { requireViewer } from "@/server/session";

/** One AI employee: role, model, autonomy, budgets, tasks, cost, schedules, memory, permissions and every admin control. */
export default async function AdminAiEmployeePage({ params }: PageProps<"/[locale]/ai/workforce/[employeeId]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { employeeId } = await params;
  const r = await guard(
    getEmployeeDetail(viewer.ctx, employeeId).catch((e) => {
      if (isAppError(e) && e.code === "not_found") notFound();
      throw e;
    }),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const e = r.value;
  const controls = await getControls();
  const models = Object.keys(MODEL_PRICES).filter((m) => !controls.aiDisabledModels.includes(m) && (controls.aiAllowedModels.length === 0 || controls.aiAllowedModels.includes(m)));
  const n = (v: number) => formatNumber(v, locale);
  const base = `/${locale}/ai`;
  const tasksTotal = Object.values(e.tasksMonth).reduce<number>((a, v) => a + (v ?? 0), 0);
  const req = e.requests7d.reduce((a, x) => ({ total: a.total + x.count, errors: a.errors + (["ERROR", "REFUSED", "FALLBACK"].includes(x.status) ? x.count : 0) }), { total: 0, errors: 0 });
  const status = e.archivedAt ? "ARCHIVED" : e.status;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: e.name }]} />
      <AdminHeader
        icon={<Avatar name={e.name} size="sm" square />}
        title={e.name}
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <StatusBadge domain="aiEmployee" value={status}>{t(`admin.aiWorkforce.status.${status}`)}</StatusBadge>
            <CopyButton value={e.id} showValue />
          </span>
        }
        description={`${e.jobTitle ?? e.profileKey} · ${e.organization.name} · ${e.company.name}`}
        actions={
          e.canManage ? (
            <>
              {!e.archivedAt ? (
                <EmployeeAdmin
                  models={models}
                  employee={{ id: e.id, name: e.name, model: e.model, autonomy: e.autonomy, status: e.status, monthlyTokenBudget: e.monthlyTokenBudget, monthlyCostBudgetCents: e.monthlyCostBudgetCents, allowedTools: e.allowedTools, profileTools: e.profileTools }}
                />
              ) : null}
              {!e.archivedAt && e.content ? <EmployeeProfileEditor employee={{ id: e.id, name: e.name, instructions: e.instructions, jobTitle: e.jobTitle, managerEmployeeId: e.manager?.id ?? null, skills: e.skills }} peers={e.peers} /> : null}
              <EmployeeLifecycle employee={{ id: e.id, name: e.name, archived: !!e.archivedAt }} />
            </>
          ) : null
        }
      />
      {e.archivedAt ? <Notice tone="warning" title={t("admin.aiWorkforce.disabledTitle")}>{t("admin.aiWorkforce.disabledBody")}</Notice> : null}
      <StatGrid>
        <StatTile icon={<Bot />} label={t("admin.aiWorkforce.tasksMonth")} value={n(tasksTotal)} hint={t("admin.aiWorkforce.tasksMonthHint", { completed: n(e.tasksMonth.COMPLETED ?? 0), failed: n(e.tasksMonth.FAILED ?? 0) })} href={`${base}/tasks?employee=${e.id}`} tone={e.tasksMonth.FAILED ? "warning" : undefined} />
        <StatTile label={t("admin.aiWorkforce.costMonth")} value={usd(e.costMonth.micros, locale)} hint={e.monthlyCostBudgetCents ? t("admin.aiWorkforce.ofBudget", { budget: usd(Number(e.monthlyCostBudgetCents) * 10_000, locale) }) : t("admin.aiWorkforce.noCostBudget")} />
        <StatTile label={t("admin.aiWorkforce.tokensMonth")} value={n(e.costMonth.tokens)} hint={e.monthlyTokenBudget ? t("admin.aiWorkforce.ofTokens", { budget: n(e.monthlyTokenBudget) }) : t("admin.aiWorkforce.noTokenBudget")} />
        <StatTile label={t("admin.aiWorkforce.requests7d")} value={n(req.total)} hint={t("admin.aiWorkforce.requestErrors", { count: req.errors })} href={`${base}/requests?employee=${e.id}&window=7d`} tone={req.errors ? "warning" : undefined} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.aiWorkforce.profile")} />
          <Facts
            rows={[
              [t("admin.organizations.columns.name"), <Link key="o" className="hover:underline" href={`/${locale}/organizations/${e.organization.id}`}>{e.organization.name}</Link>],
              [t("admin.ai.task.company"), e.company.name],
              [t("admin.ai.columns.profile"), <span key="p" className="font-mono">{e.profileKey}</span>],
              [t("admin.aiWorkforce.department"), e.department],
              [t("admin.aiWorkforce.level"), e.level],
              [t("admin.aiWorkforce.autonomy"), <span key="a" className="font-mono text-xs">{e.autonomy}</span>],
              [t("admin.aiModels.model"), <span key="m" className="font-mono text-xs">{e.model ?? t("admin.aiModels.platformDefault")}</span>],
              [t("admin.aiWorkforce.manager"), e.manager ? <Link key="mg" className="hover:underline" href={`${base}/workforce/${e.manager.id}`}>{e.manager.name}</Link> : e.managerUserId ? t("admin.aiWorkforce.reportsToPerson") : "—"],
              [t("admin.aiWorkforce.runsAs"), e.runsAs ? (e.runsAs.name ?? e.runsAs.email ?? e.runsAs.id.slice(0, 8)) : t("admin.aiWorkforce.runsAsRequester")],
              [t("admin.aiWorkforce.skills"), e.skills.join(", ") || "—"],
              [t("admin.aiWorkforce.created"), <Timestamp key="c" value={e.createdAt} />],
              [t("admin.aiWorkforce.evaluated"), e.lastEvaluatedAt ? <Timestamp key="ev" value={e.lastEvaluatedAt} /> : "—"],
            ]}
          />
        </Card>
        <Card>
          <CardHeader icon={<ShieldCheck />} title={t("admin.aiWorkforce.permissions")} description={t("admin.aiWorkforce.permissionsHint")} />
          <CardBody className="grid gap-3 text-xs">
            <div>
              <p className="font-medium">{t("admin.aiWorkforce.tools")}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {(e.allowedTools.length ? e.allowedTools : e.profileTools).map((tool) => (
                  <Badge key={tool} className="font-mono">
                    {tool}
                  </Badge>
                ))}
              </div>
              <p className="mt-1 text-muted-foreground">{e.allowedTools.length ? t("admin.aiWorkforce.toolsSubset", { count: e.allowedTools.length, of: e.profileTools.length }) : t("admin.aiWorkforce.toolsAll", { count: e.profileTools.length })}</p>
            </div>
            <div>
              <p className="font-medium">{t("admin.aiWorkforce.roleAssignments")}</p>
              {e.roleAssignments.length === 0 ? (
                <p className="text-muted-foreground">{t("admin.aiWorkforce.noRoleAssignments")}</p>
              ) : (
                <ul className="mt-1 grid gap-1">
                  {e.roleAssignments.map((ra) => (
                    <li key={ra.id} className="font-mono">
                      {ra.role.key} · {ra.scopeType}:{ra.scopeId.slice(0, 8)}
                      {ra.expiresAt ? ` · ${t("admin.aiWorkforce.expires")} ${ra.expiresAt.toISOString().slice(0, 10)}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title={t("admin.aiWorkforce.instructions")} description={e.roleProfile ? t("admin.aiWorkforce.customRole", { name: e.roleProfile.name }) : t("admin.aiWorkforce.builtInRole")} />
        <CardBody>
          {e.content ? (
            e.instructions ? <pre className="max-h-64 overflow-auto rounded-md bg-surface-2 p-3 text-xs whitespace-pre-wrap">{e.instructions}</pre> : <p className="text-xs text-muted-foreground">{t("admin.aiWorkforce.noInstructions")}</p>
          ) : (
            <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="size-3" />
              {t("admin.aiWorkforce.contentHidden", { count: e.instructionsLength })}
            </p>
          )}
        </CardBody>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.aiWorkforce.recentTasks")} actions={<SectionLink href={`${base}/tasks?employee=${e.id}`}>{t("admin.overview.viewAll")}</SectionLink>} />
          {e.recentTasks.length === 0 ? (
            <EmptyState title={t("admin.ai.noTasks")} />
          ) : (
            <Table>
              <TBody>
                {e.recentTasks.map((task) => (
                  <Tr key={task.id}>
                    <Td>
                      <Link className="block max-w-72 truncate text-sm hover:underline" href={`${base}/tasks/${task.id}`}>
                        {task.title}
                      </Link>
                      <div className="text-[11px] text-muted-foreground">
                        <Timestamp value={task.createdAt} mode="relative" />
                      </div>
                    </Td>
                    <Td>
                      <StatusBadge domain="aiTask" value={task.status}>{t(`admin.ai.status.${task.status}`)}</StatusBadge>
                      {task.errorCode ? <div className="font-mono text-[11px] text-danger">{task.errorCode}</div> : null}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader icon={<CalendarClock />} title={t("admin.aiWorkforce.schedules")} />
          {e.schedules.length === 0 ? (
            <EmptyState title={t("admin.aiWorkforce.noSchedules")} />
          ) : (
            <Table>
              <TBody>
                {e.schedules.map((s) => (
                  <Tr key={s.id}>
                    <Td>
                      <div className="text-sm">{s.name}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{s.kind === "EVENT" ? s.eventType : `${s.frequency ?? ""} ${s.timeOfDay ?? ""}`}</div>
                    </Td>
                    <Td>{s.enabled ? <Badge tone="success">{t("admin.aiModels.enabled")}</Badge> : <Badge>{t("admin.aiModels.disabled")}</Badge>}</Td>
                    <Td className="text-xs">
                      {t("admin.aiWorkforce.runs", { count: s.runCount })}
                      {s.lastRunAt ? (
                        <div className="text-muted-foreground">
                          <Timestamp value={s.lastRunAt} mode="relative" />
                        </div>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader icon={<MemoryStick />} title={t("admin.aiWorkforce.memory")} description={t("admin.aiWorkforce.memoryHint", { count: e.memory.count })} actions={e.canManage && e.memory.count ? <EmployeeMemoryActions employeeId={e.id} /> : null} />
        {e.memory.items.length === 0 ? (
          <EmptyState title={t("admin.aiWorkforce.noMemory")} />
        ) : (
          <Table>
            <TBody>
              {e.memory.items.map((m) => (
                <Tr key={m.id}>
                  <Td className="max-w-xl text-xs">
                    {m.content ?? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Lock className="size-3" />
                        {t("admin.aiRequests.sensitiveHidden")}
                      </span>
                    )}
                  </Td>
                  <Td className="text-xs">
                    {m.pinned ? <Badge tone="accent">{t("admin.aiWorkforce.pinned")}</Badge> : null} <span className="text-muted-foreground">{m.source}</span>
                    {m.sourceTaskId ? (
                      <Link className="ms-1 text-primary hover:underline" href={`${base}/tasks/${m.sourceTaskId}`}>
                        {t("admin.aiRequests.task")}
                      </Link>
                    ) : null}
                  </Td>
                  <Td className="text-xs">
                    <Timestamp value={m.createdAt} mode="relative" />
                  </Td>
                  <Td className="text-end">{e.canManage ? <EmployeeMemoryActions employeeId={e.id} memoryId={m.id} /> : null}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {e.reports.length ? (
        <Card>
          <CardHeader title={t("admin.aiWorkforce.reports")} />
          <CardBody className="flex flex-wrap gap-2 text-xs">
            {e.reports.map((x) => (
              <Link key={x.id} className="rounded border px-2 py-1 hover:bg-muted" href={`${base}/workforce/${x.id}`}>
                {x.name}
              </Link>
            ))}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
