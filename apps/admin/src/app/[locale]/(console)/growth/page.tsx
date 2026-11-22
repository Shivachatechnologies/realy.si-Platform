import { Filter, Megaphone, Rocket, TicketPercent, UserPlus, Users } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { AdminHeader, Empty, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { BarList, TrendChart } from "@/components/admin/viz";
import { CohortGrid, DataSource, Funnel, NotAvailable, RangeLinks, pct } from "@/components/admin/billing/ui";
import { getLocale, getT } from "@/i18n/server";
import { displayName, formatNumber } from "@/i18n/format";
import { growthOverview } from "@/server/modules/admin/growth";
import { requireViewer } from "@/server/session";

/** Growth: sign-ups, sources, activation funnel, retention cohorts, trial conversion, churn, checkout, waitlist, coupons. */
export default async function GrowthPage({ searchParams }: PageProps<"/[locale]/growth">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const res = await guard(growthOverview(viewer.ctx, { days: sp((await searchParams).days) }), t("errors.forbidden"));
  if (!res.ok) return res.node;
  const g = res.value;
  const base = `/${locale}/growth`;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader
        icon={<Rocket />}
        title={t("admin.growth.title")}
        description={t("admin.growth.subtitle")}
        why={t("admin.growth.why")}
        actions={<RangeLinks base={base} value={g.days} options={[30, 90, 180, 365]} label={t("admin.revenue.overview.range")} format={(d) => t("admin.revenue.overview.days", { count: Number(d) })} />}
        meta={<DataSource source={t("admin.growth.source")} />}
      />
      <StatGrid>
        <StatTile icon={<UserPlus />} label={t("admin.growth.signups")} value={formatNumber(g.signups.total, locale)} hint={t("admin.revenue.overview.days", { count: g.days })} href={`/${locale}/users`} />
        <StatTile icon={<Rocket />} label={t("admin.growth.activation")} value={pct(g.activation7d, locale)} hint={t("admin.growth.activationHint")} />
        <StatTile icon={<Users />} label={t("admin.growth.trialConversion")} value={pct(g.trials.rate, locale)} hint={t("admin.growth.trialConversionHint", { converted: g.trials.converted, ended: g.trials.ended, started: g.trials.started })} href={`/${locale}/revenue/analytics`} />
        <StatTile label={t("admin.growth.churn")} value={pct(g.churn.rate, locale)} hint={t("admin.growth.churnHint", { canceled: g.churn.canceled, base: g.churn.base })} tone={g.churn.rate !== null && g.churn.rate > 0.05 ? "warning" : undefined} href={`/${locale}/subscriptions?status=CANCELED`} />
        <StatTile label={t("admin.growth.checkout")} value={pct(g.checkout.rate, locale)} hint={t("admin.growth.checkoutHint", { completed: g.checkout.byStatus.COMPLETED ?? 0, total: g.checkout.total })} />
      </StatGrid>
      <Card>
        <CardHeader icon={<UserPlus />} title={t("admin.growth.signupsDaily")} />
        <CardBody>
          <TrendChart title={t("admin.growth.signupsDaily")} days={g.signups.days} series={[{ label: t("admin.growth.signups"), values: g.signups.values, tone: "primary" }]} />
        </CardBody>
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader icon={<Filter />} title={t("admin.growth.funnel")} description={t("admin.growth.funnelHint")} />
          <CardBody>{g.funnel.length ? <Funnel locale={locale} steps={g.funnel.map((s) => ({ key: s.step, label: t(`admin.growth.steps.${s.step}`), count: s.count }))} /> : <Empty>{t("admin.growth.noSignups")}</Empty>}</CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Megaphone />} title={t("admin.growth.sources")} description={t("admin.growth.sourcesHint")} />
          <CardBody className="grid gap-3">
            <BarList label={t("admin.growth.methods")} items={g.methods.map((m) => ({ key: m.method, label: t(`admin.growth.methodNames.${["password", "google", "microsoft", "github", "apple"].includes(m.method) ? m.method : "other"}`), value: m.count }))} empty={<Empty>{t("admin.growth.noSignups")}</Empty>} />
            <NotAvailable title={t("admin.growth.utm")}>{t("admin.growth.utmHint")}</NotAvailable>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("admin.growth.countries")} />
          <CardBody>
            <BarList label={t("admin.growth.countries")} items={g.countries.map((c) => ({ key: c.country ?? "none", label: c.country ? `${displayName(c.country, "region", locale)} (${c.country})` : t("admin.growth.unknownCountry"), value: c.count }))} empty={<Empty>{t("admin.growth.noSignups")}</Empty>} />
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader icon={<Users />} title={t("admin.growth.cohorts")} description={t("admin.growth.cohortsHint")} />
        <CardBody>
          {g.cohorts.length ? (
            <CohortGrid locale={locale} cohorts={g.cohorts} cohortLabel={t("admin.growth.cohortWeek")} sizeLabel={t("admin.growth.cohortSize")} weekLabel={(w) => t("admin.growth.week", { n: w })} />
          ) : (
            <Empty>{t("admin.growth.noSignups")}</Empty>
          )}
          <Notice tone="info" className="mt-3">{t("admin.growth.cohortsCaveat")}</Notice>
        </CardBody>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<TicketPercent />} title={t("admin.growth.coupons")} description={t("admin.growth.couponsHint")} />
          {g.coupons.length === 0 ? (
            <Empty>{t("admin.plans.manager.noPromotions")}</Empty>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.plans.manager.couponCode")}</Th>
                  <Th>{t("admin.growth.redemptions")}</Th>
                  <Th>{t("admin.growth.checkoutsStarted")}</Th>
                  <Th>{t("admin.growth.checkoutsCompleted")}</Th>
                </Tr>
              </THead>
              <TBody>
                {g.coupons.map((c) => (
                  <Tr key={c.code}>
                    <Td>
                      <span className="font-mono text-xs">{c.code}</span>
                      <div className="text-[11px] text-muted-foreground">{c.promotion}</div>
                    </Td>
                    <Td className="tabular text-xs">{c.redemptions}{c.max ? ` / ${c.max}` : ""}</Td>
                    <Td className="tabular text-xs">{c.checkoutsStarted}</Td>
                    <Td className="tabular text-xs">{c.checkoutsCompleted}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title={t("admin.growth.waitlist")} description={t("admin.growth.waitlistHint")} />
          <CardBody className="grid gap-3">
            <div className="flex flex-wrap gap-3 text-sm">
              {(["WAITING", "INVITED", "JOINED", "REMOVED"] as const).map((s) => (
                <span key={s} className="rounded-md border px-2.5 py-1">
                  {t(`admin.growth.waitlistStatus.${s}`)} <span className="tabular font-semibold">{formatNumber(g.waitlist.byStatus[s] ?? 0, locale)}</span>
                </span>
              ))}
            </div>
            <BarList label={t("admin.growth.waitlistSources")} items={g.waitlist.sources.map((s) => ({ key: s.source ?? "none", label: s.source ?? t("admin.growth.noSource"), value: s.count }))} empty={<Empty>{t("admin.growth.noWaitlist")}</Empty>} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
