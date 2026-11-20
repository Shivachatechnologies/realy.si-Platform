import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Clock, Coins, GitBranch, Target, Timer } from "lucide-react";
import { AiAvatar, avatarPalette } from "@/components/graphics/ai-avatar";
import { DepartmentBudgetForm } from "@/components/workforce/department-budget-form";
import { HeaderStrip } from "@/components/workforce/header-strip";
import { PageHeader } from "@/components/workforce/page-header";
import { PageState } from "@/components/workforce/states";
import { WorkforceTabs } from "@/components/workforce/workforce-tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { formatMoney, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { profileByKey } from "@/server/modules/agents/profiles";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { AUTONOMY_MODE } from "@/server/modules/workforce/autonomy";
import { employeeBudget, listDepartmentBudgets, type BudgetLine } from "@/server/modules/workforce/budgets";
import { workforcePerformance, type Scorecard } from "@/server/modules/workforce/performance";
import { microsToCents } from "@/server/modules/workforce/pricing";
import { listEmployees } from "@/server/modules/workforce/service";
import { requireOrgContext } from "@/server/workspace";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workforce.performance.title") };
}

const WINDOWS = [7, 30, 90] as const;

/** A thin meter with an honest label (no budget → no meter). */
function Meter({ used, budget, label }: { used: number; budget: number | null; label: string }) {
  if (budget === null) return null;
  const share = budget > 0 ? used / budget : 1;
  return (
    <span className="grid gap-1">
      <span className="h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, share) * 100)} aria-label={label}>
        <span className={cn("block h-full rounded-full", share >= 1 ? "bg-danger" : share > 0.8 ? "bg-warning" : "bg-primary")} style={{ width: `${Math.min(100, share * 100)}%` }} />
      </span>
    </span>
  );
}

/**
 * Performance & budgets: success rate, turnaround, run time and cost of every AI employee and department, computed
 * from real task rows over a window, plus department AI budgets (set here, enforced before and during runs).
 */
export default async function PerformancePage({ searchParams }: PageProps<"/[locale]/workforce/performance">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const tabs = <WorkforceTabs locale={locale} active="performance" labels={{ employees: t("workforce.tabs.employees"), org: t("workforce.tabs.org"), hire: t("workforce.tabs.hire"), usage: t("workforce.tabs.usage"), plans: t("workforce.tabs.plans"), tasks: t("workforce.tabs.tasks") }} />;
  const header = (
    <>
      <PageHeader eyebrow={t("modules.workforce.title")} title={t("workforce.performance.title")} subtitle={t("workforce.performance.subtitle")} />
      {tabs}
    </>
  );
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "agents.read", chain), can(viewer.ctx, "agents.manage", chain)]);
  if (!canRead) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;

  const sp = await searchParams;
  const rawDays = Number(Array.isArray(sp.days) ? sp.days[0] : sp.days);
  const days = (WINDOWS as readonly number[]).includes(rawDays) ? rawDays : 30;
  const employees = await listEmployees(viewer.ctx, org.id, company.id);
  const [perf, depts, budgets] = await Promise.all([
    workforcePerformance(org.id, company.id, employees, days),
    listDepartmentBudgets(viewer.ctx, org.id, company.id),
    Promise.all(employees.map(async (e) => [e.id, await employeeBudget(org.id, company.id, e)] as const)).then((r) => new Map(r)),
  ]);
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const usd = (micros: number) => formatMoney({ amountMinor: microsToCents(micros), currency: "USD" }, locale);
  const cents = (c: number) => formatMoney({ amountMinor: BigInt(c), currency: "USD" }, locale);
  const pctf = (v: number | null) => (v === null ? "—" : formatNumber(v, locale, { style: "percent" }));
  const dur = (ms: number | null) => {
    if (ms === null) return "—";
    const min = ms / 60_000;
    if (min < 1) return formatNumber(Math.max(1, Math.round(ms / 1000)), locale, { style: "unit", unit: "second", unitDisplay: "short" });
    if (min < 90) return formatNumber(Math.round(min), locale, { style: "unit", unit: "minute", unitDisplay: "short" });
    if (min < 60 * 36) return formatNumber(Math.round(min / 6) / 10, locale, { style: "unit", unit: "hour", unitDisplay: "short" });
    return formatNumber(Math.round(min / 144) / 10, locale, { style: "unit", unit: "day", unitDisplay: "short" });
  };
  const deptLabel = (k: string) => {
    const v = t(`workforce.departments.${k}`);
    return v === `workforce.departments.${k}` ? k : v;
  };
  const tok = (n: number) => formatNumber(n, locale, { notation: "compact" });
  const lineText = (l: BudgetLine) =>
    [l.costBudgetCents !== null ? t("workforce.budgets.costOf", { used: cents(l.costCentsUsed), budget: cents(l.costBudgetCents) }) : null, l.tokenBudget !== null ? t("workforce.budgets.tokensOf", { used: tok(l.tokensUsed), budget: tok(l.tokenBudget) }) : null].filter(Boolean).join(" · ");
  const ranked = [...employees].sort((a, b) => (perf.byEmployee.get(b.id)?.completed ?? 0) - (perf.byEmployee.get(a.id)?.completed ?? 0) || a.name.localeCompare(b.name));
  const tot = perf.total;
  const tiles: { icon: typeof Target; label: string; value: string; sub?: string }[] = [
    { icon: Target, label: t("workforce.performance.successRate"), value: pctf(tot.successRate), sub: t("workforce.org.summary.finished", { completed: tot.completed, failed: tot.failed }) },
    { icon: Clock, label: t("workforce.performance.turnaround"), value: dur(tot.medianTurnaroundMs), sub: t("workforce.performance.turnaroundHint") },
    { icon: Timer, label: t("workforce.performance.runTime"), value: dur(tot.avgRunMs) },
    { icon: Coins, label: t("workforce.performance.cost"), value: usd(tot.costMicros), sub: tot.costPerCompletedMicros === null ? undefined : t("workforce.performance.perTask", { cost: usd(tot.costPerCompletedMicros) }) },
    { icon: GitBranch, label: t("workforce.performance.delegated"), value: formatNumber(tot.delegated, locale) },
    { icon: AlertTriangle, label: t("workforce.performance.escalations"), value: formatNumber(tot.escalationsFiled, locale), sub: t("workforce.performance.openNow", { count: tot.escalationsOpen }) },
  ];
  const rowStats = (s: Scorecard | undefined) => s ?? null;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5">
      <PageHeader eyebrow={t("modules.workforce.title")} title={t("workforce.performance.title")} subtitle={t("workforce.performance.subtitle")} />
      {tabs}
      <HeaderStrip t={t} what={t("workforce.performance.strip.what")} why={t("workforce.performance.strip.why")} can={t("workforce.performance.strip.can")} next={depts.some((d) => d.configured) ? t("workforce.performance.strip.nextReview") : t("workforce.performance.strip.nextBudget")} />

      <nav className="flex flex-wrap items-center gap-1.5" aria-label={t("workforce.performance.window")}>
        <span className="me-1 text-xs text-muted-foreground">{t("workforce.performance.window")}</span>
        {WINDOWS.map((d) => (
          <Link key={d} href={`/${locale}/workforce/performance?days=${d}`} aria-current={d === days ? "page" : undefined} className={cn("inline-flex min-h-9 items-center rounded-full border px-3 text-xs", d === days ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-foreground")}>
            {t("workforce.performance.days", { days: d })}
          </Link>
        ))}
      </nav>

      {employees.length === 0 ? (
        <Card variant="immersive">
          <CardBody className="grid justify-items-start gap-2 py-8 text-muted-foreground">
            {t("workforce.empty")}
            <Link className="text-primary hover:underline" href={`/${locale}/workforce/hire`}>
              {t("workforce.hire.title")}
            </Link>
          </CardBody>
        </Card>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {tiles.map((x) => (
              <div key={x.label} className="grid content-start gap-1 rounded-xl border bg-surface p-3">
                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <x.icon aria-hidden className="size-3.5 text-primary" />
                  {x.label}
                </dt>
                <dd className="font-display text-2xl tabular-nums">{x.value}</dd>
                {x.sub ? <dd className="text-[11px] text-muted-foreground">{x.sub}</dd> : null}
              </div>
            ))}
          </dl>

          <section className="grid gap-3" aria-labelledby="dept-heading">
            <div className="grid gap-1">
              <h2 id="dept-heading" className="font-display text-xl">
                {t("workforce.performance.departments")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("workforce.budgets.hint")}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {depts.map((d) => {
                const s = perf.byDepartment.get(d.department);
                const p = avatarPalette(d.department, d.department);
                return (
                  <Card key={d.department} className="relative overflow-hidden">
                    <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${p.from}, ${p.to})` }} />
                    <CardBody className="grid gap-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="grid">
                          <span className="font-medium">{deptLabel(d.department)}</span>
                          <span className="text-xs text-muted-foreground">{t("workforce.performance.employeesCount", { count: d.employees })}</span>
                        </div>
                        {d.exhausted ? <Badge tone="danger">{t("workforce.budgets.exhausted")}</Badge> : d.configured ? <Badge tone="info">{t("workforce.budgets.limited")}</Badge> : <Badge>{t("workforce.budgets.unlimited")}</Badge>}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        <span className="grid rounded-lg bg-muted/50 p-2">
                          <span className="font-display text-lg tabular-nums">{pctf(s?.successRate ?? null)}</span>
                          <span className="text-muted-foreground">{t("workforce.performance.successShort")}</span>
                        </span>
                        <span className="grid rounded-lg bg-muted/50 p-2">
                          <span className="font-display text-lg tabular-nums">{dur(s?.medianTurnaroundMs ?? null)}</span>
                          <span className="text-muted-foreground">{t("workforce.performance.turnaroundShort")}</span>
                        </span>
                        <span className="grid rounded-lg bg-muted/50 p-2">
                          <span className="font-display text-lg tabular-nums">{usd(s?.costMicros ?? 0)}</span>
                          <span className="text-muted-foreground">{t("workforce.performance.costShort", { days })}</span>
                        </span>
                      </div>
                      <div className="grid gap-1 text-xs">
                        <span className="text-muted-foreground">{t("workforce.budgets.thisMonth")}: {d.configured ? lineText(d) : t("workforce.budgets.spentNoLimit", { cost: cents(d.costCentsUsed), tokens: tok(d.tokensUsed) })}</span>
                        <Meter used={d.costCentsUsed} budget={d.costBudgetCents} label={t("workforce.budgets.costBudget")} />
                        <Meter used={d.tokensUsed} budget={d.tokenBudget} label={t("workforce.form.budget")} />
                      </div>
                      {canManage ? (
                        <details className="text-sm">
                          <summary className="min-h-9 cursor-pointer py-2 text-primary">{d.configured ? t("workforce.budgets.edit") : t("workforce.budgets.set")}</summary>
                          <DepartmentBudgetForm path={`${apiBase}/workforce/budgets`} department={d.department} tokens={d.tokenBudget} costCents={d.costBudgetCents} />
                        </details>
                      ) : null}
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          </section>

          <Card>
            <CardHeader title={t("workforce.performance.employees")} description={t("workforce.performance.employeesHint", { days })} />
            <ul className="divide-y">
              {ranked.map((e) => {
                const s = rowStats(perf.byEmployee.get(e.id));
                const b = budgets.get(e.id);
                const finished = (s?.completed ?? 0) + (s?.failed ?? 0);
                return (
                  <li key={e.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] md:items-center">
                    <Link href={`/${locale}/workforce/${e.id}`} className="flex min-w-0 items-center gap-2.5 hover:underline">
                      <AiAvatar seed={e.id} department={e.department} size={36} active={(s?.active ?? 0) > 0} />
                      <span className="grid min-w-0">
                        <span className="truncate font-medium">{e.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {e.jobTitle ?? (profileByKey(e.profileKey) ? t(`profiles.${e.profileKey}.name`) : e.profileKey)} · {t(`workforce.autonomyModes.${AUTONOMY_MODE[e.autonomy]}`)}
                        </span>
                      </span>
                    </Link>
                    <span className="grid gap-1 text-xs">
                      <span className="text-muted-foreground">{t("workforce.performance.successRate")}</span>
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          {s?.successRate !== null && s?.successRate !== undefined ? <span className={cn("block h-full rounded-full", s.successRate >= 0.8 ? "bg-success" : s.successRate >= 0.5 ? "bg-warning" : "bg-danger")} style={{ width: `${s.successRate * 100}%` }} /> : null}
                        </span>
                        <span className="tabular-nums">{pctf(s?.successRate ?? null)}</span>
                      </span>
                      <span className="text-muted-foreground">{t("workforce.performance.finishedCount", { count: finished, failed: s?.failed ?? 0 })}</span>
                    </span>
                    <span className="grid text-xs">
                      <span className="text-muted-foreground">{t("workforce.performance.turnaround")}</span>
                      <span className="tabular-nums">{dur(s?.medianTurnaroundMs ?? null)}</span>
                      <span className="text-muted-foreground">{t("workforce.performance.runTimeShort", { time: dur(s?.avgRunMs ?? null) })}</span>
                    </span>
                    <span className="grid text-xs">
                      <span className="text-muted-foreground">{t("workforce.performance.cost")}</span>
                      <span className="tabular-nums">{usd(s?.costMicros ?? 0)}</span>
                      <span className="text-muted-foreground">{s?.costPerCompletedMicros != null ? t("workforce.performance.perTask", { cost: usd(s.costPerCompletedMicros) }) : "—"}</span>
                    </span>
                    <span className="grid gap-1 text-xs">
                      <span className="text-muted-foreground">{t("workforce.budgets.thisMonth")}</span>
                      {b && (b.employee.tokenBudget !== null || b.employee.costBudgetCents !== null) ? (
                        <>
                          <span>{lineText(b.employee)}</span>
                          <Meter used={b.employee.costCentsUsed} budget={b.employee.costBudgetCents} label={t("workforce.budgets.costBudget")} />
                          <Meter used={b.employee.tokensUsed} budget={b.employee.tokenBudget} label={t("workforce.form.budget")} />
                        </>
                      ) : (
                        <span>{t("workforce.budgets.spentNoLimit", { cost: cents(b?.employee.costCentsUsed ?? 0), tokens: tok(b?.employee.tokensUsed ?? 0) })}</span>
                      )}
                      {b?.exhausted ? <Badge tone="danger">{b.exhausted.scope === "employee" ? t("workforce.budgets.employeeExhausted") : t("workforce.budgets.departmentExhausted")}</Badge> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
          <p className="text-xs text-muted-foreground">{t("workforce.performance.footnote")}</p>
        </>
      )}
    </div>
  );
}
