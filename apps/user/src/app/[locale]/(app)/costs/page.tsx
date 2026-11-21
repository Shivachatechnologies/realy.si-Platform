import type { Metadata } from "next";
import Link from "next/link";
import { Bell, CalendarDays, Database, Gauge, Receipt, TrendingUp, Wallet } from "lucide-react";
import { TrendChart } from "@/components/bi/charts";
import { BreakdownBars } from "@/components/costs/breakdown-bars";
import { BudgetForm } from "@/components/costs/budget-form";
import { ActionButton } from "@/components/workforce/action-button";
import { PageState } from "@/components/workforce/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { costOverview, type CostOverview } from "@/server/modules/costs/service";
import { BUDGET_DEPARTMENTS } from "@/server/modules/workforce/budgets";
import { requireOrgContext } from "@/server/workspace";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("costs.title") };
}

const RANGES = [7, 30, 90] as const;

/**
 * Costs dashboard: the unified cost ledger of the company — month to date, today, run-rate forecast, prompt-cache
 * savings, spend per day, breakdowns by department, AI employee, provider, model and kind, budgets with hard stops,
 * usage alerts and the latest spends. Real ledger rows only; an empty ledger shows an honest empty state.
 */
export default async function CostsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const sp = await searchParams;
  const days = RANGES.find((r) => String(r) === sp.days) ?? 30;
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = <PageHeader variant="editorial" world="finance" eyebrow={t("costs.eyebrow")} title={t("costs.title")} description={t("costs.subtitle")} />;
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "agents.read", chain), can(viewer.ctx, "agents.manage", chain)]);
  if (!canRead) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;

  let o: CostOverview;
  try {
    o = await costOverview(viewer.ctx, org.id, company.id, { days });
  } catch (err) {
    if (isAppError(err) && (err.code === "forbidden" || err.code === "not_found")) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Notice tone="danger" title={t("costs.error.title")}>
          {t("costs.error.body")}
        </Notice>
      </div>
    );
  }

  const tz = company.timezone ?? "UTC";
  const usd = (micros: string | number) => {
    const m = Number(micros);
    if (m > 0 && m < 10_000) return `< ${formatMoney({ amountMinor: 1n, currency: "USD" }, locale)}`;
    return formatMoney({ amountMinor: BigInt(Math.round(m / 10_000)), currency: "USD" }, locale);
  };
  const deptLabel = (k: string) => ((BUDGET_DEPARTMENTS as readonly string[]).includes(k) ? t(`workforce.departments.${k}`) : k === "unassigned" ? t("costs.by.unassigned") : k);
  const count = (n: number) => t("costs.by.count", { count: n });
  const base = `/api/v1/organizations/${org.id}/companies/${company.id}/costs`;
  const hasSpend = o.since !== null;
  const maxDay = o.byDay.reduce((m, d) => Math.max(m, Number(d.micros)), 0);
  const scopeLabel = (scope: string, key: string) => (scope === "DEPARTMENT" ? deptLabel(key) : scope === "AGENT" ? key : "");

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5">
      {header}

      <nav aria-label={t("costs.range.label")} className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{t("costs.range.label")}</span>
        {RANGES.map((r) => (
          <Link
            key={r}
            href={`/${locale}/costs?days=${r}`}
            aria-current={r === days ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1 text-sm", r === days ? "border-primary bg-primary/10 text-primary" : "bg-surface text-muted-foreground hover:bg-surface-2")}
          >
            {t(`costs.range.${r}`)}
          </Link>
        ))}
        <span className="ms-auto flex gap-3 text-sm">
          <Link className="text-primary hover:underline" href={`/${locale}/autopilot`}>
            {t("costs.links.autopilot")}
          </Link>
          <Link className="text-primary hover:underline" href={`/${locale}/workforce/usage`}>
            {t("costs.links.usage")}
          </Link>
        </span>
      </nav>

      {o.budgets.some((b) => b.reached && b.hardStop) ? (
        <Notice tone="danger" title={t("costs.budgets.reached")}>
          {o.budgets
            .filter((b) => b.reached && b.hardStop)
            .map((b) => `${t(`costs.budgets.scope.${b.scope}`)} ${scopeLabel(b.scope, b.label)}`.trim())
            .join(" · ")}
        </Notice>
      ) : null}

      <StatGrid>
        <StatTile index={0} label={t("costs.stats.month")} value={usd(o.totals.monthMicros)} icon={<Wallet />} hint={t("costs.stats.monthHint")} highlight />
        <StatTile index={1} label={t("costs.stats.today")} value={usd(o.totals.todayMicros)} icon={<CalendarDays />} live hint={t("costs.stats.todayHint")} />
        <StatTile index={2} label={t("costs.stats.forecast")} value={usd(o.totals.projectedMonthMicros)} icon={<TrendingUp />} hint={t("costs.stats.forecastHint", { rate: usd(o.totals.dailyRateMicros) })} />
        <StatTile index={3} label={t("costs.stats.cache")} value={`${formatNumber(o.totals.cacheHitPct, locale)} %`} icon={<Database />} hint={t("costs.stats.cacheHint")} />
      </StatGrid>

      {!hasSpend ? (
        <Card variant="immersive">
          <CardHeader title={t("costs.empty.title")} icon={<Receipt />} />
          <CardBody>
            <p className="text-sm text-muted-foreground">{t("costs.empty.body")}</p>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title={t("costs.chart.title")} description={t("costs.tokens", { input: formatNumber(o.totals.inputTokens, locale), output: formatNumber(o.totals.outputTokens, locale), cached: formatNumber(o.totals.cachedTokens, locale) })} icon={<Gauge />} />
            <CardBody>
              <TrendChart
                title={t("costs.chart.title")}
                type="bar"
                points={o.byDay.map((d) => ({ label: formatDate(`${d.day}T12:00:00Z`, locale, "UTC", { day: "numeric", month: "short" }), value: Number(d.micros), display: usd(d.micros) }))}
                emptyLabel={t("costs.chart.empty")}
                tableLabels={{ period: t("costs.chart.day"), value: t("costs.chart.amount") }}
                maxLabel={maxDay > 0 ? t("costs.chart.max", { amount: usd(maxDay) }) : undefined}
              />
            </CardBody>
          </Card>

          <Card>
            <CardBody className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              <BreakdownBars title={t("costs.by.department")} empty={t("costs.by.empty")} rows={o.byDepartment.map((d) => ({ key: d.key, label: deptLabel(d.key), amount: usd(d.micros), micros: d.micros, meta: count(d.count) }))} />
              <BreakdownBars title={t("costs.by.agent")} empty={t("costs.by.empty")} rows={o.byAgent.map((a) => ({ key: a.id, label: a.name, amount: usd(a.micros), micros: a.micros, meta: count(a.count) }))} />
              <BreakdownBars title={t("costs.by.category")} empty={t("costs.by.empty")} rows={o.byCategory.map((c) => ({ key: c.key, label: t(`costs.categories.${c.key}`), amount: usd(c.micros), micros: c.micros, meta: count(c.count) }))} />
              <BreakdownBars title={t("costs.by.provider")} empty={t("costs.by.empty")} rows={o.byProvider.map((p) => ({ key: p.key, label: p.key, amount: usd(p.micros), micros: p.micros, meta: count(p.count) }))} />
              <BreakdownBars title={t("costs.by.model")} empty={t("costs.by.empty")} rows={o.byModel.map((m) => ({ key: m.key, label: m.key, amount: usd(m.micros), micros: m.micros, meta: count(m.count) }))} />
            </CardBody>
          </Card>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t("costs.budgets.title")} description={t("costs.budgets.description")} icon={<Wallet />} />
          <CardBody className="grid gap-4">
            {o.budgets.length ? (
              <ul className="grid gap-3">
                {o.budgets.map((b) => (
                  <li key={b.id} className="grid gap-1.5 rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {t(`costs.budgets.scope.${b.scope}`)}
                        {scopeLabel(b.scope, b.label) ? <span className="text-muted-foreground">{scopeLabel(b.scope, b.label)}</span> : null}
                        <Badge tone={b.hardStop ? "warning" : "neutral"}>{b.hardStop ? t("costs.budgets.hardStop") : t("costs.budgets.alertsOnly")}</Badge>
                        {b.reached ? <Badge tone="danger">{t("costs.budgets.reached")}</Badge> : null}
                      </p>
                      {canManage ? (
                        <ActionButton path={`${base}/budgets/${b.id}`} method="DELETE" confirm={t("costs.budgets.removeConfirm")} variant="ghost">
                          {t("costs.budgets.remove")}
                        </ActionButton>
                      ) : null}
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(b.pct))} aria-label={t("costs.budgets.used", { spent: usd(b.spentMicros), limit: usd(b.limitMicros) })}>
                      <div className={cn("h-full rounded-full", b.pct >= 100 ? "bg-danger" : b.pct >= 80 ? "bg-warning" : "bg-primary")} style={{ width: `${Math.min(100, Math.max(1, b.pct))}%` }} />
                    </div>
                    <p className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground tabular">
                      <span>
                        {t("costs.budgets.used", { spent: usd(b.spentMicros), limit: usd(b.limitMicros) })} · {formatNumber(b.pct, locale)} %{b.scope === "TASK" ? ` · ${t("costs.budgets.taskNote")}` : ""}
                      </span>
                      {b.projectedPct !== null ? <span>{t("costs.budgets.projected", { pct: formatNumber(b.projectedPct, locale) })}</span> : null}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("costs.budgets.empty")}</p>
            )}
            {canManage ? (
              <details open={!o.budgets.length}>
                <summary className="cursor-pointer text-sm font-medium text-primary">{t("costs.budgets.add")}</summary>
                <div className="mt-3">
                  <BudgetForm path={`${base}/budgets`} departments={BUDGET_DEPARTMENTS.map((d) => ({ key: d, label: t(`workforce.departments.${d}`) }))} employees={o.employees} />
                </div>
              </details>
            ) : (
              <p className="text-xs text-muted-foreground">{t("costs.readOnly")}</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("costs.alerts.title")} icon={<Bell />} />
          <CardBody>
            {o.alerts.length ? (
              <ul className="grid gap-2">
                {o.alerts.map((a) => (
                  <li key={a.id} className={cn("rounded-md border p-2.5 text-sm", a.threshold >= 100 ? "border-danger/35 bg-danger/5" : a.threshold >= 80 ? "border-warning/35 bg-warning/5" : "bg-surface-2/60")}>
                    <p>{t("costs.alerts.line", { scope: t(`costs.budgets.scope.${a.scope}`), key: scopeLabel(a.scope, a.scopeKey), threshold: a.threshold, spent: usd(a.spentMicros), limit: usd(a.limitMicros) })}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(a.sentAt, locale, tz)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("costs.alerts.empty")}</p>
            )}
          </CardBody>
        </Card>
      </div>

      {hasSpend ? (
        <Card>
          <CardHeader title={t("costs.recent.title")} icon={<Receipt />} />
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>{t("costs.recent.when")}</Th>
                  <Th>{t("costs.recent.what")}</Th>
                  <Th>{t("costs.recent.who")}</Th>
                  <Th className="text-end">{t("costs.recent.amount")}</Th>
                </Tr>
              </THead>
              <TBody>
                {o.recent.map((r) => (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(r.occurredAt, locale, tz)}</Td>
                    <Td>
                      <span className="grid gap-0.5">
                        <span className="text-sm">{t(`costs.categories.${r.category}`)}</span>
                        <span className="text-xs text-muted-foreground">
                          {r.provider}
                          {r.model ? ` · ${r.model}` : ""}
                          {r.taskId ? (
                            <>
                              {" · "}
                              <Link className="text-primary hover:underline" href={`/${locale}/tasks/${r.taskId}`}>
                                {t("costs.recent.task")}
                              </Link>
                            </>
                          ) : null}
                        </span>
                      </span>
                    </Td>
                    <Td className="text-sm">{r.employee ?? (r.department ? deptLabel(r.department) : "—")}</Td>
                    <Td className="text-end tabular">
                      <span className="grid justify-items-end gap-0.5">
                        <span>{usd(r.costMicros)}</span>
                        <span className="text-[11px] text-muted-foreground">{r.estimated ? t("costs.recent.estimated") : t("costs.recent.exact")}</span>
                      </span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        </Card>
      ) : null}

      <p className="text-xs text-muted-foreground">{t("costs.note")}</p>
    </div>
  );
}
