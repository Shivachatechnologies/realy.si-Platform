import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { TaskStatusBadge } from "@/components/agents/status-badge";
import { GeneratePlanButton } from "@/components/objectives/goal-forms";
import { PlanReview } from "@/components/objectives/plan-review";
import { ObjectivesTabs } from "@/components/objectives/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { getGoal } from "@/server/modules/objectives/goals";
import { planState } from "@/server/modules/objectives/plan";
import { buildDraft } from "@/server/modules/objectives/plan-draft";
import { departmentOptions, linkedEmployees, metricOptions, objectiveOwnerOptions, workPeopleOptions } from "@/server/modules/objectives/pickers";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";
import { notFound } from "next/navigation";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("objectives.plan.heading") };
}

export default async function GoalPlanPage({ params, searchParams }: { params: Promise<{ goalId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const { goalId } = await params;
  const sp = await searchParams;
  const shell = (body: ReactNode, title?: string) => (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <div className="grid gap-3">
        <div className="grid gap-1">
          <Link href={`/${locale}/objectives/goals`} className="text-xs text-muted-foreground hover:underline">
            {t("objectives.goals.heading")}
          </Link>
          <h1 className="font-display text-display-lg">{title ?? t("objectives.plan.heading")}</h1>
          <p className="text-muted-foreground">{t("objectives.plan.subtitle")}</p>
        </div>
        <ObjectivesTabs locale={locale} active="goals" />
      </div>
      {body}
    </div>
  );
  if (!company) return shell(<Notice>{t("company.empty")}</Notice>);
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage, canRun, canProjects] = await Promise.all([
    can(viewer.ctx, "objectives.read", chain),
    can(viewer.ctx, "objectives.manage", chain),
    can(viewer.ctx, "agents.run", chain),
    can(viewer.ctx, "projects.manage", chain),
  ]);
  if (!canRead) return shell(<Notice tone="warning">{t("errors.forbidden")}</Notice>);
  const goal = await getGoal(viewer.ctx, org.id, company.id, goalId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const { task, parsed, forbidden } = await planState(viewer.ctx, org.id, company.id, goal);
  const base = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const canPlan = canManage && canRun && aiConfigured();
  const tz = viewer.user.timezone;
  const applied = Object.keys((goal.planApplied ?? {}) as object).length;
  const planErrorReason = typeof sp.planError === "string" && /^[a-z_]{2,60}$/.test(sp.planError) ? sp.planError : null;
  const reasonText = (r: string) => {
    const key = `errors.reasons.${r}`;
    const s = t(key);
    if (s !== key) return s;
    const generic = t(`errors.${r}`);
    return generic === `errors.${r}` ? t("errors.internal_error") : generic;
  };

  const goalCard = (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {goal.title}
            <Badge>{t(`objectives.goals.horizons.${goal.horizon}`)}</Badge>
            <Badge tone={goal.status === "ACTIVE" ? "accent" : "neutral"}>{t(`objectives.status.${goal.status}`)}</Badge>
          </span>
        }
        description={[goal.targetDate ? t("objectives.target", { date: formatDate(goal.targetDate, locale, "UTC") }) : null, goal.owner ? t("objectives.ownedBy", { name: goal.owner.name }) : null].filter(Boolean).join(" · ")}
      />
      {goal.description ? <CardBody className="text-sm text-muted-foreground">{goal.description}</CardBody> : null}
    </Card>
  );

  if (goal.planAppliedAt) {
    return shell(
      <>
        {goalCard}
        <Notice tone="success">
          {t("objectives.plan.appliedOn", { date: formatDateTime(goal.planAppliedAt, locale, tz) })}{" "}
          <Link className="font-medium underline" href={`/${locale}/objectives?goal=${goal.id}`}>
            {t("objectives.plan.viewObjectives")}
          </Link>{" "}
          ·{" "}
          <Link className="font-medium underline" href={`/${locale}/company/strategy`}>
            {t("objectives.plan.viewTree")}
          </Link>
        </Notice>
      </>,
      goal.title,
    );
  }

  const taskLine = task ? (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <TaskStatusBadge status={task.status} label={t(`agentTasks.status.${task.status}`)} />
      <span className="text-muted-foreground">{formatDateTime(task.createdAt, locale, tz)}</span>
      <Link className="text-primary hover:underline" href={`/${locale}/tasks/${task.id}`}>
        {t("objectives.plan.openTask")}
      </Link>
    </div>
  ) : null;
  const regenerate = canPlan && goal.status === "ACTIVE" && !applied ? <GeneratePlanButton base={base} goalId={goal.id} regenerate={!!task} /> : null;
  const whyNoPlan = !canManage ? null : !aiConfigured() ? t("objectives.plan.aiNotConfigured") : !canRun ? t("objectives.plan.noRunPermission") : null;

  // No plan task yet (or the viewer may not read AI tasks).
  if (!task) {
    return shell(
      <>
        {goalCard}
        {planErrorReason ? <Notice tone="danger">{t("objectives.plan.startFailed", { reason: reasonText(planErrorReason) })}</Notice> : null}
        {forbidden ? <Notice tone="warning">{t("objectives.plan.taskForbidden")}</Notice> : null}
        <Card>
          <CardHeader title={t("objectives.plan.heading")} description={goal.planTaskId ? undefined : t("objectives.plan.none")} />
          <CardBody className="grid gap-3">
            {whyNoPlan ? <p className="text-sm text-muted-foreground">{whyNoPlan}</p> : null}
            {regenerate}
          </CardBody>
        </Card>
      </>,
      goal.title,
    );
  }

  if (task.status === "QUEUED" || task.status === "RUNNING") {
    return shell(
      <>
        {goalCard}
        <AutoRefresh active intervalMs={4000} />
        <Card>
          <CardHeader title={t("objectives.plan.generating")} description={t("objectives.plan.generatingHint")} />
          <CardBody>{taskLine}</CardBody>
        </Card>
      </>,
      goal.title,
    );
  }

  if (task.status !== "COMPLETED" || !parsed?.ok) {
    const problem =
      task.status !== "COMPLETED" ? t("objectives.plan.taskFailed", { reason: task.errorMessage ?? task.errorCode ?? t(`agentTasks.status.${task.status}`) }) : t(`objectives.plan.parseErrors.${parsed && !parsed.ok ? parsed.error : "no_output"}`);
    return shell(
      <>
        {goalCard}
        <Card>
          <CardHeader title={t("objectives.plan.invalid")} />
          <CardBody className="grid gap-3">
            {taskLine}
            <Notice tone="danger">{problem}</Notice>
            {parsed && !parsed.ok && parsed.issues.length ? (
              <ul className="grid gap-1 font-mono text-xs text-muted-foreground">
                {parsed.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            ) : null}
            {task.output ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">{t("objectives.plan.rawOutput")}</summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-md border bg-surface-2 p-2 whitespace-pre-wrap">{task.output.slice(0, 20_000)}</pre>
              </details>
            ) : null}
            {regenerate}
          </CardBody>
        </Card>
      </>,
      goal.title,
    );
  }

  if (!canManage) {
    return shell(
      <>
        {goalCard}
        <Notice tone="info">{t("objectives.plan.readOnly")}</Notice>
        <Card>
          <CardBody className="grid gap-2 text-sm">
            {taskLine}
            <ul className="grid gap-1">
              {parsed.plan.objectives.map((o, i) => (
                <li key={i}>
                  <span className="font-medium">{o.title}</span>
                  <span className="text-muted-foreground"> · {t("objectives.plan.objectiveShape", { krs: o.keyResults.length, milestones: o.milestones.length })}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </>,
      goal.title,
    );
  }

  const [departments, objectiveOwners, workPeople, employees, metrics] = await Promise.all([
    departmentOptions(org.id, company.id),
    objectiveOwnerOptions(org.id, chain),
    canProjects ? workPeopleOptions(org.id, chain) : Promise.resolve([]),
    linkedEmployees(viewer.ctx, org.id, company.id, chain),
    metricOptions(viewer.ctx, chain, t),
  ]);
  const byUser = new Map((employees ?? []).map((e) => [e.userId!, e]));
  const label = (u: { id: string; name: string }) => {
    const e = byUser.get(u.id);
    const extra = e ? [e.title, e.department?.name].filter(Boolean).join(", ") : "";
    return { id: u.id, name: extra ? `${u.name} — ${extra}` : u.name };
  };
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const draft = buildDraft(parsed.plan, {
    today,
    goalTarget: goal.targetDate,
    departments,
    employees: employees ? employees.map((e) => ({ userId: e.userId!, departmentId: e.departmentId, title: e.title, isHead: !!e.department && e.department.headId === e.id })) : null,
    objectiveOwnerIds: new Set(objectiveOwners.map((u) => u.id)),
    workPeopleIds: new Set(workPeople.map((u) => u.id)),
    metricKeys: new Map(metrics.map((m) => [m.key, m.unit])),
  });

  return shell(
    <>
      {goalCard}
      <Card>
        <CardHeader title={t("objectives.plan.ready")} description={t("objectives.plan.readyHint")} />
        <CardBody className="grid gap-3">
          {taskLine}
          {regenerate ? (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">{t("objectives.plan.regenerate")}</summary>
              <div className="mt-2">{regenerate}</div>
            </details>
          ) : null}
        </CardBody>
      </Card>
      <PlanReview
        base={base}
        goalId={goal.id}
        initial={draft}
        objectiveOwners={objectiveOwners.map(label)}
        workPeople={workPeople.map(label)}
        departments={departments}
        metrics={metrics}
        canCreateProjects={canProjects}
        resumable={applied}
      />
    </>,
    goal.title,
  );
}
