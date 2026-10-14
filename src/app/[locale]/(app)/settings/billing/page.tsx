import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { BillingPanel } from "@/components/settings/billing";
import { getLocale, getT } from "@/i18n/server";
import { formatMoney } from "@/i18n/format";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { getActiveSubscription } from "@/server/modules/billing/service";
import { requireOrgContext } from "@/server/workspace";

export default async function BillingSettingsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, companies } = await requireOrgContext(locale);
  const chain = orgChain(org.id);
  if (!(await can(viewer.ctx, "billing.read", chain))) return <Notice tone="warning">{t("errors.forbidden")}</Notice>;

  const [profile, countries, plans, canManage, subscription] = await Promise.all([
    db().billingProfile.findUnique({ where: { organizationId: org.id } }),
    db().country.findMany({ where: { status: "ACTIVE", billingEnabled: true }, select: { code: true }, orderBy: { code: "asc" } }),
    db().plan.findMany({ where: { status: "ACTIVE", public: true }, orderBy: { sortOrder: "asc" }, select: { key: true, name: true } }),
    can(viewer.ctx, "billing.manage", chain),
    getActiveSubscription(viewer.ctx, org.id),
  ]);
  const item = subscription?.items[0];

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title={t("settings.billing.current")} />
        <CardBody>
          {subscription && item ? (
            <p>
              <span className="font-medium">{subscription.plan.name}</span>{" "}
              <span className="text-muted-foreground">
                {t("settings.billing.lockedPrice", { version: item.priceVersion.version, amount: formatMoney({ amountMinor: item.unitAmountMinor, currency: item.currency }, locale) })}
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground">{t("settings.billing.noSubscription")}</p>
          )}
        </CardBody>
      </Card>
      <BillingPanel
        orgId={org.id}
        confirmedCountry={profile?.billingCountryConfirmedAt ? profile.billingCountryCode : null}
        countryCodes={countries.map((c) => c.code)}
        plans={plans}
        canManage={canManage}
        suggestions={{
          user: viewer.user.countryCode,
          companies: [...new Set(companies.map((c) => c.incorporationCountryCode).filter((c): c is string => !!c))],
        }}
      />
    </div>
  );
}
