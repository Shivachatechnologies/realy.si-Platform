/** Schedule slot maths in a company's timezone (pure; no I/O). */
export interface LocalParts {
  date: string;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");

export function localParts(now: Date, timeZone: string): LocalParts {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(now);
  } catch {
    return localParts(now, "UTC");
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24, minute: Number(get("minute")), weekday: WEEKDAYS.indexOf(get("weekday")) };
}

export interface SlotSpec {
  frequency: "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY" | null;
  timeOfDay: string | null;
  weekday: number | null;
  /** 1 … 31 (MONTHLY); a day past the month's end means its last day. */
  dayOfMonth?: number | null;
}

/** Days in a month (month 1 … 12). */
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The slot due at `now` (once its local time has passed), or null. One task is created per slot. */
export function dueSlot(s: SlotSpec, now: Date, timeZone: string): string | null {
  const p = localParts(now, timeZone);
  const [hh, mm] = (s.timeOfDay ?? "00:00").split(":").map(Number) as [number, number];
  const minutes = p.hour * 60 + p.minute;
  switch (s.frequency) {
    case "HOURLY":
      return p.minute >= mm ? `${p.date}T${pad(p.hour)}` : null;
    case "DAILY":
      return minutes >= hh * 60 + mm ? p.date : null;
    case "WEEKLY":
      return p.weekday === s.weekday && minutes >= hh * 60 + mm ? `W${p.date}` : null;
    case "MONTHLY": {
      // One slot per calendar month: due from the chosen day (clamped to the month's last day) and time onwards, so a
      // slot missed while the worker was down still runs later that month.
      const [y, mo, d] = p.date.split("-").map(Number) as [number, number, number];
      const day = Math.min(Math.max(s.dayOfMonth ?? 1, 1), daysIn(y, mo));
      return d > day || (d === day && minutes >= hh * 60 + mm) ? `M${p.date.slice(0, 7)}` : null;
    }
    default:
      return null;
  }
}

/** Fill {{date}}, {{event}} and {{data.<field>}} placeholders. */
export function fillTemplate(template: string, vars: { date: string; event?: string; data?: Record<string, unknown> }): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (all, key: string) => {
    if (key === "date") return vars.date;
    if (key === "event") return vars.event ?? "";
    if (key.startsWith("data.") && vars.data) {
      const v = vars.data[key.slice(5)];
      return v === undefined || v === null ? "" : String(v).slice(0, 500);
    }
    return all;
  });
}

export interface WorkingHoursSpec {
  days: number[];
  start: string;
  end: string;
}

/** Inside the working hours at `now` in `timeZone` (null = always). Overnight windows (start > end) are supported. */
export function withinWorkingHours(h: WorkingHoursSpec | null, now: Date, timeZone: string): boolean {
  if (!h) return true;
  const p = localParts(now, timeZone);
  const toMin = (s: string) => {
    const [hh, mm] = s.split(":").map(Number) as [number, number];
    return hh * 60 + mm;
  };
  const m = p.hour * 60 + p.minute;
  const start = toMin(h.start);
  const end = toMin(h.end);
  if (start < end) return h.days.includes(p.weekday) && m >= start && m < end;
  // Overnight: the window belongs to the day it started.
  if (m >= start) return h.days.includes(p.weekday);
  return m < end && h.days.includes((p.weekday + 6) % 7);
}
