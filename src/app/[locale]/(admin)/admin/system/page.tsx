import { Badge, StatusDot } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, guard } from "@/components/admin/kit";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/i18n/format";
import { systemStatus } from "@/server/modules/admin/system-status";
import { systemOverview } from "@/server/modules/admin/monitoring";
import { requestTime, requireViewer } from "@/server/session";

/** System & Monitoring: live health, queues, worker heartbeat, configured services and recent errors. */
export default async function SystemStatusPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(systemOverview(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const { health, queues, heartbeats, errors, failed } = r.value;
  const services = await systemStatus();
  const tz = viewer.user.timezone;
  const now = requestTime();
  const n = (v: number) => formatNumber(v, locale);
  const workerAlive = heartbeats.some((h) => h.alive);
  return (
    <div className="grid gap-4">
      <AdminHeader title={t("admin.nav.system")} description={t("admin.system.subtitle")} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.system.health")} />
          <ul className="divide-y">
            {(["database", "redis", "email", "ai", "stripe"] as const).map((k) => (
              <li key={k} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <StatusDot tone={health[k] ? "success" : k === "database" || k === "redis" ? "danger" : "neutral"} />
                <span>{t(`admin.health.${k}`)}</span>
                <span className={`ms-auto text-xs ${health[k] ? "text-success" : "text-muted-foreground"}`}>
                  {k === "database" || k === "redis" ? (health[k] ? t("admin.system.reachable") : t("admin.system.unreachable")) : health[k] ? t("admin.system.configured") : t("admin.system.notConfigured")}
                </span>
              </li>
            ))}
            <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <StatusDot tone={workerAlive ? "success" : "danger"} />
              <span>{t("admin.system.worker")}</span>
              <span className={`ms-auto text-xs ${workerAlive ? "text-success" : "text-danger"}`}>
                {heartbeats[0] ? t("admin.system.lastHeartbeat", { time: formatRelativeTime(heartbeats[0].lastSeenAt, locale, now) }) : t("admin.system.noHeartbeat")}
              </span>
            </li>
          </ul>
        </Card>
        <Card>
          <CardHeader title={t("admin.system.title")} description={t("admin.system.description")} />
          <ul className="divide-y">
            {services.map((s) => (
              <li key={s.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <StatusDot tone={s.configured ? "success" : "neutral"} />
                <span>{t(`admin.system.services.${s.key}`)}</span>
                <span className={`ms-auto text-xs ${s.configured ? "text-success" : "text-muted-foreground"}`}>{s.configured ? t("admin.system.configured") : t("admin.system.notConfigured")}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card>
        <CardHeader title={t("admin.system.queues")} />
        <Table>
          <THead>
            <Tr>
              <Th>{t("admin.system.queue")}</Th>
              <Th>{t("admin.system.waiting")}</Th>
              <Th>{t("admin.system.active")}</Th>
              <Th>{t("admin.system.delayed")}</Th>
              <Th>{t("admin.system.failed")}</Th>
              <Th>{t("admin.system.completed")}</Th>
            </Tr>
          </THead>
          <TBody>
            {queues.map((q) => (
              <Tr key={q.name}>
                <Td className="font-mono text-xs">{q.name}</Td>
                {q.available ? (
                  <>
                    <Td className="tabular">{n(q.waiting + q.paused)}</Td>
                    <Td className="tabular">{n(q.active)}</Td>
                    <Td className="tabular">{n(q.delayed)}</Td>
                    <Td className={q.failed ? "tabular text-danger" : "tabular"}>{n(q.failed)}</Td>
                    <Td className="tabular text-muted-foreground">{n(q.completed)}</Td>
                  </>
                ) : (
                  <Td colSpan={5} className="text-xs text-muted-foreground">
                    {t("admin.overview.unavailable")}
                  </Td>
                )}
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
      <Card>
        <CardHeader title={t("admin.system.workers")} />
        {heartbeats.length === 0 ? (
          <Empty>{t("admin.system.noHeartbeat")}</Empty>
        ) : (
          <ul className="divide-y">
            {heartbeats.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-xs">
                <StatusDot tone={h.alive ? "success" : "danger"} />
                <span className="font-mono">{`${h.hostname}:${h.pid}`}</span>
                <span className="text-muted-foreground">{t("admin.system.startedAt", { time: formatDateTime(h.startedAt, locale, tz) })}</span>
                <span className="ms-auto">{formatRelativeTime(h.lastSeenAt, locale, now)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title={t("admin.system.recentErrors")} description={t("admin.system.recentErrorsHint")} />
        {errors.tasks.length + errors.syncs.length + errors.runs.length + errors.deliveries.length + failed.length === 0 ? (
          <Empty>{t("admin.system.noErrors")}</Empty>
        ) : (
          <ul className="divide-y text-xs">
            {failed.map((j) => (
              <li key={`${j.queue}-${j.id}`} className="flex flex-wrap gap-2 px-4 py-2">
                <Badge tone="danger">{t("admin.system.kinds.job")}</Badge>
                <span className="font-mono">
                  {j.queue}/{j.name}
                </span>
                <span className="min-w-0 truncate text-danger">{j.reason}</span>
                <span className="ms-auto text-muted-foreground">{j.at ? formatDateTime(new Date(j.at), locale, tz) : ""}</span>
              </li>
            ))}
            {errors.tasks.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-2 px-4 py-2">
                <Badge tone="danger">{t("admin.system.kinds.task")}</Badge>
                <span className="max-w-64 truncate">{e.title}</span>
                <span className="font-mono text-danger">{e.errorCode}</span>
                <span className="ms-auto text-muted-foreground">{e.completedAt ? formatDateTime(e.completedAt, locale, tz) : ""}</span>
              </li>
            ))}
            {errors.syncs.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-2 px-4 py-2">
                <Badge tone="danger">{t("admin.system.kinds.sync")}</Badge>
                <span className="font-mono">
                  {e.provider}/{e.kind}
                </span>
                <span className="text-danger">{t("admin.system.errorCount", { count: e.errorCount })}</span>
                <span className="ms-auto text-muted-foreground">{formatDateTime(e.startedAt, locale, tz)}</span>
              </li>
            ))}
            {errors.runs.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-2 px-4 py-2">
                <Badge tone="danger">{t("admin.system.kinds.workflow")}</Badge>
                <span className="max-w-64 truncate">{e.workflow.name}</span>
                <span className="min-w-0 truncate text-danger">{e.error ?? ""}</span>
                <span className="ms-auto text-muted-foreground">{formatDateTime(e.finishedAt ?? e.createdAt, locale, tz)}</span>
              </li>
            ))}
            {errors.deliveries.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-2 px-4 py-2">
                <Badge tone="danger">{t("admin.system.kinds.webhook")}</Badge>
                <span className="font-mono">{e.eventType}</span>
                <span className="min-w-0 truncate text-danger">
                  {e.lastStatusCode ? `HTTP ${e.lastStatusCode} ` : ""}
                  {e.lastError ?? ""}
                </span>
                <span className="ms-auto text-muted-foreground">{formatDateTime(e.updatedAt, locale, tz)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
