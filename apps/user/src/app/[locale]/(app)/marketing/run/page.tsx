import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, CalendarClock, CheckCircle2, CircleAlert, CircleDashed, Compass, ExternalLink, Image as ImageIcon, Lightbulb, Megaphone, PenLine, Send, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Badge } from "@/components/ui/badge";
import { MarketingShell, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { RunControls, RunLauncher } from "@/components/marketing/run-launcher";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { getT } from "@/i18n/server";
import { formatDateTime, formatMoney, formatNumber } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { db } from "@/server/core/db";
import { listRuns, runOverview, runReadiness } from "@/server/modules/marketing/run";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.run") };
}

const TERMINAL = new Set(["COMPLETED", "CANCELLED", "FAILED"]);
const SOCIAL = ["LINKEDIN", "X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK", "THREADS", "PINTEREST"] as const;

export default async function MarketingRunPage() {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "run" as const, title: t("marketing.run.title"), subtitle: t("marketing.run.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, tz, canManage, canRunAgents } = m;
  const [view, ready, runs, brand] = await Promise.all([
    runOverview(viewer.ctx, org.id, company.id),
    runReadiness(viewer.ctx, org.id, company.id),
    listRuns(viewer.ctx, org.id, company.id),
    db().marketingBrandKit.findFirst({ where: { companyId: company.id }, select: { personas: true } }),
  ]);
  const personas = Array.isArray(brand?.personas) ? (brand.personas as { name?: string; description?: string }[]).map((p) => [p.name, p.description].filter(Boolean).join(": ")).filter(Boolean).join("\n") : "";
  const money = (v: bigint | null) => (v == null ? "—" : formatMoney({ amountMinor: v, currency: company.baseCurrency }, locale));
  const n = (v: number) => formatNumber(v, locale);
  const run = view?.run ?? null;
  const showLauncher = !run || TERMINAL.has(run.status);
  const live = !!run && ["RESEARCHING", "PLANNING", "LAUNCHING"].includes(run.status);

  const checks: { key: string; ok: boolean; href: string; detail?: string }[] = [
    { key: "ai", ok: ready.ai, href: "/settings" },
    { key: "research", ok: !!ready.research, href: "/integrations", detail: ready.research ?? (ready.researchKeys.length ? t("marketing.run.ready.researchKeys", { keys: ready.researchKeys.join(" · ") }) : undefined) },
    { key: "social", ok: ready.social.length > 0, href: "/marketing/social", detail: ready.social.map((s) => `${t(`marketing.provider.${s.provider}`)} (${s.accounts})`).join(", ") || undefined },
    { key: "email", ok: ready.email, href: "/integrations" },
    { key: "blog", ok: true, href: ready.cms === "realy" ? "/marketing/blog" : "/integrations", detail: ready.cms === "realy" ? t("marketing.run.ready.realyBlog") : ready.cms },
    { key: "seo", ok: ready.seoProjects > 0, href: "/marketing/seo" },
    { key: "products", ok: ready.products.length > 0, href: "/products" },
  ];

  return (
    <MarketingShell {...shell}>
      <AutoRefresh active={live} intervalMs={10_000} />
      {ready.aiPaused ? (
        <Notice tone="warning" title={t("marketing.run.aiPaused.title")}>
          {t("marketing.run.aiPaused.body")}{" "}
          <Link href={`/${locale}/autonomy`} className="font-medium underline">
            {t("marketing.run.aiPaused.open")}
          </Link>
        </Notice>
      ) : null}
      {view && run ? (
        <>
          <section className="glass relative overflow-hidden rounded-xl border p-4 shadow-elev-1 sm:p-5" aria-labelledby="run-title">
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-brand-gradient opacity-70" />
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow-rule mb-1">{t("marketing.run.eyebrow")}</p>
                <h2 id="run-title" className="font-display text-display-lg">
                  {t(`marketing.run.status.${run.status}`)}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("marketing.run.startedAt", { date: formatDateTime(run.createdAt, locale, tz) })} · {t(`marketing.run.autonomy.${run.autonomy}.name`)}
                </p>
              </div>
              {canManage ? <RunControls path={`${base}/runs/${run.id}`} status={run.status} autonomy={run.autonomy} /> : null}
            </div>
            {run.blockedReason && run.status === "BLOCKED" ? (
              <Notice tone="warning" className="mt-3" title={t("marketing.run.blocked")}>
                {run.blockedReason}
              </Notice>
            ) : null}
            {run.status === "AWAITING_APPROVAL" && view.plan ? (
              <Notice tone="info" className="mt-3" title={t("marketing.run.approveTitle")} action={<Link className="text-sm font-medium underline" href={`/${locale}/marketing/strategy/${view.plan.id}`}>{t("marketing.run.approveCta")}</Link>}>
                {view.plan.reviewNote ? t("marketing.run.changesRequested", { note: view.plan.reviewNote }) : t("marketing.run.approveBody")}
              </Notice>
            ) : null}
          </section>

          <RunLoop
            t={t}
            locale={locale}
            stages={[
              { key: "research", icon: Compass, value: view.research.filter((r) => r.status === "READY" || r.status === "SOURCES_ONLY").length, total: view.research.length, href: "/marketing/intelligence", attention: view.research.some((r) => r.status === "CREDENTIAL_REQUIRED" || r.status === "FAILED") },
              { key: "strategy", icon: Lightbulb, value: view.plan ? view.plan.channels.length : 0, label: view.plan ? t(`marketing.run.planStatus.${view.plan.status}`) : undefined, href: view.plan ? `/marketing/strategy/${view.plan.id}` : "/marketing/strategy", attention: run.status === "AWAITING_APPROVAL" },
              { key: "campaign", icon: Megaphone, value: view.autopilots.length, label: view.campaign?.code, href: view.campaign ? `/marketing/campaigns/${view.campaign.id}` : "/marketing/campaigns" },
              { key: "calendar", icon: CalendarClock, value: view.counts.calendarSlots, href: "/marketing/calendar" },
              { key: "content", icon: PenLine, value: view.counts.ready + view.counts.scheduled + view.counts.published, pending: view.counts.ideas + view.counts.drafting, href: "/marketing/autopilot" },
              { key: "creatives", icon: ImageIcon, value: view.counts.creatives, href: "/marketing/studio" },
              { key: "publish", icon: Send, value: view.counts.published + view.counts.articlesPublished, pending: view.counts.scheduled, href: "/marketing/social", attention: view.counts.failed > 0 },
              { key: "metrics", icon: BarChart3, value: view.counts.withMetrics, label: n(view.counts.impressions), href: "/marketing/analytics" },
              { key: "optimize", icon: SlidersHorizontal, value: view.counts.optimizationsApplied, pending: view.counts.optimizationsProposed, href: "/marketing/optimize", attention: view.counts.optimizationsProposed > 0 },
            ]}
          />

          <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label={t("marketing.run.kpi.reach")} value={n(view.counts.reach || view.counts.impressions)} hint={t("marketing.run.kpi.impressions", { count: n(view.counts.impressions) })} />
            <Metric label={t("marketing.run.kpi.engagement")} value={n(view.counts.engagement)} hint={t("marketing.run.kpi.posts", { count: n(view.counts.published) })} />
            <Metric label={t("marketing.run.kpi.leads")} value={n(view.counts.leads)} hint={t("marketing.run.kpi.won", { count: n(view.counts.won) })} />
            <Metric label={t("marketing.run.kpi.cpl")} value={money(view.counts.cplMinor)} hint={t("marketing.run.kpi.spend", { amount: money(view.counts.spendMinor) })} />
            <Metric label={t("marketing.run.kpi.emails")} value={n(view.counts.emailsSent)} hint={view.counts.emailsSent ? t("marketing.run.kpi.opens", { opened: n(view.counts.emailsOpened), clicked: n(view.counts.emailsClicked) }) : undefined} />
            <Metric label={t("marketing.run.kpi.articles")} value={n(view.counts.articlesPublished)} hint={t("marketing.run.kpi.articlesWritten", { count: n(view.counts.articles) })} />
            <Metric label={t("marketing.run.kpi.newsletters")} value={n(view.counts.newsletters)} />
            <Metric label={t("marketing.run.kpi.optimizations")} value={n(view.counts.optimizationsApplied)} hint={t("marketing.run.kpi.proposed", { count: n(view.counts.optimizationsProposed) })} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader title={t("marketing.run.recentPosts")} description={t("marketing.run.recentPostsHint")} />
              {view.recentPosts.length ? (
                <ul className="grid divide-y text-sm">
                  {view.recentPosts.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                      <Badge>{t(`marketing.provider.${p.account.provider}`)}</Badge>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.publishedAt ? formatDateTime(p.publishedAt, locale, tz) : ""}</span>
                      <span className="tabular-nums text-xs text-muted-foreground">{p.metricsAt ? t("marketing.run.postMetrics", { impressions: n(p.impressions ?? 0), engagement: n((p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.clicks ?? 0)) }) : t("marketing.run.metricsPending")}</span>
                      {p.providerUrl ? (
                        <a href={p.providerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium hover:underline">
                          {t("marketing.run.viewPost")}
                          <ExternalLink className="size-3" aria-hidden />
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">{t("marketing.run.noPosts")}</p>
              )}
            </Card>
            <Card>
              <CardHeader title={t("marketing.run.autopilots")} />
              {view.autopilots.length ? (
                <ul className="grid divide-y text-sm">
                  {view.autopilots.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 px-4 py-2">
                      <Link href={`/${locale}/marketing/autopilot/${a.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                        {a.name}
                      </Link>
                      <StatusBadge status={a.status} label={t(`marketing.run.apStatus.${a.status}`)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">{t("marketing.run.noAutopilots")}</p>
              )}
              {run.artifacts.length ? (
                <ul className="grid divide-y border-t text-sm">
                  {run.artifacts
                    .slice(-6)
                    .reverse()
                    .map((a) => (
                      <li key={a.taskId} className="flex items-center gap-2 px-4 py-2">
                        <Badge tone="info">{t(`marketing.run.artifact.${a.kind}`)}</Badge>
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{t(`marketing.run.artifactState.${a.state}`)}</span>
                        {a.url ? (
                          <a href={a.url} target="_blank" rel="noreferrer" className="text-xs font-medium hover:underline">
                            {t("marketing.run.viewPost")}
                          </a>
                        ) : a.contentId ? (
                          <Link href={`/${locale}/marketing/content/${a.contentId}`} className="text-xs hover:underline">
                            {t("marketing.run.open")}
                          </Link>
                        ) : a.emailCampaignId ? (
                          <Link href={`/${locale}/marketing/email/${a.emailCampaignId}`} className="text-xs hover:underline">
                            {t("marketing.run.open")}
                          </Link>
                        ) : null}
                      </li>
                    ))}
                </ul>
              ) : null}
            </Card>
          </div>

          <Card>
            <CardHeader title={t("marketing.run.log")} description={t("marketing.run.logHint")} />
            <ol className="grid gap-0 p-4">
              {[...run.log].reverse().slice(0, 40).map((e, i) => {
                const Icon = e.outcome === "done" ? CheckCircle2 : e.outcome === "blocked" || e.outcome === "failed" ? CircleAlert : CircleDashed;
                return (
                  <li key={`${e.at}-${i}`} className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-3 pb-3 last:pb-0">
                    <Icon aria-hidden className={cn("mt-0.5 size-4", e.outcome === "done" ? "text-success" : e.outcome === "blocked" || e.outcome === "failed" ? "text-warning" : "text-muted-foreground")} />
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="me-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`marketing.run.step.${e.step}`)}</span>
                        {e.href ? (
                          <Link href={`/${locale}${e.href}`} className="hover:underline">
                            {e.detail}
                          </Link>
                        ) : (
                          e.detail
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(e.at, locale, tz)}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </>
      ) : null}

      <div className={cn("grid gap-4", showLauncher && "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]")}>
        {showLauncher ? (
          <Card className="p-4 sm:p-5">
            <h2 className="mb-1 font-display text-display">{t("marketing.run.form.title")}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{t("marketing.run.form.subtitle")}</p>
            {canManage && canRunAgents ? (
              <RunLauncher base={base} products={ready.products} currency={company.baseCurrency} defaultAudience={personas} />
            ) : (
              <Notice tone="info">{t("marketing.run.form.forbidden")}</Notice>
            )}
          </Card>
        ) : null}
        <Card>
          <CardHeader title={t("marketing.run.ready.title")} description={t("marketing.run.ready.subtitle")} />
          <ul className="grid divide-y text-sm">
            {checks.map((c) => (
              <li key={c.key} className="flex min-w-0 items-center gap-3 px-4 py-2.5">
                {c.ok ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden /> : <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{t(`marketing.run.ready.${c.key}`)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{c.detail ?? (c.ok ? t("marketing.run.ready.ok") : t(`marketing.run.ready.${c.key}Missing`))}</span>
                </span>
                <Link href={`/${locale}${c.href}`} className="shrink-0 text-xs hover:underline">
                  {c.ok ? t("marketing.run.open") : t("marketing.run.ready.connect")}
                </Link>
              </li>
            ))}
          </ul>
          <p className="flex items-start gap-2 border-t p-4 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("marketing.run.ready.safety")}
          </p>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">{t("marketing.run.ready.channels", { list: SOCIAL.map((p) => t(`marketing.provider.${p}`)).join(", ") })}</p>
        </Card>
      </div>

      {runs.length > 1 ? (
        <Card>
          <CardHeader title={t("marketing.run.history")} />
          <ul className="grid divide-y text-sm">
            {runs.slice(1).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <StatusBadge status={r.status} label={t(`marketing.run.status.${r.status}`)} />
                <span className="text-muted-foreground">{formatDateTime(r.createdAt, locale, tz)}</span>
                <span className="text-xs text-muted-foreground">{t(`marketing.run.autonomy.${r.autonomy}.name`)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </MarketingShell>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="grid content-start gap-1 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-display text-2xl tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

type LoopStage = { key: string; icon: typeof Compass; value: number; total?: number; pending?: number; label?: string; href: string; attention?: boolean };

/** The run as a left-to-right pipeline of real counts; wraps on small screens, mirrored for RTL by flow direction. */
function RunLoop({ stages, t, locale }: { stages: LoopStage[]; t: Awaited<ReturnType<typeof getT>>; locale: string }) {
  return (
    <section aria-label={t("marketing.run.loopTitle")}>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-9">
        {stages.map((s, i) => {
          const Icon = s.icon;
          const active = s.value > 0 || (s.pending ?? 0) > 0;
          return (
            <li key={s.key} className="relative min-w-0">
              <Link
                href={`/${locale}${s.href}`}
                className={cn(
                  "grid h-full gap-1 rounded-lg border bg-surface p-3 transition hover:shadow-elev-2 motion-reduce:transition-none",
                  active ? "border-primary/40" : "opacity-80",
                  s.attention && "border-warning/60",
                )}
              >
                <span className="flex items-center justify-between gap-1">
                  <Icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
                  <span className="text-[10px] tabular-nums text-muted-foreground">{i + 1}</span>
                </span>
                <span className="text-xs font-medium">{t(`marketing.run.stage.${s.key}`)}</span>
                <span className="font-display text-xl tabular-nums">
                  {formatNumber(s.value, locale)}
                  {s.total != null ? <span className="text-sm text-muted-foreground">/{formatNumber(s.total, locale)}</span> : null}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">{s.label ?? (s.pending ? t("marketing.run.inProgress", { count: s.pending }) : " ")}</span>
                {s.attention ? <span className="sr-only">{t("marketing.lifecycle.needsYou")}</span> : null}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
