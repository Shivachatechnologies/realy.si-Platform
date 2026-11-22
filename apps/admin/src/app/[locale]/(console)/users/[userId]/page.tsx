import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, Bot, Building2, CircleUser, CreditCard, Fingerprint, KeyRound, LogIn, MonitorSmartphone, ShieldAlert, ShieldBan, VenetianMask } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { CountUp } from "@/components/motion/count-up";
import { LiveDot } from "@/components/motion/live-dot";
import { AdminHeader, AuditTimeline, Avatar, EmptyState, Facts, SectionLink, StatGrid, StatTile, guard, usd } from "@/components/admin/kit";
import { CopyButton } from "@/components/admin/copy-button";
import { Timestamp } from "@/components/admin/timestamp";
import { UserStatusButton } from "@/components/admin/user-status-button";
import { UserAdminExtras } from "@/components/admin/people-extras";
import { EditUserProfile } from "@/components/admin/people-actions";
import {
  AddMembershipButton,
  DeleteUserButton,
  EndImpersonationButton,
  ForceLogoutButton,
  GrantPlatformRoleButton,
  ImpersonateButton,
  PasswordResetButton,
  PurgeUserButton,
  RemoveMembershipButton,
  ResetMfaButton,
  RestoreUserButton,
  RestrictionsEditor,
  RevokePlatformRoleButton,
  RevokeSessionButton,
  VerifyEmailButton,
} from "@/components/admin/people/user-admin-actions";
import { Sparkline, TrendChart } from "@/components/admin/viz";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatDateTime, formatRelativeTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { capabilitiesFor } from "@/server/modules/admin/access";
import { userAuthentication } from "@/server/modules/admin/people";
import { userTrends } from "@/server/modules/admin/people-trends";
import { DELETION_GRACE_DAYS, MAX_GRANT_DAYS, deletionBlocker, getPlatformUser, grantablePlatformRoles } from "@/server/modules/admin/users";
import { requestTime, requireViewer } from "@/server/session";

const STATUS_TONE = { ACTIVE: "success", SUSPENDED: "warning", PENDING_DELETION: "danger", DELETED: "neutral" } as const;
const TABS = ["overview", "authentication", "organizations", "activity"] as const;
type Tab = (typeof TABS)[number];

/** One user: identity, authentication, usage, billing, organizations, access and activity — with every audited action. */
export default async function AdminUserPage({ params, searchParams }: PageProps<"/[locale]/users/[userId]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { userId } = await params;
  const query = await searchParams;
  const tab: Tab = TABS.find((x) => x === query.tab) ?? "overview";
  const r = await guard(
    Promise.all([
      getPlatformUser(viewer.ctx, userId).catch((e) => {
        if (isAppError(e) && e.code === "not_found") notFound();
        throw e;
      }),
      tab === "overview" ? userTrends(viewer.ctx, userId) : Promise.resolve(null),
      tab === "authentication" ? userAuthentication(viewer.ctx, userId) : Promise.resolve(null),
    ]),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const [u, tr, auth] = r.value;
  const caps = await capabilitiesFor(viewer.ctx, ["platform.users.manage", "platform.security.manage", "platform.impersonate", "platform.organizations.manage", "platform.subscriptions.read"] as const);
  const canManage = caps["platform.users.manage"];
  const tz = viewer.user.timezone;
  const now = requestTime();
  const self = u.id === viewer.user.id;
  const isAdmin = u.platformGrants.length > 0;
  const held = new Set(u.platformGrants.map((g) => g.role.key));
  const base = `/${locale}`;
  const page = `${base}/users/${u.id}`;
  const signIns30 = tr ? tr.signIns.reduce((a, b) => a + b, 0) : 0;
  const [roles, blocker, liveImp] = await Promise.all([
    caps["platform.security.manage"] && tab === "overview" ? grantablePlatformRoles() : Promise.resolve([]),
    u.status === "PENDING_DELETION" ? deletionBlocker(u.id) : Promise.resolve(null),
    auth ? Promise.resolve(auth.impersonations.find((i) => i.live) ?? null) : Promise.resolve(null),
  ]);
  const orgs = u.memberships.filter((m) => m.status === "ACTIVE").map((m) => ({ id: m.organization.id, name: m.organization.name }));
  const deleted = u.status === "DELETED";

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
              {t(`admin.access.users.status.${u.status}`)}
            </Badge>
            <Badge shape="pill" tone={u.mfaEnabled ? "success" : "warning"}>
              {u.mfaEnabled ? t("admin.users.mfaOn") : t("admin.users.mfaOff")}
            </Badge>
            <Badge shape="pill" tone={u.emailVerifiedAt ? "success" : "warning"}>
              {u.emailVerifiedAt ? t("admin.users.verified") : t("admin.users.unverified")}
            </Badge>
            {u.restrictions.readOnly ? <Badge shape="pill" tone="warning">{t("admin.access.users.readOnly")}</Badge> : null}
            {u.restrictions.aiDisabled ? <Badge shape="pill" tone="warning">{t("admin.access.users.aiDisabled")}</Badge> : null}
            {u.platformGrants.map((g) => (
              <Badge key={g.id} shape="pill" tone={g.expired ? "neutral" : "accent"}>
                {g.role.key}
              </Badge>
            ))}
          </>
        }
        actions={
          !self && !isAdmin && canManage && !deleted ? (
            <>
              {u.status === "ACTIVE" || u.status === "SUSPENDED" ? <UserStatusButton userId={u.id} email={u.email} status={u.status} /> : null}
              {u.status === "PENDING_DELETION" ? <RestoreUserButton userId={u.id} email={u.email} /> : null}
              {u.status === "PENDING_DELETION" && !blocker ? <PurgeUserButton userId={u.id} email={u.email} /> : null}
              {u.status !== "PENDING_DELETION" ? <DeleteUserButton userId={u.id} email={u.email} graceDefault={DELETION_GRACE_DAYS.default} /> : null}
            </>
          ) : null
        }
      />
      {isAdmin && !self ? (
        <p className="-mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <KeyRound className="size-3.5" aria-hidden />
          {t("admin.users.adminNote")}
        </p>
      ) : null}
      {u.status === "PENDING_DELETION" && u.deletionScheduledFor ? (
        <Notice tone="danger">
          {t("admin.access.users.pendingNotice", { date: formatDateTime(u.deletionScheduledFor, locale, tz) })}
          {blocker ? ` ${t(`admin.access.users.blocker.${blocker.reason === "sole_owner" || blocker.reason === "platform_admin" ? blocker.reason : "unknown"}`)}` : ""}
        </Notice>
      ) : null}

      <nav aria-label={t("admin.people.tabs.label")} className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((k) => (
          <Link
            key={k}
            href={k === "overview" ? page : `${page}?tab=${k}`}
            aria-current={k === tab ? "page" : undefined}
            className={`-mb-px inline-flex h-9 shrink-0 items-center border-b-2 px-3 text-xs font-medium ${k === tab ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t(`admin.access.users.tabs.${k}`)}
          </Link>
        ))}
      </nav>

      {canManage && !deleted && !self ? (
        <Card>
          <CardHeader icon={<ShieldBan />} title={t("admin.people.manageUser")} description={t("admin.people.manageUserHint")} />
          <CardBody className="flex flex-wrap items-center gap-2">
            <EditUserProfile userId={u.id} initial={{ name: u.name, email: u.email, locale: u.locale, timezone: u.timezone }} />
            {!u.emailVerifiedAt ? <VerifyEmailButton userId={u.id} email={u.email} /> : null}
            <ForceLogoutButton userId={u.id} email={u.email} sessions={u.activeSessions} />
            {u.status === "ACTIVE" ? <PasswordResetButton userId={u.id} email={u.email} /> : null}
            {u.mfaEnabled ? <ResetMfaButton userId={u.id} email={u.email} /> : null}
            {!isAdmin ? <RestrictionsEditor userId={u.id} value={u.restrictions} /> : null}
            {caps["platform.impersonate"] && !isAdmin && u.status === "ACTIVE" ? <ImpersonateButton userId={u.id} email={u.email} organizations={orgs} locale={locale} /> : null}
            <SectionLink href={`${base}/roles/view-as?user=${u.id}`}>{t("admin.nav.viewAs")}</SectionLink>
          </CardBody>
        </Card>
      ) : null}

      {tab === "overview" ? (
        <>
          <StatGrid>
            <StatTile
              icon={<LogIn />}
              label={t("admin.users.detail.signIns30")}
              value={<CountUp value={signIns30} />}
              hint={u.lastLoginAt ? t("admin.users.detail.lastLoginAgo", { time: formatRelativeTime(u.lastLoginAt, locale, now) }) : t("admin.users.login.never")}
              href={`${page}?tab=authentication`}
              spark={tr ? <Sparkline values={tr.signIns} tone="success" label={t("admin.users.detail.signIns30")} /> : null}
            />
            <StatTile icon={<MonitorSmartphone />} live={u.activeSessions > 0} label={t("admin.users.detail.sessionsNow")} value={<CountUp value={u.activeSessions} />} hint={t("admin.users.detail.registeredOn", { date: formatDate(u.createdAt, locale, tz) })} href={`${page}?tab=authentication`} />
            <StatTile icon={<Bot />} label={t("admin.users.detail.aiTasks")} value={<CountUp value={u.usage.tasksThisMonth} />} hint={t("admin.common.thisMonth")} href={`${base}/ai/tasks?q=${u.id}`} spark={tr ? <Sparkline values={tr.ai.tasks} label={t("admin.users.detail.aiTasks")} /> : null} />
            <StatTile icon={<Activity />} label={t("admin.users.detail.aiTokens")} value={<CountUp value={u.usage.tokens} format="compact" />} hint={t("admin.overview.aiCost", { cost: usd(u.usage.costMicros, locale) })} spark={tr ? <Sparkline values={tr.ai.costMicros} tone="warning" label={t("admin.users.detail.aiCost30")} /> : null} />
          </StatGrid>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader icon={<CircleUser />} title={t("admin.access.users.identity")} />
              <Facts
                rows={[
                  [t("admin.people.email"), <span key="e" className="inline-flex items-center gap-1">{u.email}<CopyButton value={u.email} label={t("admin.people.email")} /></span>],
                  ["ID", <span key="id" className="inline-flex items-center gap-1 font-mono text-xs">{u.id}<CopyButton value={u.id} label="ID" /></span>],
                  [t("admin.users.detail.signIn"), [u.hasPassword ? t("admin.users.detail.password") : null, ...u.oauthAccounts.map((o) => o.provider)].filter(Boolean).join(", ") || "—"],
                  [t("admin.access.users.emailVerified"), u.emailVerifiedAt ? <Timestamp key="v" value={u.emailVerifiedAt} /> : t("admin.users.unverified")],
                  [t("admin.users.detail.locale"), `${u.locale} · ${u.timezone}`],
                  [t("admin.users.detail.country"), u.countryCode ?? "—"],
                  [t("admin.users.detail.registered"), <Timestamp key="c" value={u.createdAt} />],
                  [t("admin.access.users.updated"), <Timestamp key="u" value={u.updatedAt} />],
                ]}
              />
            </Card>
            <Card>
              <CardHeader
                icon={<Fingerprint />}
                title={t("admin.users.detail.platformRoles")}
                description={t("admin.access.users.platformRolesHint")}
                actions={caps["platform.security.manage"] && u.status === "ACTIVE" && !self ? <GrantPlatformRoleButton userId={u.id} roles={roles.filter((x) => !held.has(x.key))} maxDays={MAX_GRANT_DAYS} /> : null}
              />
              {u.platformGrants.length === 0 ? (
                <EmptyState icon={<Fingerprint />} title={t("admin.users.detail.noPlatformRoles")} body={t("admin.users.detail.noPlatformRolesHint")} />
              ) : (
                <ul className="divide-y">
                  {u.platformGrants.map((g) => (
                    <li key={g.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                      <Link href={`${base}/roles/${g.role.isSystem ? g.role.key : g.role.id}`} className="hover:underline">
                        <Badge tone={g.expired ? "neutral" : "accent"} className="font-mono">
                          {g.role.key}
                        </Badge>
                      </Link>
                      {g.scopeType !== "PLATFORM" ? <span className="font-mono text-xs">{`${g.scopeType}:${g.scopeId}`}</span> : null}
                      <span className="text-xs text-muted-foreground">
                        <Timestamp value={g.createdAt} mode="absolute" />
                      </span>
                      {g.expiresAt ? (
                        <Badge tone={g.expired ? "neutral" : "warning"}>
                          {g.expired ? t("admin.access.roles.expired") : t("admin.access.roles.expiresIn", { time: formatRelativeTime(g.expiresAt, locale, now) })}
                        </Badge>
                      ) : null}
                      {caps["platform.security.manage"] && !self ? (
                        <span className="ms-auto">
                          <RevokePlatformRoleButton userId={u.id} assignmentId={g.id} roleKey={g.role.key} />
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader icon={<CreditCard />} title={t("admin.access.users.billing")} description={t("admin.access.users.billingHint")} />
            {u.subscriptions.length === 0 ? (
              <EmptyState icon={<CreditCard />} title={t("admin.organizations.noSubscription")} body={t("admin.access.users.billingEmpty")} />
            ) : (
              <ul className="divide-y">
                {u.subscriptions.map((s) => {
                  const org = u.memberships.find((m) => m.organization.id === s.organizationId)?.organization;
                  return (
                    <li key={s.organizationId} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                      <span className="font-medium">{org?.name ?? s.organizationId}</span>
                      <Badge tone="accent">{s.plan.name}</Badge>
                      <Badge tone={s.status === "ACTIVE" ? "success" : s.status === "PAST_DUE" ? "warning" : "neutral"}>{t(`admin.subscriptions.status.${s.status}`)}</Badge>
                      <span className="text-xs text-muted-foreground">{s.currentPeriodEnd ? t("admin.access.users.renews", { date: formatDate(s.currentPeriodEnd, locale, tz) }) : null}</span>
                      {caps["platform.subscriptions.read"] ? (
                        <span className="ms-auto">
                          <SectionLink href={`${base}/plans/organizations/${s.organizationId}`}>{t("admin.access.users.planAndCredits")}</SectionLink>
                        </span>
                      ) : null}
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
                <TrendChart title={t("admin.users.detail.aiCost30")} days={tr.days} height={150} series={[{ label: t("admin.users.detail.seriesCost"), values: tr.ai.costMicros, tone: "warning", format: "usdMicros" }]} />
              </CardBody>
            </Card>
          ) : null}
        </>
      ) : null}

      {tab === "organizations" ? (
        <Card>
          <CardHeader icon={<Building2 />} title={t("admin.users.detail.memberships")} actions={caps["platform.organizations.manage"] && u.status === "ACTIVE" ? <AddMembershipButton userId={u.id} /> : null} />
          {u.memberships.length === 0 ? (
            <EmptyState icon={<Building2 />} title={t("admin.users.detail.noMemberships")} body={t("admin.users.detail.noMembershipsHint")} />
          ) : (
            <ul className="divide-y">
              {u.memberships.map((m) => {
                const sub = u.subscriptions.find((s) => s.organizationId === m.organization.id);
                const ok = m.status === "ACTIVE" && m.organization.status === "ACTIVE";
                return (
                  <li key={m.organization.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <Avatar name={m.organization.name} size="sm" square />
                    <div className="min-w-0 flex-1">
                      <Link href={`${base}/organizations/${m.organization.id}`} className="flex items-center gap-2 text-sm font-medium hover:underline">
                        {m.organization.name}
                        <LiveDot tone={ok ? "success" : "warning"} pulse={false} label={t(`admin.organizations.status.${m.organization.status}`)} />
                      </Link>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {m.roles.join(", ") || "—"} · {m.status} · {sub ? `${sub.plan.name} · ${t(`admin.subscriptions.status.${sub.status}`)}` : t("admin.organizations.noSubscription")}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      <Timestamp value={m.createdAt} mode="absolute" />
                    </span>
                    {caps["platform.organizations.manage"] ? <RemoveMembershipButton userId={u.id} organizationId={m.organization.id} organizationName={m.organization.name} /> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === "authentication" && auth ? (
        <>
          <StatGrid>
            <StatTile icon={<ShieldAlert />} label={t("admin.access.users.mfaFactors")} value={auth.mfa.factors.length} hint={t("admin.access.users.recoveryLeft", { count: auth.mfa.recoveryCodesLeft })} tone={auth.mfa.enabled ? "success" : "warning"} />
            <StatTile icon={<KeyRound />} label={t("admin.access.users.failed24h")} value={auth.failedLogins.last24h} hint={t("admin.access.users.failed90d", { count: auth.failedLogins.last90d })} tone={auth.failedLogins.last24h >= 5 ? "danger" : auth.failedLogins.last24h ? "warning" : undefined} />
            <StatTile icon={<MonitorSmartphone />} label={t("admin.users.detail.sessionsNow")} value={auth.sessions.filter((s) => s.active).length} hint={t("admin.access.users.sessionsListed", { count: auth.sessions.length })} />
            <StatTile icon={<VenetianMask />} label={t("admin.access.imp.title")} value={auth.impersonations.length} hint={liveImp ? t("admin.access.imp.liveNow") : t("admin.access.imp.noneLive")} tone={liveImp ? "warning" : undefined} />
          </StatGrid>
          {liveImp ? (
            <Notice tone="warning">
              <span className="flex flex-wrap items-center gap-2">
                {t("admin.access.imp.liveBy", { admin: liveImp.admin?.email ?? "—", mode: liveImp.mode })}
                {caps["platform.security.manage"] || liveImp.adminUserId === viewer.user.id ? <EndImpersonationButton impersonationId={liveImp.id} own={liveImp.adminUserId === viewer.user.id} /> : null}
              </span>
            </Notice>
          ) : null}
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader icon={<Fingerprint />} title={t("admin.access.users.methods")} />
              <Facts
                rows={[
                  [t("admin.users.detail.password"), auth.methods.password ? t("admin.access.common.yes") : t("admin.access.common.no")],
                  [t("admin.access.users.emailVerified"), auth.emailVerifiedAt ? <Timestamp key="v" value={auth.emailVerifiedAt} /> : t("admin.users.unverified")],
                  ...auth.methods.oauth.map((o): [string, React.ReactNode] => [o.provider, <span key={o.provider} className="text-xs">{o.providerEmail ?? "—"} · {o.lastLoginAt ? formatRelativeTime(o.lastLoginAt, locale, now) : t("admin.users.login.never")}</span>]),
                  ...auth.mfa.factors.map((f): [string, React.ReactNode] => [`MFA · ${f.type}`, f.confirmedAt ? <Timestamp key={f.id} value={f.confirmedAt} mode="absolute" /> : t("admin.access.users.unconfirmed")]),
                ]}
              />
            </Card>
            <Card>
              <CardHeader icon={<KeyRound />} title={t("admin.access.users.resets")} description={t("admin.access.users.resetsHint")} />
              {auth.passwordResets.length + auth.verifications.length === 0 ? (
                <EmptyState icon={<KeyRound />} title={t("admin.access.common.noEvents")} />
              ) : (
                <ul className="divide-y text-xs">
                  {auth.passwordResets.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-1.5">
                      <span>{t("admin.access.users.passwordReset")}</span>
                      <span className="flex items-center gap-2">
                        <Badge tone={p.state === "used" ? "success" : p.state === "pending" ? "info" : "neutral"}>{t(`admin.access.users.tokenState.${p.state}`)}</Badge>
                        <Timestamp value={p.createdAt} mode="relative" />
                      </span>
                    </li>
                  ))}
                  {auth.verifications.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-1.5">
                      <span>{t("admin.access.users.emailVerification")}</span>
                      <span className="flex items-center gap-2">
                        <Badge tone={p.state === "used" ? "success" : p.state === "pending" ? "info" : "neutral"}>{t(`admin.access.users.tokenState.${p.state}`)}</Badge>
                        <Timestamp value={p.createdAt} mode="relative" />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <Card>
            <CardHeader icon={<MonitorSmartphone />} title={t("admin.users.detail.sessions")} description={t("admin.access.users.sessionsHint")} />
            {auth.sessions.length === 0 ? (
              <EmptyState icon={<LogIn />} title={t("admin.users.login.never")} />
            ) : (
              <ul className="divide-y">
                {auth.sessions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs">
                    <LiveDot tone={s.active ? "success" : "neutral"} pulse={s.active} />
                    <Timestamp value={s.createdAt} className="font-medium" />
                    <Badge tone={s.revokedAt ? "neutral" : s.active ? "success" : "warning"}>{s.revokedAt ? t("admin.users.detail.revoked") : s.active ? t("admin.users.detail.active") : t("admin.users.detail.expired")}</Badge>
                    {s.mfaVerifiedAt ? <Badge tone="info">MFA</Badge> : null}
                    {s.impersonationId ? <Badge tone="warning">{t("admin.access.imp.badge")}</Badge> : null}
                    <span className="font-mono">{s.ip ?? "—"}</span>
                    <span className="max-w-72 truncate text-muted-foreground" title={s.userAgent ?? undefined}>
                      {s.userAgent ?? "—"}
                    </span>
                    <span className="text-muted-foreground">{t("admin.users.detail.lastSeenAgo", { time: formatRelativeTime(s.lastSeenAt, locale, now) })}</span>
                    {canManage && s.active && !self ? (
                      <span className="ms-auto">
                        <RevokeSessionButton userId={u.id} sessionId={s.id} label={`${s.ip ?? "—"} · ${formatDateTime(s.createdAt, locale, tz)}`} />
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader icon={<ShieldAlert />} title={t("admin.access.users.failedLogins")} description={t("admin.access.users.failedLoginsHint")} />
              {auth.failedLogins.items.length === 0 ? (
                <EmptyState icon={<ShieldAlert />} title={t("admin.access.common.noEvents")} />
              ) : (
                <ul className="divide-y text-xs">
                  {auth.failedLogins.items.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-2 px-4 py-1.5">
                      <span className="font-mono">{f.ip ?? "—"}</span>
                      <span className="max-w-56 truncate text-muted-foreground">{f.userAgent ?? "—"}</span>
                      <Timestamp value={f.createdAt} mode="relative" />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader icon={<ShieldAlert />} title={t("admin.access.users.securityEvents")} actions={<SectionLink href={`${base}/audit?resource=${u.id}`}>{t("admin.access.common.openAudit")}</SectionLink>} />
              {auth.events.length === 0 ? (
                <EmptyState icon={<ShieldAlert />} title={t("admin.access.common.noEvents")} />
              ) : (
                <AuditTimeline
                  items={auth.events.map((a) => ({
                    id: a.id,
                    who: a.actor ? a.actor.email : u.email,
                    action: a.action,
                    security: true,
                    reason: a.reason,
                    iso: a.createdAt.toISOString(),
                    exact: formatDateTime(a.createdAt, locale, tz),
                    relative: formatRelativeTime(a.createdAt, locale, now),
                  }))}
                />
              )}
            </Card>
          </div>
          <Card>
            <CardHeader icon={<VenetianMask />} title={t("admin.access.imp.history")} actions={<SectionLink href={`${base}/roles/impersonation?target=${u.id}`}>{t("admin.access.common.viewAll")}</SectionLink>} />
            {auth.impersonations.length === 0 ? (
              <EmptyState icon={<VenetianMask />} title={t("admin.access.imp.none")} />
            ) : (
              <ul className="divide-y text-xs">
                {auth.impersonations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                    <Badge tone={i.mode === "FULL" ? "danger" : "info"}>{t(`admin.access.imp.modes.${i.mode}`)}</Badge>
                    <span className="font-medium">{i.admin?.email ?? "—"}</span>
                    <span className="max-w-80 truncate text-muted-foreground">“{i.reason}”</span>
                    {i.ticketRef ? <span className="font-mono">{i.ticketRef}</span> : null}
                    <span className="ms-auto">
                      <Timestamp value={i.startedAt} />
                    </span>
                    <Badge tone={i.live ? "warning" : "neutral"}>{i.live ? t("admin.access.imp.live") : t(`admin.access.imp.endedBy.${i.endedBy ?? "expiry"}`)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}

      {tab === "activity" ? (
        <>
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
          <UserAdminExtras ctx={viewer.ctx} locale={locale} user={{ id: u.id, name: u.name, email: u.email, locale: u.locale, timezone: u.timezone }} />
        </>
      ) : null}
    </div>
  );
}
