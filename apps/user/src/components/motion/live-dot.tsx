import { cn } from "@/lib/utils";

export type LiveTone = "success" | "warning" | "danger" | "info" | "primary" | "neutral";

const TONE: Record<LiveTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  primary: "text-primary",
  neutral: "text-muted-foreground",
};

/** A status dot that pulses while `pulse` is true. Give it a `label` when the state is not described next to it. */
export function LiveDot({ tone = "success", pulse = true, label, className }: { tone?: LiveTone; pulse?: boolean; label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center", TONE[tone], className)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <span className="live-dot" data-pulse={pulse ? "true" : undefined} />
    </span>
  );
}
