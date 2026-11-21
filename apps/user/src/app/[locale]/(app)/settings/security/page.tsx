import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { MfaSetup } from "@/components/settings/mfa-setup";
import { OrgSecurityForm, RevokeSessionButton } from "@/components/enterprise/security";
import { getLocale, getT } from "@/i18n/server";
import { formatRelativeTime } from "@/i18n/format";
import { requestTime, requireViewer, getWorkspaceContext } from "@/server/session";
import { OAuthButtons, OAuthErrorNotice } from "@/components/auth/oauth-buttons";
import { linkedProviders, oauthStatus } from "@/server/modules/auth/oauth";
import { can } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { getOrgSettings, listMemberSessions, membersWithoutMfa } from "@/server/modules/enterprise/policy";

function device(ua: string | null) {
  if (!ua) return "—";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

export default async function SecuritySettingsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { org } = await getWorkspaceContext(viewer.user.id);
  const linked = await linkedProviders(viewer.user.id);
  const chain = org ? orgChain(org.id) : null;
  const [canManageOrg, canSeeSessions] = chain ? await Promise.all([can(viewer.ctx, "organizations.manage", chain), can(viewer.ctx, "users.manage", chain)]) : [false, false];
  const [settings, withoutMfa, sessions] = await Promise.all([
    org && canManageOrg ? getOrgSettings(org.id) : Promise.resolve(null),
    org && canManageOrg ? membersWithoutMfa(org.id) : Promise.resolve([]),
    org && canSeeSessions ? listMemberSessions(viewer.ctx, org.id).catch(() => null) : Promise.resolve(null),
  ]);
  const now = requestTime();
  return (
    <div className="grid gap-4">
      <OAuthErrorNotice />
      <Card>
        <CardHeader title={t("settings.security.title")} />
        <CardBody>
          <MfaSetup enabled={viewer.user.mfaEnabled} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("settings.security.connections")} />
        <CardBody className="max-w-md">
          <OAuthButtons providers={oauthStatus()} mode="link" linked={linked.map((l) => l.provider)} />
        </CardBody>
      </Card>
      {org && settings ? (
        <Card>
          <CardHeader title={t("enterprise.security.orgTitle", { org: org.name })} description={t("enterprise.security.orgHint")} />
          <CardBody>
            <OrgSecurityForm
              orgId={org.id}
              initial={{
                requireMfa: settings.requireMfa,
                sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
                ipAllowlist: settings.ipAllowlist,
              }}
              membersWithoutMfa={withoutMfa.length}
              currentIp={viewer.ctx.ip}
            />
          </CardBody>
        </Card>
      ) : null}
      {org && sessions ? (
        <Card>
          <CardHeader
            title={t("enterprise.security.sessionsTitle")}
            description={t("enterprise.security.sessionsHint", {
              count: sessions.length,
            })}
          />
          {sessions.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("enterprise.security.noSessions")}</p>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("enterprise.roles.member")}</Th>
                  <Th>{t("enterprise.security.device")}</Th>
                  <Th>{t("enterprise.security.ip")}</Th>
                  <Th>{t("enterprise.security.lastSeen")}</Th>
                  <Th>{t("enterprise.security.signedIn")}</Th>
                  <Th>
                    <span className="sr-only">{t("common.actions")}</span>
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {sessions.map((s) => (
                  <Tr key={s.id}>
                    <Td className="font-medium">
                      {s.user.name}
                      {s.id === viewer.session.id ? (
                        <Badge tone="accent" className="ms-1">
                          {t("enterprise.security.thisSession")}
                        </Badge>
                      ) : null}
                      <div className="text-xs font-normal text-muted-foreground">{s.user.email}</div>
                    </Td>
                    <Td className="text-xs">{device(s.userAgent)}</Td>
                    <Td className="font-mono text-xs">{s.ip ?? "—"}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatRelativeTime(s.lastSeenAt, locale, now)}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatRelativeTime(s.createdAt, locale, now)}</Td>
                    <Td className="text-end">
                      <RevokeSessionButton orgId={org.id} sessionId={s.id} current={s.id === viewer.session.id} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      ) : null}
    </div>
  );
}
