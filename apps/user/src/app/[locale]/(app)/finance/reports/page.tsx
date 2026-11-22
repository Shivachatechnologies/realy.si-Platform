import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { financePage } from "@/components/finance/page-context";
import { MoneyFlowCard } from "@/components/finance/money-flow-card";
import { usdCents } from "@/components/finance/ai-spend-card";
import { Empty, RangeForm, rangePresets, UsageBar } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { addDays, param, parseRange } from "@/server/modules/finance/common";
import { balanceSheetReport, cashFlowStatement, expenseReport, parseReport, profitAndLossReport, REPORTS, revenueReport } from "@/server/modules/finance/analytics";
import { budgetVsActual } from "@/server/modules/finance/transactions";
import { projectCostsReport } from "@/server/modules/finance/project-costs";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.reports") };
}

function Section({ title, rows, total, money }: { title: string; rows: { key: string; label: ReactNode; amount: bigint }[]; total?: { label: string; amount: bigint }; money: (v: bigint) => string }) {
  return (
    <>
      <Tr className="bg-surface-2">
        <Td colSpan={2} className="text-xs font-semibold text-muted-foreground uppercase">
          {title}
        </Td>
      </Tr>
      {rows.map((r) => (
        <Tr key={r.key}>
          <Td className="ps-6">{r.label}</Td>
          <Td className="text-end tabular-nums">{money(r.amount)}</Td>
        </Tr>
      ))}
      {total ? (
        <Tr>
          <Td className="font-medium">{total.label}</Td>
          <Td className="text-end font-medium tabular-nums">{money(total.amount)}</Td>
        </Tr>
      ) : null}
    </>
  );
}

export default async function ReportsPage({ searchParams }: PageProps<"/[locale]/finance/reports">) {
  const p = await financePage("reports");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base, day } = p;
  const params = await searchParams;
  const report = parseReport(param(params, "report"));
  const range = parseRange(params);
  const path = `/${locale}/finance/reports`;
  const qs = `from=${range.fromStr}&to=${range.toStr}`;
  const ctx = viewer.ctx;
  const ledgerLink = (id: string, label: string) => (
    <Link href={`/${locale}/finance/accounting/ledger/${id}?${qs}`} className="hover:underline">
      {label}
    </Link>
  );

  let body: ReactNode;
  if (report === "pnl") {
    const r = await profitAndLossReport(ctx, org.id, company.id, range);
    body = (
      <Table>
        <TBody>
          <Section title={t("finance.reports.income")} money={money} rows={r.income.map((x) => ({ key: x.id, label: ledgerLink(x.id, `${x.code} ${x.name}`), amount: x.amountMinor }))} total={{ label: t("finance.reports.totalIncome"), amount: r.totalIncome }} />
          <Section title={t("finance.reports.expenses")} money={money} rows={r.expense.map((x) => ({ key: x.id, label: ledgerLink(x.id, `${x.code} ${x.name}`), amount: x.amountMinor }))} total={{ label: t("finance.reports.totalExpenses"), amount: r.totalExpense }} />
          <Tr>
            <Td className="text-base font-semibold">{t("finance.metrics.netProfit")}</Td>
            <Td className={cn("text-end text-base font-semibold tabular-nums", r.net < 0n && "text-danger")}>{money(r.net)}</Td>
          </Tr>
          {r.aiSpend.entries ? (
            <>
              <Tr>
                <Td>
                  <Link href={`/${locale}/costs`} className="hover:underline">
                    {t("finance.aiSpend.pnlLine")}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{r.aiSpend.amountMinor === null ? t("finance.aiSpend.notConverted") : t("finance.aiSpend.pnlHint")}</span>
                </Td>
                <Td className="text-end tabular-nums">{r.aiSpend.amountMinor !== null ? money(r.aiSpend.amountMinor) : money(usdCents(r.aiSpend.micros), "USD")}</Td>
              </Tr>
              {r.netAfterAi !== null ? (
                <Tr>
                  <Td className="font-semibold">{t("finance.aiSpend.profitAfter")}</Td>
                  <Td className={cn("text-end font-semibold tabular-nums", r.netAfterAi < 0n && "text-danger")}>{money(r.netAfterAi)}</Td>
                </Tr>
              ) : null}
            </>
          ) : null}
        </TBody>
      </Table>
    );
  } else if (report === "balance") {
    const r = await balanceSheetReport(ctx, org.id, company.id, addDays(range.to, -1));
    body = (
      <>
        {!r.balanced ? <Notice tone="danger">{t("finance.reports.unbalanced")}</Notice> : null}
        <Table>
          <TBody>
            <Section title={t("finance.chart.types.ASSET")} money={money} rows={r.assets.map((x) => ({ key: x.id, label: ledgerLink(x.id, `${x.code} ${x.name}`), amount: x.amountMinor }))} total={{ label: t("finance.reports.totalAssets"), amount: r.totalAssets }} />
            <Section title={t("finance.chart.types.LIABILITY")} money={money} rows={r.liabilities.map((x) => ({ key: x.id, label: ledgerLink(x.id, `${x.code} ${x.name}`), amount: x.amountMinor }))} total={{ label: t("finance.reports.totalLiabilities"), amount: r.totalLiabilities }} />
            <Section
              title={t("finance.chart.types.EQUITY")}
              money={money}
              rows={[...r.equity.map((x) => ({ key: x.id, label: ledgerLink(x.id, `${x.code} ${x.name}`), amount: x.amountMinor })), { key: "earnings", label: t("finance.reports.currentEarnings"), amount: r.earnings }]}
              total={{ label: t("finance.reports.totalEquity"), amount: r.totalEquity }}
            />
            <Tr>
              <Td className="font-semibold">{t("finance.reports.liabilitiesAndEquity")}</Td>
              <Td className="text-end font-semibold tabular-nums">{money(r.totalLiabilities + r.totalEquity)}</Td>
            </Tr>
          </TBody>
        </Table>
      </>
    );
  } else if (report === "cashflow") {
    const r = await cashFlowStatement(ctx, org.id, company.id, range);
    body = (
      <Table>
        <TBody>
          <Tr>
            <Td className="font-medium">{t("finance.reports.openingCash")}</Td>
            <Td className="text-end font-medium tabular-nums">{money(r.openingCash)}</Td>
          </Tr>
          {(["operating", "investing", "financing"] as const).map((s) => (
            <Section key={s} title={t(`finance.reports.${s}`)} money={money} rows={r[s].map((x) => ({ key: x.label, label: x.label, amount: x.amountMinor }))} total={{ label: t(`finance.reports.net_${s}`), amount: r.totals[s] }} />
          ))}
          <Tr>
            <Td className="font-semibold">{t("finance.reports.closingCash")}</Td>
            <Td className="text-end font-semibold tabular-nums">{money(r.closingCash)}</Td>
          </Tr>
        </TBody>
      </Table>
    );
  } else if (report === "budget") {
    const r = await budgetVsActual(ctx, org.id, company.id, range);
    body = r.length ? (
      <Table>
        <THead>
          <Tr>
            <Th>{t("finance.fields.name")}</Th>
            <Th>{t("finance.budgets.period")}</Th>
            <Th className="text-end">{t("finance.budgets.budget")}</Th>
            <Th className="text-end">{t("finance.budgets.actual")}</Th>
            <Th className="text-end">{t("finance.budgets.remaining")}</Th>
            <Th className="text-end">{t("finance.budgets.used")}</Th>
          </Tr>
        </THead>
        <TBody>
          {r.map((b) => (
            <Tr key={b.id}>
              <Td>
                {b.name}
                <span className="block text-xs text-muted-foreground">{[b.category?.name, b.department?.name].filter(Boolean).join(" · ")}</span>
              </Td>
              <Td className="whitespace-nowrap">
                {day(b.periodStart)} – {day(b.periodEnd)}
              </Td>
              <Td className="text-end tabular-nums">{money(b.amountMinor)}</Td>
              <Td className="text-end tabular-nums">{money(b.actualMinor)}</Td>
              <Td className={cn("text-end tabular-nums", b.remainingMinor < 0n && "text-danger")}>{money(b.remainingMinor)}</Td>
              <Td className="text-end tabular-nums">{Math.round(b.usedPct)}%</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    ) : (
      <Empty>{t("finance.budgets.empty")}</Empty>
    );
  } else if (report === "revenue") {
    const r = await revenueReport(ctx, org.id, company.id, range);
    const monthLabel = (k: string) => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${k}-01T00:00:00Z`));
    body = (
      <div className="grid gap-4 lg:grid-cols-2">
        <Table>
          <THead>
            <Tr>
              <Th>{t("finance.cashflow.month")}</Th>
              <Th className="text-end">{t("finance.reports.netRevenue")}</Th>
            </Tr>
          </THead>
          <TBody>
            {r.byMonth.map((m) => (
              <Tr key={m.month}>
                <Td>{monthLabel(m.month)}</Td>
                <Td className="text-end tabular-nums">{money(m.netMinor)}</Td>
              </Tr>
            ))}
            <Tr>
              <Td className="font-semibold">{t("finance.billing.total")}</Td>
              <Td className="text-end font-semibold tabular-nums">{money(r.total)}</Td>
            </Tr>
          </TBody>
        </Table>
        <Table>
          <THead>
            <Tr>
              <Th>{t("finance.fields.customer")}</Th>
              <Th className="text-end">{t("finance.reports.invoices")}</Th>
              <Th className="text-end">{t("finance.reports.netRevenue")}</Th>
              <Th className="text-end">{t("finance.invoices.paid")}</Th>
            </Tr>
          </THead>
          <TBody>
            {r.byCustomer.map((c) => (
              <Tr key={c.id}>
                <Td>
                  <Link href={`/${locale}/finance/invoices?customer=${c.id}`} className="hover:underline">
                    {c.name}
                  </Link>
                </Td>
                <Td className="text-end tabular-nums">{c.count}</Td>
                <Td className="text-end tabular-nums">{money(c.netMinor)}</Td>
                <Td className="text-end tabular-nums">{money(c.paidMinor)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>
    );
  } else if (report === "projects") {
    const r = await projectCostsReport(ctx, org.id, company.id, range);
    body = r.rows.length ? (
      <Table>
        <THead>
          <Tr>
            <Th>{t("finance.fields.project")}</Th>
            <Th className="text-end">{t("finance.projects.expenses")}</Th>
            <Th className="text-end">{t("finance.projects.bills")}</Th>
            <Th className="text-end">{t("finance.projects.totalCost")}</Th>
            <Th className="text-end">{t("finance.projects.income")}</Th>
            <Th className="text-end">{t("finance.budgets.budget")}</Th>
            <Th className="min-w-36">{t("finance.budgets.used")}</Th>
          </Tr>
        </THead>
        <TBody>
          {r.rows.map((x) => (
            <Tr key={x.projectId}>
              <Td>
                <Link href={`/${locale}/finance/transactions?project=${x.projectId}&${qs}`} className="font-medium hover:underline">
                  {x.name}
                </Link>
                <Link href={`/${locale}/finance/bills?project=${x.projectId}`} className="block text-xs text-muted-foreground hover:underline">
                  {t("finance.projects.viewBills")}
                </Link>
                {x.pendingClaimsMinor > 0n ? <span className="block text-xs text-warning">{t("finance.projects.pendingClaims", { amount: money(x.pendingClaimsMinor) })}</span> : null}
              </Td>
              <Td className="text-end tabular-nums">{money(x.expensesMinor)}</Td>
              <Td className="text-end tabular-nums">{money(x.billsMinor)}</Td>
              <Td className="text-end font-medium tabular-nums">{money(x.totalCostMinor)}</Td>
              <Td className="text-end tabular-nums">{money(x.incomeMinor)}</Td>
              <Td className="text-end tabular-nums">{x.budgetMinor !== null ? money(x.budgetMinor) : "—"}</Td>
              <Td>
                <UsageBar pct={x.usedPct} />
              </Td>
            </Tr>
          ))}
          <Tr>
            <Td className="font-semibold">{t("finance.billing.total")}</Td>
            <Td />
            <Td />
            <Td className="text-end font-semibold tabular-nums">{money(r.totalCost)}</Td>
            <Td className="text-end font-semibold tabular-nums">{money(r.totalIncome)}</Td>
            <Td />
            <Td />
          </Tr>
        </TBody>
      </Table>
    ) : (
      <Empty>{t("finance.projects.empty")}</Empty>
    );
  } else {
    const r = await expenseReport(ctx, org.id, company.id, range);
    const group = (title: string, rows: { id: string | null; name: string | null; amountMinor: bigint; count: number }[], none: string) => (
      <div className="grid content-start gap-1">
        <h3 className="px-3 pt-3 text-sm font-semibold">{title}</h3>
        <Table>
          <TBody>
            {rows.map((x) => (
              <Tr key={x.id ?? "none"}>
                <Td>{x.name ?? <span className="text-muted-foreground">{none}</span>}</Td>
                <Td className="text-end text-xs text-muted-foreground tabular-nums">{x.count}</Td>
                <Td className="text-end tabular-nums">{money(x.amountMinor)}</Td>
                <Td className="w-16 text-end text-xs text-muted-foreground tabular-nums">{r.total > 0n ? `${Math.round(Number((x.amountMinor * 1000n) / r.total) / 10)}%` : ""}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>
    );
    body = (
      <>
        <p className="px-4 pt-3 text-sm">
          {t("finance.reports.totalExpenses")}: <span className="font-semibold tabular-nums">{money(r.total)}</span>
        </p>
        <div className="grid gap-4 lg:grid-cols-3">
          {group(t("finance.reports.byCategory"), r.byCategory, t("finance.fields.uncategorized"))}
          {group(t("finance.reports.byVendor"), r.byVendor, t("finance.reports.noVendor"))}
          {group(t("finance.reports.byCostCenter"), r.byDepartment, t("finance.reports.noCostCenter"))}
        </div>
      </>
    );
  }

  return p.frame(
    <>
      <nav className="flex flex-wrap gap-1 text-sm" aria-label={t("finance.tabs.reports")}>
        {REPORTS.map((k) => (
          <Link key={k} href={`${path}?report=${k}&${qs}`} aria-current={report === k ? "page" : undefined} className={cn("rounded-md px-3 py-1.5", report === k ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}>
            {t(`finance.reports.names.${k}`)}
          </Link>
        ))}
      </nav>
      <RangeForm action={path} from={range.fromStr} to={range.toStr} hidden={{ report }} labels={{ from: t("finance.range.from"), to: t("finance.range.to"), apply: t("finance.range.apply"), presets: rangePresets(t) }} />
      <Card>
        <CardHeader
          title={t(`finance.reports.names.${report}`)}
          description={report === "balance" ? t("finance.reports.asOf", { date: day(addDays(range.to, -1)) }) : t("finance.reports.period", { from: day(range.from), to: day(addDays(range.to, -1)) })}
          actions={
            <Button asChild size="sm" variant="secondary">
              <a href={`${base}/reports/${report}?${qs}`}>
                <Download aria-hidden />
                {t("finance.exportCsv")}
              </a>
            </Button>
          }
        />
        {body}
      </Card>
      {report === "pnl" ? <MoneyFlowCard ctx={ctx} organizationId={org.id} companyId={company.id} range={range} t={t} locale={locale} money={money} qs={qs} /> : null}
      <p className="text-xs text-muted-foreground">
        {t("finance.reports.learnHint")}{" "}
        <Link href={`/${locale}/finance/learn#${report === "balance" ? "balanceSheet" : report === "cashflow" ? "cashFlow" : report === "budget" ? "variance" : "pnl"}`} className="font-medium text-primary hover:underline">
          {t("finance.reports.learnLink")}
        </Link>
      </p>
    </>,
  );
}
