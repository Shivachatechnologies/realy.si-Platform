import Link from "next/link";
import type { ReactNode } from "react";
import { Database } from "lucide-react";
import { Timestamp } from "@/components/admin/timestamp";
import { formatMoney, formatNumber } from "@/i18n/format";
import { cn } from "@/lib/utils";

/** Amounts per currency, never summed across currencies: "€1,200.00 · $300.00" (or "—"). */
export function moneyList(rows: { currency: string; amountMinor: bigint }[], locale: string, empty = "—") {
  return rows.length ? rows.map((r) => formatMoney({ amountMinor: r.amountMinor, currency: r.currency }, locale)).join(" · ") : empty;
}

export const pct = (v: number | null, locale: string, digits = 1) => (v === null ? "—" : formatNumber(v, locale, { style: "percent", maximumFractionDigits: digits }));

/** Where a page's numbers come from and when they were last refreshed (data-source / stale-data indicator). */
export function DataSource({ source, updatedAt, updatedLabel, stale, staleLabel, className }: { source: string; updatedAt?: Date | null; updatedLabel?: string; stale?: boolean; staleLabel?: string; className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <Database className="size-3.5" aria-hidden />
      <span>{source}</span>
      {updatedAt !== undefined ? (
        <>
          <span aria-hidden>·</span>
          <span>{updatedLabel}</span> <Timestamp value={updatedAt} mode="relative" />
        </>
      ) : null}
      {stale ? <span className="font-medium text-warning">{staleLabel}</span> : null}
    </span>
  );
}

/** Segmented links for a numeric range query parameter (keeps the other parameters). */
export function RangeLinks({ base, name = "days", value, options, params = {}, label, format }: { base: string; name?: string; value: number | string; options: (number | string)[]; params?: Record<string, string | undefined>; label: string; format: (v: number | string) => string }) {
  return (
    <nav aria-label={label} className="inline-flex rounded-md border p-0.5">
      {options.map((o) => {
        const qs = new URLSearchParams(Object.entries({ ...params, [name]: String(o) }).filter((e): e is [string, string] => !!e[1]));
        const active = String(o) === String(value);
        return (
          <Link
            key={String(o)}
            href={`${base}?${qs}`}
            aria-current={active ? "true" : undefined}
            className={cn("rounded px-2.5 py-1 text-xs font-medium focus-visible:outline-2", active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {format(o)}
          </Link>
        );
      })}
    </nav>
  );
}

/** Tabs between sibling explorer pages (payments · refunds · disputes). */
export function SubNav({ items, current }: { items: { href: string; label: string; key: string; count?: number }[]; current: string }) {
  return (
    <nav className="flex gap-1 border-b" aria-label="sections">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === current ? "page" : undefined}
          className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", i.key === current ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {i.label}
          {i.count !== undefined ? <span className="ms-1.5 tabular-nums text-xs opacity-70">{i.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/** MRR bridge: start → + new / expansion / reactivation → − contraction / churn → end, in one currency. */
export function Waterfall({ steps, label }: { steps: { key: string; label: string; value: bigint; display: string; kind: "total" | "up" | "down" }[]; label: string }) {
  const max = steps.reduce((m, s) => (s.value > m ? s.value : m), 1n);
  return (
    <div role="table" aria-label={label} className="grid gap-1.5">
      {steps.map((s) => {
        const w = Number((s.value * 1000n) / max) / 10;
        return (
          <div role="row" key={s.key} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm">
            <span role="rowheader" className="truncate text-xs text-muted-foreground">
              {s.label}
            </span>
            <span role="cell" className="h-4 rounded-sm bg-muted/40">
              <span className={cn("block h-full rounded-sm", s.kind === "total" ? "bg-primary" : s.kind === "up" ? "bg-success" : "bg-danger")} style={{ width: `${Math.max(s.value > 0n ? 1 : 0, w)}%` }} />
            </span>
            <span role="cell" className={cn("tabular text-xs", s.kind === "up" && "text-success", s.kind === "down" && "text-danger")}>
              {s.kind === "up" ? "+" : s.kind === "down" ? "−" : ""}
              {s.display}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Weekly retention grid: cell = share of the cohort active in week k (null = week not reached yet). */
export function CohortGrid({ cohorts, weekLabel, cohortLabel, sizeLabel, locale }: { cohorts: { cohort: string; size: number; weeks: (number | null)[] }[]; weekLabel: (w: number) => string; cohortLabel: string; sizeLabel: string; locale: string }) {
  const weeks = cohorts[0]?.weeks.length ?? 0;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-xs">
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1 text-start font-medium text-muted-foreground">
              {cohortLabel}
            </th>
            <th scope="col" className="px-2 py-1 text-end font-medium text-muted-foreground">
              {sizeLabel}
            </th>
            {Array.from({ length: weeks }, (_, w) => (
              <th key={w} scope="col" className="px-1 py-1 text-center font-medium text-muted-foreground">
                {weekLabel(w)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.cohort}>
              <th scope="row" className="px-2 py-1 text-start font-mono font-normal whitespace-nowrap">
                {c.cohort}
              </th>
              <td className="px-2 py-1 text-end tabular-nums">{formatNumber(c.size, locale)}</td>
              {c.weeks.map((v, w) => {
                const share = v === null || !c.size ? null : v / c.size;
                return (
                  <td key={w} className="min-w-11 rounded-sm px-1 py-1 text-center tabular-nums" style={share === null ? undefined : { background: `color-mix(in oklch, var(--primary) ${Math.round(share * 85)}%, transparent)` }} title={v === null ? undefined : `${v} / ${c.size}`}>
                    {share === null ? <span className="text-muted-foreground">·</span> : formatNumber(share, locale, { style: "percent", maximumFractionDigits: 0 })}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Funnel steps with the share of the first step and of the previous step. */
export function Funnel({ steps, locale }: { steps: { key: string; label: string; count: number }[]; locale: string }) {
  const top = steps[0]?.count ?? 0;
  return (
    <ol className="grid gap-2">
      {steps.map((s, i) => {
        const share = top ? s.count / top : 0;
        const prev = i > 0 ? steps[i - 1]!.count : null;
        return (
          <li key={s.key} className="grid grid-cols-[9rem_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate text-xs text-muted-foreground">{s.label}</span>
            <span className="h-5 rounded-sm bg-muted/40">
              <span className="block h-full rounded-sm bg-primary/80" style={{ width: `${Math.max(s.count ? 1 : 0, share * 100)}%` }} />
            </span>
            <span className="tabular text-xs whitespace-nowrap">
              {formatNumber(s.count, locale)}
              {prev ? <span className="ms-1.5 text-muted-foreground">({formatNumber(s.count / prev, locale, { style: "percent", maximumFractionDigits: 0 })})</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Small "not available" block naming the missing source. */
export function NotAvailable({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid gap-1 rounded-md border border-dashed p-4 text-sm">
      <span className="font-medium">{title}</span>
      {children ? <span className="text-xs text-muted-foreground">{children}</span> : null}
    </div>
  );
}
