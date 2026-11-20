import type { Metadata } from "next";
import Link from "next/link";
import { TrendChart } from "@/components/bi/charts";
import { formatChange, formatMetric } from "@/components/bi/format";
import { MetricTile } from "@/components/bi/metric-tile";
import { RangePicker } from "@/components/bi/range-picker";
import { toChartPoints } from "@/components/bi/series";
import { AnalyticsHeader } from "@/components/bi/shell";
import { PageState, qs } from "@/components/workforce/states";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { rangeParams, resolveRange } from "@/server/modules/bi/range";
import { BI_DEPARTMENTS, metricContext, metricSeries, metricValues } from "@/server/modules/bi/service";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.analytics.title") };
}

export default async function AnalyticsPage({ searchParams }: PageProps<"/[locale]/analytics">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = <AnalyticsHeader t={t} locale={locale} active="overview" />;
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  if (!(await can(viewer.ctx, "analytics.read", chain))) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;

  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const { range, from, to } = rangeParams.parse(sp);
  const r = resolveRange(range, from, to);
  const { scope, metrics } = await metricContext(viewer.ctx, org.id, company.id);
  const values = await metricValues(metrics, scope, r);
  const focus = metrics.find((m) => m.key === sp.metric) ?? metrics.find((m) => m.department === "executive" || m.department === "finance") ?? metrics[0];
  const series = focus ? await metricSeries(focus, scope, r) : [];
  const departments = BI_DEPARTMENTS.filter((d) => values.some((v) => v.department === d));
  const period = `${formatDate(r.from, locale, "UTC")} – ${formatDate(new Date(r.to.getTime() - 1), locale, "UTC")}`;
  const keep = { range, from: range === "custom" ? from : undefined, to: range === "custom" ? to : undefined };

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <RangePicker range={range} from={from} to={to} />
        <p className="text-xs text-muted-foreground">{t("analytics.periodVsPrevious", { period })}</p>
      </div>
      {metrics.length === 0 ? (
        <Card>
          <CardBody className="text-sm text-muted-foreground">{t("analytics.noMetrics")}</CardBody>
        </Card>
      ) : (
        <>
          {focus ? (
            <Card>
              <CardHeader
                title={t("analytics.trendOf", { metric: t(focus.labelKey) })}
                actions={
                  <form method="get" className="flex items-center gap-2">
                    {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
                    <label htmlFor="focus-metric" className="sr-only">
                      {t("analytics.widgets.metric")}
                    </label>
                    <Select id="focus-metric" name="metric" defaultValue={focus.key} className="h-8 w-56">
                      {metrics.map((m) => (
                        <option key={m.key} value={m.key}>
                          {t(m.labelKey)}
                        </option>
                      ))}
                    </Select>
                    <Button type="submit" size="sm" variant="secondary">
                      {t("analytics.show")}
                    </Button>
                  </form>
                }
              />
              <CardBody>
                <TrendChart
                  title={t("analytics.trendOf", { metric: t(focus.labelKey) })}
                  points={toChartPoints(series, focus.unit, locale, scope.currency)}
                  type={focus.kind === "flow" ? "bar" : "line"}
                  emptyLabel={t("analytics.noData")}
                  tableLabels={{ period: t("analytics.period"), value: t("analytics.value") }}
                  maxLabel={formatMetric(Math.max(0, ...series.map((p) => p.value ?? 0)), focus.unit, locale, scope.currency, { compact: true })}
                />
              </CardBody>
            </Card>
          ) : null}
          {departments.map((d) => (
            <section key={d} className="grid gap-2" aria-labelledby={`kpi-${d}`}>
              <div className="flex items-center justify-between">
                <h2 id={`kpi-${d}`} className="text-sm font-semibold text-muted-foreground">
                  {t(`analytics.departments.${d}`)}
                </h2>
                <Link className="text-xs text-primary hover:underline" href={`/${locale}/analytics/departments/${d}${qs(keep)}`}>
                  {t("analytics.openDepartment")}
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                {values
                  .filter((v) => v.department === d)
                  .map((v) => (
                    <MetricTile
                      key={v.key}
                      label={t(v.labelKey)}
                      value={formatMetric(v.value, v.unit, locale, scope.currency, { compact: true })}
                      change={formatChange(v.changePct, locale)}
                      trend={v.trend}
                      previousLabel={v.previous !== null ? t("analytics.previous", { value: formatMetric(v.previous, v.unit, locale, scope.currency, { compact: true }) }) : undefined}
                      href={`/${locale}/analytics${qs({ ...keep, metric: v.key })}`}
                    />
                  ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
