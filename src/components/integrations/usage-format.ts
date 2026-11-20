import { formatNumber } from "@/i18n/format";

/** Estimated provider cost (micro-USD) as USD with up to 4 decimals. */
export const formatCostMicros = (micros: number, locale: string) =>
  formatNumber(micros / 1_000_000, locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: micros > 0 && micros < 10_000 ? 4 : 2 });
