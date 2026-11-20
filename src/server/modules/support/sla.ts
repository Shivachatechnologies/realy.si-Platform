import type { SupportPriority } from "@/generated/prisma/enums";
import { safeTimeZone, zonedParts, zonedTime } from "@/server/modules/comms/time";

export interface SlaPolicyLike {
  businessHoursOnly: boolean;
  businessStartHour: number;
  businessEndHour: number;
  businessDays: number[];
  targets: { priority: SupportPriority; firstResponseMinutes: number; resolutionMinutes: number }[];
}

/**
 * Add minutes to an instant, counting only business hours (company time zone, simple daily window on business days)
 * when the policy says so.
 */
export function addSlaMinutes(start: Date, minutes: number, policy: SlaPolicyLike, timeZone: string): Date {
  if (!policy.businessHoursOnly) return new Date(start.getTime() + minutes * 60_000);
  const tz = safeTimeZone(timeZone);
  const days = policy.businessDays.length ? policy.businessDays : [1, 2, 3, 4, 5];
  const startHour = Math.min(Math.max(policy.businessStartHour, 0), 23);
  const endHour = Math.min(Math.max(policy.businessEndHour, startHour + 1), 24);
  let remaining = minutes * 60_000;
  let cursor = start.getTime();
  for (let i = 0; i < 400 && remaining > 0; i++) {
    const p = zonedParts(tz, new Date(cursor));
    const open = zonedTime(tz, p.year, p.month, p.day, startHour, 0).getTime();
    const close = endHour === 24 ? zonedTime(tz, p.year, p.month, p.day, 23, 59).getTime() + 60_000 : zonedTime(tz, p.year, p.month, p.day, endHour, 0).getTime();
    if (days.includes(p.isoWeekday) && cursor < close) {
      const from = Math.max(cursor, open);
      const available = close - from;
      if (available >= remaining) return new Date(from + remaining);
      remaining -= Math.max(available, 0);
    }
    // Jump to the start of the next local day.
    const next = zonedTime(tz, p.year, p.month, p.day, 0, 0).getTime() + 36 * 3_600_000;
    const np = zonedParts(tz, new Date(next));
    cursor = zonedTime(tz, np.year, np.month, np.day, 0, 0).getTime();
  }
  return new Date(cursor + remaining);
}

/** First-response and resolution due times for a ticket of `priority` opened at `openedAt`. */
export function slaDueDates(policy: SlaPolicyLike | null, priority: SupportPriority, openedAt: Date, timeZone: string) {
  const target = policy?.targets.find((t) => t.priority === priority);
  if (!policy || !target) return { firstResponseDueAt: null, resolutionDueAt: null };
  return {
    firstResponseDueAt: addSlaMinutes(openedAt, target.firstResponseMinutes, policy, timeZone),
    resolutionDueAt: addSlaMinutes(openedAt, target.resolutionMinutes, policy, timeZone),
  };
}
