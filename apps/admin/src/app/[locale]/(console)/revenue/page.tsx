import Link from "next/link";
import { AlertTriangle, ArrowDownRight, BadgePercent, CircleDollarSign, Globe2, Landmark, Layers, ReceiptText, Scale, TrendingUp, Undo2, Users } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { AdminHeader, Empty, SectionLink, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { BarList, TrendChart } from "@/components/admin/viz";
import { DataSource, RangeLinks, moneyList, pct } from "@/components/admin/billing/ui";
import { getLocale, getT } from "@/i18n/server";
import { displayName, formatNumber, minorUnits } from "@/i18n/format";
import { billingOverview } from "@/server/modules/admin/billing";
import { revenueOverview } from "@/server/modules/admin/revenue";
import { requireViewer } from "@/server/session";

type MoneyRows = { currency: string; amountMinor: bigint }[];

/**
 * Billing overview: MRR / ARR from live subscriptions; gross, refunds, net, discounts, tax, failed payments,
 * outstanding balances and disputes from the Stripe mirror (platform_* tables); daily trends. Per currency, never mixed.
 */
export default async function AdminRevenuePage({ searchParams }: PageProps<"/[locale]/revenue">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const days = Number(sp((await searchParams).days) ?? 30);
  const [b, r] = await Promise.all([guard(billingOverview(viewer.ctx, { days }), t("errors.forbidden")), guard(revenueOverview(viewer.ctx), t("errors.forbidden"))]);
  if (!b.ok) return b.node;
  const o = b.value;
  const base = `/${locale}`;
  const first = (rows: MoneyRows) => moneyList(rows.slice(0, 1), locale);
  const rest = (rows: MoneyRows) => (rows.length > 1 ? moneyList(rows.slice(1), locale) : undefined);
  const scale = o.series.currency ? 10 ** minorUnits(o.series.currency) : 1;
  const mirrorEmpty = o.mirror.invoices === 0 && o.mirror.payments === 0;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader
        icon={<TrendingUp />}
        title={t("admin.revenue.overview.title")}
        description={t("admin.revenue.overview.subtitle")}
        why={t("admin.revenue.why")}
        actions={<RangeLinks base={`${base}/revenue`} value={o.days} options={[7, 30, 90, 365]} label={t("admin.revenue.overview.range")} format={(d) => t("admin.revenue.overview.days", { count: Number(d) })} />}
        meta={<DataSource source={t("admin.revenue.overview.source")} updatedAt={o.mirror.lastSyncedAt} updatedLabel={t("admin.invoices.common.lastSynced")} />}
      />
      {!o.configured ? <Notice tone="warning" title={t("admin.invoices.common.notConfiguredTitle")}>{t("admin.invoices.common.notConfigured")}</Notice> : null}
      {o.configured && mirrorEmpty ? (
        <Notice tone="info" title={t("admin.invoices.common.emptyMirrorTitle")} action={<SectionLink href={`${base}/invoices`}>{t("admin.invoices.sync.open")}</SectionLink>}>
          {t("admin.invoices.common.emptyMirror")}
        </Notice>
      ) : null}
      <StatGrid>
        <StatTile icon={<CircleDollarSign />} label={t("admin.revenue.mrr")} value={first(o.mrr)} hint={rest(o.mrr) ?? (o.mrr.length ? t("admin.revenue.mrrHint") : t("admin.overview.noMrr"))} tone={o.mrr.length ? "success" : undefined} href={`${base}/revenue/analytics`} />
        <StatTile icon={<Layers />} label={t("admin.revenue.arr")} value={first(o.arr)} hint={rest(o.arr) ?? t("admin.revenue.arrHint")} href={`${base}/revenue/analytics`} />
        <StatTile icon={<Landmark />} label={t("admin.revenue.overview.net")} value={first(o.net)} hint={rest(o.net) ?? t("admin.revenue.overview.netHint")} href={`${base}/payments`} />
        <StatTile icon={<Undo2 />} label={t("admin.revenue.overview.refunds")} value={first(o.refunds)} hint={rest(o.refunds) ?? t("admin.revenue.overview.refundsHint")} href={`${base}/payments/refunds`} tone={o.refunds.length ? "warning" : undefined} />
        <StatTile icon={<AlertTriangle />} label={t("admin.revenue.overview.failed")} value={formatNumber(o.failedPayments, locale)} hint={t("admin.revenue.overview.failedHint", { count: o.failedSubscriptions })} href={`${base}/payments?status=failed`} tone={o.failedPayments || o.failedSubscriptions ? "danger" : undefined} />
        <StatTile icon={<ReceiptText />} label={t("admin.revenue.overview.outstanding")} value={first(o.outstanding)} hint={t("admin.revenue.overview.outstandingHint", { count: o.outstanding.reduce((a, x) => a + x.invoices, 0), overdue: o.overdueInvoices })} href={`${base}/invoices?status=open`} tone={o.overdueInvoices ? "warning" : undefined} />
        <StatTile icon={<BadgePercent />} label={t("admin.revenue.overview.discounts")} value={first(o.discounts)} hint={rest(o.discounts) ?? t("admin.revenue.overview.discountsHint")} href={`${base}/invoices?status=paid`} />
        <StatTile
          icon={<Scale />}
          label={t("admin.revenue.overview.tax")}
          value={o.tax.length ? first(o.tax) : t("admin.revenue.overview.taxNone")}
          hint={o.taxUnknownInvoices ? t("admin.revenue.overview.taxUnknown", { count: o.taxUnknownInvoices }) : t("admin.revenue.overview.taxHint")}
          href={`${base}/invoices?status=paid`}
        />
      </StatGrid>
      {o.openDisputes ? (
        <Notice tone="danger" title={t("admin.payments.disputes.openTitle", { count: o.openDisputes })} action={<SectionLink href={`${base}/payments/disputes?open=1`}>{t("admin.payments.disputes.investigate")}</SectionLink>}>
          {t("admin.payments.disputes.openBody", { amount: moneyList(o.disputedAmount, locale) })}
        </Notice>
      ) : null}
      <Card>
        <CardHeader icon={<TrendingUp />} title={t("admin.revenue.overview.trend", { currency: o.series.currency ?? "—" })} description={t("admin.revenue.overview.trendHint")} actions={<SectionLink href={`${base}/payments`}>{t("admin.payments.title")}</SectionLink>} />
        <CardBody>
          {o.series.currency ? (
            <TrendChart
              title={t("admin.revenue.overview.trend", { currency: o.series.currency })}
              days={o.series.days}
              series={[
                { label: t("admin.revenue.overview.gross"), values: o.series.gross.map((v) => Math.round(v / scale)), tone: "success" },
                { label: t("admin.revenue.overview.refunds"), values: o.series.refunds.map((v) => Math.round(v / scale)), tone: "warning" },
                { label: t("admin.revenue.overview.failedCount"), values: o.series.failed, tone: "danger" },
              ]}
            />
          ) : (
            <Empty>{t("admin.revenue.overview.noPayments")}</Empty>
          )}
        </CardBody>
      </Card>
      {r.ok ? (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <StatTile icon={<Users />} label={t("admin.revenue.paying")} value={formatNumber(r.value.paying, locale)} hint={t("admin.revenue.trialing", { count: r.value.trialing })} href={`${base}/subscriptions?status=ACTIVE`} />
            <StatTile icon={<ArrowDownRight />} label={t("admin.revenue.churnRate")} value={pct(r.value.churnRate, locale)} hint={t("admin.revenue.canceled30", { count: r.value.canceled30 })} tone={r.value.churnRate !== null && r.value.churnRate > 0.05 ? "warning" : undefined} href={`${base}/subscriptions?status=CANCELED`} />
            <StatTile icon={<TrendingUp />} label={t("admin.revenue.overview.analytics")} value={t("admin.revenue.overview.open")} hint={t("admin.revenue.overview.analyticsHint")} href={`${base}/revenue/analytics`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader icon={<Layers />} title={t("admin.revenue.byPlan")} description={t("admin.revenue.byPlanHint")} />
              <CardBody>
                <BarList
                  label={t("admin.revenue.byPlan")}
                  tone="success"
                  items={r.value.byPlan.map((p) => ({ key: p.planId, label: p.name, value: p.subs, display: `${formatNumber(p.subs, locale)} · ${moneyList(p.mrr, locale)}`, href: `${base}/subscriptions?plan=${p.key}` }))}
                  empty={<Empty>{t("admin.revenue.noPaying")}</Empty>}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader icon={<Globe2 />} title={t("admin.revenue.byCountry")} description={t("admin.revenue.byCountryHint")} />
              <CardBody>
                <BarList
                  label={t("admin.revenue.byCountry")}
                  items={r.value.byCountry.slice(0, 15).map((c) => ({ key: c.country, label: `${displayName(c.country, "region", locale)} (${c.country})`, value: c.subs, display: `${formatNumber(c.subs, locale)} · ${moneyList(c.mrr, locale)}` }))}
                  empty={<Empty>{t("admin.revenue.noPaying")}</Empty>}
                />
              </CardBody>
            </Card>
          </div>
        </>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {t("admin.revenue.overview.footnote")}{" "}
        <Link className="text-primary hover:underline" href={`${base}/invoices`}>
          {t("admin.invoices.title")}
        </Link>
      </p>
    </div>
  );
}
