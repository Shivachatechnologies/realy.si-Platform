"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/client";
import { SystemPulse } from "@/components/motion/system-pulse";

/**
 * Topbar "AI activity" indicator. Shows only the real counts it is given (running / queued AI tasks) and links to
 * the task list. Animated while something is running; a quiet "idle" state otherwise.
 */
export function AiActivityIndicator({ running, queued = 0, href = "/tasks" }: { running: number; queued?: number; href?: string }) {
  const { t, locale } = useI18n();
  const active = running > 0;
  return (
    <Link
      href={`/${locale}${href}`}
      className="flex h-8 items-center rounded-md px-2 transition-colors hover:bg-muted/70"
      aria-label={`${t("shell.aiActivity")}: ${active ? t("shell.aiWorking", { count: running }) : t("shell.aiIdle")}${queued > 0 ? `, ${t("shell.aiQueued", { count: queued })}` : ""}`}
    >
      <SystemPulse
        active={active}
        label={active ? t("shell.aiWorking", { count: running }) : t("shell.aiIdle")}
        detail={queued > 0 ? t("shell.aiQueued", { count: queued }) : undefined}
        tone={active ? "primary" : "neutral"}
      />
    </Link>
  );
}
