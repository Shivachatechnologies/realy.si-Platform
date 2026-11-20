import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { TrendChart } from "@/components/bi/charts";
import { formatChange, formatMetric } from "@/components/bi/format";
import { MetricTile } from "@/components/bi/metric-tile";
import { RangePicker } from "@/components/bi/range-picker";
import { toChartPoints } from "@/components/bi/series";
import { AnalyticsHeader } from "@/components/bi/shell";
import { PageState, qs } from "@/components/workforce/states";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { rangeParams, resolveRange } from "@/server/modules/bi/range";
import { BI_DEPARTMENTS, metricContext, metricSeries, metricValues, type BiDepartment } from "@/server/modules/bi/service";
import { requireOrgContext } from "@/server/workspace";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/[locale]/analytics/departments/[department]">): Promise<Metadata> {
  const { department } = await params;
  const t = await getT();
  return { title: `${t(`analytics.departments.${department}`)} · ${t("modules.analytics.title")}` };
}

export default async function DepartmentPage({ params, searchParams }: PageProps<"/[locale]/analytics/departments/[department]">) {
  const { department } = await params;
  if (!(BI_DEPARTMENTS as readonly string[]).includes(department)) notFound();
  const dept = department as BiDepartment;
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = <AnalyticsHeader t={t} locale={locale} active="departments" title={t("analytics.departmentTitle", { department: t(`analytics.departments.${dept}`) })} />;
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  if (!(await can(viewer.ctx, "analytics.read", chain))) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;

  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const { range, from, to } = rangeParams.parse(sp);
  const r = resolveRange(range, from, to);
  const { scope, metrics } = await metricContext(viewer.ctx, org.id, company.id);
  const mine = metrics.filter((m) => m.department === dept);
  const [values, series] = await Promise.all([metricValues(mine, scope, r), Promise.all(mine.map((m) => metricSeries(m, scope, r)))]);
  const keep = { range, from: range === "custom" ? from : undefined, to: range === "custom" ? to : undefined };

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <nav className="flex flex-wrap gap-1 text-sm" aria-label={t("analytics.tabs.departments")}>
        {BI_DEPARTMENTS.map((d) => (
          <Link
            key={d}
            href={`/${locale}/analytics/departments/${d}${qs(keep)}`}
            aria-current={d === dept ? "page" : undefined}
            className={cn("rounded-md border px-2.5 py-1", d === dept ? "border-primary bg-muted font-medium" : "text-muted-foreground hover:bg-muted")}
          >
            {t(`analytics.departments.${d}`)}
          </Link>
        ))}
      </nav>
      <RangePicker range={range} from={from} to={to} />
      {mine.length === 0 ? (
        <Card>
          <CardBody className="text-sm text-muted-foreground">{t("analytics.noDepartmentMetrics")}</CardBody>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            {values.map((v, i) => (
              <MetricTile
                key={v.key}
                label={t(v.labelKey)}
                value={formatMetric(v.value, v.unit, locale, scope.currency, { compact: true })}
                change={formatChange(v.changePct, locale)}
                trend={v.trend}
                spark={series[i]!.map((p) => p.value)}
                href={v.href ? `/${locale}${v.href}` : null}
              />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {mine.map((m, i) => (
              <Card key={m.key}>
                <CardHeader
                  title={t(m.labelKey)}
                  description={formatMetric(values[i]!.value, m.unit, locale, scope.currency)}
                  actions={
                    m.href ? (
                      <Link href={`/${locale}${m.href}`} className="flex items-center gap-1 text-xs text-primary hover:underline">
                        {t("analytics.drilldown")}
                        <ExternalLink aria-hidden className="size-3" />
                      </Link>
                    ) : null
                  }
                />
                <CardBody>
                  <TrendChart
                    title={t("analytics.trendOf", { metric: t(m.labelKey) })}
                    points={toChartPoints(series[i]!, m.unit, locale, scope.currency)}
                    type={m.kind === "flow" ? "bar" : "line"}
                    emptyLabel={t("analytics.noData")}
                    tableLabels={{ period: t("analytics.period"), value: t("analytics.value") }}
                    maxLabel={formatMetric(Math.max(0, ...series[i]!.map((p) => p.value ?? 0)), m.unit, locale, scope.currency, { compact: true })}
                  />
                </CardBody>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
