import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AiRequest } from "@/components/marketing/ai-panel";
import { AiTaskList } from "@/components/marketing/ai-tasks";
import { CampaignForm, SpendForm, UtmBuilder } from "@/components/marketing/campaign-forms";
import { CAMPAIGN_VIEWS, CampaignLeadsView, CampaignPipelineView, CampaignViewTabs, type CampaignView } from "@/components/marketing/campaign-crm";
import { Kpi, MarketingShell, Meter, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { ActionButton } from "@/components/marketing/ui";
import { majorUnits } from "@/components/marketing/format";
import { getT } from "@/i18n/server";
import { formatDate, formatMoney, formatNumber } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { campaignAnalytics, campaignLeads, campaignPipeline, LEAD_STAGES } from "@/server/modules/marketing/analytics";
import { enumParam, pageParam, param } from "@/server/modules/marketing/common";
import { CAMPAIGN_TRANSITIONS, getCampaign } from "@/server/modules/marketing/campaigns";
import { listSegments } from "@/server/modules/marketing/segments";
import { assignableEmployees, campaignTeam } from "@/server/modules/marketing/ai";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.campaigns") };
}

export default async function CampaignPage({ params, searchParams }: PageProps<"/[locale]/marketing/campaigns/[campaignId]">) {
  const { campaignId } = await params;
  const sp = await searchParams;
  const view: CampaignView = enumParam(sp, "view", CAMPAIGN_VIEWS) ?? "overview";
  const m = await loadMarketing();
  const { locale, t } = m;
  const back = { href: `/${locale}/marketing/campaigns`, label: t("marketing.campaigns.title") };
  if (m.blocked) return <MarketingShell locale={locale} t={t} tab="campaigns" title={t("marketing.campaigns.title")} back={back} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, canRunAgents, tz } = m;
  const c = await getCampaign(viewer.ctx, org.id, company.id, campaignId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const [a, segments, tasks, team, employees] = await Promise.all([
    campaignAnalytics(viewer.ctx, org.id, company.id, campaignId),
    canManage ? listSegments(viewer.ctx, org.id, company.id) : Promise.resolve([]),
    canRunAgents || m.canRead ? listSubjectTasks(viewer.ctx, org.id, company.id, "marketing_campaign", c.id).catch(() => []) : Promise.resolve([]),
    campaignTeam(viewer.ctx, org.id, company.id, c.id).catch(() => []),
    canRunAgents ? assignableEmployees(viewer.ctx, org.id, company.id).catch(() => []) : Promise.resolve([]),
  ]);
  const leadFilters = { q: param(sp, "q"), stage: enumParam(sp, "stage", LEAD_STAGES), page: pageParam(sp) };
  const dealFilters = { status: enumParam(sp, "status", ["OPEN", "WON", "LOST"] as const), page: pageParam(sp) };
  const [leadsView, pipelineView] = await Promise.all([
    view === "leads" ? campaignLeads(viewer.ctx, org.id, company.id, c.id, leadFilters) : null,
    view === "pipeline" ? campaignPipeline(viewer.ctx, org.id, company.id, c.id, dealFilters) : null,
  ]);
  const pagePath = `/${locale}/marketing/campaigns/${c.id}`;
  const money = (v: bigint | null) => (v == null ? "—" : formatMoney({ amountMinor: v, currency: c.currency }, locale));
  const pct = (v: number | null) => (v == null ? "—" : `${formatNumber(Math.round(v * 10) / 10, locale)}%`);
  const path = `${base}/campaigns/${c.id}`;
  const maxDay = Math.max(1, ...a.series.map((s) => s.leads));
  const archived = !!c.archivedAt;

  return (
    <MarketingShell
      locale={locale}
      t={t}
      tab="campaigns"
      back={back}
      title={c.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={c.status} label={t(`marketing.campaignStatus.${c.status}`)} />
          <span className="font-mono text-xs">{c.code}</span>
          {c.segment ? <span className="text-xs">· {c.segment.name}</span> : null}
          {archived ? <span className="text-xs text-warning">· {t("marketing.common.archived")}</span> : null}
        </span>
      }
      actions={
        canManage && !archived ? (
          <>
            {CAMPAIGN_TRANSITIONS[c.status].map((s) => (
              <ActionButton key={s} path={`${path}/status`} body={{ status: s }} variant={s === "ACTIVE" ? "default" : "secondary"} label={t(`marketing.campaigns.moveTo.${s}`)} />
            ))}
            <ActionButton path={path} method="DELETE" variant="ghost" label={t("marketing.common.archive")} confirm={t("marketing.common.confirmArchive")} redirectTo={back.href} />
          </>
        ) : null
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Kpi label={t("marketing.campaigns.spent")} value={money(a.spentMinor)} hint={t("marketing.commandCenter.ofBudget", { budget: money(c.budgetMinor) })} />
        <Kpi label={t("marketing.campaigns.leads")} value={formatNumber(a.leads, locale)} hint={c.targetLeads ? t("marketing.campaigns.ofTarget", { target: c.targetLeads }) : undefined} />
        <Kpi label={t("marketing.campaigns.won")} value={formatNumber(a.won, locale)} hint={pct(a.conversionRate)} />
        <Kpi label={t("marketing.campaigns.revenue")} value={money(a.revenueMinor)} hint={c.targetRevenueMinor ? t("marketing.campaigns.ofTarget", { target: money(c.targetRevenueMinor) }) : undefined} />
        <Kpi label={t("marketing.metrics.cac")} value={money(a.cacMinor)} hint={`${t("marketing.campaigns.cpl")}: ${money(a.cplMinor)}`} />
        <Kpi label={t("marketing.metrics.campaignRoi")} value={pct(a.roi)} tone={a.roi == null ? undefined : a.roi >= 0 ? "success" : "danger"} />
      </div>

      <CampaignViewTabs path={pagePath} active={view} t={t} />
      {leadsView ? <CampaignLeadsView data={leadsView} path={pagePath} locale={locale} tz={tz} t={t} f={leadFilters} /> : null}
      {pipelineView ? <CampaignPipelineView data={pipelineView} path={pagePath} locale={locale} t={t} f={dealFilters} /> : null}
      {view === "overview" ? (
      <>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("marketing.campaigns.analytics")} description={t("marketing.campaigns.analyticsHint", { code: c.code })} />
          <div className="grid gap-4 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">{t("marketing.campaigns.budgetUsed")}</span>
                <Meter value={a.budgetUsed} label={t("marketing.campaigns.budgetUsed")} />
                <span className="text-xs tabular-nums">{pct(a.budgetUsed)}</span>
              </div>
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">{t("marketing.campaigns.leadGoal")}</span>
                <Meter value={a.leadProgress} label={t("marketing.campaigns.leadGoal")} />
                <span className="text-xs tabular-nums">{pct(a.leadProgress)}</span>
              </div>
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">{t("marketing.campaigns.revenueGoal")}</span>
                <Meter value={a.revenueProgress} label={t("marketing.campaigns.revenueGoal")} />
                <span className="text-xs tabular-nums">{pct(a.revenueProgress)}</span>
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">{t("marketing.campaigns.leadsPerDay")}</p>
              <div className="flex h-24 items-end gap-px" role="img" aria-label={t("marketing.campaigns.leadsPerDay")}>
                {a.series.map((s) => (
                  <div key={s.day} title={`${s.day}: ${s.leads}`} className="min-w-[2px] flex-1 rounded-t-sm bg-primary/70" style={{ height: `${(s.leads / maxDay) * 100}%` }} />
                ))}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">{t("marketing.campaigns.formSubmissions")}</dt>
                <dd className="tabular-nums">{a.submissions}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("marketing.metrics.emailsSent")}</dt>
                <dd className="tabular-nums">{a.emails.SENT ?? 0}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("marketing.campaigns.openRate")}</dt>
                <dd className="tabular-nums">
                  {pct(a.openRate)} <span className="text-xs text-muted-foreground">({a.emailOpened})</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("marketing.campaigns.clickRate")}</dt>
                <dd className="tabular-nums">
                  {pct(a.clickRate)} <span className="text-xs text-muted-foreground">({a.emailClicked})</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("marketing.metrics.postsPublished")}</dt>
                <dd className="tabular-nums">{a.social.published}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("marketing.commandCenter.engagement")}</dt>
                <dd className="tabular-nums">{a.social.engagement}</dd>
              </div>
            </dl>
            {a.recentLeads.length ? (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">{t("marketing.campaigns.recentLeads")}</p>
                <ul className="grid divide-y rounded-md border text-sm">
                  {a.recentLeads.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <Link href={`/${locale}/crm/${l.id}`} className="truncate hover:underline">
                        {l.name}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {l.stage} · {formatDate(l.createdAt, locale, tz)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("marketing.utm.title")} description={t("marketing.utm.hint")} />
            <UtmBuilder code={c.code} channels={c.channels} />
          </Card>
          <Card>
            <CardHeader title={t("marketing.campaigns.linked")} />
            <ul className="grid gap-1 p-4 text-sm">
              <li>
                <Link className="hover:underline" href={`/${locale}/marketing/content?campaign=${c.id}`}>
                  {t("marketing.tabs.content")}: {c._count.content}
                </Link>
              </li>
              <li>{t("marketing.tabs.social")}: {c._count.socialPosts}</li>
              <li>{t("marketing.tabs.email")}: {c._count.emailCampaigns}</li>
              <li>{t("marketing.tabs.forms")}: {c._count.forms}</li>
            </ul>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title={t("marketing.campaigns.spend")} description={a.spendByChannel.map((s) => `${t(`marketing.channels.${s.channel}`)} ${money(s.amountMinor)}`).join(" · ") || undefined} />
        {canManage && !archived ? <SpendForm base={base} campaignId={c.id} channels={c.channels} /> : null}
        {c.spend.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("marketing.campaigns.noSpend")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("marketing.campaigns.spentOn")}</Th>
                <Th>{t("marketing.common.channel")}</Th>
                <Th>{t("marketing.campaigns.note")}</Th>
                <Th className="text-end">{t("marketing.campaigns.amount")}</Th>
                {canManage ? <Th className="w-0" /> : null}
              </Tr>
            </THead>
            <TBody>
              {c.spend.map((s) => (
                <Tr key={s.id}>
                  <Td>{formatDate(s.spentOn, locale, "UTC")}</Td>
                  <Td>{t(`marketing.channels.${s.channel}`)}</Td>
                  <Td className="text-muted-foreground">{s.note}</Td>
                  <Td className="text-end tabular-nums">{money(s.amountMinor)}</Td>
                  {canManage ? (
                    <Td>
                      <ActionButton path={`${path}/spend/${s.id}`} method="DELETE" variant="ghost" icon={<Trash2 aria-hidden />} label={<span className="sr-only">{t("marketing.common.delete")}</span>} confirm={t("marketing.common.confirmDelete")} />
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title={t("marketing.ai.title")} description={t("marketing.ai.campaignHint")} />
        <div className="grid gap-3 p-4">
          {canRunAgents && !archived ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <AiRequest path={`${path}/ai`} kind="campaign_plan" label={t("marketing.ai.campaignPlan")} notePlaceholder={t("marketing.ai.notePlaceholder")} employees={employees} />
              <AiRequest path={`${path}/ai`} kind="campaign_analysis" label={t("marketing.ai.campaignAnalysis")} employees={employees} />
              <div className="grid gap-1 sm:col-span-2">
                <p className="text-xs text-muted-foreground">{t("marketing.ai.campaignContentHint")}</p>
                <AiRequest path={`${path}/ai`} kind="campaign_content" label={t("marketing.ai.campaignContent")} notePlaceholder={t("marketing.ai.notePlaceholder")} employees={employees} />
              </div>
            </div>
          ) : null}
          <div className="grid gap-1">
            <p className="text-xs font-medium">{t("marketing.ai.team")}</p>
            {team.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("marketing.ai.teamEmpty")}</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {team.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/${locale}/workforce/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    {p.jobTitle ? <span className="text-xs text-muted-foreground">{p.jobTitle}</span> : null}
                    <StatusBadge status={p.task.status} label={t(`agentTasks.status.${p.task.status}`)} />
                    <Link href={`/${locale}/tasks/${p.task.id}`} className="min-w-0 flex-1 truncate text-xs text-muted-foreground hover:underline">
                      {p.task.title}
                    </Link>
                    <span className="text-xs text-muted-foreground">{t("marketing.ai.teamTasks", { count: p.tasks })}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <AiTaskList tasks={tasks} locale={locale} tz={tz} t={t} aiReady={m.aiReady} />
        </div>
      </Card>

      </>
      ) : null}

      {view === "overview" && canManage && !archived ? (
        <Card>
          <details>
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("marketing.campaigns.edit")}</summary>
            <CampaignForm
              base={base}
              locale={locale}
              segments={segments.map((s) => ({ id: s.id, name: s.name }))}
              initial={{
                id: c.id,
                name: c.name,
                code: c.code,
                objective: c.objective ?? "",
                description: c.description ?? "",
                channels: c.channels,
                budget: majorUnits(c.budgetMinor),
                targetLeads: c.targetLeads?.toString() ?? "",
                targetRevenue: majorUnits(c.targetRevenueMinor),
                startDate: c.startDate?.toISOString().slice(0, 10) ?? "",
                endDate: c.endDate?.toISOString().slice(0, 10) ?? "",
                segmentId: c.segmentId ?? "",
              }}
            />
          </details>
        </Card>
      ) : null}
    </MarketingShell>
  );
}
