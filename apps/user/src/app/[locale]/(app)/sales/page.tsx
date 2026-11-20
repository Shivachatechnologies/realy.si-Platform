import type { Metadata } from "next";
import Link from "next/link";
import { RangeFilter } from "@/components/crm/range-filter";
import { CrmFrame, Stat, crmContext } from "@/components/crm/shell";
import { Card, CardHeader } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { formatDate, formatMoney, formatNumber } from "@/i18n/format";
import { isoDay } from "@/server/modules/crm/common";
import { listPipelines } from "@/server/modules/crm/pipelines";
import { parseSalesRange, salesForecast, salesSummary, targetAttainment, teamPerformance } from "@/server/modules/crm/sales";
import { listOwners } from "@/server/modules/crm/service";
import { mySalesTasks } from "@/server/modules/crm/tasks";
import { SalesTaskControls } from "@/components/crm/sales-task-forms";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import { SalesOsOverview } from "@/components/crm/sales-os-overview";
import { shouldStartJourney } from "@/server/modules/crm/guided";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.sales.title") };
}

/** Team leader dashboard: headline numbers, forecast, leaderboard and target attainment. */
export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await crmContext();
  const query = await searchParams;
  if (!c.company || !c.canRead) return <CrmFrame area="sales" active="overview">{null}</CrmFrame>;
  const { t, locale, org, company, viewer, base } = c;
  // Empty companies start with the guided journey (until it's finished or dismissed).
  if (c.canManage && (await shouldStartJourney(org.id, company.id))) redirect(`/${locale}/sales/start`);
  const advancedOpen = ["from", "to", "owner", "pipeline"].some((k) => typeof query[k] === "string" && query[k]);
  const todayStart = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const range = parseSalesRange(query);
  const [summary, team, forecast, targets, owners, pipelines, myTasks] = await Promise.all([
    salesSummary(viewer.ctx, org.id, company.id, range),
    teamPerformance(viewer.ctx, org.id, company.id, range),
    salesForecast(viewer.ctx, org.id, company.id, { owner: range.owner, pipelineId: range.pipelineId }),
    targetAttainment(viewer.ctx, org.id, company.id, "MONTH"),
    listOwners(viewer.ctx, org.id, company.id),
    listPipelines(viewer.ctx, org.id, company.id),
    mySalesTasks(viewer.ctx, org.id, company.id),
  ]);
  const cur = summary.currency;
  const money = (m: bigint) => formatMoney({ amountMinor: m, currency: cur }, locale);
  const pct = (v: number | null) => (v == null ? "—" : formatNumber(v, locale, { style: "percent", maximumFractionDigits: 0 }));
  const maxMonth = forecast.byMonth.reduce((m, x) => (x.bestCaseMinor + x.wonMinor > m ? x.bestCaseMinor + x.wonMinor : m), 1n);
  const width = (v: bigint) => `${Math.max(0, Math.min(100, Number((v * 1000n) / maxMonth) / 10))}%`;
  const toIncl = isoDay(new Date(range.to.getTime() - 86_400_000))!;
  return (
    <CrmFrame area="sales" active="overview" subtitle={t("sales.subtitle")}>
      <SalesOsOverview />
      <details className="group rounded-lg border bg-surface" open={advancedOpen}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t("sales.os.advanced")}</summary>
        <div className="grid gap-4 border-t p-4">
      <RangeFilter action={`/${locale}/sales`} from={isoDay(range.from)!} to={toIncl} owner={range.owner} owners={owners} pipeline={range.pipelineId} pipelines={pipelines} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("sales.kpi.wonRevenue")} value={money(summary.wonMinor)} hint={t("sales.kpi.wonDeals", { count: summary.wonCount })} />
        <Stat label={t("sales.kpi.winRate")} value={pct(summary.winRate)} hint={t("sales.kpi.lostDeals", { count: summary.lostCount })} />
        <Stat label={t("sales.kpi.avgDeal")} value={money(summary.avgDealMinor)} />
        <Stat label={t("sales.kpi.cycle")} value={summary.cycleDays == null ? "—" : t("crm.deals.days", { count: Math.round(summary.cycleDays) })} />
        <Stat label={t("sales.kpi.newLeads")} value={summary.newLeads} hint={t("sales.kpi.dealsCreated", { count: summary.dealsCreated })} />
        <Stat label={t("crm.pipelineValue")} value={money(summary.openMinor)} hint={t("sales.kpi.openDeals", { count: summary.openCount })} />
        <Stat label={t("crm.weightedPipeline")} value={money(summary.weightedMinor)} />
        <Stat
          label={t("sales.kpi.stale")}
          value={
            <Link href={`/${locale}/crm/deals?stale=1&status=OPEN`} className="hover:underline">
              {summary.staleCount}
            </Link>
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("sales.forecast.title")} description={t("sales.forecast.hint")} />
          <ul className="grid gap-3 p-4">
            {forecast.byMonth.map((m) => (
              <li key={m.month} className="grid gap-1 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{formatDate(new Date(`${m.month}-01T00:00:00Z`), locale, "UTC", { month: "long", year: "numeric" })}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t("sales.forecast.line", { weighted: money(m.weightedMinor), commit: money(m.commitMinor), best: money(m.bestCaseMinor), count: m.count })}
                  </span>
                </div>
                <div className="relative h-3 overflow-hidden rounded-sm bg-muted" aria-hidden>
                  <div className="absolute inset-y-0 start-0 bg-success" style={{ width: width(m.wonMinor) }} />
                  <div className="absolute inset-y-0 bg-primary/30" style={{ insetInlineStart: width(m.wonMinor), width: width(m.bestCaseMinor) }} />
                  <div className="absolute inset-y-0 bg-primary" style={{ insetInlineStart: width(m.wonMinor), width: width(m.weightedMinor) }} />
                </div>
                {m.wonMinor > 0n ? <span className="text-xs text-success">{t("sales.forecast.won", { amount: money(m.wonMinor) })}</span> : null}
              </li>
            ))}
          </ul>
          <p className="flex flex-wrap gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-success" />{t("sales.forecast.legendWon")}</span>
            <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-primary" />{t("sales.forecast.legendWeighted")}</span>
            <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-primary/30" />{t("sales.forecast.legendBest")}</span>
          </p>
        </Card>
        <Card>
          <CardHeader title={t("sales.forecast.byOwner")} />
          {forecast.byOwner.length ? (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="p-2 text-start font-medium">{t("crm.owner")}</th>
                  <th className="p-2 text-end font-medium">{t("sales.forecast.deals")}</th>
                  <th className="p-2 text-end font-medium">{t("sales.forecast.bestCase")}</th>
                  <th className="p-2 text-end font-medium">{t("crm.weighted")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {forecast.byOwner.map((o) => (
                  <tr key={o.ownerId ?? "none"}>
                    <td className="p-2">{o.name ?? t("crm.unassigned")}</td>
                    <td className="p-2 text-end tabular-nums">{o.count}</td>
                    <td className="p-2 text-end tabular-nums">{money(o.bestCaseMinor)}</td>
                    <td className="p-2 text-end tabular-nums">{money(o.weightedMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("sales.forecast.empty")}</p>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title={t("sales.leaderboard.title")} description={t("sales.leaderboard.hint")} />
        {team.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="p-2 text-start font-medium">#</th>
                  <th className="p-2 text-start font-medium">{t("crm.owner")}</th>
                  <th className="p-2 text-end font-medium">{t("sales.kpi.wonRevenue")}</th>
                  <th className="p-2 text-end font-medium">{t("sales.leaderboard.wonLost")}</th>
                  <th className="p-2 text-end font-medium">{t("sales.kpi.winRate")}</th>
                  <th className="p-2 text-end font-medium">{t("sales.kpi.avgDeal")}</th>
                  <th className="p-2 text-end font-medium">{t("sales.kpi.cycle")}</th>
                  <th className="p-2 text-end font-medium">{t("crm.weightedPipeline")}</th>
                  <th className="p-2 text-end font-medium">{t("sales.leaderboard.activities")}</th>
                  <th className="p-2 text-end font-medium">{t("sales.leaderboard.leads")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {team.rows.map((r, i) => (
                  <tr key={r.ownerId ?? "none"}>
                    <td className="p-2 text-muted-foreground">{i + 1}</td>
                    <td className="p-2 font-medium">{r.name ?? t("crm.unassigned")}</td>
                    <td className="p-2 text-end tabular-nums">{money(r.wonMinor)}</td>
                    <td className="p-2 text-end tabular-nums">
                      {r.wonCount} / {r.lostCount}
                    </td>
                    <td className="p-2 text-end tabular-nums">{pct(r.winRate)}</td>
                    <td className="p-2 text-end tabular-nums">{money(r.avgDealMinor)}</td>
                    <td className="p-2 text-end tabular-nums">{r.cycleDays == null ? "—" : Math.round(r.cycleDays)}</td>
                    <td className="p-2 text-end tabular-nums">{money(r.weightedMinor)}</td>
                    <td className="p-2 text-end tabular-nums">{r.activities}</td>
                    <td className="p-2 text-end tabular-nums">
                      {r.converted} / {r.leads}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("sales.leaderboard.empty")}</p>
        )}
      </Card>

      <Card>
        <CardHeader
          title={t("sales.targets.thisMonth")}
          actions={
            <Link href={`/${locale}/sales/targets`} className="text-xs hover:underline">
              {t("sales.targets.manage")}
            </Link>
          }
        />
        {targets.rows.length ? (
          <ul className="grid gap-3 p-4">
            {targets.rows.map((r) => (
              <li key={r.id} className="grid gap-1 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{r.name ?? "—"}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatMoney({ amountMinor: r.wonMinor, currency: r.currency }, locale)} / {formatMoney({ amountMinor: r.targetMinor, currency: r.currency }, locale)} · {pct(r.attainment)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-sm bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((r.attainment ?? 0) * 100)}>
                  <div className={(r.attainment ?? 0) >= 1 ? "h-full bg-success" : "h-full bg-primary"} style={{ width: `${Math.min(100, (r.attainment ?? 0) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("sales.targets.none")}</p>
        )}
      </Card>

      <Card id="my-tasks">
        <CardHeader title={t("sales.myTasks.title")} description={t("sales.myTasks.summary", { open: myTasks.open.length, overdue: myTasks.overdue })} />
        {myTasks.open.length || myTasks.done.length ? (
          <ul className="grid divide-y text-sm">
            {[...myTasks.open, ...myTasks.done].map((task) => {
              const done = task.status === "DONE";
              const overdue = !done && task.dueDate && task.dueDate < todayStart;
              return (
                <li key={task.id} className="grid gap-1 px-4 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  {c.canManage ? (
                    <SalesTaskControls base={base} owners={owners} task={{ id: task.id, done, assigneeId: task.assignee?.id ?? null, dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null, title: task.title }} />
                  ) : (
                    <span className={done ? "text-muted-foreground line-through" : "font-medium"}>{task.title}</span>
                  )}
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:justify-end">
                    {task.href && task.subjectName ? (
                      <Link href={`/${locale}${task.href}`} className="hover:underline">
                        {task.subjectName}
                      </Link>
                    ) : null}
                    {task.dueDate ? <span className={overdue ? "text-danger" : undefined}>{formatDate(task.dueDate, locale, "UTC")}</span> : null}
                    <Badge>{t(`crm.salesTasks.priorities.${task.priority}`)}</Badge>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("sales.myTasks.none")}</p>
        )}
      </Card>
        </div>
      </details>
    </CrmFrame>
  );
}
