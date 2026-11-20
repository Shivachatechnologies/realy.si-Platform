import type { Metadata } from "next";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { productWorkspace } from "@/components/work/product-ui";
import { StatCard } from "@/components/work/ui";
import { formatDate } from "@/i18n/format";
import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { productAnalytics } from "@/server/modules/work/product-delivery";
import { productVisuals } from "@/server/modules/work/product-journey";
import { ActivityChart, ProgressionFunnel, ReleaseFlow } from "@/components/work/product-visuals";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("product.workspace.tabs.analytics") };
}

/** Horizontal bars (label, value) scaled to the largest value. */
function Bars({ rows, unit, tone }: { rows: { label: string; value: number | null; highlight?: boolean }[]; unit?: string; tone?: "success" | "danger" }) {
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <ul className="grid gap-1.5 text-xs">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[9rem_minmax(0,1fr)_3.5rem] items-center gap-2">
          <span className={cn("truncate", r.highlight ? "font-semibold" : "text-muted-foreground")}>{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-muted">
            <span className={cn("block h-full rounded-full bg-primary", tone === "success" && "bg-success", tone === "danger" && "bg-danger")} style={{ width: `${((r.value ?? 0) / max) * 100}%` }} />
          </span>
          <span className="text-end tabular-nums">{r.value == null ? "—" : `${r.value}${unit ?? ""}`}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function ProductAnalyticsPage({ params }: PageProps<"/[locale]/product/[productId]/analytics">) {
  const { productId } = await params;
  const w = await productWorkspace(productId, "analytics");
  if (w.gate) return w.gate;
  const { t, locale, viewer, org, company } = w;
  const [a, v] = await Promise.all([productAnalytics(viewer.ctx, org.id, company.id, productId), productVisuals(viewer.ctx, org.id, company.id, productId)]);
  const month = (m: string) => formatDate(new Date(`${m}-01T00:00:00Z`), locale, "UTC", { month: "short", year: "2-digit" });
  const rated = a.feedback.sentiment.POSITIVE + a.feedback.sentiment.NEUTRAL + a.feedback.sentiment.NEGATIVE;
  const d = t("product.analytics.daysUnit");
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {w.header}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label={t("product.analytics.featuresShipped")} value={a.features.shipped} hint={t("product.analytics.ofTotal", { total: a.features.total })} tone="success" />
        <StatCard label={t("product.analytics.lifecycleProgress")} value={`${a.progress}%`} hint={t("product.analytics.daysInLifecycle", { count: a.daysInLifecycle })} />
        <StatCard label={t("product.analytics.releases")} value={a.releases.count} hint={a.releases.last ? t("product.analytics.lastRelease", { date: formatDate(a.releases.last, locale, "UTC") }) : undefined} />
        <StatCard label={t("product.analytics.cadence")} value={a.releases.avgDaysBetween != null ? `${a.releases.avgDaysBetween} ${d}` : "—"} hint={t("product.analytics.cadenceHint")} />
        <StatCard label={t("product.analytics.feedback6m")} value={a.feedback.byMonth.reduce((s, x) => s + x.count, 0)} />
        <StatCard label={t("product.analytics.negativeShare")} value={rated ? `${Math.round((a.feedback.sentiment.NEGATIVE / rated) * 100)}%` : "—"} tone={rated && a.feedback.sentiment.NEGATIVE / rated > 0.3 ? "danger" : undefined} hint={t("product.analytics.ratedCount", { count: rated })} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card variant="elevated">
          <CardHeader title={t("product.visuals.activityTitle")} description={t("product.visuals.activityHint")} />
          <CardBody>{v.hasProject ? <ActivityChart weeks={v.weeks} locale={locale} /> : <p className="text-sm text-muted-foreground">{t("product.backlog.noProject")}</p>}</CardBody>
        </Card>
        <Card variant="elevated">
          <CardHeader title={t("product.visuals.flowTitle")} description={t("product.visuals.flowHint")} />
          <CardBody className="grid gap-4">
            <ReleaseFlow releases={v.releases} />
            <ProgressionFunnel steps={v.funnel} />
          </CardBody>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("product.analytics.cycleTime")} description={t("product.analytics.cycleTimeHint")} />
          <CardBody>
            <Bars rows={a.stages.map((s) => ({ label: t(`product.stages.${s.stage}`), value: s.days, highlight: s.current }))} unit={` ${d}`} />
          </CardBody>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("product.analytics.shippedByMonth")} />
            <CardBody>
              <Bars rows={a.features.shippedByMonth.map((m) => ({ label: month(m.month), value: m.count }))} tone="success" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("product.analytics.feedbackByMonth")} />
            <CardBody className="grid gap-4">
              <Bars rows={a.feedback.byMonth.map((m) => ({ label: month(m.month), value: m.count }))} />
              <Bars
                rows={(["POSITIVE", "NEUTRAL", "NEGATIVE", "UNRATED"] as const).map((s) => ({ label: s === "UNRATED" ? t("product.feedback.unrated") : t(`product.sentiment.${s}`), value: a.feedback.sentiment[s] }))}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("product.analytics.features")} />
            <CardBody className="grid gap-4">
              <Bars rows={(["PROPOSED", "PLANNED", "IN_PROGRESS", "SHIPPED", "CANCELLED"] as const).map((s) => ({ label: t(`work.itemStatus.${s}`), value: a.features.byStatus[s] ?? 0 }))} />
              {Object.keys(a.tasks).length ? (
                <Bars rows={(["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"] as const).map((s) => ({ label: t(`work.taskStatus.${s}`), value: a.tasks[s] ?? 0 }))} />
              ) : (
                <p className="text-sm text-muted-foreground">{t("product.backlog.noProject")}</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
