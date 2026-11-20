import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkflowBuilder, type BuilderOptions } from "@/components/automation/builder";
import { RUN_TONE, WORKFLOW_TONE, workflowsPage } from "@/components/automation/frame";
import { AiDraftForm, TestRunDialog, WorkflowSettingsForm, WorkflowStatusControls } from "@/components/automation/workflow-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { getWorkflow, listRuns } from "@/server/modules/automation/service";
import { emailConfigured } from "@/server/modules/email/service";
import { can } from "@/server/modules/rbac/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.workflows.title") };
}

const TASK_TONE = { QUEUED: "neutral", RUNNING: "accent", COMPLETED: "success", FAILED: "danger", CANCELLED: "neutral" } as const;
const NOTIFY_PERMISSIONS = [
  "sales.read",
  "sales.manage",
  "marketing.manage",
  "support.read",
  "support.manage",
  "finance.read",
  "finance.manage",
  "hr.read",
  "hr.manage",
  "projects.read",
  "projects.manage",
  "operations.manage",
  "workflows.execute",
  "approvals.decide",
];

export default async function WorkflowPage({ params }: PageProps<"/[locale]/workflows/[workflowId]">) {
  const { workflowId } = await params;
  const p = await workflowsPage(null);
  if (p.page) return p.page;
  const { locale, t, viewer, org, company, chain, canManage, canExecute, tz, base } = p.ctx;
  const wf = await getWorkflow(viewer.ctx, org.id, company.id, workflowId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const canRunAgents = await can(viewer.ctx, "agents.read", chain);
  const [members, hooks, connections, runs, aiTasks] = await Promise.all([
    db().membership.findMany({ where: { organizationId: org.id, status: "ACTIVE", user: { status: "ACTIVE" } }, select: { user: { select: { id: true, name: true } } }, orderBy: { user: { name: "asc" } } }),
    db().integrationHook.findMany({ where: { organizationId: org.id, companyId: company.id }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } }),
    db().integrationConnection.findMany({ where: { organizationId: org.id, companyId: company.id, status: { in: ["CONNECTED", "ERROR"] }, provider: { in: ["slack", "custom_api"] } }, select: { provider: true } }),
    listRuns(viewer.ctx, org.id, company.id, { workflowId: wf.id }, 10),
    canRunAgents ? listSubjectTasks(viewer.ctx, org.id, company.id, "workflow", wf.id, 5) : Promise.resolve([]),
  ]);
  const label = (key: string, fallback: string) => {
    const v = t(key);
    return v === key ? fallback : v;
  };
  const opts: BuilderOptions = {
    users: members.map((m) => m.user),
    profiles: AGENT_PROFILES.map((x) => ({ key: x.key, name: label(`profiles.${x.key}.name`, x.key) })),
    hooks,
    permissions: NOTIFY_PERMISSIONS,
    connected: { slack: connections.some((c) => c.provider === "slack"), custom_api: connections.some((c) => c.provider === "custom_api"), email: emailConfigured() },
  };
  const sampleKeys = wf.draft.trigger.type === "event" && wf.draft.trigger.event.startsWith("lead.") ? ["name", "email", "ownerId", "stage", "source"] : ["name", "email"];
  const archived = wf.status === "ARCHIVED";
  const back = (
    <Link href={`/${locale}/workflows`} className="text-sm text-muted-foreground hover:underline">
      ← {t("workflows.tabs.workflows")}
    </Link>
  );
  return p.render(
    <>
      {back}
      <div className="grid gap-1">
        <h2 className="text-base font-semibold">{wf.name}</h2>
        {wf.description ? <p className="text-sm text-muted-foreground">{wf.description}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={WORKFLOW_TONE[wf.status]}>{t(`workflows.status.${wf.status}`)}</Badge>
        <span className="text-sm text-muted-foreground">{wf.currentVersion ? t("workflows.publishedVersion", { version: wf.currentVersion }) : t("workflows.unpublished")}</span>
        <span className="text-sm text-muted-foreground">· {t("workflows.ownedBy", { name: wf.owner?.name ?? "—" })}</span>
        <div className="ms-auto flex flex-wrap gap-2">
          {canExecute && !archived ? <TestRunDialog base={base} locale={locale} workflowId={wf.id} sampleKeys={sampleKeys} hasPublished={!!wf.currentVersionId} /> : null}
          {canManage ? <WorkflowStatusControls base={base} workflowId={wf.id} status={wf.status} published={!!wf.currentVersionId} /> : null}
        </div>
      </div>
      {archived ? <Notice tone="warning">{t("workflows.archivedNotice")}</Notice> : null}
      {wf.status === "DRAFT" && wf.currentVersionId ? <Notice>{t("workflows.enableHint")}</Notice> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <WorkflowBuilder base={base} workflowId={wf.id} initial={wf.draft} opts={opts} canManage={canManage && !archived} publishedVersion={wf.currentVersion} />
        </div>
        <div className="grid content-start gap-4">
          {canManage && !archived ? (
            <Card>
              <CardHeader title={t("workflows.ai.title")} description={t("workflows.ai.description")} />
              <CardBody className="grid gap-3">
                {aiConfigured() ? <AiDraftForm base={base} locale={locale} workflowId={wf.id} /> : <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice>}
                {aiTasks.length ? (
                  <ul className="grid gap-1 text-sm">
                    {aiTasks.map((task) => (
                      <li key={task.id} className="flex items-center gap-2">
                        <Badge tone={TASK_TONE[task.status]}>{t(`agentTasks.status.${task.status}`)}</Badge>
                        <Link href={`/${locale}/tasks/${task.id}`} className="truncate hover:underline">
                          {task.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t("workflows.recentRuns")} actions={<Link href={`/${locale}/workflows/runs?workflow=${wf.id}`} className="text-xs text-primary hover:underline">{t("workflows.viewAll")}</Link>} />
            {runs.data.length ? (
              <ul className="divide-y">
                {runs.data.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                    <Badge tone={RUN_TONE[r.status]}>{t(`workflows.runStatus.${r.status}`)}</Badge>
                    <Link href={`/${locale}/workflows/runs/${r.id}`} className="hover:underline">
                      {formatDateTime(r.createdAt, locale, tz)}
                    </Link>
                    {r.isTest ? <Badge>{t("workflows.runs.test")}</Badge> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("workflows.runs.empty")}</p>
            )}
          </Card>
          <Card>
            <CardHeader title={t("workflows.versions")} />
            {wf.versions.length ? (
              <ul className="divide-y">
                {wf.versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span className="font-medium">v{v.version}</span>
                    {v.id === wf.currentVersionId ? <Badge tone="success">{t("workflows.current")}</Badge> : null}
                    <span className="text-xs text-muted-foreground">{formatDateTime(v.createdAt, locale, tz)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("workflows.noVersions")}</p>
            )}
          </Card>
          {canManage && !archived ? (
            <Card>
              <CardHeader title={t("workflows.settings")} />
              <WorkflowSettingsForm base={base} workflowId={wf.id} name={wf.name} description={wf.description ?? ""} ownerId={wf.ownerId} users={opts.users} />
            </Card>
          ) : null}
        </div>
      </div>
    </>,
    true,
  );
}
