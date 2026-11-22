import { z } from "zod";
import { db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import type { VoiceProvider } from "@/generated/prisma/enums";

/**
 * Shared helpers of the AI phone team (voice module). Permissions reuse the communication area:
 *   communication.read   see calls, transcripts and analytics
 *   communication.post   request calls (each call is then approved, unless autonomy was granted)
 *   communication.manage set up providers, numbers, agents, rules and the do-not-call list
 */

export const uuid = z.string().uuid();
export const isUuid = (v: unknown): v is string => typeof v === "string" && uuid.safeParse(v).success;

export type VoicePermission = "communication.read" | "communication.post" | "communication.manage";

export async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: VoicePermission, tx?: Tx) {
  const chain = await companyChain(tx ?? db(), organizationId, companyId);
  await requirePermission(ctx, permission, chain, tx);
  return chain;
}

export const actorId = (ctx: RequestContext, organizationId: string) => ctx.actor.id ?? organizationId;

export const PROVIDERS = ["VAPI", "RETELL"] as const satisfies readonly VoiceProvider[];
/** Integrations catalog key of each voice provider. */
export const PROVIDER_KEY: Record<VoiceProvider, "vapi" | "retell"> = { VAPI: "vapi", RETELL: "retell" };

/**
 * Telephony runs on the PLATFORM's Twilio account (platform-managed "twilio_voice", Admin → Platform keys): numbers
 * and minutes go through it and count against the company's plan (voice.minutes). The company's own messaging
 * "twilio" connection is not used for calls.
 */
export const TWILIO_VOICE = "twilio_voice" as const;

/**
 * Numbers on the platform Twilio account that belong to this company (bought or imported through Realy). The platform
 * account holds every tenant's numbers, so caller ids, imports and webhook changes are limited to these.
 */
export async function companyTwilioNumbers(organizationId: string, companyId: string): Promise<Set<string>> {
  const rows = await db().voicePhoneNumber.findMany({ where: { organizationId, companyId, source: "TWILIO", releasedAt: null }, select: { number: true } });
  return new Set(rows.map((r) => r.number));
}
export const GOALS = ["QUALIFY_LEAD", "BOOK_MEETING", "SUPPORT_TRIAGE", "COLLECTIONS_REMINDER", "RECEPTIONIST"] as const;
export const LANGUAGES = ["en-US", "de-DE", "hi-IN", "zh-CN", "ar-AE"] as const;
export type VoiceLanguage = (typeof LANGUAGES)[number];

export const OUTCOMES = [
  "INTERESTED",
  "NOT_INTERESTED",
  "MEETING_REQUESTED",
  "MEETING_BOOKED",
  "CALLBACK_REQUESTED",
  "SUPPORT_ISSUE",
  "PAYMENT_PROMISED",
  "MESSAGE_TAKEN",
  "VOICEMAIL",
  "NO_ANSWER",
  "WRONG_NUMBER",
  "DO_NOT_CALL",
  "OTHER",
] as const;
export const SENTIMENTS = ["POSITIVE", "NEUTRAL", "NEGATIVE", "UNKNOWN"] as const;
export const LIVE_STATUSES = ["QUEUED", "RINGING", "IN_PROGRESS"] as const;
export const PENDING_STATUSES = ["AWAITING_APPROVAL", "SCHEDULED"] as const;

// ───────────── Phone numbers ─────────────

/**
 * E.164 form of a phone number, or null. Numbers must be international ("+44 20 …" or "0044 20 …"): a local number
 * cannot be dialled safely without knowing its country, so it is refused rather than guessed.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/[\s().\-/]/g, "");
  const intl = cleaned.startsWith("00") ? `+${cleaned.slice(2)}` : cleaned;
  return /^\+[1-9]\d{6,14}$/.test(intl) ? intl : null;
}

/** Last 10 digits (the CRM's phoneNormalized form) for matching callers to leads and contacts. */
export const last10 = (e164: string) => e164.replace(/\D/g, "").slice(-10);

/** Masked number for logs and notifications: +44 •••• 1234. */
export const maskNumber = (e164: string) => (e164.length > 6 ? `${e164.slice(0, 3)} •••• ${e164.slice(-4)}` : "••••");

// ───────────── Calling hours ─────────────

/**
 * Time zone of the callee derived from the country calling code, for countries with a single time zone. Countries with
 * several zones (+1, +7, +52, +55, +61, +62 …) return null and the company's time zone is used instead.
 */
const COUNTRY_TZ: Record<string, string> = {
  "20": "Africa/Cairo", "27": "Africa/Johannesburg", "30": "Europe/Athens", "31": "Europe/Amsterdam", "32": "Europe/Brussels",
  "33": "Europe/Paris", "34": "Europe/Madrid", "36": "Europe/Budapest", "39": "Europe/Rome", "40": "Europe/Bucharest",
  "41": "Europe/Zurich", "43": "Europe/Vienna", "44": "Europe/London", "45": "Europe/Copenhagen", "46": "Europe/Stockholm",
  "47": "Europe/Oslo", "48": "Europe/Warsaw", "49": "Europe/Berlin", "60": "Asia/Kuala_Lumpur", "63": "Asia/Manila",
  "64": "Pacific/Auckland", "65": "Asia/Singapore", "66": "Asia/Bangkok", "81": "Asia/Tokyo", "82": "Asia/Seoul",
  "84": "Asia/Ho_Chi_Minh", "86": "Asia/Shanghai", "90": "Europe/Istanbul", "91": "Asia/Kolkata", "92": "Asia/Karachi",
  "94": "Asia/Colombo", "234": "Africa/Lagos", "254": "Africa/Nairobi", "351": "Europe/Lisbon", "352": "Europe/Luxembourg",
  "353": "Europe/Dublin", "354": "Atlantic/Reykjavik", "358": "Europe/Helsinki", "359": "Europe/Sofia", "370": "Europe/Vilnius",
  "371": "Europe/Riga", "372": "Europe/Tallinn", "380": "Europe/Kyiv", "381": "Europe/Belgrade", "385": "Europe/Zagreb",
  "386": "Europe/Ljubljana", "387": "Europe/Sarajevo", "420": "Europe/Prague", "421": "Europe/Bratislava", "852": "Asia/Hong_Kong",
  "880": "Asia/Dhaka", "886": "Asia/Taipei", "965": "Asia/Kuwait", "966": "Asia/Riyadh", "968": "Asia/Muscat",
  "971": "Asia/Dubai", "972": "Asia/Jerusalem", "973": "Asia/Bahrain", "974": "Asia/Qatar",
};

export function timeZoneForNumber(e164: string): string | null {
  const digits = e164.replace(/^\+/, "");
  for (const len of [3, 2, 1]) {
    const tz = COUNTRY_TZ[digits.slice(0, len)];
    if (tz) return tz;
  }
  return null;
}

export function safeTz(tz: string | null | undefined): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz ?? "UTC" });
    return tz ?? "UTC";
  } catch {
    return "UTC";
  }
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Local weekday (1–7) and minutes after midnight of `at` in `tz`. */
export function localClock(at: Date, tz: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return { weekday: WEEKDAY[get("weekday")] ?? 1, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}

export interface CallingWindow {
  startMin: number;
  endMin: number;
  days: number[];
}

export function inWindow(at: Date, tz: string, w: CallingWindow): boolean {
  const { weekday, minutes } = localClock(at, tz);
  return w.days.includes(weekday) && minutes >= w.startMin && minutes < w.endMin;
}

/** The next moment (5-minute resolution, within 8 days) that falls inside the calling window, or null. */
export function nextWindowStart(from: Date, tz: string, w: CallingWindow): Date | null {
  if (!w.days.length || w.endMin <= w.startMin) return null;
  const step = 5 * 60_000;
  let t = Math.ceil(from.getTime() / step) * step;
  for (let i = 0; i < (8 * 24 * 60) / 5; i++, t += step) {
    if (inWindow(new Date(t), tz, w)) return new Date(t);
  }
  return null;
}

/** The time zone calling hours are checked in for a number: the callee's, else the company's. */
export function calleeTimeZone(e164: string, companyTz: string): { tz: string; derived: boolean } {
  const derived = timeZoneForNumber(e164);
  return derived ? { tz: derived, derived: true } : { tz: safeTz(companyTz), derived: false };
}

export const minutesLabel = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// ───────────── Misc ─────────────

export const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
export const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface TranscriptLine {
  role: "agent" | "caller";
  text: string;
  /** Seconds from call start, when the provider reports it. */
  at?: number;
}

export interface CallResult {
  type: "lead_activity" | "crm_activity" | "lead_follow_up" | "crm_follow_up" | "crm_meeting" | "support_ticket" | "lead" | "do_not_call" | "notification";
  id: string;
  label: string;
  href?: string;
}
