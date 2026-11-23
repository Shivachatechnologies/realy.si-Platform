import Link from "next/link";
import { Activity, Ban, Gauge, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { AdminHeader, Empty, NextPage, SectionLink, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { BarList, TrendChart } from "@/components/admin/viz";
import { Timestamp } from "@/components/admin/timestamp";
import { DataSource, RangeLinks, pct } from "@/components/admin/billing/ui";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { budgetAlerts, creditReconciliation, quotaEvents, usageCenter, type UsageCategory } from "@/server/modules/admin/credits";
import { requireViewer } from "@/server/session";

const BYTES = (v: number, locale: string) => formatNumber(v / 1024 / 1024, locale, { maximumFractionDigits: 1 }) + " MB";

/** Usage center: categories from existing meters and tables, top consumers, quota events, budget alerts, reconciliation. */
export default async function UsagePage({ searchParams }: PageProps<"/[locale]/usage">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const res = await guard(usageCenter(viewer.ctx, { days: sp(q.days), category: sp(q.category) }), t("errors.forbidden"));
  if (!res.ok) return res.node;
  const u = res.value;
  const [quota, alerts, recon] = await Promise.all([quotaEvents(viewer.ctx, { org: sp(q.org), limitKey: sp(q.limitKey), cursor: sp(q.cursor) }), budgetAlerts(viewer.ctx), creditReconciliation(viewer.ctx)]);
  const base = `/${locale}/usage`;
  const fmt = (c: UsageCategory, v: number | null) => (v === null ? t("admin.usage.unavailable") : c === "storage" ? BYTES(v, locale) : formatNumber(v, locale, { notation: v > 1e6 ? "compact" : "standard", maximumFractionDigits: 1 }));
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader
        icon={<Activity />}
        title={t("admin.usage.title")}
        description={t("admin.usage.subtitle")}
        why={t("admin.usage.why")}
        actions={<RangeLinks base={base} value={u.days} options={[7, 30, 90]} params={{ category: u.selected }} label={t("admin.revenue.overview.range")} format={(d) => t("admin.revenue.overview.days", { count: Number(d) })} />}
        meta={<DataSource source={t("admin.usage.source")} updatedAt={u.computedAt} updatedLabel={t("admin.usage.computed")} />}
      />
      <StatGrid className="xl:grid-cols-6">
        {u.categories.map((c) => (
          <StatTile
            key={c.key}
            label={t(`admin.usage.categories.${c.key}`)}
            value={fmt(c.key, c.total)}
            hint={c.pointInTime ? t("admin.usage.now") : t("admin.revenue.overview.days", { count: u.days })}
            href={`${base}?category=${c.key}&days=${u.days}`}
            className={c.key === u.selected ? "ring-2 ring-primary/40" : undefined}
          />
        ))}
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader icon={<Activity />} title={t(`admin.usage.categories.${u.selected}`)} description={t("admin.usage.sourceOf", { source: u.categories.find((c) => c.key === u.selected)?.source ?? "—" })} />
          <CardBody>
            {u.series ? <TrendChart title={t(`admin.usage.categories.${u.selected}`)} days={u.series.days} series={[{ label: t(`admin.usage.categories.${u.selected}`), values: u.series.values, format: "compact" }]} /> : <Empty>{t("admin.usage.noSeries")}</Empty>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("admin.usage.top")} />
          <CardBody>
            <BarList
              label={t("admin.usage.top")}
              items={u.top.map((o) => ({ key: o.organizationId, label: o.name, value: o.value, display: fmt(u.selected, o.value), href: `/${locale}/credits?org=${o.organizationId}` }))}
              empty={<Empty>{t("admin.usage.noUsage")}</Empty>}
            />
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader icon={<Gauge />} title={t("admin.usage.alerts.title")} description={t("admin.usage.alerts.hint")} actions={<span className="text-xs text-muted-foreground"><Timestamp value={alerts.computedAt} mode="relative" /></span>} />
        {alerts.alerts.length === 0 ? (
          <Empty>{t("admin.usage.alerts.none")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.invoices.common.organization")}</Th>
                <Th>{t("admin.usage.limit")}</Th>
                <Th>{t("admin.credits.used")}</Th>
                <Th>{t("admin.usage.share")}</Th>
                <Th>{t("admin.usage.nextStep")}</Th>
              </Tr>
            </THead>
            <TBody>
              {alerts.alerts.map((a) => (
                <Tr key={`${a.organizationId}:${a.limitKey}`}>
                  <Td><Link href={`/${locale}/credits?org=${a.organizationId}`} className="hover:underline">{a.organizationName}</Link></Td>
                  <Td className="font-mono text-xs">{a.limitKey}</Td>
                  <Td className="tabular text-xs">{formatNumber(a.used, locale)} / {formatNumber(a.limit, locale)} {a.unit}</Td>
                  <Td><Badge tone={a.level === "critical" ? "danger" : "warning"}>{pct(a.ratio, locale, 0)}</Badge></Td>
                  <Td><SectionLink href={`/${locale}/plans/organizations/${a.organizationId}`}>{t("admin.usage.alerts.investigate")}</SectionLink></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader icon={<Ban />} title={t("admin.usage.quota.title")} description={t("admin.usage.quota.hint")} />
        {quota.byLimit7d.length ? (
          <CardBody>
            <BarList label={t("admin.usage.quota.byLimit")} tone="danger" items={quota.byLimit7d.map((b) => ({ key: b.limitKey, label: b.limitKey, value: b.count, href: `${base}?limitKey=${b.limitKey}` }))} />
          </CardBody>
        ) : null}
        {quota.page.data.length === 0 ? (
          <Empty>{t("admin.usage.quota.none")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.invoices.common.organization")}</Th>
                <Th>{t("admin.usage.limit")}</Th>
                <Th>{t("admin.credits.used")}</Th>
                <Th>{t("admin.usage.quota.reason")}</Th>
                <Th>{t("admin.invoices.common.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {quota.page.data.map((e) => (
                <Tr key={e.id}>
                  <Td className="text-xs"><Link href={`${base}?org=${e.organizationId}`} className="hover:underline">{e.organizationName ?? e.organizationId}</Link></Td>
                  <Td className="font-mono text-xs">{e.limitKey}</Td>
                  <Td className="tabular text-xs">{formatNumber(e.used, locale)} / {e.limit === null ? "∞" : formatNumber(e.limit, locale)} (+{formatNumber(e.increment, locale)})</Td>
                  <Td className="text-xs">{t(`admin.usage.quota.reasons.${e.reason}`)} · {e.plan}</Td>
                  <Td className="text-xs whitespace-nowrap text-muted-foreground"><Timestamp value={e.createdAt} mode="absolute" /></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <NextPage base={base} params={{ org: sp(q.org), limitKey: sp(q.limitKey), days: String(u.days), category: u.selected }} cursor={quota.page.nextCursor} label={t("common.next")} />
      </Card>
      <Card>
        <CardHeader icon={<Scale />} title={t("admin.usage.recon.title")} description={t("admin.usage.recon.hint")} actions={<span className="text-xs text-muted-foreground">{t("admin.usage.recon.last")} <Timestamp value={recon.lastUsageAggregation} mode="relative" /></span>} />
        {recon.usage.length === 0 && recon.addons.length === 0 ? (
          <Empty>{recon.lastUsageAggregation ? t("admin.usage.recon.ok") : t("admin.usage.recon.notRun")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.usage.recon.check")}</Th>
                <Th>{t("admin.invoices.common.organization")}</Th>
                <Th>{t("admin.credits.meter")}</Th>
                <Th>{t("admin.usage.recon.source")}</Th>
                <Th>{t("admin.usage.recon.ledger")}</Th>
              </Tr>
            </THead>
            <TBody>
              {recon.usage.map((r) => (
                <Tr key={`u:${r.organizationId}:${r.meter}:${r.day.toISOString()}`}>
                  <Td className="text-xs">{t("admin.usage.recon.usageDay", { day: r.day.toISOString().slice(0, 10) })}</Td>
                  <Td className="text-xs"><Link href={`/${locale}/credits?org=${r.organizationId}`} className="hover:underline">{r.organizationName}</Link></Td>
                  <Td className="font-mono text-xs">{r.meter}</Td>
                  <Td className="tabular text-xs">{formatNumber(r.recorded, locale)}</Td>
                  <Td className="tabular text-xs text-danger">{r.ledgered === null ? t("admin.usage.recon.missing") : formatNumber(r.ledgered, locale)}</Td>
                </Tr>
              ))}
              {recon.addons.map((a) => (
                <Tr key={`a:${a.id}`}>
                  <Td className="text-xs">{t("admin.usage.recon.addon", { key: a.addonKey })}</Td>
                  <Td className="text-xs"><Link href={`/${locale}/credits?org=${a.organizationId}`} className="hover:underline">{a.organizationName}</Link></Td>
                  <Td className="font-mono text-xs">{a.source}</Td>
                  <Td className="tabular text-xs">{formatNumber(a.quantity, locale)}</Td>
                  <Td className="text-xs text-danger">{t("admin.usage.recon.missing")}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
