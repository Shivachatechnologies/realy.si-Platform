import Link from "next/link";
import { notFound } from "next/navigation";
import { Inbox, RotateCcw, ScanSearch, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, Facts, guard, QuickFilters, sp } from "@/components/admin/kit";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { EnvBadge } from "@/components/admin/env-badge";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { OpsAction } from "@/components/admin/ops/ops-action";
import { ProductionNotice } from "@/components/admin/ops/ops-kit";
import { Button } from "@/components/ui/button";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { WORKER_QUEUES } from "@/server/core/jobs";
import { canPlatform } from "@/server/modules/admin/access";
import { inspectJob, JOB_MANAGE_PERM, LIVE_JOB_STATES, listQueueJobs } from "@/server/core/job-admin";
import { isProduction, productionPhrase } from "@/server/modules/admin/releases";
import { requireViewer } from "@/server/session";

/** Live jobs of one queue (from Redis, on demand): inspect, retry failed, cancel waiting or delayed jobs. */
export default async function QueuePage({ params, searchParams }: { params: Promise<{ queue: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { queue } = await params;
  if (!WORKER_QUEUES.some((q) => q.name === queue)) notFound();
  const q = await searchParams;
  const state = LIVE_JOB_STATES.find((s) => s === sp(q.state)) ?? "waiting";
  const start = Math.max(0, Math.min(100_000, Number(sp(q.start) ?? 0) || 0));
  const jobParam = sp(q.job);
  const r = await guard(
    listQueueJobs(viewer.ctx, queue, { state, start }).catch((e) => {
      if (isAppError(e) && e.code === "validation_error") return null;
      throw e;
    }),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const list = r.value;
  const [canManage, detail] = await Promise.all([canPlatform(viewer.ctx, JOB_MANAGE_PERM), jobParam ? inspectJob(viewer.ctx, queue, jobParam).catch(() => null) : Promise.resolve(null)]);
  const prod = isProduction();
  const base = `/${locale}/system/jobs/queues/${queue}`;
  const href = (extra: Record<string, string | number | undefined>) => {
    const pairs: [string, string][] = [];
    for (const [k, v] of Object.entries({ state, ...extra }) as [string, string | number | undefined][]) if (v !== undefined && v !== "") pairs.push([k, String(v)]);
    const s = new URLSearchParams(pairs).toString();
    return s ? `${base}?${s}` : base;
  };
  const ms = (v: number | null) => (v ? <Timestamp value={new Date(v)} /> : "—");
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: queue }]} />
      <AdminHeader icon={<Inbox />} title={t("admin.system.jobs.v2.queueTitle", { queue })} description={t("admin.system.jobs.v2.queueSubtitle")} meta={<EnvBadge />} />
      {canManage ? <ProductionNotice production={prod} title={t("admin.system.env.productionTitle")} body={t("admin.system.env.productionBody")} /> : null}
      {!list ? <Notice tone="warning">{t("admin.system.jobs.v2.unavailable")}</Notice> : null}
      {detail ? (
        <Card>
          <CardHeader
            icon={<ScanSearch />}
            title={`${detail.name} · ${detail.id}`}
            description={t("admin.system.jobs.v2.inspectHint")}
            actions={
              <div className="flex flex-wrap gap-2">
                <StatusBadge domain="liveJob" value={detail.state}>
                  {t(`admin.system.jobs.v2.states.${LIVE_JOB_STATES.includes(detail.state as (typeof LIVE_JOB_STATES)[number]) ? detail.state : "waiting"}`)}
                </StatusBadge>
                {canManage && detail.retryable ? <OpsAction label={t("admin.system.jobs.v2.retry")} title={t("admin.system.jobs.v2.retryTitle")} path={`/api/v1/admin/jobs/queues/${queue}/jobs/${encodeURIComponent(detail.id)}?action=retry`} icon={<RotateCcw aria-hidden />} success={t("admin.system.jobs.v2.done")} /> : null}
                {canManage && detail.cancellable ? <OpsAction label={t("admin.system.jobs.v2.cancel")} title={t("admin.system.jobs.v2.cancelTitle")} description={t("admin.system.jobs.v2.cancelHint")} path={`/api/v1/admin/jobs/queues/${queue}/jobs/${encodeURIComponent(detail.id)}?action=cancel`} phrase={productionPhrase(`cancel ${detail.id}`)} danger production={prod} variant="danger" icon={<XCircle aria-hidden />} success={t("admin.system.jobs.v2.done")} /> : null}
                <Button asChild size="sm" variant="ghost">
                  <Link href={href({ start: start || undefined })}>{t("common.close")}</Link>
                </Button>
              </div>
            }
          />
          <Facts
            rows={[
              [t("admin.system.jobs.v2.attempts"), `${detail.attemptsMade}/${detail.attempts}`],
              [t("admin.system.jobs.v2.createdAt"), ms(detail.timestamp)],
              [t("admin.system.jobs.v2.processedAt"), ms(detail.processedOn)],
              [t("admin.system.jobs.v2.finishedAt"), ms(detail.finishedOn)],
              [t("admin.system.jobs.v2.delay"), detail.delay ? `${Math.round(detail.delay / 1000)} s` : "—"],
              [t("admin.system.jobs.v2.organization"), detail.organizationId ? <Link key="o" href={`/${locale}/organizations/${detail.organizationId}`} className="font-mono text-xs hover:underline">{detail.organizationId}</Link> : "—"],
              [t("admin.system.jobs.v2.run"), detail.run ? <Link key="r" href={`/${locale}/system/jobs?run=${detail.run.id}`} className="hover:underline">{detail.run.status}</Link> : "—"],
            ]}
          />
          <CardBody className="grid gap-3 border-t text-xs">
            {detail.failedReason ? <Notice tone="danger">{detail.failedReason}</Notice> : null}
            <div>
              <p className="mb-1 font-medium">{t("admin.system.jobs.v2.dataShape")}</p>
              <pre className="overflow-auto rounded-md bg-muted p-2 font-mono text-[11px]">{JSON.stringify(detail.dataShape, null, 2)}</pre>
              <p className="mt-1 text-muted-foreground">{t("admin.system.jobs.v2.dataShapeHint")}</p>
            </div>
            {detail.stacktrace.length ? (
              <details>
                <summary className="cursor-pointer">{t("admin.errors.stack")}</summary>
                <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{detail.stacktrace.join("\n\n")}</pre>
              </details>
            ) : null}
          </CardBody>
        </Card>
      ) : jobParam ? (
        <Notice tone="info">{t("admin.system.jobs.v2.jobGone")}</Notice>
      ) : null}
      <Card>
        <CardHeader icon={<Inbox />} title={t("admin.system.jobs.v2.liveJobs")} description={t("admin.system.jobs.v2.liveJobsHint")} />
        <QuickFilters base={base} name="state" value={state} params={{}} label={t("admin.system.jobs.v2.state")} options={LIVE_JOB_STATES.map((s) => ({ value: s, label: t(`admin.system.jobs.v2.states.${s}`) }))} />
        {!list || list.jobs.length === 0 ? (
          <EmptyState icon={<Inbox />} title={t("admin.system.jobs.v2.noJobs")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.system.jobs.v2.job")}</Th>
                  <Th>{t("admin.system.jobs.v2.attempts")}</Th>
                  <Th>{t("admin.system.jobs.v2.createdAt")}</Th>
                  <Th>{t("admin.system.jobs.v2.failure")}</Th>
                  <Th>{t("admin.system.jobs.v2.actions")}</Th>
                </Tr>
              </THead>
              <TBody>
                {list.jobs.map((j) => (
                  <Tr key={j.id}>
                    <Td>
                      <Link href={href({ job: j.id, start: start || undefined })} className="font-mono text-xs hover:underline">
                        {j.name}
                      </Link>
                      <div className="font-mono text-[11px] text-muted-foreground">{j.id}</div>
                    </Td>
                    <Td className="text-xs tabular-nums">
                      {j.attemptsMade}/{j.attempts}
                    </Td>
                    <Td className="text-xs">{ms(j.timestamp)}</Td>
                    <Td className="max-w-80 truncate text-xs text-danger">{j.failedReason ?? ""}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Button asChild size="sm" variant="ghost">
                          <Link href={href({ job: j.id, start: start || undefined })}>{t("admin.system.jobs.v2.inspect")}</Link>
                        </Button>
                        {canManage && state === "failed" && queue !== "dead-letter" ? <OpsAction label={t("admin.system.jobs.v2.retry")} title={t("admin.system.jobs.v2.retryTitle")} path={`/api/v1/admin/jobs/queues/${queue}/jobs/${encodeURIComponent(j.id)}?action=retry`} variant="ghost" success={t("admin.system.jobs.v2.done")} /> : null}
                        {canManage && (state === "waiting" || state === "delayed" || state === "prioritized") ? <OpsAction label={t("admin.system.jobs.v2.cancel")} title={t("admin.system.jobs.v2.cancelTitle")} description={t("admin.system.jobs.v2.cancelHint")} path={`/api/v1/admin/jobs/queues/${queue}/jobs/${encodeURIComponent(j.id)}?action=cancel`} phrase={productionPhrase(`cancel ${j.id}`)} danger production={prod} variant="ghost" success={t("admin.system.jobs.v2.done")} /> : null}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <div className="flex justify-between border-t p-3">
          {start > 0 ? (
            <Button asChild size="sm" variant="secondary">
              <Link href={href({ start: Math.max(0, start - 25) || undefined })}>{t("admin.system.jobs.v2.previous")}</Link>
            </Button>
          ) : (
            <span />
          )}
          {list?.nextStart ? (
            <Button asChild size="sm" variant="secondary">
              <Link href={href({ start: list.nextStart })}>{t("admin.system.jobs.next")}</Link>
            </Button>
          ) : null}
        </div>
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          <Badge>{t("admin.system.jobs.v2.redisLive")}</Badge> {t("admin.system.jobs.v2.redisLiveHint")}
        </p>
      </Card>
    </div>
  );
}
