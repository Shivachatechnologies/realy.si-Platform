import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { NewTaskForm } from "@/components/agents/new-task-form";
import { TaskStatusBadge } from "@/components/agents/status-badge";
import { AiAvatar } from "@/components/workforce/avatar";
import { Pager, qs } from "@/components/workforce/states";
import { WorkforceTabs } from "@/components/workforce/workforce-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { aiUsageToday, listTasks, taskFilters } from "@/server/modules/agents/service";
import { AGENT_TASK_STATUSES } from "@/server/modules/agents/statuses";
import { listObjectives } from "@/server/modules/objectives/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { listEmployees } from "@/server/modules/workforce/service";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.tasks.title") };
}

const PAGE = 50;

export default async function TasksPage({ searchParams }: PageProps<"/[locale]/tasks">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;

  const header = (
    <>
      <div className="grid gap-1">
        <h1 className="text-lg font-semibold tracking-tight">{t("modules.tasks.title")}</h1>
        <p className="text-muted-foreground">{t("agentTasks.subtitle", { company: company?.name ?? "—" })}</p>
      </div>
      <WorkforceTabs locale={locale} active="tasks" labels={{ employees: t("workforce.tabs.employees"), hire: t("workforce.tabs.hire"), usage: t("workforce.tabs.usage"), plans: t("workforce.tabs.plans"), tasks: t("workforce.tabs.tasks") }} />
    </>
  );
  if (!company) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      </div>
    );
  }

  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canRun] = await Promise.all([can(viewer.ctx, "agents.read", chain), can(viewer.ctx, "agents.run", chain)]);
  if (!canRead) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </div>
    );
  }
  const filters = taskFilters.parse({ ...sp, aiEmployeeId: sp.employee });
  const [page, usage, objectives, employees] = await Promise.all([
    listTasks(viewer.ctx, org.id, company.id, { ...filters, limit: PAGE, cursor: sp.cursor }),
    aiUsageToday(org.id, company.id),
    can(viewer.ctx, "objectives.read", chain).then((ok) => (ok ? listObjectives(viewer.ctx, org.id, company.id) : [])),
    listEmployees(viewer.ctx, org.id, company.id),
  ]);
  const tasks = page.data;
  const configured = aiConfigured();
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const milestoneLabel = new Map(objectives.flatMap((o) => o.milestones.map((m) => [m.id, `${o.title} — ${m.title}`] as const)));
  const openMilestones = objectives
    .filter((o) => o.status === "ACTIVE")
    .flatMap((o) => o.milestones.filter((m) => !m.completedAt).map((m) => ({ id: m.id, label: `${o.title} — ${m.title}` })));
  const subjectTypes = (await db().agentTask.groupBy({ by: ["subjectType"], where: { organizationId: org.id, companyId: company.id, subjectType: { not: null } }, orderBy: { subjectType: "asc" }, take: 50 })).map((r) => r.subjectType!).sort();
  const filterParams = { employee: filters.aiEmployeeId, status: filters.status, profile: filters.profile, subjectType: filters.subjectType, q: filters.q };
  const filtered = Object.values(filterParams).some(Boolean);
  const label = (key: string, fallback: string) => (t(key) === key ? fallback : t(key));

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <AutoRefresh active={tasks.some((x) => x.status === "QUEUED" || x.status === "RUNNING")} />
      {!configured ? <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice> : null}
      {usage.exhausted ? <Notice tone="warning">{t("agentTasks.budgetExhausted")}</Notice> : null}
      {canRun && configured && !usage.exhausted ? (
        <NewTaskForm
          organizationId={org.id}
          companyId={company.id}
          initialProfile={sp.profile}
          milestones={openMilestones}
          employees={employees.filter((e) => e.status === "ACTIVE").map((e) => ({ id: e.id, name: e.name }))}
          initialEmployeeId={sp.employee}
        />
      ) : null}
      <p className="text-xs text-muted-foreground">
        {usage.limit
          ? t("agentTasks.usageToday", { used: formatNumber(usage.used, locale), limit: formatNumber(usage.limit, locale) })
          : t("agentTasks.usageTodayUnlimited", { used: formatNumber(usage.used, locale) })}
      </p>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("agentTasks.filters.search")}
          <Input name="q" defaultValue={filters.q ?? ""} className="h-8 w-48" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("agentTasks.columns.employee")}
          <Select name="employee" defaultValue={filters.aiEmployeeId ?? ""} className="h-8 w-44">
            <option value="">{t("common.all")}</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("agentTasks.profile")}
          <Select name="profile" defaultValue={filters.profile ?? ""} className="h-8 w-44">
            <option value="">{t("common.all")}</option>
            {AGENT_PROFILES.map((p) => (
              <option key={p.key} value={p.key}>
                {t(`profiles.${p.key}.name`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("agentTasks.columns.status")}
          <Select name="status" defaultValue={filters.status ?? ""} className="h-8 w-36">
            <option value="">{t("common.all")}</option>
            {AGENT_TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`agentTasks.status.${s}`)}
              </option>
            ))}
          </Select>
        </label>
        {subjectTypes.length ? (
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("agentTasks.filters.subject")}
            <Select name="subjectType" defaultValue={filters.subjectType ?? ""} className="h-8 w-40">
              <option value="">{t("common.all")}</option>
              {subjectTypes.map((s) => (
                <option key={s} value={s}>
                  {label(`agentTasks.subjects.${s}`, s.replace(/_/g, " "))}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <Button type="submit" size="sm" variant="secondary">
          {t("workforce.filters.apply")}
        </Button>
        {filtered ? (
          <Link href={`/${locale}/tasks`} className="text-sm text-muted-foreground hover:underline">
            {t("workforce.filters.clear")}
          </Link>
        ) : null}
      </form>

      <Card>
        <CardHeader title={t("agentTasks.list")} description={t("agentTasks.count", { count: tasks.length })} />
        {tasks.length === 0 ? (
          <p className="p-4 text-muted-foreground">{filtered ? t("common.noResults") : t("agentTasks.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("agentTasks.columns.title")}</Th>
                <Th>{t("agentTasks.columns.employee")}</Th>
                <Th>{t("agentTasks.columns.status")}</Th>
                <Th>{t("agentTasks.columns.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {tasks.map((x) => {
                const emp = x.aiEmployeeId ? employeeById.get(x.aiEmployeeId) : undefined;
                return (
                  <Tr key={x.id}>
                    <Td className="font-medium">
                      <Link className="hover:underline" href={`/${locale}/tasks/${x.id}`}>
                        {x.title}
                      </Link>
                      <div className="flex flex-wrap gap-1 text-xs font-normal text-muted-foreground">
                        {x.milestoneId && milestoneLabel.has(x.milestoneId) ? <span>{milestoneLabel.get(x.milestoneId)}</span> : null}
                        {x.parentTaskId ? <Badge>{t("workforce.queue.delegated")}</Badge> : null}
                        {x.subjectType ? <Badge>{label(`agentTasks.subjects.${x.subjectType}`, x.subjectType.replace(/_/g, " "))}</Badge> : null}
                      </div>
                    </Td>
                    <Td>
                      {emp ? (
                        <Link href={`/${locale}/workforce/${emp.id}`} className="flex items-center gap-2 hover:underline">
                          <AiAvatar id={emp.id} initials={emp.initials} size="sm" paused={emp.status === "PAUSED"} />
                          <span className="grid">
                            <span>{emp.name}</span>
                            <span className="text-xs text-muted-foreground">{t(`profiles.${x.profile}.name`)}</span>
                          </span>
                        </Link>
                      ) : (
                        t(`profiles.${x.profile}.name`)
                      )}
                    </Td>
                    <Td>
                      <TaskStatusBadge status={x.status} label={t(`agentTasks.status.${x.status}`)} />
                    </Td>
                    <Td className="whitespace-nowrap text-muted-foreground">{formatDateTime(x.createdAt, locale, viewer.user.timezone)}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
        <Pager
          prevHref={sp.cursor ? `/${locale}/tasks${qs(filterParams)}` : null}
          nextHref={page.nextCursor ? `/${locale}/tasks${qs({ ...filterParams, cursor: page.nextCursor })}` : null}
          labels={{ previous: t("agentTasks.firstPage"), next: t("common.next") }}
        />
      </Card>
    </div>
  );
}
