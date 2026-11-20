import type { Metadata } from "next";
import Link from "next/link";
import { Activity, AlarmClock, HeartPulse, OctagonAlert, Sparkles } from "lucide-react";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { workflowsPage } from "@/components/automation/frame";
import { duration } from "@/components/automation/labels";
import { RunChart } from "@/components/automation/run-chart";
import { DeadLetterActions } from "@/components/automation/workflow-forms";
import { SmartEmpty } from "@/components/guide-kit/smart-empty";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { formatRelativeTime } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { MONITOR_DAYS, monitorOverview, type Health } from "@/server/modules/automation/monitor";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workflows.tabs.monitor") };
}

const HEALTH_TONE: Record<Health, "success" | "warning" | "danger" | "neutral"> = { healthy: "success", degraded: "warning", failing: "danger", idle: "neutral" };
const DOT: Record<string, string> = { SUCCEEDED: "bg-success", FAILED: "bg-danger", WAITING: "bg-warning", RUNNING: "bg-primary", QUEUED: "bg-muted-foreground/50", CANCELLED: "bg-muted-foreground/30" };

export default async function MonitorPage() {
  const p = await workflowsPage("monitor");
  if (p.page) return p.page;
  const { locale, t, viewer, org, company, base, canExecute, canManage } = p.ctx;
  const m = await monitorOverview(viewer.ctx, org.id, company.id);
  const alertCount = m.alerts.deadLetters.length + m.alerts.oldApprovals.length + m.alerts.stuck.length;
  const counts = { failing: 0, degraded: 0, healthy: 0, idle: 0 } as Record<Health, number>;
  for (const w of m.workflows) counts[w.health]++;

  if (!m.workflows.length && !m.totals.runs) {
    return p.render(
      <Card>
        <CardBody>
          <SmartEmpty
            icon={<HeartPulse />}
            title={t("workflows.monitor.emptyTitle")}
            body={t("workflows.monitor.emptyBody")}
            primary={canManage ? <Link href={`/${locale}/workflows/new`} className={buttonVariants({ size: "sm" })}><Sparkles aria-hidden /> {t("workflows.intro.list.next")}</Link> : undefined}
          />
        </CardBody>
      </Card>,
    );
  }

  return p.render(
    <>
      <AutoRefresh active={m.totals.waiting > 0 || m.alerts.stuck.length > 0} intervalMs={15000} />
      {/* Headline: health of the whole system in one sentence + four real numbers. */}
      <section className="grid gap-4 rounded-2xl border bg-surface p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid content-center gap-2">
          <p className="eyebrow-rule">{t("workflows.monitor.lastDays", { days: MONITOR_DAYS })}</p>
          <p className="font-display text-display-lg text-balance">
            {counts.failing ? t("workflows.monitor.headlineFailing", { count: counts.failing }) : counts.degraded ? t("workflows.monitor.headlineDegraded", { count: counts.degraded }) : t("workflows.monitor.headlineHealthy")}
          </p>
          <p className="text-sm text-muted-foreground">{t("workflows.monitor.headlineHint")}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4 lg:grid-cols-2">
          {[
            { k: "runs", v: m.totals.runs },
            { k: "successRate", v: m.totals.successRate === null ? "—" : `${m.totals.successRate}%` },
            { k: "failed", v: m.totals.failed },
            { k: "waitingApproval", v: m.totals.waitingApproval },
          ].map((x) => (
            <div key={x.k} className="grid gap-0.5">
              <dt className="text-xs text-muted-foreground">{t(`workflows.monitor.stats.${x.k}`)}</dt>
              <dd className="font-display text-2xl tabular-nums">{x.v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card variant="elevated">
          <CardHeader title={t("workflows.monitor.chartTitle")} description={m.totals.truncated ? t("workflows.monitor.truncated") : t("workflows.monitor.chartHint")} icon={<Activity />} />
          <CardBody>
            <RunChart days={m.days} />
          </CardBody>
        </Card>
        <Card variant={alertCount ? "highlight" : undefined}>
          <CardHeader title={t("workflows.monitor.alertsTitle")} description={alertCount ? t("workflows.monitor.alertsHint") : t("workflows.monitor.noAlerts")} icon={<OctagonAlert />} />
          <CardBody className="grid gap-3">
            {m.alerts.deadLetters.map((d) => (
              <div key={d.runId} className="grid gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/${locale}/workflows/runs/${d.runId}`} className="text-sm font-medium hover:underline">
                    {d.workflowName}
                  </Link>
                  <span className="text-xs text-muted-foreground">{formatRelativeTime(d.at, locale)}</span>
                </div>
                {d.error ? <p className="line-clamp-2 text-xs break-words text-muted-foreground">{d.error}</p> : null}
                {canExecute ? <DeadLetterActions base={base} runId={d.runId} /> : null}
              </div>
            ))}
            {m.alerts.oldApprovals.map((a) => (
              <Link key={a.id} href={`/${locale}/workflows/approvals`} className="flex items-start gap-2 rounded-lg border border-warning/35 bg-warning/5 p-3 text-sm hover:border-warning">
                <AlarmClock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <span className="min-w-0">
                  <span className="font-medium">{a.title}</span>
                  <span className="block text-xs text-muted-foreground">{t("workflows.monitor.approvalWaiting", { since: formatRelativeTime(a.since, locale) })}</span>
                </span>
              </Link>
            ))}
            {m.alerts.stuck.map((s) => (
              <Link key={s.runId} href={`/${locale}/workflows/runs/${s.runId}`} className="flex items-start gap-2 rounded-lg border p-3 text-sm hover:border-primary/40">
                <Activity className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0">
                  <span className="font-medium">{s.workflowName}</span>
                  <span className="block text-xs text-muted-foreground">{t("workflows.monitor.stuck", { since: formatRelativeTime(s.since, locale) })}</span>
                </span>
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t("workflows.monitor.healthTitle")} description={t("workflows.monitor.healthHint")} icon={<HeartPulse />} />
        <ul className="divide-y">
          {m.workflows.map((w) => (
            <li key={w.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/${locale}/workflows/${w.id}`} className="truncate font-medium hover:underline">
                    {w.name}
                  </Link>
                  <Badge tone={HEALTH_TONE[w.health]} shape="pill" pulse={w.health === "failing"}>
                    {t(`workflows.monitor.health.${w.health}`)}
                  </Badge>
                  {w.status === "PAUSED" ? <Badge tone="warning">{t("workflows.status.PAUSED")}</Badge> : null}
                </div>
                {w.lastFailure ? (
                  <p className="mt-1 line-clamp-1 text-xs break-words text-danger">
                    <Link href={`/${locale}/workflows/runs/${w.lastFailure.runId}`} className="hover:underline">
                      {t("workflows.monitor.lastFailure", { when: formatRelativeTime(w.lastFailure.at, locale) })}
                    </Link>
                    {w.lastFailure.error ? ` · ${w.lastFailure.error}` : ""}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">{w.lastRunAt ? t("workflows.monitor.lastRun", { when: formatRelativeTime(w.lastRunAt, locale) }) : t("workflows.monitor.noRuns")}</p>
                )}
              </div>
              <div className="flex items-center gap-1" aria-label={t("workflows.monitor.recentAria")}>
                {w.recent.length ? (
                  [...w.recent].reverse().map((s, i) => <span key={i} title={t(`workflows.runStatus.${s}`)} className={cn("h-5 w-2 rounded-full", DOT[s] ?? "bg-muted")} />)
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
              <dl className="flex gap-5 text-xs tabular-nums sm:justify-end">
                <div>
                  <dt className="text-muted-foreground">{t("workflows.monitor.stats.runs")}</dt>
                  <dd className="text-sm font-medium">{w.runs}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("workflows.monitor.stats.successRate")}</dt>
                  <dd className="text-sm font-medium">{w.successRate === null ? "—" : `${w.successRate}%`}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("workflows.monitor.avgTime")}</dt>
                  <dd className="text-sm font-medium">{w.avgMs === null ? "—" : duration(w.avgMs)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </Card>
    </>,
  );
}
