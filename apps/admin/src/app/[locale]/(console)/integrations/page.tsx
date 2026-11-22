import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ActionButton } from "@/components/admin/action-dialog";
import { ListMemberToggle } from "@/components/admin/control-editors";
import { Activity, KeyRound, Network, Plug, ShieldCheck, ToggleRight, Webhook } from "lucide-react";
import { CardBody } from "@/components/ui/card";
import { AdminHeader, Empty, EmptyState, FilterBar, SectionLink, guard, sp } from "@/components/admin/kit";
import { BarList, StackedBar } from "@/components/admin/viz";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { integrationsOverview } from "@/server/modules/admin/integrations";
import { customerConnectMode, isPlatformManaged, PROVIDERS } from "@/server/modules/integrations/catalog";
import { platformAvailabilityMap } from "@/server/modules/integrations/platform-managed";
import { requestTime, requireViewer } from "@/server/session";

/** Integrations & API across organizations: connections, provider status, API keys, webhook failures, API usage. */
export default async function AdminIntegrationsPage({ searchParams }: PageProps<"/[locale]/integrations">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const query = await searchParams;
  const params = { provider: sp(query.provider), status: sp(query.status), org: sp(query.org) };
  const r = await guard(integrationsOverview(viewer.ctx, params), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const o = r.value;
  const [canRevoke, canControl, canOrgs, platform] = await Promise.all([canPlatform(viewer.ctx, "platform.security.manage"), canPlatform(viewer.ctx, "platform.controls.manage"), canPlatform(viewer.ctx, "platform.organizations.manage"), platformAvailabilityMap()]);
  const canDisconnect = canControl || canOrgs;
  const customerProviders = PROVIDERS.filter((p) => !isPlatformManaged(p.key));
  const managedProviders = PROVIDERS.filter((p) => isPlatformManaged(p.key));
  const tz = viewer.user.timezone;
  const now = requestTime();
  const base = `/${locale}/integrations`;
  const providerName = (k: string) => PROVIDERS.find((p) => p.key === k)?.name ?? k;
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Network />} title={t("admin.nav.integrations")} description={t("admin.integrations.subtitle")} why={t("admin.integrations.why")} actions={<SectionLink href={`/${locale}/controls`}>{t("admin.integrations.manageProviders")}</SectionLink>} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<ToggleRight />} title={t("admin.integrations.customerTitle")} description={t("admin.integrations.customerHint")} />
          <ul className="divide-y">
            {customerProviders.map((p) => (
              <li key={p.key} className="flex items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                <Badge tone={customerConnectMode(p) === "oauth" ? "info" : "neutral"}>{t(`admin.integrations.connectMode.${customerConnectMode(p)}`)}</Badge>
                <ListMemberToggle controlKey="disabledIntegrations" list={o.disabledIntegrations} member={p.key} canManage={canControl} label={p.name} />
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader icon={<ShieldCheck />} title={t("admin.integrations.managedTitle")} description={t("admin.integrations.managedHint")} actions={<SectionLink href={`/${locale}/keys`}>{t("admin.integrations.managedKeys")}</SectionLink>} />
          <ul className="divide-y">
            {managedProviders.map((p) => {
              const a = platform[p.key] ?? "awaiting_platform";
              return (
                <li key={p.key} className="flex items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                  <Badge tone={a === "available" ? "success" : a === "disabled" ? "danger" : "warning"}>{t(`admin.integrations.managedState.${a}`)}</Badge>
                  <ListMemberToggle controlKey="disabledIntegrations" list={o.disabledIntegrations} member={p.key} canManage={canControl} label={p.name} />
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
      <Card>
        <CardHeader icon={<Plug />} title={t("admin.integrations.providers")} description={t("admin.integrations.providersHint")} />
        {o.providers.length === 0 ? (
          <EmptyState icon={<Plug />} title={t("admin.integrations.noConnections")} body={t("admin.integrations.noConnectionsHint")} />
        ) : (
          <ul className="stagger grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {o.providers.map((p) => (
              <li key={p.provider} className="grid gap-3 rounded-lg border bg-surface p-3">
                <div className="flex items-center gap-2">
                  <Link href={`${base}?provider=${p.provider}`} className="truncate text-sm font-medium hover:underline">
                    {providerName(p.provider)}
                  </Link>
                  <Badge className="ms-auto" tone={p.disabled ? "danger" : "success"}>
                    {p.disabled ? t("admin.controls.disabled") : t("admin.controls.enabled")}
                  </Badge>
                </div>
                <StackedBar
                  label={providerName(p.provider)}
                  segments={[
                    { key: "c", label: t("admin.integrations.status.CONNECTED"), value: p.connected, tone: "success", href: `${base}?provider=${p.provider}&status=CONNECTED` },
                    { key: "e", label: t("admin.integrations.status.ERROR"), value: p.error, tone: "danger", href: `${base}?provider=${p.provider}&status=ERROR` },
                    { key: "d", label: t("admin.integrations.status.DISCONNECTED"), value: p.disconnected, tone: "muted", href: `${base}?provider=${p.provider}&status=DISCONNECTED` },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader icon={<Activity />} title={t("admin.integrations.connections")} />
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
                <Th>
                  <span className="sr-only">{t("admin.integrations.disconnect")}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {o.connections.map((c) => (
                <Tr key={c.id}>
                  <Td>{providerName(c.provider)}</Td>
                  <Td className="text-xs">
                    <Link href={`/${locale}/organizations/${c.organizationId}`} className="hover:underline">
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
                  <Td>
                    {canDisconnect && c.status !== "DISCONNECTED" && !isPlatformManaged(c.provider) ? (
                      <ActionButton label={t("admin.integrations.disconnect")} title={`${t("admin.integrations.disconnect")}: ${providerName(c.provider)} · ${c.organizationName}`} description={t("admin.integrations.disconnectHint")} path={`/api/v1/admin/integration-connections/${c.id}`} method="DELETE" variant="danger" />
                    ) : isPlatformManaged(c.provider) ? (
                      <span className="text-[11px] text-muted-foreground">{t("admin.integrations.legacyUnused")}</span>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<KeyRound />} title={t("admin.integrations.apiKeys")} />
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
          <CardHeader icon={<Activity />} title={t("admin.integrations.apiUsage")} description={t("admin.overview.last30")} />
          <CardBody>
            <BarList
              label={t("admin.integrations.apiUsage")}
              tone="info"
              items={o.apiUsage.map((u) => ({ key: u.organizationId, label: u.organizationName, value: u.requests, href: `/${locale}/organizations/${u.organizationId}` }))}
              empty={<EmptyState icon={<Activity />} title={t("admin.integrations.noUsage")} />}
            />
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader icon={<Webhook />} title={t("admin.integrations.webhookFailures")} />
        {o.failedDeliveries.length === 0 ? (
          <EmptyState icon={<Webhook />} title={t("admin.integrations.noFailures")} body={t("admin.integrations.noFailuresHint")} />
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
