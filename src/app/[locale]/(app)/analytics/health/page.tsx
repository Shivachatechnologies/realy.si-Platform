import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowDownRight, ArrowUpRight, Info, Minus } from "lucide-react";
import { AnalyticsHeader } from "@/components/bi/shell";
import { formatChange, formatMetric } from "@/components/bi/format";
import { DepartmentBars, ForecastChart, HealthDial } from "@/components/bi/health-graphics";
import { DoThisButton } from "@/components/bi/do-this-button";
import { insightCommand, insightText } from "@/components/bi/insight-text";
import { PageState } from "@/components/workforce/states";
import { Badge } from "@/components/ui/badge";
import { Section } from "@/components/ui/scene";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { businessHealth } from "@/server/modules/bi/health";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("analytics.health.title") };
}

/** Business health: explainable score, department performance, projections from real history and actionable insights. */
export default async function BusinessHealthPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = <AnalyticsHeader t={t} locale={locale} active="health" title={t("analytics.health.title")} subtitle={t("analytics.health.subtitle")} />;
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  if (!(await can(viewer.ctx, "analytics.read", chain))) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;
  const canRun = await can(viewer.ctx, "agents.run", chain);
  const health = await businessHealth(viewer.ctx, org.id, company.id);
  const base = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const runBlocked = !aiConfigured() ? t("guide.ai.notConfigured") : !canRun ? t("guide.ai.forbidden") : null;
  const week = (iso: string) => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(iso));
  const verdict = health.score === null ? "unknown" : health.score >= 65 ? "strong" : health.score >= 45 ? "steady" : "weak";

  return (
    <div className="mx-auto grid max-w-[1400px] gap-10">
      {header}

      <section className="grid gap-6 rounded-3xl border bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--primary)_10%,var(--surface)),var(--surface)_70%)] p-5 sm:p-8 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
        <HealthDial score={health.score} label={t("analytics.health.dialAria", { score: health.score ?? "—" })} caption={t("analytics.health.outOf")} />
        <div className="grid gap-4">
          <p className="text-micro uppercase text-muted-foreground">{t("analytics.health.eyebrow")}</p>
          <h2 className="font-display text-display-lg">{t(`analytics.health.verdict.${verdict}`)}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {health.score === null ? t("analytics.health.notEnough", { min: 3 }) : t("analytics.health.explain", { metrics: health.scoredMetrics, base: health.base ?? 0, penalty: health.penalty, issues: health.issues })}
          </p>
          <details className="max-w-2xl rounded-xl border bg-surface/70 p-3 text-sm">
            <summary className="flex min-h-9 cursor-pointer items-center gap-2 font-medium">
              <Info className="size-4 text-primary" aria-hidden />
              {t("analytics.health.howTitle")}
            </summary>
            <ul className="mt-2 grid list-disc gap-1 ps-5 text-muted-foreground">
              <li>{t("analytics.health.how1")}</li>
              <li>{t("analytics.health.how2")}</li>
              <li>{t("analytics.health.how3")}</li>
              <li>{t("analytics.health.how4")}</li>
            </ul>
          </details>
        </div>
      </section>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Section index={1} eyebrow={t("analytics.health.last30")} title={t("analytics.health.departmentsTitle")}>
          {health.departments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("analytics.noMetrics")}</p>
          ) : (
            <DepartmentBars
              title={t("analytics.health.departmentsTitle")}
              rows={health.departments.map((d) => ({
                key: d.department,
                label: t(`analytics.departments.${d.department}`),
                score: d.score,
                note: d.score === null ? t("analytics.health.deptNoScore") : t("analytics.health.deptNote", { improving: d.improving, declining: d.declining, total: d.metrics.length }),
                href: `/${locale}/analytics/departments/${d.department}`,
              }))}
            />
          )}
        </Section>

        <Section index={2} eyebrow={t("analytics.health.insightsEyebrow")} title={t("analytics.health.insightsTitle")} description={t("analytics.health.insightsHint")}>
          {health.insights.length === 0 ? (
            <div className="grid justify-items-start gap-2 rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
              <Activity className="size-5 text-success" aria-hidden />
              {t("analytics.health.noInsights")}
            </div>
          ) : (
            <ul className="grid gap-3">
              {health.insights.slice(0, 10).map((i) => (
                <li key={i.id} className="relative grid gap-3 overflow-hidden rounded-2xl border bg-surface/80 p-4 ps-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <span aria-hidden className={`absolute inset-y-0 start-0 w-1 ${i.severity === "critical" ? "bg-danger" : i.severity === "warning" ? "bg-warning" : "bg-info"}`} />
                  <div className="grid gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={i.severity === "critical" ? "danger" : i.severity === "warning" ? "warning" : "info"}>{t(`analytics.health.severity.${i.severity}`)}</Badge>
                      {i.department ? <span className="text-xs text-muted-foreground">{t(`analytics.departments.${i.department}`)}</span> : null}
                    </span>
                    <p className="text-sm font-medium">{insightText(t, i)}</p>
                    {i.href?.startsWith("/") ? (
                      <Link href={`/${locale}${i.href}`} className="text-xs text-primary hover:underline">
                        {t("analytics.health.openEvidence")}
                      </Link>
                    ) : null}
                  </div>
                  <DoThisButton base={base} command={insightCommand(t, i)} disabledReason={runBlocked} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section index={3} eyebrow={t("analytics.health.forecastEyebrow")} title={t("analytics.health.forecastTitle")} description={t("analytics.health.forecastHint")}>
        {health.forecasts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("analytics.health.noForecast")}</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {health.forecasts.map((f) => {
              const fmt = (v: number | null) => formatMetric(v, f.unit, locale, health.currency, { compact: true });
              const good = f.higherIsBetter === null || f.projectedChangePct === null ? 0 : (f.projectedChangePct > 0) === f.higherIsBetter ? 1 : -1;
              const Icon = good === 1 ? ArrowUpRight : good === -1 ? ArrowDownRight : Minus;
              return (
                <article key={f.key} className="grid gap-3 rounded-2xl border bg-surface/80 p-4">
                  <header className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-medium">{t(f.labelKey)}</h3>
                      <p className="text-xs text-muted-foreground">{t("analytics.health.fit", { r2: formatNumber(f.r2, locale, { maximumFractionDigits: 2 }) })}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1 text-sm font-medium ${good === 1 ? "text-success" : good === -1 ? "text-danger" : "text-muted-foreground"}`}>
                      <Icon className="size-4 rtl:-scale-x-100" aria-hidden />
                      {formatChange(f.projectedChangePct, locale) ?? "—"}
                    </span>
                  </header>
                  <ForecastChart
                    title={t("analytics.health.forecastAria", { metric: t(f.labelKey) })}
                    history={f.history.map((p) => ({ label: week(p.from), value: p.value, display: fmt(p.value) }))}
                    projection={f.projection.map((p) => ({ label: week(p.from), value: p.value, display: fmt(p.value) }))}
                    labels={{ period: t("analytics.period"), value: t("analytics.value"), actual: t("analytics.health.actual"), projected: t("analytics.health.projected") }}
                  />
                  <p className="text-xs text-muted-foreground">{f.r2 < 0.3 ? t("analytics.health.lowFit") : t("analytics.health.projectionNote", { weeks: 4 })}</p>
                </article>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
