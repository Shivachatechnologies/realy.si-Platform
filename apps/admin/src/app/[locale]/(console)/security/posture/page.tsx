import Link from "next/link";
import { Fingerprint, KeyRound, LockKeyhole, MonitorSmartphone, Settings2, ShieldAlert, ShieldCheck, UserCog, Webhook } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Facts, SectionLink, StatGrid, StatTile, guard } from "@/components/admin/kit";
import { ActionButton } from "@/components/admin/action-dialog";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { Timestamp } from "@/components/admin/timestamp";
import { Sparkline } from "@/components/admin/viz";
import { SourceNote, pct } from "@/components/admin/security/page-kit";
import { getLocale, getT } from "@/i18n/server";
import { canPlatform } from "@/server/modules/admin/access";
import { REVOKE_ADMIN_SESSIONS_PHRASE, securityPosture } from "@/server/modules/admin/security";
import { requireViewer } from "@/server/session";

/**
 * Security posture from recorded data only — no automated scanning runs here. Each card says which table or setting it
 * reads, and each risk links to where it is fixed.
 */
export default async function SecurityPosturePage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(Promise.all([securityPosture(viewer.ctx), canPlatform(viewer.ctx, "platform.security.manage")]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [p, canManage] = r.value;
  const base = `/${locale}`;
  const label = { source: t("admin.settings.kit.source"), updated: t("admin.settings.kit.updated") };
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: t("admin.security.posture.title") }]} />
      <AdminHeader
        icon={<ShieldCheck />}
        title={t("admin.security.posture.title")}
        description={t("admin.security.posture.subtitle")}
        why={t("admin.security.posture.why")}
        actions={
          canManage ? (
            <ActionButton label={t("admin.security.posture.revokeAdmins")} title={t("admin.security.posture.revokeAdminsTitle")} description={t("admin.security.posture.revokeAdminsHint")} path="/api/v1/admin/sessions/admins" method="DELETE" phrase={REVOKE_ADMIN_SESSIONS_PHRASE} danger />
          ) : null
        }
        meta={<SourceNote source="audit_logs · users · sessions · api_keys · integration_* · platform_secrets · env" at={p.generatedAt} label={label} extra={<span>{t("admin.security.posture.noScanning")}</span>} />}
      />
      {p.configRisks.length ? (
        <Card>
          <CardHeader icon={<ShieldAlert />} title={t("admin.security.posture.configRisks")} description={t("admin.security.posture.configRisksHint")} />
          <ul className="divide-y">
            {p.configRisks.map((c) => (
              <li key={c.key + c.source} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <Badge tone={c.severity === "high" ? "danger" : c.severity === "medium" ? "warning" : "neutral"}>{t(`admin.security.posture.severity.${c.severity}`)}</Badge>
                <span className="min-w-0 flex-1">{t(`admin.security.posture.risks.${c.key}`)}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{c.source}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <StatGrid>
        <StatTile icon={<Fingerprint />} label={t("admin.security.posture.failed24h")} value={p.failedAuth.last24h} hint={t("admin.security.posture.failed7d", { count: p.failedAuth.last7d })} tone={p.failedAuth.last24h > 50 ? "warning" : undefined} spark={<Sparkline values={p.failedAuth.byDay.map((d) => d.count)} label={t("admin.security.posture.failed14d")} tone="warning" />} href={`${base}/audit?action=auth.sign_in_failed&scope=all`} />
        <StatTile icon={<LockKeyhole />} label={t("admin.security.posture.adminMfa")} value={`${p.mfa.adminsWithMfa} / ${p.mfa.admins}`} tone={p.mfa.adminsWithMfa < p.mfa.admins ? "danger" : "success"} href={`${base}/roles`} />
        <StatTile icon={<UserCog />} label={t("admin.security.posture.userMfa")} value={pct(p.mfa.users ? p.mfa.usersWithMfa / p.mfa.users : null, locale) ?? t("admin.settings.kit.noData")} hint={t("admin.security.posture.orgsRequireMfa", { count: p.mfa.orgsRequiringMfa })} />
        <StatTile icon={<MonitorSmartphone />} label={t("admin.security.posture.activeSessions")} value={p.sessions.active} hint={t("admin.security.posture.adminSessions", { count: p.sessions.admin })} href={`${base}/security/access`} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Fingerprint />} title={t("admin.security.posture.byAccount")} description={t("admin.security.posture.byAccountHint")} />
          {p.failedAuth.byAccount.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.security.posture.account")}</Th>
                  <Th>{t("admin.security.posture.attempts")}</Th>
                  <Th>{t("admin.security.posture.last")}</Th>
                </Tr>
              </THead>
              <TBody>
                {p.failedAuth.byAccount.map((a) => (
                  <Tr key={a.account + a.count}>
                    <Td className="font-mono text-xs">{a.account}</Td>
                    <Td className="text-xs tabular-nums">{a.count}</Td>
                    <Td className="text-xs text-muted-foreground"><Timestamp value={a.last} mode="relative" /></Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("admin.settings.kit.noEvents7d")}</p>
          )}
        </Card>
        <Card>
          <CardHeader icon={<Fingerprint />} title={t("admin.security.posture.byIp")} description={t("admin.security.posture.byIpHint")} />
          {p.failedAuth.byIp.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.security.posture.ip")}</Th>
                  <Th>{t("admin.security.posture.attempts")}</Th>
                  <Th>{t("admin.security.posture.accounts")}</Th>
                </Tr>
              </THead>
              <TBody>
                {p.failedAuth.byIp.map((a) => (
                  <Tr key={a.ipHash}>
                    <Td className="font-mono text-xs">{a.ip} <span className="text-[10px] text-muted-foreground">#{a.ipHash}</span></Td>
                    <Td className="text-xs tabular-nums">{a.count}</Td>
                    <Td className="text-xs tabular-nums">{a.accounts}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("admin.settings.kit.noEvents7d")}</p>
          )}
          <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">{t("admin.security.posture.noGeoIp")}</p>
        </Card>
        <Card>
          <CardHeader icon={<KeyRound />} title={t("admin.security.posture.apiKeyRisk")} actions={<SectionLink href={`${base}/developers`}>{t("admin.nav.developers")}</SectionLink>} />
          <Facts
            rows={[
              [t("admin.security.posture.activeKeys"), String(p.apiKeys.active)],
              [t("admin.security.posture.neverUsed"), String(p.apiKeys.neverUsed)],
              [t("admin.security.posture.staleKeys"), String(p.apiKeys.stale)],
              [t("admin.security.posture.noExpiry"), String(p.apiKeys.noExpiry)],
              [t("admin.security.posture.broadScopes"), String(p.apiKeys.broadScopes)],
            ]}
          />
          {p.apiKeys.worst.length ? (
            <ul className="divide-y border-t text-xs">
              {p.apiKeys.worst.map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-2 px-4 py-1.5">
                  <Link href={`${base}/developers/keys/${k.id}`} className="text-primary hover:underline">{k.name}</Link>
                  <span className="font-mono text-muted-foreground">{k.prefix}…</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
        <Card>
          <CardHeader icon={<Webhook />} title={t("admin.security.posture.webhookSecurity")} actions={<SectionLink href={`${base}/webhooks`}>{t("admin.webhooks.title")}</SectionLink>} />
          <Facts
            rows={[
              [t("admin.security.posture.activeEndpoints"), String(p.webhooks.active)],
              [t("admin.security.posture.insecureUrls"), String(p.webhooks.insecureUrls)],
              [t("admin.security.posture.secretNeverRotated"), String(p.webhooks.secretNeverRotated180d)],
              [t("admin.security.posture.oauthErrors"), String(p.oauth.errorConnections)],
              [t("admin.security.posture.oauthFailures"), String(p.oauth.failures7d)],
            ]}
          />
        </Card>
        <Card>
          <CardHeader icon={<UserCog />} title={t("admin.security.posture.adminActivity")} description={t("admin.security.posture.adminActivityHint")} actions={<SectionLink href={`${base}/audit?category=ADMIN`}>{t("admin.nav.audit")}</SectionLink>} />
          {p.adminActivity.length ? (
            <ul className="divide-y text-sm">
              {p.adminActivity.map((a) => (
                <li key={a.actorId ?? "?"} className="flex items-center justify-between gap-2 px-4 py-2">
                  {a.who ? <Link href={`${base}/users/${a.who.id}`} className="hover:underline">{a.who.name}</Link> : <span className="font-mono text-xs">{a.actorId?.slice(0, 8)}</span>}
                  <span className="text-xs tabular-nums text-muted-foreground">{a.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("admin.settings.kit.noEvents7d")}</p>
          )}
        </Card>
        <Card>
          <CardHeader icon={<Settings2 />} title={t("admin.security.posture.policy")} description={t("admin.security.posture.policyHint")} />
          <Facts
            rows={[
              [t("admin.security.posture.adminMfaRequired"), t("common.yes")],
              [t("admin.security.posture.mfaFreshness"), t("admin.security.posture.hours", { count: p.policy.mfaFreshnessHours })],
              [t("admin.security.posture.sessionAbsolute"), t("admin.security.posture.days", { count: p.policy.sessionAbsoluteDays })],
              [t("admin.security.posture.sessionIdle"), t("admin.security.posture.days", { count: p.policy.sessionIdleDays })],
              [t("admin.security.posture.sso"), p.sso.connections.length ? p.sso.connections.map((s) => `${s.protocol}${s.enabled ? "" : " (off)"} ×${s.count}`).join(", ") : t("admin.settings.kit.notConfigured")],
              [t("admin.security.posture.ssoEnforced"), String(p.sso.orgsEnforcingSso)],
              [t("admin.security.posture.platformKeysOld"), String(p.platformKeys.olderThan1y.length)],
            ]}
          />
          <ul className="border-t px-4 py-2 font-mono text-[11px] text-muted-foreground">
            {p.policy.signInLimits.map((l) => (
              <li key={l.rule}>
                {l.rule}: {l.limit}/{l.windowMinutes}m{l.sensitive ? " · fail-closed" : ""}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
