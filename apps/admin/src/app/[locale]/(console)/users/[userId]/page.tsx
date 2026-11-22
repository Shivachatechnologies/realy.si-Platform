import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, Bot, Building2, CircleUser, Fingerprint, KeyRound, LogIn, MonitorSmartphone, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CountUp } from "@/components/motion/count-up";
import { LiveDot } from "@/components/motion/live-dot";
import { AdminHeader, AuditTimeline, Avatar, EmptyState, Facts, StatGrid, StatTile, guard, usd } from "@/components/admin/kit";
import { PlatformRoleGrant, PlatformRoleRevoke, UserActions } from "@/components/admin/user-actions";
import { UserStatusButton } from "@/components/admin/user-status-button";
import { UserAdminExtras } from "@/components/admin/people-extras";
import { Sparkline, TrendChart } from "@/components/admin/viz";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatDateTime, formatRelativeTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { canPlatform } from "@/server/modules/admin/access";
import { userTrends } from "@/server/modules/admin/people-trends";
import { PLATFORM_ROLE_KEYS, getPlatformUser } from "@/server/modules/admin/users";
import { requestTime, requireViewer } from "@/server/session";

const STATUS_TONE = { ACTIVE: "success", SUSPENDED: "warning", DELETED: "danger" } as const;

/** One user: account, memberships, sessions timeline, usage charts, AI usage and security log. */
export default async function AdminUserPage({ params }: PageProps<"/[locale]/users/[userId]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { userId } = await params;
  const r = await guard(
    Promise.all([
      getPlatformUser(viewer.ctx, userId).catch((e) => {
        if (isAppError(e) && e.code === "not_found") notFound();
        throw e;
      }),
      userTrends(viewer.ctx, userId),
    ]),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const [u, tr] = r.value;
  const [canManage, canSecurity] = await Promise.all([canPlatform(viewer.ctx, "platform.users.manage"), canPlatform(viewer.ctx, "platform.security.manage")]);
  const tz = viewer.user.timezone;
  const now = requestTime();
  const isAdmin = u.platformGrants.length > 0;
  const held = new Set(u.platformGrants.map((g) => g.role.key));
  const base = `/${locale}`;
  const signIns30 = tr ? tr.signIns.reduce((a, b) => a + b, 0) : 0;
  return (
    <div className="grid gap-5">
      <nav aria-label={t("admin.common.breadcrumb")} className="text-xs text-muted-foreground">
        <Link href={`${base}/users`} className="hover:text-foreground hover:underline">
          {t("admin.nav.users")}
        </Link>
        <span aria-hidden> / </span>
        <span>{u.name}</span>
      </nav>
      <AdminHeader
        icon={<CircleUser />}
        title={u.name}
        description={u.email}
        meta={
          <>
            <Badge shape="pill" tone={STATUS_TONE[u.status]}>
              {t(`admin.users.status.${u.status}`)}
            </Badge>
            <Badge shape="pill" tone={u.mfaEnabled ? "success" : "warning"}>
              {u.mfaEnabled ? t("admin.users.mfaOn") : t("admin.users.mfaOff")}
            </Badge>
            <Badge shape="pill" tone={u.emailVerifiedAt ? "success" : "warning"}>
              {u.emailVerifiedAt ? t("admin.users.verified") : t("admin.users.unverified")}
            </Badge>
            {u.platformGrants.map((g) => (
              <Badge key={g.id} shape="pill" tone="accent">
                {g.role.key}
              </Badge>
            ))}
          </>
        }
        actions={
          <>
            {canManage && u.status !== "DELETED" && u.id !== viewer.user.id && !isAdmin ? <UserStatusButton userId={u.id} email={u.email} status={u.status} /> : null}
            {u.id !== viewer.user.id && !isAdmin ? <UserActions userId={u.id} email={u.email} deleted={u.status === "DELETED"} canManage={canManage} /> : null}
          </>
        }
      />
      {isAdmin && u.id !== viewer.user.id ? (
        <p className="-mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <KeyRound className="size-3.5" aria-hidden />
          {t("admin.users.adminNote")}
        </p>
      ) : null}

      <StatGrid>
        <StatTile
          icon={<LogIn />}
          label={t("admin.users.detail.signIns30")}
          value={<CountUp value={signIns30} />}
          hint={u.lastLoginAt ? t("admin.users.detail.lastLoginAgo", { time: formatRelativeTime(u.lastLoginAt, locale, now) }) : t("admin.users.login.never")}
          spark={tr ? <Sparkline values={tr.signIns} tone="success" label={t("admin.users.detail.signIns30")} /> : null}
        />
        <StatTile
          icon={<MonitorSmartphone />}
          live={u.activeSessions > 0}
          label={t("admin.users.detail.sessionsNow")}
          value={<CountUp value={u.activeSessions} />}
          hint={t("admin.users.detail.registeredOn", { date: formatDate(u.createdAt, locale, tz) })}
        />
        <StatTile
          icon={<Bot />}
          label={t("admin.users.detail.aiTasks")}
          value={<CountUp value={u.usage.tasksThisMonth} />}
          hint={t("admin.common.thisMonth")}
          spark={tr ? <Sparkline values={tr.ai.tasks} label={t("admin.users.detail.aiTasks")} /> : null}
        />
        <StatTile
          icon={<Activity />}
          label={t("admin.users.detail.aiTokens")}
          value={<CountUp value={u.usage.tokens} format="compact" />}
          hint={t("admin.overview.aiCost", { cost: usd(u.usage.costMicros, locale) })}
          spark={tr ? <Sparkline values={tr.ai.costMicros} tone="warning" label={t("admin.users.detail.aiCost30")} /> : null}
        />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<CircleUser />} title={t("admin.users.detail.account")} />
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <Avatar name={u.name || u.email} size="lg" />
            <div className="min-w-0">
              <div className="truncate font-medium">{u.name}</div>
              <div className="truncate text-xs text-muted-foreground">{u.email}</div>
            </div>
          </div>
          <Facts
            rows={[
              [t("admin.users.columns.security"), u.mfaEnabled ? t("admin.users.mfaOn") : t("admin.users.mfaOff")],
              [t("admin.users.detail.signIn"), u.oauthAccounts.length ? u.oauthAccounts.map((o) => o.provider).join(", ") : t("admin.users.detail.password")],
              [t("admin.users.detail.locale"), `${u.locale} · ${u.timezone}`],
              [t("admin.users.detail.country"), u.countryCode ?? "—"],
              [t("admin.users.detail.registered"), formatDate(u.createdAt, locale, tz)],
              ["ID", <span key="id" className="font-mono text-xs">{u.id}</span>],
            ]}
          />
        </Card>
        <Card>
          <CardHeader
            icon={<Fingerprint />}
            title={t("admin.users.detail.platformRoles")}
            description={t("admin.users.detail.platformRolesHint")}
            actions={canSecurity && u.status === "ACTIVE" ? <PlatformRoleGrant userId={u.id} roles={PLATFORM_ROLE_KEYS.filter((k) => !held.has(k))} /> : null}
          />
          {u.platformGrants.length === 0 ? (
            <EmptyState icon={<Fingerprint />} title={t("admin.users.detail.noPlatformRoles")} body={t("admin.users.detail.noPlatformRolesHint")} />
          ) : (
            <ul className="divide-y">
              {u.platformGrants.map((g) => (
                <li key={g.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                  <Badge tone="accent">{g.role.key}</Badge>
                  <span className="text-xs text-muted-foreground">{formatDate(g.createdAt, locale, tz)}</span>
                  {canSecurity ? (
                    <span className="ms-auto">
                      <PlatformRoleRevoke userId={u.id} assignmentId={g.id} roleKey={g.role.key} />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader icon={<Building2 />} title={t("admin.users.detail.memberships")} />
        {u.memberships.length === 0 ? (
          <EmptyState icon={<Building2 />} title={t("admin.users.detail.noMemberships")} body={t("admin.users.detail.noMembershipsHint")} />
        ) : (
          <ul className="stagger grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {u.memberships.map((m) => {
              const sub = u.subscriptions.find((s) => s.organizationId === m.organization.id);
              const ok = m.status === "ACTIVE" && m.organization.status === "ACTIVE";
              return (
                <li key={m.organization.id}>
                  <Link href={`${base}/organizations/${m.organization.id}`} className="hover-lift flex h-full items-start gap-3 rounded-lg border bg-surface p-3 focus-visible:outline-2">
                    <Avatar name={m.organization.name} size="sm" square />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{m.organization.name}</span>
                        <LiveDot tone={ok ? "success" : "warning"} pulse={false} label={t(`admin.organizations.status.${m.organization.status}`)} />
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{m.roles.join(", ") || "—"}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{sub ? `${sub.plan.name} · ${t(`admin.subscriptions.status.${sub.status}`)}` : t("admin.organizations.noSubscription")}</div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {tr ? (
        <Card>
          <CardHeader icon={<Activity />} title={t("admin.users.detail.usageChart")} description={t("admin.users.detail.usageChartHint")} />
          <CardBody className="grid gap-6 lg:grid-cols-2">
            <TrendChart
              title={t("admin.users.detail.usageChart")}
              days={tr.days}
              height={150}
              series={[
                { label: t("admin.users.detail.seriesSignIns"), values: tr.signIns, tone: "success" },
                { label: t("admin.users.detail.seriesTasks"), values: tr.ai.tasks, tone: "primary" },
              ]}
            />
            <TrendChart
              title={t("admin.users.detail.aiCost30")}
              days={tr.days}
              height={150}
              series={[{ label: t("admin.users.detail.seriesCost"), values: tr.ai.costMicros, tone: "warning", format: "usdMicros" }]}
            />
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<MonitorSmartphone />} title={t("admin.users.detail.sessions")} description={t("admin.users.detail.sessionsHint")} />
          {u.sessions.length === 0 ? (
            <EmptyState icon={<LogIn />} title={t("admin.users.login.never")} />
          ) : (
            <ol className="relative grid px-4 py-3">
              <span aria-hidden className="absolute inset-y-5 start-[1.45rem] w-px bg-border" />
              {u.sessions.map((s) => {
                const live = !s.revokedAt && s.expiresAt.getTime() > now;
                return (
                  <li key={s.id} className="relative flex gap-3 py-2">
                    <span className="relative mt-1.5 grid size-3 place-items-center">
                      <LiveDot tone={live ? "success" : "neutral"} pulse={live} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="font-medium">{formatDateTime(s.createdAt, locale, tz)}</span>
                        <Badge tone={s.revokedAt ? "neutral" : live ? "success" : "warning"}>
                          {s.revokedAt ? t("admin.users.detail.revoked") : live ? t("admin.users.detail.active") : t("admin.users.detail.expired")}
                        </Badge>
                        {s.mfaVerifiedAt ? <Badge tone="info">MFA</Badge> : null}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <span>{t("admin.users.detail.lastSeenAgo", { time: formatRelativeTime(s.lastSeenAt, locale, now) })}</span>
                        <span className="font-mono">{s.ip ?? "—"}</span>
                        {s.userAgent ? <span className="max-w-64 truncate">{s.userAgent}</span> : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
        <Card>
          <CardHeader icon={<ShieldAlert />} title={t("admin.users.detail.securityLog")} />
          {u.security.length === 0 ? (
            <EmptyState icon={<ShieldAlert />} title={t("admin.audit.empty")} />
          ) : (
            <AuditTimeline
              items={u.security.map((a) => ({
                id: a.id,
                who: a.actorId === u.id ? u.email : t("admin.users.detail.byAdmin"),
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
      <UserAdminExtras ctx={viewer.ctx} locale={locale} user={{ id: u.id, name: u.name, email: u.email, locale: u.locale, timezone: u.timezone }} />
    </div>
  );
}
