import type { Metadata } from "next";
import Link from "next/link";
import { Brain } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { MarketingShell, loadMarketing } from "@/components/marketing/shell";
import { BarChart, HelpPanel, InfoStrip } from "@/components/marketing/studio";
import { TextPrompt } from "@/components/marketing/studio-forms";
import { AiTaskList } from "@/components/marketing/ai-tasks";
import { getT } from "@/i18n/server";
import { formatMoney, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { attribution, channelPerformance, parseRange } from "@/server/modules/marketing/analytics";
import { CHANNELS } from "@/server/modules/marketing/common";
import { SOCIAL_PROVIDERS } from "@/server/modules/marketing/social";
import { getUnifiedAnalytics, listHelpTasks } from "@/server/modules/marketing/intelligence";
import { listLearnings } from "@/server/modules/marketing/learning";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.analytics") };
}

export default async function MarketingAnalyticsPage({ searchParams }: PageProps<"/[locale]/marketing/analytics">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "analytics" as const, title: t("marketing.studio.analytics.title"), subtitle: t("marketing.studio.analytics.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, tz, aiReady } = m;
  const range = parseRange(await searchParams);
  const [a, learnings, asks, help, channels, campaigns] = await Promise.all([
    getUnifiedAnalytics(viewer.ctx, org.id, company.id, range),
    listLearnings(viewer.ctx, org.id, company.id),
    db().agentTask.findMany({ where: { organizationId: org.id, companyId: company.id, title: { startsWith: "Analyst:" } }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, title: true, status: true, createdAt: true, output: true, errorCode: true } }),
    listHelpTasks(org.id, company.id, "analytics"),
    channelPerformance(org.id, company.id, range),
    attribution(org.id, company.id, range),
  ]);
  // Cost per lead and attributed conversions from real rows: spend (entries + synced ad spend) over CRM leads;
  // conversions = ad-platform conversions + won leads whose source is a campaign tracking code (UTM).
  const cplMinor = a.kpis.leadsCreated ? a.totalSpendMinor / BigInt(a.kpis.leadsCreated) : null;
  const attributedWon = campaigns.reduce((s, c) => s + c.won, 0);
  const cur = company.baseCurrency;
  const money = (v: bigint | null) => (v == null ? "—" : formatMoney({ amountMinor: v, currency: cur }, locale));
  const rate = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
  return (
    <MarketingShell {...shell}>
      <InfoStrip t={t} k="analytics" />
      <Card>
        <form className="flex flex-wrap items-end gap-2 p-3" action={`/${locale}/marketing/analytics`}>
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
          {[7, 30, 90].map((d) => (
            <Link key={d} href={`/${locale}/marketing/analytics?days=${d}`} className="rounded-md border px-2 py-1 text-xs hover:bg-muted">
              {t("marketing.common.lastDays", { count: d })}
            </Link>
          ))}
        </form>
      </Card>
      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile index={0} label={t("marketing.studio.analytics.impressions")} value={a.social.impressions + a.ads.impressions} format="compact" />
        <StatTile index={1} label={t("marketing.studio.analytics.reach")} value={a.social.reach} format="compact" />
        <StatTile index={2} label={t("marketing.studio.analytics.engagement")} value={a.social.engagement} hint={rate(a.social.engagementRate)} />
        <StatTile index={3} label={t("marketing.studio.analytics.clicks")} value={a.social.clicks + a.ads.clicks + a.email.clicked} />
        <StatTile index={4} label={t("marketing.metrics.leadsGenerated")} value={a.kpis.leadsCreated} />
        <StatTile index={5} label={t("marketing.metrics.newCustomers")} value={a.kpis.newCustomers} />
        <StatTile index={6} label={t("marketing.studio.analytics.traffic")} value={a.search.clicks} hint={t("marketing.studio.analytics.searchImpressions", { count: formatNumber(a.search.impressions, locale) })} />
        <StatTile index={7} label={t("marketing.studio.analytics.blogViews")} value={a.blogViews} />
        <StatTile index={8} label={t("marketing.studio.analytics.totalSpend")} value={money(a.totalSpendMinor)} hint={t("marketing.studio.analytics.adSpend", { amount: money(a.ads.spendMinor) })} />
        <StatTile index={9} label="CAC" value={money(a.cacMinor)} />
        <StatTile index={10} label="ROAS" value={a.ads.roas == null ? "—" : `${a.ads.roas.toFixed(2)}×`} />
        <StatTile index={11} label="ROI" value={a.roi == null ? "—" : `${a.roi.toFixed(1)}%`} />
        <StatTile index={12} label={t("marketing.run.analytics.cpl")} value={money(cplMinor)} />
        <StatTile index={13} label={t("marketing.run.analytics.conversions")} value={a.ads.conversions + attributedWon} hint={t("marketing.run.analytics.conversionsHint", { ads: formatNumber(a.ads.conversions, locale), crm: formatNumber(attributedWon, locale) })} />
      </div>
      <Card>
        <CardHeader title={t("marketing.run.analytics.byChannel")} description={t("marketing.run.analytics.byChannelHint")} />
        {channels.length ? (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>{t("marketing.common.channel")}</Th>
                  <Th className="text-end">{t("marketing.metrics.spend")}</Th>
                  <Th className="text-end">{t("marketing.run.analytics.leads")}</Th>
                  <Th className="text-end">{t("marketing.run.analytics.cpl")}</Th>
                  <Th className="text-end">{t("marketing.studio.analytics.impressions")}</Th>
                  <Th className="text-end">{t("marketing.studio.analytics.engagement")}</Th>
                  <Th className="text-end">{t("marketing.metrics.emailsSent")}</Th>
                </Tr>
              </THead>
              <TBody>
                {channels.map((c) => (
                  <Tr key={c.channel}>
                    <Td>{(CHANNELS as readonly string[]).includes(c.channel) ? t(`marketing.channels.${c.channel}`) : (SOCIAL_PROVIDERS as readonly string[]).includes(c.channel.toUpperCase()) ? t(`marketing.provider.${c.channel.toUpperCase()}`) : c.channel}</Td>
                    <Td className="text-end tabular-nums">{money(c.spendMinor)}</Td>
                    <Td className="text-end tabular-nums">{formatNumber(c.leads, locale)}</Td>
                    <Td className="text-end tabular-nums">{c.leads && c.spendMinor > 0n ? money(c.spendMinor / BigInt(c.leads)) : "—"}</Td>
                    <Td className="text-end tabular-nums">{formatNumber(c.impressions, locale)}</Td>
                    <Td className="text-end tabular-nums">{formatNumber(c.engagement, locale)}</Td>
                    <Td className="text-end tabular-nums">{formatNumber(c.sent, locale)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("marketing.run.analytics.noChannels")}</p>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("marketing.studio.analytics.byPlatform")} />
          <div className="p-4">
            {a.platforms.length ? (
              <BarChart label={t("marketing.studio.analytics.byPlatform")} data={a.platforms.map((p) => ({ label: t(`marketing.provider.${p.provider}`), value: p.engagement }))} format={(v) => formatNumber(v, locale)} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("marketing.studio.analytics.noSocial")}</p>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title={t("marketing.studio.analytics.email")} />
          <dl className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-muted-foreground">{t("marketing.metrics.emailsSent")}</dt><dd className="font-semibold tabular-nums">{a.email.sent}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("marketing.metrics.emailOpenRate")}</dt><dd className="font-semibold tabular-nums">{rate(a.email.openRate)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("marketing.studio.analytics.clickRate")}</dt><dd className="font-semibold tabular-nums">{rate(a.email.clickRate)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("marketing.studio.analytics.bounced")}</dt><dd className="font-semibold tabular-nums">{a.email.bounced}</dd></div>
          </dl>
        </Card>
      </div>
      <Card variant="highlight">
        <CardHeader title={t("marketing.studio.analytics.ask")} description={t("marketing.studio.analytics.askHint")} />
        <div className="grid gap-3 p-4">
          {m.canRead ? <TextPrompt path={`${base}/analyst`} placeholder={t("marketing.studio.analytics.askPlaceholder")} submit={t("marketing.studio.analytics.askButton")} /> : null}
          <AiTaskList tasks={asks} locale={locale} tz={tz} t={t} aiReady={aiReady} />
        </div>
      </Card>
      <Card>
        <CardHeader title={t("marketing.studio.analytics.learnings")} description={t("marketing.studio.analytics.learningsHint")} />
        {learnings.length === 0 ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Brain className="size-4" aria-hidden />
            {t("marketing.studio.analytics.noLearnings")}
          </p>
        ) : (
          <ul className="grid divide-y text-sm">
            {learnings.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <Badge tone="info">{t(`marketing.studio.analytics.kind.${l.kind}`)}</Badge>
                <span className="min-w-0 flex-1">{l.insight}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <HelpPanel t={t} base={base} page="analytics" tasks={help} locale={locale} tz={tz} aiReady={aiReady} canRun={m.canRunAgents} />
    </MarketingShell>
  );
}
