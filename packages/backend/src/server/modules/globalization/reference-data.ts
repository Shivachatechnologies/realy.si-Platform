import type { DataRegion, TaxCalculation, TaxType, TextDirection } from "@/generated/prisma/enums";

/**
 * Initial reference data loaded by the seed. After seeding, the database is the source of truth and
 * admins change these values in the Admin Console. Tax rates are *reference* rates used for display
 * and MANUAL estimates only; authoritative tax is calculated by the tax provider at checkout.
 */

export const CURRENCIES = [
  { code: "USD", name: "US Dollar", symbol: "$", minorUnits: 2 },
  { code: "EUR", name: "Euro", symbol: "€", minorUnits: 2 },
  { code: "GBP", name: "Pound Sterling", symbol: "£", minorUnits: 2 },
  { code: "INR", name: "Indian Rupee", symbol: "₹", minorUnits: 2 },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", minorUnits: 2 },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", minorUnits: 2 },
  { code: "CAD", name: "Canadian Dollar", symbol: "CA$", minorUnits: 2 },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", minorUnits: 2 },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", minorUnits: 0 },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥", minorUnits: 2 },
  { code: "BRL", name: "Brazilian Real", symbol: "R$", minorUnits: 2 },
  { code: "SAR", name: "Saudi Riyal", symbol: "﷼", minorUnits: 2 },
] as const;

export const LOCALES: {
  tag: string;
  language: string;
  name: string;
  nativeName: string;
  direction: TextDirection;
  enabled: boolean;
  fallbackTag: string | null;
}[] = [
  { tag: "en-US", language: "en", name: "English (US)", nativeName: "English (US)", direction: "LTR", enabled: true, fallbackTag: null },
  { tag: "hi-IN", language: "hi", name: "Hindi", nativeName: "हिन्दी", direction: "LTR", enabled: true, fallbackTag: "en-US" },
  { tag: "ar-AE", language: "ar", name: "Arabic", nativeName: "العربية", direction: "RTL", enabled: true, fallbackTag: "en-US" },
  { tag: "de-DE", language: "de", name: "German", nativeName: "Deutsch", direction: "LTR", enabled: true, fallbackTag: "en-US" },
  { tag: "zh-CN", language: "zh", name: "Chinese (Simplified)", nativeName: "简体中文", direction: "LTR", enabled: true, fallbackTag: "en-US" },
  // Registered but disabled until their message catalogs ship.
  { tag: "en-GB", language: "en", name: "English (UK)", nativeName: "English (UK)", direction: "LTR", enabled: false, fallbackTag: "en-US" },
  { tag: "en-IN", language: "en", name: "English (India)", nativeName: "English (India)", direction: "LTR", enabled: false, fallbackTag: "en-US" },
  { tag: "es-ES", language: "es", name: "Spanish", nativeName: "Español", direction: "LTR", enabled: false, fallbackTag: "en-US" },
  { tag: "fr-FR", language: "fr", name: "French", nativeName: "Français", direction: "LTR", enabled: false, fallbackTag: "en-US" },
  { tag: "pt-BR", language: "pt", name: "Portuguese (Brazil)", nativeName: "Português (Brasil)", direction: "LTR", enabled: false, fallbackTag: "en-US" },
  { tag: "ja-JP", language: "ja", name: "Japanese", nativeName: "日本語", direction: "LTR", enabled: false, fallbackTag: "en-US" },
  { tag: "ko-KR", language: "ko", name: "Korean", nativeName: "한국어", direction: "LTR", enabled: false, fallbackTag: "en-US" },
  { tag: "ar-SA", language: "ar", name: "Arabic (Saudi Arabia)", nativeName: "العربية (السعودية)", direction: "RTL", enabled: false, fallbackTag: "ar-AE" },
];

export const REGIONS: {
  code: string;
  name: string;
  defaultCurrency: string;
  defaultLocale: string;
  timezone: string;
  dataRegion: DataRegion;
}[] = [
  { code: "US", name: "United States", defaultCurrency: "USD", defaultLocale: "en-US", timezone: "America/New_York", dataRegion: "US_EAST" },
  { code: "CANADA", name: "Canada", defaultCurrency: "CAD", defaultLocale: "en-US", timezone: "America/Toronto", dataRegion: "US_EAST" },
  { code: "LATAM", name: "Latin America", defaultCurrency: "BRL", defaultLocale: "pt-BR", timezone: "America/Sao_Paulo", dataRegion: "US_EAST" },
  { code: "EU", name: "European Union", defaultCurrency: "EUR", defaultLocale: "en-US", timezone: "Europe/Brussels", dataRegion: "EU_WEST" },
  { code: "UK", name: "United Kingdom", defaultCurrency: "GBP", defaultLocale: "en-GB", timezone: "Europe/London", dataRegion: "EU_WEST" },
  { code: "MIDDLE_EAST", name: "Middle East", defaultCurrency: "AED", defaultLocale: "ar-AE", timezone: "Asia/Dubai", dataRegion: "ME_CENTRAL" },
  { code: "INDIA", name: "India", defaultCurrency: "INR", defaultLocale: "hi-IN", timezone: "Asia/Kolkata", dataRegion: "AP_SOUTH" },
  { code: "APAC", name: "Asia Pacific", defaultCurrency: "SGD", defaultLocale: "en-US", timezone: "Asia/Singapore", dataRegion: "AP_SOUTHEAST" },
];

interface CountrySeed {
  code: string;
  name: string;
  regionCode: string;
  defaultLocale: string;
  supportedLocales: string[];
  defaultCurrency: string;
  supportedCurrencies: string[];
  defaultTimezone: string;
  paymentMethods: string[];
  tax: { taxType: TaxType; displayName: string; rateBps: number; priceIncludesTax: boolean; calculation: TaxCalculation; reverseChargeB2b: boolean };
}

const vat = (rateBps: number, displayName = "VAT", reverseChargeB2b = true) => ({
  taxType: "VAT" as const,
  displayName,
  rateBps,
  priceIncludesTax: true,
  calculation: "STRIPE_TAX" as const,
  reverseChargeB2b,
});

export const COUNTRIES: CountrySeed[] = [
  { code: "US", name: "United States", regionCode: "US", defaultLocale: "en-US", supportedLocales: ["en-US"], defaultCurrency: "USD", supportedCurrencies: ["USD"], defaultTimezone: "America/New_York", paymentMethods: ["card", "us_bank_account"], tax: { taxType: "SALES_TAX", displayName: "Sales tax", rateBps: 0, priceIncludesTax: false, calculation: "STRIPE_TAX", reverseChargeB2b: false } },
  { code: "CA", name: "Canada", regionCode: "CANADA", defaultLocale: "en-US", supportedLocales: ["en-US", "fr-FR"], defaultCurrency: "CAD", supportedCurrencies: ["CAD", "USD"], defaultTimezone: "America/Toronto", paymentMethods: ["card", "acss_debit"], tax: { taxType: "GST", displayName: "GST/HST", rateBps: 500, priceIncludesTax: false, calculation: "STRIPE_TAX", reverseChargeB2b: false } },
  { code: "BR", name: "Brazil", regionCode: "LATAM", defaultLocale: "pt-BR", supportedLocales: ["pt-BR", "en-US"], defaultCurrency: "BRL", supportedCurrencies: ["BRL", "USD"], defaultTimezone: "America/Sao_Paulo", paymentMethods: ["card", "boleto", "pix"], tax: { taxType: "DIGITAL_SERVICES_TAX", displayName: "Digital services taxes", rateBps: 0, priceIncludesTax: false, calculation: "STRIPE_TAX", reverseChargeB2b: false } },
  { code: "GB", name: "United Kingdom", regionCode: "UK", defaultLocale: "en-GB", supportedLocales: ["en-GB", "en-US"], defaultCurrency: "GBP", supportedCurrencies: ["GBP"], defaultTimezone: "Europe/London", paymentMethods: ["card", "bacs_debit"], tax: vat(2000) },
  { code: "DE", name: "Germany", regionCode: "EU", defaultLocale: "de-DE", supportedLocales: ["de-DE", "en-US"], defaultCurrency: "EUR", supportedCurrencies: ["EUR"], defaultTimezone: "Europe/Berlin", paymentMethods: ["card", "sepa_debit"], tax: vat(1900, "MwSt.") },
  { code: "FR", name: "France", regionCode: "EU", defaultLocale: "fr-FR", supportedLocales: ["fr-FR", "en-US"], defaultCurrency: "EUR", supportedCurrencies: ["EUR"], defaultTimezone: "Europe/Paris", paymentMethods: ["card", "sepa_debit"], tax: vat(2000, "TVA") },
  { code: "NL", name: "Netherlands", regionCode: "EU", defaultLocale: "en-US", supportedLocales: ["en-US"], defaultCurrency: "EUR", supportedCurrencies: ["EUR"], defaultTimezone: "Europe/Amsterdam", paymentMethods: ["card", "ideal", "sepa_debit"], tax: vat(2100, "BTW") },
  { code: "ES", name: "Spain", regionCode: "EU", defaultLocale: "es-ES", supportedLocales: ["es-ES", "en-US"], defaultCurrency: "EUR", supportedCurrencies: ["EUR"], defaultTimezone: "Europe/Madrid", paymentMethods: ["card", "sepa_debit"], tax: vat(2100, "IVA") },
  { code: "IT", name: "Italy", regionCode: "EU", defaultLocale: "en-US", supportedLocales: ["en-US"], defaultCurrency: "EUR", supportedCurrencies: ["EUR"], defaultTimezone: "Europe/Rome", paymentMethods: ["card", "sepa_debit"], tax: vat(2200, "IVA") },
  { code: "IE", name: "Ireland", regionCode: "EU", defaultLocale: "en-GB", supportedLocales: ["en-GB", "en-US"], defaultCurrency: "EUR", supportedCurrencies: ["EUR"], defaultTimezone: "Europe/Dublin", paymentMethods: ["card", "sepa_debit"], tax: vat(2300) },
  { code: "AE", name: "United Arab Emirates", regionCode: "MIDDLE_EAST", defaultLocale: "ar-AE", supportedLocales: ["ar-AE", "en-US"], defaultCurrency: "AED", supportedCurrencies: ["AED", "USD"], defaultTimezone: "Asia/Dubai", paymentMethods: ["card"], tax: vat(500, "VAT", false) },
  { code: "SA", name: "Saudi Arabia", regionCode: "MIDDLE_EAST", defaultLocale: "ar-SA", supportedLocales: ["ar-SA", "ar-AE", "en-US"], defaultCurrency: "SAR", supportedCurrencies: ["SAR", "USD"], defaultTimezone: "Asia/Riyadh", paymentMethods: ["card"], tax: vat(1500, "VAT", false) },
  { code: "IN", name: "India", regionCode: "INDIA", defaultLocale: "hi-IN", supportedLocales: ["hi-IN", "en-IN", "en-US"], defaultCurrency: "INR", supportedCurrencies: ["INR"], defaultTimezone: "Asia/Kolkata", paymentMethods: ["card", "upi"], tax: { taxType: "GST", displayName: "GST", rateBps: 1800, priceIncludesTax: false, calculation: "STRIPE_TAX", reverseChargeB2b: true } },
  { code: "SG", name: "Singapore", regionCode: "APAC", defaultLocale: "en-US", supportedLocales: ["en-US", "zh-CN"], defaultCurrency: "SGD", supportedCurrencies: ["SGD", "USD"], defaultTimezone: "Asia/Singapore", paymentMethods: ["card", "paynow"], tax: { taxType: "GST", displayName: "GST", rateBps: 900, priceIncludesTax: false, calculation: "STRIPE_TAX", reverseChargeB2b: true } },
  { code: "AU", name: "Australia", regionCode: "APAC", defaultLocale: "en-US", supportedLocales: ["en-US"], defaultCurrency: "AUD", supportedCurrencies: ["AUD"], defaultTimezone: "Australia/Sydney", paymentMethods: ["card", "au_becs_debit"], tax: { taxType: "GST", displayName: "GST", rateBps: 1000, priceIncludesTax: true, calculation: "STRIPE_TAX", reverseChargeB2b: true } },
  { code: "JP", name: "Japan", regionCode: "APAC", defaultLocale: "ja-JP", supportedLocales: ["ja-JP", "en-US"], defaultCurrency: "JPY", supportedCurrencies: ["JPY"], defaultTimezone: "Asia/Tokyo", paymentMethods: ["card", "konbini"], tax: { taxType: "VAT", displayName: "Consumption tax", rateBps: 1000, priceIncludesTax: true, calculation: "STRIPE_TAX", reverseChargeB2b: true } },
  { code: "CN", name: "China", regionCode: "APAC", defaultLocale: "zh-CN", supportedLocales: ["zh-CN", "en-US"], defaultCurrency: "CNY", supportedCurrencies: ["CNY"], defaultTimezone: "Asia/Shanghai", paymentMethods: ["card", "alipay", "wechat_pay"], tax: { taxType: "VAT", displayName: "VAT", rateBps: 600, priceIncludesTax: true, calculation: "STRIPE_TAX", reverseChargeB2b: false } },
];

/** Feature flag definitions (default off unless stated). Rules are administered in the console. */
export const FEATURE_FLAGS = [
  { key: "computer_use.advanced", description: "Advanced computer/browser use for digital employees", defaultEnabled: false },
  { key: "workforce.enabled", description: "Digital workforce runtime (Phase 4)", defaultEnabled: false },
  { key: "intelligence.objectives", description: "Objective planning (Phase 3)", defaultEnabled: false },
  { key: "integrations.realy_connect", description: "Realy Connect integrations (Phase 5)", defaultEnabled: false },
];
