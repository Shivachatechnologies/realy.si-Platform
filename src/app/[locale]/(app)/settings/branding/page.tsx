import type { Metadata } from "next";
import { BrandingForm, VerifyDomainButton } from "@/components/enterprise/branding-form";
import { CopyValue } from "@/components/enterprise/sso";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { can } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { getBranding } from "@/server/modules/enterprise/branding";
import { TXT_PREFIX } from "@/server/modules/enterprise/sso";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("enterprise.tabs.branding") };
}

export default async function BrandingPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org } = await requireOrgContext(locale);
  const chain = orgChain(org.id);
  if (!(await can(viewer.ctx, "organizations.read", chain))) return <Notice tone="warning">{t("errors.forbidden")}</Notice>;
  const [b, canManage] = await Promise.all([getBranding(org.id), can(viewer.ctx, "organizations.manage", chain)]);
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title={t("enterprise.branding.title")} description={t("enterprise.branding.subtitle")} />
        <CardBody>
          <BrandingForm
            orgId={org.id}
            canManage={canManage}
            initial={{
              productName: b?.productName ?? "",
              logoUrl: b?.logoUrl ?? "",
              primaryColor: b?.primaryColor ?? "",
              customDomain: b?.customDomain ?? "",
            }}
          />
        </CardBody>
      </Card>
      {b?.customDomain ? (
        <Card>
          <CardHeader
            title={t("enterprise.branding.domainTitle")}
            actions={b.customDomainVerifiedAt ? <Badge tone="success">{t("enterprise.sso.verified")}</Badge> : <Badge tone="warning">{t("enterprise.sso.unverified")}</Badge>}
          />
          <CardBody className="grid gap-2 text-sm">
            {b.customDomainVerifiedAt ? (
              <p>
                {t("enterprise.branding.domainVerified", {
                  domain: b.customDomain,
                })}
              </p>
            ) : (
              <>
                <p className="text-muted-foreground">{t("enterprise.sso.addTxt", { domain: b.customDomain })}</p>
                {b.customDomainToken ? <CopyValue value={`${TXT_PREFIX}${b.customDomainToken}`} /> : null}
                {canManage ? <VerifyDomainButton orgId={org.id} /> : null}
              </>
            )}
            <p className="text-xs text-muted-foreground">{t("enterprise.branding.domainRouting")}</p>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
