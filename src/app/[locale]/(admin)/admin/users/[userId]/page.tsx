import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, Facts, StatGrid, StatTile, guard, usd } from "@/components/admin/kit";
import { PlatformRoleGrant, PlatformRoleRevoke, UserActions } from "@/components/admin/user-actions";
import { UserStatusButton } from "@/components/admin/user-status-button";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatDateTime, formatNumber } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { canPlatform } from "@/server/modules/admin/access";
import { PLATFORM_ROLE_KEYS, getPlatformUser } from "@/server/modules/admin/users";
import { requireViewer } from "@/server/session";

export default async function AdminUserPage({ params }: PageProps<"/[locale]/admin/users/[userId]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { userId } = await params;
  const r = await guard(
    getPlatformUser(viewer.ctx, userId).catch((e) => {
      if (isAppError(e) && e.code === "not_found") notFound();
      throw e;
    }),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const u = r.value;
  const [canManage, canSecurity] = await Promise.all([canPlatform(viewer.ctx, "platform.users.manage"), canPlatform(viewer.ctx, "platform.security.manage")]);
  const tz = viewer.user.timezone;
  const isAdmin = u.platformGrants.length > 0;
  const held = new Set(u.platformGrants.map((g) => g.role.key));
  return (
    <div className="grid gap-4">
      <AdminHeader
        title={u.name}
        description={u.email}
        actions={
          <>
            <Badge tone={u.status === "ACTIVE" ? "success" : "danger"}>{t(`admin.users.status.${u.status}`)}</Badge>
            {canManage && u.status !== "DELETED" && u.id !== viewer.user.id && !isAdmin ? <UserStatusButton userId={u.id} email={u.email} status={u.status} /> : null}
            {u.id !== viewer.user.id && !isAdmin ? <UserActions userId={u.id} email={u.email} deleted={u.status === "DELETED"} canManage={canManage} /> : null}
          </>
        }
      />
      <StatGrid>
        <StatTile label={t("admin.users.detail.lastLogin")} value={u.lastLoginAt ? formatDate(u.lastLoginAt, locale, tz) : "—"} hint={t("admin.users.detail.activeSessions", { count: u.activeSessions })} />
        <StatTile label={t("admin.users.detail.registered")} value={formatDate(u.createdAt, locale, tz)} hint={u.emailVerifiedAt ? t("admin.users.verified") : t("admin.users.unverified")} />
        <StatTile label={t("admin.users.detail.aiTasks")} value={formatNumber(u.usage.tasksThisMonth, locale)} hint={t("admin.common.thisMonth")} />
        <StatTile label={t("admin.users.detail.aiTokens")} value={formatNumber(u.usage.tokens, locale)} hint={usd(u.usage.costMicros, locale)} />
      </StatGrid>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.users.detail.profile")} />
          <Facts
            rows={[
              [t("admin.users.columns.security"), u.mfaEnabled ? t("admin.users.mfaOn") : t("admin.users.mfaOff")],
              [t("admin.users.detail.signIn"), u.oauthAccounts.length ? u.oauthAccounts.map((o) => o.provider).join(", ") : t("admin.users.detail.password")],
              [t("admin.users.detail.locale"), `${u.locale} · ${u.timezone}`],
              [t("admin.users.detail.country"), u.countryCode ?? "—"],
              ["ID", <span key="id" className="font-mono text-xs">{u.id}</span>],
            ]}
          />
        </Card>
        <Card>
          <CardHeader title={t("admin.users.detail.platformRoles")} actions={canSecurity && u.status === "ACTIVE" ? <PlatformRoleGrant userId={u.id} roles={PLATFORM_ROLE_KEYS.filter((k) => !held.has(k))} /> : null} />
          {u.platformGrants.length === 0 ? (
            <Empty>{t("admin.users.detail.noPlatformRoles")}</Empty>
          ) : (
            <ul className="divide-y">
              {u.platformGrants.map((g) => (
                <li key={g.id} className="flex items-center gap-2 px-4 py-2 text-sm">
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
        <CardHeader title={t("admin.users.detail.memberships")} />
        {u.memberships.length === 0 ? (
          <Empty>{t("admin.users.detail.noMemberships")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.organizations.columns.name")}</Th>
                <Th>{t("admin.users.detail.roles")}</Th>
                <Th>{t("admin.organizations.columns.subscription")}</Th>
                <Th>{t("admin.users.columns.status")}</Th>
              </Tr>
            </THead>
            <TBody>
              {u.memberships.map((m) => {
                const sub = u.subscriptions.find((s) => s.organizationId === m.organization.id);
                return (
                  <Tr key={m.organization.id}>
                    <Td>
                      <Link href={`/${locale}/admin/organizations/${m.organization.id}`} className="font-medium hover:underline">
                        {m.organization.name}
                      </Link>
                    </Td>
                    <Td className="font-mono text-[11px]">{m.roles.join(", ") || "—"}</Td>
                    <Td className="text-xs">{sub ? `${sub.plan.name} · ${t(`admin.subscriptions.status.${sub.status}`)}` : "—"}</Td>
                    <Td>
                      <Badge tone={m.status === "ACTIVE" && m.organization.status === "ACTIVE" ? "success" : "warning"}>{t(`admin.organizations.status.${m.organization.status}`)}</Badge>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.users.detail.sessions")} />
          {u.sessions.length === 0 ? (
            <Empty>{t("admin.users.login.never")}</Empty>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.users.detail.signedIn")}</Th>
                  <Th>{t("admin.users.detail.lastSeen")}</Th>
                  <Th>IP</Th>
                  <Th>{t("admin.users.columns.status")}</Th>
                </Tr>
              </THead>
              <TBody>
                {u.sessions.map((s) => (
                  <Tr key={s.id}>
                    <Td className="text-xs whitespace-nowrap">{formatDateTime(s.createdAt, locale, tz)}</Td>
                    <Td className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(s.lastSeenAt, locale, tz)}</Td>
                    <Td className="font-mono text-[11px]">{s.ip ?? "—"}</Td>
                    <Td>
                      <Badge tone={s.revokedAt ? "neutral" : "success"}>{s.revokedAt ? t("admin.users.detail.revoked") : t("admin.users.detail.active")}</Badge>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title={t("admin.users.detail.securityLog")} />
          {u.security.length === 0 ? (
            <Empty>{t("admin.audit.empty")}</Empty>
          ) : (
            <ul className="divide-y">
              {u.security.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
                  <span className="text-muted-foreground">{formatDateTime(a.createdAt, locale, tz)}</span>
                  <Badge tone={a.category === "SECURITY" ? "warning" : "accent"}>{a.action}</Badge>
                  {a.reason ? <span className="truncate">{a.reason}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
