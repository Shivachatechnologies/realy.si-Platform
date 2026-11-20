import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sparkline } from "./charts";

/** KPI tile: label, value, change vs previous period (coloured by whether it is good), optional sparkline and drilldown. */
export function MetricTile({
  label,
  value,
  change,
  trend,
  previousLabel,
  href,
  spark,
  className,
}: {
  label: string;
  value: string;
  change: string | null;
  trend: -1 | 0 | 1;
  previousLabel?: string;
  href?: string | null;
  spark?: (number | null)[];
  className?: string;
}) {
  const Icon = change === null ? Minus : change.startsWith("-") || change.startsWith("−") ? ArrowDownRight : ArrowUpRight;
  const body = (
    <>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span className="flex items-end justify-between gap-2">
        <span className="tabular truncate text-lg font-semibold">{value}</span>
        {spark ? <Sparkline values={spark} /> : null}
      </span>
      <span className={cn("flex items-center gap-1 text-[11px]", trend === 1 ? "text-success" : trend === -1 ? "text-danger" : "text-muted-foreground")}>
        <Icon aria-hidden className="size-3 rtl:-scale-x-100" />
        <span className="tabular">{change ?? "—"}</span>
        {previousLabel ? <span className="truncate text-muted-foreground">{previousLabel}</span> : null}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className={cn("grid min-w-0 gap-1 rounded-md border bg-surface p-3 transition-colors hover:bg-muted/50", className)}>
      {body}
    </Link>
  ) : (
    <div className={cn("grid min-w-0 gap-1 rounded-md border bg-surface p-3", className)}>{body}</div>
  );
}
