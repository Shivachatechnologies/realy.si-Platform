"use client";

import { useSyncExternalStore } from "react";
import { useI18n } from "@/i18n/client";

const TICK_MS = 30_000;
const subscribe = (onChange: () => void) => {
  const id = setInterval(onChange, TICK_MS);
  return () => clearInterval(id);
};
// Snapshot is bucketed so React sees a stable value between ticks.
const getSnapshot = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const getServerSnapshot = () => null;

/** Current time in a given IANA zone, rendered in the viewer's locale (client-only to avoid hydration drift). */
export function LiveClock({ timeZone }: { timeZone: string }) {
  const { locale } = useI18n();
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (now === null) return <span className="tabular text-muted-foreground">--:--</span>;
  const date = new Date(now);
  return (
    <time className="tabular" dateTime={date.toISOString()}>
      {new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", weekday: "short" }).format(date)}
    </time>
  );
}
