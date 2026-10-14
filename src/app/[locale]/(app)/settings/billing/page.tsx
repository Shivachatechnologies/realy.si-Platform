import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { BillingPanel } from "@/components/settings/billing";
import { getLocale, getT } from "@/i18n/server";
import { formatMoney } from "@/i18n/format";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { getActiveSubscription } from "@/server/modules/billing/service";
import { billingConfigured } from "@/server/modules/billing/stripe-billing";
import { formatDate } from "@/i18n/format";
import { Badge } from "@/components/ui/badge";
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
            <div className="grid gap-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{subscription.plan.name}</span>
                <Badge tone={subscription.status === "ACTIVE" || subscription.status === "TRIALING" ? "success" : "warning"}>{t(`settings.billing.statuses.${subscription.status}`)}</Badge>
                <span className="text-muted-foreground">
                  {t("settings.billing.lockedPrice", { version: item.priceVersion.version, amount: formatMoney({ amountMinor: item.unitAmountMinor, currency: item.currency }, locale) })}
                </span>
              </p>
              {subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd ? (
                <p className="text-xs text-muted-foreground">{t("settings.billing.cancelsAt", { date: formatDate(subscription.currentPeriodEnd, locale, viewer.user.timezone) })}</p>
              ) : null}
            </div>
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
        billingConfigured={billingConfigured()}
        hasBillingAccount={!!profile?.stripeCustomerId}
        suggestions={{
          user: viewer.user.countryCode,
          companies: [...new Set(companies.map((c) => c.incorporationCountryCode).filter((c): c is string => !!c))],
        }}
      />
    </div>
  );
}
