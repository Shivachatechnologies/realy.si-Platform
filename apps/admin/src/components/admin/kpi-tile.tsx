import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CircleDashed } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KpiDelta } from "./kpi-delta";
import { Sparkline, type VizTone } from "./viz";

export { kpiDelta, type KpiDelta } from "./kpi-delta";

/**
 * Command-center KPI tile: value, change vs the previous period (green when it moves the good way), sparkline, a
 * drill-down link and the data source on hover. `notTracked` renders the honest empty state instead of a number.
 */
export function KpiTile({
  label,
  value,
  sub,
  delta,
  compareLabel,
  href,
  source,
  spark,
  sparkLabel,
  sparkTone = "primary",
  notTracked,
  tone,
}: {
  label: string;
  value?: ReactNode;
  sub?: ReactNode;
  delta?: KpiDelta | null;
  compareLabel?: string;
  href: string;
  source: string;
  spark?: number[];
  sparkLabel?: string;
  sparkTone?: VizTone;
  notTracked?: { title: string; detail: string };
  tone?: "danger" | "warning";
}) {
  const DeltaIcon = delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : ArrowRight;
  return (
    <Link
      href={href}
      title={source}
      className={cn(
        "reveal hover-lift group relative grid min-w-0 content-start gap-1 rounded-lg border bg-surface p-3.5 shadow-elev-1 focus-visible:outline-2 [[data-density=compact]_&]:p-2.5",
        notTracked && "border-dashed bg-surface/60",
      )}
    >
      {tone ? <span aria-hidden className={cn("absolute inset-y-3 start-0 w-0.5 rounded-full", tone === "danger" ? "bg-danger" : "bg-warning")} /> : null}
      <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
      {notTracked ? (
        <>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <CircleDashed className="size-3.5" aria-hidden />
            {notTracked.title}
          </span>
          <span className="text-[11px] text-muted-foreground">{notTracked.detail}</span>
        </>
      ) : (
        <>
          <span className={cn("text-2xl font-semibold tracking-tight tabular-nums [[data-density=compact]_&]:text-xl", tone === "danger" && "text-danger", tone === "warning" && "text-warning")}>{value}</span>
          <span className="flex min-h-4 flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            {delta ? (
              <span className={cn("inline-flex items-center gap-0.5 font-medium tabular-nums", delta.good === true && "text-success", delta.good === false && "text-danger")}>
                <DeltaIcon className="size-3 rtl:-scale-x-100" aria-hidden />
                {delta.text}
              </span>
            ) : null}
            {delta && compareLabel ? <span>{compareLabel}</span> : null}
            {sub ? <span className="truncate">{sub}</span> : null}
          </span>
          {spark && spark.length > 1 ? <Sparkline values={spark} tone={sparkTone} label={sparkLabel ?? label} className="mt-1" /> : null}
        </>
      )}
      <ArrowUpRight aria-hidden className="absolute end-2.5 top-3 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 rtl:-scale-x-100" />
    </Link>
  );
}
