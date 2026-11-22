import type { ReactNode } from "react";
import { Database, ShieldAlert } from "lucide-react";
import { Notice } from "@/components/ui/notice";
import { Timestamp } from "@/components/admin/timestamp";
import { cn } from "@/lib/utils";

/** Shared server-side pieces of the stream E pages (health strips, provenance line, production banner). */

const CELL: Record<string, string> = {
  HEALTHY: "bg-success",
  OPERATIONAL: "bg-success/80",
  DEGRADED: "bg-warning",
  CRITICAL: "bg-danger/80",
  DOWN: "bg-danger",
  MAINTENANCE: "bg-info",
  UNKNOWN: "bg-muted-foreground/30",
  NOT_CONFIGURED: "bg-muted",
};

/** 24 hourly cells (oldest first); each cell shows the worst status of that hour; empty hours are hollow. */
export function HealthStrip({ statuses, label, statusLabel, className }: { statuses: (string | null)[]; label: string; statusLabel: (s: string) => string; className?: string }) {
  return (
    <div role="img" aria-label={label} className={cn("flex h-5 items-stretch gap-px", className)}>
      {statuses.map((s, i) => (
        <span key={i} title={s ? statusLabel(s) : "—"} className={cn("min-w-1 flex-1 rounded-[2px]", s ? CELL[s] ?? "bg-muted" : "border border-dashed border-border")} />
      ))}
    </div>
  );
}

/** "Source: … · Updated …": where a number comes from and how fresh it is. */
export function SourceLine({ source, at, stale, staleLabel, className }: { source: ReactNode; at?: Date | string | null; stale?: boolean; staleLabel?: string; className?: string }) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground", className)}>
      <Database aria-hidden className="size-3" />
      <span>{source}</span>
      {at ? (
        <>
          <span aria-hidden>·</span>
          <Timestamp value={at} mode="relative" />
        </>
      ) : null}
      {stale && staleLabel ? <span className="font-medium text-warning">{staleLabel}</span> : null}
    </p>
  );
}

/** Production banner for pages with sensitive operations. */
export function ProductionNotice({ production, title, body }: { production: boolean; title: string; body: string }) {
  if (!production) return null;
  return (
    <Notice tone="danger" title={title}>
      <span className="inline-flex items-start gap-1.5">
        <ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        {body}
      </span>
    </Notice>
  );
}

/** Percentage with two decimals, or an em dash when not measurable. */
export const pct = (v: number | null | undefined, locale: string) => (v === null || v === undefined ? "—" : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v)} %`);

/** Bytes in a compact unit. */
export function bytes(n: number | null | undefined, locale: string) {
  if (n === null || n === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 }).format(v)} ${units[i]}`;
}

/** Duration in a compact unit (ms → s → min → h → d). */
export function duration(ms: number | null | undefined, locale: string) {
  if (ms === null || ms === undefined) return "—";
  const f = (v: number, u: string) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v)} ${u}`;
  if (ms < 1_000) return f(ms, "ms");
  if (ms < 60_000) return f(ms / 1_000, "s");
  if (ms < 3_600_000) return f(ms / 60_000, "min");
  if (ms < 86_400_000) return f(ms / 3_600_000, "h");
  return f(ms / 86_400_000, "d");
}
