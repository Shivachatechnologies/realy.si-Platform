import Link from "next/link";
import { RefreshCw, Sparkles } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Translate } from "@/i18n/translate";
import type { RequestContext } from "@/server/core/context";
import { db } from "@/server/core/db";
import { seoAutopilotData } from "@/server/modules/marketing/seo-autopilot";
import { ActionButton } from "./ui";
import { AiTaskList } from "./ai-tasks";
import { BarChart } from "./studio";
import { TextPrompt } from "./studio-forms";

/** SEO autopilot: topic clusters, AI articles, Search Console, content gaps and refresh suggestions. */
export async function SeoAutopilotPanel({ ctx, orgId, companyId, projectId, base, locale, tz, t, canManage, canRunAgents, aiReady }: { ctx: RequestContext; orgId: string; companyId: string; projectId: string; base: string; locale: string; tz: string; t: Translate; canManage: boolean; canRunAgents: boolean; aiReady: boolean }) {
  const [d, clusterTasks] = await Promise.all([
    seoAutopilotData(ctx, orgId, companyId, projectId),
    db().agentTask.findMany({ where: { companyId, subjectType: "seo_project", subjectId: projectId, title: { startsWith: "Keyword clusters:" } }, orderBy: { createdAt: "desc" }, take: 3, select: { id: true, title: true, status: true, createdAt: true, output: true, errorCode: true } }),
  ]);
  const path = `${base}/seo/projects/${projectId}/autopilot`;
  return (
    <div className="grid gap-4">
      <Card variant="highlight">
        <CardHeader title={t("marketing.studio.seo.title")} description={t("marketing.studio.seo.hint")} />
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <div className="grid content-start gap-3">
            <p className="text-sm font-medium">{t("marketing.studio.seo.clusters")}</p>
            {canRunAgents && canManage ? <ActionButton path={path} body={{ action: "cluster" }} icon={<Sparkles aria-hidden />} label={t("marketing.studio.seo.makeClusters")} /> : null}
            <AiTaskList tasks={clusterTasks} locale={locale} tz={tz} t={t} aiReady={aiReady} showOutput={false} action={canManage ? (task) => <ActionButton path={path} body={{ action: "apply_clusters", taskId: task.id }} label={t("marketing.studio.seo.applyClusters")} /> : undefined} />
            {d.clusters.length === 0 ? <p className="text-xs text-muted-foreground">{t("marketing.studio.seo.noClusters")}</p> : null}
            <ul className="grid gap-2">
              {d.clusters.map((c) => (
                <li key={c.id} className="grid gap-1 rounded-md border p-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{c.name}</span>
                    {c.intent ? <Badge tone="info">{c.intent}</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("marketing.studio.seo.pillar")}: {c.pillarKeyword} · {t("marketing.studio.seo.keywordsN", { count: d.project.keywords.filter((k) => k.clusterId === c.id).length })}
                  </p>
                  {c.brief ? <p className="text-xs">{c.brief}</p> : null}
                  {canRunAgents && canManage ? <ActionButton path={path} body={{ action: "article", clusterId: c.id }} icon={<Sparkles aria-hidden />} label={t("marketing.studio.seo.writeArticle")} variant="ghost" /> : null}
                </li>
              ))}
            </ul>
            {canRunAgents && canManage ? <TextPrompt path={path} field="keyword" extra={{ action: "article" }} placeholder={t("marketing.studio.seo.articleFor")} submit={t("marketing.studio.seo.writeArticle")} /> : null}
          </div>
          <div className="grid content-start gap-3">
            <p className="text-sm font-medium">{t("marketing.studio.seo.articles")}</p>
            {d.articles.length === 0 ? <p className="text-xs text-muted-foreground">{t("marketing.studio.seo.noArticles")}</p> : null}
            <ul className="grid gap-1 text-sm">
              {d.articles.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <Link href={`/${locale}/marketing/content/${a.id}`} className="min-w-0 truncate hover:underline">
                    {a.title}
                  </Link>
                  <span className="text-xs text-muted-foreground">{t(`marketing.contentStatus.${a.status}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t("marketing.studio.seo.gsc")}
            description={d.gscConnected ? t("marketing.studio.seo.gscHint") : t("marketing.studio.seo.gscConnect")}
            actions={d.gscConnected && canManage ? <ActionButton path={path} body={{ action: "sync_search_console" }} icon={<RefreshCw aria-hidden />} label={t("marketing.studio.seo.sync")} /> : !d.gscConnected ? <Link href={`/${locale}/integrations/google_search_console`} className="text-xs underline">{t("marketing.common.openIntegrations")}</Link> : null}
          />
          <div className="grid gap-4 p-4">
            {d.pages.length ? (
              <BarChart label={t("marketing.studio.seo.topPages")} data={d.pages.slice(0, 10).map((p) => ({ label: p.page.replace(/^https?:\/\/[^/]+/, "") || "/", value: p._sum.clicks ?? 0 }))} />
            ) : (
              <p className="text-xs text-muted-foreground">{t("marketing.studio.seo.noData")}</p>
            )}
            {d.queries.length ? (
              <ul className="grid gap-1 text-xs">
                {d.queries.slice(0, 12).map((q) => (
                  <li key={q.query} className="flex justify-between gap-2">
                    <span className="truncate">{q.query}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {q._sum.clicks ?? 0} / {q._sum.impressions ?? 0} · #{(q._avg.position ?? 0).toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Card>
        <Card>
          <CardHeader title={t("marketing.studio.seo.gaps")} description={t("marketing.studio.seo.gapsHint")} />
          <div className="grid gap-3 p-4 text-sm">
            {d.gaps.length === 0 ? <p className="text-xs text-muted-foreground">{t("marketing.studio.seo.noGaps")}</p> : null}
            <ul className="grid gap-1">
              {d.gaps.map((g) => (
                <li key={`${g.kind}-${g.term}`} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <Badge>{t(`marketing.studio.seo.gapKind.${g.kind}`)}</Badge> {g.term}
                    {g.detail ? <span className="text-xs text-muted-foreground"> · {g.detail}</span> : null}
                  </span>
                  {canRunAgents && canManage ? <ActionButton path={path} body={{ action: "article", keyword: g.term.slice(0, 200) }} label={t("marketing.studio.seo.cover")} variant="ghost" /> : null}
                </li>
              ))}
            </ul>
            <p className="pt-2 font-medium">{t("marketing.studio.seo.refresh")}</p>
            {d.refresh.length === 0 ? <p className="text-xs text-muted-foreground">{t("marketing.studio.seo.noRefresh")}</p> : null}
            <ul className="grid gap-1 text-xs">
              {d.refresh.map((r) => (
                <li key={r.url}>
                  {r.url} — {r.reason}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
}
