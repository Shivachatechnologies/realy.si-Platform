import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Activity, AlertTriangle, Bot, Building2, CheckCircle2, CircleDashed, CreditCard, Gauge as GaugeIcon, Hourglass, Inbox, Layers, Radar, Siren, Skull, Users } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminHeader, AuditTimeline, EmptyState, SectionLink } from "@/components/admin/kit";
import { KpiTile, kpiDelta } from "@/components/admin/kpi-tile";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { AutoRefresh, TrendChart } from "@/components/admin/viz";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatMoney, formatRelativeTime } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { actionCenter, type ActionItem } from "@/server/modules/admin/action-center";
import { capabilitiesFor } from "@/server/modules/admin/access";
import { commandCenter, isRange, RANGES, recentAdminActivity, type Kpi, type KpiSection, type RangeKey } from "@/server/modules/admin/overview";
import { preferencesFor } from "@/server/modules/admin/preferences";
import { requestTime, requireViewer, type Viewer } from "@/server/session";

type T = Awaited<ReturnType<typeof getT>>;
type CC = Awaited<ReturnType<typeof commandCenter>>;
type AQ = Awaited<ReturnType<typeof actionCenter>>;

const SECTION_ICON: Record<KpiSection["id"], typeof Users> = { users: Users, organizations: Building2, revenue: CreditCard, subscriptions: Layers, ai: Bot, system: GaugeIcon };
const SECTION_LINK: Record<KpiSection["id"], string> = { users: "/users", organizations: "/organizations", revenue: "/revenue", subscriptions: "/subscriptions", ai: "/ai", system: "/system" };

/**
 * Global Command Center v2 (stream A): the first page of the console. KPI sets (users, organizations, revenue,
 * subscriptions, AI, system) for a selectable period, each compared with the period before it and linked to its
 * source list; the platform status strip (health, incidents, alerts, approvals, failed jobs, risks); the top of the
 * Action Center; recent admin activity. Every number is a real count (cached ≤ 30 s, see BE/admin/overview.ts);
 * metrics without a source say "Not yet tracked" and name the stream that will add it. Sections stream in.
 */
export default async function CommandCenterPage({ searchParams }: PageProps<"/[locale]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const params = await searchParams;
  const denied = typeof params.denied === "string" && params.denied ? params.denied.slice(0, 40) : null;
  const prefs = await preferencesFor(viewer.user.id);
  const range: RangeKey = isRange(params.range) ? params.range : isRange(prefs.timeRange) ? prefs.timeRange : "30d";
  const base = `/${locale}`;
  const now = requestTime();

  // Started together; each section awaits only what it renders (Suspense streams them as they resolve).
  const cc = commandCenter(viewer.ctx, range);
  const actions = actionCenter(viewer.ctx);
  const caps = capabilitiesFor(viewer.ctx, ["platform.audit.read", "platform.security.read"]);
  // A rejection surfaces in the section that awaits it (error boundary); do not also report it as unhandled.
  cc.catch(() => undefined);
  actions.catch(() => undefined);

  return (
    <div className="grid gap-5">
      {denied ? <Notice tone="warning">{t("admin.common.sectionDenied", { section: denied })}</Notice> : null}
      <AdminHeader
        eyebrow={t("admin.title")}
        icon={<Radar />}
        title={t("admin.overview.cc.title")}
        description={t("admin.overview.cc.subtitle")}
        why={t("admin.overview.cc.why")}
        actions={
          <>
            <RangePicker base={base} range={range} t={t} />
            <AutoRefresh seconds={60} loadedAt={now} timeZone={viewer.user.timezone} label={t("admin.live.on")} pausedLabel={t("admin.live.paused")} pauseLabel={t("admin.live.pause")} resumeLabel={t("admin.live.resume")} />
          </>
        }
      />

      <Suspense fallback={<StripSkeleton />}>
        <StatusStrip cc={cc} actions={actions} base={base} t={t} />
      </Suspense>

      <Suspense fallback={<SectionsSkeleton />}>
        <KpiSections cc={cc} base={base} t={t} locale={locale} range={range} />
      </Suspense>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Suspense fallback={<Skeleton className="h-72 rounded-lg" />}>
          <AttentionCard actions={actions} base={base} t={t} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-72 rounded-lg" />}>
          <ActivityCard viewer={viewer} caps={caps} base={base} t={t} locale={locale} now={now} />
        </Suspense>
      </div>
    </div>
  );
}

function RangePicker({ base, range, t }: { base: string; range: RangeKey; t: T }) {
  return (
    <nav aria-label={t("admin.overview.cc.range")} className="inline-flex rounded-md border bg-surface p-0.5 text-xs shadow-elev-1">
      {(Object.keys(RANGES) as RangeKey[]).map((r) => (
        <Link
          key={r}
          href={`${base}?range=${r}`}
          aria-current={r === range ? "true" : undefined}
          className={cn("rounded px-2.5 py-1 font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2", r === range && "bg-accent text-accent-foreground")}
        >
          {t(`admin.overview.cc.ranges.${r}`)}
        </Link>
      ))}
    </nav>
  );
}

function StripSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-16 rounded-lg" />
      ))}
    </div>
  );
}

function SectionsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-48 rounded-lg" />
      ))}
    </div>
  );
}

function StripCell({ href, icon, label, value, hint, tone }: { href: string; icon: ReactNode; label: string; value: ReactNode; hint?: ReactNode; tone?: "ok" | "warn" | "bad" | "off" }) {
  return (
    <Link
      href={href}
      className={cn(
        "reveal flex min-w-0 items-start gap-2.5 rounded-lg border bg-surface p-3 shadow-elev-1 hover:border-border-strong focus-visible:outline-2",
        tone === "bad" && "border-danger/40 bg-danger/6",
        tone === "warn" && "border-warning/40 bg-warning/6",
        tone === "off" && "border-dashed bg-surface/60",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground [&_svg]:size-3.5",
          tone === "bad" && "bg-danger/15 text-danger",
          tone === "warn" && "bg-warning/15 text-warning",
          tone === "ok" && "bg-success/12 text-success",
          tone === "off" && "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className="block truncate text-sm font-semibold">{value}</span>
        {hint ? <span className="block truncate text-[11px] text-muted-foreground">{hint}</span> : null}
      </span>
    </Link>
  );
}

async function StatusStrip({ cc, actions, base, t }: { cc: Promise<CC>; actions: Promise<AQ>; base: string; t: T }) {
  const [c, a] = await Promise.all([cc, actions]);
  const s = c.status;
  const risks = a.items.filter((i) => i.severity === "critical" || i.severity === "high");
  return (
    <section aria-label={t("admin.overview.cc.status")} className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
      {s ? (
        <StripCell
          href={`${base}/system`}
          icon={<Activity />}
          label={t("admin.overview.cc.platform")}
          value={s.health.database && s.health.redis ? t("admin.shell.status.operational") : t("admin.shell.status.degraded")}
          hint={`${t("admin.health.database")} ${s.health.database ? "✓" : "✕"} · ${t("admin.health.redis")} ${s.health.redis ? "✓" : "✕"} · ${t("admin.overview.cc.workers", { alive: s.workers.alive, total: s.workers.total })}`}
          tone={s.health.database && s.health.redis ? "ok" : "bad"}
        />
      ) : null}
      {s ? (
        s.ops ? (
          <StripCell
            href={`${base}/incidents`}
            icon={<Siren />}
            label={t("admin.overview.cc.incidents")}
            value={s.ops.incidentsActive ? t("admin.overview.cc.incidentsActive", { count: s.ops.incidentsActive }) : t("admin.overview.cc.none")}
            hint={s.ops.incidentsMajor ? t("admin.overview.cc.incidentsMajor", { count: s.ops.incidentsMajor }) : t("admin.overview.cc.opsSource")}
            tone={s.ops.incidentsMajor ? "bad" : s.ops.incidentsActive ? "warn" : "ok"}
          />
        ) : (
          <StripCell href={`${base}/incidents`} icon={<Siren />} label={t("admin.overview.cc.incidents")} value={t("admin.overview.cc.unavailable")} hint={t("admin.overview.cc.opsSource")} tone="off" />
        )
      ) : null}
      {s ? (
        s.ops ? (
          <StripCell
            href={`${base}/alerts`}
            icon={<AlertTriangle />}
            label={t("admin.overview.cc.alerts")}
            value={s.ops.alertsOpen ? t("admin.overview.cc.alertsOpen", { count: s.ops.alertsOpen }) : t("admin.overview.cc.none")}
            hint={s.ops.alertsCritical ? t("admin.overview.cc.alertsCritical", { count: s.ops.alertsCritical }) : t("admin.overview.cc.opsSource")}
            tone={s.ops.alertsCritical ? "bad" : s.ops.alertsOpen ? "warn" : "ok"}
          />
        ) : (
          <StripCell href={`${base}/alerts`} icon={<AlertTriangle />} label={t("admin.overview.cc.alerts")} value={t("admin.overview.cc.unavailable")} hint={t("admin.overview.cc.opsSource")} tone="off" />
        )
      ) : null}
      {s ? (
        <StripCell
          href={`${base}/ai/tasks`}
          icon={<Hourglass />}
          label={t("admin.overview.cc.approvals")}
          value={s.approvalsPending === 0 ? t("admin.overview.cc.none") : t("admin.overview.cc.approvalsWaiting", { count: s.approvalsPending })}
          hint={
            s.approvalsOldestAt ? (
              <>
                {t("admin.overview.cc.oldest")} <Timestamp value={s.approvalsOldestAt} mode="relative" />
              </>
            ) : (
              t("admin.overview.cc.approvalsHint")
            )
          }
          tone={s.approvalsPending ? "warn" : "ok"}
        />
      ) : null}
      {s ? (
        <StripCell
          href={`${base}/system/jobs?status=DEAD`}
          icon={<Skull />}
          label={t("admin.overview.cc.failedJobs")}
          value={t("admin.overview.cc.deadLetters", { count: s.deadJobs })}
          hint={s.queues.available ? t("admin.overview.cc.queueFailed", { count: s.queues.failed, waiting: s.queues.waiting }) : t("admin.overview.unavailable")}
          tone={s.deadJobs ? "bad" : s.queues.failed ? "warn" : "ok"}
        />
      ) : null}
      <StripCell
        href={`${base}/actions`}
        icon={risks.length ? <AlertTriangle /> : <CheckCircle2 />}
        label={t("admin.overview.cc.risks")}
        value={risks.length ? t("admin.overview.cc.riskCount", { count: risks.length }) : t("admin.overview.cc.noRisks")}
        hint={risks[0] ? t(`admin.actions.kinds.${risks[0].id}.title`, { count: risks[0].count }) : t("admin.overview.cc.risksHint")}
        tone={risks.some((r) => r.severity === "critical") ? "bad" : risks.length ? "warn" : "ok"}
      />
    </section>
  );
}

function kpiValue(k: Kpi, locale: string, t: T) {
  if (k.format === "money") return k.money?.length ? formatMoney({ amountMinor: k.money[0]!.amountMinor, currency: k.money[0]!.currency }, locale) : t("admin.overview.cc.noMoney");
  if (k.value === null) return t("admin.overview.cc.noData");
  if (k.format === "usdMicros") return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: k.value < 10_000_000 ? 2 : 0 }).format(k.value / 1_000_000);
  if (k.format === "percent") return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(k.value / 100);
  return new Intl.NumberFormat(locale, { notation: k.value >= 100_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(k.value);
}

async function KpiSections({ cc, base, t, locale, range }: { cc: Promise<CC>; base: string; t: T; locale: string; range: RangeKey }) {
  const c = await cc;
  if (!c.sections.length) return <EmptyState icon={<CircleDashed />} title={t("admin.overview.cc.noSections")} body={t("admin.overview.cc.noSectionsHint")} />;
  const pct = (p: number) => `${p > 0 ? "+" : ""}${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(p)}%`;
  const compare = t(`admin.overview.cc.vsPrevious.${range}`);
  const users = c.sections.find((s) => s.id === "users");
  const ai = c.sections.find((s) => s.id === "ai");
  const trend = [users?.kpis.find((k) => k.key === "signIns"), users?.kpis.find((k) => k.key === "newUsers"), ai?.kpis.find((k) => k.key === "tasksFailed")].filter((k): k is Kpi => !!k?.series);
  return (
    <div className="grid gap-4">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          {t("admin.overview.cc.period")} <Timestamp value={c.from} mode="absolute" /> – <Timestamp value={c.to} mode="absolute" />
        </span>
        <span>
          {t("admin.shell.updated")} <Timestamp value={new Date(c.computedAt)} mode="relative" /> · {t(`admin.overview.cc.cache.${c.cache}`)}
        </span>
      </p>
      <div className="grid gap-4 2xl:grid-cols-2">
        {c.sections.map((s) => {
          const Icon = SECTION_ICON[s.id];
          return (
            <Card key={s.id} className="reveal">
              <CardHeader icon={<Icon />} title={t(`admin.overview.cc.sections.${s.id}`)} description={t(`admin.overview.cc.sectionHints.${s.id}`)} actions={<SectionLink href={`${base}${SECTION_LINK[s.id]}`}>{t("admin.overview.viewAll")}</SectionLink>} />
              <CardBody className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2 xl:grid-cols-3">
                {s.kpis.map((k) => {
                  const label = t(`admin.overview.cc.kpis.${k.key}`);
                  if (k.status !== "ok")
                    return (
                      <KpiTile
                        key={k.key}
                        label={label}
                        href={`${base}${k.href}`}
                        source={k.source}
                        notTracked={{ title: t("admin.overview.cc.notTracked"), detail: t("admin.overview.cc.needs", { needs: k.missing?.needs ?? k.source, stream: k.missing?.stream ?? "?" }) }}
                      />
                    );
                  const d = kpiDelta(k.value, k.previous, k.better, pct, t("admin.overview.cc.new"));
                  const extraMoney = k.format === "money" && k.money && k.money.length > 1 ? k.money.slice(1).map((m) => formatMoney({ amountMinor: m.amountMinor, currency: m.currency }, locale)).join(" · ") : undefined;
                  const noHistory = k.previous === null && k.missing ? t("admin.overview.cc.noHistory", { needs: k.missing.needs, stream: k.missing.stream }) : undefined;
                  const flagged = k.better === "down" && (k.value ?? 0) > 0 && ["deadJobs", "pastDue", "failedPayments"].includes(k.key);
                  return (
                    <KpiTile
                      key={k.key}
                      label={label}
                      value={kpiValue(k, locale, t)}
                      delta={d}
                      compareLabel={compare}
                      sub={extraMoney ?? noHistory}
                      href={`${base}${k.href}`}
                      source={`${t("admin.overview.cc.source")}: ${k.source}`}
                      spark={k.series}
                      sparkTone={k.better === "down" ? "danger" : "primary"}
                      tone={flagged ? "warning" : undefined}
                    />
                  );
                })}
              </CardBody>
            </Card>
          );
        })}
      </div>
      {trend.length ? (
        <Card>
          <CardHeader icon={<Activity />} title={t("admin.overview.activityChart")} description={t(`admin.overview.cc.chartHint.${range === "24h" ? "hourly" : "daily"}`)} />
          <CardBody>
            <TrendChart
              title={t("admin.overview.activityChart")}
              days={c.buckets}
              series={trend.map((k) => ({ label: t(`admin.overview.cc.kpis.${k.key}`), values: k.series!, tone: k.better === "down" ? "danger" : k.key === "signIns" ? "success" : "primary" }))}
            />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

async function AttentionCard({ actions, base, t }: { actions: Promise<AQ>; base: string; t: T }) {
  const a = await actions;
  const top: ActionItem[] = a.items.slice(0, 6);
  return (
    <Card>
      <CardHeader icon={<Inbox />} title={t("admin.actions.title")} description={t("admin.overview.cc.attentionHint")} actions={<SectionLink href={`${base}/actions`}>{t("admin.overview.viewAll")}</SectionLink>} />
      {top.length === 0 ? (
        <EmptyState icon={<CheckCircle2 />} title={t("admin.actions.allClear")} body={t("admin.actions.allClearHint")} />
      ) : (
        <ul className="divide-y">
          {top.map((i) => (
            <li key={i.id}>
              <Link href={`${base}${i.href}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50 focus-visible:outline-2">
                <StatusBadge domain="actionSeverity" value={i.severity}>
                  {t(`admin.actions.severity.${i.severity}`)}
                </StatusBadge>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t(`admin.actions.kinds.${i.id}.title`, { count: i.count })}</span>
                  <span className="block truncate text-xs text-muted-foreground">{t(`admin.actions.kinds.${i.id}.next`)}</span>
                </span>
                {i.oldestAt ? (
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    <Timestamp value={i.oldestAt} mode="relative" />
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {a.failed.length ? <p className="border-t px-4 py-2 text-xs text-warning">{t("admin.actions.someUnavailable", { count: a.failed.length })}</p> : null}
    </Card>
  );
}

async function ActivityCard({ viewer, caps, base, t, locale, now }: { viewer: Viewer; caps: Promise<Record<"platform.audit.read" | "platform.security.read", boolean>>; base: string; t: T; locale: string; now: number }) {
  const c = await caps;
  if (!c["platform.audit.read"] && !c["platform.security.read"]) return null;
  const rows = await recentAdminActivity(viewer.ctx);
  const tz = viewer.user.timezone;
  return (
    <Card>
      <CardHeader icon={<Activity />} title={t("admin.overview.recentActivity")} actions={<SectionLink href={`${base}/audit`}>{t("admin.overview.viewAll")}</SectionLink>} />
      {rows.length === 0 ? (
        <EmptyState icon={<Activity />} title={t("admin.audit.empty")} body={t("admin.overview.activityEmptyHint")} />
      ) : (
        <AuditTimeline
          items={rows.map((a) => ({
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
  );
}
