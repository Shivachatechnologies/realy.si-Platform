import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { Kpi, MarketingShell, Meter, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { getT } from "@/i18n/server";
import { formatDateTime, formatMoney, formatNumber } from "@/i18n/format";
import { commandCenter, parseRange } from "@/server/modules/marketing/analytics";
import { CAMPAIGN_STATUSES } from "@/server/modules/marketing/campaigns";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.marketing.title") };
}

export default async function MarketingCommandCenter({ searchParams }: PageProps<"/[locale]/marketing">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "overview" as const, title: t("marketing.commandCenter.title"), subtitle: t("marketing.commandCenter.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, tz } = m;
  const range = parseRange(await searchParams);
  const cc = await commandCenter(viewer.ctx, org.id, company.id, range);
  const cur = company.baseCurrency;
  const money = (v: bigint | null) => (v == null ? "—" : formatMoney({ amountMinor: v, currency: cur }, locale));
  const pct = (v: number | null) => (v == null ? "—" : `${formatNumber(Math.round(v * 10) / 10, locale)}%`);
  const k = cc.kpis;
  const budgetUse = cc.budgetMinor > 0n ? (Number(k.spendMinor) / Number(cc.budgetMinor)) * 100 : null;
  const presets = [7, 30, 90, 365];
  const attributed = cc.campaigns.filter((c) => c.leads || c.won || c.spendMinor > 0n);

  return (
    <MarketingShell {...shell}>
      <Card>
        <form className="flex flex-wrap items-end gap-2 p-3" action={`/${locale}/marketing`}>
          <label className="grid gap-1 text-xs">
            {t("marketing.common.from")}
            <Input type="date" name="from" defaultValue={range.fromStr} className="w-40" />
          </label>
          <label className="grid gap-1 text-xs">
            {t("marketing.common.to")}
            <Input type="date" name="to" defaultValue={range.toStr} className="w-40" />
          </label>
          <Button type="submit" variant="secondary">
            {t("marketing.common.apply")}
          </Button>
          <div className="flex flex-wrap gap-2 text-xs">
            {presets.map((d) => (
              <Link key={d} href={`/${locale}/marketing?days=${d}`} className="rounded-md border px-2 py-1 hover:bg-muted">
                {t("marketing.common.lastDays", { count: d })}
              </Link>
            ))}
          </div>
        </form>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label={t("marketing.metrics.spend")} value={money(k.spendMinor)} hint={t("marketing.commandCenter.ofBudget", { budget: money(cc.budgetMinor) })} />
        <Kpi label={t("marketing.metrics.leadsGenerated")} value={formatNumber(k.leadsCreated, locale)} hint={t("marketing.commandCenter.submissions", { count: k.submissions })} />
        <Kpi label={t("marketing.metrics.newCustomers")} value={formatNumber(k.newCustomers, locale)} hint={money(k.revenueMinor)} />
        <Kpi label={t("marketing.metrics.cac")} value={money(k.cacMinor)} />
        <Kpi label={t("marketing.metrics.conversionRate")} value={pct(k.conversionRate)} />
        <Kpi label={t("marketing.metrics.campaignRoi")} value={pct(k.roi)} tone={k.roi == null ? undefined : k.roi >= 0 ? "success" : "danger"} />
        <Kpi label={t("marketing.metrics.activeCampaigns")} value={formatNumber(k.campaignsActive, locale)} />
        <Kpi label={t("marketing.metrics.emailsSent")} value={formatNumber(k.emailsSent, locale)} />
        <Kpi label={t("marketing.metrics.postsPublished")} value={formatNumber(k.postsPublished, locale)} />
        <Card className="grid content-start gap-2 p-4">
          <p className="text-xs text-muted-foreground">{t("marketing.commandCenter.budgetVsSpend")}</p>
          <p className="text-sm font-medium tabular-nums">{budgetUse == null ? "—" : pct(budgetUse)}</p>
          <Meter value={budgetUse} label={t("marketing.commandCenter.budgetVsSpend")} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("marketing.commandCenter.attribution")} description={t("marketing.commandCenter.attributionHint")} />
          {attributed.length === 0 ? (
            <p className="p-4 text-muted-foreground">{t("marketing.commandCenter.noAttribution")}</p>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("marketing.campaigns.campaign")}</Th>
                  <Th className="text-end">{t("marketing.metrics.spend")}</Th>
                  <Th className="text-end">{t("marketing.campaigns.leads")}</Th>
                  <Th className="text-end">{t("marketing.campaigns.won")}</Th>
                  <Th className="text-end">{t("marketing.campaigns.revenue")}</Th>
                  <Th className="text-end">{t("marketing.metrics.cac")}</Th>
                  <Th className="text-end">{t("marketing.metrics.campaignRoi")}</Th>
                </Tr>
              </THead>
              <TBody>
                {attributed.map((c) => (
                  <Tr key={c.id}>
                    <Td>
                      <Link href={`/${locale}/marketing/campaigns/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <span className="ms-2 font-mono text-[11px] text-muted-foreground">{c.code}</span>
                    </Td>
                    <Td className="text-end tabular-nums">{money(c.spendMinor)}</Td>
                    <Td className="text-end tabular-nums">{c.leads}</Td>
                    <Td className="text-end tabular-nums">{c.won}</Td>
                    <Td className="text-end tabular-nums">{money(c.revenueMinor)}</Td>
                    <Td className="text-end tabular-nums">{money(c.cacMinor)}</Td>
                    <Td className={`text-end tabular-nums ${c.roi == null ? "" : c.roi >= 0 ? "text-success" : "text-danger"}`}>{pct(c.roi)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("marketing.commandCenter.campaignStatus")} actions={<Link href={`/${locale}/marketing/campaigns`} className="text-xs hover:underline">{t("marketing.common.viewAll")}</Link>} />
            <ul className="grid gap-2 p-4 text-sm">
              {CAMPAIGN_STATUSES.map((s) => (
                <li key={s} className="flex items-center justify-between">
                  <StatusBadge status={s} label={t(`marketing.campaignStatus.${s}`)} />
                  <span className="tabular-nums">{cc.statusCounts[s] ?? 0}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title={t("marketing.commandCenter.upcoming")} actions={<Link href={`/${locale}/marketing/content/calendar`} className="text-xs hover:underline">{t("marketing.content.calendar")}</Link>} />
            {cc.upcoming.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">{t("marketing.commandCenter.noUpcoming")}</p>
            ) : (
              <ul className="grid divide-y text-sm">
                {cc.upcoming.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <Link href={`/${locale}/marketing/social/${p.id}`} className="min-w-0 truncate hover:underline">
                      {p.title}
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground">{p.scheduledAt ? formatDateTime(p.scheduledAt, locale, tz) : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title={t("marketing.commandCenter.channels")} description={t("marketing.commandCenter.channelsHint")} />
        {cc.channels.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("marketing.commandCenter.noChannels")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("marketing.common.channel")}</Th>
                <Th className="text-end">{t("marketing.metrics.spend")}</Th>
                <Th className="text-end">{t("marketing.commandCenter.formLeads")}</Th>
                <Th className="text-end">{t("marketing.commandCenter.posts")}</Th>
                <Th className="text-end">{t("marketing.commandCenter.engagement")}</Th>
                <Th className="text-end">{t("marketing.commandCenter.emailsSentOpenedClicked")}</Th>
              </Tr>
            </THead>
            <TBody>
              {cc.channels.map((c) => (
                <Tr key={c.channel}>
                  <Td>{t(`marketing.channels.${c.channel}`)}</Td>
                  <Td className="text-end tabular-nums">{money(c.spendMinor)}</Td>
                  <Td className="text-end tabular-nums">{c.leads}</Td>
                  <Td className="text-end tabular-nums">{c.posts}</Td>
                  <Td className="text-end tabular-nums">{c.engagement}</Td>
                  <Td className="text-end tabular-nums">{c.sent || c.opened || c.clicked ? `${c.sent} / ${c.opened} / ${c.clicked}` : "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </MarketingShell>
  );
}
