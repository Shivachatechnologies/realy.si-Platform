import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Gauge, UserPlus, Users } from "lucide-react";
import { OrgChart, type OrgChartNode } from "@/components/workforce/org-chart";
import { HeaderStrip } from "@/components/workforce/header-strip";
import { PageHeader } from "@/components/workforce/page-header";
import { PageState } from "@/components/workforce/states";
import { WorkforceTabs } from "@/components/workforce/workforce-tabs";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { formatMoney, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { profileByKey } from "@/server/modules/agents/profiles";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { AUTONOMY_MODE } from "@/server/modules/workforce/autonomy";
import { employeeBudget } from "@/server/modules/workforce/budgets";
import { workforcePerformance } from "@/server/modules/workforce/performance";
import { microsToCents } from "@/server/modules/workforce/pricing";
import { listEmployees, liveActivity, orgChart, type OrgNode } from "@/server/modules/workforce/service";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workforce.org.title") };
}

/** Org chart: founder → AI CEO → department managers → specialists, with live work, success, cost and budgets. */
export default async function OrgChartPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const tabs = <WorkforceTabs locale={locale} active="org" labels={{ employees: t("workforce.tabs.employees"), org: t("workforce.tabs.org"), hire: t("workforce.tabs.hire"), usage: t("workforce.tabs.usage"), plans: t("workforce.tabs.plans"), tasks: t("workforce.tabs.tasks") }} />;
  const header = (
    <>
      <PageHeader eyebrow={t("modules.workforce.title")} title={t("workforce.org.title")} subtitle={t("workforce.org.subtitle")} />
      {tabs}
    </>
  );
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "agents.read", chain), can(viewer.ctx, "agents.manage", chain)]);
  if (!canRead) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;

  const [chart, employees] = await Promise.all([orgChart(viewer.ctx, org.id, company.id), listEmployees(viewer.ctx, org.id, company.id)]);
  const ids = employees.map((e) => e.id);
  const [perf, live, budgets] = await Promise.all([
    workforcePerformance(org.id, company.id, employees),
    liveActivity(org.id, company.id, ids, 1),
    Promise.all(employees.map(async (e) => [e.id, await employeeBudget(org.id, company.id, e)] as const)).then((r) => new Map(r)),
  ]);
  const queued = new Map<string, number>();
  for (const r of await db().agentTask.groupBy({ by: ["aiEmployeeId"], where: { organizationId: org.id, companyId: company.id, aiEmployeeId: { in: ids }, status: "QUEUED" }, _count: { _all: true } })) {
    queued.set(r.aiEmployeeId!, r._count._all);
  }
  const byId = new Map(employees.map((e) => [e.id, e]));
  const usd = (micros: number) => formatMoney({ amountMinor: microsToCents(micros), currency: "USD" }, locale);
  const deptLabel = (k: string) => {
    const v = t(`workforce.departments.${k}`);
    return v === `workforce.departments.${k}` ? k : v;
  };
  const share = (used: number, budget: number | null) => (budget ? used / budget : null);

  const toNode = (n: OrgNode): OrgChartNode => {
    const e = byId.get(n.id)!;
    const s = perf.byEmployee.get(n.id);
    const b = budgets.get(n.id);
    const l = live.get(n.id);
    const uses = b
      ? [share(b.employee.tokensUsed, b.employee.tokenBudget), share(b.employee.costCentsUsed, b.employee.costBudgetCents), b.department ? share(b.department.tokensUsed, b.department.tokenBudget) : null, b.department ? share(b.department.costCentsUsed, b.department.costBudgetCents) : null].filter((v): v is number => v !== null)
      : [];
    return {
      id: n.id,
      name: n.name,
      department: n.department,
      departmentLabel: deptLabel(n.department),
      level: n.level,
      levelLabel: t(`workforce.levels.${n.level}.name`),
      roleLabel: n.jobTitle ?? (profileByKey(n.profileKey) ? t(`profiles.${n.profileKey}.name`) : n.profileKey),
      paused: n.status === "PAUSED",
      working: l?.current?.status === "RUNNING" ? l.current.title : null,
      queued: queued.get(n.id) ?? 0,
      successRate: s?.successRate ?? null,
      completed: s?.completed ?? 0,
      costLabel: usd(s?.costMicros ?? 0),
      budgetUse: uses.length ? Math.max(...uses) : null,
      openEscalations: s?.escalationsOpen ?? 0,
      autonomyMode: AUTONOMY_MODE[e.autonomy],
      autonomyLabel: t(`workforce.autonomyModes.${AUTONOMY_MODE[e.autonomy]}`),
      reports: n.reports.map(toNode),
    };
  };
  const roots = chart.roots.map(toNode);
  const founderName = chart.founders.length ? chart.founders.map((f) => f.name).join(", ") : t("workforce.org.founder");
  const levels = { EXECUTIVE: 0, MANAGER: 0, SPECIALIST: 0 };
  for (const e of employees) levels[e.level]++;
  const running = [...live.values()].filter((l) => l.current?.status === "RUNNING").length;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5">
      <PageHeader
        eyebrow={t("modules.workforce.title")}
        title={t("workforce.org.title")}
        subtitle={t("workforce.org.subtitle")}
        actions={
          canManage ? (
            <Button asChild size="sm" magnetic>
              <Link href={`/${locale}/workforce/hire`}>
                <UserPlus aria-hidden />
                {t("workforce.hire.title")}
              </Link>
            </Button>
          ) : null
        }
      />
      {tabs}
      <AutoRefresh active={running > 0} intervalMs={10_000} />
      <HeaderStrip t={t} what={t("workforce.org.strip.what")} why={t("workforce.org.strip.why")} can={t("workforce.org.strip.can")} next={chart.count ? t("workforce.org.strip.next") : t("workforce.strip.nextHire")} />
      {chart.count === 0 ? (
        <Card variant="immersive">
          <CardBody className="grid justify-items-start gap-3 py-10">
            <Users aria-hidden className="size-8 text-primary" />
            <p className="max-w-xl text-muted-foreground">{t("workforce.empty")}</p>
            {canManage ? (
              <Button asChild size="sm">
                <Link href={`/${locale}/workforce/hire`}>{t("workforce.hire.title")}</Link>
              </Button>
            ) : null}
          </CardBody>
        </Card>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border bg-surface p-3">
              <dt className="text-xs text-muted-foreground">{t("workforce.org.summary.team")}</dt>
              <dd className="font-display text-2xl tabular-nums">{formatNumber(employees.length, locale)}</dd>
              <dd className="text-xs text-muted-foreground">{t("workforce.org.summary.levels", { executives: levels.EXECUTIVE, managers: levels.MANAGER, specialists: levels.SPECIALIST })}</dd>
            </div>
            <div className="rounded-xl border bg-surface p-3">
              <dt className="text-xs text-muted-foreground">{t("workforce.org.summary.success", { days: perf.days })}</dt>
              <dd className="font-display text-2xl tabular-nums">{perf.total.successRate === null ? "—" : formatNumber(perf.total.successRate, locale, { style: "percent" })}</dd>
              <dd className="text-xs text-muted-foreground">{t("workforce.org.summary.finished", { completed: perf.total.completed, failed: perf.total.failed })}</dd>
            </div>
            <div className="rounded-xl border bg-surface p-3">
              <dt className="text-xs text-muted-foreground">{t("workforce.org.summary.cost", { days: perf.days })}</dt>
              <dd className="font-display text-2xl tabular-nums">{usd(perf.total.costMicros)}</dd>
              <dd className="text-xs text-muted-foreground">
                <Link className="inline-flex min-h-6 items-center gap-1 text-primary hover:underline" href={`/${locale}/workforce/performance`}>
                  <Gauge aria-hidden className="size-3" />
                  {t("workforce.tabs.performance")}
                </Link>
              </dd>
            </div>
            <div className="rounded-xl border bg-surface p-3">
              <dt className="text-xs text-muted-foreground">{t("workforce.org.summary.escalations")}</dt>
              <dd className="font-display text-2xl tabular-nums">{formatNumber(perf.total.escalationsOpen, locale)}</dd>
              <dd className="text-xs text-muted-foreground">
                <Link className="inline-flex min-h-6 items-center gap-1 text-primary hover:underline" href={`/${locale}/workforce/escalations`}>
                  <AlertTriangle aria-hidden className="size-3" />
                  {t("workforce.tabs.escalations")}
                </Link>
              </dd>
            </div>
          </dl>
          <OrgChart
            roots={roots}
            founderName={founderName}
            locale={locale}
            labels={{
              founderRole: t("workforce.org.founderRole"),
              working: t("workforce.org.node.working"),
              idle: t("workforce.org.node.idle"),
              paused: t("workforce.status.PAUSED"),
              success: t("workforce.org.node.success"),
              noTasks: t("workforce.org.node.noTasks"),
              budget: t("workforce.org.node.budget"),
              overBudget: t("workforce.org.node.overBudget"),
              escalations: t("workforce.org.node.escalations"),
              allDepartments: t("workforce.org.node.allDepartments"),
              filter: t("workforce.org.node.filter"),
              queued: t("workforce.org.node.queued"),
            }}
          />
          <p className="text-xs text-muted-foreground">{t("workforce.org.hint")}</p>
        </>
      )}
    </div>
  );
}
