import type { Metadata } from "next";
import { AddConnection, AddDomain, ConnectionActions, CopyValue, DomainActions, EnforceSsoToggle } from "@/components/enterprise/sso";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { can } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { ssoOverview, TXT_PREFIX } from "@/server/modules/enterprise/sso";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("enterprise.tabs.sso") };
}

export default async function SsoPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org } = await requireOrgContext(locale);
  let o: Awaited<ReturnType<typeof ssoOverview>>;
  try {
    o = await ssoOverview(viewer.ctx, org.id);
  } catch (e) {
    if (isAppError(e) && ["forbidden", "mfa_required"].includes(e.code)) return <Notice tone="warning">{t(`errors.${e.code}`)}</Notice>;
    throw e;
  }
  const canManage = await can(viewer.ctx, "organizations.manage", orgChain(org.id));
  const ready = o.connections.some((c) => c.enabled && c.protocol === "OIDC") && o.domains.some((d) => d.verifiedAt);
  const tz = viewer.user.timezone;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title={t("enterprise.sso.title")} description={t("enterprise.sso.subtitle")} />
        <CardBody className="grid gap-3 text-sm">
          <p className="min-w-0">
            {t("enterprise.sso.redirectUri")} <CopyValue value={o.redirectUri} />
          </p>
          <p className="text-muted-foreground">{t("enterprise.sso.howItWorks")}</p>
          {canManage ? (
            <EnforceSsoToggle orgId={org.id} enforced={o.enforceSso} ready={ready} />
          ) : (
            <p>{o.enforceSso ? t("enterprise.sso.enforcedOn") : t("enterprise.sso.enforcedOff")}</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("enterprise.sso.domainsTitle")} description={t("enterprise.sso.domainsHint")} />
        {o.domains.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("enterprise.sso.noDomains")}</p>
        ) : (
          <ul className="divide-y">
            {o.domains.map((d) => (
              <li key={d.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
                <div className="grid min-w-0 flex-1 gap-1">
                  <p className="flex items-center gap-2 font-medium" dir="ltr">
                    {d.domain}
                    {d.verifiedAt ? <Badge tone="success">{t("enterprise.sso.verified")}</Badge> : <Badge tone="warning">{t("enterprise.sso.unverified")}</Badge>}
                  </p>
                  {!d.verifiedAt ? (
                    <div className="grid gap-1 text-xs text-muted-foreground">
                      <span>{t("enterprise.sso.addTxt", { domain: d.domain })}</span>
                      <CopyValue value={`${TXT_PREFIX}${d.verificationToken}`} />
                      {d.lastCheckedAt ? (
                        <span>
                          {t("enterprise.sso.lastChecked", {
                            date: formatDateTime(d.lastCheckedAt, locale, tz),
                          })}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {canManage ? <DomainActions orgId={org.id} id={d.id} verified={!!d.verifiedAt} /> : null}
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <CardBody className="border-t">
            <AddDomain orgId={org.id} />
          </CardBody>
        ) : null}
      </Card>

      <Card>
        <CardHeader title={t("enterprise.sso.connectionsTitle")} />
        {o.connections.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("enterprise.sso.noConnections")}</p>
        ) : (
          <ul className="divide-y">
            {o.connections.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
                <div className="grid min-w-0 flex-1 gap-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {c.name}
                    <Badge tone="accent">{c.protocol}</Badge>
                    {c.enabled ? <Badge tone="success">{t("common.enabled")}</Badge> : <Badge>{t("common.disabled")}</Badge>}
                    {c.protocol === "SAML" ? <Badge tone="warning">{t("enterprise.sso.samlStored")}</Badge> : null}
                  </p>
                  {c.issuer ? (
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      {c.issuer} · {c.clientId}
                    </p>
                  ) : null}
                  {c.protocol === "SAML" ? (
                    <p className="text-xs text-muted-foreground">
                      {c.samlSsoUrl ?? "—"} {c.hasMetadata ? `· ${t("enterprise.sso.metadataStored")}` : ""}
                    </p>
                  ) : null}
                </div>
                {canManage ? <ConnectionActions orgId={org.id} id={c.id} enabled={c.enabled} protocol={c.protocol} /> : null}
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <CardBody className="grid gap-3 border-t">
            <h3 className="font-medium">{t("enterprise.sso.newConnection")}</h3>
            <AddConnection orgId={org.id} />
          </CardBody>
        ) : null}
      </Card>
    </div>
  );
}
