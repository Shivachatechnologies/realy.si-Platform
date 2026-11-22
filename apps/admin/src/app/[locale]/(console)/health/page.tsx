import Link from "next/link";
import { Activity, HeartPulse, ListX, RefreshCw, Siren } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, guard, StatGrid, StatTile } from "@/components/admin/kit";
import { AutoRefresh } from "@/components/admin/viz";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { EnvBadge } from "@/components/admin/env-badge";
import { OpsButton } from "@/components/admin/ops/ops-action";
import { HealthStrip, SourceLine, duration, pct } from "@/components/admin/ops/ops-kit";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { healthCenter, HEALTH_STATUSES } from "@/server/modules/admin/health";
import { requestTime, requireViewer } from "@/server/session";

const GROUPS = ["apps", "data", "background", "ai", "providers", "integrations"] as const;

/** Health center: every service's status, latency, last check, measured uptime and 24 h history. */
export default async function HealthPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(healthCenter(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const h = r.value;
  const canProbe = await canPlatform(viewer.ctx, "platform.controls.manage");
  const now = requestTime();
  const base = `/${locale}`;
  const st = (s: string) => t(`admin.system.hc.status.${s}`);
  const svc = (k: string) => t(`admin.system.hc.services.${k.replace(".", "_")}`);
  const down = h.counts.DOWN + h.counts.CRITICAL;
  return (
    <div className="grid gap-4">
      <AdminHeader
        icon={<HeartPulse />}
        title={t("admin.system.hc.title")}
        description={t("admin.system.hc.subtitle")}
        why={t("admin.system.hc.why")}
        meta={<EnvBadge />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canProbe ? <OpsButton label={t("admin.system.hc.recheck")} path="/api/v1/admin/health/probe" success={t("admin.system.hc.rechecked")} icon={<RefreshCw aria-hidden />} /> : null}
            <AutoRefresh loadedAt={now} timeZone={viewer.user.timezone} label={t("admin.live.on")} pausedLabel={t("admin.live.paused")} pauseLabel={t("admin.live.pause")} resumeLabel={t("admin.live.resume")} />
          </div>
        }
      />
      {h.probeStale ? (
        <Notice tone="warning" title={t("admin.system.hc.probeStaleTitle")}>
          {h.lastProbeAt ? t("admin.system.hc.probeStaleBody") : t("admin.system.hc.neverProbed")}{" "}
          <Link href={`${base}/system/jobs`} className="font-medium text-primary hover:underline">
            {t("admin.system.hc.openJobs")}
          </Link>
        </Notice>
      ) : null}
      {h.maintenance ? <Notice tone="info">{t("admin.system.hc.maintenanceOn")}</Notice> : null}
      <StatGrid>
        <StatTile label={t("admin.system.hc.overall")} value={<StatusBadge domain="serviceHealth" value={h.overall} pulse={h.overall === "DOWN" || h.overall === "CRITICAL"}>{st(h.overall)}</StatusBadge>} hint={t("admin.system.hc.overallHint")} tone={down ? "danger" : h.counts.DEGRADED ? "warning" : "success"} />
        <StatTile label={t("admin.system.hc.healthy")} value={formatNumber(h.counts.HEALTHY + h.counts.OPERATIONAL, locale)} hint={t("admin.system.hc.ofServices", { count: h.services.length })} tone="success" />
        <StatTile label={t("admin.system.hc.attention")} value={formatNumber(down + h.counts.DEGRADED, locale)} hint={t("admin.system.hc.attentionHint", { down, degraded: h.counts.DEGRADED })} tone={down ? "danger" : h.counts.DEGRADED ? "warning" : undefined} />
        <StatTile label={t("admin.system.hc.openIncidents")} value={formatNumber(h.openIncidents.length, locale)} href={`${base}/incidents?state=active`} icon={<Siren />} tone={h.openIncidents.length ? "danger" : undefined} />
      </StatGrid>
      <SourceLine source={t("admin.system.hc.source")} at={h.lastProbeAt} stale={h.probeStale} staleLabel={t("admin.system.hc.stale")} />
      {GROUPS.map((g) => {
        const list = h.services.filter((s) => s.group === g);
        return (
          <Card key={g}>
            <CardHeader icon={<Activity />} title={t(`admin.system.hc.groups.${g}`)} />
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <Tr>
                    <Th>{t("admin.system.hc.service")}</Th>
                    <Th>{t("admin.system.hc.statusLabel")}</Th>
                    <Th className="text-end">{t("admin.system.hc.latency")}</Th>
                    <Th>{t("admin.system.hc.last24h")}</Th>
                    <Th className="text-end">{t("admin.system.hc.uptime24h")}</Th>
                    <Th className="text-end">{t("admin.system.hc.uptime30d")}</Th>
                    <Th>{t("admin.system.hc.lastCheck")}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {list.map((s) => (
                    <Tr key={s.key}>
                      <Td>
                        <Link href={`${base}/health/${encodeURIComponent(s.key)}`} className="font-medium hover:underline">
                          {svc(s.key)}
                        </Link>
                        <div className="font-mono text-[11px] text-muted-foreground">{s.key}</div>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge domain="serviceHealth" value={s.status} pulse={s.status === "DOWN"}>
                            {st(s.status)}
                          </StatusBadge>
                          {s.stale ? <span className="text-[11px] text-warning">{t("admin.system.hc.stale")}</span> : null}
                          {s.openAlerts ? (
                            <Link href={`${base}/alerts?service=${encodeURIComponent(s.key)}`} className="text-[11px] text-danger hover:underline">
                              {t("admin.system.hc.alertsCount", { count: s.openAlerts })}
                            </Link>
                          ) : null}
                        </div>
                      </Td>
                      <Td className="text-end tabular-nums">{s.latencyMs === null ? "—" : duration(s.latencyMs, locale)}</Td>
                      <Td className="min-w-40">
                        <HealthStrip statuses={s.strip.status} label={t("admin.system.hc.stripLabel", { service: svc(s.key) })} statusLabel={st} />
                      </Td>
                      <Td className="text-end tabular-nums">{s.status === "NOT_CONFIGURED" ? "—" : pct(s.uptime.h24, locale)}</Td>
                      <Td className="text-end tabular-nums">{s.status === "NOT_CONFIGURED" ? "—" : pct(s.uptime.d30, locale)}</Td>
                      <Td className="text-xs text-muted-foreground">{s.checkedAt ? <Timestamp value={s.checkedAt} mode="relative" /> : t("admin.system.hc.never")}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          </Card>
        );
      })}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<ListX />} title={t("admin.system.hc.recentFailures")} description={t("admin.system.hc.recentFailuresHint")} />
          {h.recentFailures.length === 0 ? (
            <EmptyState icon={<HeartPulse />} title={t("admin.system.hc.noFailures")} />
          ) : (
            <ul className="divide-y text-xs">
              {h.recentFailures.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <StatusBadge domain="serviceHealth" value={f.status}>
                    {st(f.status)}
                  </StatusBadge>
                  <Link href={`${base}/health/${encodeURIComponent(f.service)}`} className="font-medium hover:underline">
                    {svc(f.service)}
                  </Link>
                  <span className="ms-auto text-muted-foreground">
                    <Timestamp value={f.checkedAt} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader icon={<Siren />} title={t("admin.system.hc.activeIncidents")} actions={<Link href={`${base}/incidents`} className="text-xs font-medium text-primary hover:underline">{t("admin.system.hc.allIncidents")}</Link>} />
          {h.openIncidents.length === 0 ? (
            <EmptyState icon={<Siren />} title={t("admin.system.hc.noIncidents")} />
          ) : (
            <ul className="divide-y text-xs">
              {h.openIncidents.map((i) => (
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
        <CardHeader title={t("admin.system.hc.legend")} />
        <CardBody className="flex flex-wrap gap-3 text-xs">
          {HEALTH_STATUSES.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <StatusBadge domain="serviceHealth" value={s}>
                {st(s)}
              </StatusBadge>
              <span className="text-muted-foreground">{t(`admin.system.hc.statusHelp.${s}`)}</span>
            </span>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
