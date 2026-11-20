import type { Metadata } from "next";
import Link from "next/link";
import { Target } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { MarketingShell, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { HelpPanel, InfoStrip } from "@/components/marketing/studio";
import { PlanEditor } from "@/components/marketing/plan-editor";
import { BudgetDonut, PlanTimeline } from "@/components/marketing/plan-visuals";
import { SmartEmpty } from "@/components/guide-kit/smart-empty";
import { getT } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n/format";
import { param, isUuid } from "@/server/modules/marketing/common";
import { listHelpTasks } from "@/server/modules/marketing/intelligence";
import { listPlans, planChannels, planObjectives } from "@/server/modules/marketing/plans";
import { usableResearch } from "@/server/modules/marketing/research-reports";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.strategy") };
}

const nowMs = () => Date.now();

/** Local calendar date (YYYY-MM-DD) in the company time zone, `addDays` from today. */
function localDay(tz: string, addDays = 0) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + addDays * 86_400_000));
}

export default async function MarketingStrategyPage({ searchParams }: PageProps<"/[locale]/marketing/strategy">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "strategy" as const, title: t("marketing.strategy.title"), subtitle: t("marketing.strategy.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, tz, aiReady, canManage, canRunAgents } = m;
  const sp = await searchParams;
  const preselect = param(sp, "research");
  const [plans, research, help] = await Promise.all([listPlans(viewer.ctx, org.id, company.id), usableResearch(org.id, company.id, undefined, 30), listHelpTasks(org.id, company.id, "strategy")]);
  const live = plans.find((p) => p.status === "ACTIVE") ?? plans.find((p) => p.status === "APPROVED");
  const cur = company.baseCurrency;

  return (
    <MarketingShell {...shell}>
      <InfoStrip t={t} k="strategy" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card className="p-4 sm:p-5">
          <h2 className="mb-1 font-display text-display">{t("marketing.strategy.timeline")}</h2>
          <p className="mb-6 text-sm text-muted-foreground">{t("marketing.strategy.timelineHint")}</p>
          {plans.length ? (
            <PlanTimeline plans={plans} locale={locale} tz={tz} t={t} now={nowMs()} />
          ) : (
            <SmartEmpty icon={<Target aria-hidden />} title={t("marketing.strategy.emptyTitle")} body={t("marketing.strategy.emptyBody")} />
          )}
        </Card>
        <Card className="p-4 sm:p-5">
          <h2 className="mb-1 font-display text-display">{live ? live.name : t("marketing.strategy.noLive")}</h2>
          {live ? (
            <>
              <p className="mb-4 text-sm text-muted-foreground">
                {formatDate(live.periodStart, locale, "UTC")} – {formatDate(live.periodEnd, locale, "UTC")} · {t("marketing.strategy.objectiveCount", { count: planObjectives(live.objectives).length })}
              </p>
              <BudgetDonut channels={planChannels(live.channels)} totalMinor={live.budgetMinor} currency={live.currency} locale={locale} t={t} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("marketing.strategy.noLiveHint")}</p>
          )}
        </Card>
      </div>

      {plans.length ? (
        <Card>
          <CardHeader title={t("marketing.strategy.plans")} />
          <ul className="grid divide-y">
            {plans.map((p) => (
              <li key={p.id}>
                <Link href={`/${locale}/marketing/strategy/${p.id}`} className="grid gap-1 px-4 py-3 hover:bg-muted/60 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(p.periodStart, locale, "UTC")} – {formatDate(p.periodEnd, locale, "UTC")} · {planChannels(p.channels).map((c) => t(`marketing.channels.${c.channel}`)).join(", ") || t("marketing.strategy.noChannels")}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums">{formatMoney({ amountMinor: p.budgetMinor, currency: p.currency }, locale)}</span>
                  <StatusBadge status={p.status} label={t(`marketing.strategy.status.${p.status}`)} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {canManage ? (
        <Card className="p-4 sm:p-5" id="new-plan">
          <h2 className="mb-1 font-display text-display">{t("marketing.strategy.newPlan")}</h2>
          <p className="mb-4 text-sm text-muted-foreground">{t("marketing.strategy.newPlanHint")}</p>
          <PlanEditor
            base={base}
            locale={locale}
            currency={cur}
            research={research.map((r) => ({ id: r.id, title: r.title, kind: r.kind }))}
            initial={{
              name: "",
              periodStart: localDay(tz),
              periodEnd: localDay(tz, 89),
              budget: "",
              positioning: "",
              audience: "",
              messaging: "",
              objectives: [],
              channels: [],
              researchIds: preselect && isUuid(preselect) && research.some((r) => r.id === preselect) ? [preselect] : [],
            }}
          />
        </Card>
      ) : (
        <Notice tone="info">{t("marketing.strategy.readOnly")}</Notice>
      )}
      <HelpPanel t={t} base={base} page="strategy" tasks={help} locale={locale} tz={tz} aiReady={aiReady} canRun={canRunAgents} />
    </MarketingShell>
  );
}
