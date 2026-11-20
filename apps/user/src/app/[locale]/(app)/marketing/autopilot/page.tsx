import type { Metadata } from "next";
import Link from "next/link";
import { Bot } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MarketingShell, Pager, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { HelpPanel, InfoStrip, SmartEmpty, StageBoard } from "@/components/marketing/studio";
import { AutopilotForm } from "@/components/marketing/studio-forms";
import { ItemsCanvas } from "@/components/marketing/autopilot-items";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { listAutopilots, listItems, parseItemFilters, pipelineSummary, PIPELINE_STAGES } from "@/server/modules/marketing/autopilot";
import { listAccounts, SOCIAL_PROVIDERS } from "@/server/modules/marketing/social";
import { listHelpTasks } from "@/server/modules/marketing/intelligence";
import { loadBrandKit } from "@/server/modules/marketing/brand";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.autopilot") };
}

export default async function AutopilotPage({ searchParams }: PageProps<"/[locale]/marketing/autopilot">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "autopilot" as const, title: t("marketing.studio.autopilot.title"), subtitle: t("marketing.studio.autopilot.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, tz } = m;
  const f = parseItemFilters(await searchParams);
  const [plans, items, stages, { accounts }, help, kit] = await Promise.all([
    listAutopilots(viewer.ctx, org.id, company.id),
    listItems(viewer.ctx, org.id, company.id, null, f),
    pipelineSummary(org.id, company.id),
    listAccounts(viewer.ctx, org.id, company.id),
    listHelpTasks(org.id, company.id, "autopilot"),
    loadBrandKit(db(), company.id),
  ]);
  const path = `/${locale}/marketing/autopilot`;
  const working = items.data.some((i) => i.pendingTaskId);
  const initial = { name: "", objective: "", audience: "", regions: "", pillars: "", cadence: {}, accountIds: accounts.filter((a) => a.connected).map((a) => a.id), timezone: tz, windows: {}, autonomy: "REVIEW_REQUIRED", approvalRules: {}, complianceRules: "", horizonDays: 3, minReviewScore: 70, monthlyBudget: "", currency: company.baseCurrency, useResearch: true, generateImages: true };
  return (
    <MarketingShell {...shell}>
      <AutoRefresh active={working} intervalMs={8000} />
      <InfoStrip t={t} k="autopilot" />
      <StageBoard t={t} stages={PIPELINE_STAGES} counts={stages} href={(s) => `${path}?stage=${s}`} />
      {plans.length === 0 ? (
        <SmartEmpty
          icon={<Bot />}
          title={t("marketing.studio.autopilot.emptyTitle")}
          body={t("marketing.studio.autopilot.emptyBody")}
          action={
            <Link href={`/${locale}/marketing/start`} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              {t("marketing.studio.overview.start")}
            </Link>
          }
        />
      ) : (
        <div className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((p) => (
            <Link key={p.id} href={`${path}/${p.id}`}>
              <Card interactive variant="elevated" className="grid gap-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{p.name}</span>
                  <StatusBadge status={p.status === "ACTIVE" ? "ACTIVE" : "PAUSED"} label={t(`marketing.studio.autopilot.status.${p.status}`)} />
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">{p.objective}</p>
                <p className="text-xs">
                  {t(`marketing.studio.autonomy.${p.autonomy}`)} · {Object.entries(p.cadence as Record<string, number>).filter(([, n]) => n > 0).map(([k, n]) => `${t(`marketing.provider.${k.split(":")[0]}`)}${k.includes(":") ? ` ${t(`marketing.studio.format.${k.split(":")[1]}`)}` : ""} ×${n}`).join(", ") || "—"}
                </p>
                <p className="text-xs text-muted-foreground">{t("marketing.studio.autopilot.counts", { ready: p.stages.READY ?? 0, scheduled: p.stages.SCHEDULED ?? 0, published: (p.stages.PUBLISHED ?? 0) + (p.stages.ANALYZED ?? 0) })}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {canManage ? (
        <Card>
          <details>
            <summary className="cursor-pointer p-4 font-medium">{t("marketing.studio.autopilot.new")}</summary>
            <AutopilotForm base={base} accounts={accounts.map((a) => ({ id: a.id, name: a.name, provider: a.provider }))} initial={initial} />
          </details>
        </Card>
      ) : null}
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
          {items.data.length === 0 ? <p className="p-2 text-sm text-muted-foreground">{t("marketing.studio.canvas.empty")}</p> : <ItemsCanvas items={items.data} t={t} locale={locale} tz={tz} base={base} brand={kit?.brandName ?? company.name} canManage={canManage} />}
        </div>
        <Pager path={path} params={{ stage: f.stage, platform: f.platform }} page={f.page} total={items.total} pageSize={items.pageSize} t={t} />
      </Card>
      <HelpPanel t={t} base={base} page="autopilot" tasks={help} locale={locale} tz={tz} aiReady={m.aiReady} canRun={m.canRunAgents} />
    </MarketingShell>
  );
}
