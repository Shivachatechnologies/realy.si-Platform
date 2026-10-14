import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Parse a user-entered major-unit amount ("49.99", "4,999") into integer minor units without
 * floating point. Accepts "." or "," as the decimal separator when it is followed by ≤ `digits`
 * digits at the end; other separators are treated as grouping. Returns null if invalid.
 */
export function parseMajorToMinor(input: string, digits: number): bigint | null {
  const s = input.trim().replace(/[\s '’]/g, "");
  if (!s || /[^0-9.,]/.test(s)) return null;
  let intPart = s;
  let frac = "";
  const m = digits > 0 ? s.match(new RegExp(`^(.*)[.,](\\d{1,${digits}})$`)) : null;
  if (m) {
    intPart = m[1]!;
    frac = m[2]!;
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (!/^\d+$/.test(intPart || "0")) return null;
  return BigInt(intPart || "0") * 10n ** BigInt(digits) + BigInt(frac.padEnd(digits, "0") || "0");
}
