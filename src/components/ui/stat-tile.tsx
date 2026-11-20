"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { CountUp, type CountUpFormat } from "@/components/motion/count-up";
import { LiveDot } from "@/components/motion/live-dot";
import { Skeleton } from "./skeleton";

/**
 * Premium KPI tile. Shows exactly the value it is given:
 * - `value` number → animated CountUp (with `format`), or `money` (minor units) → exact currency, or any ReactNode.
 * - `delta`: relative change as a ratio (0.12 = +12 %); `deltaLabel` explains the comparison ("vs last 30 days").
 *   `positive` = which direction is good (default "up").
 * - `live`: pulsing dot for values that update in real time. `href` makes the whole tile a link with hover lift.
 * - `loading`: shimmer placeholder. `index`: entrance stagger position.
 */
export function StatTile({
  label,
  value,
  money,
  format,
  hint,
  delta,
  deltaLabel,
  positive = "up",
  icon,
  live = false,
  href,
  loading = false,
  index = 0,
  highlight = false,
  className,
}: {
  label: ReactNode;
  value?: number | ReactNode;
  money?: { amountMinor: string | number | bigint; currency: string };
  format?: CountUpFormat;
  hint?: ReactNode;
  delta?: number | null;
  deltaLabel?: ReactNode;
  positive?: "up" | "down";
  icon?: ReactNode;
  live?: boolean;
  href?: string;
  loading?: boolean;
  index?: number;
  highlight?: boolean;
  className?: string;
}) {
  const { locale } = useI18n();
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const dir = !hasDelta || delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  const good = dir === "flat" ? null : dir === positive;
  const DeltaIcon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {live ? <LiveDot tone="success" /> : null}
          <span className="truncate">{label}</span>
        </span>
        {icon ? (
          <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground [&_svg]:size-3.5">
            {icon}
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : money ? (
          <CountUp money={money} />
        ) : typeof value === "number" ? (
          <CountUp value={value} format={format} />
        ) : (
          (value ?? "—")
        )}
      </div>
      {hasDelta || hint ? (
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {hasDelta ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-sm px-1 py-0.5 font-medium tabular-nums",
                good === null ? "bg-muted text-muted-foreground" : good ? "bg-success/10 text-success" : "bg-danger/10 text-danger",
              )}
            >
              <DeltaIcon className="size-3 rtl:-scale-x-100" aria-hidden />
              {new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(delta!)}
            </span>
          ) : null}
          {deltaLabel ? <span className="text-muted-foreground">{deltaLabel}</span> : null}
          {hint ? <span className="truncate text-muted-foreground">{hint}</span> : null}
        </div>
      ) : null}
    </>
  );

  const cls = cn(
    "reveal relative block min-w-0 rounded-lg border bg-surface p-4 shadow-elev-1",
    highlight && "border-gradient shadow-glow [--gradient-fill:linear-gradient(180deg,color-mix(in_oklch,var(--primary)_6%,var(--surface)),var(--surface)_60%)]",
    href && "hover-lift focus-visible:outline-2",
    className,
  );
  const style = { "--i": index } as React.CSSProperties;
  return href ? (
    <Link href={href} className={cls} style={style}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}

/** Responsive grid for StatTiles (1 → 2 → 4 columns). */
export function StatGrid({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4", className)}>{children}</div>;
}
