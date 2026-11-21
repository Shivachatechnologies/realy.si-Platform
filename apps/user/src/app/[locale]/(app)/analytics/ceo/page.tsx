import type { Metadata } from "next";
import Link from "next/link";
import { TrendChart } from "@/components/bi/charts";
import { formatChange, formatMetric } from "@/components/bi/format";
import { IssueList } from "@/components/bi/issue-list";
import { MetricTile } from "@/components/bi/metric-tile";
import { RangePicker } from "@/components/bi/range-picker";
import { toChartPoints } from "@/components/bi/series";
import { AnalyticsHeader } from "@/components/bi/shell";
import { PageState } from "@/components/workforce/states";
import { HeaderStrip } from "@/components/workforce/header-strip";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatRelativeTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { ceoDashboard } from "@/server/modules/bi/ceo-dashboard";
import { rangeParams, resolveRange } from "@/server/modules/bi/range";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("analytics.ceo.title") };
}

/** CEO dashboard: the whole company on one page, from the metric registry and existing tables. */
export default async function CeoDashboardPage({ searchParams }: PageProps<"/[locale]/analytics/ceo">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = <AnalyticsHeader t={t} locale={locale} active="ceo" title={t("analytics.ceo.title")} subtitle={t("analytics.ceo.subtitle")} />;
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  if (!(await can(viewer.ctx, "analytics.read", chain))) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const { range, from, to } = rangeParams.parse(sp);
  const r = resolveRange(range, from, to);
  const d = await ceoDashboard(viewer.ctx, org.id, company.id, r);
  const period = `${formatDate(r.from, locale, "UTC")} – ${formatDate(new Date(r.to.getTime() - 1), locale, "UTC")}`;
  const tz = viewer.user.timezone;
  const money = (v: number | null) => formatMetric(v, "money", locale, d.currency, { compact: true });

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <HeaderStrip
        t={t}
        what={t("analytics.ceo.strip.what")}
        why={t("analytics.ceo.strip.why")}
        can={t("analytics.ceo.strip.can")}
        next={t("analytics.ceo.strip.next")}
        action={
          <Link className="text-sm text-primary hover:underline" href={`/${locale}/intelligence/ceo`}>
            {t("intelligence.chat.title")}
          </Link>
        }
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <RangePicker range={range} from={from} to={to} />
        <p className="text-xs text-muted-foreground">{t("analytics.periodVsPrevious", { period })}</p>
      </div>

      {d.revenueSeries || d.expenseSeries ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {d.revenueSeries ? (
            <Card>
              <CardHeader title={t("analytics.ceo.sections.revenue")} />
              <CardBody>
                <TrendChart title={t("analytics.ceo.sections.revenue")} points={toChartPoints(d.revenueSeries, "money", locale, d.currency)} type="bar" emptyLabel={t("analytics.noData")} tableLabels={{ period: t("analytics.period"), value: t("analytics.value") }} maxLabel={money(Math.max(0, ...d.revenueSeries.map((p) => p.value ?? 0)))} />
              </CardBody>
            </Card>
          ) : null}
          {d.expenseSeries ? (
            <Card>
              <CardHeader title={t("analytics.ceo.sections.expenses")} />
              <CardBody>
                <TrendChart title={t("analytics.ceo.sections.expenses")} points={toChartPoints(d.expenseSeries, "money", locale, d.currency)} type="bar" emptyLabel={t("analytics.noData")} tableLabels={{ period: t("analytics.period"), value: t("analytics.value") }} maxLabel={money(Math.max(0, ...d.expenseSeries.map((p) => p.value ?? 0)))} />
              </CardBody>
            </Card>
          ) : null}
        </div>
      ) : null}

      {d.sections.length === 0 ? (
        <Card>
          <CardBody className="text-sm text-muted-foreground">{t("analytics.noMetrics")}</CardBody>
        </Card>
      ) : (
        d.sections.map((s) => (
          <section key={s.section} className="grid gap-2" aria-labelledby={`ceo-${s.section}`}>
            <h2 id={`ceo-${s.section}`} className="text-sm font-semibold text-muted-foreground">
              {t(`analytics.ceo.sections.${s.section}`)}
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
              {s.values.map((v) => (
                <MetricTile
                  key={v.key}
                  label={t(v.labelKey)}
                  value={formatMetric(v.value, v.unit, locale, d.currency, { compact: true })}
                  change={formatChange(v.changePct, locale)}
                  trend={v.trend}
                  previousLabel={v.previous !== null ? t("analytics.previous", { value: formatMetric(v.previous, v.unit, locale, d.currency, { compact: true }) }) : undefined}
                  href={v.href ? `/${locale}${v.href}` : null}
                />
              ))}
            </div>
          </section>
        ))
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("analytics.ceo.goals")} description={t("analytics.ceo.goalsHint")} actions={<Link className="text-xs text-primary hover:underline" href={`/${locale}/objectives/goals`}>{t("analytics.ceo.openGoals")}</Link>} />
          <CardBody className="grid gap-3 text-sm">
            {d.objectives === null ? (
              <p className="text-muted-foreground">{t("intelligence.card.noAccess")}</p>
            ) : d.objectives.length === 0 ? (
              <p className="text-muted-foreground">{t("analytics.ceo.noObjectives")}</p>
            ) : (
              <ul className="grid gap-2">
                {d.objectives.map((o) => {
                  const pct = o.total ? Math.round((o.done / o.total) * 100) : 0;
                  return (
                    <li key={o.id} className="grid gap-1">
                      <span className="flex items-center justify-between gap-2">
                        <Link className="min-w-0 truncate hover:underline" href={`/${locale}/objectives`}>
                          {o.title}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {t("analytics.ceo.milestones", { done: o.done, total: o.total })}
                          {o.targetDate ? ` · ${formatDate(o.targetDate, locale, tz)}` : ""}
                        </span>
                      </span>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={o.title}>
                        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <h3 className="text-xs font-semibold text-muted-foreground">{t("analytics.ceo.kpiTargets")}</h3>
            {d.kpiTargets.length === 0 ? (
              <p className="text-muted-foreground">{t("analytics.ceo.noKpiTargets")}</p>
            ) : (
              <ul className="grid gap-1">
                {d.kpiTargets.map((k, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2 py-1">
                    <span className="min-w-0 truncate">
                      {t(k.labelKey)}{" "}
                      <Link className="text-xs text-muted-foreground hover:underline" href={`/${locale}/workforce/${k.employeeId}`}>
                        · {k.employee}
                      </Link>
                    </span>
                    <span className="flex items-center gap-2 tabular text-xs">
                      {formatMetric(k.value, k.unit, locale, d.currency)} / {formatMetric(k.target, k.unit, locale, d.currency)}
                      {k.onTrack === null ? null : <Badge tone={k.onTrack ? "success" : "warning"}>{k.onTrack ? t("workforce.profile.onTrack") : t("workforce.profile.offTrack")}</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("analytics.ceo.approvals")} actions={<Link className="text-xs text-primary hover:underline" href={`/${locale}/approvals`}>{t("intelligence.actions.allApprovals")}</Link>} />
          <CardBody className="text-sm">
            {d.approvals === null ? (
              <p className="text-muted-foreground">{t("intelligence.card.noAccess")}</p>
            ) : d.approvals.items.length === 0 ? (
              <p className="text-muted-foreground">{t("intelligence.card.noDecisions")}</p>
            ) : (
              <ul className="grid gap-1">
                <li className="text-xs text-muted-foreground">{t("analytics.ceo.pending", { count: d.approvals.pending })}</li>
                {d.approvals.items.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{a.summary}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      <Badge tone={a.risk === "HIGH" || a.risk === "CRITICAL" ? "danger" : "warning"}>{a.risk}</Badge>
                      {formatRelativeTime(a.expiresAt, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("analytics.ceo.risks")} />
          <CardBody>
            <IssueList issues={d.risks} t={t} locale={locale} emptyLabel={t("intelligence.noIssues")} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("analytics.ceo.opportunities")} description={t("analytics.ceo.opportunitiesHint")} />
          <CardBody className="text-sm">
            {d.opportunities.length === 0 ? (
              <p className="text-muted-foreground">{t("analytics.ceo.noOpportunities")}</p>
            ) : (
              <ul className="grid gap-1">
                {d.opportunities.map((o) => (
                  <li key={o.key} className="flex items-center justify-between gap-2">
                    {o.href ? (
                      <Link className="min-w-0 truncate hover:underline" href={`/${locale}${o.href}`}>
                        {t(o.labelKey)}
                      </Link>
                    ) : (
                      <span>{t(o.labelKey)}</span>
                    )}
                    {o.changePct !== null ? <span className="tabular text-xs text-success">{formatChange(o.changePct, locale)}</span> : <Badge tone="success">{t("analytics.ceo.insight")}</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
