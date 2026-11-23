import { notFound, redirect } from "next/navigation";
import { KeyRound, Mail, MonitorSmartphone, ShieldCheck, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { AdminHeader, EmptyState, Facts, StatGrid, StatTile, guard } from "@/components/admin/kit";
import { Timestamp } from "@/components/admin/timestamp";
import { OrgTabs } from "@/components/admin/people-extras";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { hasTenantViewGrant, organizationSecurity } from "@/server/modules/admin/tenants";
import { requireViewer } from "@/server/session";

const STATE_TONE: Record<string, "success" | "warning" | "neutral" | "info" | "danger"> = { active: "success", pending: "info", accepted: "success", expired: "neutral", revoked: "neutral" };

/** Organization security: member MFA coverage, enterprise policy, SSO, API keys, live sessions, invitations. */
export default async function AdminOrgSecurityPage({ params }: PageProps<"/[locale]/organizations/[orgId]/security">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { orgId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const org = await db().organization.findUnique({ where: { id: orgId }, select: { name: true } });
  if (!org) notFound();
  if (!(await hasTenantViewGrant(viewer.ctx, orgId))) redirect(`/${locale}/organizations/${orgId}`);
  const r = await guard(organizationSecurity(viewer.ctx, orgId), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const s = r.value;
  const pct = s.mfa.coverage === null ? null : Math.round(s.mfa.coverage * 100);
  const yes = (v: boolean | undefined | null) => (v ? t("admin.access.common.yes") : t("admin.access.common.no"));
  return (
    <div className="grid gap-4">
      <OrgTabs locale={locale} orgId={orgId} active="security" />
      <AdminHeader icon={<ShieldCheck />} title={t("admin.access.org.securityTitle", { name: org.name })} description={t("admin.access.org.securityHint")} />
      <StatGrid>
        <StatTile icon={<Users />} label={t("admin.access.org.mfaCoverage")} value={pct === null ? "—" : `${pct}%`} hint={t("admin.access.org.mfaOf", { with: formatNumber(s.mfa.withMfa, locale), total: formatNumber(s.mfa.members, locale) })} tone={pct === null ? undefined : pct === 100 ? "success" : pct < 50 ? "danger" : "warning"} href={`/${locale}/users?org=${orgId}&mfa=off`} />
        <StatTile icon={<MonitorSmartphone />} label={t("admin.access.org.liveSessions")} value={formatNumber(s.liveSessions, locale)} />
        <StatTile icon={<KeyRound />} label={t("admin.access.org.apiKeys")} value={formatNumber(s.apiKeys.filter((k) => k.state === "active").length, locale)} hint={t("admin.access.org.apiKeysTotal", { count: s.apiKeys.length })} />
        <StatTile icon={<ShieldCheck />} label={t("admin.access.org.sso")} value={formatNumber(s.sso.filter((c) => c.enabled).length, locale)} hint={t("admin.access.org.ssoTotal", { count: s.sso.length })} />
      </StatGrid>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<ShieldCheck />} title={t("admin.access.org.policy")} description={s.policy ? undefined : t("admin.access.org.policyNone")} />
          {s.policy ? (
            <Facts
              rows={[
                [t("admin.access.org.requireMfa"), yes(s.policy.requireMfa)],
                [t("admin.access.org.enforceSso"), yes(s.policy.enforceSso)],
                [t("admin.access.org.sessionTimeout"), s.policy.sessionTimeoutMinutes ? t("admin.access.org.minutes", { count: s.policy.sessionTimeoutMinutes }) : "—"],
                [t("admin.access.org.ipAllowlist"), s.policy.ipAllowlist.length ? s.policy.ipAllowlist.join(", ") : "—"],
                [t("admin.access.org.maxMembers"), s.policy.maxMembers ?? "—"],
                [t("admin.access.org.maxApiKeys"), s.policy.maxApiKeys ?? "—"],
              ]}
            />
          ) : null}
        </Card>
        <Card>
          <CardHeader icon={<ShieldCheck />} title={t("admin.access.org.ssoConnections")} />
          {s.sso.length === 0 && s.domains.length === 0 ? (
            <EmptyState icon={<ShieldCheck />} title={t("admin.access.org.noSso")} />
          ) : (
            <ul className="divide-y text-xs">
              {s.sso.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <Badge>{c.protocol}</Badge>
                  <span className="font-medium">{c.name}</span>
                  <span className="truncate font-mono text-muted-foreground">{c.issuer ?? "—"}</span>
                  <Badge tone={c.enabled ? "success" : "neutral"} className="ms-auto">
                    {c.enabled ? t("admin.access.common.enabled") : t("admin.access.common.disabled")}
                  </Badge>
                </li>
              ))}
              {s.domains.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <span className="font-mono">{d.domain}</span>
                  <Badge tone={d.verifiedAt ? "success" : "warning"}>{d.verifiedAt ? t("admin.users.verified") : t("admin.users.unverified")}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<KeyRound />} title={t("admin.access.org.apiKeys")} description={t("admin.access.org.apiKeysHint")} />
          {s.apiKeys.length === 0 ? (
            <EmptyState icon={<KeyRound />} title={t("admin.access.org.noApiKeys")} />
          ) : (
            <ul className="divide-y text-xs">
              {s.apiKeys.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <span className="font-medium">{k.name}</span>
                  <span className="font-mono text-muted-foreground">{k.prefix}…</span>
                  <Badge tone={STATE_TONE[k.state]}>{t(`admin.access.org.keyState.${k.state}`)}</Badge>
                  <span className="ms-auto text-muted-foreground">{k.lastUsedAt ? <Timestamp value={k.lastUsedAt} mode="relative" /> : t("admin.access.org.neverUsed")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader icon={<Mail />} title={t("admin.access.org.invitations")} />
          {s.invitations.length === 0 ? (
            <EmptyState icon={<Mail />} title={t("admin.access.org.noInvitations")} />
          ) : (
            <ul className="divide-y text-xs">
              {s.invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <span className="font-medium">{i.email}</span>
                  <Badge className="font-mono">{i.role.key}</Badge>
                  <Badge tone={STATE_TONE[i.state]}>{t(`admin.access.org.inviteState.${i.state}`)}</Badge>
                  {i.deliveryStatus ? <span className="text-muted-foreground">{i.deliveryStatus}</span> : null}
                  <span className="ms-auto">
                    <Timestamp value={i.createdAt} mode="relative" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
