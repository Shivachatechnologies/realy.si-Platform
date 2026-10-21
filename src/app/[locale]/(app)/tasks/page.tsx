import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { NewTaskForm } from "@/components/agents/new-task-form";
import { TaskStatusBadge } from "@/components/agents/status-badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { aiUsageToday, listTasks } from "@/server/modules/agents/service";
import { listObjectives } from "@/server/modules/objectives/service";
import { formatNumber } from "@/i18n/format";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.tasks.title") };
}

export default async function TasksPage({ searchParams }: PageProps<"/[locale]/tasks">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const { profile } = await searchParams;

  const header = (
    <div className="grid gap-1">
      <h1 className="text-lg font-semibold tracking-tight">{t("modules.tasks.title")}</h1>
      <p className="text-muted-foreground">{t("agentTasks.subtitle", { company: company?.name ?? "—" })}</p>
    </div>
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
  const [tasks, usage, objectives] = await Promise.all([
    listTasks(viewer.ctx, org.id, company.id, { limit: 100 }).then((p) => p.data),
    aiUsageToday(org.id, company.id),
    can(viewer.ctx, "objectives.read", chain).then((ok) => (ok ? listObjectives(viewer.ctx, org.id, company.id) : [])),
  ]);
  const configured = aiConfigured();
  const milestoneLabel = new Map(objectives.flatMap((o) => o.milestones.map((m) => [m.id, `${o.title} — ${m.title}`] as const)));
  const openMilestones = objectives
    .filter((o) => o.status === "ACTIVE")
    .flatMap((o) => o.milestones.filter((m) => !m.completedAt).map((m) => ({ id: m.id, label: `${o.title} — ${m.title}` })));

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <AutoRefresh active={tasks.some((x) => x.status === "QUEUED" || x.status === "RUNNING")} />
      {!configured ? <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice> : null}
      {usage.exhausted ? <Notice tone="warning">{t("agentTasks.budgetExhausted")}</Notice> : null}
      {canRun && configured && !usage.exhausted ? (
        <NewTaskForm organizationId={org.id} companyId={company.id} initialProfile={typeof profile === "string" ? profile : undefined} milestones={openMilestones} />
      ) : null}
      <p className="text-xs text-muted-foreground">
        {usage.limit
          ? t("agentTasks.usageToday", { used: formatNumber(usage.used, locale), limit: formatNumber(usage.limit, locale) })
          : t("agentTasks.usageTodayUnlimited", { used: formatNumber(usage.used, locale) })}
      </p>

      <Card>
        <CardHeader title={t("agentTasks.list")} description={t("agentTasks.count", { count: tasks.length })} />
        {tasks.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("agentTasks.empty")}</p>
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
              {tasks.map((x) => (
                <Tr key={x.id}>
                  <Td className="font-medium">
                    <Link className="hover:underline" href={`/${locale}/tasks/${x.id}`}>
                      {x.title}
                    </Link>
                    {x.milestoneId && milestoneLabel.has(x.milestoneId) ? <div className="text-xs font-normal text-muted-foreground">{milestoneLabel.get(x.milestoneId)}</div> : null}
                  </Td>
                  <Td>{t(`profiles.${x.profile}.name`)}</Td>
                  <Td>
                    <TaskStatusBadge status={x.status} label={t(`agentTasks.status.${x.status}`)} />
                  </Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatDateTime(x.createdAt, locale, viewer.user.timezone)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
