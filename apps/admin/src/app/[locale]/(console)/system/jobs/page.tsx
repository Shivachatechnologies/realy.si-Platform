import Link from "next/link";
import { Activity, CalendarClock, Inbox, Layers, ListChecks, Pause, Play, RotateCcw, ScrollText, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { LiveDot } from "@/components/motion/live-dot";
import { AdminHeader, EmptyState, FilterBar, guard, NextPage, QuickFilters, sp } from "@/components/admin/kit";
import { AutoRefresh } from "@/components/admin/viz";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { EnvBadge } from "@/components/admin/env-badge";
import { OpsAction } from "@/components/admin/ops/ops-action";
import { ProductionNotice } from "@/components/admin/ops/ops-kit";
import { DeadJobActions } from "@/components/admin/job-actions";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { getJobRun, JOB_MANAGE_PERM, jobsOverview, listJobRuns, queueStates, WORKER_JOB_STATUSES } from "@/server/core/job-admin";
import { isProduction, productionPhrase } from "@/server/modules/admin/releases";
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
  const org = sp(params.org)?.match(/^[0-9a-f-]{36}$/i) ? sp(params.org) : undefined;
  const job = sp(params.job)?.trim() || undefined;
  const r = await guard(jobsOverview(viewer.ctx, { withQueues: false }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const overview = r.value;
  const [runs, detail, canManage, states] = await Promise.all([
    listJobRuns(viewer.ctx, { status, queue, org, job, cursor: cursor && /^[0-9a-f-]{36}$/i.test(cursor) ? cursor : undefined, limit: 30 }),
    runId ? getJobRun(viewer.ctx, runId).catch(() => null) : Promise.resolve(null),
    canPlatform(viewer.ctx, JOB_MANAGE_PERM),
    queueStates(viewer.ctx),
  ]);
  const prod = isProduction();
  const tz = viewer.user.timezone;
  const now = requestTime();
  const n = (v: number) => formatNumber(v, locale);
  const base = `/${locale}/system/jobs`;
  const qs = (extra: Record<string, string | undefined>) => {
    const entries: [string, string | undefined][] = Object.entries({ status, queue, org, job, ...extra });
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
        meta={<EnvBadge />}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`${base}/schedules`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              <CalendarClock aria-hidden className="size-4" />
              {t("admin.system.jobs.v2.schedules")}
            </Link>
            <AutoRefresh loadedAt={now} timeZone={tz} label={t("admin.live.on")} pausedLabel={t("admin.live.paused")} pauseLabel={t("admin.live.pause")} resumeLabel={t("admin.live.resume")} />
          </div>
        }
      />
      {canManage ? <ProductionNotice production={prod} title={t("admin.system.env.productionTitle")} body={t("admin.system.env.productionBody")} /> : null}
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
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.system.queue")}</Th>
                  <Th className="text-end">{t("admin.system.waiting")}</Th>
                  <Th className="text-end">{t("admin.system.active")}</Th>
                  <Th className="text-end">{t("admin.system.delayed")}</Th>
                  <Th className="text-end">{t("admin.system.failed")}</Th>
                  <Th>{t("admin.system.jobs.v2.state")}</Th>
                  <Th>{t("admin.system.jobs.v2.actions")}</Th>
                </Tr>
              </THead>
              <TBody>
                {states.map((q) => (
                  <Tr key={q.name}>
                    <Td>
                      <Link href={`${base}/queues/${q.name}`} className="font-mono text-xs font-medium hover:underline">
                        {q.name}
                      </Link>
                    </Td>
                    {(["waiting", "active", "delayed", "failed"] as const).map((k) => (
                      <Td key={k} className={`text-end tabular-nums ${k === "failed" && q.failed ? "text-danger" : ""}`}>
                        {q.available ? n(q[k]) : "—"}
                      </Td>
                    ))}
                    <Td>
                      {!q.available ? (
                        <Badge>{t("admin.system.jobs.unavailable")}</Badge>
                      ) : q.paused ? (
                        <Badge tone="warning">{t("admin.system.jobs.v2.paused")}</Badge>
                      ) : (
                        <Badge tone="success">{t("admin.system.jobs.v2.running")}</Badge>
                      )}
                    </Td>
                    <Td>
                      {canManage && q.available && q.name !== "dead-letter" ? (
                        <div className="flex flex-wrap gap-1">
                          {q.paused ? (
                            <OpsAction label={t("admin.system.jobs.v2.resume")} title={t("admin.system.jobs.v2.resumeTitle", { queue: q.name })} path={`/api/v1/admin/jobs/queues/${q.name}?action=resume`} icon={<Play aria-hidden />} variant="ghost" success={t("admin.system.jobs.v2.done")} />
                          ) : (
                            <OpsAction label={t("admin.system.jobs.v2.pause")} title={t("admin.system.jobs.v2.pauseTitle", { queue: q.name })} description={t("admin.system.jobs.v2.pauseHint")} path={`/api/v1/admin/jobs/queues/${q.name}?action=pause`} phrase={productionPhrase(`pause ${q.name}`)} danger production={prod} icon={<Pause aria-hidden />} variant="ghost" success={t("admin.system.jobs.v2.done")} />
                          )}
                          {q.failed && q.name !== "auth-email" ? (
                            <OpsAction label={t("admin.system.jobs.v2.retryFailed")} title={t("admin.system.jobs.v2.retryFailedTitle", { queue: q.name, count: q.failed })} path={`/api/v1/admin/jobs/queues/${q.name}?action=retry-failed`} phrase={productionPhrase(`retry ${q.name}`)} danger production={prod} icon={<RotateCcw aria-hidden />} variant="ghost" success={t("admin.system.jobs.v2.done")} />
                          ) : null}
                        </div>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
          <p className="px-4 py-2 text-xs text-muted-foreground">{t("admin.system.jobs.v2.liveHint")}</p>
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
          params={{ queue, org, job }}
          label={t("admin.system.jobs.filterStatus")}
          options={[{ value: "", label: t("admin.system.jobs.all") }, ...WORKER_JOB_STATUSES.map((s) => ({ value: s, label: t(`admin.system.jobs.status.${s}`) }))]}
        />
        <QuickFilters
          base={base}
          name="queue"
          value={queue}
          params={{ status, org, job }}
          label={t("admin.system.jobs.filterQueue")}
          options={[{ value: "", label: t("admin.system.jobs.allQueues") }, ...WORKER_QUEUES.filter((q) => q.name !== "dead-letter").map((q) => ({ value: q.name, label: q.name }))]}
        />
        <FilterBar
          action={base}
          values={{ status, queue, org, job }}
          filters={[]}
          submitLabel={t("admin.incidents.apply")}
          extra={
            <>
              {status ? <input type="hidden" name="status" value={status} /> : null}
              {queue ? <input type="hidden" name="queue" value={queue} /> : null}
              <Input name="job" defaultValue={job} maxLength={120} aria-label={t("admin.system.jobs.v2.filterJob")} placeholder={t("admin.system.jobs.v2.filterJob")} className="w-full sm:w-56" />
              <Input name="org" defaultValue={org} maxLength={36} aria-label={t("admin.system.jobs.v2.filterOrg")} placeholder={t("admin.system.jobs.v2.filterOrg")} className="w-full font-mono text-xs sm:w-80" />
              <Link href={base} className="self-center text-xs text-muted-foreground hover:underline">
                {t("admin.incidents.reset")}
              </Link>
            </>
          }
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
        <NextPage base={base} params={{ status, queue, org, job }} cursor={runs.nextCursor} label={t("admin.system.jobs.next")} />
      </Card>
    </div>
  );
}
