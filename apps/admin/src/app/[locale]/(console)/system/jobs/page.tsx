import Link from "next/link";
import { Activity, Inbox, Layers, ListChecks, ScrollText, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { LiveDot } from "@/components/motion/live-dot";
import { AdminHeader, EmptyState, guard, NextPage, QuickFilters, sp } from "@/components/admin/kit";
import { AutoRefresh, BarList } from "@/components/admin/viz";
import { DeadJobActions } from "@/components/admin/job-actions";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { getJobRun, JOB_MANAGE_PERM, jobsOverview, listJobRuns, WORKER_JOB_STATUSES } from "@/server/core/job-admin";
import { WORKER_QUEUES } from "@/server/core/jobs";
import { requestTime, requireViewer } from "@/server/session";

const TONE = { ACTIVE: "info", RETRYING: "warning", SUCCEEDED: "success", FAILED: "danger", DEAD: "danger", REQUEUED: "neutral" } as const;
type Status = (typeof WORKER_JOB_STATUSES)[number];

/**
 * Admin → System → Background jobs: worker liveness, queue depths, persisted job runs with their execution log and the
 * dead-letter queue (requeue / discard with an audited reason). Job payloads are never shown.
 */
export default async function SystemJobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const params = await searchParams;
  const status = WORKER_JOB_STATUSES.find((s) => s === sp(params.status)) as Status | undefined;
  const queue = WORKER_QUEUES.find((q) => q.name === sp(params.queue))?.name;
  const cursor = sp(params.cursor);
  const runId = sp(params.run);
  const r = await guard(jobsOverview(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const overview = r.value;
  const [runs, detail, canManage] = await Promise.all([
    listJobRuns(viewer.ctx, { status, queue, cursor: cursor && /^[0-9a-f-]{36}$/i.test(cursor) ? cursor : undefined, limit: 30 }),
    runId ? getJobRun(viewer.ctx, runId).catch(() => null) : Promise.resolve(null),
    canPlatform(viewer.ctx, JOB_MANAGE_PERM),
  ]);
  const tz = viewer.user.timezone;
  const now = requestTime();
  const n = (v: number) => formatNumber(v, locale);
  const base = `/${locale}/system/jobs`;
  const qs = (extra: Record<string, string | undefined>) => {
    const entries: [string, string | undefined][] = Object.entries({ status, queue, ...extra });
    const s = new URLSearchParams(entries.filter((e): e is [string, string] => !!e[1])).toString();
    return s ? `${base}?${s}` : base;
  };
  const requeueable = (q: string) => WORKER_QUEUES.find((w) => w.name === q)?.requeueable === true;
  const logs = detail && Array.isArray(detail.logs) ? (detail.logs as { at?: string; level?: string; message?: string }[]) : [];

  return (
    <div className="grid gap-4">
      <AdminHeader
        icon={<Layers />}
        title={t("admin.system.jobs.title")}
        description={t("admin.system.jobs.subtitle")}
        why={t("admin.system.jobs.why")}
        actions={<AutoRefresh loadedAt={now} timeZone={tz} label={t("admin.live.on")} pausedLabel={t("admin.live.paused")} pauseLabel={t("admin.live.pause")} resumeLabel={t("admin.live.resume")} />}
      />
      <Link href={`/${locale}/system`} className="text-sm text-muted-foreground hover:underline">
        ← {t("admin.nav.system")}
      </Link>
      {overview.worker.state !== "ok" ? (
        <Notice tone={overview.worker.state === "not_configured" ? "info" : "warning"} title={t(`admin.system.jobs.worker.${overview.worker.state}.title`)}>
          {t(`admin.system.jobs.worker.${overview.worker.state}.body`)}
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader icon={<Server />} title={t("admin.system.workers")} description={t("admin.system.jobs.aliveCount", { count: overview.worker.alive })} />
          {overview.workers.length === 0 ? (
            <EmptyState icon={<Server />} title={t("admin.system.noHeartbeat")} body={t("admin.system.noHeartbeatHint")} />
          ) : (
            <ul className="divide-y text-xs">
              {overview.workers.map((w) => {
                const info = (w.info ?? {}) as { roles?: string[] };
                return (
                  <li key={w.id} className="grid gap-1 px-4 py-2">
                    <div className="flex items-center gap-2">
                      <LiveDot tone={w.alive ? "success" : "danger"} pulse={w.alive} />
                      <span className="font-mono">{`${w.hostname}:${w.pid}`}</span>
                      <span className="ms-auto text-muted-foreground">{formatRelativeTime(w.lastSeenAt, locale, now)}</span>
                    </div>
                    {info.roles?.length ? <p className="text-muted-foreground">{info.roles.join(" · ")}</p> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader icon={<Inbox />} title={t("admin.system.jobs.queues")} description={t("admin.system.jobs.queuesHint")} />
          <CardBody>
            <BarList
              label={t("admin.system.jobs.queues")}
              items={overview.queues.map((q) => ({
                key: q.name,
                label: q.name,
                value: q.waiting + q.active + q.delayed,
                display: q.available ? `${n(q.waiting)} · ${n(q.active)} · ${n(q.delayed)} · ${n(q.failed)}` : t("admin.system.jobs.unavailable"),
              }))}
              empty={t("admin.system.jobs.noQueues")}
            />
            <p className="mt-2 text-xs text-muted-foreground">{t("admin.system.jobs.queueLegend")}</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader icon={<Activity />} title={t("admin.system.jobs.last24h")} />
        <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
          {WORKER_JOB_STATUSES.map((s) => (
            <Link key={s} href={qs({ status: s, cursor: undefined, run: undefined })} className="grid gap-1 bg-surface p-4 hover:bg-muted/50">
              <dt className="text-xs text-muted-foreground">{t(`admin.system.jobs.status.${s}`)}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{n(overview.last24h[s])}</dd>
            </Link>
          ))}
        </dl>
        <p className="px-4 py-2 text-xs text-muted-foreground">{t("admin.system.jobs.deadTotal", { count: overview.deadLetters })}</p>
      </Card>

      {detail ? (
        <Card>
          <CardHeader
            icon={<ScrollText />}
            title={`${detail.queue} / ${detail.jobName}`}
            description={t("admin.system.jobs.detailHint", { attempts: detail.attempts, max: detail.maxAttempts })}
            actions={<Badge tone={TONE[detail.status]}>{t(`admin.system.jobs.status.${detail.status}`)}</Badge>}
          />
          <CardBody className="grid gap-3">
            {detail.lastError ? <Notice tone="danger">{detail.lastError}</Notice> : null}
            {detail.status === "DEAD" && canManage ? <DeadJobActions runId={detail.id} requeueable={detail.requeueable} /> : null}
            <ol className="grid gap-1 border-s ps-4 text-xs">
              {logs.length === 0 ? <li className="text-muted-foreground">{t("admin.system.jobs.noLogs")}</li> : null}
              {logs.map((l, i) => (
                <li key={i} className="grid gap-0.5">
                  <span className="text-muted-foreground">{l.at ? formatDateTime(new Date(l.at), locale, tz) : ""}</span>
                  <span className={l.level === "error" ? "text-danger" : l.level === "warn" ? "text-warning" : ""}>{l.message}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader icon={<ListChecks />} title={t("admin.system.jobs.runs")} description={t("admin.system.jobs.runsHint")} />
        <QuickFilters
          base={base}
          name="status"
          value={status}
          params={{ queue }}
          label={t("admin.system.jobs.filterStatus")}
          options={[{ value: "", label: t("admin.system.jobs.all") }, ...WORKER_JOB_STATUSES.map((s) => ({ value: s, label: t(`admin.system.jobs.status.${s}`) }))]}
        />
        <QuickFilters
          base={base}
          name="queue"
          value={queue}
          params={{ status }}
          label={t("admin.system.jobs.filterQueue")}
          options={[{ value: "", label: t("admin.system.jobs.allQueues") }, ...WORKER_QUEUES.filter((q) => q.name !== "dead-letter").map((q) => ({ value: q.name, label: q.name }))]}
        />
        {runs.data.length === 0 ? (
          <EmptyState icon={<ListChecks />} title={t("admin.system.jobs.empty")} body={t("admin.system.jobs.emptyHint")} />
        ) : (
          <ul className="divide-y text-xs">
            {runs.data.map((run) => (
              <li key={run.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={TONE[run.status]}>{t(`admin.system.jobs.status.${run.status}`)}</Badge>
                    <Link href={qs({ run: run.id, cursor })} className="truncate font-mono hover:underline">
                      {run.queue}/{run.jobName}
                    </Link>
                    <span className="text-muted-foreground">{t("admin.system.jobs.attempts", { attempts: run.attempts, max: run.maxAttempts })}</span>
                    {run.durationMs !== null ? <span className="text-muted-foreground">{t("admin.system.jobs.duration", { ms: run.durationMs })}</span> : null}
                  </div>
                  {run.lastError && run.status !== "SUCCEEDED" ? <p className="truncate text-danger">{run.lastError}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <span className="text-muted-foreground">{formatRelativeTime(run.updatedAt, locale, now)}</span>
                  {run.status === "DEAD" && canManage ? <DeadJobActions runId={run.id} requeueable={requeueable(run.queue)} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <NextPage base={base} params={{ status, queue }} cursor={runs.nextCursor} label={t("admin.system.jobs.next")} />
      </Card>
    </div>
  );
}
