import type { Metadata } from "next";
import { Pause, Play, RefreshCw } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { MarketingShell, Pager, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { StageBoard } from "@/components/marketing/studio";
import { CampaignFlow } from "@/components/marketing/studio-client";
import { AutopilotForm } from "@/components/marketing/studio-forms";
import { ItemsCanvas } from "@/components/marketing/autopilot-items";
import { ActionButton } from "@/components/marketing/ui";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { getT } from "@/i18n/server";
import { formatDateTime, formatMoney } from "@/i18n/format";
import { db } from "@/server/core/db";
import { getAutopilot, listItems, parseItemFilters, PIPELINE_STAGES } from "@/server/modules/marketing/autopilot";
import { listAccounts, SOCIAL_PROVIDERS } from "@/server/modules/marketing/social";
import { loadBrandKit } from "@/server/modules/marketing/brand";
import { majorUnits } from "@/components/marketing/format";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.autopilot") };
}

export default async function AutopilotDetailPage({ params, searchParams }: PageProps<"/[locale]/marketing/autopilot/[autopilotId]">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const { autopilotId } = await params;
  const shell = { locale, t, tab: "autopilot" as const, title: t("marketing.studio.autopilot.title"), back: { href: `/${locale}/marketing/autopilot`, label: t("marketing.studio.autopilot.title") } };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, tz } = m;
  const f = parseItemFilters(await searchParams);
  const [ap, items, { accounts }, kit] = await Promise.all([
    getAutopilot(viewer.ctx, org.id, company.id, autopilotId),
    listItems(viewer.ctx, org.id, company.id, autopilotId, f),
    listAccounts(viewer.ctx, org.id, company.id),
    loadBrandKit(db(), company.id),
  ]);
  const path = `/${locale}/marketing/autopilot/${ap.id}`;
  const windows = ap.postingWindows as Record<string, string[]>;
  const flow = ["IDEA", "RESEARCH", "DRAFT", "AI_REVIEW", "READY", "SCHEDULED", "PUBLISHED", "ANALYZED"].map((k) => ({ key: k, label: t(`marketing.studio.stage.${k}`), count: ap.stages[k as keyof typeof ap.stages] ?? 0 }));
  const missingAccounts = SOCIAL_PROVIDERS.filter((p) => Object.keys(ap.cadence as object).some((k) => k.startsWith(p)) && !accounts.some((a) => a.provider === p && ap.accountIds.includes(a.id)));
  return (
    <MarketingShell
      {...shell}
      title={ap.name}
      subtitle={ap.objective}
      actions={
        canManage && !ap.archivedAt ? (
          <>
            <StatusBadge status={ap.status === "ACTIVE" ? "ACTIVE" : "PAUSED"} label={t(`marketing.studio.autopilot.status.${ap.status}`)} />
            {ap.status === "ACTIVE" ? (
              <ActionButton path={`${base}/autopilots/${ap.id}/actions`} body={{ action: "pause" }} icon={<Pause aria-hidden />} label={t("marketing.studio.autopilot.pause")} />
            ) : (
              <ActionButton path={`${base}/autopilots/${ap.id}/actions`} body={{ action: "activate" }} icon={<Play aria-hidden />} label={t("marketing.studio.autopilot.activate")} variant="default" />
            )}
            <ActionButton path={`${base}/autopilots/${ap.id}/actions`} body={{ action: "plan_now" }} icon={<RefreshCw aria-hidden />} label={t("marketing.studio.autopilot.planNow")} />
            <ActionButton path={`${base}/autopilots/${ap.id}`} method="DELETE" variant="ghost" label={t("marketing.common.archive")} confirm={t("marketing.common.confirmArchive")} redirectTo={`/${locale}/marketing/autopilot`} />
          </>
        ) : null
      }
    >
      <AutoRefresh active={items.data.some((i) => i.pendingTaskId)} intervalMs={8000} />
      {!m.aiReady ? <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice> : null}
      {missingAccounts.length ? <Notice tone="warning">{t("marketing.studio.autopilot.missingAccounts", { platforms: missingAccounts.map((p) => t(`marketing.provider.${p}`)).join(", ") })}</Notice> : null}
      <Card variant="elevated">
        <CardHeader title={t("marketing.studio.pipeline.title")} description={ap.lastPlannedAt ? t("marketing.studio.autopilot.lastPlanned", { when: formatDateTime(ap.lastPlannedAt, locale, tz) }) : undefined} />
        <div className="grid gap-4 p-4">
          <CampaignFlow steps={flow} label={t("marketing.studio.pipeline.title")} />
          <StageBoard t={t} stages={PIPELINE_STAGES} counts={ap.stages} href={(s) => `${path}?stage=${s}`} />
        </div>
      </Card>
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">{t("marketing.studio.journey.approval")}</p>
          <p className="font-medium">{t(`marketing.studio.autonomy.${ap.autonomy}`)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">{t("marketing.studio.autopilot.timezone")}</p>
          <p className="font-medium">{ap.timezone}</p>
          <p className="text-xs text-muted-foreground">{Object.keys(windows).length ? Object.entries(windows).map(([k, v]) => `${t(`marketing.provider.${k}`)}: ${v.join(", ")}`).join(" · ") : t("marketing.studio.autopilot.smartTimes")}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">{t("marketing.studio.autopilot.budget")}</p>
          <p className="font-medium">{ap.monthlyBudgetMinor == null ? t("marketing.studio.autopilot.noPaid") : `${formatMoney({ amountMinor: ap.spentMinor, currency: ap.currency }, locale)} / ${formatMoney({ amountMinor: ap.monthlyBudgetMinor, currency: ap.currency }, locale)}`}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">{t("marketing.studio.autopilot.minScore")}</p>
          <p className="font-medium">{ap.minReviewScore}</p>
        </Card>
      </div>
      <Card>
        <CardHeader title={t("marketing.studio.canvas.title")} description={t("marketing.studio.canvas.hint")} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[12rem_12rem_auto]" action={path}>
          <Select name="stage" defaultValue={f.stage ?? ""} aria-label={t("marketing.studio.canvas.stage")}>
            <option value="">{t("marketing.studio.canvas.allStages")}</option>
            {PIPELINE_STAGES.map((s) => (
              <option key={s} value={s}>
                {t(`marketing.studio.stage.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="platform" defaultValue={f.platform ?? ""} aria-label={t("marketing.social.provider")}>
            <option value="">{t("marketing.studio.canvas.allPlatforms")}</option>
            {SOCIAL_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {t(`marketing.provider.${p}`)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {t("marketing.common.apply")}
          </Button>
        </form>
        <div className="p-3">
          {items.data.length === 0 ? <p className="p-2 text-sm text-muted-foreground">{t("marketing.studio.canvas.empty")}</p> : <ItemsCanvas items={items.data} t={t} locale={locale} tz={tz} base={base} brand={kit?.brandName ?? ap.brandName ?? company.name} canManage={canManage} />}
        </div>
        <Pager path={path} params={{ stage: f.stage, platform: f.platform }} page={f.page} total={items.total} pageSize={items.pageSize} t={t} />
      </Card>
      {canManage && !ap.archivedAt ? (
        <Card>
          <details>
            <summary className="cursor-pointer p-4 font-medium">{t("marketing.studio.autopilot.settings")}</summary>
            <AutopilotForm
              base={base}
              accounts={accounts.map((a) => ({ id: a.id, name: a.name, provider: a.provider }))}
              initial={{
                id: ap.id,
                name: ap.name,
                objective: ap.objective,
                audience: ap.audience ?? "",
                regions: ap.regions.join(", "),
                pillars: ap.pillars.join(", "),
                cadence: ap.cadence as Record<string, number>,
                accountIds: ap.accountIds,
                timezone: ap.timezone,
                windows: Object.fromEntries(Object.entries(windows).map(([k, v]) => [k, v.join(", ")])),
                autonomy: ap.autonomy,
                approvalRules: ap.approvalRules as Record<string, string>,
                complianceRules: ap.complianceRules.join("\n"),
                horizonDays: ap.horizonDays,
                minReviewScore: ap.minReviewScore,
                monthlyBudget: majorUnits(ap.monthlyBudgetMinor),
                currency: ap.currency,
                useResearch: ap.useResearch,
                generateImages: ap.generateImages,
              }}
            />
          </details>
        </Card>
      ) : null}
    </MarketingShell>
  );
}
