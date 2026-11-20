import type { Metadata } from "next";
import Link from "next/link";
import { EditGoalDialog, GoalStatusSelect, NewGoalForm } from "@/components/objectives/goal-forms";
import { DeleteButton } from "@/components/objectives/objective-forms";
import { ProgressBar } from "@/components/objectives/progress";
import { ObjectivesTabs } from "@/components/objectives/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { GOAL_HORIZONS, GOAL_STATUSES, listGoals, type GoalFilters } from "@/server/modules/objectives/goals";
import { average, evaluateObjectives } from "@/server/modules/objectives/key-results";
import { objectiveOwnerOptions } from "@/server/modules/objectives/pickers";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("objectives.goals.heading") };
}

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const oneOf = <T extends string>(values: readonly T[], v?: string) => (v && (values as readonly string[]).includes(v) ? (v as T) : undefined);

export default async function GoalsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <h1 className="text-lg font-semibold tracking-tight">{t("objectives.goals.heading")}</h1>
        <p className="text-muted-foreground">{t("objectives.goals.subtitle")}</p>
      </div>
      <ObjectivesTabs locale={locale} active="goals" />
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
  const [canRead, canManage, canRun] = await Promise.all([can(viewer.ctx, "objectives.read", chain), can(viewer.ctx, "objectives.manage", chain), can(viewer.ctx, "agents.run", chain)]);
  if (!canRead) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </div>
    );
  }
  const sp = await searchParams;
  const filters: GoalFilters = { q: first(sp.q)?.slice(0, 200), status: oneOf(GOAL_STATUSES, first(sp.status)), horizon: oneOf(GOAL_HORIZONS, first(sp.horizon)) };
  const [goals, people, pillars] = await Promise.all([
    listGoals(viewer.ctx, org.id, company.id, filters),
    canManage ? objectiveOwnerOptions(org.id, chain) : [],
    db().strategyPillar.findMany({ where: { organizationId: org.id, companyId: company.id }, orderBy: { position: "asc" }, select: { id: true, title: true } }),
  ]);
  const objectives = await db().objective.findMany({
    where: { organizationId: org.id, companyId: company.id, goalId: { in: goals.map((g) => g.id) }, status: { not: "ABANDONED" } },
    include: { keyResults: true, milestones: { select: { completedAt: true } } },
  });
  const evaluated = await evaluateObjectives(viewer.ctx, org.id, company.id, objectives, chain);
  const progressOf = (goalId: string) => average(objectives.flatMap((o, i) => (o.goalId === goalId ? [o.status === "ACHIEVED" ? 1 : (evaluated.objectives[i] ?? null)] : [])));
  const base = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const pillarOptions = pillars.map((p) => ({ id: p.id, name: p.title }));
  const canPlan = canManage && canRun && aiConfigured();

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <Card>
        <CardHeader title={t("objectives.goals.heading")} description={t("objectives.goals.count", { count: goals.length })} />
        {canManage ? <NewGoalForm base={base} locale={locale} people={people} pillars={pillarOptions} canPlan={canPlan} /> : null}
        {canManage && !canPlan ? <p className="px-3 pt-3 text-xs text-muted-foreground">{aiConfigured() ? t("objectives.plan.noRunPermission") : t("objectives.plan.aiNotConfigured")}</p> : null}
        <form className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_auto] sm:items-end" role="search">
          <Input name="q" defaultValue={filters.q} placeholder={t("common.searchPlaceholder")} aria-label={t("common.searchPlaceholder")} />
          <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("common.status")}>
            <option value="">{t("common.all")}</option>
            {GOAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`objectives.status.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="horizon" defaultValue={filters.horizon ?? ""} aria-label={t("objectives.goals.horizon")}>
            <option value="">{t("objectives.goals.allHorizons")}</option>
            {GOAL_HORIZONS.map((h) => (
              <option key={h} value={h}>
                {t(`objectives.goals.horizons.${h}`)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {t("objectives.filter")}
          </Button>
        </form>
        {goals.length === 0 ? (
          <p className="p-4 text-muted-foreground">{filters.q || filters.status || filters.horizon ? t("common.noResults") : t("objectives.goals.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("objectives.goals.title")}</Th>
                <Th>{t("objectives.goals.horizon")}</Th>
                <Th>{t("objectives.targetDate")}</Th>
                <Th>{t("objectives.owner")}</Th>
                <Th>{t("objectives.list")}</Th>
                <Th>{t("objectives.overallProgress")}</Th>
                <Th>{t("objectives.plan.heading")}</Th>
                <Th>
                  <span className="sr-only">{t("common.actions")}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {goals.map((g) => {
                const p = progressOf(g.id);
                return (
                  <Tr key={g.id}>
                    <Td className="min-w-56 font-medium">
                      {g.title}
                      {g.pillar ? <div className="text-xs font-normal text-muted-foreground">{g.pillar.title}</div> : null}
                    </Td>
                    <Td>
                      <Badge>{t(`objectives.goals.horizons.${g.horizon}`)}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap">{g.targetDate ? formatDate(g.targetDate, locale, "UTC") : "—"}</Td>
                    <Td>{g.owner?.name ?? "—"}</Td>
                    <Td className="tabular">
                      <Link className="hover:underline" href={`/${locale}/objectives?goal=${g.id}`}>
                        {g._count.objectives}
                      </Link>
                    </Td>
                    <Td className="min-w-32">
                      <div className="grid gap-1">
                        <span className="tabular text-xs">{p === null ? "—" : formatNumber(p, locale, { style: "percent", maximumFractionDigits: 0 })}</span>
                        <ProgressBar value={p} label={g.title} />
                      </div>
                    </Td>
                    <Td>
                      <Link className="text-xs text-primary hover:underline" href={`/${locale}/objectives/plan/${g.id}`}>
                        {g.planAppliedAt ? t("objectives.plan.applied") : g.planTaskId ? t("objectives.plan.review") : t("objectives.plan.open")}
                      </Link>
                    </Td>
                    <Td className="text-end">
                      {canManage ? (
                        <span className="flex items-center justify-end gap-1">
                          <GoalStatusSelect base={base} goalId={g.id} status={g.status} />
                          <EditGoalDialog
                            base={base}
                            people={people}
                            pillars={pillarOptions}
                            goal={{ id: g.id, title: g.title, description: g.description ?? "", horizon: g.horizon, ownerId: g.ownerId ?? "", pillarId: g.pillarId ?? "", targetDate: iso(g.targetDate) }}
                          />
                          <DeleteButton endpoint={`${base}/goals/${g.id}`} label={t("objectives.goals.delete")} confirmText={t("objectives.goals.deleteConfirm", { title: g.title })} />
                        </span>
                      ) : (
                        <Badge>{t(`objectives.status.${g.status}`)}</Badge>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
