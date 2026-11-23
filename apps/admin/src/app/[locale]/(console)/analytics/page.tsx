import { ChartLine } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { AdminHeader, EmptyState, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { TrendChart } from "@/components/admin/viz";
import { DataSource, RangeLinks, pct } from "@/components/admin/billing/ui";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatNumber } from "@/i18n/format";
import { platformAnalytics, type DailyMetricKey } from "@/server/modules/admin/analytics";
import { requireViewer } from "@/server/session";

const GROUPS: { key: string; metrics: DailyMetricKey[] }[] = [
  { key: "activeUsers", metrics: ["users.dau", "users.wau", "users.mau"] },
  { key: "signups", metrics: ["users.signups", "orgs.created", "trials.started"] },
  { key: "subscriptions", metrics: ["subscriptions.active", "subscriptions.trialing", "subscriptions.past_due"] },
  { key: "activity", metrics: ["orgs.active", "ai.tasks", "workflow.runs"] },
];

/** Platform analytics from platform_daily_metrics snapshots (DAU / WAU / MAU and more), tracked from the first run on. */
export default async function AnalyticsPage({ searchParams }: PageProps<"/[locale]/analytics">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const res = await guard(platformAnalytics(viewer.ctx, { days: sp((await searchParams).days) }), t("errors.forbidden"));
  if (!res.ok) return res.node;
  const a = res.value;
  const base = `/${locale}/analytics`;
  // Only tracked days are charted: days before the first snapshot have no data (never shown as 0).
  const firstKey = a.firstSnapshot?.toISOString().slice(0, 10) ?? "";
  const from = Math.max(0, a.dayKeys.findIndex((d) => d >= firstKey));
  const v = (k: DailyMetricKey) => (a.latest[k] === null ? "—" : formatNumber(a.latest[k]!, locale));
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader
        icon={<ChartLine />}
        title={t("admin.analytics.title")}
        description={t("admin.analytics.subtitle")}
        why={t("admin.analytics.why")}
        actions={<RangeLinks base={base} value={a.days} options={[30, 90, 180, 365]} label={t("admin.revenue.overview.range")} format={(d) => t("admin.revenue.overview.days", { count: Number(d) })} />}
        meta={<DataSource source={t("admin.analytics.source")} updatedAt={a.lastComputedAt} updatedLabel={t("admin.revenue.analytics.computed")} stale={a.stale} staleLabel={t("admin.revenue.analytics.stale")} />}
      />
      <Notice tone="info" title={t("admin.analytics.historyTitle")}>
        {a.firstSnapshot ? t("admin.analytics.historySince", { date: formatDate(a.firstSnapshot, locale, "UTC") }) : t("admin.analytics.historyNone")}
      </Notice>
      {!a.firstSnapshot ? (
        <Card>
          <EmptyState icon={<ChartLine />} title={t("admin.analytics.noSnapshots")} body={t("admin.analytics.noSnapshotsHint")} />
        </Card>
      ) : (
        <>
          <StatGrid>
            <StatTile label={t("admin.analytics.metrics.users_dau")} value={v("users.dau")} hint={t("admin.analytics.today")} />
            <StatTile label={t("admin.analytics.metrics.users_wau")} value={v("users.wau")} hint={t("admin.analytics.rolling7")} />
            <StatTile label={t("admin.analytics.metrics.users_mau")} value={v("users.mau")} hint={t("admin.analytics.rolling30")} />
            <StatTile label={t("admin.analytics.stickiness")} value={pct(a.stickiness, locale)} hint={t("admin.analytics.stickinessHint")} />
          </StatGrid>
          {GROUPS.map((gr) => (
            <Card key={gr.key}>
              <CardHeader title={t(`admin.analytics.groups.${gr.key}`)} description={t("admin.analytics.trackedDays", { count: a.trackedDays })} />
              <CardBody>
                <TrendChart
                  title={t(`admin.analytics.groups.${gr.key}`)}
                  days={a.dayKeys.slice(from)}
                  series={gr.metrics.map((m, i) => ({ label: t(`admin.analytics.metrics.${m.replace(".", "_")}`), values: a.series[m].slice(from).map((x) => x ?? 0), tone: (["primary", "info", "success"] as const)[i] }))}
                />
              </CardBody>
            </Card>
          ))}
          <p className="text-xs text-muted-foreground">{t("admin.analytics.footnote")}</p>
        </>
      )}
    </div>
  );
}
