import { Card, CardHeader } from "@/components/ui/card";
import { BillingOverview, type InvoiceWire } from "@/components/billing/billing-overview";
import type { OverviewWire } from "@/components/billing/upgrade-prompt";
import { entitlementOverview } from "@/server/modules/entitlements/offers";
import { Notice } from "@/components/ui/notice";
import { BillingPanel } from "@/components/settings/billing";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { billingConfigured, listInvoices } from "@/server/modules/billing/stripe-billing";
import { requireOrgContext } from "@/server/workspace";
import { getOrgLimits, limitUsage } from "@/server/modules/enterprise/policy";
import { formatNumber } from "@/i18n/format";
import Link from "next/link";

const toWire = <T,>(v: unknown): T => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

export default async function BillingSettingsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, companies } = await requireOrgContext(locale);
  const chain = orgChain(org.id);
  if (!(await can(viewer.ctx, "billing.read", chain))) return <Notice tone="warning">{t("errors.forbidden")}</Notice>;

  const [profile, countries, plans, canManage] = await Promise.all([
    db().billingProfile.findUnique({ where: { organizationId: org.id } }),
    db().country.findMany({
      where: { status: "ACTIVE", billingEnabled: true },
      select: { code: true },
      orderBy: { code: "asc" },
    }),
    db().plan.findMany({
      where: { status: "ACTIVE", public: true },
      orderBy: { sortOrder: "asc" },
      select: { key: true, name: true },
    }),
    can(viewer.ctx, "billing.manage", chain),
  ]);
  const [limits, members, companyCount, apiKeys] = await Promise.all([
    getOrgLimits(org.id),
    limitUsage(db(), org.id, "members"),
    limitUsage(db(), org.id, "companies"),
    limitUsage(db(), org.id, "apiKeys"),
  ]);
  const limitRows = [
    { k: "members", used: members, limit: limits.maxMembers },
    { k: "companies", used: companyCount, limit: limits.maxCompanies },
    { k: "apiKeys", used: apiKeys, limit: limits.maxApiKeys },
    { k: "aiAgents", used: null, limit: limits.plan.agentsMax },
  ];
  const [overview, invoiceList] = await Promise.all([
    entitlementOverview(viewer.ctx, org.id),
    listInvoices(viewer.ctx, org.id).catch(() => ({ configured: false as const, invoices: [] })),
  ]);

  return (
    <div className="grid gap-4">
      <BillingOverview
        initial={toWire<OverviewWire>(overview)}
        invoices={toWire<InvoiceWire[]>(invoiceList.invoices)}
        invoicesConfigured={invoiceList.configured}
        timeZone={viewer.user.timezone}
      />
      <Card>
        <CardHeader
          title={t("enterprise.limits.planLimits")}
          actions={
            <Link href={`/${locale}/settings/usage`} className="text-sm text-primary hover:underline">
              {t("enterprise.tabs.usage")}
            </Link>
          }
        />
        <dl className="grid gap-px bg-border sm:grid-cols-4">
          {limitRows.map((r) => (
            <div key={r.k} className="bg-surface p-3">
              <dt className="text-xs text-muted-foreground">{t(`enterprise.limits.rows.${r.k}`)}</dt>
              <dd className="text-sm font-medium tabular">
                {r.used !== null ? formatNumber(r.used, locale) : ""}
                {r.used !== null ? " / " : ""}
                {r.limit === null ? t("enterprise.limits.unlimited") : formatNumber(r.limit, locale)}
              </dd>
            </div>
          ))}
        </dl>
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
