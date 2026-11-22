import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, AuditTimeline, Facts, StatGrid, StatTile, guard } from "@/components/admin/kit";
import { ActionButton } from "@/components/admin/action-dialog";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { CopyButton } from "@/components/admin/copy-button";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { BarList } from "@/components/admin/viz";
import { RestrictApiKey } from "@/components/admin/security/actions";
import { SourceNote } from "@/components/admin/security/page-kit";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { canPlatform } from "@/server/modules/admin/access";
import { apiKeyDetail } from "@/server/modules/admin/developers";
import { requireViewer } from "@/server/session";

/** API key detail: owner, scopes, expiry, last use, usage, rate limits, risk, actions and audit history. Never the secret. */
export default async function ApiKeyPage({ params }: PageProps<"/[locale]/developers/keys/[keyId]">) {
  const { keyId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  let r;
  try {
    r = await guard(Promise.all([apiKeyDetail(viewer.ctx, keyId), canPlatform(viewer.ctx, "platform.security.manage")]), t("errors.forbidden"));
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") notFound();
    throw e;
  }
  if (!r.ok) return r.node;
  const [d, canManage] = r.value;
  const k = d.key;
  const live = k.state === "active" || k.state === "disabled";
  const api = `/api/v1/admin/api-keys/${k.id}`;
  const risks = [d.risk.neverUsed ? "neverUsed" : null, d.risk.staleDays !== null && d.risk.staleDays > 90 ? "stale" : null, d.risk.noExpiry ? "noExpiry" : null, d.risk.broadScopes ? "broadScopes" : null, d.risk.old ? "old" : null].filter((x): x is string => !!x);
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: k.name }]} />
      <AdminHeader
        icon={<KeyRound />}
        title={k.name}
        eyebrow={<StatusBadge domain="apiKey" value={k.state}>{t(`admin.developers.keyState.${k.state}`)}</StatusBadge>}
        description={t("admin.developers.keySubtitle")}
        actions={
          canManage && live ? (
            <div className="flex flex-wrap gap-2">
              <RestrictApiKey keyId={k.id} name={k.name} scopes={d.scopes} mode="restrict" />
              <RestrictApiKey keyId={k.id} name={k.name} scopes={d.scopes} mode="rotate" />
              <ActionButton label={k.state === "disabled" ? t("admin.developers.enableKey") : t("admin.developers.disableKey")} title={k.state === "disabled" ? t("admin.developers.enableKeyTitle", { name: k.name }) : t("admin.developers.disableKeyTitle", { name: k.name })} description={t("admin.developers.disableKeyHint")} path={`${api}/state`} method="PUT" body={{ disabled: k.state !== "disabled" }} />
              <ActionButton label={t("admin.developers.revoke")} title={t("admin.developers.revokeTitle", { name: k.name })} description={t("admin.developers.revokeHint")} path={api} method="DELETE" danger phrase={k.prefix} />
            </div>
          ) : null
        }
        meta={<SourceNote source="api_keys · enterprise_api_key_meta · api_request_logs (sampled) · usage_records" at={new Date()} label={{ source: t("admin.settings.kit.source"), updated: t("admin.settings.kit.updated") }} />}
      />
      {risks.length ? (
        <Card>
          <CardHeader icon={<AlertTriangle />} title={t("admin.developers.risk")} />
          <ul className="flex flex-wrap gap-2 p-4">
            {risks.map((x) => (
              <li key={x}>
                <Badge tone="warning">{t(`admin.developers.risks.${x}`, { days: d.risk.staleDays ?? 0, count: d.risk.broadScopes })}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <StatGrid>
        <StatTile label={t("admin.developers.lastUsed")} value={k.lastUsedAt ? formatRelativeTime(k.lastUsedAt, locale) : t("admin.developers.never")} />
        <StatTile label={t("admin.developers.orgRequests30d")} value={formatNumber(d.usage.orgRequests30d, locale)} hint={t("admin.developers.orgMeterHint")} />
        <StatTile label={t("admin.developers.sampledRequests")} value={formatNumber(d.usage.sampledByDay.reduce((n, x) => n + x.count, 0), locale)} hint={d.usage.sampledByDay.length ? t("admin.developers.sampledHint") : t("admin.apiLogs.notTrackedYet")} />
        <StatTile label={t("admin.developers.limited14d")} value={d.limited14d} tone={d.limited14d ? "warning" : undefined} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.developers.details")} />
          <Facts
            rows={[
              [t("admin.settings.kit.organization"), d.organization ? <Link key="o" href={`/${locale}/organizations/${d.organization.id}`} className="text-primary hover:underline">{d.organization.name}</Link> : "—"],
              [t("admin.developers.owner"), d.creator ? <Link key="c" href={`/${locale}/users/${d.creator.id}`} className="text-primary hover:underline">{d.creator.name}</Link> : "—"],
              [t("admin.developers.prefix"), <span key="p" className="inline-flex items-center gap-1 font-mono text-xs">rly_{k.prefix}_…<CopyButton value={k.prefix} /></span>],
              [t("admin.developers.serviceAccount"), k.serviceAccount.name],
              [t("admin.developers.created"), <Timestamp key="cr" value={k.createdAt} />],
              [t("admin.developers.expires"), k.expiresAt ? <Timestamp key="e" value={k.expiresAt} /> : t("admin.developers.noExpiry")],
              [t("admin.developers.lastIp"), d.usage.last?.ipHash ? <span key="ip" className="font-mono text-xs">{d.usage.last.ipHash}</span> : t("admin.settings.kit.notTracked")],
            ]}
          />
        </Card>
        <Card>
          <CardHeader title={t("admin.developers.scopes")} description={t("admin.developers.scopesHint")} />
          {d.scopes.length ? (
            <ul className="flex flex-wrap gap-1.5 p-4">
              {d.scopes.map((s) => (
                <li key={s}>
                  <Badge tone={s.endsWith(".manage") || s.endsWith(".delete") ? "warning" : "neutral"} className="font-mono">
                    {s}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("admin.developers.noScopes")}</p>
          )}
        </Card>
        <Card>
          <CardHeader title={t("admin.developers.topRoutes")} description={t("admin.developers.sampledHint")} />
          <div className="p-4">
            <BarList label={t("admin.developers.topRoutes")} items={d.usage.routes.map((x) => ({ key: x.route, label: x.route, value: x.count }))} empty={<span className="text-sm text-muted-foreground">{t("admin.apiLogs.notTrackedYet")}</span>} />
          </div>
        </Card>
        <Card>
          <CardHeader title={t("admin.developers.rateLimits")} description={t("admin.developers.rateLimitsHint")} />
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.developers.rule")}</Th>
                <Th>{t("admin.developers.limit")}</Th>
              </Tr>
            </THead>
            <TBody>
              {d.rateLimits.map((x) => (
                <Tr key={x.rule}>
                  <Td className="font-mono text-xs">{x.rule}</Td>
                  <Td className="text-xs">{t("admin.developers.limitValue", { limit: x.limit, seconds: x.windowSeconds })}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
      <Card>
        <CardHeader title={t("admin.developers.history")} />
        {d.audit.length ? (
          <AuditTimeline items={d.audit.map((a) => ({ id: a.id, who: a.actorId?.slice(0, 8) ?? a.actorType, action: a.action, security: true, reason: a.reason, iso: a.createdAt.toISOString(), exact: formatDateTime(a.createdAt, locale, viewer.user.timezone), relative: formatRelativeTime(a.createdAt, locale), extra: <Link href={`/${locale}/audit/${a.id}`} className="text-[11px] text-primary hover:underline">{t("admin.audit.view")}</Link> }))} />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("admin.settings.kit.noEvents")}</p>
        )}
      </Card>
    </div>
  );
}
