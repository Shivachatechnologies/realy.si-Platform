/** Locale-aware formatting. All UI formatting goes through here (docs/globalization.md §3). */

export interface MoneyLike {
  amountMinor: bigint | string;
  currency: string;
}

const fractionDigitsCache = new Map<string, number>();

/** ISO 4217 minor units, from Intl (JPY → 0, USD → 2). */
export function minorUnits(currency: string): number {
  let d = fractionDigitsCache.get(currency);
  if (d === undefined) {
    d = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    fractionDigitsCache.set(currency, d);
  }
  return d;
}

/**
 * Format integer minor units without converting through floating point: the decimal string is
 * built from the bigint and handed to Intl as a string (exact for any magnitude).
 */
export function formatMoney(m: MoneyLike, locale: string, opts: { display?: "symbol" | "code" | "narrowSymbol" } = {}): string {
  const amount = typeof m.amountMinor === "bigint" ? m.amountMinor : BigInt(m.amountMinor);
  const digits = minorUnits(m.currency);
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const s = abs.toString().padStart(digits + 1, "0");
  const decimal = digits === 0 ? s : `${s.slice(0, -digits)}.${s.slice(-digits)}`;
  const nf = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: m.currency,
    currencyDisplay: opts.display ?? "symbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return nf.format(`${negative ? "-" : ""}${decimal}` as unknown as number);
}

export function formatNumber(n: number | bigint, locale: string, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, opts).format(n);
}

export function formatDate(d: Date | string, locale: string, timeZone: string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone }).format(typeof d === "string" ? new Date(d) : d);
}

export function formatDateTime(d: Date | string, locale: string, timeZone: string): string {
  return formatDate(d, locale, timeZone, { dateStyle: "medium", timeStyle: "short" });
}

export function formatRelativeTime(d: Date | string, locale: string, now = Date.now()): string {
  const diffSec = Math.round(((typeof d === "string" ? new Date(d) : d).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) {
    if (Math.abs(diffSec) >= secs) return rtf.format(Math.round(diffSec / secs), unit);
  }
  return rtf.format(diffSec, "second");
}

export function formatList(items: string[], locale: string): string {
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
}

/** Localized display names for regions/currencies/languages from CLDR via Intl. */
export function displayName(code: string, type: "region" | "currency" | "language", locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type }).of(code) ?? code;
  } catch {
    return code;
  }
}
