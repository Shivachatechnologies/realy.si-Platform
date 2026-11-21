import { localParts } from "@/server/modules/workforce/slots";

/** Briefing schedule maths in the founder's timezone (pure; no I/O). */

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "YYYY-MM-DD" plus n days. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Offset of `tz` from UTC at `at`, in ms. */
function offsetMs(at: Date, tz: string): number {
  const p = localParts(at, tz);
  const [y, m, d] = p.date.split("-").map(Number) as [number, number, number];
  const asUtc = Date.UTC(y, m - 1, d, p.hour, p.minute);
  return asUtc - Math.floor(at.getTime() / 60_000) * 60_000;
}

/** The instant local midnight of `date` happens in `tz` (DST-safe to the minute). */
export function zonedMidnight(date: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz);
  return new Date(t);
}

export type SlotKind = "MORNING" | "EVENING" | "WEEKLY";

export interface DueSpec {
  morningTime: string;
  days: number[];
  eveningEnabled: boolean;
  eveningTime: string;
  weeklyEnabled: boolean;
  lastMorningSlot: string | null;
  lastEveningSlot: string | null;
  lastWeeklySlot: string | null;
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/** Window after the configured time in which a missed slot still fires (worker downtime); later it is skipped. */
const GRACE_MIN = 180;

/**
 * Slots due now: the morning briefing on the chosen days, the weekly summary on Mondays at the morning time (it
 * replaces the Monday morning briefing), and the optional evening digest on the chosen days. Each slot fires once.
 */
export function dueSlots(s: DueSpec, now: Date, tz: string): { kind: SlotKind; slot: string; localDate: string }[] {
  const p = localParts(now, tz);
  const minutes = p.hour * 60 + p.minute;
  const inWindow = (hhmm: string) => minutes >= minutesOf(hhmm) && minutes < minutesOf(hhmm) + GRACE_MIN;
  const out: { kind: SlotKind; slot: string; localDate: string }[] = [];
  const weeklyToday = s.weeklyEnabled && p.weekday === 1;
  if (inWindow(s.morningTime)) {
    if (weeklyToday) {
      if (s.lastWeeklySlot !== p.date) out.push({ kind: "WEEKLY", slot: p.date, localDate: p.date });
    } else if (s.days.includes(p.weekday) && s.lastMorningSlot !== p.date) out.push({ kind: "MORNING", slot: p.date, localDate: p.date });
  }
  if (s.eveningEnabled && s.days.includes(p.weekday) && inWindow(s.eveningTime) && s.lastEveningSlot !== p.date) out.push({ kind: "EVENING", slot: p.date, localDate: p.date });
  return out;
}

/** The period a briefing covers: yesterday (morning, test), today so far (evening), the previous 7 days (weekly). */
export function periodFor(kind: "MORNING" | "EVENING" | "WEEKLY" | "TEST", now: Date, tz: string) {
  const today = localParts(now, tz).date;
  if (kind === "EVENING") return { from: zonedMidnight(today, tz), to: now, localDate: today, days: 1 };
  if (kind === "WEEKLY") return { from: zonedMidnight(addDays(today, -7), tz), to: zonedMidnight(today, tz), localDate: today, days: 7 };
  return { from: zonedMidnight(addDays(today, -1), tz), to: zonedMidnight(today, tz), localDate: today, days: 1 };
}

/** Today's local day [start, end) in `tz`. */
export function todayRange(now: Date, tz: string) {
  const today = localParts(now, tz).date;
  return { from: zonedMidnight(today, tz), to: zonedMidnight(addDays(today, 1), tz), date: today, weekday: localParts(now, tz).weekday };
}
