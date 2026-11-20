import { Notice } from "@/components/ui/notice";
import { PricingConsole } from "@/components/admin/pricing-console";
import type { PlanDTO } from "@/components/admin/pricing-types";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { listCatalog, manageableMarkets } from "@/server/modules/pricing/service";
import { requestTime, requireViewer } from "@/server/session";

export default async function PricingConsolePage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  let catalog: Awaited<ReturnType<typeof listCatalog>>;
  try {
    catalog = await listCatalog(viewer.ctx);
  } catch (e) {
    if (isAppError(e) && e.code === "forbidden") return <Notice tone="warning">{t("errors.forbidden")}</Notice>;
    throw e;
  }
  const [scope, regions, countries, currencies] = await Promise.all([
    manageableMarkets(viewer.ctx),
    db().region.findMany({ orderBy: { code: "asc" }, select: { code: true } }),
    db().country.findMany({ orderBy: { code: "asc" }, select: { code: true, regionCode: true, supportedCurrencies: true } }),
    db().currency.findMany({ where: { enabled: true }, orderBy: { code: "asc" }, select: { code: true } }),
  ]);

  const plans: PlanDTO[] = catalog.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    status: p.status,
    defaultTrialDays: p.defaultTrialDays,
    entitlements: p.entitlements.map((e) => ({ featureKey: e.featureKey, enabled: e.enabled, limitValue: e.limitValue?.toString() ?? null })),
    prices: p.prices.map((pr) => ({
      id: pr.id,
      interval: pr.interval,
      marketType: pr.marketType,
      marketCode: pr.marketCode,
      currency: pr.currency,
      status: pr.status,
      versions: pr.versions.map((v) => ({
        id: v.id,
        version: v.version,
        amountMinor: v.amountMinor.toString(),
        currency: v.currency,
        effectiveFrom: v.effectiveFrom.toISOString(),
        effectiveTo: v.effectiveTo?.toISOString() ?? null,
        reason: v.reason,
      })),
    })),
  }));

  return (
    <PricingConsole
      plans={plans}
      scope={scope}
      timeZone={viewer.user.timezone}
      now={requestTime()}
      options={{
        regions: regions.map((r) => r.code),
        countries: countries.map((c) => ({ code: c.code, regionCode: c.regionCode, currencies: c.supportedCurrencies })),
        currencies: currencies.map((c) => c.code),
      }}
    />
  );
}
