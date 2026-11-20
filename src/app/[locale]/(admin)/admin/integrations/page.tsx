import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ActionButton } from "@/components/admin/action-dialog";
import { AdminHeader, Empty, FilterBar, guard, sp } from "@/components/admin/kit";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatNumber } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { integrationsOverview } from "@/server/modules/admin/integrations";
import { PROVIDERS } from "@/server/modules/integrations/catalog";
import { requestTime, requireViewer } from "@/server/session";

/** Integrations & API across organizations: connections, provider status, API keys, webhook failures, API usage. */
export default async function AdminIntegrationsPage({ searchParams }: PageProps<"/[locale]/admin/integrations">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const query = await searchParams;
  const params = { provider: sp(query.provider), status: sp(query.status), org: sp(query.org) };
  const r = await guard(integrationsOverview(viewer.ctx, params), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const o = r.value;
  const [canRevoke] = await Promise.all([canPlatform(viewer.ctx, "platform.security.manage")]);
  const tz = viewer.user.timezone;
  const now = requestTime();
  const base = `/${locale}/admin/integrations`;
  const providerName = (k: string) => PROVIDERS.find((p) => p.key === k)?.name ?? k;
  return (
    <div className="grid gap-4">
      <AdminHeader title={t("admin.nav.integrations")} description={t("admin.integrations.subtitle")} actions={<Link href={`/${locale}/admin/controls`} className="text-xs underline">{t("admin.integrations.manageProviders")}</Link>} />
      <Card>
        <CardHeader title={t("admin.integrations.providers")} />
        {o.providers.length === 0 ? (
          <Empty>{t("admin.integrations.noConnections")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.integrations.provider")}</Th>
                <Th>{t("admin.integrations.status.CONNECTED")}</Th>
                <Th>{t("admin.integrations.status.ERROR")}</Th>
                <Th>{t("admin.integrations.status.DISCONNECTED")}</Th>
                <Th>{t("admin.integrations.platform")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.providers.map((p) => (
                <Tr key={p.provider}>
                  <Td>
                    <Link href={`${base}?provider=${p.provider}`} className="hover:underline">
                      {providerName(p.provider)}
                    </Link>
                  </Td>
                  <Td className="tabular">{p.connected}</Td>
                  <Td className={p.error ? "tabular text-danger" : "tabular"}>{p.error}</Td>
                  <Td className="tabular">{p.disconnected}</Td>
                  <Td>
                    <Badge tone={p.disabled ? "danger" : "success"}>{p.disabled ? t("admin.controls.disabled") : t("admin.controls.enabled")}</Badge>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title={t("admin.integrations.connections")} />
        <FilterBar
          action={base}
          values={params}
          submitLabel={t("admin.users.searchButton")}
          filters={[
            { name: "provider", label: t("admin.integrations.provider"), options: PROVIDERS.map((p) => ({ value: p.key, label: p.name })) },
            { name: "status", label: t("admin.users.filters.status"), options: (["CONNECTED", "ERROR", "DISCONNECTED"] as const).map((s) => ({ value: s, label: t(`admin.integrations.status.${s}`) })) },
          ]}
          extra={params.org ? <input type="hidden" name="org" value={params.org} /> : null}
        />
        {o.connections.length === 0 ? (
          <Empty>{t("admin.integrations.noConnections")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.integrations.provider")}</Th>
                <Th>{t("admin.organizations.columns.name")}</Th>
                <Th>{t("admin.users.columns.status")}</Th>
                <Th>{t("admin.integrations.lastError")}</Th>
                <Th>{t("admin.integrations.lastSync")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.connections.map((c) => (
                <Tr key={c.id}>
                  <Td>{providerName(c.provider)}</Td>
                  <Td className="text-xs">
                    <Link href={`/${locale}/admin/organizations/${c.organizationId}`} className="hover:underline">
                      {c.organizationName}
                    </Link>
                    <div className="text-muted-foreground">{c.company.name}</div>
                  </Td>
                  <Td>
                    <Badge tone={c.status === "CONNECTED" ? "success" : c.status === "ERROR" ? "danger" : "neutral"}>{t(`admin.integrations.status.${c.status}`)}</Badge>
                  </Td>
                  <Td className="max-w-72 truncate text-xs text-danger" title={c.lastError ?? undefined}>
                    {c.lastError ?? ""}
                  </Td>
                  <Td className="text-xs whitespace-nowrap text-muted-foreground">{c.lastSyncAt ? formatDateTime(c.lastSyncAt, locale, tz) : "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.integrations.apiKeys")} />
          {o.apiKeys.length === 0 ? (
            <Empty>{t("admin.integrations.noKeys")}</Empty>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.integrations.key")}</Th>
                  <Th>{t("admin.organizations.columns.name")}</Th>
                  <Th>{t("admin.integrations.lastUsed")}</Th>
                  <Th>{t("admin.users.columns.status")}</Th>
                </Tr>
              </THead>
              <TBody>
                {o.apiKeys.map((k) => {
                  const expired = !!k.expiresAt && k.expiresAt.getTime() < now;
                  return (
                    <Tr key={k.id}>
                      <Td>
                        <div className="text-sm">{k.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{k.prefix}…</div>
                      </Td>
                      <Td className="text-xs">{k.organizationName}</Td>
                      <Td className="text-xs whitespace-nowrap text-muted-foreground">{k.lastUsedAt ? formatDateTime(k.lastUsedAt, locale, tz) : "—"}</Td>
                      <Td>
                        {k.revokedAt ? (
                          <Badge>{t("admin.integrations.revoked")}</Badge>
                        ) : expired ? (
                          <Badge tone="warning">{t("admin.integrations.expired")}</Badge>
                        ) : canRevoke ? (
                          <ActionButton label={t("admin.integrations.revoke")} title={`${t("admin.integrations.revoke")}: ${k.name}`} description={t("admin.integrations.revokeHint")} path={`/api/v1/admin/api-keys/${k.id}`} method="DELETE" variant="danger" />
                        ) : (
                          <Badge tone="success">{t("admin.integrations.active")}</Badge>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title={t("admin.integrations.apiUsage")} description={t("admin.overview.last30")} />
          {o.apiUsage.length === 0 ? (
            <Empty>{t("admin.integrations.noUsage")}</Empty>
          ) : (
            <ul className="divide-y">
              {o.apiUsage.map((u) => (
                <li key={u.organizationId} className="flex items-center gap-2 px-4 py-2 text-sm">
                  <span className="truncate">{u.organizationName}</span>
                  <span className="ms-auto tabular">{formatNumber(u.requests, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title={t("admin.integrations.webhookFailures")} />
        {o.failedDeliveries.length === 0 ? (
          <Empty>{t("admin.integrations.noFailures")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.integrations.event")}</Th>
                <Th>{t("admin.organizations.columns.name")}</Th>
                <Th>{t("admin.integrations.endpoint")}</Th>
                <Th>{t("admin.integrations.lastError")}</Th>
                <Th>{t("admin.audit.time")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.failedDeliveries.map((d) => (
                <Tr key={d.id}>
                  <Td className="font-mono text-xs">{d.eventType}</Td>
                  <Td className="text-xs">{d.organizationName}</Td>
                  <Td className="max-w-56 truncate text-xs">{d.subscription.name}</Td>
                  <Td className="max-w-72 truncate text-xs text-danger">
                    {d.lastStatusCode ? `HTTP ${d.lastStatusCode} · ` : ""}
                    {d.lastError ?? ""} ({t("admin.integrations.attempts", { count: d.attempts })})
                  </Td>
                  <Td className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(d.updatedAt, locale, tz)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
