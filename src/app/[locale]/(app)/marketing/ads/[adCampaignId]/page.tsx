import type { Metadata } from "next";
import { Pause, Play, Rocket } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { MarketingShell, loadMarketing } from "@/components/marketing/shell";
import { BarChart } from "@/components/marketing/studio";
import { BudgetChange } from "@/components/marketing/studio-forms";
import { AiRequest } from "@/components/marketing/ai-panel";
import { AiTaskList } from "@/components/marketing/ai-tasks";
import { ActionButton } from "@/components/marketing/ui";
import { getT } from "@/i18n/server";
import { formatMoney } from "@/i18n/format";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { getAdCampaign } from "@/server/modules/marketing/ads";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.ads") };
}

export default async function AdCampaignPage({ params }: PageProps<"/[locale]/marketing/ads/[adCampaignId]">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const { adCampaignId } = await params;
  const shell = { locale, t, tab: "ads" as const, title: t("marketing.studio.ads.title"), back: { href: `/${locale}/marketing/ads`, label: t("marketing.studio.ads.title") } };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, canRunAgents, tz, aiReady } = m;
  const [c, tasks] = await Promise.all([getAdCampaign(viewer.ctx, org.id, company.id, adCampaignId), listSubjectTasks(viewer.ctx, org.id, company.id, "marketing_ad_campaign", adCampaignId)]);
  const cur = c.adAccount.currency;
  const days = [...c.metrics].reverse().slice(-14);
  return (
    <MarketingShell {...shell} title={c.name} subtitle={`${t(`marketing.studio.ads.providers.${c.adAccount.provider}`)} · ${c.adAccount.name}`}>
      <Notice tone="info">{t("marketing.studio.ads.safety")}</Notice>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("marketing.studio.ads.performance")} />
          <div className="grid gap-4 p-4">
            {days.length ? (
              <>
                <BarChart label={t("marketing.studio.ads.spend")} data={days.map((d) => ({ label: d.date.toISOString().slice(5, 10), value: Number(d.spendMinor) / 100 }))} format={(v) => formatMoney({ amountMinor: BigInt(Math.round(v * 100)), currency: cur }, locale)} />
                <BarChart label={t("marketing.studio.ads.clicks")} data={days.map((d) => ({ label: d.date.toISOString().slice(5, 10), value: d.clicks }))} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("marketing.studio.ads.noMetrics")}</p>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title={t("marketing.studio.ads.controls")} />
          <div className="grid gap-3 p-4 text-sm">
            <p>
              {t("common.status")}: <strong>{c.externalId ? c.status : t("marketing.studio.ads.localDraft")}</strong>
            </p>
            <p>
              {t("marketing.studio.ads.dailyBudget")}: <strong>{c.dailyBudgetMinor == null ? "—" : formatMoney({ amountMinor: c.dailyBudgetMinor, currency: cur }, locale)}</strong>
            </p>
            <p className="text-xs text-muted-foreground">
              {t("marketing.studio.ads.dailyCap")}: {formatMoney({ amountMinor: c.adAccount.dailyCapMinor, currency: cur }, locale)} · {t("marketing.studio.ads.monthlyCap")}: {formatMoney({ amountMinor: c.adAccount.monthlyCapMinor, currency: cur }, locale)}
            </p>
            {canManage ? (
              <div className="grid gap-2">
                {!c.externalId ? <ActionButton path={`${base}/ads/campaigns/${c.id}/changes`} body={{ action: "launch" }} icon={<Rocket aria-hidden />} label={t("marketing.studio.ads.requestLaunch")} variant="default" /> : null}
                {c.externalId ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <ActionButton path={`${base}/ads/campaigns/${c.id}/changes`} body={{ action: "activate" }} icon={<Play aria-hidden />} label={t("marketing.studio.ads.requestActivate")} />
                      <ActionButton path={`${base}/ads/campaigns/${c.id}/changes`} body={{ action: "pause" }} icon={<Pause aria-hidden />} label={t("marketing.studio.ads.requestPause")} />
                    </div>
                    <BudgetChange base={base} id={c.id} />
                  </>
                ) : null}
                <p className="text-xs text-muted-foreground">{t("marketing.studio.ads.approvalNote")}</p>
              </div>
            ) : null}
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title={t("marketing.studio.ads.adsTitle")} />
        <ul className="grid divide-y text-sm">
          {c.groups.flatMap((g) => g.ads.map((a) => ({ g, a }))).map(({ g, a }) => (
            <li key={a.id} className="grid gap-1 p-4">
              <p className="font-medium">{a.headline}</p>
              <p className="text-muted-foreground">{a.body}</p>
              <p className="text-xs text-muted-foreground">
                {g.name}
                {a.cta ? ` · ${a.cta}` : ""}
                {a.url ? ` · ${a.url}` : ""}
              </p>
            </li>
          ))}
        </ul>
        {c.plan ? <pre className="whitespace-pre-wrap p-4 font-sans text-sm">{c.plan}</pre> : null}
      </Card>
      <Card>
        <CardHeader title={t("marketing.ai.title")} />
        <div className="grid gap-3 p-4">
          {canRunAgents ? (
            <div className="flex flex-wrap gap-2">
              <AiRequest path={`${base}/ads/campaigns/${c.id}/ai`} kind="plan" label={t("marketing.studio.ads.aiPlan")} />
              <AiRequest path={`${base}/ads/campaigns/${c.id}/ai`} kind="copy" label={t("marketing.studio.ads.aiCopy")} />
              <AiRequest path={`${base}/ads/campaigns/${c.id}/ai`} kind="optimize" label={t("marketing.studio.ads.aiOptimize")} />
            </div>
          ) : null}
          <AiTaskList tasks={tasks} locale={locale} tz={tz} t={t} aiReady={aiReady} />
        </div>
      </Card>
    </MarketingShell>
  );
}
