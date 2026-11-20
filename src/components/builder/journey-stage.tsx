import Link from "next/link";
import { Bot, Building2, FileText, FolderKanban, Package, Target, Wallet } from "lucide-react";
import { AiCore, Aurora, LiveDot, Reveal, RevealGroup, TypingText } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { StatTile } from "@/components/ui/stat-tile";
import type { Translate } from "@/i18n/translate";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import type { RunMode } from "@/server/modules/builder/brief";
import { JOURNEY, stageSteps, type JourneyStage } from "@/server/modules/builder/journey";
import { getRunView } from "@/server/modules/builder/service";
import { DecisionCard } from "./decision-card";
import { STEP_TONE } from "./frame";
import { JourneyNav } from "./journey-nav";
import { LiveRefresh, RetryStep } from "./run-controls";

/**
 * One stage (3–10) of the onboarding journey, from the builder run's real rows: the steps that belong to the stage,
 * what the AI is doing right now, decisions waiting for the founder and the records the stage produced.
 */
export async function JourneyStageView({ ctx, t, locale, organizationId, companyId, runId, stage, canManage }: { ctx: RequestContext; t: Translate; locale: string; organizationId: string; companyId: string; runId: string; stage: number; canManage: boolean }) {
  const key = JOURNEY[stage - 1] as JourneyStage;
  const v = await getRunView(ctx, organizationId, companyId, runId);
  const mode = v.run.mode as RunMode;
  const keys = stageSteps(mode, key);
  const steps = v.steps.filter((s) => keys.includes(s.key));
  const decisions = v.decisions.filter((d) => d.status === "OPEN" && steps.some((s) => s.id === d.stepId));
  const done = steps.filter((s) => s.status === "COMPLETED" || s.status === "SKIPPED").length;
  const running = steps.find((s) => s.status === "RUNNING" || s.status === "APPLYING");
  const runningTask = running?.agentTaskId ? v.tasks.get(running.agentTaskId) : null;
  const base = `/api/v1/organizations/${organizationId}/companies/${companyId}/builder/runs/${runId}`;
  const where = { organizationId, companyId };
  const [strategy, goals, cashItems, budgets, workflows] = await Promise.all([
    key === "blueprint" ? db().companyStrategy.findFirst({ where, select: { mission: true, vision: true, values: true } }) : null,
    key === "goals" ? db().companyGoal.findMany({ where, select: { id: true, title: true }, take: 10 }) : [],
    key === "goals" || key === "command" ? db().cashPlanItem.count({ where }) : 0,
    key === "goals" ? db().financeBudget.count({ where }) : 0,
    key === "structure" || key === "command" ? db().workflow.count({ where }) : 0,
  ]);
  const tasks = v.projects.reduce((n, p) => n + p._count.workTasks, 0);
  const docs = steps.filter((s) => s.brainDocumentId && v.docs.has(s.brainDocumentId));
  const stageDone = key === "command" || (steps.length > 0 && done === steps.length);

  return (
    <div className="grid gap-4">
      <LiveRefresh base={base} active={v.run.status === "RUNNING"} />
      <Card variant="glass" className="relative overflow-hidden">
        <Aurora className="pointer-events-none absolute inset-0 opacity-60" />
        <CardBody className="relative grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center">
          <Reveal className="grid gap-2">
            <p className="text-[11px] font-semibold tracking-[0.08em] text-primary uppercase">{t("builder.journey.stageOf", { n: stage, total: JOURNEY.length })}</p>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{t(`builder.journey.stages.${key}.title`)}</h2>
            <p className="text-sm text-muted-foreground">{t(`builder.journey.stages.${key}.what`)}</p>
            <p className="text-sm">
              <span className="font-medium">{t("builder.journey.why")}</span> {t(`builder.journey.stages.${key}.why`)}
            </p>
            {running ? (
              <p className="flex items-center gap-2 text-sm" aria-live="polite">
                <LiveDot tone="primary" />
                <TypingText text={t("builder.journey.working", { step: t(`builder.steps.${running.key}`), who: runningTask ? t(`profiles.${runningTask.profile}.name`) : t("builder.title") })} />
              </p>
            ) : stageDone ? (
              <Badge tone="success" className="w-fit">{t("builder.journey.stageDone")}</Badge>
            ) : v.run.status === "RUNNING" ? (
              <p className="text-sm text-muted-foreground">{t("builder.journey.queued")}</p>
            ) : null}
          </Reveal>
          <AiCore className="mx-auto size-28 sm:size-36" />
        </CardBody>
      </Card>

      {v.run.status === "DRAFT" ? (
        <Notice tone="info" action={<Button asChild size="sm"><Link href={`/${locale}/builder/${runId}`}>{t("builder.open")}</Link></Button>}>
          {t("builder.journey.draft")}
        </Notice>
      ) : null}

      {decisions.map((d) => (
        <DecisionCard key={d.id} base={base} decision={{ id: d.id, kind: d.kind, options: d.options }} canManage={canManage} />
      ))}

      {steps.length ? (
        <Card>
          <CardHeader title={t("builder.journey.inThisStage")} description={t("builder.list.steps", { done, total: steps.length })} />
          <RevealGroup as="ul" className="divide-y">
            {steps.map((s) => (
              <li key={s.id} className="grid gap-1.5 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t(`builder.steps.${s.key}`)}</span>
                  <Badge tone={STEP_TONE[s.status]} pulse={s.status === "RUNNING"}>
                    {t(`builder.stepStatus.${s.status}`)}
                  </Badge>
                  {s.brainDocumentId && v.docs.has(s.brainDocumentId) ? (
                    <Link className="text-xs text-primary hover:underline" href={`/${locale}/brain/${s.brainDocumentId}`}>
                      {t("builder.journey.read")}
                    </Link>
                  ) : null}
                </div>
                {s.status === "FAILED" ? (
                  <div className="grid gap-2">
                    <Notice tone="danger">
                      {s.errorMessage}
                      {s.errorIssues.length ? <span className="mt-1 block font-mono text-[11px]">{s.errorIssues.join(" · ")}</span> : null}
                    </Notice>
                    {canManage && v.run.status !== "CANCELLED" ? <RetryStep base={base} stepId={s.id} /> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </RevealGroup>
        </Card>
      ) : null}

      <RevealGroup className="grid gap-4 md:grid-cols-2">
        {key === "vision" ? (
          <Card variant="elevated">
            <CardHeader title={t("builder.journey.yourAnswers")} />
            <CardBody className="grid gap-1.5 text-sm">
              <p>{v.run.brief.idea || t("builder.journey.fromSources")}</p>
              {v.run.brief.industry ? <p className="text-muted-foreground">{t("builder.brief.industry")}: {v.run.brief.industry}</p> : null}
              {v.sources.length ? <p className="text-muted-foreground">{t("builder.journey.pagesRead", { count: v.sources.filter((s) => s.status === "INGESTED").length })}</p> : null}
            </CardBody>
          </Card>
        ) : null}
        {key === "blueprint" ? (
          <Card variant="elevated">
            <CardHeader icon={<Building2 />} title={v.run.company.name} description={t("builder.journey.blueprintHint")} />
            <CardBody className="grid gap-2 text-sm">
              {strategy?.mission ? <p><span className="font-medium">{t("builder.journey.mission")}</span> {strategy.mission}</p> : null}
              {strategy?.vision ? <p><span className="font-medium">{t("builder.journey.vision")}</span> {strategy.vision}</p> : null}
              {strategy?.values.length ? <p className="text-muted-foreground">{strategy.values.join(" · ")}</p> : null}
              {!strategy?.mission ? <p className="text-muted-foreground">{t("builder.journey.notYet")}</p> : null}
            </CardBody>
          </Card>
        ) : null}
        {key === "products" ? (
          <Card variant="elevated">
            <CardHeader icon={<Package />} title={t("builder.run.products")} />
            <CardBody>
              {v.products.length ? (
                <ul className="grid gap-2 text-sm">
                  {v.products.map((p) => (
                    <li key={p.id}>
                      <Link className="font-medium hover:underline" href={`/${locale}/graph/${p.id}`}>{p.name}</Link>
                      {p.description ? <span className="block text-xs text-muted-foreground">{p.description}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("builder.journey.notYet")}</p>
              )}
            </CardBody>
          </Card>
        ) : null}
        {key === "workforce" ? (
          <Card variant="elevated">
            <CardHeader icon={<Bot />} title={t("builder.run.aiEmployees")} description={t("builder.journey.workforceHint")} />
            <CardBody>
              {v.aiEmployees.length ? (
                <ul className="grid gap-2 text-sm">
                  {v.aiEmployees.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-2">
                      <LiveDot tone={e.status === "PAUSED" ? "neutral" : "success"} pulse={false} />
                      <Link className="font-medium hover:underline" href={`/${locale}/workforce/${e.id}`}>{e.name}</Link>
                      <span className="text-xs text-muted-foreground">{t(`profiles.${e.profileKey}.name`)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("builder.journey.notYet")}</p>
              )}
            </CardBody>
          </Card>
        ) : null}
        {key === "structure" ? (
          <>
            <Card variant="elevated">
              <CardHeader icon={<Building2 />} title={t("builder.run.structure")} />
              <CardBody>
                {v.departments.length ? (
                  <ul className="grid gap-2 text-sm">
                    {v.departments.map((d) => (
                      <li key={d.id}>
                        <span className="font-medium">{d.name}</span>
                        {d.teams.length ? <span className="block text-xs text-muted-foreground">{d.teams.map((x) => x.name).join(", ")}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("builder.journey.notYet")}</p>
                )}
              </CardBody>
            </Card>
            <Card variant="elevated">
              <CardHeader icon={<FolderKanban />} title={t("builder.run.projects")} />
              <CardBody className="grid gap-3">
                <div className="grid grid-cols-3 gap-2">
                  <StatTile label={t("builder.entities.project")} value={v.projects.length} />
                  <StatTile label={t("builder.entities.work_task")} value={tasks} index={1} />
                  <StatTile label={t("builder.sections.workflows")} value={workflows} index={2} href={`/${locale}/workflows`} />
                </div>
                <ul className="grid gap-1 text-sm">
                  {v.projects.map((p) => (
                    <li key={p.id}>
                      <Link className="hover:underline" href={`/${locale}/projects/${p.id}`}>{p.name}</Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          </>
        ) : null}
        {key === "goals" ? (
          <>
            <Card variant="elevated">
              <CardHeader icon={<Target />} title={t("builder.run.objectives")} actions={<Link className="text-xs text-primary hover:underline" href={`/${locale}/objectives`}>{t("builder.run.view")}</Link>} />
              <CardBody>
                {goals.length || v.objectives.length ? (
                  <ul className="grid gap-1.5 text-sm">
                    {goals.map((g) => (
                      <li key={g.id} className="font-medium">{g.title}</li>
                    ))}
                    {v.objectives.map((o) => (
                      <li key={o.id} className="text-muted-foreground">{o.title}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("builder.journey.notYet")}</p>
                )}
              </CardBody>
            </Card>
            <Card variant="elevated">
              <CardHeader icon={<Wallet />} title={t("builder.journey.finance")} actions={<Link className="text-xs text-primary hover:underline" href={`/${locale}/finance`}>{t("builder.run.view")}</Link>} />
              <CardBody className="grid grid-cols-2 gap-2">
                <StatTile label={t("builder.journey.cashItems")} value={cashItems} />
                <StatTile label={t("builder.journey.budgets")} value={budgets} index={1} />
              </CardBody>
            </Card>
          </>
        ) : null}
        {key === "command" ? (
          <Card variant="highlight" className="md:col-span-2">
            <CardHeader title={t("builder.journey.summary")} description={v.run.status === "COMPLETED" ? t("builder.run.completed") : t("builder.journey.stillWorking")} />
            <CardBody className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile label={t("builder.run.documents")} value={[...v.docs.values()].length} icon={<FileText />} />
              <StatTile label={t("builder.entities.department")} value={v.departments.length} index={1} icon={<Building2 />} />
              <StatTile label={t("builder.run.aiEmployees")} value={v.aiEmployees.length} index={2} icon={<Bot />} />
              <StatTile label={t("builder.entities.project")} value={v.projects.length} index={3} icon={<FolderKanban />} />
              <StatTile label={t("builder.entities.objective")} value={v.objectives.length} index={4} icon={<Target />} />
              <StatTile label={t("builder.journey.cashItems")} value={cashItems} index={5} icon={<Wallet />} />
            </CardBody>
          </Card>
        ) : null}
        {docs.length && key !== "command" ? (
          <Card>
            <CardHeader icon={<FileText />} title={t("builder.run.documents")} />
            <CardBody>
              <ul className="grid gap-1.5 text-sm">
                {docs.map((s) => (
                  <li key={s.id}>
                    <Link className="hover:underline" href={`/${locale}/brain/${s.brainDocumentId}`}>{t(`builder.steps.${s.key}`)}</Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}
      </RevealGroup>

      <JourneyNav
        stage={stage}
        total={JOURNEY.length}
        nextLabel={key === "command" ? t("builder.journey.enter") : stageDone ? t("common.continue") : t("builder.journey.continueWhileWorking")}
        finishHref={`/${locale}`}
      />
      <p className="text-center text-xs text-muted-foreground">
        <Link className="hover:underline" href={`/${locale}/builder/${runId}`}>{t("builder.journey.fullWorkspace")}</Link>
      </p>
    </div>
  );
}
