import type { Metadata } from "next";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { financePage } from "@/components/finance/page-context";
import { ScenarioForm } from "@/components/finance/scenario-form";
import { ActionButton, FormDialog, ResourceForm } from "@/components/finance/ui";
import { BarChart, Empty, Kpi, RangeForm, rangePresets } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { cashFlowOverview, listPlanItems, projectScenarios } from "@/server/modules/finance/analytics";
import { dayString, fromMinor, parseRange } from "@/server/modules/finance/common";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.cashflow") };
}

export default async function CashFlowPage({ searchParams }: PageProps<"/[locale]/finance/cashflow">) {
  const p = await financePage("cashflow");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base, day, currency } = p;
  const range = parseRange(await searchParams);
  const [o, plan, sc] = await Promise.all([cashFlowOverview(viewer.ctx, org.id, company.id, range), listPlanItems(viewer.ctx, org.id, company.id), projectScenarios(viewer.ctx, org.id, company.id)]);
  const monthLabel = (k: string) => new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${k}-01T00:00:00Z`));
  const runOut = (m: string | null) => (m ? t("finance.scenarios.runsOut", { month: monthLabel(m) }) : t("finance.scenarios.noRunOut"));
  const columns = [{ key: "base", name: t("finance.scenarios.baseline"), points: sc.base.points, runOutMonth: sc.base.runOutMonth }, ...sc.scenarios.map((s) => ({ key: s.id, name: s.name, points: s.points, runOutMonth: s.runOutMonth }))];
  const horizon = Math.max(...columns.map((c) => c.points.length));

  return p.frame(
    <>
      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label={t("finance.metrics.cashBalance")} value={money(o.cash)} />
        <Kpi label={t("finance.metrics.burnRate")} value={money(o.burn.netBurn)} hint={t("finance.dashboard.grossBurn", { amount: money(o.burn.grossBurn) })} />
        <Kpi label={t("finance.metrics.runwayMonths")} value={o.runwayMonths === null ? t("finance.dashboard.noBurn") : t("finance.dashboard.months", { count: o.runwayMonths })} tone={o.runwayMonths !== null && o.runwayMonths < 6 ? "danger" : undefined} />
        <Kpi label={t("finance.cashflow.projected6")} value={money(o.forecast.months.at(-1)?.balance ?? o.cash)} tone={(o.forecast.months.at(-1)?.balance ?? 0n) < 0n ? "danger" : undefined} />
      </div>
      <RangeForm action={`/${locale}/finance/cashflow`} from={range.fromStr} to={range.toStr} labels={{ from: t("finance.range.from"), to: t("finance.range.to"), apply: t("finance.range.apply"), presets: rangePresets(t) }} />
      <Card>
        <CardHeader title={t("finance.cashflow.historyTitle")} description={t("finance.cashflow.historyHint")} />
        <CardBody>
          <BarChart
            label={t("finance.cashflow.historyTitle")}
            rows={o.series.map((m) => ({ label: monthLabel(m.month), values: [m.inflow, m.outflow] }))}
            series={[
              { name: t("finance.cashflow.inflow"), className: "bg-primary" },
              { name: t("finance.cashflow.outflow"), className: "bg-warning" },
            ]}
            format={(v) => money(v)}
          />
        </CardBody>
        <Table>
          <THead>
            <Tr>
              <Th>{t("finance.cashflow.month")}</Th>
              <Th className="text-end">{t("finance.cashflow.inflow")}</Th>
              <Th className="text-end">{t("finance.cashflow.outflow")}</Th>
              <Th className="text-end">{t("finance.cashflow.net")}</Th>
            </Tr>
          </THead>
          <TBody>
            {o.series.map((m) => (
              <Tr key={m.month}>
                <Td>{monthLabel(m.month)}</Td>
                <Td className="text-end tabular-nums">{money(m.inflow)}</Td>
                <Td className="text-end tabular-nums">{money(m.outflow)}</Td>
                <Td className={cn("text-end font-medium tabular-nums", m.net < 0n && "text-danger")}>{money(m.net)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>

      <Card>
        <CardHeader title={t("finance.dashboard.forecastTitle")} description={t("finance.cashflow.forecastHint")} />
        <Table>
          <THead>
            <Tr>
              <Th>{t("finance.cashflow.month")}</Th>
              <Th className="text-end">{t("finance.cashflow.receivables")}</Th>
              <Th className="text-end">{t("finance.cashflow.recurringIncome")}</Th>
              <Th className="text-end">{t("finance.cashflow.trendIncome")}</Th>
              <Th className="text-end">{t("finance.cashflow.recurringExpenses")}</Th>
              <Th className="text-end">{t("finance.cashflow.trendExpenses")}</Th>
              <Th className="text-end">{t("finance.cashflow.planned")}</Th>
              <Th className="text-end">{t("finance.cashflow.net")}</Th>
              <Th className="text-end">{t("finance.cashflow.projectedCash")}</Th>
            </Tr>
          </THead>
          <TBody>
            {o.forecast.months.map((m) => (
              <Tr key={m.month}>
                <Td>{monthLabel(m.month)}</Td>
                <Td className="text-end tabular-nums">{money(m.receivables)}</Td>
                <Td className="text-end tabular-nums">{money(m.recurringIncome)}</Td>
                <Td className="text-end tabular-nums">{money(m.trendIncome)}</Td>
                <Td className="text-end tabular-nums">−{money(m.recurringExpenses)}</Td>
                <Td className="text-end tabular-nums">−{money(m.trendExpenses)}</Td>
                <Td className="text-end tabular-nums">{money(m.planned)}</Td>
                <Td className={cn("text-end tabular-nums", m.net < 0n && "text-danger")}>{money(m.net)}</Td>
                <Td className={cn("text-end font-medium tabular-nums", m.balance < 0n && "text-danger")}>{money(m.balance)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>

      <Card>
        <CardHeader title={t("finance.cashflow.planTitle")} description={t("finance.cashflow.planHint")} />
        {p.canManage ? (
          <div className="border-b p-4">
            <ResourceForm
              endpoint={`${base}/plan-items`}
              submitLabel={t("finance.cashflow.addPlanned")}
              initial={{ date: dayString(new Date()) }}
              fields={[
                { name: "name", label: t("finance.fields.name"), required: true, maxLength: 200 },
                { name: "date", label: t("finance.fields.date"), type: "date", required: true },
                { name: "amount", label: t("finance.fields.amount"), type: "amount", required: true, hint: t("finance.cashflow.plannedAmountHint") },
                { name: "notes", label: t("finance.fields.notes"), span: 3, maxLength: 1000 },
              ]}
            />
          </div>
        ) : null}
        {!plan.length ? (
          <Empty>{t("finance.cashflow.planEmpty")}</Empty>
        ) : (
          <ul className="grid divide-y text-sm">
            {plan.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="w-28 text-muted-foreground">{day(i.date)}</span>
                <span className="min-w-0 flex-1 font-medium">
                  {i.name}
                  {i.notes ? <span className="block text-xs font-normal text-muted-foreground">{i.notes}</span> : null}
                </span>
                <span className={cn("tabular-nums", i.amountMinor < 0n ? "text-danger" : "text-success")}>{money(i.amountMinor)}</span>
                {p.canManage ? (
                  <>
                    <FormDialog trigger={t("finance.edit")} title={i.name} variant="ghost">
                      <ResourceForm
                        endpoint={`${base}/plan-items/${i.id}`}
                        method="PATCH"
                        submitLabel={t("common.save")}
                        initial={{ name: i.name, date: dayString(i.date), amount: fromMinor(i.amountMinor, currency), notes: i.notes ?? "" }}
                        fields={[
                          { name: "name", label: t("finance.fields.name"), required: true, maxLength: 200 },
                          { name: "date", label: t("finance.fields.date"), type: "date", required: true },
                          { name: "amount", label: t("finance.fields.amount"), type: "amount", required: true },
                          { name: "notes", label: t("finance.fields.notes"), span: 3, maxLength: 1000 },
                        ]}
                      />
                    </FormDialog>
                    <ActionButton endpoint={`${base}/plan-items/${i.id}`} method="DELETE" label={t("finance.delete")} variant="ghost" />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={t("finance.scenarios.title")} description={t("finance.scenarios.hint", { inflow: money(sc.baseline.inflow), outflow: money(sc.baseline.outflow) })} />
        {p.canManage ? (
          <details className="border-b">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t("finance.scenarios.create")}</summary>
            <div className="border-t p-4">
              <ScenarioForm base={base} />
            </div>
          </details>
        ) : null}
        {sc.scenarios.length ? (
          <ul className="grid divide-y border-b text-sm">
            {sc.scenarios.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-muted-foreground">{t("finance.scenarios.summary", { growth: s.revenueGrowthBps / 100, change: s.expenseChangeBps / 100, count: s.oneOffs.length, months: s.months })}</span>
                <span className={cn("ms-auto text-xs", s.runOutMonth ? "text-danger" : "text-muted-foreground")}>{runOut(s.runOutMonth)}</span>
                {p.canManage ? (
                  <>
                    <FormDialog trigger={t("finance.edit")} title={s.name} variant="ghost">
                      <ScenarioForm
                        base={base}
                        id={s.id}
                        initial={{ name: s.name, revenueGrowth: String(s.revenueGrowthBps / 100), expenseChange: String(s.expenseChangeBps / 100), months: String(s.months), oneOffs: s.oneOffs.map((x) => ({ month: x.month, label: x.label, amount: fromMinor(BigInt(x.amountMinor), currency) })) }}
                      />
                    </FormDialog>
                    <ActionButton endpoint={`${base}/scenarios/${s.id}`} method="DELETE" label={t("finance.delete")} variant="ghost" confirm={t("finance.scenarios.confirmDelete")} />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <Table>
          <THead>
            <Tr>
              <Th>{t("finance.cashflow.month")}</Th>
              {columns.map((c) => (
                <Th key={c.key} className="text-end">
                  {c.name}
                </Th>
              ))}
            </Tr>
          </THead>
          <TBody>
            {sc.months.slice(0, horizon).map((m, i) => (
              <Tr key={m}>
                <Td>{monthLabel(m)}</Td>
                {columns.map((c) => {
                  const pt = c.points[i];
                  return (
                    <Td key={c.key} className={cn("text-end tabular-nums", pt && pt.balance < 0n && "text-danger")}>
                      {pt ? money(pt.balance) : ""}
                    </Td>
                  );
                })}
              </Tr>
            ))}
            <Tr>
              <Td className="font-medium">{t("finance.scenarios.outcome")}</Td>
              {columns.map((c) => (
                <Td key={c.key} className={cn("text-end text-xs", c.runOutMonth ? "text-danger" : "text-muted-foreground")}>
                  {runOut(c.runOutMonth)}
                </Td>
              ))}
            </Tr>
          </TBody>
        </Table>
      </Card>
    </>,
  );
}
