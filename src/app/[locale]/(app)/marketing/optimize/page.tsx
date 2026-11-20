import type { Metadata } from "next";
import Link from "next/link";
import { Brain, CalendarClock, Gauge, Megaphone, PauseCircle, RefreshCcw, Shuffle, SlidersHorizontal, Wallet } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { MarketingShell, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { HelpPanel, InfoStrip } from "@/components/marketing/studio";
import { AiTaskList } from "@/components/marketing/ai-tasks";
import { ActionButton } from "@/components/marketing/ui";
import { OptimizationDecision } from "@/components/marketing/optimization-decision";
import { SmartEmpty } from "@/components/guide-kit/smart-empty";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { enumParam } from "@/server/modules/marketing/common";
import { listHelpTasks } from "@/server/modules/marketing/intelligence";
import { listLearnings } from "@/server/modules/marketing/learning";
import { listRecommendations } from "@/server/modules/marketing/recommendations";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { ingestOptimizationReview, listOptimizations, OPTIMIZATION_REVIEW_SUBJECT, OPTIMIZATION_STATUSES } from "@/server/modules/marketing/optimizations";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.optimize") };
}

const KIND_ICON: Record<string, typeof Gauge> = { retry_failed_post: RefreshCcw, pause_ad: PauseCircle, ad_budget: Wallet, autopilot_windows: CalendarClock, shift_cadence: Shuffle };

function EvidenceView({ evidence }: { evidence: unknown }) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const rows = Object.entries(evidence as Record<string, unknown>).slice(0, 10);
  if (!rows.length) return null;
  const show = (v: unknown): string => (v == null ? "—" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : v < 1 ? `${(v * 100).toFixed(1)}%` : v.toFixed(2)) : typeof v === "string" ? v : JSON.stringify(v).slice(0, 160));
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-muted/40 p-2 text-[11px] sm:grid-cols-3">
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="truncate text-muted-foreground">{k}</dt>
          <dd className="truncate font-medium tabular-nums">{show(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function MarketingOptimizePage({ searchParams }: PageProps<"/[locale]/marketing/optimize">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "optimize" as const, title: t("marketing.optimize.title"), subtitle: t("marketing.optimize.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, tz, aiReady, canManage, canRunAgents } = m;
  const sp = await searchParams;
  const status = enumParam(sp, "status", OPTIMIZATION_STATUSES) ?? "PROPOSED";
  // Fallback for a missed task event: proposals of finished AI reviews are deduplicated, so this is idempotent.
  const recentReviews = await listSubjectTasks(viewer.ctx, org.id, company.id, OPTIMIZATION_REVIEW_SUBJECT, company.id, 3).catch(() => []);
  for (const r of recentReviews) if (r.status === "COMPLETED") await ingestOptimizationReview(company.id, r.id);
  const [opt, learnings, recs, reviews, help] = await Promise.all([
    listOptimizations(viewer.ctx, org.id, company.id, status),
    listLearnings(viewer.ctx, org.id, company.id),
    listRecommendations(viewer.ctx, org.id, company.id, "OPEN", 8),
    Promise.resolve(recentReviews),
    listHelpTasks(org.id, company.id, "optimize"),
  ]);
  const c = opt.counts;

  return (
    <MarketingShell
      {...shell}
      actions={
        canManage ? (
          <div className="flex flex-wrap gap-2">
            <ActionButton path={`${base}/optimizations`} label={t("marketing.optimize.checkNow")} icon={<Gauge aria-hidden />} variant="default" />
            {canRunAgents ? <ActionButton path={`${base}/optimizations/ai-review`} label={t("marketing.optimize.aiReview")} icon={<Brain aria-hidden />} /> : null}
          </div>
        ) : null
      }
    >
      <InfoStrip t={t} k="optimize" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t("marketing.optimize.stats.proposed")} value={c.PROPOSED ?? 0} href={`/${locale}/marketing/optimize?status=PROPOSED`} icon={<SlidersHorizontal />} highlight={(c.PROPOSED ?? 0) > 0} index={0} />
        <StatTile label={t("marketing.optimize.stats.applied")} value={c.APPLIED ?? 0} href={`/${locale}/marketing/optimize?status=APPLIED`} index={1} />
        <StatTile label={t("marketing.optimize.stats.failed")} value={c.FAILED ?? 0} href={`/${locale}/marketing/optimize?status=FAILED`} index={2} />
        <StatTile label={t("marketing.optimize.stats.learnings")} value={learnings.length} href={`/${locale}/marketing/analytics`} index={3} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t("marketing.optimize.proposals")} description={t("marketing.optimize.proposalsHint")} />
          <nav className="flex flex-wrap gap-1 border-b px-3 pb-2 text-xs" aria-label={t("marketing.optimize.proposals")}>
            {OPTIMIZATION_STATUSES.map((s) => (
              <Link key={s} href={`/${locale}/marketing/optimize?status=${s}`} aria-current={s === status ? "page" : undefined} className={cn("rounded-full px-3 py-1.5", s === status ? "bg-accent font-medium" : "text-muted-foreground hover:bg-muted")}>
                {t(`marketing.optimize.status.${s}`)} <span className="tabular-nums">{c[s] ?? 0}</span>
              </Link>
            ))}
          </nav>
          {opt.data.length === 0 ? (
            <div className="p-4">
              <SmartEmpty icon={<SlidersHorizontal aria-hidden />} title={t(status === "PROPOSED" ? "marketing.optimize.emptyTitle" : "marketing.optimize.emptyOther")} body={t("marketing.optimize.emptyBody")} />
            </div>
          ) : (
            <ul className="grid gap-3 p-3">
              {opt.data.map((o) => {
                const Icon = KIND_ICON[o.kind] ?? Megaphone;
                return (
                  <li key={o.id} className="grid gap-2 rounded-lg border bg-surface p-3 shadow-elev-1">
                    <div className="flex flex-wrap items-start gap-2">
                      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-primary">
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{o.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {t(`marketing.optimize.kind.${o.kind}`)} · {formatDateTime(o.createdAt, locale, tz)}
                        </p>
                      </div>
                      <Badge tone={o.source === "ai" ? "accent" : "neutral"}>{t(`marketing.optimize.source.${o.source === "ai" ? "ai" : "rules"}`)}</Badge>
                      <StatusBadge status={o.status} label={t(`marketing.optimize.status.${o.status}`)} />
                    </div>
                    <p className="text-sm">{o.rationale}</p>
                    <EvidenceView evidence={o.evidence} />
                    {o.status === "FAILED" && o.error ? <p className="text-xs text-danger">{t("marketing.optimize.failedWith", { error: o.error })}</p> : null}
                    {o.status === "REJECTED" && o.error ? <p className="text-xs text-muted-foreground">{t("marketing.optimize.rejectedWith", { note: o.error })}</p> : null}
                    {o.status === "APPLIED" && o.appliedAt ? <p className="text-xs text-success">{t("marketing.optimize.appliedAt", { date: formatDateTime(o.appliedAt, locale, tz) })}</p> : null}
                    {canManage && (o.status === "PROPOSED" || o.status === "FAILED") ? <OptimizationDecision path={`${base}/optimizations/${o.id}`} retry={o.status === "FAILED"} /> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("marketing.optimize.learnings")} description={t("marketing.optimize.learningsHint")} />
            {learnings.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">{t("marketing.optimize.noLearnings")}</p>
            ) : (
              <ul className="grid gap-2 p-4 text-sm">
                {learnings.slice(0, 10).map((l) => (
                  <li key={l.id} className="flex gap-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                    <span>{l.insight}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {recs.length ? (
            <Card>
              <CardHeader title={t("marketing.optimize.recommendations")} />
              <ul className="grid divide-y text-sm">
                {recs.map((r) => (
                  <li key={r.id} className="grid gap-1 px-4 py-2">
                    <span className="font-medium">{r.title}</span>
                    {r.detail ? <span className="text-xs text-muted-foreground">{r.detail}</span> : null}
                    <span className="flex flex-wrap gap-2">
                      {r.href ? (
                        <Link href={`/${locale}${r.href}`} className="text-xs text-primary hover:underline">
                          {t("marketing.optimize.open")}
                        </Link>
                      ) : null}
                      {canManage ? <ActionButton path={`${base}/recommendations/${r.id}`} body={{ status: "DONE" }} label={t("marketing.studio.next.done")} variant="ghost" /> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card className="p-4">
            <p className="mb-2 text-sm font-medium">{t("marketing.optimize.aiReviews")}</p>
            <AiTaskList tasks={reviews} locale={locale} tz={tz} t={t} aiReady={aiReady} showOutput={false} />
          </Card>
        </div>
      </div>
      <HelpPanel t={t} base={base} page="optimize" tasks={help} locale={locale} tz={tz} aiReady={aiReady} canRun={canRunAgents} />
    </MarketingShell>
  );
}
