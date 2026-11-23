import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, Bell, Boxes, GitBranch, History, ListX, Settings2, Siren } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, Facts, guard, NextPage, QuickFilters, sp, StatGrid, StatTile } from "@/components/admin/kit";
import { Sparkline } from "@/components/admin/viz";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { HealthStrip, SourceLine, duration, pct } from "@/components/admin/ops/ops-kit";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { HEALTH_STATUSES, serviceDef, serviceHealthDetail, type HealthStatus } from "@/server/modules/admin/health";
import { requireViewer } from "@/server/session";

/** One service: status, uptime windows, latency, check history, failures, dependencies, capacity, config, incidents. */
export default async function ServiceHealthPage({ params, searchParams }: { params: Promise<{ service: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const key = decodeURIComponent((await params).service);
  if (!serviceDef(key)) notFound();
  const q = await searchParams;
  const status = HEALTH_STATUSES.find((s) => s === sp(q.status)) as HealthStatus | undefined;
  const cursor = sp(q.cursor);
  const r = await guard(
    serviceHealthDetail(viewer.ctx, key, { status, cursor: cursor && /^[0-9a-f-]{36}$/i.test(cursor) ? cursor : undefined, limit: 30 }).catch((e) => {
      if (isAppError(e) && e.code === "not_found") notFound();
      throw e;
    }),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const d = r.value;
  const base = `/${locale}`;
  const st = (s: string) => t(`admin.system.hc.status.${s}`);
  const svc = (k: string) => t(`admin.system.hc.services.${k.replace(".", "_")}`);
  const cur = d.current;
  const detail = (cur?.detail ?? {}) as Record<string, unknown>;
  const scalar = Object.entries(detail).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v));
  const latency = d.strip.latency.map((v) => v ?? 0);
  const pageBase = `${base}/health/${encodeURIComponent(key)}`;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: svc(key) }]} />
      <AdminHeader icon={<Activity />} title={svc(key)} description={t(`admin.system.hc.about.${key.replace(".", "_")}`)} eyebrow={<span className="font-mono text-[11px]">{key}</span>} />
      <StatGrid>
        <StatTile label={t("admin.system.hc.statusLabel")} value={<StatusBadge domain="serviceHealth" value={cur?.stale ? "UNKNOWN" : (cur?.status ?? "UNKNOWN")}>{st(cur?.stale ? "UNKNOWN" : (cur?.status ?? "UNKNOWN"))}</StatusBadge>} hint={cur ? <Timestamp value={cur.checkedAt} /> : t("admin.system.hc.never")} />
        <StatTile label={t("admin.system.hc.latency")} value={cur?.latencyMs == null ? "—" : duration(cur.latencyMs, locale)} spark={latency.some((v) => v > 0) ? <Sparkline values={latency} label={t("admin.system.hc.latency24h")} /> : undefined} hint={t("admin.system.hc.latency24h")} />
        <StatTile label={t("admin.system.hc.uptime24h")} value={pct(d.uptime.h24, locale)} hint={t("admin.system.hc.uptime7d", { value: pct(d.uptime.d7, locale) })} />
        <StatTile label={t("admin.system.hc.uptime30d")} value={pct(d.uptime.d30, locale)} hint={t("admin.system.hc.samples", { count: d.uptime.samples30d })} />
      </StatGrid>
      <SourceLine source={t("admin.system.hc.sourceService", { minutes: Math.round(d.def.everyMs / 60_000) })} at={cur?.checkedAt} stale={cur?.stale} staleLabel={t("admin.system.hc.stale")} />
      <Card>
        <CardHeader icon={<History />} title={t("admin.system.hc.last24h")} description={t("admin.system.hc.stripHint")} />
        <CardBody>
          <HealthStrip statuses={d.strip.status} label={t("admin.system.hc.stripLabel", { service: svc(key) })} statusLabel={st} className="h-8" />
        </CardBody>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Boxes />} title={t("admin.system.hc.capacity")} description={t("admin.system.hc.capacityHint")} />
          {scalar.length ? <Facts rows={scalar.map(([k, v]) => [k, v === null ? "—" : String(v)])} /> : <EmptyState title={t("admin.system.hc.noDetail")} />}
        </Card>
        <Card>
          <CardHeader icon={<Settings2 />} title={t("admin.system.hc.configuration")} description={t("admin.system.hc.configurationHint")} />
          {Object.keys(d.configuration).length ? (
            <Facts rows={Object.entries(d.configuration).map(([k, v]) => [k, typeof v === "boolean" ? (v ? t("admin.system.configured") : t("admin.system.notConfigured")) : (v ?? "—")])} />
          ) : (
            <EmptyState title={t("admin.system.hc.noConfig")} />
          )}
        </Card>
        <Card>
          <CardHeader icon={<GitBranch />} title={t("admin.system.hc.dependencies")} />
          <CardBody className="grid gap-3 text-xs">
            <div>
              <p className="mb-1 text-muted-foreground">{t("admin.system.hc.dependsOn")}</p>
              {d.dependencies.length ? (
                <ul className="flex flex-wrap gap-2">
                  {d.dependencies.map((x) => (
                    <li key={x.key}>
                      <Link href={`${base}/health/${encodeURIComponent(x.key)}`} className="inline-flex items-center gap-1.5 hover:underline">
                        {svc(x.key)} <StatusBadge domain="serviceHealth" value={x.status}>{st(x.status)}</StatusBadge>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{t("admin.system.hc.none")}</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-muted-foreground">{t("admin.system.hc.usedBy")}</p>
              {d.dependents.length ? (
                <ul className="flex flex-wrap gap-2">
                  {d.dependents.map((x) => (
                    <li key={x.key}>
                      <Link href={`${base}/health/${encodeURIComponent(x.key)}`} className="inline-flex items-center gap-1.5 hover:underline">
                        {svc(x.key)} <StatusBadge domain="serviceHealth" value={x.status}>{st(x.status)}</StatusBadge>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{t("admin.system.hc.none")}</p>
              )}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Siren />} title={t("admin.system.hc.incidentHistory")} />
          {d.incidents.length === 0 ? (
            <EmptyState icon={<Siren />} title={t("admin.system.hc.noIncidentsService")} />
          ) : (
            <ul className="divide-y text-xs">
              {d.incidents.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <StatusBadge domain="incidentSeverity" value={i.severity} />
                  <Link href={`${base}/incidents/${i.id}`} className="font-medium hover:underline">
                    #{i.number} {i.title}
                  </Link>
                  <StatusBadge domain="incident" value={i.status}>
                    {t(`admin.incidents.status.${i.status}`)}
                  </StatusBadge>
                  <span className="ms-auto text-muted-foreground">
                    <Timestamp value={i.detectedAt} mode="relative" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader icon={<Bell />} title={t("admin.system.hc.alertHistory")} />
        {d.alerts.length === 0 ? (
          <EmptyState icon={<Bell />} title={t("admin.system.hc.noAlerts")} />
        ) : (
          <ul className="divide-y text-xs">
            {d.alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <StatusBadge domain="alertSeverity" value={a.severity}>
                  {t(`admin.alerts.severity.${a.severity}`)}
                </StatusBadge>
                <Link href={`${base}/alerts/${a.id}`} className="font-medium hover:underline">
                  {a.title}
                </Link>
                <StatusBadge domain="alert" value={a.status}>
                  {t(`admin.alerts.status.${a.status}`)}
                </StatusBadge>
                <span className="ms-auto text-muted-foreground">
                  <Timestamp value={a.lastSeenAt} mode="relative" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader icon={<ListX />} title={t("admin.system.hc.history")} description={t("admin.system.hc.historyHint")} />
        <QuickFilters base={pageBase} name="status" value={status} params={{}} label={t("admin.system.hc.statusLabel")} options={[{ value: "", label: t("admin.system.hc.allStatuses") }, ...HEALTH_STATUSES.map((s) => ({ value: s, label: st(s) }))]} />
        {d.history.length === 0 ? (
          <EmptyState icon={<History />} title={t("admin.system.hc.noHistory")} body={t("admin.system.hc.noHistoryHint")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.system.hc.checkedAt")}</Th>
                  <Th>{t("admin.system.hc.statusLabel")}</Th>
                  <Th className="text-end">{t("admin.system.hc.latency")}</Th>
                  <Th>{t("admin.system.hc.detail")}</Th>
                </Tr>
              </THead>
              <TBody>
                {d.history.map((c) => (
                  <Tr key={c.id}>
                    <Td className="text-xs">
                      <Timestamp value={c.checkedAt} mode="absolute" />
                    </Td>
                    <Td>
                      <StatusBadge domain="serviceHealth" value={c.status}>
                        {st(c.status)}
                      </StatusBadge>
                    </Td>
                    <Td className="text-end tabular-nums">{c.latencyMs === null ? "—" : duration(c.latencyMs, locale)}</Td>
                    <Td className="max-w-96 truncate font-mono text-[11px] text-muted-foreground">{JSON.stringify(c.detail)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <NextPage base={pageBase} params={{ status }} cursor={d.nextCursor} label={t("admin.system.jobs.next")} />
      </Card>
    </div>
  );
}
