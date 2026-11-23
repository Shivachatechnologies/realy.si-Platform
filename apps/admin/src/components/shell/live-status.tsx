"use client";

import { useSyncExternalStore } from "react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

const subscribeTick = (cb: () => void) => {
  const timer = window.setInterval(cb, 30_000);
  return () => window.clearInterval(timer);
};
const tickNow = () => Math.floor(Date.now() / 30_000) * 30_000;

/**
 * Top-bar live indicator and clock: whether this browser is connected (navigator.onLine), and the current time in the
 * admin's own time zone (browser zone; the profile zone is the server-side fallback) with the zone name. The clock
 * ticks every 30 s; nothing is fetched.
 */
export function LiveStatus({ profileZone }: { profileZone: string }) {
  const { locale, t } = useI18n();
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const zone = useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || profileZone,
    () => profileZone,
  );
  // Ticks every 30 s on the client; the server render shows no time (it would be the server's clock).
  const now = useSyncExternalStore(subscribeTick, tickNow, () => null);
  const time = now ? new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: zone }).format(now) : "";
  const utc = now ? new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: "UTC" }).format(now) : "";
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border bg-surface/60 px-2 py-0.5 text-[11px] text-muted-foreground tabular-nums md:inline-flex"
      title={`${t("admin.shell.timezone", { tz: zone })}\nUTC ${utc}`}
    >
      <span aria-hidden className={cn("live-dot size-1.5", online ? "text-success" : "text-danger")} data-pulse={online ? "true" : undefined} />
      <span className="sr-only">{online ? t("admin.shell.online") : t("admin.shell.offline")}</span>
      <time suppressHydrationWarning>{time}</time>
      <span className="hidden xl:inline">{zone}</span>
    </span>
  );
}
