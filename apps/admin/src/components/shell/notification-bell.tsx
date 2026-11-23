"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { Timestamp } from "@/components/admin/timestamp";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { NotificationRow } from "@/server/modules/admin/notifications";

const REFRESH_MS = 60_000;
const DOT = {
  INFO: "bg-info",
  WARNING: "bg-warning",
  CRITICAL: "bg-danger",
} as const;

/**
 * Top-bar bell (stream A): unread count from the server render, refreshed when the tab regains focus (at most once
 * a minute; never on a timer), the latest notifications on open, mark one or all read, deep links into the console.
 */
export function NotificationBell({ initialCount }: { initialCount: number }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const base = `/${locale}`;
  // The server count wins whenever a new render brings one; local updates apply on top of that render's value.
  const [local, setLocal] = useState({
    from: initialCount,
    count: initialCount,
  });
  const count = local.from === initialCount ? local.count : initialCount;
  const setCount = useCallback(
    (next: number | ((c: number) => number)) =>
      setLocal((s) => {
        const cur = s.from === initialCount ? s.count : initialCount;
        return {
          from: initialCount,
          count: typeof next === "function" ? next(cur) : next,
        };
      }),
    [initialCount],
  );
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const last = useRef(0);

  const refreshCount = useCallback(() => {
    if (Date.now() - last.current < REFRESH_MS) return;
    last.current = Date.now();
    api<{ count: number }>("/api/v1/admin/notifications/unread-count")
      .then((r) => setCount(r.count))
      .catch(() => undefined);
  }, [setCount]);

  useEffect(() => {
    last.current = Date.now();
    const onFocus = () =>
      document.visibilityState === "visible" && refreshCount();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshCount]);

  const load = useCallback(() => {
    setError(false);
    api<{ data: NotificationRow[] }>("/api/v1/admin/notifications?limit=8")
      .then((r) => setRows(r.data))
      .catch(() => setError(true));
  }, []);

  const mark = async (body: unknown) => {
    setBusy(true);
    try {
      await api("/api/v1/admin/notifications/read", { method: "POST", body });
      last.current = 0;
      refreshCount();
      load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const label = count
    ? t("admin.notifications.bellUnread", { count })
    : t("admin.notifications.bell");
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) load();
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="relative grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2"
        >
          <Bell className="size-4" aria-hidden />
          {count ? (
            <span
              aria-hidden
              className="absolute -end-0.5 -top-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 font-semibold text-danger-foreground tabular-nums"
            >
              {count > 99 ? "99+" : count}
            </span>
          ) : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border bg-surface shadow-elev-4 outline-none data-[state=open]:animate-scale-in"
        >
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <span className="text-sm font-semibold">
              {t("admin.notifications.title")}
            </span>
            <button
              type="button"
              disabled={busy || !count}
              onClick={() => mark({ all: true })}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 focus-visible:outline-2"
            >
              {busy ? (
                <Loader2
                  className="size-3 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <CheckCheck className="size-3" aria-hidden />
              )}
              {t("admin.notifications.markAllRead")}
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {error ? (
              <div className="grid justify-items-center gap-2 p-6 text-center text-xs text-danger">
                {t("admin.notifications.loadFailed")}
                <button
                  type="button"
                  onClick={load}
                  className="rounded-md border px-2 py-1 text-foreground hover:bg-muted focus-visible:outline-2"
                >
                  {t("admin.shell.retry")}
                </button>
              </div>
            ) : rows === null ? (
              <div className="grid gap-2 p-3" aria-busy>
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-10 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
                  />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">
                {t("admin.notifications.empty")}
              </p>
            ) : (
              <ul className="divide-y">
                {rows.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!n.read)
                          void api("/api/v1/admin/notifications/read", {
                            method: "POST",
                            body: { ids: [n.id] },
                          }).catch(() => undefined);
                        setOpen(false);
                        setCount((c) => Math.max(0, c - (n.read ? 0 : 1)));
                        router.push(
                          n.href ? `${base}${n.href}` : `${base}/notifications`,
                        );
                      }}
                      className={cn(
                        "flex w-full items-start gap-2.5 px-3 py-2.5 text-start hover:bg-muted/60 focus-visible:outline-2",
                        !n.read && "bg-accent/30",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          n.read ? "bg-border" : DOT[n.severity],
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-sm",
                            !n.read && "font-medium",
                          )}
                        >
                          {n.title}
                        </span>
                        {n.body ? (
                          <span className="line-clamp-2 block text-xs text-muted-foreground">
                            {n.body}
                          </span>
                        ) : null}
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          <Timestamp value={n.lastRaisedAt} mode="relative" />
                          {n.occurrences > 1 ? ` · ×${n.occurrences}` : ""}
                        </span>
                      </span>
                      <span className="sr-only">
                        {n.read
                          ? t("admin.notifications.read")
                          : t("admin.notifications.unread")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t px-3 py-2 text-end">
            <Link
              href={`${base}/notifications`}
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-primary hover:underline"
            >
              {t("admin.notifications.viewAll")}
            </Link>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
