import { cn } from "@/lib/utils";

const TONE = {
  primary: "bg-brand-gradient",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-muted-foreground",
} as const;

/**
 * Progress bar that grows into place and eases between values (transform only).
 * `value` of `max` (default 100); `value` null/undefined renders an indeterminate bar.
 * `label` is the accessible name (required for meaning); `active` adds a travelling sheen while work is in progress.
 */
export function AnimatedProgress({
  value,
  max = 100,
  label,
  tone = "primary",
  active = false,
  size = "md",
  className,
}: {
  value?: number | null;
  max?: number;
  label: string;
  tone?: keyof typeof TONE;
  active?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const indeterminate = value === null || value === undefined;
  const ratio = indeterminate || max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  const height = { sm: "h-1", md: "h-1.5", lg: "h-2.5" }[size];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={indeterminate ? undefined : value}
      className={cn("relative w-full overflow-hidden rounded-full bg-muted", height, className)}
    >
      {indeterminate ? (
        <div className={cn("progress-indeterminate absolute inset-y-0 start-0 w-full rounded-full", TONE[tone])} />
      ) : (
        <div
          className={cn(
            "h-full w-full origin-left rounded-full transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] animate-[progress-grow_0.9s_cubic-bezier(0.16,1,0.3,1)_backwards] rtl:origin-right",
            TONE[tone],
            active && ratio > 0 && "progress-sheen",
          )}
          style={{ transform: `scaleX(${ratio})` }}
        />
      )}
    </div>
  );
}
