import type { Translate } from "@/i18n/translate";
import { formatMoney, formatNumber } from "@/i18n/format";
import { LIMITS, type AddonKey, type FeatureKey, type LimitKey } from "@/server/modules/entitlements/catalog";

/** i18n keys of catalog entries (pure; usable on the server and in client components). */
export const featureLabelKey = (k: FeatureKey | string) => `planCatalog.features.${k.replace(/^feature\./, "")}`;
export const limitLabelKey = (k: LimitKey | string) => `planCatalog.limits.${k.replace(/\./g, "_")}`;
export const addonLabelKey = (k: AddonKey | string) => `planCatalog.addons.${k.replace(/^addon\./, "")}`;
export const planNameKey = (k: string) => `planCatalog.plans.${k}.name`;

/** A limit value in its unit ("10,000 credits", "25 GB", "$2,000.00"); null = unlimited. */
export function formatLimitValue(t: Translate, locale: string, key: LimitKey, v: number | null): string {
  if (v === null) return t("planCatalog.unlimited");
  const unit = LIMITS[key].unit;
  if (unit === "mb") {
    return v >= 1024
      ? t("planCatalog.units.gb", { value: formatNumber(Math.round((v / 1024) * 10) / 10, locale) })
      : t("planCatalog.units.mb", { value: formatNumber(Math.round(v * 10) / 10, locale) });
  }
  if (unit === "cents") return formatMoney({ amountMinor: String(Math.round(v)), currency: "USD" }, locale);
  if (unit === "credits") return t("planCatalog.units.credits", { value: formatNumber(v, locale) });
  if (unit === "minutes") return t("planCatalog.units.minutes", { value: formatNumber(v, locale) });
  return formatNumber(v, locale);
}
