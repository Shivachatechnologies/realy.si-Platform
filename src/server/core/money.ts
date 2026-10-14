/** Integer minor units + ISO 4217 code. Never floating point. */
export interface Money {
  amountMinor: bigint;
  currency: string;
}

export const CURRENCY_RE = /^[A-Z]{3}$/;

export function money(amountMinor: bigint | number | string, currency: string): Money {
  const amount = typeof amountMinor === "bigint" ? amountMinor : BigInt(amountMinor);
  if (!CURRENCY_RE.test(currency)) throw new Error(`Invalid ISO 4217 currency: ${currency}`);
  return { amountMinor: amount, currency };
}

function same(a: Money, b: Money) {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
}

export function addMoney(a: Money, b: Money): Money {
  same(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  same(a, b);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

/**
 * amount × bps / 10000 with round-half-to-even (banker's rounding) in minor units.
 * Used for percent discounts and MANUAL tax estimates.
 */
export function applyBps(m: Money, bps: number): Money {
  if (!Number.isInteger(bps)) throw new Error("bps must be an integer");
  const num = m.amountMinor * BigInt(bps);
  const den = 10_000n;
  let q = num / den;
  const r = num % den;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice > den || (twice === den && q % 2n !== 0n)) q += num < 0n ? -1n : 1n;
  return { amountMinor: q, currency: m.currency };
}

/** Wire format: amountMinor as string so 64-bit values survive JSON. */
export function toWire(m: Money): { amountMinor: string; currency: string } {
  return { amountMinor: m.amountMinor.toString(), currency: m.currency };
}
