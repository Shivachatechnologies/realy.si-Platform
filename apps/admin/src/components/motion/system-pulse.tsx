import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { LiveTone } from "./live-dot";

const TONE: Record<LiveTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  primary: "text-primary",
  neutral: "text-muted-foreground",
};

/**
 * Compact "system is working" indicator: four equalizer bars that move only while `active` is true, plus a label.
 * It never invents activity — pass a real state (e.g. running AI tasks > 0).
 */
export function SystemPulse({
  active,
  label,
  detail,
  tone = active ? "primary" : "neutral",
  className,
}: {
  active: boolean;
  label: ReactNode;
  detail?: ReactNode;
  tone?: LiveTone;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2 text-xs", className)}>
      <span aria-hidden className={cn("flex h-3.5 items-end gap-[2px]", TONE[tone])}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="pulse-bar block h-full w-[3px] rounded-full bg-current"
            data-idle={active ? undefined : "true"}
            style={{ "--i": i } as React.CSSProperties}
          />
        ))}
      </span>
      <span className="truncate font-medium text-foreground">{label}</span>
      {detail ? <span className="truncate text-muted-foreground tabular-nums">{detail}</span> : null}
    </span>
  );
}
