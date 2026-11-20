import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { RangeFilter } from "@/components/crm/range-filter";
import { CrmFrame, DEAL_STATUS_TONE, crmContext } from "@/components/crm/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { getT } from "@/i18n/server";
import { formatDate, formatMoney, formatNumber } from "@/i18n/format";
import { isoDay } from "@/server/modules/crm/common";
import { sourceNames } from "@/server/modules/crm/config";
import { listPipelines } from "@/server/modules/crm/pipelines";
import { conversionMetrics, parseSalesRange, revenueAttribution, salesReportRows } from "@/server/modules/crm/sales";
import { listOwners } from "@/server/modules/crm/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("sales.tabs.reports") };
}

export default async function SalesReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await crmContext();
  const query = await searchParams;
  if (!c.company || !c.canRead) return <CrmFrame area="sales" active="reports">{null}</CrmFrame>;
  const { t, locale, base, org, company, viewer, tz } = c;
  const range = parseSalesRange(query);
  const basis = query.basis === "created" ? "created" : "closed";
  const [rows, conversion, attribution, owners, pipelines, sources] = await Promise.all([
    salesReportRows(viewer.ctx, org.id, company.id, range, basis),
    conversionMetrics(viewer.ctx, org.id, company.id, range),
    revenueAttribution(viewer.ctx, org.id, company.id, range),
    listOwners(viewer.ctx, org.id, company.id),
    listPipelines(viewer.ctx, org.id, company.id),
    sourceNames(viewer.ctx, org.id, company.id),
  ]);
  const from = isoDay(range.from)!;
  const to = isoDay(new Date(range.to.getTime() - 86_400_000))!;
  const qs = new URLSearchParams({ from, to, basis, ...(range.owner ? { owner: range.owner } : {}), ...(range.pipelineId ? { pipeline: range.pipelineId } : {}), ...(range.source ? { source: range.source } : {}) });
  const money = (m: bigint, cur = attribution.currency) => formatMoney({ amountMinor: m, currency: cur }, locale);
  const pct = (v: number | null) => (v == null ? "—" : formatNumber(v, locale, { style: "percent", maximumFractionDigits: 0 }));
  const none = t("sales.reports.none");
  const breakdown = (title: string, items: { key: string | null; count: number; wonMinor: bigint; share: number | null; name?: string | null }[], label: (k: string | null, name?: string | null) => string) => (
    <Card>
      <CardHeader title={title} />
      {items.length ? (
        <table className="w-full text-sm">
          <tbody className="divide-y">
            {items.map((x) => (
              <tr key={x.key ?? "none"}>
                <td className="p-2">{label(x.key, x.name)}</td>
                <td className="p-2 text-end tabular-nums text-muted-foreground">{x.count}</td>
                <td className="p-2 text-end tabular-nums">{money(x.wonMinor)}</td>
                <td className="p-2 text-end tabular-nums text-muted-foreground">{pct(x.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{t("sales.reports.noWins")}</p>
      )}
    </Card>
  );
  const conversionTable = (title: string, items: typeof conversion.bySource, label: (k: string | null, name?: string | null) => string) => (
    <Card>
      <CardHeader title={title} />
      {items.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="p-2 text-start font-medium" />
                <th className="p-2 text-end font-medium">{t("sales.reports.leads")}</th>
                <th className="p-2 text-end font-medium">{t("sales.reports.qualified")}</th>
                <th className="p-2 text-end font-medium">{t("sales.reports.deals")}</th>
                <th className="p-2 text-end font-medium">{t("sales.reports.won")}</th>
                <th className="p-2 text-end font-medium">{t("sales.reports.leadToDeal")}</th>
                <th className="p-2 text-end font-medium">{t("sales.reports.dealToWon")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((x) => (
                <tr key={x.key ?? "none"}>
                  <td className="p-2">{label(x.key, (x as { name?: string | null }).name)}</td>
                  <td className="p-2 text-end tabular-nums">{x.leads}</td>
                  <td className="p-2 text-end tabular-nums">{x.qualified}</td>
                  <td className="p-2 text-end tabular-nums">{x.deals}</td>
                  <td className="p-2 text-end tabular-nums">{x.won}</td>
                  <td className="p-2 text-end tabular-nums">{pct(x.leadToDeal)}</td>
                  <td className="p-2 text-end tabular-nums">{pct(x.dealToWon)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{t("sales.reports.noLeads")}</p>
      )}
    </Card>
  );
  return (
    <CrmFrame
      area="sales"
      active="reports"
      subtitle={t("sales.reports.subtitle")}
      actions={
        <Button asChild size="sm" variant="secondary">
          <a href={`${base}/sales/report?${qs}&format=csv`}>
            <Download aria-hidden />
            {t("crm.exportCsv")}
          </a>
        </Button>
      }
    >
      <RangeFilter
        action={`/${locale}/sales/reports`}
        from={from}
        to={to}
        owner={range.owner}
        owners={owners}
        pipeline={range.pipelineId}
        pipelines={pipelines}
        source={range.source}
        sources={sources}
        extra={
          <Select name="basis" defaultValue={basis} aria-label={t("sales.reports.basis")} className="w-44">
            <option value="closed">{t("sales.reports.basisClosed")}</option>
            <option value="created">{t("sales.reports.basisCreated")}</option>
          </Select>
        }
      />
      {conversion.total ? (
        <p className="text-sm">
          {t("sales.reports.funnel", { leads: conversion.total.leads, deals: conversion.total.deals, won: conversion.total.won, rate: pct(conversion.total.leadToWon) })}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {conversionTable(t("sales.reports.conversionByOwner"), conversion.byOwner, (k, name) => (k ? (name ?? "—") : t("crm.unassigned")))}
        {conversionTable(t("sales.reports.conversionBySource"), conversion.bySource, (k) => k ?? none)}
      </div>
      <h2 className="text-sm font-semibold">{t("sales.reports.attribution", { total: money(attribution.totalMinor) })}</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        {breakdown(t("sales.reports.bySource"), attribution.bySource, (k) => k ?? none)}
        {breakdown(t("sales.reports.byCampaign"), attribution.byCampaign, (k) => k ?? none)}
        {breakdown(t("sales.reports.byOwner"), attribution.byOwner, (k, name) => (k ? (name ?? "—") : t("crm.unassigned")))}
      </div>
      <Card>
        <CardHeader title={t("sales.reports.lostReasons")} />
        {attribution.lostReasons.length ? (
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {attribution.lostReasons.map((r) => (
                <tr key={r.reason ?? "none"}>
                  <td className="p-2">{r.reason ?? t("sales.reports.noReason")}</td>
                  <td className="p-2 text-end tabular-nums">{r.count}</td>
                  <td className="p-2 text-end tabular-nums text-muted-foreground">{money(r.lostMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("sales.reports.noLost")}</p>
        )}
      </Card>
      <Card>
        <CardHeader title={basis === "closed" ? t("sales.reports.dealsClosed") : t("sales.reports.dealsCreated")} description={t("crm.deals.count", { count: rows.length })} />
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="p-2 text-start font-medium">{t("crm.name")}</th>
                  <th className="p-2 text-start font-medium">{t("crm.stage")}</th>
                  <th className="p-2 text-start font-medium">{t("crm.owner")}</th>
                  <th className="p-2 text-start font-medium">{t("crm.source")}</th>
                  <th className="p-2 text-end font-medium">{t("crm.fields.amount")}</th>
                  <th className="p-2 text-start font-medium">{basis === "closed" ? t("crm.deals.closed") : t("crm.created")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.slice(0, 500).map((d) => (
                  <tr key={d.id}>
                    <td className="p-2">
                      <Link href={`/${locale}/crm/deals/${d.id}`} className="font-medium hover:underline">
                        {d.name}
                      </Link>
                      {d.account ? <div className="text-xs text-muted-foreground">{d.account.name}</div> : null}
                    </td>
                    <td className="p-2">
                      <Badge tone={DEAL_STATUS_TONE[d.status]}>{d.stage.name}</Badge>
                      {d.lostReason ? <div className="text-xs text-muted-foreground">{d.lostReason}</div> : null}
                    </td>
                    <td className="p-2">{d.ownerName ?? t("crm.unassigned")}</td>
                    <td className="p-2 text-xs">{d.source ?? "—"}</td>
                    <td className="p-2 text-end tabular-nums">{money(d.amountMinor, d.currency)}</td>
                    <td className="p-2 text-xs text-muted-foreground">{formatDate((basis === "closed" ? d.closedAt : d.createdAt) ?? d.createdAt, locale, tz)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 500 ? <p className="p-3 text-xs text-muted-foreground">{t("sales.reports.truncated")}</p> : null}
          </div>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("sales.reports.empty")}</p>
        )}
      </Card>
    </CrmFrame>
  );
}
