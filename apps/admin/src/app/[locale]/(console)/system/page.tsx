import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Gauge as GaugeIcon, HeartPulse, ListX, Server, ServerCog } from "lucide-react";
import { CardBody } from "@/components/ui/card";
import { LiveDot } from "@/components/motion/live-dot";
import { AdminHeader, EmptyState, guard } from "@/components/admin/kit";
import { AutoRefresh, Gauge, StatusRing, type RingCheck } from "@/components/admin/viz";
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
  const core = new Set(["database", "redis"]);
  const checks: (RingCheck & { detail: string })[] = [
    ...(["database", "redis", "email", "ai", "stripe"] as const).map((k) => ({
      key: k,
      label: t(`admin.health.${k}`),
      state: (health[k] ? "ok" : core.has(k) ? "down" : "off") as RingCheck["state"],
      detail: core.has(k) ? (health[k] ? t("admin.system.reachable") : t("admin.system.unreachable")) : health[k] ? t("admin.system.configured") : t("admin.system.notConfigured"),
    })),
    {
      key: "worker",
      label: t("admin.system.worker"),
      state: workerAlive ? "ok" : "down",
      detail: heartbeats[0] ? t("admin.system.lastHeartbeat", { time: formatRelativeTime(heartbeats[0].lastSeenAt, locale, now) }) : t("admin.system.noHeartbeat"),
    },
  ];
  const coreDown = checks.some((c) => c.state === "down");
  const queueMax = Math.max(10, ...queues.filter((q) => q.available).map((q) => q.waiting + q.paused + q.active + q.delayed));
  return (
    <div className="grid gap-4">
      <AdminHeader
        icon={<HeartPulse />}
        title={t("admin.nav.system")}
        description={t("admin.system.subtitle")}
        why={t("admin.system.why")}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {(["health", "incidents", "alerts", "errors", "logs", "infra", "releases", "data"] as const).map((k) => (
              <Link key={k} href={`/${locale}/${k}`} className="text-sm font-semibold text-primary hover:underline">
                {t(`admin.system.nav.${k}`)}
              </Link>
            ))}
            <Link href={`/${locale}/system/jobs`} className="text-sm font-semibold text-primary hover:underline">
              {t("admin.system.jobs.title")}
            </Link>
            <AutoRefresh loadedAt={now} timeZone={tz} label={t("admin.live.on")} pausedLabel={t("admin.live.paused")} pauseLabel={t("admin.live.pause")} resumeLabel={t("admin.live.resume")} />
          </div>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section aria-labelledby="sys-health" className="control-room relative overflow-hidden rounded-xl border bg-background p-5 shadow-elev-3">
          <div aria-hidden className="pointer-events-none absolute -end-24 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,var(--aurora-1),transparent)]" />
          <h2 id="sys-health" className="relative mb-4 text-sm font-semibold">
            {t("admin.system.health")}
          </h2>
          <div className="relative flex flex-col items-center gap-5 sm:flex-row">
            <StatusRing checks={checks} center={<span className={coreDown || !workerAlive ? "text-danger" : "text-success"}>{checks.filter((c) => c.state === "ok").length}/{checks.length}</span>} sub={t("admin.overview.checksOk")} />
            <ul className="grid w-full gap-1.5">
              {checks.map((c) => (
                <li key={c.key} className="flex items-center gap-2.5 rounded-md border bg-surface/60 px-3 py-2 text-sm">
                  <LiveDot tone={c.state === "ok" ? "success" : c.state === "down" ? "danger" : "neutral"} pulse={c.state === "ok"} />
                  <span>{c.label}</span>
                  <span className={`ms-auto text-xs ${c.state === "ok" ? "text-success" : c.state === "down" ? "text-danger" : "text-muted-foreground"}`}>{c.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <Card>
          <CardHeader icon={<ServerCog />} title={t("admin.system.title")} description={t("admin.system.description")} />
          <ul className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2">
            {services.map((s) => (
              <li key={s.key} className="flex items-center gap-2.5 bg-surface px-4 py-2.5 text-sm">
                <LiveDot tone={s.configured ? "success" : "neutral"} pulse={false} />
                <span className="min-w-0 truncate">{t(`admin.system.services.${s.key}`)}</span>
                <span className={`ms-auto shrink-0 text-xs ${s.configured ? "text-success" : "text-muted-foreground"}`}>{s.configured ? t("admin.system.configured") : t("admin.system.notConfigured")}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card>
        <CardHeader icon={<GaugeIcon />} title={t("admin.system.queues")} description={t("admin.system.queuesHint")} />
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {queues.map((q) => (
              <div key={q.name} className="grid gap-3 rounded-lg border p-3">
                <Gauge
                  label={q.name}
                  value={q.waiting + q.paused + q.active + q.delayed}
                  max={queueMax}
                  tone={!q.available ? "muted" : q.failed ? "danger" : q.waiting > 50 ? "warning" : "success"}
                  display={q.available ? n(q.waiting + q.paused) : "—"}
                  sub={q.available ? t("admin.system.waiting") : t("admin.overview.unavailable")}
                />
                {q.available ? (
                  <dl className="grid grid-cols-4 gap-1 text-center text-[11px]">
                    {(["active", "delayed", "failed", "completed"] as const).map((k) => (
                      <div key={k}>
                        <dt className="text-muted-foreground">{t(`admin.system.${k}`)}</dt>
                        <dd className={`font-semibold tabular-nums ${k === "failed" && q.failed ? "text-danger" : ""}`}>{n(q[k])}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader icon={<Server />} title={t("admin.system.workers")} />
        {heartbeats.length === 0 ? (
          <EmptyState icon={<Server />} title={t("admin.system.noHeartbeat")} body={t("admin.system.noHeartbeatHint")} />
        ) : (
          <ul className="divide-y">
            {heartbeats.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-xs">
                <LiveDot tone={h.alive ? "success" : "danger"} pulse={h.alive} />
                <span className="font-mono">{`${h.hostname}:${h.pid}`}</span>
                <span className="text-muted-foreground">{t("admin.system.startedAt", { time: formatDateTime(h.startedAt, locale, tz) })}</span>
                <span className="ms-auto">{formatRelativeTime(h.lastSeenAt, locale, now)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader icon={<ListX />} title={t("admin.system.recentErrors")} description={t("admin.system.recentErrorsHint")} />
        {errors.tasks.length + errors.syncs.length + errors.runs.length + errors.deliveries.length + failed.length === 0 ? (
          <EmptyState icon={<HeartPulse />} title={t("admin.system.noErrors")} body={t("admin.system.noErrorsHint")} />
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
