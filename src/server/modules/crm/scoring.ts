/**
 * Transparent, rule-based lead score (0–100), adapted from Shivacha OS: fit signals plus pipeline progress. Low scores
 * are NURTURE, never rejected. No hidden model: sales can see why a lead scored as it did.
 */

const FREE_EMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "hotmail.com", "outlook.com", "live.com", "msn.com", "icloud.com", "me.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "yandex.com", "zoho.com", "rediffmail.com", "qq.com", "163.com",
]);

export const normalizeEmail = (email: string | null | undefined) => (email ? email.trim().toLowerCase() : null) || null;
/** Last 10 digits (needs at least 7 to count). */
export const normalizePhone = (phone: string | null | undefined) => {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : null;
};
export const isWorkEmail = (email: string | null | undefined) => {
  const domain = normalizeEmail(email)?.split("@")[1];
  return !!domain && !FREE_EMAIL.has(domain);
};

const STAGE_POINTS = { NEW: 0, CONTACTED: 5, QUALIFIED: 15, PROPOSAL: 25, WON: 25, LOST: 0 } as const;

export interface ScoreInput {
  email?: string | null;
  phone?: string | null;
  account?: string | null;
  notes?: string | null;
  valueMinor?: bigint | null;
  stage: keyof typeof STAGE_POINTS;
}

export function scoreLead(l: ScoreInput): { score: number; label: "HOT" | "WARM" | "NURTURE" } {
  let s = 10;
  if (isWorkEmail(l.email)) s += 20;
  else if (l.email) s += 8;
  if (normalizePhone(l.phone)) s += 10;
  if (l.account?.trim()) s += 15;
  if (l.valueMinor && l.valueMinor > 0n) s += 15;
  const len = l.notes?.trim().length ?? 0;
  s += len > 200 ? 10 : len > 60 ? 6 : len > 0 ? 2 : 0;
  s += STAGE_POINTS[l.stage];
  const score = l.stage === "LOST" ? Math.min(s, 30) : Math.min(100, s);
  return { score, label: score >= 70 ? "HOT" : score >= 45 ? "WARM" : "NURTURE" };
}
