import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { InsightsButton } from "@/components/finance/insights-button";
import { financePage } from "@/components/finance/page-context";
import { BarChart, Empty, Kpi, RangeForm, rangePresets, StatusBadge, TASK_TONE } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { detectExpenseAnomalies, financeDashboard } from "@/server/modules/finance/analytics";
import { parseRange } from "@/server/modules/finance/common";
import { listInsightTasks } from "@/server/modules/finance/insights";
import { listFinanceAccounts } from "@/server/modules/finance/setup";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.finance.title") };
}

export default async function FinanceDashboardPage({ searchParams }: PageProps<"/[locale]/finance">) {
  const p = await financePage("dashboard");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base } = p;
  const range = parseRange(await searchParams);
  const [d, anomalies, accounts, tasks] = await Promise.all([
    financeDashboard(viewer.ctx, org.id, company.id, range),
    detectExpenseAnomalies(viewer.ctx, org.id, company.id),
    listFinanceAccounts(viewer.ctx, org.id, company.id),
    p.canRunAgents ? listInsightTasks(viewer.ctx, org.id, company.id).catch(() => []) : Promise.resolve([]),
  ]);
  const monthLabel = (k: string) => new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${k}-01T00:00:00Z`));

  return p.frame(
    <>
      <RangeForm
        action={`/${locale}/finance`}
        from={range.fromStr}
        to={range.toStr}
        labels={{ from: t("finance.range.from"), to: t("finance.range.to"), apply: t("finance.range.apply"), presets: rangePresets(t) }}
      />
      {!accounts.length ? (
        <Notice>
          {t("finance.dashboard.getStarted")}{" "}
          <Link href={`/${locale}/finance/accounts`} className="font-medium underline">
            {t("finance.accounts.add")}
          </Link>
        </Notice>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label={t("finance.metrics.revenue")} value={money(d.revenue)} />
        <Kpi label={t("finance.metrics.expenses")} value={money(d.expenses)} />
        <Kpi label={t("finance.metrics.netProfit")} value={money(d.profit)} tone={d.profit < 0n ? "danger" : "success"} hint={d.margin !== null ? t("finance.dashboard.margin", { pct: d.margin }) : undefined} />
        <Kpi label={t("finance.metrics.cashBalance")} value={money(d.cash)} />
        <Kpi label={t("finance.dashboard.netCashFlow")} value={money(d.netCashFlow)} tone={d.netCashFlow < 0n ? "danger" : undefined} hint={t("finance.dashboard.inOut", { in: money(d.cashIn), out: money(d.cashOut) })} />
        <Kpi label={t("finance.metrics.burnRate")} value={money(d.burn.netBurn)} hint={t("finance.dashboard.grossBurn", { amount: money(d.burn.grossBurn) })} />
        <Kpi label={t("finance.metrics.runwayMonths")} value={d.runwayMonths === null ? t("finance.dashboard.noBurn") : t("finance.dashboard.months", { count: d.runwayMonths })} tone={d.runwayMonths !== null && d.runwayMonths < 6 ? "danger" : undefined} />
        <Kpi label={t("finance.metrics.mrr")} value={money(d.mrr)} />
        <Kpi label={t("finance.metrics.arr")} value={money(d.arr)} />
        <Kpi label={t("finance.metrics.receivablesOverdue")} value={money(d.overdue)} tone={d.overdue > 0n ? "warning" : undefined} hint={t("finance.dashboard.openReceivables", { amount: money(d.receivables) })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("finance.dashboard.pnlTitle")} description={t("finance.dashboard.pnlHint")} />
          <CardBody>
            <BarChart
              label={t("finance.dashboard.pnlTitle")}
              rows={d.monthly.map((m) => ({ label: monthLabel(m.month), values: [m.revenue, m.expenses] }))}
              series={[
                { name: t("finance.metrics.revenue"), className: "bg-success" },
                { name: t("finance.metrics.expenses"), className: "bg-danger" },
              ]}
              format={(v) => money(v)}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("finance.dashboard.cashTitle")} description={t("finance.dashboard.cashHint")} />
          <CardBody>
            <BarChart
              label={t("finance.dashboard.cashTitle")}
              rows={d.cashSeries.map((m) => ({ label: monthLabel(m.month), values: [m.inflow, m.outflow] }))}
              series={[
                { name: t("finance.cashflow.inflow"), className: "bg-primary" },
                { name: t("finance.cashflow.outflow"), className: "bg-warning" },
              ]}
              format={(v) => money(v)}
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t("finance.dashboard.forecastTitle")} description={t("finance.dashboard.forecastHint")} actions={<Link href={`/${locale}/finance/cashflow`} className="text-xs hover:underline">{t("finance.tabs.cashflow")}</Link>} />
        <Table>
          <THead>
            <Tr>
              <Th>{t("finance.cashflow.month")}</Th>
              <Th className="text-end">{t("finance.cashflow.inflow")}</Th>
              <Th className="text-end">{t("finance.cashflow.outflow")}</Th>
              <Th className="text-end">{t("finance.cashflow.net")}</Th>
              <Th className="text-end">{t("finance.cashflow.projectedCash")}</Th>
            </Tr>
          </THead>
          <TBody>
            {d.forecast.months.map((m) => (
              <Tr key={m.month}>
                <Td>{monthLabel(m.month)}</Td>
                <Td className="text-end tabular-nums">{money(m.inflow)}</Td>
                <Td className="text-end tabular-nums">{money(m.outflow)}</Td>
                <Td className={`text-end tabular-nums ${m.net < 0n ? "text-danger" : ""}`}>{money(m.net)}</Td>
                <Td className={`text-end font-medium tabular-nums ${m.balance < 0n ? "text-danger" : ""}`}>{money(m.balance)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("finance.dashboard.insightsTitle")} description={t("finance.dashboard.insightsHint")} />
          <CardBody className="grid gap-3">
            {!aiConfigured() ? <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice> : p.canRunAgents ? <InsightsButton base={base} locale={locale} /> : <Notice>{t("finance.dashboard.insightsNoPermission")}</Notice>}
            {tasks.length ? (
              <ul className="grid divide-y rounded-md border">
                {tasks.map((task) => (
                  <li key={task.id} className="grid gap-1 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={TASK_TONE[task.status]}>{t(`agentTasks.status.${task.status}`)}</StatusBadge>
                      <Link href={`/${locale}/tasks/${task.id}`} className="font-medium hover:underline">
                        {task.title}
                      </Link>
                      <span className="ms-auto text-xs text-muted-foreground">{formatDateTime(task.createdAt, locale, p.tz)}</span>
                    </div>
                    {task.output ? <p className="line-clamp-4 whitespace-pre-line text-muted-foreground">{task.output}</p> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("finance.anomalies.title")} description={t("finance.anomalies.hint")} />
          {anomalies.length ? (
            <ul className="grid divide-y">
              {anomalies.slice(0, 10).map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                  <StatusBadge tone={Math.abs(a.z) >= 4 ? "danger" : "warning"}>z {a.z}</StatusBadge>
                  <Link href={`/${locale}/finance/transactions/${a.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                    {a.description}
                  </Link>
                  <span className="tabular-nums">{money(a.amountMinor)}</span>
                  <span className="w-full text-xs text-muted-foreground">
                    {t("finance.anomalies.detail", { group: t(`finance.anomalies.groups.${a.group}`), name: a.groupName, typical: money(a.meanMinor), date: p.day(a.date) })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>{t("finance.anomalies.empty")}</Empty>
          )}
        </Card>
      </div>
    </>,
  );
}
