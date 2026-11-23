import Link from "next/link";
import { notFound } from "next/navigation";
import { Plug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Facts, SectionLink, guard } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { ListMemberToggle } from "@/components/admin/control-editors";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { ProbeButton } from "@/components/admin/security/actions";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { getControls } from "@/server/core/platform-controls";
import { capabilitiesFor } from "@/server/modules/admin/access";
import { integrationProviderDetail } from "@/server/modules/admin/integrations";
import { isPlatformManaged, platformCredentialFields, providerInfo } from "@/server/modules/integrations/catalog";
import { requireViewer } from "@/server/session";

/** One provider: configuration, credential state, connections (no credentials), OAuth issues, sync runs, logs, events. */
export default async function IntegrationProviderPage({ params }: PageProps<"/[locale]/integrations/providers/[provider]">) {
  const { provider } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  let r;
  try {
    r = await guard(Promise.all([integrationProviderDetail(viewer.ctx, provider), capabilitiesFor(viewer.ctx, ["platform.controls.manage", "platform.security.manage"]), getControls()]), t("errors.forbidden"));
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") notFound();
    throw e;
  }
  if (!r.ok) return r.node;
  const [d, caps, controls] = r.value;
  const p = d.provider;
  const info = providerInfo(provider)!;
  const testKey = isPlatformManaged(provider) ? platformCredentialFields(info).find((f) => f.required)?.envKey : undefined;
  const base = `/${locale}`;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: d.info.name }]} />
      <AdminHeader
        icon={<Plug />}
        title={d.info.name}
        eyebrow={p ? <StatusBadge domain="integrationHealth" value={p.health}>{t(`admin.integrations.healthStates.${p.health}`)}</StatusBadge> : null}
        description={`${d.info.category} · ${d.info.key}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ListMemberToggle controlKey="disabledIntegrations" list={controls.disabledIntegrations} member={provider} canManage={caps["platform.controls.manage"]} label={d.info.name} />
            {testKey && (caps["platform.controls.manage"] || caps["platform.security.manage"]) ? <ProbeButton path={`/api/v1/admin/platform-secrets/${testKey}/test`} label={t("admin.integrations.test")} /> : null}
            {isPlatformManaged(provider) ? <SectionLink href={`${base}/keys`}>{t("admin.integrations.rotateKeys")}</SectionLink> : null}
            <SectionLink href={`${base}/integrations/requests?provider=${provider}`}>{t("admin.integrations.requestLog")}</SectionLink>
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.integrations.configuration")} />
          <Facts
            rows={[
              [t("admin.integrations.authType"), info.authType],
              [t("admin.integrations.credentials"), p ? (p.credentials.platformKeys === "not_applicable" ? t("admin.integrations.perConnection") : t(`admin.integrations.keyStates.${p.credentials.platformKeys}`)) : "—"],
              [t("admin.integrations.missingKeys"), p?.credentials.missingKeys.length ? <span key="m" className="font-mono text-[11px]">{p.credentials.missingKeys.join(", ")}</span> : "—"],
              [t("admin.integrations.permissions"), info.scopes.length ? <span key="s" className="font-mono text-[11px]">{info.scopes.join(" ")}</span> : "—"],
              [t("admin.integrations.inboundWebhooks"), d.info.inboundWebhooks ? `${d.info.inboundWebhooks.scheme} · ${d.info.inboundWebhooks.events.join(", ")}` : "—"],
              [t("admin.integrations.oauthIssues"), t("admin.integrations.oauthIssuesValue", { errors: d.oauthIssues.errorConnections, expiring: d.oauthIssues.tokensExpiringIn7d })],
              [t("admin.integrations.docs"), <a key="d" href={info.docsUrl} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">{info.docsUrl}</a>],
            ]}
          />
        </Card>
        <Card>
          <CardHeader title={t("admin.integrations.usageHealth")} />
          <Facts
            rows={[
              [t("admin.integrations.connections"), p ? `${p.connections.connected} / ${p.connections.error} / ${p.connections.disconnected}` : "—"],
              [t("admin.integrations.requests7d"), p ? t("admin.integrations.requestsValue", { total: p.requests7d.total, errors: p.requests7d.errors }) : "—"],
              [t("admin.integrations.usage30d"), p?.usage30d ? `${p.usage30d.calls} · ${p.usage30d.units}` : t("admin.settings.kit.noData")],
              [t("admin.integrations.lastSuccess"), p?.lastSuccessAt ? <Timestamp key="s" value={p.lastSuccessAt} /> : "—"],
              [t("admin.integrations.lastFailure"), p?.lastFailureAt ? <Timestamp key="f" value={p.lastFailureAt} /> : "—"],
              [t("admin.integrations.platformAvailability"), p?.disabled ? <Badge key="a" tone="neutral">{t("admin.integrations.healthStates.disabled")}</Badge> : <Badge key="a" tone="success">{t("admin.integrations.enabledPlatform")}</Badge>],
            ]}
          />
        </Card>
      </div>
      <Card>
        <CardHeader title={t("admin.integrations.connections")} description={t("admin.integrations.connectionsHint")} />
        {d.connections.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("admin.integrations.noConnections")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.settings.kit.organization")}</Th>
                <Th>{t("admin.integrations.status")}</Th>
                <Th>{t("admin.integrations.lastError")}</Th>
                <Th>{t("admin.integrations.tokenExpires")}</Th>
              </Tr>
            </THead>
            <TBody>
              {d.connections.map((c) => (
                <Tr key={c.id}>
                  <Td className="text-xs">
                    <Link href={`${base}/organizations/${c.organizationId}/integrations`} className="hover:underline">{c.organizationName}</Link>
                    <div className="text-[11px] text-muted-foreground">{c.company.name}</div>
                  </Td>
                  <Td><Badge tone={c.status === "CONNECTED" ? "success" : c.status === "ERROR" ? "danger" : "neutral"}>{c.status}</Badge>{c.errorStreak ? <span className="ms-1 text-[11px] text-danger">×{c.errorStreak}</span> : null}</Td>
                  <Td className="max-w-xs truncate text-xs text-muted-foreground">{c.lastError ?? "—"}</Td>
                  <Td className="text-xs">{c.tokenExpiresAt ? <Timestamp value={c.tokenExpiresAt} mode="relative" /> : "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.integrations.syncRuns")} />
          {d.syncRuns.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("admin.settings.kit.noEvents")}</p>
          ) : (
            <ul className="divide-y text-xs">
              {d.syncRuns.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <span>{s.kind} · {s.organizationName}</span>
                  <span className="flex items-center gap-2"><Badge tone={s.status === "SUCCEEDED" ? "success" : s.status === "FAILED" ? "danger" : "neutral"}>{s.status}</Badge><Timestamp value={s.startedAt} mode="relative" /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={t("admin.integrations.providerEvents")} />
          {d.events.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("admin.settings.kit.noEvents")}</p>
          ) : (
            <ul className="divide-y text-xs">
              {d.events.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <span className="font-mono">{e.eventType}</span>
                  <span className="flex items-center gap-2"><Badge>{e.status}</Badge><Timestamp value={e.receivedAt} mode="relative" /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
