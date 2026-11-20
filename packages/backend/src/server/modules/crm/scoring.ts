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

export type ScoreFactorKey = "base" | "workEmail" | "personalEmail" | "noEmail" | "phone" | "company" | "value" | "notesLong" | "notesSome" | "notesShort" | "noNotes" | "stage" | "lostCap" | "cap";

/**
 * The same arithmetic as scoreLead, itemised: every factor with the points it added (or 0 with a tip on how to earn
 * them). Shown as "Why this score" next to the lead's score.
 */
export function explainScore(l: ScoreInput): { score: number; label: "HOT" | "WARM" | "NURTURE"; factors: { key: ScoreFactorKey; points: number; max: number }[] } {
  const f: { key: ScoreFactorKey; points: number; max: number }[] = [{ key: "base", points: 10, max: 10 }];
  if (isWorkEmail(l.email)) f.push({ key: "workEmail", points: 20, max: 20 });
  else if (l.email) f.push({ key: "personalEmail", points: 8, max: 20 });
  else f.push({ key: "noEmail", points: 0, max: 20 });
  f.push({ key: "phone", points: normalizePhone(l.phone) ? 10 : 0, max: 10 });
  f.push({ key: "company", points: l.account?.trim() ? 15 : 0, max: 15 });
  f.push({ key: "value", points: l.valueMinor && l.valueMinor > 0n ? 15 : 0, max: 15 });
  const len = l.notes?.trim().length ?? 0;
  f.push(len > 200 ? { key: "notesLong", points: 10, max: 10 } : len > 60 ? { key: "notesSome", points: 6, max: 10 } : len > 0 ? { key: "notesShort", points: 2, max: 10 } : { key: "noNotes", points: 0, max: 10 });
  f.push({ key: "stage", points: STAGE_POINTS[l.stage], max: 25 });
  const { score, label } = scoreLead(l);
  const sum = f.reduce((s, x) => s + x.points, 0);
  if (sum > score) f.push({ key: l.stage === "LOST" ? "lostCap" : "cap", points: score - sum, max: 0 });
  return { score, label, factors: f };
}
