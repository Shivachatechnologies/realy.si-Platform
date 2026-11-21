import type { Metadata } from "next";
import Link from "next/link";
import { BadgeDollarSign, Download, RefreshCw } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { StatTile } from "@/components/ui/stat-tile";
import { Notice } from "@/components/ui/notice";
import { MarketingShell, loadMarketing } from "@/components/marketing/shell";
import { HelpPanel, InfoStrip, SmartEmpty } from "@/components/marketing/studio";
import { AdCampaignForm, CapsForm } from "@/components/marketing/studio-forms";
import { ActionButton } from "@/components/marketing/ui";
import { majorUnits } from "@/components/marketing/format";
import { getT } from "@/i18n/server";
import { formatDateTime, formatMoney, formatNumber } from "@/i18n/format";
import { AD_PROVIDERS, adsOverview } from "@/server/modules/marketing/ads";
import { listHelpTasks } from "@/server/modules/marketing/intelligence";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.ads") };
}

export default async function AdsPage() {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "ads" as const, title: t("marketing.studio.ads.title"), subtitle: t("marketing.studio.ads.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, tz } = m;
  const [o, help] = await Promise.all([adsOverview(viewer.ctx, org.id, company.id), listHelpTasks(org.id, company.id, "ads")]);
  const cur = company.baseCurrency;
  const money = (v: number | null) => (v == null ? "—" : formatMoney({ amountMinor: BigInt(Math.round(v)), currency: cur }, locale));
  const path = `/${locale}/marketing/ads`;
  return (
    <MarketingShell {...shell}>
      <InfoStrip t={t} k="ads" />
      <Notice tone="info">{t("marketing.studio.ads.safety")}</Notice>
      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile index={0} label={t("marketing.studio.ads.spend30")} value={money(o.totals.spendMinor)} />
        <StatTile index={1} label={t("marketing.studio.ads.clicks")} value={o.totals.clicks} hint={o.totals.ctr == null ? undefined : `CTR ${(o.totals.ctr * 100).toFixed(2)}%`} />
        <StatTile index={2} label="CPC" value={money(o.totals.cpcMinor)} hint={`CPM ${money(o.totals.cpmMinor)}`} />
        <StatTile index={3} label={t("marketing.studio.ads.conversions")} value={formatNumber(Math.round(o.totals.conversions * 10) / 10, locale)} hint={`CPA ${money(o.totals.cpaMinor)}`} />
        <StatTile index={4} label="ROAS" value={o.totals.roas == null ? "—" : `${o.totals.roas.toFixed(2)}×`} />
      </div>
      <Card>
        <CardHeader title={t("marketing.studio.ads.accounts")} description={t("marketing.studio.ads.accountsHint")} />
        <div className="flex flex-wrap gap-2 border-b p-3">
          {AD_PROVIDERS.map((p) =>
            o.connected[p] ? (
              canManage ? <ActionButton key={p} path={`${base}/ads/accounts/import`} body={{ provider: p }} icon={<Download aria-hidden />} label={t("marketing.studio.ads.import", { provider: t(`marketing.studio.ads.providers.${p}`) })} /> : null
            ) : (
              <Link key={p} href={`/${locale}/integrations/${p}`} className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">
                {t("marketing.studio.ads.connect", { provider: t(`marketing.studio.ads.providers.${p}`) })}
              </Link>
            ),
          )}
        </div>
        {o.accounts.length === 0 ? (
          <div className="p-4">
            <SmartEmpty icon={<BadgeDollarSign />} title={t("marketing.studio.ads.emptyTitle")} body={t("marketing.studio.ads.emptyBody")} />
          </div>
        ) : (
          <ul className="grid divide-y">
            {o.accounts.map((a) => (
              <li key={a.id} className="grid gap-2 p-4 text-sm md:grid-cols-[1fr_auto] md:items-end">
                <div>
                  <p className="font-medium">
                    {a.name} <span className="text-xs text-muted-foreground">· {t(`marketing.studio.ads.providers.${a.provider}`)} · {a.externalId}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {a.lastSyncedAt ? t("marketing.studio.ads.synced", { when: formatDateTime(a.lastSyncedAt, locale, tz) }) : t("marketing.studio.ads.neverSynced")}
                    {a.lastSyncError ? <span className="ms-2 text-danger">{a.lastSyncError}</span> : null}
                  </p>
                  {a.dailyCapMinor <= 0n || a.monthlyCapMinor <= 0n ? <p className="text-xs text-warning">{t("marketing.studio.ads.noCaps")}</p> : null}
                </div>
                {canManage ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <CapsForm base={base} accountId={a.id} daily={majorUnits(a.dailyCapMinor)} monthly={majorUnits(a.monthlyCapMinor)} />
                    <ActionButton path={`${base}/ads/accounts/${a.id}/sync`} icon={<RefreshCw aria-hidden />} label={t("marketing.studio.ads.sync")} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title={t("marketing.studio.ads.campaigns")} />
        {o.campaigns.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("marketing.studio.ads.noCampaigns")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("marketing.studio.ads.name")}</Th>
                <Th>{t("common.status")}</Th>
                <Th className="text-end">{t("marketing.studio.ads.dailyBudget")}</Th>
                <Th className="text-end">{t("marketing.studio.ads.spend")}</Th>
                <Th className="text-end">{t("marketing.studio.ads.clicks")}</Th>
                <Th className="text-end">{t("marketing.studio.ads.conversions")}</Th>
                <Th className="text-end">ROAS</Th>
              </Tr>
            </THead>
            <TBody>
              {o.campaigns.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <Link href={`${path}/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{t(`marketing.studio.ads.providers.${c.adAccount.provider}`)}</p>
                  </Td>
                  <Td className="text-xs">{c.externalId ? c.status : t("marketing.studio.ads.localDraft")}</Td>
                  <Td className="text-end tabular-nums">{c.dailyBudgetMinor == null ? "—" : formatMoney({ amountMinor: c.dailyBudgetMinor, currency: c.adAccount.currency }, locale)}</Td>
                  <Td className="text-end tabular-nums">{formatMoney({ amountMinor: c.spendMinor, currency: c.adAccount.currency }, locale)}</Td>
                  <Td className="text-end tabular-nums">{c.clicks}</Td>
                  <Td className="text-end tabular-nums">{formatNumber(Math.round(c.conversions * 10) / 10, locale)}</Td>
                  <Td className="text-end tabular-nums">{c.spendMinor > 0n ? `${(Number(c.revenueMinor) / Number(c.spendMinor)).toFixed(2)}×` : "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {canManage && o.accounts.length ? (
        <Card>
          <details>
            <summary className="cursor-pointer p-4 font-medium">{t("marketing.studio.ads.createDraft")}</summary>
            <AdCampaignForm base={base} accounts={o.accounts.map((a) => ({ id: a.id, name: a.name, provider: a.provider }))} />
          </details>
        </Card>
      ) : null}
      <HelpPanel t={t} base={base} page="ads" tasks={help} locale={locale} tz={tz} aiReady={m.aiReady} canRun={m.canRunAgents} />
    </MarketingShell>
  );
}
