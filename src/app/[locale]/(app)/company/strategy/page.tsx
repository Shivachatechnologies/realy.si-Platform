import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import Link from "next/link";
import { CheckCircle2, Circle, FolderKanban, Target } from "lucide-react";
import { KrStatusBadge, ProgressBar } from "@/components/objectives/progress";
import { StrategyForm } from "@/components/objectives/strategy-form";
import { CompanyTabs } from "@/components/objectives/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { getStrategy, goalTree } from "@/server/modules/objectives/goals";
import { average, evaluateObjectives } from "@/server/modules/objectives/key-results";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("strategy.title") };
}

export default async function StrategyPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <div className="grid gap-3">
      <PageHeader variant="editorial" world="command" eyebrow={t("dna.worlds.command")} title={t("strategy.title")} description={t("strategy.subtitle")} />
      <CompanyTabs locale={locale} active="strategy" />
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
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "objectives.read", chain), can(viewer.ctx, "objectives.manage", chain)]);
  if (!canRead) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </div>
    );
  }
  const [strategy, tree] = await Promise.all([getStrategy(viewer.ctx, org.id, company.id), goalTree(viewer.ctx, org.id, company.id)]);
  const objectives = tree.goals.flatMap((g) => g.objectives);
  const evaluated = await evaluateObjectives(viewer.ctx, org.id, company.id, objectives, chain);
  const objectiveProgress = new Map(objectives.map((o, i) => [o.id, o.status === "ACHIEVED" ? 1 : (evaluated.objectives[i] ?? null)]));
  const base = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const pct = (v: number | null) => (v === null ? "—" : formatNumber(v, locale, { style: "percent", maximumFractionDigits: 0 }));

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <Card>
        <CardHeader title={t("strategy.foundations")} description={t("strategy.foundationsHint")} />
        <CardBody>
          {canManage ? (
            <StrategyForm
              base={base}
              initial={{
                mission: strategy.mission ?? "",
                vision: strategy.vision ?? "",
                values: strategy.values,
                pillars: strategy.pillars.map((p) => ({ id: p.id, title: p.title, description: p.description ?? "" })),
              }}
            />
          ) : (
            <dl className="grid gap-4 text-sm lg:grid-cols-2">
              <div>
                <dt className="font-medium">{t("strategy.mission")}</dt>
                <dd className="text-muted-foreground">{strategy.mission ?? t("command.notSet")}</dd>
              </div>
              <div>
                <dt className="font-medium">{t("strategy.vision")}</dt>
                <dd className="text-muted-foreground">{strategy.vision ?? t("command.notSet")}</dd>
              </div>
              <div>
                <dt className="font-medium">{t("strategy.values")}</dt>
                <dd className="flex flex-wrap gap-1">{strategy.values.length ? strategy.values.map((v) => <Badge key={v}>{v}</Badge>) : <span className="text-muted-foreground">{t("command.notSet")}</span>}</dd>
              </div>
              <div>
                <dt className="font-medium">{t("strategy.pillars")}</dt>
                <dd>
                  {strategy.pillars.length ? (
                    <ul className="grid gap-1">
                      {strategy.pillars.map((p) => (
                        <li key={p.id}>
                          <span className="font-medium">{p.title}</span>
                          {p.description ? <span className="text-muted-foreground"> — {p.description}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground">{t("strategy.noPillars")}</span>
                  )}
                </dd>
              </div>
            </dl>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t("strategy.tree")}
          description={t("strategy.treeHint")}
          actions={
            canManage ? (
              <Button asChild size="sm" variant="secondary">
                <Link href={`/${locale}/objectives/goals`}>{t("objectives.goals.manage")}</Link>
              </Button>
            ) : null
          }
        />
        {tree.goals.length === 0 ? (
          <CardBody className="text-sm text-muted-foreground">{t("objectives.goals.empty")}</CardBody>
        ) : (
          <ol className="divide-y">
            {tree.goals.map((g) => {
              const active = g.objectives.filter((o) => o.status !== "ABANDONED");
              const goalProgress = average(active.map((o) => objectiveProgress.get(o.id) ?? null));
              return (
                <li key={g.id} className="grid gap-3 p-4">
                  <div className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Target className="size-4 text-primary" aria-hidden />
                      <span className="font-semibold">{g.title}</span>
                      <Badge>{t(`objectives.goals.horizons.${g.horizon}`)}</Badge>
                      {g.status !== "ACTIVE" ? <Badge tone={g.status === "ACHIEVED" ? "success" : "neutral"}>{t(`objectives.status.${g.status}`)}</Badge> : null}
                      {g.pillar ? <Badge tone="accent">{g.pillar.title}</Badge> : null}
                      <span className="ms-auto text-xs text-muted-foreground">
                        {[g.owner?.name, g.targetDate ? formatDate(g.targetDate, locale, "UTC") : null].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ProgressBar value={goalProgress} label={g.title} />
                      <span className="tabular w-10 text-end text-xs">{pct(goalProgress)}</span>
                    </div>
                    {!g.objectives.length ? (
                      <Link href={`/${locale}/objectives/plan/${g.id}`} className="text-xs text-primary hover:underline">
                        {g.planTaskId ? t("objectives.plan.review") : t("objectives.plan.open")}
                      </Link>
                    ) : null}
                  </div>
                  {g.objectives.length ? (
                    <ul className="ms-3 grid gap-3 border-s ps-4">
                      {g.objectives.map((o) => {
                        const p = objectiveProgress.get(o.id) ?? null;
                        return (
                          <li key={o.id} className="grid gap-2">
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <Link href={`/${locale}/objectives?goal=${g.id}`} className="font-medium hover:underline">
                                {o.title}
                              </Link>
                              {o.department ? <Badge>{o.department.name}</Badge> : null}
                              {o.status !== "ACTIVE" ? <Badge>{t(`objectives.status.${o.status}`)}</Badge> : null}
                              <span className="tabular ms-auto text-xs text-muted-foreground">{pct(p)}</span>
                            </div>
                            <ProgressBar value={p} label={o.title} />
                            {o.keyResults.length ? (
                              <ul className="flex flex-wrap gap-1.5">
                                {o.keyResults.map((kr) => {
                                  const s = evaluated.keyResults.get(kr.id)?.status ?? "NO_DATA";
                                  return (
                                    <li key={kr.id} className="flex items-center gap-1 text-xs">
                                      <KrStatusBadge status={s} label={t(`objectives.kr.status.${s}`)} />
                                      <span className="text-muted-foreground">{kr.title}</span>
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : null}
                            {o.milestones.length ? (
                              <ul className="grid gap-1 text-sm">
                                {o.milestones.map((m) => {
                                  const c = m.projectId ? tree.taskCounts.get(m.projectId) : undefined;
                                  return (
                                    <li key={m.id} className="flex flex-wrap items-center gap-2">
                                      {m.completedAt ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <Circle className="size-4 text-muted-foreground" aria-hidden />}
                                      <span className={m.completedAt ? "text-muted-foreground line-through" : ""}>{m.title}</span>
                                      {m.dueDate ? <span className="text-xs text-muted-foreground">{formatDate(m.dueDate, locale, "UTC")}</span> : null}
                                      {m.project && tree.canProjects ? (
                                        <Link href={`/${locale}/projects/${m.project.id}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:underline">
                                          <FolderKanban className="size-3.5" aria-hidden />
                                          {m.project.name}
                                          <span className="tabular">· {t("strategy.taskCount", { done: c?.done ?? 0, total: c?.total ?? 0 })}</span>
                                        </Link>
                                      ) : null}
                                      {c && c.total ? <ProgressBar value={c.done / c.total} label={m.project?.name ?? m.title} className="w-24" /> : null}
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
