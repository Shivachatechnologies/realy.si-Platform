import Link from "next/link";
import { Activity, Bot, Building2, CircleDollarSign, Cpu, Gauge as GaugeIcon, Hourglass, KeyRound, Radar, SlidersHorizontal, UserPlus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CountUp } from "@/components/motion/count-up";
import { LiveDot } from "@/components/motion/live-dot";
import { SystemPulse } from "@/components/motion/system-pulse";
import { AdminHeader, AuditTimeline, EmptyState, SectionLink, StatGrid, StatTile, guard, usd } from "@/components/admin/kit";
import { AutoRefresh, BarList, FleetGrid, Gauge, Sparkline, StatusRing, TrendChart, type RingCheck } from "@/components/admin/viz";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatMoney, formatNumber, formatRelativeTime } from "@/i18n/format";
import { platformOverview } from "@/server/modules/admin/overview";
import { platformTrends } from "@/server/modules/admin/trends";
import { requestTime, requireViewer } from "@/server/session";

const CORE = new Set(["database", "redis"]);
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);

/** Overview "control room": live health ring, KPIs with 30-day trends, AI fleet, queues and the admin activity timeline. */
export default async function AdminOverviewPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(Promise.all([platformOverview(viewer.ctx), platformTrends(viewer.ctx)]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [o, tr] = r.value;
  const base = `/${locale}/admin`;
  const tz = viewer.user.timezone;
  const now = requestTime();
  const n = (v: number) => formatNumber(v, locale);

  const checks: RingCheck[] = (["database", "redis", "email", "ai", "stripe"] as const).map((k) => ({
    key: k,
    label: t(`admin.health.${k}`),
    state: o.health[k] ? "ok" : CORE.has(k) ? "down" : "off",
  }));
  const okCount = checks.filter((c) => c.state === "ok").length;
  const coreDown = checks.some((c) => c.state === "down");
  const queuesUp = o.queues.filter((q) => q.available);
  const queueMax = Math.max(10, ...queuesUp.map((q) => q.waiting + q.active + q.delayed));
  const [mrr0, ...mrrRest] = o.mrr;

  return (
    <div className="grid gap-5">
      <AdminHeader
        eyebrow={t("admin.title")}
        icon={<Radar />}
        title={t("admin.overview.controlRoom")}
        description={t("admin.overview.controlRoomHint")}
        why={t("admin.overview.why")}
        actions={
          <>
            <AutoRefresh loadedAt={now} timeZone={tz} label={t("admin.live.on")} pausedLabel={t("admin.live.paused")} pauseLabel={t("admin.live.pause")} resumeLabel={t("admin.live.resume")} />
            <Button asChild size="sm">
              <Link href={`${base}/controls`}>
                <SlidersHorizontal aria-hidden />
                {t("admin.overview.openControls")}
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section aria-labelledby="health-title" className="control-room reveal relative overflow-hidden rounded-xl border bg-background p-5 shadow-elev-3">
          <div aria-hidden className="pointer-events-none absolute -end-24 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,var(--aurora-1),transparent)]" />
          <div aria-hidden className="pointer-events-none absolute -bottom-28 -start-16 size-72 rounded-full bg-[radial-gradient(closest-side,var(--aurora-2),transparent)]" />
          <div className="relative flex flex-col items-center gap-5 sm:flex-row sm:items-center">
            <StatusRing
              checks={checks}
              center={
                <span className={coreDown ? "text-danger" : "text-success"}>
                  {okCount}/{checks.length}
                </span>
              }
              sub={t("admin.overview.checksOk")}
            />
            <div className="grid w-full min-w-0 flex-1 gap-3">
              <div>
                <h2 id="health-title" className="flex items-center gap-2 text-base font-semibold">
                  <LiveDot tone={coreDown ? "danger" : "success"} />
                  {coreDown ? t("admin.overview.statusDegraded") : t("admin.overview.statusAllGood")}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{coreDown ? t("admin.overview.statusDegradedHint") : t("admin.overview.statusAllGoodHint")}</p>
              </div>
              <ul className="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2">
                {checks.map((c) => (
                  <li key={c.key} className="flex items-center gap-2 rounded-md border bg-surface/60 px-2.5 py-1.5 text-xs">
                    <LiveDot tone={c.state === "ok" ? "success" : c.state === "down" ? "danger" : "neutral"} pulse={c.state === "ok"} />
                    <span className="font-medium">{c.label}</span>
                    <span className={`ms-auto ${c.state === "ok" ? "text-success" : c.state === "down" ? "text-danger" : "text-muted-foreground"}`}>{t(`admin.overview.check.${c.state}`)}</span>
                  </li>
                ))}
              </ul>
              <SectionLink href={`${base}/system`}>{t("admin.overview.openSystem")}</SectionLink>
            </div>
          </div>
        </section>

        <Card variant="elevated" className="reveal [--i:1]">
          <CardHeader icon={<Bot />} title={t("admin.overview.fleetTitle")} description={t("admin.overview.fleetHint")} actions={<SectionLink href={`${base}/ai`}>{t("admin.overview.viewAll")}</SectionLink>} />
          <CardBody className="grid gap-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <SystemPulse active={o.tasks.running > 0} tone={o.tasks.running > 0 ? "success" : "neutral"} label={t("admin.overview.workingNow", { count: o.tasks.running })} />
              <Link href={`${base}/ai/tasks?status=QUEUED`} className="text-xs text-muted-foreground hover:text-foreground">
                {t("admin.overview.queuedCount", { count: o.tasks.queued })}
              </Link>
              <Link href={`${base}/ai/tasks?status=FAILED`} className={`text-xs hover:underline ${o.tasks.failed24h ? "text-danger" : "text-muted-foreground"}`}>
                {t("admin.overview.failed24h", { count: o.tasks.failed24h })}
              </Link>
              <span className="text-xs text-muted-foreground">{t("admin.overview.completed24h", { count: tr.completed24h })}</span>
            </div>
            <FleetGrid
              active={o.aiEmployees.active}
              paused={o.aiEmployees.paused}
              running={o.tasks.running}
              legend={`${t("admin.overview.fleetLegend", { active: n(o.aiEmployees.active), paused: n(o.aiEmployees.paused) })} · ${t("admin.overview.fleetPer", { count: Math.max(1, Math.ceil((o.aiEmployees.active + o.aiEmployees.paused) / 64)) })}`}
            />
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("admin.overview.busiestRoles")}</div>
              <BarList
                label={t("admin.overview.busiestRoles")}
                tone="success"
                items={tr.fleet.map((f) => ({
                  key: f.profile,
                  label: (
                    <span className="inline-flex items-center gap-2">
                      <LiveDot tone={f.running ? "success" : "neutral"} pulse={f.running > 0} />
                      {t(`profiles.${f.profile}.name`)}
                    </span>
                  ),
                  value: f.running + f.queued,
                  display: t("admin.overview.roleLoad", { running: f.running, queued: f.queued }),
                  href: `${base}/ai/tasks?profile=${f.profile}`,
                }))}
                empty={<p className="text-xs text-muted-foreground">{t("admin.overview.noActiveTasks")}</p>}
              />
            </div>
          </CardBody>
        </Card>
      </div>

      <StatGrid>
        <StatTile
          icon={<Users />}
          label={t("admin.overview.users")}
          value={<CountUp value={o.users} />}
          hint={t("admin.overview.newUsers", { d7: n(o.registrations.d7), d30: n(o.registrations.d30) })}
          href={`${base}/users`}
          spark={<Sparkline values={tr.registrations} label={t("admin.overview.sparkRegistrations")} />}
        />
        <StatTile
          icon={<Activity />}
          live
          label={t("admin.overview.activeUsers")}
          value={<CountUp value={o.active.d7} />}
          hint={t("admin.overview.active30", { count: n(o.active.d30) })}
          href={`${base}/users?login=7d`}
          spark={<Sparkline values={tr.signIns} tone="success" label={t("admin.overview.sparkSignIns")} />}
        />
        <StatTile
          icon={<UserPlus />}
          label={t("admin.overview.registrations")}
          value={<CountUp value={sum(tr.registrations)} />}
          hint={t("admin.overview.last30")}
          href={`${base}/users?created=30d`}
          spark={<Sparkline values={tr.registrations} tone="info" label={t("admin.overview.sparkRegistrations")} />}
        />
        <StatTile
          icon={<Building2 />}
          label={t("admin.overview.organizations")}
          value={<CountUp value={o.organizations} />}
          hint={t("admin.overview.companiesSuspended", { companies: n(o.companies), suspended: n(o.suspendedOrgs) })}
          href={`${base}/organizations`}
          tone={o.suspendedOrgs ? "warning" : undefined}
          spark={<Sparkline values={tr.organizations} label={t("admin.overview.sparkOrganizations")} />}
        />
        <StatTile
          icon={<CircleDollarSign />}
          label={mrr0 ? t("admin.overview.mrr") : t("admin.overview.subscriptions")}
          value={mrr0 ? <CountUp money={{ amountMinor: mrr0.amountMinor.toString(), currency: mrr0.currency }} /> : <CountUp value={o.subscriptions.live} />}
          hint={
            mrr0
              ? [t("admin.overview.liveSubscriptions", { count: o.subscriptions.live }), ...mrrRest.map((m) => formatMoney({ amountMinor: m.amountMinor, currency: m.currency }, locale))].join(" · ")
              : t("admin.overview.noMrr")
          }
          href={`${base}/subscriptions`}
          spark={<Sparkline values={tr.subscriptions} tone="success" label={t("admin.overview.sparkSubscriptions")} />}
        />
        <StatTile
          icon={<Cpu />}
          label={t("admin.overview.aiTasks30")}
          value={<CountUp value={sum(tr.tasksCreated)} />}
          hint={t("admin.overview.tasksHint", { queued: n(o.tasks.queued), failed: n(o.tasks.failed24h) })}
          href={`${base}/ai/tasks`}
          tone={o.tasks.failed24h ? "danger" : undefined}
          spark={<Sparkline values={tr.tasksCreated} label={t("admin.overview.sparkTasks")} />}
        />
        <StatTile
          icon={<Bot />}
          label={t("admin.overview.aiUsage")}
          value={<CountUp value={o.aiMonth.tokens} format="compact" />}
          hint={t("admin.overview.aiCost", { cost: usd(o.aiMonth.costMicros, locale) })}
          href={`${base}/ai/usage`}
          spark={<Sparkline values={tr.ai.costMicros} tone="warning" label={t("admin.overview.sparkCost")} />}
        />
        <StatTile icon={<KeyRound />} label={t("admin.overview.apiUsage")} value={<CountUp value={o.apiRequests30} format="compact" />} hint={t("admin.overview.last30")} href={`${base}/integrations`} />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader icon={<Activity />} title={t("admin.overview.activityChart")} description={t("admin.overview.activityChartHint")} />
          <CardBody>
            <TrendChart
              title={t("admin.overview.activityChart")}
              days={tr.days}
              series={[
                { label: t("admin.overview.seriesSignIns"), values: tr.signIns, tone: "success" },
                { label: t("admin.overview.seriesRegistrations"), values: tr.registrations, tone: "primary" },
                { label: t("admin.overview.seriesTasksFailed"), values: tr.tasksFailed, tone: "danger" },
              ]}
            />
          </CardBody>
        </Card>
        <div className="grid content-start gap-4">
          <Link
            href={`${base}/ai/tasks`}
            className={`reveal hover-lift relative block overflow-hidden rounded-lg border p-4 shadow-elev-1 focus-visible:outline-2 ${o.pendingApprovals ? "border-warning/40 bg-warning/6" : "bg-surface"}`}
          >
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Hourglass className="size-3.5 text-warning" aria-hidden />
              {t("admin.overview.approvals")}
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className={`text-3xl font-semibold tabular-nums ${o.pendingApprovals ? "text-warning" : ""}`}>
                <CountUp value={o.pendingApprovals} />
              </span>
              {o.pendingApprovals ? (
                <Badge tone="warning" pulse>
                  {t("admin.overview.waiting")}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t("admin.overview.approvalsHint")}</p>
          </Link>
          <Card>
            <CardHeader icon={<GaugeIcon />} title={t("admin.overview.queuesTitle")} actions={<SectionLink href={`${base}/system`}>{t("admin.overview.viewAll")}</SectionLink>} />
            <CardBody>
              {queuesUp.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("admin.overview.unavailable")}</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {o.queues.map((q) => (
                    <Gauge
                      key={q.name}
                      label={q.name}
                      value={q.waiting + q.active + q.delayed}
                      max={queueMax}
                      tone={q.failed ? "danger" : q.waiting > 50 ? "warning" : "success"}
                      display={q.available ? n(q.waiting) : "—"}
                      sub={q.available ? t("admin.overview.queueSub", { active: n(q.active), failed: n(q.failed) }) : t("admin.overview.offline")}
                    />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader icon={<Activity />} title={t("admin.overview.recentActivity")} actions={<SectionLink href={`${base}/audit`}>{t("admin.overview.viewAll")}</SectionLink>} />
        {o.recentAdmin.length === 0 ? (
          <EmptyState icon={<Activity />} title={t("admin.audit.empty")} body={t("admin.overview.activityEmptyHint")} />
        ) : (
          <AuditTimeline
            items={o.recentAdmin.map((a) => ({
              id: a.id,
              who: a.actorEmail ?? a.actorType,
              action: a.action,
              security: a.category === "SECURITY",
              reason: a.reason,
              iso: a.createdAt.toISOString(),
              exact: formatDateTime(a.createdAt, locale, tz),
              relative: formatRelativeTime(a.createdAt, locale, now),
            }))}
          />
        )}
      </Card>
    </div>
  );
}
