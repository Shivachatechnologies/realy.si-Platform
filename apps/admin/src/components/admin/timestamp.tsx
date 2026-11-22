"use client";

import { useSyncExternalStore } from "react";
import { useI18n } from "@/i18n/client";
import { formatRelativeTime } from "@/i18n/format";

const noSubscribe = () => () => {};

/**
 * A point in time: relative ("5 minutes ago") and/or absolute, in the viewer's time zone, with the exact time and the
 * zone in a tooltip. The server renders in the provider's zone (UTC in the admin app); the browser then switches to
 * its own zone, so the first paint never mismatches.
 */
export function Timestamp({ value, mode = "both", className }: { value: Date | string | null | undefined; mode?: "relative" | "absolute" | "both"; className?: string }) {
  const { locale, timeZone: providerZone, t } = useI18n();
  const zone = useSyncExternalStore(
    noSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || providerZone,
    () => providerZone,
  );
  if (!value) return <span className={className}>—</span>;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return <span className={className}>—</span>;
  const absolute = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(d);
  const exact = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "long", timeZone: zone }).format(d);
  const relative = formatRelativeTime(d, locale);
  const text = mode === "relative" ? relative : mode === "absolute" ? absolute : `${absolute} · ${relative}`;
  return (
    <time dateTime={d.toISOString()} title={`${exact}\n${t("admin.shell.timezone", { tz: zone })}`} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
