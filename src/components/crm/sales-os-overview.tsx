import Link from "next/link";
import { Bot, Compass, Gauge, Route, Users, Waves } from "lucide-react";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LiveDot } from "@/components/motion/live-dot";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { pipelineBoard } from "@/server/modules/crm/deals";
import { recentSalesAiTasks } from "@/server/modules/crm/guided";
import { salesForecast } from "@/server/modules/crm/sales";
import { crmDashboard, dueFollowUps, listLeads } from "@/server/modules/crm/service";
import { RestartJourneyButton } from "./journey-buttons";
import { SmartEmpty } from "./page-intro";
import { ForecastChart, Funnel, HeroNumber, JourneyMap, LeadIntelCards, NextActionsRail, PipelineRiver, type JourneyStage, type LeadCard, type RailItem } from "./sales-os";
import { crmContext } from "./shell";

const nowMs = () => Date.now();

/** Sales OS visual overview (top of /sales): journey map, funnel, pipeline river, lead intelligence, forecast, AI rail. */
export async function SalesOsOverview() {
  const c = await crmContext();
  if (!c.company || !c.canRead) return null;
  const { t, locale, viewer, org, company, base } = c;
  const [dash, board, leads, due, ai, forecast] = await Promise.all([
    crmDashboard(viewer.ctx, org.id, company.id),
    pipelineBoard(viewer.ctx, org.id, company.id),
    listLeads(viewer.ctx, org.id, company.id, { converted: "no" }, { take: 6 }),
    dueFollowUps(viewer.ctx, org.id, company.id),
    recentSalesAiTasks(viewer.ctx, org.id, company.id, 6),
    salesForecast(viewer.ctx, org.id, company.id, { months: 6 }),
  ]);
  const stages: JourneyStage[] = dash.funnel.map((f) => ({ key: f.stage, label: f.stage === "NEW" ? t("sales.os.stageLead") : t(`crm.stages.${f.stage}`), count: f.count, conversion: f.conversion }));
  const won = dash.funnel[dash.funnel.length - 1]?.count ?? 0;
  const first = dash.funnel[0]?.count ?? 0;
  const river = board.stages.filter((s) => s.type === "OPEN").map((s) => ({ id: s.id, name: s.name, valueMinor: s.totalMinor.toString(), count: s.deals.filter((d) => d.status === "OPEN").length }));
  const openValue = river.reduce((sum, s) => sum + BigInt(s.valueMinor), 0n);
  const cards: LeadCard[] = leads.map((l) => ({
    id: l.id,
    name: l.name,
    account: l.account,
    score: l.score,
    label: l.scoreLabel,
    stage: l.stage,
    lastContactedAt: l.lastContactedAt?.toISOString() ?? null,
    next: l.followUps[0] ? { note: l.followUps[0].note, dueAt: l.followUps[0].dueAt.toISOString() } : null,
    valueMinor: l.valueMinor?.toString() ?? null,
    currency: l.currency,
  }));
  const now = nowMs();
  const rail: RailItem[] = [
    ...due.slice(0, 6).map((f) => ({ id: f.id, kind: "followup" as const, title: `${f.lead.name}: ${f.note}`, detail: f.lead.account, at: f.dueAt.toISOString(), href: `/${locale}/crm/${f.lead.id}`, overdue: f.dueAt.getTime() < now })),
    ...ai.map((task) => ({
      id: task.id,
      kind: "ai" as const,
      title: task.title,
      detail: task.output ? task.output.replace(/\s+/g, " ").slice(0, 180) : null,
      at: task.createdAt.toISOString(),
      href: `/${locale}/tasks/${task.id}`,
      status: task.status,
    })),
  ];
  const aiRunning = ai.some((x) => x.status === "QUEUED" || x.status === "RUNNING");
  const empty = dash.total === 0 && river.every((s) => s.count === 0);

  return (
    <div className="grid gap-4">
      <AutoRefresh active={aiRunning} intervalMs={5000} />
      <Card variant="highlight" className="relative overflow-hidden">
        <div className="relative grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="grid gap-3">
            <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-primary uppercase">
              <LiveDot tone="primary" pulse={aiRunning} />
              {t("sales.os.eyebrow")}
            </p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <HeroNumber label={t("sales.os.inJourney")} value={first} hint={t("sales.os.inJourneyHint")} />
              <HeroNumber label={t("sales.os.won")} value={won} hint={first ? t("sales.os.wonHint", { pct: Math.round((won / first) * 100) }) : undefined} />
              <HeroNumber label={t("sales.os.openValue")} money={{ amountMinor: openValue.toString(), currency: board.currency }} />
              <HeroNumber label={t("sales.os.dueToday")} value={due.length} hint={t("sales.os.dueTodayHint")} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="gradient">
              <Link href={`/${locale}/sales/start`}>
                <Compass aria-hidden />
                {t("sales.os.startSelling")}
              </Link>
            </Button>
            {c.canManage ? <RestartJourneyButton base={base} locale={locale} /> : null}
          </div>
        </div>
      </Card>

      {empty ? (
        <Card>
          <SmartEmpty ns="crm.smartEmpty.sales" primaryHref={`/${locale}/sales/start`} aiHref={`/${locale}/sales/start`} />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card variant="elevated">
              <CardHeader icon={<Route />} title={t("sales.os.journeyTitle")} description={t("sales.os.journeyHint")} />
              <CardBody>
                <JourneyMap stages={stages} label={t("sales.os.journeyTitle")} />
              </CardBody>
            </Card>
            <Card variant="elevated">
              <CardHeader icon={<Gauge />} title={t("sales.os.funnelTitle")} description={t("sales.os.funnelHint")} />
              <CardBody>
                <Funnel stages={stages} label={t("sales.os.funnelTitle")} />
              </CardBody>
            </Card>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card variant="elevated">
              <CardHeader icon={<Waves />} title={t("sales.os.riverTitle")} description={t("sales.os.riverHint", { pipeline: board.pipeline.name })} />
              <CardBody>
                {river.length ? <PipelineRiver stages={river} currency={board.currency} label={t("sales.os.riverTitle")} href={`/${locale}/crm/pipeline`} /> : <p className="text-sm text-muted-foreground">{t("sales.os.riverEmpty")}</p>}
              </CardBody>
            </Card>
            <Card variant="elevated">
              <CardHeader title={t("sales.os.forecastTitle")} description={t("sales.os.forecastHint")} />
              <CardBody>
                <ForecastChart
                  label={t("sales.os.forecastTitle")}
                  currency={forecast.currency}
                  months={forecast.byMonth.map((m) => ({ month: m.month, wonMinor: m.wonMinor.toString(), weightedMinor: m.weightedMinor.toString(), bestCaseMinor: m.bestCaseMinor.toString() }))}
                />
              </CardBody>
            </Card>
          </div>
        </>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            icon={<Users />}
            title={t("sales.os.leadsTitle")}
            description={t("sales.os.leadsHint")}
            actions={
              <Link href={`/${locale}/crm`} className="text-xs hover:underline">
                {t("sales.os.allLeads")}
              </Link>
            }
          />
          <CardBody>{cards.length ? <LeadIntelCards leads={cards} /> : <SmartEmpty ns="crm.smartEmpty.leads" primaryHref={`/${locale}/crm#new-item`} aiHref={`/${locale}/sales/start`} />}</CardBody>
        </Card>
        <Card variant="glass">
          <CardHeader icon={<Bot />} title={t("sales.os.railTitle")} description={aiConfigured() ? t("sales.os.railHint") : t("agentTasks.notConfigured")} />
          <CardBody>
            <NextActionsRail items={rail} emptyText={t("sales.os.railEmpty")} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
