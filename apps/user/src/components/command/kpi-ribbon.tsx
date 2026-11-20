"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { Stagger, StaggerItem } from "@/components/motion/stagger";

export interface RibbonMetric {
  key: string;
  label: string;
  value: number | null;
  unit: "count" | "money" | "percent" | "days" | "hours";
  changePct: number | null;
  trend: -1 | 0 | 1;
  href: string;
}

/**
 * Editorial KPI ribbon: big serif numerals that glide to their real values, trend arrows coloured by whether the
 * change is good (metric registry's higherIsBetter). No card chrome — hairline separators only.
 */
export function KpiRibbon({ metrics, currency }: { metrics: RibbonMetric[]; currency: string }) {
  const { locale } = useI18n();
  return (
    <Stagger as="ul" className="grid grid-cols-2 divide-y sm:grid-cols-4 sm:divide-y-0 lg:grid-cols-8 [&>li]:border-e [&>li:last-child]:border-e-0">
      {metrics.map((m) => {
        const Icon = m.changePct === null || m.changePct === 0 ? Minus : m.changePct > 0 ? ArrowUpRight : ArrowDownRight;
        return (
          <StaggerItem as="li" key={m.key} className="min-w-0">
            <Link href={m.href} className="group block px-4 py-4 transition-colors hover:bg-muted/40">
              <div className="truncate text-micro text-muted-foreground uppercase">{m.label}</div>
              <div className="mt-2 truncate font-display text-[1.9rem] leading-none tracking-tight">
                {m.value === null ? (
                  "—"
                ) : m.unit === "money" ? (
                  <AnimatedNumber value={m.value} money={{ currency }} options={{ notation: Math.abs(m.value) >= 10_000_000 ? "compact" : "standard" }} />
                ) : m.unit === "percent" ? (
                  <AnimatedNumber value={m.value / 100} options={{ style: "percent", maximumFractionDigits: 1 }} />
                ) : (
                  <AnimatedNumber value={m.value} options={{ maximumFractionDigits: m.unit === "count" ? 0 : 1, notation: Math.abs(m.value) >= 100_000 ? "compact" : "standard" }} />
                )}
              </div>
              {m.changePct !== null ? (
                <div className={cn("mt-2 inline-flex items-center gap-0.5 text-xs font-medium", m.trend === 1 ? "text-success" : m.trend === -1 ? "text-danger" : "text-muted-foreground")}>
                  <Icon className="size-3 rtl:-scale-x-100" aria-hidden />
                  {new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(m.changePct / 100)}
                </div>
              ) : null}
            </Link>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}
