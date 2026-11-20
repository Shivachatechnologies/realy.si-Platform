import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AiRequest, ApplyAi } from "@/components/marketing/ai-panel";
import { AiTaskList } from "@/components/marketing/ai-tasks";
import { AuditForm, CompetitorForm, CompetitorNotes, KeywordForm, RankForm } from "@/components/marketing/seo-forms";
import { Kpi, MarketingShell, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { ActionButton } from "@/components/marketing/ui";
import { getT } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { getProject, seoReport } from "@/server/modules/marketing/seo";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.seo") };
}

export default async function SeoProjectPage({ params }: PageProps<"/[locale]/marketing/seo/[projectId]">) {
  const { projectId } = await params;
  const m = await loadMarketing();
  const { locale, t } = m;
  const back = { href: `/${locale}/marketing/seo`, label: t("marketing.seo.title") };
  if (m.blocked) return <MarketingShell locale={locale} t={t} tab="seo" title={t("marketing.seo.title")} back={back} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, canRunAgents, tz } = m;
  const p = await getProject(viewer.ctx, org.id, company.id, projectId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const tasks = await listSubjectTasks(viewer.ctx, org.id, company.id, "seo_project", p.id, 20).catch(() => []);
  const r = seoReport(p);
  const path = `${base}/seo/projects/${p.id}`;
  const kwTasks = tasks.filter((x) => x.title.startsWith("Keyword ideas:"));
  const briefTasks = tasks.filter((x) => x.title.startsWith("Content brief:"));
  const reportTasks = tasks.filter((x) => x.title.startsWith("SEO report:"));
  const manage = canManage && !p.archivedAt;

  return (
    <MarketingShell
      locale={locale}
      t={t}
      tab="seo"
      back={back}
      title={p.name}
      subtitle={p.domain}
      actions={manage ? <ActionButton path={path} method="DELETE" variant="ghost" label={t("marketing.common.archive")} confirm={t("marketing.common.confirmArchive")} redirectTo={back.href} /> : null}
    >
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label={t("marketing.seo.tracked")} value={r.trackedCount} />
        <Kpi label={t("marketing.seo.top3")} value={r.top3} />
        <Kpi label={t("marketing.seo.top10")} value={r.top10} />
        <Kpi label={t("marketing.seo.avgRank")} value={r.avgRank ?? "—"} />
        <Kpi label={t("marketing.seo.lastScore")} value={r.latestScore ?? "—"} />
        <Kpi label={t("marketing.seo.avgScore")} value={r.avgScore ?? "—"} />
      </div>

      <Card>
        <CardHeader title={t("marketing.seo.keywordResearch")} description={t("marketing.seo.keywordResearchHint")} />
        {manage ? <KeywordForm base={base} projectId={p.id} /> : null}
        {p.keywords.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("marketing.seo.noKeywords")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("marketing.seo.keyword")}</Th>
                <Th>{t("marketing.seo.intent")}</Th>
                <Th className="text-end">{t("marketing.seo.volume")}</Th>
                <Th className="text-end">{t("marketing.seo.difficulty")}</Th>
                <Th className="text-end">{t("marketing.seo.rank")}</Th>
                <Th>{t("marketing.seo.history")}</Th>
                {manage ? <Th>{t("common.actions")}</Th> : null}
              </Tr>
            </THead>
            <TBody>
              {p.keywords.map((k) => {
                const delta = k.previousRank != null && k.currentRank != null ? k.previousRank - k.currentRank : null;
                return (
                  <Tr key={k.id}>
                    <Td>
                      <span className="font-medium">{k.keyword}</span>
                      {k.source === "ai" ? <span className="ms-2 text-[10px] text-muted-foreground">AI</span> : null}
                      {k.targetUrl ? <p className="max-w-xs truncate text-[11px] text-muted-foreground">{k.targetUrl}</p> : null}
                    </Td>
                    <Td className="text-xs">{k.intent ? t(`marketing.seo.intents.${k.intent}`) : "—"}</Td>
                    <Td className="text-end tabular-nums">{k.searchVolume ?? "—"}</Td>
                    <Td className="text-end tabular-nums">{k.difficulty ?? "—"}</Td>
                    <Td className="text-end tabular-nums">
                      {k.tracked ? (k.currentRank ?? (k.rankedAt ? t("marketing.seo.notRanking") : "—")) : <span className="text-xs text-muted-foreground">{t("marketing.seo.untracked")}</span>}
                      {delta ? <span className={`ms-1 text-[11px] ${delta > 0 ? "text-success" : "text-danger"}`}>{delta > 0 ? `▲${delta}` : `▼${-delta}`}</span> : null}
                    </Td>
                    <Td className="text-[11px] text-muted-foreground">
                      {k.ranks
                        .slice()
                        .reverse()
                        .map((s) => s.rank ?? "–")
                        .join(" → ") || "—"}
                    </Td>
                    {manage ? (
                      <Td>
                        <div className="flex flex-wrap items-center gap-1">
                          <RankForm base={base} keywordId={k.id} />
                          <ActionButton path={`${base}/seo/keywords/${k.id}`} method="PATCH" body={{ tracked: !k.tracked }} variant="ghost" label={k.tracked ? t("marketing.seo.untrack") : t("marketing.seo.track")} />
                          <ActionButton path={`${base}/seo/keywords/${k.id}`} method="DELETE" variant="ghost" icon={<Trash2 aria-hidden />} label={<span className="sr-only">{t("marketing.common.delete")}</span>} confirm={t("marketing.common.confirmDelete")} />
                        </div>
                      </Td>
                    ) : null}
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
        <div className="grid gap-3 border-t p-4">
          <p className="text-sm font-medium">{t("marketing.ai.keywordIdeas")}</p>
          {canRunAgents && manage ? <AiRequest path={`${path}/ai`} kind="seo_keywords" label={t("marketing.ai.suggestKeywords")} notePlaceholder={t("marketing.ai.notePlaceholder")} /> : null}
          <AiTaskList
            tasks={kwTasks}
            locale={locale}
            tz={tz}
            t={t}
            aiReady={m.aiReady}
            action={manage ? (task) => <ApplyAi path={`${path}/apply-ai`} taskId={task.id} target="keywords" label={t("marketing.ai.addKeywords")} /> : undefined}
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("marketing.seo.audits")} description={t("marketing.seo.auditsHint")} />
          {manage ? <AuditForm base={base} projectId={p.id} domain={p.domain} /> : null}
          {p.audits.length === 0 ? (
            <p className="p-4 text-muted-foreground">{t("marketing.seo.noAudits")}</p>
          ) : (
            <ul className="grid divide-y">
              {p.audits.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <div className="min-w-0">
                    <Link href={`/${locale}/marketing/seo/${p.id}/audits/${a.id}`} className="block truncate hover:underline">
                      {a.url}
                    </Link>
                    <span className="text-xs text-muted-foreground">{formatDateTime(a.createdAt, locale, tz)}</span>
                  </div>
                  {a.status === "COMPLETED" ? (
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{t("marketing.seo.issuesCount", { count: (a.issues as unknown[]).length })}</span>
                      <StatusBadge status={(a.score ?? 0) >= 80 ? "ACTIVE" : (a.score ?? 0) >= 50 ? "PAUSED" : "FAILED"} label={String(a.score)} />
                    </span>
                  ) : (
                    <StatusBadge status="FAILED" label={t(`marketing.seo.auditErrors.${a.error ?? "fetch_failed"}`)} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={t("marketing.seo.competitors")} description={t("marketing.seo.competitorsHint")} />
          {manage ? <CompetitorForm base={base} projectId={p.id} /> : null}
          {p.competitors.length === 0 ? (
            <p className="p-4 text-muted-foreground">{t("marketing.seo.noCompetitors")}</p>
          ) : (
            <ul className="grid divide-y">
              {p.competitors.map((c) => (
                <li key={c.id} className="grid gap-2 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <a href={`https://${c.domain}`} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                      {c.domain}
                    </a>
                    {manage ? <ActionButton path={`${base}/seo/competitors/${c.id}`} method="DELETE" variant="ghost" icon={<Trash2 aria-hidden />} label={<span className="sr-only">{t("marketing.common.delete")}</span>} confirm={t("marketing.common.confirmDelete")} /> : null}
                  </div>
                  {manage ? <CompetitorNotes base={base} competitorId={c.id} notes={c.notes ?? ""} /> : c.notes ? <p className="whitespace-pre-wrap text-xs text-muted-foreground">{c.notes}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("marketing.seo.briefs")} description={t("marketing.seo.briefsHint")} />
          <div className="grid gap-3 p-4">
            {canRunAgents && manage ? <AiRequest path={`${path}/ai`} kind="seo_brief" label={t("marketing.ai.writeBrief")} notePlaceholder={t("marketing.seo.briefTopic")} noteRequired /> : null}
            <AiTaskList
              tasks={briefTasks}
              locale={locale}
              tz={tz}
              t={t}
              aiReady={m.aiReady}
              action={manage ? (task) => <ApplyAi path={`${path}/apply-ai`} taskId={task.id} target="content" contentType="BLOG" label={t("marketing.ai.briefToContent")} /> : undefined}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title={t("marketing.seo.report")} description={t("marketing.seo.reportHint")} />
          <div className="grid gap-3 p-4 text-sm">
            <dl className="grid grid-cols-2 gap-2">
              <dt className="text-muted-foreground">{t("marketing.seo.ranking")}</dt>
              <dd className="tabular-nums">
                {r.rankedCount} / {r.trackedCount}
              </dd>
              <dt className="text-muted-foreground">{t("marketing.seo.top100")}</dt>
              <dd className="tabular-nums">{r.top100}</dd>
            </dl>
            {r.movers.length ? (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">{t("marketing.seo.movers")}</p>
                <ul className="grid gap-1 text-xs">
                  {r.movers.map((x) => (
                    <li key={x.keyword} className="flex justify-between gap-2">
                      <span className="truncate">{x.keyword}</span>
                      <span className={x.delta > 0 ? "text-success" : "text-danger"}>
                        {x.from} → {x.to}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {canRunAgents ? <AiRequest path={`${path}/ai`} kind="seo_report" label={t("marketing.ai.writeReport")} /> : null}
            <AiTaskList tasks={reportTasks} locale={locale} tz={tz} t={t} aiReady={m.aiReady} />
            <p className="text-[11px] text-muted-foreground">{t("marketing.seo.reportDate", { date: formatDate(new Date(), locale, tz) })}</p>
          </div>
        </Card>
      </div>
    </MarketingShell>
  );
}
