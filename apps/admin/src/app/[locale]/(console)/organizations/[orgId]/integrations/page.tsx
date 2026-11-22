import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { History, Plug, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ActionButton } from "@/components/admin/action-dialog";
import { AdminHeader, SectionLink, guard } from "@/components/admin/kit";
import { OwnAccountSetupButton } from "@/components/admin/own-account-setup";
import { OrgTabs } from "@/components/admin/people-extras";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { adminIntegrationRequestLogs, adminOwnAccountStatus } from "@/server/modules/admin/org-integrations";
import { hasTenantViewGrant } from "@/server/modules/admin/tenants";
import { ownAccountSetupFields, providerInfo } from "@/server/modules/integrations/catalog";
import { oauthClient } from "@/server/modules/integrations/providers";
import { requireViewer } from "@/server/session";

/**
 * The organization's OWN Stripe, Razorpay, WhatsApp Business and Mailchimp accounts (docs/integrations.md §7): status
 * per company, and — as the fallback to the customer's "Connect with X" — setup, rotation and removal by the Realy team
 * (MFA-gated platform permission, reason audited, secrets write-only and verified with the provider's connection test).
 */
export default async function AdminOrgIntegrationsPage({ params, searchParams }: PageProps<"/[locale]/organizations/[orgId]/integrations">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { orgId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  // Same audited reason gate as the overview: open the organization once with a reason, then the tabs.
  if (!(await hasTenantViewGrant(viewer.ctx, orgId))) redirect(`/${locale}/organizations/${orgId}`);
  const r = await guard(adminOwnAccountStatus(viewer.ctx, orgId), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const { organization, companies } = r.value;
  const [controls, security] = await Promise.all([canPlatform(viewer.ctx, "platform.controls.manage"), canPlatform(viewer.ctx, "platform.security.manage")]);
  const canManage = controls || security;
  const tz = viewer.user.timezone;
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => typeof v === "string" && v));
  const logs = await adminIntegrationRequestLogs(viewer.ctx, orgId, { ...sp, limit: 50 });
  const companyName = new Map(logs.companies.map((c) => [c.id, c.name]));
  const olderHref = logs.nextCursor ? `?${new URLSearchParams({ ...sp, cursor: logs.nextCursor }).toString()}#request-log` : null;
  return (
    <div className="grid gap-4">
      <OrgTabs locale={locale} orgId={orgId} active="integrations" />
      <AdminHeader
        icon={<Wallet />}
        title={t("admin.ownAccounts.title", { name: organization.name })}
        description={t("admin.ownAccounts.subtitle")}
        actions={<SectionLink href={`/${locale}/integrations?org=${orgId}`}>{t("admin.ownAccounts.allConnections")}</SectionLink>}
      />
      {!canManage ? <Notice tone="info">{t("admin.ownAccounts.readOnly")}</Notice> : null}
      {companies.length === 0 ? <Notice tone="info">{t("admin.ownAccounts.noCompanies")}</Notice> : null}
      {companies.map(({ company, providers }) => (
        <Card key={company.id}>
          <CardHeader icon={<Plug />} title={company.name} description={t("admin.ownAccounts.companyHint")} />
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.integrations.provider")}</Th>
                <Th>{t("admin.users.columns.status")}</Th>
                <Th>{t("admin.ownAccounts.account")}</Th>
                <Th>{t("admin.ownAccounts.setupBy")}</Th>
                <Th>{t("admin.ownAccounts.lastTested")}</Th>
                <Th className="text-end">{t("admin.common.actions")}</Th>
              </Tr>
            </THead>
            <TBody>
              {providers.map((p) => {
                const info = providerInfo(p.provider)!;
                const fields = ownAccountSetupFields(info).map((f) => ({ key: f.key, secret: f.secret, required: f.required, placeholder: f.placeholder, labelKey: f.labelKey }));
                return (
                  <Tr key={p.provider}>
                    <Td>
                      <div className="text-sm">{info.name}</div>
                      <div className="text-[11px] text-muted-foreground">{oauthClient(p.provider) ? t("admin.ownAccounts.connectReady") : t("admin.ownAccounts.connectMissing")}</div>
                    </Td>
                    <Td>
                      {p.status ? (
                        <Badge tone={p.status === "CONNECTED" ? "success" : "danger"}>{t(`admin.integrations.status.${p.status}`)}</Badge>
                      ) : (
                        <Badge>{t("admin.ownAccounts.notConnected")}</Badge>
                      )}
                      {p.lastError ? (
                        <div className="max-w-60 truncate text-[11px] text-danger" title={p.lastError}>
                          {p.lastError}
                        </div>
                      ) : null}
                    </Td>
                    <Td className="max-w-56 truncate text-xs">{p.account ?? "—"}</Td>
                    <Td className="text-xs">{p.setupBy ? t(`admin.ownAccounts.by.${p.setupBy}`) : "—"}</Td>
                    <Td className="text-xs whitespace-nowrap text-muted-foreground">{p.lastTestedAt ? formatDateTime(p.lastTestedAt, locale, tz) : "—"}</Td>
                    <Td>
                      {canManage ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          <OwnAccountSetupButton orgId={orgId} companyId={company.id} provider={p.provider} name={info.name} fields={fields} rotate={!!p.connectionId} hint={t(`integrations.providers.${p.provider}.setup`)} />
                          {p.connectionId ? (
                            <ActionButton
                              label={t("admin.ownAccounts.remove")}
                              title={`${t("admin.ownAccounts.remove")}: ${info.name} · ${company.name}`}
                              description={t("admin.ownAccounts.removeHint")}
                              path={`/api/v1/admin/organizations/${orgId}/own-accounts/connections/${p.connectionId}`}
                              method="DELETE"
                              variant="danger"
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </Card>
      ))}
      <Card id="request-log">
        <CardHeader icon={<History />} title={t("admin.requestLog.title")} description={t("admin.requestLog.subtitle")} />
        <form method="get" action="#request-log" className="flex flex-wrap items-end gap-2 border-b border-border p-3 text-sm">
          <label className="grid gap-1 text-xs">
            {t("admin.requestLog.company")}
            <Select name="companyId" defaultValue={logs.filters.companyId ?? ""}>
              <option value="">{t("admin.requestLog.allCompanies")}</option>
              {logs.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-1 text-xs">
            {t("admin.integrations.provider")}
            <Select name="provider" defaultValue={logs.filters.provider ?? ""}>
              <option value="">{t("admin.requestLog.allProviders")}</option>
              {logs.providers.map((p) => (
                <option key={p} value={p}>
                  {providerInfo(p)?.name ?? p}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-1 text-xs">
            {t("admin.requestLog.outcome")}
            <Select name="outcome" defaultValue={logs.filters.outcome}>
              <option value="all">{t("admin.requestLog.outcomes.all")}</option>
              <option value="errors">{t("admin.requestLog.outcomes.errors")}</option>
            </Select>
          </label>
          <Button type="submit" variant="secondary" size="sm">
            {t("admin.requestLog.apply")}
          </Button>
        </form>
        {logs.data.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("admin.requestLog.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.requestLog.when")}</Th>
                <Th>{t("admin.integrations.provider")}</Th>
                <Th>{t("admin.requestLog.request")}</Th>
                <Th>{t("admin.requestLog.status")}</Th>
                <Th className="text-end">{t("admin.requestLog.duration")}</Th>
                <Th>{t("admin.requestLog.result")}</Th>
              </Tr>
            </THead>
            <TBody>
              {logs.data.map((l) => (
                <Tr key={l.id}>
                  <Td className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(l.createdAt, locale, tz)}</Td>
                  <Td>
                    <div className="text-sm">{providerInfo(l.provider)?.name ?? l.provider}</div>
                    <div className="text-[11px] text-muted-foreground">{companyName.get(l.companyId) ?? "—"}</div>
                  </Td>
                  <Td className="max-w-80">
                    <div className="truncate font-mono text-xs" title={l.url}>
                      {l.method} {l.url}
                    </div>
                    {l.requestSummary ? <div className="truncate text-[11px] text-muted-foreground">{l.requestSummary}</div> : null}
                  </Td>
                  <Td>
                    <Badge tone={l.status === null || l.status >= 400 ? "danger" : "success"}>{l.status ?? t("admin.requestLog.noResponse")}</Badge>
                    {l.attempts > 1 ? <div className="text-[11px] text-muted-foreground">{t("admin.requestLog.attempts", { count: l.attempts })}</div> : null}
                  </Td>
                  <Td className="text-end text-xs tabular">{t("admin.requestLog.ms", { ms: l.durationMs })}</Td>
                  <Td className="max-w-72">
                    <div className={`truncate text-xs ${l.error ? "text-danger" : "text-muted-foreground"}`} title={l.error ?? l.responseSummary ?? ""}>
                      {l.error ?? l.responseSummary ?? "—"}
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        {olderHref ? (
          <div className="border-t border-border p-3 text-end">
            <Link href={olderHref} className="text-sm text-primary hover:underline">
              {t("admin.requestLog.older")}
            </Link>
          </div>
        ) : null}
      </Card>
      <p className="text-xs text-muted-foreground">
        {t("admin.ownAccounts.keysHint")}{" "}
        <Link href={`/${locale}/keys`} className="text-primary hover:underline">
          {t("admin.integrations.managedKeys")}
        </Link>
      </p>
    </div>
  );
}
