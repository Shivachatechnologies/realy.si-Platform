import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, Trash2 } from "lucide-react";
import { TrendChart } from "@/components/bi/charts";
import { EditDashboardDialog } from "@/components/bi/edit-dialog";
import { formatChange, formatMetric } from "@/components/bi/format";
import { MetricTile } from "@/components/bi/metric-tile";
import { toChartPoints } from "@/components/bi/series";
import { WidgetForm } from "@/components/bi/widget-form";
import { ActionButton } from "@/components/workforce/action-button";
import { PageHeader } from "@/components/workforce/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { getDashboard } from "@/server/modules/bi/dashboards";
import { resolveRange, type RangeKey } from "@/server/modules/bi/range";
import { BI_DEPARTMENTS, metricContext, metricSeries, metricValues } from "@/server/modules/bi/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("analytics.dashboards.title") };
}

export default async function DashboardPage({ params }: PageProps<"/[locale]/analytics/dashboards/[dashboardId]">) {
  const { dashboardId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  if (!company) notFound();
  const d = await getDashboard(viewer.ctx, org.id, company.id, dashboardId).catch((err) => {
    if (isAppError(err) && (err.code === "not_found" || err.code === "forbidden")) notFound();
    throw err;
  });
  const chain = await companyChain(db(), org.id, company.id);
  const canManage = await can(viewer.ctx, "analytics.manage", chain);
  const { scope, metrics } = await metricContext(viewer.ctx, org.id, company.id);
  const byKey = new Map(metrics.map((m) => [m.key, m]));
  const rendered = await Promise.all(
    d.widgets.map(async (w) => {
      const m = byKey.get(w.metricKey);
      if (!m) return { w, m: null, value: null, series: null };
      const r = resolveRange(w.range as RangeKey);
      if (w.chartType === "NUMBER") return { w, m, value: (await metricValues([m], scope, r))[0]!, series: null };
      return { w, m, value: null, series: await metricSeries(m, scope, r) };
    }),
  );
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const base = `${apiBase}/analytics/dashboards/${d.id}`;
  const ids = d.widgets.map((w) => w.id);
  const moved = (i: number, delta: number) => {
    const next = [...ids];
    [next[i], next[i + delta]] = [next[i + delta]!, next[i]!];
    return { widgetIds: next };
  };
  const options = BI_DEPARTMENTS.flatMap((dep) => metrics.filter((m) => m.department === dep).map((m) => ({ key: m.key, label: t(m.labelKey), group: t(`analytics.departments.${dep}`) })));

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <Link href={`/${locale}/analytics/dashboards`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
        {t("analytics.dashboards.back")}
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {d.name}
            <Badge tone={d.shared ? "accent" : "neutral"}>{d.shared ? t("analytics.dashboards.shared") : t("analytics.dashboards.private")}</Badge>
          </span>
        }
        subtitle={d.description ?? undefined}
        actions={
          canManage ? (
            <>
              <EditDashboardDialog apiBase={apiBase} dashboardId={d.id} initial={{ name: d.name, description: d.description ?? "", shared: d.shared }} label={t("analytics.dashboards.edit")} />
              <ActionButton path={base} method="PATCH" body={{ shared: !d.shared }}>
                {d.shared ? t("analytics.dashboards.makePrivate") : t("analytics.dashboards.share")}
              </ActionButton>
              <ActionButton path={base} method="DELETE" variant="ghost" confirm={t("analytics.dashboards.confirmDelete", { name: d.name })} redirectTo="/analytics/dashboards">
                <Trash2 aria-hidden />
                {t("analytics.dashboards.delete")}
              </ActionButton>
            </>
          ) : null
        }
      />
      {canManage ? (
        <Card>
          <CardHeader title={t("analytics.widgets.addTitle")} />
          <CardBody>
            <WidgetForm path={`${base}/widgets`} metrics={options} />
          </CardBody>
        </Card>
      ) : null}
      {rendered.length === 0 ? (
        <Card>
          <CardBody className="text-sm text-muted-foreground">{t("analytics.widgets.empty")}</CardBody>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rendered.map(({ w, m, value, series }, i) => {
            const title = w.title || (m ? t(m.labelKey) : w.metricKey);
            const controls = canManage ? (
              <span className="flex gap-0.5">
                {i > 0 ? (
                  <ActionButton path={`${base}/widgets/reorder`} body={moved(i, -1)} variant="ghost" size="icon">
                    <ArrowUp aria-hidden />
                    <span className="sr-only">{t("analytics.widgets.moveUp")}</span>
                  </ActionButton>
                ) : null}
                {i < rendered.length - 1 ? (
                  <ActionButton path={`${base}/widgets/reorder`} body={moved(i, 1)} variant="ghost" size="icon">
                    <ArrowDown aria-hidden />
                    <span className="sr-only">{t("analytics.widgets.moveDown")}</span>
                  </ActionButton>
                ) : null}
                <ActionButton path={`${base}/widgets/${w.id}`} method="DELETE" variant="ghost" size="icon" confirm={t("analytics.widgets.confirmRemove")}>
                  <Trash2 aria-hidden />
                  <span className="sr-only">{t("analytics.widgets.remove")}</span>
                </ActionButton>
              </span>
            ) : null;
            return (
              <Card key={w.id} className={w.chartType === "NUMBER" ? undefined : "md:col-span-2 xl:col-span-1"}>
                <CardHeader title={title} description={t(`analytics.range.${w.range}`)} actions={controls} />
                <CardBody>
                  {!m ? (
                    <p className="text-sm text-muted-foreground">{t("analytics.widgets.unavailable")}</p>
                  ) : value ? (
                    <MetricTile
                      label={t(m.labelKey)}
                      value={formatMetric(value.value, m.unit, locale, scope.currency)}
                      change={formatChange(value.changePct, locale)}
                      trend={value.trend}
                      previousLabel={value.previous !== null ? t("analytics.previous", { value: formatMetric(value.previous, m.unit, locale, scope.currency, { compact: true }) }) : undefined}
                      href={m.href ? `/${locale}${m.href}` : null}
                      className="border-0 p-0"
                    />
                  ) : (
                    <TrendChart
                      title={title}
                      points={toChartPoints(series ?? [], m.unit, locale, scope.currency)}
                      type={w.chartType === "BAR" ? "bar" : "line"}
                      emptyLabel={t("analytics.noData")}
                      tableLabels={{ period: t("analytics.period"), value: t("analytics.value") }}
                      maxLabel={formatMetric(Math.max(0, ...(series ?? []).map((p) => p.value ?? 0)), m.unit, locale, scope.currency, { compact: true })}
                    />
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
