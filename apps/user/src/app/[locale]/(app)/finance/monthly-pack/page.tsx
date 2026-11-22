import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { financePage } from "@/components/finance/page-context";
import { AiSpendCard } from "@/components/finance/ai-spend-card";
import { MonthlyPackButton } from "@/components/finance/monthly-pack-button";
import { Empty, Kpi, StatusBadge, TASK_TONE } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { param } from "@/server/modules/finance/common";
import { cfoMonthlyPack, listMonthlyPackTasks } from "@/server/modules/finance/monthly-pack";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.monthlyPack") };
}

/** Monthly CFO pack: the month's figures from the books and the AI cost ledger, plus the AI CFO's written pack. */
export default async function MonthlyPackPage({ searchParams }: PageProps<"/[locale]/finance/monthly-pack">) {
  const p = await financePage("monthlyPack");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base } = p;
  const sp = await searchParams;
  const [pack, tasks] = await Promise.all([cfoMonthlyPack(viewer.ctx, org.id, company.id, { month: param(sp, "month") && /^\d{4}-(0[1-9]|1[0-2])$/.test(param(sp, "month")!) ? param(sp, "month") : undefined }), p.canRunAgents ? listMonthlyPackTasks(viewer.ctx, org.id, company.id).catch(() => []) : Promise.resolve([])]);
  const running = tasks.some((x) => x.status === "QUEUED" || x.status === "RUNNING");
  const change = (v: number | null) => (v === null ? null : t("finance.monthlyPack.vsPrev", { pct: `${v > 0 ? "+" : ""}${v}` }));
  return p.frame(
    <>
      <form action={`/${locale}/finance/monthly-pack`} className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          <span className="text-xs text-muted-foreground">{t("finance.monthlyPack.month")}</span>
          <input type="month" name="month" defaultValue={pack.month} className="h-9 rounded-md border bg-surface px-2 text-sm" />
        </label>
        <button type="submit" className="h-9 rounded-md border px-3 text-sm hover:bg-muted">
          {t("finance.range.apply")}
        </button>
      </form>
      {pack.partial ? <Notice tone="info">{t("finance.monthlyPack.partial")}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label={t("finance.metrics.revenue")} value={money(pack.pnl.revenue)} hint={change(pack.pnl.revenueChangePct) ?? undefined} />
        <Kpi label={t("finance.metrics.expenses")} value={money(pack.pnl.expenses)} hint={change(pack.pnl.expenseChangePct) ?? undefined} />
        <Kpi label={t("finance.metrics.netProfit")} value={money(pack.pnl.profit)} tone={pack.pnl.profit < 0n ? "danger" : "success"} hint={pack.pnl.margin !== null ? t("finance.dashboard.margin", { pct: pack.pnl.margin }) : undefined} />
        <Kpi label={t("finance.monthlyPack.cashEnd")} value={money(pack.cash.end)} hint={t("finance.monthlyPack.cashChange", { amount: money(pack.cash.change) })} />
        <Kpi label={t("finance.metrics.burnRate")} value={money(pack.burn.netBurn)} />
        <Kpi label={t("finance.metrics.runwayMonths")} value={pack.runwayMonths === null ? t("finance.dashboard.noBurn") : t("finance.dashboard.months", { count: pack.runwayMonths })} tone={pack.runwayMonths !== null && pack.runwayMonths < 6 ? "danger" : undefined} />
        <Kpi label={t("finance.metrics.mrr")} value={money(pack.mrr)} />
        <Kpi label={t("finance.metrics.receivablesOverdue")} value={money(pack.receivablesOverdue)} tone={pack.receivablesOverdue > 0n ? "warning" : undefined} />
        <Kpi label={t("finance.metrics.payablesOverdue")} value={money(pack.payablesOverdue)} tone={pack.payablesOverdue > 0n ? "danger" : undefined} />
        <Kpi label={t("finance.monthlyPack.overBudget")} value={pack.overBudget} tone={pack.overBudget ? "danger" : undefined} />
      </div>
      <AiSpendCard ai={pack.ai} t={t} locale={locale} money={money} />
      <Card>
        <CardHeader title={t("finance.monthlyPack.budgetsTitle")} actions={<Link href={`/${locale}/finance/budgets`} className="text-xs hover:underline">{t("finance.tabs.budgets")}</Link>} />
        {pack.budgets.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.monthlyPack.budget")}</Th>
                <Th className="text-end">{t("finance.monthlyPack.planned")}</Th>
                <Th className="text-end">{t("finance.monthlyPack.actual")}</Th>
                <Th className="text-end">{t("finance.monthlyPack.used")}</Th>
              </Tr>
            </THead>
            <TBody>
              {pack.budgets.map((b) => (
                <Tr key={b.id}>
                  <Td>
                    {b.name}
                    {b.category || b.department ? <span className="block text-xs text-muted-foreground">{[b.category, b.department].filter(Boolean).join(" · ")}</span> : null}
                  </Td>
                  <Td className="text-end tabular-nums">{money(b.budgetMinor)}</Td>
                  <Td className="text-end tabular-nums">{money(b.actualMinor)}</Td>
                  <Td className={cn("text-end tabular-nums", b.usedPct >= 100 && "text-danger")}>{b.usedPct}%</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>{t("finance.monthlyPack.noBudgets")}</Empty>
        )}
      </Card>
      <Card variant="highlight">
        <CardHeader title={t("finance.monthlyPack.aiTitle")} description={t("finance.monthlyPack.aiHint")} actions={<Link href={`/${locale}/finance/roi`} className="text-xs hover:underline">{t("finance.tabs.roi")}</Link>} />
        <CardBody className="grid gap-3">
          <AutoRefresh active={running} intervalMs={4000} />
          {!aiConfigured() ? <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice> : p.canRunAgents ? <MonthlyPackButton base={base} locale={locale} month={pack.month} /> : <Notice>{t("finance.dashboard.insightsNoPermission")}</Notice>}
          {tasks.length ? (
            <ul className="grid divide-y rounded-md border">
              {tasks.map((task) => (
                <li key={task.id} className="grid gap-1 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={TASK_TONE[task.status]}>{t(`agentTasks.status.${task.status}`)}</StatusBadge>
                    <Link href={`/${locale}/tasks/${task.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                      {task.title}
                    </Link>
                    <span className="text-xs text-muted-foreground">{formatDateTime(task.createdAt, locale, p.tz)}</span>
                  </div>
                  {task.output ? <p className="line-clamp-6 whitespace-pre-line text-muted-foreground">{task.output}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>
      <details className="rounded-lg border bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t("finance.monthlyPack.raw")}</summary>
        <pre className="overflow-x-auto border-t p-4 text-xs whitespace-pre-wrap">{pack.markdown}</pre>
      </details>
    </>,
  );
}
