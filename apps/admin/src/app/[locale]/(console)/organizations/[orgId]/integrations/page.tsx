import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Plug, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { adminOwnAccountStatus } from "@/server/modules/admin/org-integrations";
import { hasTenantViewGrant } from "@/server/modules/admin/tenants";
import { ownAccountSetupFields, providerInfo } from "@/server/modules/integrations/catalog";
import { oauthClient } from "@/server/modules/integrations/providers";
import { requireViewer } from "@/server/session";

/**
 * The organization's OWN Stripe, Razorpay, WhatsApp Business and Mailchimp accounts (docs/integrations.md §7): status
 * per company, and — as the fallback to the customer's "Connect with X" — setup, rotation and removal by the Realy team
 * (MFA-gated platform permission, reason audited, secrets write-only and verified with the provider's connection test).
 */
export default async function AdminOrgIntegrationsPage({ params }: PageProps<"/[locale]/organizations/[orgId]/integrations">) {
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
      <p className="text-xs text-muted-foreground">
        {t("admin.ownAccounts.keysHint")}{" "}
        <Link href={`/${locale}/keys`} className="text-primary hover:underline">
          {t("admin.integrations.managedKeys")}
        </Link>
      </p>
    </div>
  );
}
