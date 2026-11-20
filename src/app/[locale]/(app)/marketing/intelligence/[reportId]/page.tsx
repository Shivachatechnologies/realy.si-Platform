import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Lightbulb, RotateCcw, Trash2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { LoadingSequence } from "@/components/motion/loading-sequence";
import { MarketingShell, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { AiTaskList } from "@/components/marketing/ai-tasks";
import { ActionButton } from "@/components/marketing/ui";
import { FindingToContent, KeywordsToSeo } from "@/components/marketing/research-actions";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { listProjects } from "@/server/modules/marketing/seo";
import { getResearchReport, ingestResearchTask, parseFindings, parseSources, RESEARCH_SUBJECT } from "@/server/modules/marketing/research-reports";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.intelligence.detail.title") };
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function Refs({ refs, max }: { refs: number[]; max: number }) {
  const valid = refs.filter((n) => n >= 1 && n <= max);
  if (!valid.length) return null;
  return (
    <span className="ms-1 inline-flex flex-wrap gap-0.5 align-middle">
      {valid.slice(0, 6).map((n) => (
        <a key={n} href={`#src-${n}`} className="rounded bg-accent px-1 font-mono text-[10px] text-primary hover:underline">
          {n}
        </a>
      ))}
    </span>
  );
}

export default async function ResearchReportPage({ params }: PageProps<"/[locale]/marketing/intelligence/[reportId]">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const back = { href: `/${locale}/marketing/intelligence`, label: t("marketing.intelligence.title") };
  const shell = { locale, t, tab: "intelligence" as const, title: t("marketing.intelligence.detail.title"), back };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, tz, aiReady, canManage } = m;
  const { reportId } = await params;
  let r;
  try {
    r = await getResearchReport(viewer.ctx, org.id, company.id, reportId);
  } catch (err) {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  }
  if (r.status === "SYNTHESIZING" && r.taskId) {
    await ingestResearchTask(r.id, company.id, r.taskId);
    r = await getResearchReport(viewer.ctx, org.id, company.id, reportId);
  }
  const [tasks, projects] = await Promise.all([
    listSubjectTasks(viewer.ctx, org.id, company.id, RESEARCH_SUBJECT, r.id, 5).catch(() => []),
    r.kind === "KEYWORDS" && canManage ? listProjects(viewer.ctx, org.id, company.id) : Promise.resolve([]),
  ]);
  const f = parseFindings(r.findings);
  const sources = parseSources(r.sources);
  const path = `${base}/research/${r.id}`;
  const running = r.status === "RESEARCHING" || r.status === "SYNTHESIZING";
  const inputs = (r.inputs ?? {}) as { region?: string | null; competitors?: string[]; notes?: string | null };

  return (
    <MarketingShell
      {...shell}
      title={r.title}
      subtitle={t("marketing.intelligence.detail.subtitle", { kind: t(`marketing.intelligence.kind.${r.kind}`), date: formatDateTime(r.createdAt, locale, tz), provider: r.provider ?? "—" })}
      actions={
        canManage ? (
          <div className="flex flex-wrap gap-2">
            {!running ? <ActionButton path={`${path}/rerun`} label={t("marketing.intelligence.detail.rerun")} icon={<RotateCcw aria-hidden />} /> : null}
            {r.status === "READY" || r.status === "SOURCES_ONLY" ? (
              <Link href={`/${locale}/marketing/strategy?research=${r.id}`} className="inline-flex h-8 items-center rounded-md border px-3 text-sm hover:bg-muted">
                {t("marketing.intelligence.detail.usePlan")}
              </Link>
            ) : null}
            <ActionButton path={path} method="DELETE" variant="ghost" label={t("marketing.common.archive")} icon={<Trash2 aria-hidden />} confirm={t("marketing.common.confirmArchive")} redirectTo={back.href} />
          </div>
        ) : null
      }
    >
      <AutoRefresh active={running} intervalMs={4000} />
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={r.status} label={t(`marketing.intelligence.status.${r.status}`)} />
        <span className="text-xs text-muted-foreground">{t(`marketing.intelligence.statusHint.${r.status}`)}</span>
      </div>
      {r.status === "CREDENTIAL_REQUIRED" ? (
        <Notice tone="warning">
          {t("marketing.intelligence.credentialRequired")}{" "}
          <Link href={`/${locale}/integrations`} className="font-medium underline">
            {t("marketing.common.openIntegrations")}
          </Link>
        </Notice>
      ) : null}
      {r.status === "FAILED" && r.error ? <Notice tone="danger">{t("marketing.intelligence.detail.failed", { error: r.error })}</Notice> : null}
      {r.error === "ai_output_unstructured" ? <Notice tone="info">{t("marketing.intelligence.detail.unstructured")}</Notice> : null}
      {running ? (
        <Card className="p-4">
          <LoadingSequence title={t(`marketing.intelligence.status.${r.status}`)} current={r.status === "RESEARCHING" ? 0 : 2} steps={[t("marketing.intelligence.detail.stepSearch", { count: r.queries.length }), t("marketing.intelligence.detail.stepSources", { count: sources.length }), t("marketing.intelligence.detail.stepSynthesize")]} />
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          {r.summary ? (
            <Card className="p-5">
              <p className="eyebrow-rule mb-2">{t("marketing.intelligence.detail.summary")}</p>
              <p className="whitespace-pre-wrap font-display text-lg leading-relaxed">{r.summary}</p>
            </Card>
          ) : null}
          {f?.insights.length ? (
            <Card>
              <CardHeader title={t("marketing.intelligence.detail.insights")} />
              <ol className="grid gap-3 p-4">
                {f.insights.map((i, idx) => (
                  <li key={idx} className="grid gap-1 rounded-lg border bg-surface p-3">
                    <p className="font-medium">
                      <span className="me-2 font-mono text-xs text-primary">{String(idx + 1).padStart(2, "0")}</span>
                      {i.title}
                      <Refs refs={i.sources} max={sources.length} />
                    </p>
                    {i.detail ? <p className="text-sm text-muted-foreground">{i.detail}</p> : null}
                    {canManage ? <FindingToContent path={path} section="insights" index={idx} locale={locale} /> : null}
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}
          {f?.trends?.length ? (
            <Card>
              <CardHeader title={t("marketing.intelligence.detail.trends")} />
              <ul className="grid gap-3 p-4 sm:grid-cols-2">
                {f.trends.map((x, idx) => (
                  <li key={idx} className="grid content-start gap-1 rounded-lg border bg-surface p-3">
                    <p className="font-medium">
                      {x.topic}
                      <Refs refs={x.sources} max={sources.length} />
                    </p>
                    <p className="text-sm text-muted-foreground">{x.why}</p>
                    {x.contentIdea ? <p className="flex gap-1.5 text-xs"><Lightbulb className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />{x.contentIdea}</p> : null}
                    {canManage ? <FindingToContent path={path} section="trends" index={idx} locale={locale} /> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {f?.competitors?.length ? (
            <Card>
              <CardHeader title={t("marketing.intelligence.detail.competitors")} />
              <ul className="grid gap-3 p-4 md:grid-cols-2">
                {f.competitors.map((c, idx) => (
                  <li key={idx} className="grid content-start gap-2 rounded-lg border bg-surface p-3">
                    <p className="flex items-center justify-between gap-2 font-medium">
                      <span>
                        {c.name}
                        <Refs refs={c.sources} max={sources.length} />
                      </span>
                      {c.url && /^https?:\/\//.test(c.url) ? (
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" aria-label={c.name}>
                          <ExternalLink className="size-4" aria-hidden />
                        </a>
                      ) : null}
                    </p>
                    {c.positioning ? <p className="text-sm text-muted-foreground">{c.positioning}</p> : null}
                    {c.pricing ? <p className="text-xs">{t("marketing.intelligence.detail.pricing")}: {c.pricing}</p> : null}
                    <div className="grid gap-2 text-xs sm:grid-cols-2">
                      <div>
                        <p className="font-semibold text-success">{t("marketing.intelligence.detail.strengths")}</p>
                        <ul className="list-disc ps-4">{c.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                      </div>
                      <div>
                        <p className="font-semibold text-danger">{t("marketing.intelligence.detail.weaknesses")}</p>
                        <ul className="list-disc ps-4">{c.weaknesses.map((s, i) => <li key={i}>{s}</li>)}</ul>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {f?.personas?.length ? (
            <Card>
              <CardHeader title={t("marketing.intelligence.detail.personas")} />
              <ul className="grid gap-3 p-4 md:grid-cols-2">
                {f.personas.map((p, idx) => (
                  <li key={idx} className="grid content-start gap-2 rounded-lg border bg-surface p-3 text-sm">
                    <p className="font-display text-lg">{p.name}</p>
                    {(["goals", "pains", "channels", "objections"] as const).map((k) =>
                      p[k].length ? (
                        <div key={k}>
                          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t(`marketing.intelligence.detail.persona.${k}`)}</p>
                          <p>{p[k].join(" · ")}</p>
                        </div>
                      ) : null,
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {f?.keywords?.length ? (
            <Card>
              <CardHeader title={t("marketing.intelligence.detail.keywords")} description={t("marketing.intelligence.detail.keywordsHint")} actions={canManage ? <KeywordsToSeo path={path} projects={projects.map((p) => ({ id: p.id, name: p.name }))} /> : null} />
              <ul className="flex flex-wrap gap-2 p-4">
                {f.keywords.map((k, idx) => (
                  <li key={idx} className="rounded-full border bg-surface px-3 py-1 text-sm" title={k.rationale}>
                    {k.keyword}
                    {k.intent ? <span className="ms-2 text-[11px] text-muted-foreground">{t(`marketing.intelligence.detail.intent.${k.intent}`)}</span> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {f?.mentions?.length ? (
            <Card>
              <CardHeader title={t("marketing.intelligence.detail.mentions")} />
              <ul className="grid divide-y">
                {f.mentions.map((x, idx) => (
                  <li key={idx} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <StatusBadge status={x.sentiment === "positive" ? "ACTIVE" : x.sentiment === "negative" ? "FAILED" : "DRAFT"} label={t(`marketing.intelligence.detail.sentiment.${["positive", "negative"].includes(x.sentiment) ? x.sentiment : "neutral"}`)} />
                    <span className="min-w-0 flex-1 truncate">{x.title}</span>
                    {/^https?:\/\//.test(x.url) ? (
                      <a href={x.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" aria-label={x.title}>
                        <ExternalLink className="size-4" aria-hidden />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="grid content-start gap-4">
          {f && (f.opportunities.length || f.risks.length) ? (
            <Card className="p-4">
              {f.opportunities.length ? (
                <>
                  <p className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-success uppercase">{t("marketing.intelligence.detail.opportunities")}</p>
                  <ul className="mb-4 grid gap-2">
                    {f.opportunities.map((o, idx) => (
                      <li key={idx} className="grid gap-1 text-sm">
                        <span className="font-medium">{o.title}</span>
                        {o.detail ? <span className="text-muted-foreground">{o.detail}</span> : null}
                        {canManage ? <FindingToContent path={path} section="opportunities" index={idx} locale={locale} /> : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {f.risks.length ? (
                <>
                  <p className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-danger uppercase">{t("marketing.intelligence.detail.risks")}</p>
                  <ul className="grid gap-2">
                    {f.risks.map((o, idx) => (
                      <li key={idx} className="text-sm">
                        <span className="font-medium">{o.title}</span>
                        {o.detail ? <span className="block text-muted-foreground">{o.detail}</span> : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t("marketing.intelligence.detail.sources", { count: sources.length })} description={t("marketing.intelligence.detail.sourcesHint")} />
            {sources.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">{t("marketing.intelligence.detail.noSources")}</p>
            ) : (
              <ol className="grid divide-y">
                {sources.map((s, i) => (
                  <li key={s.url} id={`src-${i + 1}`} className="grid gap-0.5 px-4 py-2 text-sm target:bg-accent">
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 font-medium hover:underline">
                      <span className="font-mono text-xs text-primary">{i + 1}</span>
                      <span className="min-w-0 flex-1">{s.title || s.url}</span>
                      <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    </a>
                    <span className="line-clamp-2 ps-5 text-xs text-muted-foreground">{s.snippet}</span>
                    <span className="truncate ps-5 text-[11px] text-muted-foreground">{hostOf(s.url)}{s.publishedAt ? ` · ${s.publishedAt.slice(0, 10)}` : ""}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card className="p-4 text-xs text-muted-foreground">
            <p className="mb-1 font-semibold text-foreground">{t("marketing.intelligence.detail.queries")}</p>
            <ul className="list-disc ps-4">{r.queries.map((q) => <li key={q}>{q}</li>)}</ul>
            {inputs.notes ? <p className="mt-2">{t("marketing.intelligence.launcher.notes")}: {inputs.notes}</p> : null}
          </Card>
          <Card className="p-4">
            <p className="mb-2 text-sm font-medium">{t("marketing.intelligence.detail.aiWork")}</p>
            <AiTaskList tasks={tasks} locale={locale} tz={tz} t={t} aiReady={aiReady} showOutput={false} />
          </Card>
        </div>
      </div>
    </MarketingShell>
  );
}
