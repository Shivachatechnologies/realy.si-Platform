/** Serializable catalog shapes passed from the server page to the Pricing Console (bigint → string). */
export interface PriceVersionDTO {
  id: string;
  version: number;
  amountMinor: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string;
}

export interface PriceDTO {
  id: string;
  interval: "MONTH" | "YEAR";
  marketType: "GLOBAL" | "REGION" | "COUNTRY";
  marketCode: string;
  currency: string;
  status: "ACTIVE" | "INACTIVE";
  versions: PriceVersionDTO[];
}

export interface PlanDTO {
  id: string;
  key: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "DISABLED";
  defaultTrialDays: number;
  prices: PriceDTO[];
  entitlements: { featureKey: string; enabled: boolean; limitValue: string | null }[];
}

export interface MarketScope {
  platform: boolean;
  regions: string[];
  countries: string[];
}

export interface MarketOptions {
  regions: string[];
  countries: { code: string; regionCode: string; currencies: string[] }[];
  currencies: string[];
}
