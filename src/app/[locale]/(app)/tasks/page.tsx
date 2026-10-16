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
import { listTasks } from "@/server/modules/agents/service";
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
  const tasks = (await listTasks(viewer.ctx, org.id, company.id, { limit: 100 })).data;
  const configured = aiConfigured();

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <AutoRefresh active={tasks.some((x) => x.status === "QUEUED" || x.status === "RUNNING")} />
      {!configured ? <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice> : null}
      {canRun && configured ? <NewTaskForm organizationId={org.id} companyId={company.id} initialProfile={typeof profile === "string" ? profile : undefined} /> : null}

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
