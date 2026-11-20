import Link from "next/link";
import { Bot, CalendarDays, CheckCircle2, Goal, Lightbulb, Plug, Rocket, Send } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { LiveDot } from "@/components/motion/live-dot";
import { formatDateTime, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { listRecommendations } from "@/server/modules/marketing/recommendations";
import { listGoals } from "@/server/modules/marketing/intelligence";
import { listHelpTasks, marketingAiActivity } from "@/server/modules/marketing/intelligence";
import { pipelineSummary, PIPELINE_STAGES } from "@/server/modules/marketing/autopilot";
import { connectionStatus, SOCIAL_PROVIDERS } from "@/server/modules/marketing/social";
import { creativeStatus } from "@/server/modules/marketing/assets";
import { ActionButton } from "./ui";
import { StatusBadge, type MarketingContext } from "./shell";
import { HelpPanel, InfoStrip, StageBoard } from "./studio";
import { CampaignFlow } from "./studio-client";
import { GoalForm } from "./studio-forms";

type Ready = Exclude<MarketingContext, { blocked: "no_company" }>;

/** Marketing Studio command center: pipeline flow, publishing board, what-to-do-next, goals, connections and AI activity. */
export async function StudioCommand({ m }: { m: Ready }) {
  const { org, company, viewer, locale, t, base, tz, canManage, canRunAgents, aiReady } = m;
  const [recs, goals, stages, ai, connected, creative, postStatus, help, autopilots] = await Promise.all([
    listRecommendations(viewer.ctx, org.id, company.id),
    listGoals(viewer.ctx, org.id, company.id),
    pipelineSummary(org.id, company.id),
    marketingAiActivity(org.id, company.id, 8),
    connectionStatus(org.id, company.id),
    creativeStatus(org.id, company.id),
    db().marketingSocialPost.groupBy({ by: ["status"], where: { organizationId: org.id, companyId: company.id }, _count: { _all: true } }),
    listHelpTasks(org.id, company.id, "overview"),
    db().marketingAutopilot.count({ where: { companyId: company.id, archivedAt: null, status: "ACTIVE" } }),
  ]);
  const posts = Object.fromEntries(postStatus.map((p) => [p.status, p._count._all])) as Record<string, number>;
  const flow = ["IDEA", "RESEARCH", "DRAFT", "AI_REVIEW", "READY", "SCHEDULED", "PUBLISHED", "ANALYZED"].map((k) => ({ key: k, label: t(`marketing.studio.stage.${k}`), count: stages[k as keyof typeof stages] ?? 0 }));
  return (
    <div className="grid gap-4">
      <InfoStrip
        t={t}
        k="overview"
        next={
          <Link href={`/${locale}/marketing/${autopilots ? "autopilot" : "start"}`} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            <Rocket className="size-4" aria-hidden />
            {autopilots ? t("marketing.studio.overview.openAutopilot") : t("marketing.studio.overview.start")}
          </Link>
        }
      />
      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile index={0} label={t("marketing.studio.overview.activeAutopilots")} value={autopilots} icon={<Bot />} live={autopilots > 0} href={`/${locale}/marketing/autopilot`} />
        <StatTile index={1} label={t("marketing.studio.overview.waitingApproval")} value={stages.READY ?? 0} icon={<CheckCircle2 />} href={`/${locale}/marketing/autopilot?stage=READY`} />
        <StatTile index={2} label={t("marketing.studio.overview.scheduled")} value={posts.SCHEDULED ?? 0} icon={<CalendarDays />} href={`/${locale}/marketing/social?status=SCHEDULED`} />
        <StatTile index={3} label={t("marketing.studio.overview.published")} value={posts.PUBLISHED ?? 0} icon={<Send />} href={`/${locale}/marketing/social?status=PUBLISHED`} />
      </div>

      <Card variant="elevated">
        <CardHeader title={t("marketing.studio.pipeline.title")} description={t("marketing.studio.pipeline.hint")} />
        <div className="grid gap-4 p-4">
          <CampaignFlow steps={flow} label={t("marketing.studio.pipeline.title")} />
          <StageBoard t={t} stages={PIPELINE_STAGES} counts={stages} href={(s) => `/${locale}/marketing/autopilot?stage=${s}`} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card variant="highlight" className="lg:col-span-2">
          <CardHeader title={t("marketing.studio.next.title")} description={t("marketing.studio.next.hint")} />
          {recs.length === 0 ? (
            <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Lightbulb className="size-4" aria-hidden />
              {t("marketing.studio.next.empty")}
            </p>
          ) : (
            <ul className="grid divide-y">
              {recs.slice(0, 8).map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      <StatusBadge status={r.priority === "high" ? "FAILED" : r.priority === "medium" ? "PAUSED" : "DRAFT"} label={t(`marketing.studio.priority.${r.priority}`)} />{" "}
                      {r.href ? (
                        <Link href={`/${locale}${r.href}`} className="hover:underline">
                          {r.title}
                        </Link>
                      ) : (
                        r.title
                      )}
                    </p>
                    {r.detail ? <p className="mt-0.5 text-xs text-muted-foreground">{r.detail}</p> : null}
                  </div>
                  {canManage ? (
                    <span className="flex gap-1">
                      <ActionButton path={`${base}/recommendations/${r.id}`} body={{ status: "DONE" }} label={t("marketing.studio.next.done")} variant="ghost" />
                      <ActionButton path={`${base}/recommendations/${r.id}`} body={{ status: "DISMISSED" }} label={t("marketing.studio.next.dismiss")} variant="ghost" />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={t("marketing.studio.connections.title")} actions={<Link href={`/${locale}/integrations`} className="text-xs hover:underline">{t("marketing.common.openIntegrations")}</Link>} />
          <ul className="grid gap-1.5 p-4 text-sm">
            {SOCIAL_PROVIDERS.map((p) => (
              <li key={p} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <LiveDot tone={connected[p] ? "success" : "neutral"} pulse={false} />
                  {t(`marketing.provider.${p}`)}
                </span>
                {connected[p] ? <span className="text-xs text-success">{t("marketing.social.connected")}</span> : <Link href={`/${locale}/integrations/${p.toLowerCase()}`} className="text-xs text-muted-foreground hover:underline">{t("marketing.studio.connections.connect")}</Link>}
              </li>
            ))}
            <li className="mt-2 flex items-center justify-between border-t pt-2">
              <span className="flex items-center gap-2">
                <Plug className="size-3.5" aria-hidden />
                {t("marketing.studio.connections.images")}
              </span>
              <span className="text-xs text-muted-foreground">{creative.image ?? t("common.notConnected")}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Plug className="size-3.5" aria-hidden />
                {t("marketing.studio.connections.video")}
              </span>
              <span className="text-xs text-muted-foreground">{creative.video ?? t("common.notConnected")}</span>
            </li>
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("marketing.studio.goals.title")} description={t("marketing.studio.goals.hint")} />
          <div className="grid gap-3 p-4">
            {goals.length === 0 ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Goal className="size-4" aria-hidden />{t("marketing.studio.goals.empty")}</p> : null}
            {goals.map((g) => (
              <div key={g.id} className="grid gap-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{g.name}</span>
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {formatNumber(Math.round(g.current), locale)} / {formatNumber(g.target, locale)} · {t(`marketing.studio.goals.metric.${g.metric}`)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-label={g.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, g.progress))}>
                  <div className="h-full rounded-full bg-primary transition-[width] duration-700 motion-reduce:transition-none" style={{ width: `${Math.min(100, g.progress)}%` }} />
                </div>
                {canManage ? <div className="text-end"><ActionButton path={`${base}/goals/${g.id}`} method="DELETE" variant="ghost" label={t("marketing.common.archive")} confirm={t("marketing.common.confirmArchive")} /></div> : null}
              </div>
            ))}
            {canManage ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium">{t("marketing.studio.goals.add")}</summary>
                <GoalForm base={base} />
              </details>
            ) : null}
          </div>
        </Card>
        <Card>
          <CardHeader title={t("marketing.studio.ai.title")} actions={<Link href={`/${locale}/tasks`} className="text-xs hover:underline">{t("marketing.common.viewAll")}</Link>} />
          {ai.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("marketing.studio.ai.empty")}</p>
          ) : (
            <ul className="grid divide-y text-sm">
              {ai.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <Link href={`/${locale}/tasks/${x.id}`} className="min-w-0 truncate hover:underline">
                    {x.title}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <StatusBadge status={x.status} label={t(`agentTasks.status.${x.status}`)} />
                    {formatDateTime(x.createdAt, locale, tz)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <HelpPanel t={t} base={base} page="overview" tasks={help} locale={locale} tz={tz} aiReady={aiReady} canRun={canRunAgents} />
    </div>
  );
}
