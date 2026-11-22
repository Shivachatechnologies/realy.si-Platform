import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RUN_TONE, workflowsPage } from "@/components/automation/frame";
import { duration } from "@/components/automation/labels";
import { DeadLetterActions, RerunFromStep, RunControls } from "@/components/automation/workflow-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { flattenSteps } from "@/server/modules/automation/definition";
import { getRun } from "@/server/modules/automation/service";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { can } from "@/server/modules/rbac/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workflows.runs.title") };
}

const STEP_TONE = { RUNNING: "accent", WAITING: "warning", SUCCEEDED: "success", FAILED: "danger", SKIPPED: "neutral" } as const;
const TASK_TONE = { QUEUED: "neutral", RUNNING: "accent", COMPLETED: "success", FAILED: "danger", CANCELLED: "neutral", WAITING_APPROVAL: "warning" } as const;

function Json({ value }: { value: unknown }) {
  return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

export default async function RunPage({ params }: PageProps<"/[locale]/workflows/runs/[runId]">) {
  const { runId } = await params;
  const p = await workflowsPage("runs");
  if (p.page) return p.page;
  const { locale, t, viewer, org, company, chain, canExecute, tz, base } = p.ctx;
  const run = await getRun(viewer.ctx, org.id, company.id, runId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const aiTasks = (await can(viewer.ctx, "agents.read", chain)) ? await listSubjectTasks(viewer.ctx, org.id, company.id, "workflow_run", run.id, 10) : [];
  const order = new Map(flattenSteps(run.definition.steps).map((s, i) => [s.id, i]));
  const steps = [...run.steps].sort((a, b) => (order.get(a.stepId) ?? 999) - (order.get(b.stepId) ?? 999) || a.startedAt.getTime() - b.startedAt.getTime());
  const event = (run.triggerData as { event?: Record<string, unknown> }).event ?? {};
  const pendingApproval = run.approvals.find((a) => a.status === "PENDING");
  const finished = ["FAILED", "CANCELLED", "SUCCEEDED"].includes(run.status);
  const flat = flattenSteps(run.definition.steps);
  const stepLabel = (id: string) => {
    const def = flat.find((x) => x.id === id);
    return def ? `${id} · ${def.type === "action" ? t(`workflows.builder.actions.${def.action.kind}`) : t(`workflows.builder.stepTypes.${def.type}`)}` : id;
  };
  const failedStep = steps.find((s) => s.status === "FAILED")?.stepId;
  // Timeline: each step's offset and length relative to the whole run.
  const t0 = run.startedAt?.getTime() ?? run.createdAt.getTime();
  const t1 = Math.max(t0 + 1, ...steps.map((s) => (s.finishedAt ?? new Date()).getTime()), run.finishedAt?.getTime() ?? 0);
  const span = t1 - t0;
  return p.render(
    <>
      <Link href={`/${locale}/workflows/runs`} className="text-sm text-muted-foreground hover:underline">
        ← {t("workflows.tabs.runs")}
      </Link>
      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              <Link href={`/${locale}/workflows/${run.workflow.id}`} className="hover:underline">
                {run.workflow.name}
              </Link>
              <Badge tone={RUN_TONE[run.status]}>{t(`workflows.runStatus.${run.status}`)}</Badge>
              {run.isTest ? <Badge>{t("workflows.runs.test")}</Badge> : null}
            </span>
          }
          description={`${run.version ? `v${run.version.version}` : t("workflows.runs.draft")} · ${t(`workflows.builder.triggerTypes.${run.triggerType}`)} · ${formatDateTime(run.createdAt, locale, tz)}`}
          actions={canExecute ? <RunControls base={base} runId={run.id} status={run.status} /> : null}
        />
        <CardBody className="grid gap-3">
          {run.error ? <Notice tone={run.status === "FAILED" ? "danger" : "warning"}>{run.error}</Notice> : null}
          {run.deadLetteredAt ? (
            <Notice tone="danger">
              <div className="grid gap-2">
                <span>{t("workflows.runs.deadNotice")}</span>
                {canExecute ? <DeadLetterActions base={base} runId={run.id} /> : null}
              </div>
            </Notice>
          ) : null}
          {canExecute && finished && flat.length ? (
            <div className="grid gap-1">
              <p className="text-xs text-muted-foreground">{t("workflows.runs.rerunHelp")}</p>
              <RerunFromStep base={base} runId={run.id} steps={flat.map((x) => ({ id: x.id, label: stepLabel(x.id) }))} defaultStep={failedStep} />
            </div>
          ) : null}
          {run.status === "WAITING" && run.waitingFor ? (
            <Notice>
              {t(`workflows.runs.waiting_${run.waitingFor}`)}
              {run.nextRunAt ? ` · ${t("workflows.runs.resumesAt", { date: formatDateTime(run.nextRunAt, locale, tz) })}` : ""}
              {pendingApproval ? (
                <>
                  {" "}
                  <Link href={`/${locale}/workflows/approvals`} className="font-medium underline">
                    {t("workflows.approvals.open")}
                  </Link>
                </>
              ) : null}
            </Notice>
          ) : null}
          <dl className="grid gap-2 text-sm sm:grid-cols-5">
            <div>
              <dt className="text-xs text-muted-foreground">{t("workflows.runs.started")}</dt>
              <dd>{run.startedAt ? formatDateTime(run.startedAt, locale, tz) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("workflows.runs.finished")}</dt>
              <dd>{run.finishedAt ? formatDateTime(run.finishedAt, locale, tz) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("workflows.runs.duration")}</dt>
              <dd>{run.startedAt && run.finishedAt ? duration(run.finishedAt.getTime() - run.startedAt.getTime()) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("workflows.runs.depthLabel")}</dt>
              <dd>{run.depth}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("workflows.runs.triggerEvent")}</dt>
              <dd className="truncate font-mono text-xs">{run.triggerEventId}</dd>
            </div>
          </dl>
          <details>
            <summary className="cursor-pointer text-sm font-medium">{t("workflows.runs.payload")}</summary>
            <div className="mt-2">
              <Json value={event} />
            </div>
          </details>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("workflows.runs.steps")} description={t("workflows.runs.stepsHelp")} />
        {steps.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("workflows.runs.noSteps")}</p>
        ) : (
          <ol className="divide-y">
            {steps.map((s, i) => (
              <li key={s.id} className="grid gap-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid size-6 place-items-center rounded-full bg-muted text-xs font-medium">{i + 1}</span>
                  <span className="font-mono text-sm">{s.stepId}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.stepType.startsWith("action:") ? t(`workflows.builder.actions.${s.stepType.slice(7)}`) : t(`workflows.builder.stepTypes.${s.stepType}`)}
                  </span>
                  <Badge tone={STEP_TONE[s.status]}>{t(`workflows.stepStatus.${s.status}`)}</Badge>
                  {s.attempts > 1 ? <Badge tone="warning">{t("workflows.runs.attempts", { count: s.attempts })}</Badge> : null}
                  <span className="ms-auto text-xs text-muted-foreground">
                    {formatDateTime(s.startedAt, locale, tz)}
                    {s.finishedAt ? ` · ${duration(s.finishedAt.getTime() - s.startedAt.getTime())}` : ""}
                  </span>
                </div>
                <div className="relative h-1.5 overflow-hidden rounded bg-muted" aria-hidden>
                  <div
                    className={`absolute inset-y-0 rounded ${s.status === "FAILED" ? "bg-danger" : s.status === "WAITING" ? "bg-warning" : "bg-primary"}`}
                    style={{
                      insetInlineStart: `${Math.min(100, ((s.startedAt.getTime() - t0) / span) * 100)}%`,
                      width: `${Math.max(1, (((s.finishedAt ?? new Date()).getTime() - s.startedAt.getTime()) / span) * 100)}%`,
                    }}
                  />
                </div>
                {s.error ? <p className="text-sm text-danger">{s.error}</p> : null}
                <div className="grid gap-2 lg:grid-cols-2">
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">{t("workflows.runs.input")}</summary>
                    <Json value={s.input} />
                  </details>
                  {s.output ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">{t("workflows.runs.output")}</summary>
                      <Json value={s.output} />
                    </details>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {run.approvals.length ? (
        <Card>
          <CardHeader title={t("workflows.tabs.approvals")} />
          <ul className="divide-y">
            {run.approvals.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <Badge tone={a.status === "APPROVED" ? "success" : a.status === "PENDING" ? "warning" : "danger"}>{t(`workflows.approvals.status.${a.status}`)}</Badge>
                <span className="font-medium">{a.title}</span>
                <span className="text-xs text-muted-foreground">{t(`workflows.builder.approverModes.${a.approverMode}`)}</span>
                {a.expiresAt && a.status === "PENDING" ? <span className="text-xs text-muted-foreground">{t("workflows.approvals.expires", { date: formatDateTime(a.expiresAt, locale, tz) })}</span> : null}
                {a.escalatedAt ? <Badge tone="warning">{t("workflows.approvals.escalated")}</Badge> : null}
                {a.note ? <span className="text-muted-foreground">“{a.note}”</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {aiTasks.length ? (
        <Card>
          <CardHeader title={t("workflows.runs.aiTasks")} />
          <ul className="divide-y">
            {aiTasks.map((task) => (
              <li key={task.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                <Badge tone={TASK_TONE[task.status]}>{t(`agentTasks.status.${task.status}`)}</Badge>
                <Link href={`/${locale}/tasks/${task.id}`} className="hover:underline">
                  {task.title}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>,
  );
}
