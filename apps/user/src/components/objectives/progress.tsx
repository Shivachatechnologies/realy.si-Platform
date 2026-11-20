import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type KrStatusKey = "ACHIEVED" | "ON_TRACK" | "AT_RISK" | "OFF_TRACK" | "NO_DATA";

const TONE = { ACHIEVED: "success", ON_TRACK: "success", AT_RISK: "warning", OFF_TRACK: "danger", NO_DATA: "neutral" } as const;
const BAR = { ACHIEVED: "bg-success", ON_TRACK: "bg-success", AT_RISK: "bg-warning", OFF_TRACK: "bg-danger", NO_DATA: "bg-muted-foreground" } as const;

/** Horizontal progress bar (0..1, null = no data) with an accessible label. */
export function ProgressBar({ value, status = "ON_TRACK", label, className }: { value: number | null; status?: KrStatusKey; label: string; className?: string }) {
  const pct = value === null ? 0 : Math.round(value * 100);
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : pct}>
      <div className={cn("h-full rounded-full", value === null ? "" : BAR[status])} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function KrStatusBadge({ status, label }: { status: KrStatusKey; label: string }) {
  return <Badge tone={TONE[status]}>{label}</Badge>;
}
