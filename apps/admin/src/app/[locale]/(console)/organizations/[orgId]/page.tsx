import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, Blocks, Bot, Building2, CreditCard, Lock, ShieldBan, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AnimatedProgress } from "@/components/motion/animated-progress";
import { CountUp } from "@/components/motion/count-up";
import { AdminHeader, AuditTimeline, Avatar, EmptyState, Facts, SectionLink, StatGrid, StatTile, guard, usd } from "@/components/admin/kit";
import { OrgRestrictions, OrgStatusButton, TenantViewGate } from "@/components/admin/org-actions";
import { OrgAdminExtras, OrgTabs } from "@/components/admin/people-extras";
import { Sparkline, TrendChart } from "@/components/admin/viz";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatDateTime, formatNumber, formatRelativeTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { PLATFORM_MODULES } from "@/server/core/platform-controls";
import { canPlatform } from "@/server/modules/admin/access";
import { getPlatformOrganization, hasTenantViewGrant } from "@/server/modules/admin/tenants";
import { organizationTrends } from "@/server/modules/admin/people-trends";
import { requestTime, requireViewer } from "@/server/session";

const STATUS_TONE = { ACTIVE: "success", SUSPENDED: "danger", CLOSED: "neutral" } as const;
const TASK_TONE: Record<string, "danger" | "success" | "neutral" | "accent"> = { FAILED: "danger", COMPLETED: "success", CANCELLED: "neutral" };

/** One organization (after the audited reason gate): plan & limits, usage charts, modules, members, AI and activity. */
export default async function AdminOrganizationPage({ params }: PageProps<"/[locale]/organizations/[orgId]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { orgId } = await params;
  const base = `/${locale}`;
  if (!(await canPlatform(viewer.ctx, "platform.organizations.read"))) return <Notice tone="warning">{t("errors.forbidden")}</Notice>;
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  if (!(await hasTenantViewGrant(viewer.ctx, orgId))) {
    const org = await db().organization.findUnique({ where: { id: orgId }, select: { name: true } });
    if (!org) notFound();
    return (
      <div className="grid gap-5">
        <AdminHeader icon={<Lock />} title={org.name} description={t("admin.organizations.gateNote")} />
        <TenantViewGate organizationId={orgId} name={org.name} />
      </div>
    );
  }
  const r = await guard(Promise.all([getPlatformOrganization(viewer.ctx, orgId), organizationTrends(viewer.ctx, orgId)]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [o, tr] = r.value;
  const canManage = await canPlatform(viewer.ctx, "platform.organizations.manage");
  const tz = viewer.user.timezone;
  const now = requestTime();
  const sub = o.subscriptions[0];
  const n = (v: number) => formatNumber(v, locale);
  const activeMembers = o.members.filter((m) => m.status === "ACTIVE").length;
  const liveCompanies = o.companies.filter((c) => !c.deletedAt).length;
  const apiUsed = o.usage.find((u) => u.meter === "api.request")?.quantity ?? 0;
  const meter = (label: string, used: number, limit: number | null) => (
    <div key={label} className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">{limit === null ? t("admin.organizations.detail.ofUnlimited", { used: n(used) }) : t("admin.organizations.detail.ofLimit", { used: n(used), limit: n(limit) })}</span>
      </div>
      <AnimatedProgress value={limit === null ? 0 : used} max={limit === null ? 1 : Math.max(1, limit)} label={label} tone={limit !== null && used >= limit ? "danger" : limit !== null && used >= limit * 0.8 ? "warning" : "primary"} size="sm" />
    </div>
  );
  const maxModule = Math.max(1, ...o.modules.map((m) => Object.values(m.counts).reduce((a, b) => a + b, 0)));

  return (
    <div className="grid gap-5">
      <OrgTabs locale={locale} orgId={orgId} active="overview" />
      <nav aria-label={t("admin.common.breadcrumb")} className="text-xs text-muted-foreground">
        <Link href={`${base}/organizations`} className="hover:text-foreground hover:underline">
          {t("admin.nav.companies")}
        </Link>
        <span aria-hidden> / </span>
        <span>{o.name}</span>
      </nav>
      <AdminHeader
        icon={<Building2 />}
        title={o.name}
        description={t("admin.organizations.detail.subtitle", { slug: o.slug, date: formatDate(o.createdAt, locale, tz) })}
        meta={
          <>
            <Badge shape="pill" tone={STATUS_TONE[o.status]}>
              {t(`admin.organizations.status.${o.status}`)}
            </Badge>
            <Badge shape="pill" tone={sub ? "accent" : "neutral"}>
              {sub ? `${sub.plan.name} · ${t(`admin.subscriptions.status.${sub.status}`)}` : t("admin.organizations.noSubscription")}
            </Badge>
            {o.override.aiDisabled ? (
              <Badge shape="pill" tone="danger">
                {t("admin.organizations.aiDisabled")}
              </Badge>
            ) : null}
          </>
        }
        actions={
          <>
            {canManage ? <OrgStatusButton organizationId={o.id} slug={o.slug} status={o.status} /> : null}
            <OrgRestrictions organizationId={o.id} value={o.override} modules={[...PLATFORM_MODULES]} canManage={canManage} />
          </>
        }
      />

      <StatGrid>
        <StatTile icon={<Users />} label={t("admin.organizations.columns.members")} value={<CountUp value={activeMembers} />} hint={o.owners.map((u) => u.email).join(", ") || "—"} />
        <StatTile icon={<Building2 />} label={t("admin.organizations.columns.companies")} value={<CountUp value={liveCompanies} />} hint={t("admin.organizations.detail.inModules", { count: o.modules.filter((m) => Object.values(m.counts).some((v) => v > 0)).length })} />
        <StatTile
          icon={<Bot />}
          label={t("admin.organizations.detail.aiTasks30")}
          value={<CountUp value={o.ai.tasks30d} />}
          hint={t("admin.organizations.detail.failed", { count: n(o.ai.failed30d) })}
          tone={o.ai.failed30d ? "warning" : undefined}
          href={`${base}/ai/tasks?org=${o.id}`}
          spark={tr ? <Sparkline values={tr.ai.tasks} label={t("admin.organizations.detail.aiTasks30")} /> : null}
        />
        <StatTile
          icon={<Activity />}
          label={t("admin.organizations.detail.aiTokensMonth")}
          value={<CountUp value={o.ai.month.tokens} format="compact" />}
          hint={t("admin.overview.aiCost", { cost: usd(o.ai.month.costMicros, locale) })}
          spark={tr ? <Sparkline values={tr.ai.costMicros} tone="warning" label={t("admin.organizations.detail.cost30")} /> : null}
        />
      </StatGrid>

      {tr ? (
        <Card>
          <CardHeader icon={<Activity />} title={t("admin.organizations.detail.usageChart")} description={t("admin.organizations.detail.usageChartHint")} />
          <CardBody className="grid gap-6 lg:grid-cols-2">
            <TrendChart
              title={t("admin.organizations.detail.usageChart")}
              days={tr.days}
              height={150}
              series={[
                { label: t("admin.organizations.detail.seriesTasks"), values: tr.ai.tasks, tone: "primary" },
                { label: t("admin.organizations.detail.seriesFailed"), values: tr.failed, tone: "danger" },
                { label: t("admin.organizations.detail.seriesApi"), values: tr.apiRequests, tone: "info" },
              ]}
            />
            <TrendChart title={t("admin.organizations.detail.cost30")} days={tr.days} height={150} series={[{ label: t("admin.organizations.detail.seriesCost"), values: tr.ai.costMicros, tone: "warning", format: "usdMicros" }]} />
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<CreditCard />} title={t("admin.organizations.detail.plan")} description={sub?.currentPeriodEnd ? `${t("admin.subscriptions.periodEnd")}: ${formatDate(sub.currentPeriodEnd, locale, tz)}` : undefined} />
          <CardBody className="grid gap-4">
            {meter(t("admin.plans.limits.seats.max"), activeMembers, o.plan.seats)}
            {meter(t("admin.plans.limits.companies.max"), liveCompanies, o.plan.companies)}
            {meter(t("admin.plans.limits.ai.tokens.month"), o.ai.month.tokens, o.plan.aiTokensPerMonth)}
            {meter(t("admin.plans.limits.api.calls.month"), apiUsed, o.plan.apiCallsPerMonth)}
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<ShieldBan />} title={t("admin.organizations.restrictions")} description={t("admin.organizations.restrictionsHint")} />
          <Facts
            rows={[
              [t("admin.organizations.disabledModules"), o.override.disabledModules.length ? o.override.disabledModules.map((m) => t(`platformModules.${m}`)).join(", ") : t("admin.controls.none")],
              [t("admin.organizations.aiDisabled"), o.override.aiDisabled ? t("admin.controls.on") : t("admin.controls.off")],
              [t("admin.organizations.aiDaily"), o.override.aiDailyTokenBudget === null ? "∞" : n(o.override.aiDailyTokenBudget)],
              [t("admin.organizations.aiMonthly"), o.override.aiMonthlyTokenBudget === null ? "∞" : n(o.override.aiMonthlyTokenBudget)],
              [t("admin.organizations.detail.usage"), o.usage.map((u) => `${u.meter}: ${n(u.quantity)}`).join(" · ") || "—"],
            ]}
          />
        </Card>
      </div>

      <Card>
        <CardHeader icon={<Blocks />} title={t("admin.organizations.detail.modules")} description={t("admin.organizations.detail.modulesHint")} />
        <ul className="stagger grid grid-cols-1 gap-3 p-4 min-[420px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {o.modules.map((m) => {
            const total = Object.values(m.counts).reduce((a, b) => a + b, 0);
            const disabled = o.override.disabledModules.includes(m.module as (typeof PLATFORM_MODULES)[number]);
            return (
              <li key={m.module} className={`rounded-lg border p-3 ${total ? "bg-surface" : "bg-surface-2/50"}`}>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{t(`platformModules.${m.module}`)}</span>
                  {disabled ? <Badge tone="danger">{t("admin.controls.disabled")}</Badge> : total ? <Badge tone="success">{t("admin.organizations.detail.inUse")}</Badge> : null}
                </div>
                <AnimatedProgress className="mt-2" value={total} max={maxModule} label={t(`platformModules.${m.module}`)} tone={total ? "success" : "neutral"} size="sm" />
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  {Object.entries(m.counts)
                    .map(([k, v]) => `${t(`admin.organizations.counts.${k}`)}: ${n(v)}`)
                    .join(" · ")}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<Users />} title={t("admin.organizations.detail.members")} />
          {o.members.length === 0 ? (
            <EmptyState icon={<Users />} title={t("admin.organizations.detail.noMembers")} />
          ) : (
            <ul className="divide-y">
              {o.members.map((m) => (
                <li key={m.user.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar name={m.user.name || m.user.email} size="sm" />
                  <div className="min-w-0 flex-1">
                    <Link href={`${base}/users/${m.user.id}`} className="truncate text-sm font-medium hover:underline">
                      {m.user.name}
                    </Link>
                    <div className="truncate text-xs text-muted-foreground">{m.user.email}</div>
                  </div>
                  <span className="hidden max-w-40 truncate font-mono text-[11px] text-muted-foreground sm:block">{m.roles.join(", ") || "—"}</span>
                  <Badge shape="pill" tone={m.status === "ACTIVE" ? "success" : "neutral"}>
                    {t(`admin.users.status.${m.user.status}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader icon={<Building2 />} title={t("admin.organizations.columns.companies")} />
          {o.companies.length === 0 ? (
            <EmptyState icon={<Building2 />} title={t("admin.organizations.detail.noCompanies")} body={t("admin.organizations.detail.noCompaniesHint")} />
          ) : (
            <ul className="divide-y">
              {o.companies.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <Avatar name={c.name} size="sm" square />
                  <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                  <Badge>{c.stage}</Badge>
                  {c.deletedAt ? <Badge tone="danger">{t("admin.organizations.detail.deleted")}</Badge> : null}
                  <span className="hidden text-xs text-muted-foreground sm:inline">{formatDate(c.createdAt, locale, tz)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader icon={<Bot />} title={t("admin.organizations.detail.recentTasks")} actions={<SectionLink href={`${base}/ai/tasks?org=${o.id}`}>{t("admin.overview.viewAll")}</SectionLink>} />
        {o.ai.recentTasks.length === 0 ? (
          <EmptyState icon={<Bot />} title={t("admin.ai.noTasks")} body={t("admin.organizations.detail.noTasksHint")} />
        ) : (
          <ul className="divide-y">
            {o.ai.recentTasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{task.title}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {task.profile} · {task.model ?? "—"}
                  </div>
                </div>
                <Badge tone={TASK_TONE[task.status] ?? "accent"} pulse={task.status === "RUNNING"}>
                  {t(`admin.ai.status.${task.status}`)}
                </Badge>
                {task.errorCode ? <span className="font-mono text-[11px] text-danger">{task.errorCode}</span> : null}
                <span className="w-20 text-end text-xs tabular-nums text-muted-foreground">{n((task.inputTokens ?? 0) + (task.outputTokens ?? 0))}</span>
                <time dateTime={task.createdAt.toISOString()} title={formatDateTime(task.createdAt, locale, tz)} className="w-24 text-end text-xs text-muted-foreground">
                  {formatRelativeTime(task.createdAt, locale, now)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader icon={<Activity />} title={t("admin.organizations.detail.activity")} actions={<SectionLink href={`${base}/audit?org=${o.id}&scope=all`}>{t("admin.overview.viewAll")}</SectionLink>} />
        {o.activity.length === 0 ? (
          <EmptyState icon={<Activity />} title={t("admin.audit.empty")} />
        ) : (
          <AuditTimeline
            items={o.activity.map((a) => ({
              id: a.id,
              who: a.actorType === "USER" ? (o.members.find((m) => m.user.id === a.actorId)?.user.email ?? t("admin.users.detail.byAdmin")) : a.actorType,
              action: a.action,
              security: a.category === "SECURITY",
              reason: a.reason,
              iso: a.createdAt.toISOString(),
              exact: formatDateTime(a.createdAt, locale, tz),
              relative: formatRelativeTime(a.createdAt, locale, now),
              extra: <span className="font-mono text-[11px] text-muted-foreground">{`${a.resourceType}${a.resourceId ? `:${a.resourceId.slice(0, 8)}` : ""}`}</span>,
            }))}
          />
        )}
      </Card>
      <OrgAdminExtras ctx={viewer.ctx} locale={locale} org={{ id: o.id, name: o.name, slug: o.slug, defaultLocale: o.defaultLocale }} />
    </div>
  );
}
