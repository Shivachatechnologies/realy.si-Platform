import Link from "next/link";
import { HeartPulse, Plug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, FilterBar, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { SourceNote, money } from "@/components/admin/security/page-kit";
import { getLocale, getT } from "@/i18n/server";
import { integrationProviders } from "@/server/modules/admin/integrations";
import { requireViewer } from "@/server/session";

/** Integration center v2: every provider with credentials state (never values), connections, health, usage and webhooks. */
export default async function IntegrationProvidersPage({ searchParams }: PageProps<"/[locale]/integrations/providers">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const params = { category: sp(q.category), health: sp(q.health), q: sp(q.q) };
  const r = await guard(integrationProviders(viewer.ctx, params), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const d = r.value;
  const base = `/${locale}/integrations/providers`;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: t("admin.integrations.healthCenter") }]} />
      <AdminHeader icon={<HeartPulse />} title={t("admin.integrations.healthCenter")} description={t("admin.integrations.healthSubtitle")} why={t("admin.integrations.healthWhy")} meta={<SourceNote source="integration_connections · integration_request_logs · integration_usage · integration_provider_events · platform keys" at={new Date()} label={{ source: t("admin.settings.kit.source"), updated: t("admin.settings.kit.updated") }} />} />
      <StatGrid>
        <StatTile icon={<Plug />} label={t("admin.integrations.providers")} value={d.totals.providers} href={base} />
        <StatTile label={t("admin.integrations.failingProviders")} value={d.totals.failing} tone={d.totals.failing ? "danger" : undefined} href={`${base}?health=failing`} />
        <StatTile label={t("admin.integrations.unconfiguredProviders")} value={d.totals.unconfigured} tone={d.totals.unconfigured ? "warning" : undefined} href={`${base}?health=missing`} />
        <StatTile label={t("admin.integrations.disabledProviders")} value={d.totals.disabled} href={`${base}?health=disabled`} />
      </StatGrid>
      <Card>
        <FilterBar
          action={base}
          q={params.q}
          qLabel={t("admin.integrations.searchProvider")}
          values={params}
          submitLabel={t("admin.settings.kit.apply")}
          filters={[
            { name: "category", label: t("admin.integrations.category"), options: d.categories.map((c) => ({ value: c, label: c })) },
            { name: "health", label: t("admin.integrations.health"), options: (["failing", "configured", "missing", "disabled"] as const).map((h) => ({ value: h, label: t(`admin.integrations.healthFilter.${h}`) })) },
          ]}
        />
        {d.providers.length === 0 ? (
          <EmptyState icon={<Plug />} title={t("admin.integrations.noProviders")} body={t("admin.common.tryOtherFilters")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.integrations.provider")}</Th>
                <Th>{t("admin.integrations.health")}</Th>
                <Th>{t("admin.integrations.credentials")}</Th>
                <Th>{t("admin.integrations.connections")}</Th>
                <Th>{t("admin.integrations.lastSuccessFailure")}</Th>
                <Th>{t("admin.integrations.usage30d")}</Th>
                <Th>{t("admin.integrations.webhooks")}</Th>
              </Tr>
            </THead>
            <TBody>
              {d.providers.map((p) => (
                <Tr key={p.key}>
                  <Td>
                    <Link href={`${base}/${p.key}`} className="font-medium text-primary hover:underline">{p.name}</Link>
                    <div className="text-[11px] text-muted-foreground">
                      {p.category} · {p.managed ? t("admin.integrations.realyManaged") : t(`admin.integrations.connectMode.${p.credentials.mode}`)}
                      {p.availability === "awaiting_docs" ? ` · ${t("admin.integrations.awaitingDocs")}` : ""}
                    </div>
                  </Td>
                  <Td><StatusBadge domain="integrationHealth" value={p.health}>{t(`admin.integrations.healthStates.${p.health}`)}</StatusBadge></Td>
                  <Td className="text-xs">
                    {p.credentials.platformKeys === "not_applicable" ? <span className="text-muted-foreground">{t("admin.integrations.perConnection")}</span> : <Badge tone={p.credentials.platformKeys === "configured" ? "success" : p.credentials.platformKeys === "partial" ? "warning" : "danger"}>{t(`admin.integrations.keyStates.${p.credentials.platformKeys}`)}</Badge>}
                  </Td>
                  <Td className="text-xs tabular-nums">
                    <span className="text-success">{p.connections.connected}</span> / <span className={p.connections.error ? "text-danger" : ""}>{p.connections.error}</span> / <span className="text-muted-foreground">{p.connections.disconnected}</span>
                  </Td>
                  <Td className="text-xs text-muted-foreground">
                    {p.lastSuccessAt ? <div className="text-success"><Timestamp value={p.lastSuccessAt} mode="relative" /></div> : null}
                    {p.lastFailureAt ? <div className="text-danger"><Timestamp value={p.lastFailureAt} mode="relative" /></div> : null}
                    {!p.lastSuccessAt && !p.lastFailureAt ? t("admin.settings.kit.noData") : null}
                  </Td>
                  <Td className="text-xs">{p.usage30d ? `${p.usage30d.calls} · ${money(Math.round(p.usage30d.costMicros / 10_000), "USD", locale)}` : "—"}</Td>
                  <Td className="text-xs">{p.webhooks ? `${p.webhooks.scheme} · ${p.webhooks.events7d}${p.webhooks.failed7d ? ` (${p.webhooks.failed7d}!)` : ""}` : "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
