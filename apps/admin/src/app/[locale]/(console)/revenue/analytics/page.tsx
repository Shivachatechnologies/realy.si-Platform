import Link from "next/link";
import { ChartColumnIncreasing, Crown, Layers, PieChart, TrendingUp } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { AdminHeader, Empty, EmptyState, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { BarList, TrendChart } from "@/components/admin/viz";
import { DataSource, NotAvailable, RangeLinks, Waterfall, pct } from "@/components/admin/billing/ui";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatMoney, formatNumber, minorUnits } from "@/i18n/format";
import { revenueAnalytics } from "@/server/modules/admin/revenue";
import { requireViewer } from "@/server/session";

/** Revenue analytics v2: MRR history and movement from daily mrr_snapshots, distribution, concentration, growth, LTV. */
export default async function RevenueAnalyticsPage({ searchParams }: PageProps<"/[locale]/revenue/analytics">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const res = await guard(revenueAnalytics(viewer.ctx, { days: sp(q.days), currency: sp(q.currency) }), t("errors.forbidden"));
  if (!res.ok) return res.node;
  const a = res.value;
  const base = `/${locale}/revenue/analytics`;
  const header = (meta?: React.ReactNode) => (
    <>
      <AdminBreadcrumbs />
      <AdminHeader icon={<ChartColumnIncreasing />} title={t("admin.revenue.analytics.title")} description={t("admin.revenue.analytics.subtitle")} why={t("admin.revenue.analytics.why")} meta={meta} />
    </>
  );
  if (a.state === "no_snapshots") {
    return (
      <div className="grid gap-4">
        {header()}
        <Card>
          <EmptyState icon={<TrendingUp />} title={t("admin.revenue.analytics.noSnapshots")} body={t("admin.revenue.analytics.noSnapshotsHint")} />
        </Card>
      </div>
    );
  }
  const money = (v: bigint) => formatMoney({ amountMinor: v, currency: a.currency }, locale);
  const scale = 10 ** minorUnits(a.currency);
  const tz = viewer.user.timezone;
  return (
    <div className="grid gap-4">
      {header(<DataSource source={t("admin.revenue.analytics.source")} updatedAt={a.computedAt} updatedLabel={t("admin.revenue.analytics.computed")} stale={a.stale} staleLabel={t("admin.revenue.analytics.stale")} />)}
      <div className="flex flex-wrap items-center gap-2">
        <RangeLinks base={base} value={a.days} options={[30, 90, 180, 365]} params={{ currency: a.currency }} label={t("admin.revenue.overview.range")} format={(d) => t("admin.revenue.overview.days", { count: Number(d) })} />
        {a.currencies.length > 1 ? <RangeLinks base={base} name="currency" value={a.currency} options={a.currencies} params={{ days: String(a.days) }} label={t("admin.revenue.analytics.currency")} format={(c) => String(c)} /> : null}
      </div>
      <Notice tone="info">{t("admin.revenue.analytics.historyNote", { date: a.firstSnapshot ? formatDate(a.firstSnapshot, locale, "UTC") : "—", days: a.historyDays })}</Notice>
      <StatGrid>
        <StatTile label={t("admin.revenue.analytics.mrr", { currency: a.currency })} value={a.end ? money(a.end.mrrMinor) : "—"} hint={a.end ? t("admin.revenue.analytics.subs", { active: a.end.activeSubs, trialing: a.end.trialingSubs, pastDue: a.end.pastDueSubs }) : undefined} href={`/${locale}/subscriptions?status=ACTIVE`} />
        <StatTile label={t("admin.revenue.analytics.growth")} value={pct(a.growth, locale)} hint={a.start ? t("admin.revenue.analytics.since", { date: formatDate(a.start.day, locale, "UTC") }) : undefined} tone={a.growth !== null ? (a.growth >= 0 ? "success" : "danger") : undefined} />
        <StatTile label={t("admin.revenue.analytics.nrr")} value={pct(a.nrr, locale)} hint={a.nrr === null ? t("admin.revenue.analytics.needsMovement") : t("admin.revenue.analytics.nrrHint")} />
        <StatTile label={t("admin.revenue.analytics.grr")} value={pct(a.grr, locale)} hint={a.grr === null ? t("admin.revenue.analytics.needsMovement") : t("admin.revenue.analytics.grrHint")} />
        <StatTile label={t("admin.revenue.analytics.arpu")} value={a.arpuMinor === null ? "—" : money(a.arpuMinor)} hint={t("admin.revenue.analytics.payingOrgs", { count: a.payingOrgs })} />
        <StatTile label={t("admin.revenue.analytics.trialConversion")} value={pct(a.trialConversion.rate, locale)} hint={t("admin.revenue.analytics.trialConversionHint", { converted: a.trialConversion.converted, ended: a.trialConversion.ended })} href={`/${locale}/growth`} />
        <StatTile
          label={t("admin.revenue.analytics.ltv")}
          value={a.ltv.minor === null ? t("admin.revenue.analytics.ltvInsufficient") : money(a.ltv.minor)}
          hint={
            a.ltv.minor === null
              ? t("admin.revenue.analytics.ltvNeeds", { days: a.ltv.thresholds.historyDays, paying: a.ltv.thresholds.payingOrgs, churned: a.ltv.thresholds.churnedOrgs })
              : t("admin.revenue.analytics.ltvHint", { churn: pct(a.ltv.monthlyLogoChurn, locale) })
          }
        />
        <StatTile label={t("admin.revenue.analytics.top10")} value={pct(a.concentration.top10, locale)} hint={t("admin.revenue.analytics.top10Hint", { orgs: a.concentration.orgs })} tone={a.concentration.top10 !== null && a.concentration.top10 > 0.5 ? "warning" : undefined} />
      </StatGrid>
      <Card>
        <CardHeader icon={<TrendingUp />} title={t("admin.revenue.analytics.history", { currency: a.currency })} description={t("admin.revenue.analytics.historyHint")} />
        <CardBody>
          {a.series.length > 1 ? (
            <TrendChart title={t("admin.revenue.analytics.history", { currency: a.currency })} days={a.series.map((s) => s.day)} series={[{ label: t("admin.revenue.analytics.mrr", { currency: a.currency }), values: a.series.map((s) => Math.round(Number(s.mrrMinor) / scale)), tone: "success" }]} />
          ) : (
            <Empty>{t("admin.revenue.analytics.oneSnapshot")}</Empty>
          )}
        </CardBody>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Layers />} title={t("admin.revenue.analytics.movement")} description={t("admin.revenue.analytics.movementHint")} />
          <CardBody>
            {a.start && a.end && a.series.some((s) => !s.baseline) ? (
              <Waterfall
                label={t("admin.revenue.analytics.movement")}
                steps={[
                  { key: "start", label: t("admin.revenue.analytics.start"), value: a.start.mrrMinor, display: money(a.start.mrrMinor), kind: "total" },
                  { key: "new", label: t("admin.revenue.analytics.new"), value: a.totals.newMinor, display: money(a.totals.newMinor), kind: "up" },
                  { key: "expansion", label: t("admin.revenue.analytics.expansion"), value: a.totals.expansionMinor, display: money(a.totals.expansionMinor), kind: "up" },
                  { key: "reactivation", label: t("admin.revenue.analytics.reactivation"), value: a.totals.reactivationMinor, display: money(a.totals.reactivationMinor), kind: "up" },
                  { key: "contraction", label: t("admin.revenue.analytics.contraction"), value: a.totals.contractionMinor, display: money(a.totals.contractionMinor), kind: "down" },
                  { key: "churn", label: t("admin.revenue.analytics.churn"), value: a.totals.churnMinor, display: money(a.totals.churnMinor), kind: "down" },
                  { key: "end", label: t("admin.revenue.analytics.end"), value: a.end.mrrMinor, display: money(a.end.mrrMinor), kind: "total" },
                ]}
              />
            ) : (
              <NotAvailable title={t("admin.revenue.analytics.baselineOnly")}>{t("admin.revenue.analytics.baselineOnlyHint")}</NotAvailable>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<PieChart />} title={t("admin.revenue.analytics.byPlan")} description={t("admin.revenue.analytics.byPlanHint")} />
          <CardBody>
            <BarList
              label={t("admin.revenue.analytics.byPlan")}
              tone="success"
              items={a.byPlan.map((p) => ({ key: p.plan, label: p.plan, value: Number(p.mrrMinor) / scale, display: money(p.mrrMinor), href: `/${locale}/subscriptions?plan=${p.plan}` }))}
              empty={<Empty>{t("admin.revenue.noPaying")}</Empty>}
            />
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader icon={<Layers />} title={t("admin.revenue.analytics.daily")} description={t("admin.revenue.analytics.dailyHint")} />
        {a.series.some((s) => !s.baseline) ? (
          <CardBody>
            <TrendChart
              title={t("admin.revenue.analytics.daily")}
              days={a.series.map((s) => s.day)}
              series={[
                { label: t("admin.revenue.analytics.new"), values: a.series.map((s) => Math.round(Number(s.newMinor + s.reactivationMinor) / scale)), tone: "success" },
                { label: t("admin.revenue.analytics.expansion"), values: a.series.map((s) => Math.round(Number(s.expansionMinor) / scale)), tone: "info" },
                { label: t("admin.revenue.analytics.contraction"), values: a.series.map((s) => Math.round(Number(s.contractionMinor) / scale)), tone: "warning" },
                { label: t("admin.revenue.analytics.churn"), values: a.series.map((s) => Math.round(Number(s.churnMinor) / scale)), tone: "danger" },
              ]}
            />
          </CardBody>
        ) : (
          <Empty>{t("admin.revenue.analytics.baselineOnlyHint")}</Empty>
        )}
      </Card>
      <Card>
        <CardHeader icon={<Crown />} title={t("admin.revenue.analytics.concentration")} description={t("admin.revenue.analytics.concentrationHint", { top1: pct(a.concentration.top1, locale), top5: pct(a.concentration.top5, locale) })} />
        {a.concentration.top.length === 0 ? (
          <Empty>{t("admin.revenue.noPaying")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.invoices.common.organization")}</Th>
                <Th>{t("admin.revenue.analytics.mrr", { currency: a.currency })}</Th>
                <Th>{t("admin.revenue.analytics.share")}</Th>
              </Tr>
            </THead>
            <TBody>
              {a.concentration.top.map((o) => (
                <Tr key={o.organizationId}>
                  <Td>
                    <Link href={`/${locale}/organizations/${o.organizationId}`} className="font-medium hover:underline">
                      {o.name}
                    </Link>
                  </Td>
                  <Td className="tabular">{money(o.mrrMinor)}</Td>
                  <Td className="tabular">{pct(o.share, locale)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">{t("admin.revenue.analytics.footnote", { snapshots: formatNumber(a.series.length, locale), tz })}</p>
    </div>
  );
}
