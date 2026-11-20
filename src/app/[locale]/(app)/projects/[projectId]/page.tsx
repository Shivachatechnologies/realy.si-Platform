import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { HelpMeButton } from "@/components/guide-kit/help-me";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { introLabels, latestSubjectTask } from "@/components/guide-kit/server";
import { DelayBadge, WorkloadHeatmap } from "@/components/work/insights";
import { projectDelays, workloadHeatmap } from "@/server/modules/work/kickoff";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ActionButton, AiButton } from "@/components/work/actions";
import { AiPanel } from "@/components/work/ai-panel";
import { workContext } from "@/components/work/context";
import { EditProjectForm, ExpenseForm, MemberForm, MilestoneActions, MilestoneForm, RiskEditor, RiskForm, SaveTemplateForm } from "@/components/work/project-forms";
import { DeleteIconButton, TimeForm } from "@/components/work/task-forms";
import { Facts, HEALTH_TONE, PROJECT_STATUS_TONE, Progress, StatCard } from "@/components/work/ui";
import { ProjectTabs } from "@/components/work/views";
import { getT } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { db } from "@/server/core/db";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { getWorkProject } from "@/server/modules/work/projects";
import { financeProjectCosts } from "@/server/modules/finance/project-costs";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { listPeople, userNames } from "@/server/modules/work/shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.projects.title") };
}

const RISK_TONE = { OPEN: "warning", MITIGATING: "accent", CLOSED: "neutral", OCCURRED: "danger" } as const;

export default async function ProjectPage({ params }: PageProps<"/[locale]/projects/[projectId]">) {
  const { projectId } = await params;
  const t = await getT();
  const w = await workContext("projects", t("modules.projects.title"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, canRunAgents, base, tz } = w;
  const p = await getWorkProject(viewer.ctx, org.id, company.id, projectId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  // Finance's real postings for this project (bills, expenses, claims) — only for viewers who may see finance.
  const canSeeFinance = await can(viewer.ctx, "finance.read", await companyChain(db(), org.id, company.id));
  const [people, aiTasks, timeEntries, financeCosts] = await Promise.all([
    listPeople(viewer.ctx, org.id, company.id),
    canRunAgents ? listSubjectTasks(viewer.ctx, org.id, company.id, "project", p.id) : [],
    db().workTimeEntry.findMany({ where: { projectId: p.id, companyId: company.id }, orderBy: { workDate: "desc" }, take: 20, include: { task: { select: { id: true, title: true } } } }),
    canSeeFinance ? financeProjectCosts(org.id, company.id, p.id).catch(() => null) : null,
  ]);
  const [names, delays, heat, helpTask] = await Promise.all([
    userNames(db(), timeEntries.map((e) => e.userId)),
    projectDelays(viewer.ctx, org.id, company.id, [p.id]),
    workloadHeatmap(viewer.ctx, org.id, company.id, { projectId: p.id }),
    latestSubjectTask(viewer.ctx, org.id, company.id, "project_help", p.id),
  ]);
  const currency = p.currency ?? company.baseCurrency;
  const money = (m: bigint | null) => (m == null ? "—" : formatMoney({ amountMinor: m, currency }, locale));
  const active = !p.archivedAt;
  const manage = canManage && active;
  const day = (d: Date | null) => (d ? formatDate(d, locale, "UTC") : "—");
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const major = (m: bigint | null) => (m == null ? "" : `${m / 100n}${m % 100n ? `.${(m % 100n).toString().padStart(2, "0")}` : ""}`);
  const hours = (min: number) => t("work.hoursValue", { hours: Math.round((min / 60) * 10) / 10 });
  const budgetTone = p.budget.usedPercent != null && p.budget.usedPercent > 100 ? "danger" : p.budget.usedPercent != null && p.budget.usedPercent > 90 ? "warning" : undefined;

  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      <Link href={`/${locale}/projects`} className="text-sm text-muted-foreground hover:underline">
        ← {t("work.backToProjects")}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">{p.name}</h1>
          <Badge tone={PROJECT_STATUS_TONE[p.status]}>{t(`work.projectStatus.${p.status}`)}</Badge>
          <Badge tone={HEALTH_TONE[p.health]}>{t(`work.health.${p.health}`)}</Badge>
          <DelayBadge t={t} delay={delays.get(p.id)} />
          {p.suggestedHealth !== p.health ? (
            <span className="text-xs text-muted-foreground">{t("work.project.suggestedHealth", { health: t(`work.health.${p.suggestedHealth}`) })}</span>
          ) : null}
        </div>
        {canManage ? (
          active ? (
            <ActionButton url={`${base}/projects/${p.id}`} method="PATCH" body={{ archived: true }} confirm={t("work.project.confirmArchive")}>
              <Archive aria-hidden />
              {t("work.archive")}
            </ActionButton>
          ) : (
            <ActionButton url={`${base}/projects/${p.id}`} method="PATCH" body={{ archived: false }}>
              <ArchiveRestore aria-hidden />
              {t("work.restore")}
            </ActionButton>
          )
        ) : null}
      </div>
      {!active ? <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm">{t("work.project.archivedNotice")}</p> : null}
      <ProjectTabs t={t} locale={locale} projectId={p.id} active="overview" />
      <PageIntro
        labels={introLabels(t)}
        what={t("work.intro.project.what")}
        why={t("work.intro.project.why")}
        can={t("work.intro.project.can")}
        next={{ label: t("work.intro.project.next"), href: `/${locale}/projects/${p.id}/timeline` }}
        accent="info"
        extra={
          <HelpMeButton
            base={`/api/v1/organizations/${org.id}/companies/${company.id}`}
            aiReady={aiConfigured() && canRunAgents}
            profile="ai_project_manager"
            subject={{ type: "project_help", id: p.id }}
            title={`Help me with ${p.name}`.slice(0, 200)}
            instructions={`The person is looking at the project "${p.name}" (project id ${p.id}) and is not a project-management expert. Read it with read_project and read_team_workload. Explain in plain words where the project stands, what is late or at risk and why, and the next 3 concrete things to do. You may propose missing tasks (create_work_task) or assignments (assign_task); they are applied only after the person approves.`}
            initial={helpTask}
          />
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label={t("work.project.progress")} value={`${p.stats.progress}%`} hint={t("work.project.progressOf", { done: p.stats.done, total: p.stats.total })} />
        <StatCard label={t("work.stats.inProgress")} value={p.stats.inProgress} />
        <StatCard label={t("work.stats.overdueTasks")} value={p.stats.overdueTasks} tone={p.stats.overdueTasks ? "danger" : undefined} />
        <StatCard
          label={t("work.budget.spent")}
          value={money(p.budget.spentMinor)}
          hint={p.budget.budgetMinor != null ? t("work.budget.ofBudget", { budget: money(p.budget.budgetMinor), percent: p.budget.usedPercent ?? 0 }) : t("work.budget.noBudget")}
          tone={budgetTone}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-4">
          <Card>
            <CardHeader title={t("work.project.details")} />
            <CardBody className="grid gap-4">
              <Facts
                cols={4}
                items={[
                  [t("work.project.owner"), p.owner?.name ?? "—"],
                  [t("work.project.startDate"), day(p.startDate)],
                  [t("work.project.dueDate"), day(p.dueDate)],
                  [t("projects.workspace"), p.workspace.name],
                  [t("work.project.template"), p.templateKey ? (p.templateKey.startsWith("custom:") ? t("work.template.custom") : t(`work.templates.builtIn.${p.templateKey}.name`)) : "—"],
                  [t("work.project.budget"), money(p.budgetMinor)],
                  [t("projects.created"), formatDate(p.createdAt, locale, tz)],
                ]}
              />
              {manage ? (
                <details>
                  <summary className="cursor-pointer text-sm font-medium">{t("work.project.edit")}</summary>
                  <div className="pt-3">
                    <EditProjectForm
                      base={base}
                      projectId={p.id}
                      people={people}
                      currency={currency}
                      initial={{ name: p.name, description: p.description ?? "", status: p.status, health: p.health, ownerId: p.ownerId ?? "", startDate: iso(p.startDate), dueDate: iso(p.dueDate), budget: major(p.budgetMinor) }}
                    />
                  </div>
                </details>
              ) : null}
              {p.description ? <p className="whitespace-pre-wrap text-sm">{p.description}</p> : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("work.milestone.list")} description={t("work.milestone.hint")} />
            <CardBody className="grid gap-3">
              {p.projectMilestones.length ? (
                <ul className="grid gap-2">
                  {p.projectMilestones.map((m) => (
                    <li key={m.id} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_10rem_9rem_auto] sm:items-center">
                      <span className={`text-sm ${m.completedAt ? "text-muted-foreground line-through" : "font-medium"}`}>{m.title}</span>
                      <Progress value={m.tasksTotal ? (m.tasksDone / m.tasksTotal) * 100 : m.completedAt ? 100 : 0} label={t("work.project.progressOf", { done: m.tasksDone, total: m.tasksTotal })} />
                      <span className={`text-xs ${!m.completedAt && m.dueDate && m.dueDate < new Date() ? "text-danger" : "text-muted-foreground"}`}>{day(m.dueDate)}</span>
                      {manage ? <MilestoneActions base={base} milestoneId={m.id} done={!!m.completedAt} /> : <span />}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("work.milestone.empty")}</p>
              )}
              {p.milestones.length ? (
                <div className="grid gap-1 border-t pt-3">
                  <p className="text-xs font-medium text-muted-foreground">{t("work.milestone.objectives")}</p>
                  <ul className="grid gap-1 text-sm">
                    {p.milestones.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center gap-2">
                        <span aria-hidden>{m.completedAt ? "✓" : "○"}</span>
                        <span>{m.title}</span>
                        <Link href={`/${locale}/objectives`} className="text-xs text-muted-foreground hover:underline">
                          {m.objective.title}
                        </Link>
                        <span className="text-xs text-muted-foreground">{day(m.dueDate)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {manage ? <MilestoneForm base={base} projectId={p.id} /> : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("work.risk.register")} description={t("work.risk.hint")} />
            {p.risks.length ? (
              <ul className="grid divide-y">
                {p.risks.map((r) => (
                  <li key={r.id} className="grid gap-1 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={r.exposure >= 15 ? "danger" : r.exposure >= 8 ? "warning" : "neutral"} title={t("work.risk.exposureHint")}>
                        {t("work.risk.exposure", { value: r.exposure })}
                      </Badge>
                      <span className="font-medium">{r.title}</span>
                      <Badge tone={RISK_TONE[r.status]}>{t(`work.riskStatus.${r.status}`)}</Badge>
                      <span className="text-xs text-muted-foreground">
                        P{r.probability} × I{r.impact}
                        {r.ownerName ? ` · ${r.ownerName}` : ""}
                      </span>
                    </div>
                    {r.description ? <p className="whitespace-pre-wrap text-muted-foreground">{r.description}</p> : null}
                    {r.mitigation ? (
                      <p className="text-xs">
                        <span className="text-muted-foreground">{t("work.risk.mitigation")}: </span>
                        {r.mitigation}
                      </p>
                    ) : null}
                    {manage ? (
                      <RiskEditor
                        base={base}
                        projectId={p.id}
                        riskId={r.id}
                        people={people}
                        initial={{ title: r.title, description: r.description ?? "", probability: r.probability, impact: r.impact, mitigation: r.mitigation ?? "", ownerId: r.ownerId ?? "", status: r.status }}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("work.risk.empty")}</p>
            )}
            {manage ? (
              <details className="border-t">
                <summary className="cursor-pointer p-3 text-sm font-medium">{t("work.risk.add")}</summary>
                <div className="p-3 pt-0">
                  <RiskForm base={base} projectId={p.id} people={people} />
                </div>
              </details>
            ) : null}
          </Card>

          <Card>
            <CardHeader title={t("work.budget.title")} description={t("work.budget.hint")} />
            <CardBody className="grid gap-4">
              <Facts
                cols={4}
                items={[
                  [t("work.project.budget"), money(p.budget.budgetMinor)],
                  [t("work.budget.timeCost"), `${money(p.budget.timeCostMinor)} · ${hours(p.budget.minutes)}`],
                  [t("work.budget.expenses"), money(p.budget.expenseMinor)],
                  [t("work.budget.remaining"), money(p.budget.remainingMinor)],
                ]}
              />
              {p.budget.usedPercent != null ? <Progress value={Math.min(100, p.budget.usedPercent)} tone={budgetTone} label={t("work.budget.used")} /> : null}
              {financeCosts ? (
                <div className="grid gap-2 rounded-md border bg-surface-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{t("work.budget.financeTitle")}</span>
                    <Link href={`/${locale}/finance/reports?report=projects`} className="text-xs text-muted-foreground hover:underline">
                      {t("work.budget.financeOpen")}
                    </Link>
                  </div>
                  <Facts
                    cols={4}
                    items={[
                      [t("work.budget.financeBills"), formatMoney({ amountMinor: financeCosts.billsMinor, currency: financeCosts.currency }, locale)],
                      [t("work.budget.financeExpenses"), formatMoney({ amountMinor: financeCosts.expensesMinor, currency: financeCosts.currency }, locale)],
                      [t("work.budget.financeTotal"), formatMoney({ amountMinor: financeCosts.totalCostMinor, currency: financeCosts.currency }, locale)],
                      [t("work.budget.financePending"), formatMoney({ amountMinor: financeCosts.pendingClaimsMinor, currency: financeCosts.currency }, locale)],
                    ]}
                  />
                </div>
              ) : null}
              {p.expenses.length ? (
                <Table>
                  <THead>
                    <Tr>
                      <Th>{t("work.expense.date")}</Th>
                      <Th>{t("work.expense.description")}</Th>
                      <Th className="text-end">{t("work.expense.amountShort")}</Th>
                      {manage ? <Th className="w-10" /> : null}
                    </Tr>
                  </THead>
                  <TBody>
                    {p.expenses.map((e) => (
                      <Tr key={e.id}>
                        <Td className="whitespace-nowrap text-muted-foreground">{day(e.incurredOn)}</Td>
                        <Td>{e.description}</Td>
                        <Td className="text-end tabular-nums">{formatMoney({ amountMinor: e.amountMinor, currency: e.currency }, locale)}</Td>
                        {manage ? (
                          <Td>
                            <DeleteIconButton url={`${base}/expenses/${e.id}`} label={t("work.delete")} confirm={t("work.confirmDelete")} />
                          </Td>
                        ) : null}
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              ) : null}
              {manage ? <ExpenseForm base={base} projectId={p.id} currency={currency} /> : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("work.time.title")} description={t("work.time.projectHint")} />
            <CardBody className="grid gap-3">
              {active ? <TimeForm base={base} projectId={p.id} /> : null}
              {timeEntries.length ? (
                <Table>
                  <THead>
                    <Tr>
                      <Th>{t("work.time.date")}</Th>
                      <Th>{t("work.time.person")}</Th>
                      <Th>{t("work.task.title")}</Th>
                      <Th className="text-end">{t("work.time.duration")}</Th>
                      <Th className="w-10" />
                    </Tr>
                  </THead>
                  <TBody>
                    {timeEntries.map((e) => (
                      <Tr key={e.id}>
                        <Td className="whitespace-nowrap text-muted-foreground">{day(e.workDate)}</Td>
                        <Td>{names.get(e.userId) ?? "—"}</Td>
                        <Td className="text-muted-foreground">
                          {e.task ? (
                            <Link href={`/${locale}/projects/tasks/${e.task.id}`} className="hover:underline">
                              {e.task.title}
                            </Link>
                          ) : (
                            e.note ?? "—"
                          )}
                        </Td>
                        <Td className="text-end tabular-nums">{hours(e.minutes)}</Td>
                        <Td>{canManage || e.userId === viewer.user.id ? <DeleteIconButton url={`${base}/time/${e.id}`} label={t("work.delete")} confirm={t("work.confirmDelete")} /> : null}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">{t("work.time.empty")}</p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-4">
          {canRunAgents ? (
            <AiPanel
              t={t}
              locale={locale}
              tz={tz}
              title={t("work.ai.title")}
              description={t("work.ai.projectHint")}
              configured={aiConfigured()}
              tasks={aiTasks}
              actions={
                <>
                  <AiButton url={`${base}/projects/${p.id}/ai`} body={{ action: "status_report" }} label={t("work.ai.statusReport")} />
                  <AiButton url={`${base}/projects/${p.id}/ai`} body={{ action: "detect_risks" }} label={t("work.ai.detectRisks")} />
                  {manage ? <AiButton url={`${base}/projects/${p.id}/ai`} body={{ action: "plan" }} label={t("work.ai.plan")} /> : null}
                </>
              }
            />
          ) : null}

          <Card>
            <CardHeader title={t("work.project.members")} description={t("work.member.count", { count: p.members.length })} />
            <ul className="grid divide-y">
              {p.members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{m.user.name}</span>
                  {m.role ? <Badge>{m.role}</Badge> : null}
                  {m.hourlyRateMinor != null ? <span className="text-xs text-muted-foreground">{t("work.member.ratePerHour", { rate: money(m.hourlyRateMinor) })}</span> : null}
                  {manage ? <DeleteIconButton url={`${base}/projects/${p.id}/members?userId=${m.userId}`} label={t("work.remove")} confirm={t("work.member.confirmRemove")} /> : null}
                </li>
              ))}
            </ul>
            {manage ? (
              <div className="border-t p-3">
                <MemberForm base={base} projectId={p.id} people={people} currency={currency} />
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader title={t("work.agile.sprints")} />
            {p.sprints.length ? (
              <ul className="grid divide-y">
                {p.sprints.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                    <Link href={`/${locale}/projects/${p.id}/sprints/${s.id}`} className="min-w-0 flex-1 truncate hover:underline">
                      {s.name}
                    </Link>
                    <Badge tone={s.status === "ACTIVE" ? "accent" : s.status === "COMPLETED" ? "success" : "neutral"}>{t(`work.sprintStatus.${s.status}`)}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("work.agile.noSprints")}</p>
            )}
          </Card>

          {manage ? (
            <Card>
              <CardHeader title={t("work.template.saveAs")} description={t("work.template.saveAsHint")} />
              <CardBody>
                <SaveTemplateForm base={base} projectId={p.id} locale={locale} />
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
      <Card>
        <CardHeader title={t("work.heatmap.title")} description={t("work.heatmap.hintProject")} />
        <WorkloadHeatmap t={t} locale={locale} data={heat} />
      </Card>
    </div>
  );
}
