/** Time-zone helpers without external libraries (Intl only). */

function partsIn(timeZone: string, d: Date) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { year: +p.year!, month: +p.month!, day: +p.day!, hour: +p.hour! % 24, minute: +p.minute!, second: +p.second!, weekday: p.weekday! };
}

/** UTC instant of a wall-clock time in a time zone (DST-aware). */
export function zonedTime(timeZone: string, year: number, month: number, day: number, hour = 0, minute = 0): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(timeZone, new Date(t));
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    t = guess - (asUtc - t);
  }
  return new Date(t);
}

/** Wall-clock date parts of an instant in a time zone. */
export function zonedParts(timeZone: string, d: Date) {
  const p = partsIn(timeZone, d);
  const iso = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday] ?? 1;
  return { ...p, isoWeekday: iso };
}

/** "YYYY-MM-DD" of an instant in a time zone. */
export function zonedDay(timeZone: string, d: Date) {
  const p = partsIn(timeZone, d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function safeTimeZone(tz: string | null | undefined) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz ?? "UTC" });
    return tz ?? "UTC";
  } catch {
    return "UTC";
  }
}
