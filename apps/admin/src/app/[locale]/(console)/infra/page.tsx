import Link from "next/link";
import { Cpu, Database, Gauge, HardDrive, Inbox, MemoryStick, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, Facts, guard, StatGrid, StatTile } from "@/components/admin/kit";
import { Timestamp } from "@/components/admin/timestamp";
import { LiveDot } from "@/components/motion/live-dot";
import { SourceLine, bytes, duration } from "@/components/admin/ops/ops-kit";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { infraOverview } from "@/server/modules/admin/infra";
import { requireViewer } from "@/server/session";

/** Infrastructure: what the platform can measure itself (Postgres, Redis INFO, worker processes, queue backlog). */
export default async function InfraPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(infraOverview(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const o = r.value;
  const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatNumber(v, locale));
  const conns = o.database.connections.reduce((a, c) => a + c.n, 0);
  const ri = o.redis.info;
  const hitRatio = ri && ri.hits !== null && ri.misses !== null && ri.hits + ri.misses > 0 ? ri.hits / (ri.hits + ri.misses) : null;
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Server />} title={t("admin.infra.title")} description={t("admin.infra.subtitle")} why={t("admin.infra.why")} />
      <StatGrid>
        <StatTile icon={<Database />} label={t("admin.infra.dbSize")} value={bytes(o.database.sizeBytes, locale)} hint={o.database.version ? t("admin.infra.pgVersion", { version: o.database.version }) : undefined} />
        <StatTile icon={<Gauge />} label={t("admin.infra.dbConnections")} value={`${n(conns)} / ${n(o.database.maxConnections)}`} href={`/${locale}/health/db.connections`} tone={o.database.maxConnections && conns / o.database.maxConnections > 0.8 ? "warning" : undefined} />
        <StatTile icon={<MemoryStick />} label={t("admin.infra.redisMemory")} value={o.redis.configured ? bytes(ri?.usedMemory, locale) : t("admin.system.notConfigured")} hint={ri?.maxMemory ? t("admin.infra.ofMax", { max: bytes(ri.maxMemory, locale) }) : undefined} />
        <StatTile icon={<Cpu />} label={t("admin.infra.workers")} value={n(o.workers.filter((w) => w.alive).length)} hint={t("admin.infra.workersHint", { total: o.workers.length })} href={`/${locale}/system/jobs`} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Database />} title={t("admin.infra.postgres")} />
          <Facts
            rows={[
              [t("admin.infra.cacheHit"), o.database.cacheHitRatio === null ? "—" : `${formatNumber(o.database.cacheHitRatio * 100, locale, { maximumFractionDigits: 2 })} %`],
              [t("admin.infra.deadlocks"), n(o.database.deadlocks)],
              ...o.database.connections.map((c) => [t("admin.infra.connState", { state: c.state }), n(c.n)] as [string, string]),
            ]}
          />
          <CardBody className="border-t pt-3">
            <SourceLine source={t("admin.infra.pgSource")} at={o.database.fetchedAt} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<MemoryStick />} title={t("admin.infra.redis")} />
          {!o.redis.configured ? (
            <EmptyState title={t("admin.system.notConfigured")} body={t("admin.infra.redisNotConfigured")} />
          ) : !ri ? (
            <EmptyState title={t("admin.infra.redisUnavailable")} />
          ) : (
            <Facts
              rows={[
                [t("admin.infra.redisVersion"), ri.version ?? "—"],
                [t("admin.infra.uptime"), ri.uptimeSeconds === null ? "—" : duration(ri.uptimeSeconds * 1000, locale)],
                [t("admin.infra.clients"), n(ri.connectedClients)],
                [t("admin.infra.blocked"), n(ri.blockedClients)],
                [t("admin.infra.peakMemory"), bytes(ri.usedMemoryPeak, locale)],
                [t("admin.infra.fragmentation"), ri.fragmentation === null ? "—" : String(ri.fragmentation)],
                [t("admin.infra.opsPerSec"), n(ri.opsPerSecond)],
                [t("admin.infra.hitRatio"), hitRatio === null ? "—" : `${formatNumber(hitRatio * 100, locale, { maximumFractionDigits: 1 })} %`],
                [t("admin.infra.evicted"), n(ri.evictedKeys)],
                [t("admin.infra.keys"), n(ri.keys)],
              ]}
            />
          )}
          <CardBody className="border-t pt-3">
            <SourceLine source={t("admin.infra.redisSource", { minutes: Math.round(o.redis.cacheTtlMs / 60_000) })} at={ri?.fetchedAt} />
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader icon={<Cpu />} title={t("admin.infra.workerProcesses")} description={t("admin.infra.workerProcessesHint")} />
        {o.workers.length === 0 ? (
          <EmptyState icon={<Server />} title={t("admin.system.noHeartbeat")} body={t("admin.system.noHeartbeatHint")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.infra.process")}</Th>
                  <Th>{t("admin.infra.version")}</Th>
                  <Th className="text-end">{t("admin.infra.rss")}</Th>
                  <Th className="text-end">{t("admin.infra.heap")}</Th>
                  <Th className="text-end">{t("admin.infra.uptime")}</Th>
                  <Th className="text-end">{t("admin.infra.loopLag")}</Th>
                  <Th>{t("admin.infra.lastSeen")}</Th>
                </Tr>
              </THead>
              <TBody>
                {o.workers.map((w) => (
                  <Tr key={w.id}>
                    <Td>
                      <span className="inline-flex items-center gap-2 font-mono text-xs">
                        <LiveDot tone={w.alive ? "success" : "danger"} pulse={w.alive} />
                        {w.hostname}:{w.pid}
                      </span>
                      {w.roles.length ? <div className="text-[11px] text-muted-foreground">{w.roles.join(" · ")}</div> : null}
                      {w.pausedQueues.length ? <Badge tone="warning">{t("admin.infra.pausedQueues", { queues: w.pausedQueues.join(", ") })}</Badge> : null}
                    </Td>
                    <Td className="font-mono text-[11px]">{w.version ?? "—"}</Td>
                    <Td className="text-end tabular-nums">{bytes(w.rssBytes, locale)}</Td>
                    <Td className="text-end tabular-nums">{bytes(w.heapUsedBytes, locale)}</Td>
                    <Td className="text-end tabular-nums">{w.uptimeSeconds === null ? "—" : duration(w.uptimeSeconds * 1000, locale)}</Td>
                    <Td className="text-end tabular-nums">{w.eventLoopLagMs === null ? "—" : duration(w.eventLoopLagMs, locale)}</Td>
                    <Td className="text-xs">
                      <Timestamp value={w.lastSeenAt} mode="relative" />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Inbox />} title={t("admin.infra.queueBacklog")} actions={<Link href={`/${locale}/system/jobs`} className="text-xs font-medium text-primary hover:underline">{t("admin.infra.openJobs")}</Link>} />
          {!o.queues ? (
            <EmptyState title={t("admin.infra.noQueueProbe")} body={t("admin.infra.noQueueProbeHint")} />
          ) : (
            <>
              <Facts rows={o.queues.list.map((q) => [q.name, q.available ? t("admin.infra.backlogRow", { waiting: q.waiting, delayed: q.delayed, active: q.active, failed: q.failed }) : t("admin.system.jobs.unavailable")])} />
              <CardBody className="border-t pt-3">
                <SourceLine source={t("admin.infra.queueSource")} at={o.queues.checkedAt} />
              </CardBody>
            </>
          )}
        </Card>
        <Card>
          <CardHeader icon={<HardDrive />} title={t("admin.infra.largestTables")} />
          {o.database.tables.length === 0 ? (
            <EmptyState title={t("admin.infra.noTables")} />
          ) : (
            <Facts rows={o.database.tables.map((tb) => [tb.name, `${bytes(tb.totalBytes, locale)} · ${t("admin.infra.rowsEstimate", { rows: tb.rows })}`])} />
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title={t("admin.infra.slowQueries")} description={t("admin.infra.slowQueriesHint")} />
        {o.database.statements === null ? (
          <EmptyState title={t("admin.infra.noStatements")} body={t("admin.infra.noStatementsHint")} />
        ) : (
          <ul className="divide-y text-xs">
            {o.database.statements.map((s, i) => (
              <li key={i} className="grid gap-1 px-4 py-2">
                <code className="font-mono text-[11px] break-all">{s.query}</code>
                <span className="text-muted-foreground">{t("admin.infra.statementStats", { calls: s.calls, total: s.totalMs, mean: s.meanMs })}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title={t("admin.infra.unavailableTitle")} description={t("admin.infra.unavailableHint")} />
        <ul className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
          {o.unavailable.map((k) => (
            <li key={k} className="grid gap-0.5 bg-surface px-4 py-3 text-sm">
              <span className="font-medium">{t(`admin.infra.metrics.${k}`)}</span>
              <span className="text-xs text-muted-foreground">{t("admin.infra.needsTelemetry")}</span>
            </li>
          ))}
        </ul>
        {o.observability.otel ? <Notice tone="info" className="m-3">{t("admin.infra.otelConfigured")}</Notice> : null}
      </Card>
    </div>
  );
}
