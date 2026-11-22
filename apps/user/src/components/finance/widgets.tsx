import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const INVOICE_TONE = { DRAFT: "neutral", SENT: "accent", PARTIALLY_PAID: "warning", PAID: "success", OVERDUE: "danger", VOID: "neutral" } as const;
export const ESTIMATE_TONE = { DRAFT: "neutral", SENT: "accent", ACCEPTED: "success", DECLINED: "danger", CONVERTED: "success" } as const;
export const BILL_TONE = { DRAFT: "neutral", AWAITING_APPROVAL: "warning", APPROVED: "accent", PARTIALLY_PAID: "warning", PAID: "success", VOID: "neutral" } as const;
export const APPROVAL_TONE = { PENDING: "warning", APPROVED: "success", REJECTED: "danger", CANCELLED: "neutral" } as const;
export const CLAIM_TONE = { PENDING: "warning", APPROVED: "success", REJECTED: "danger" } as const;
export const TASK_TONE = { QUEUED: "neutral", RUNNING: "accent", COMPLETED: "success", FAILED: "danger", CANCELLED: "neutral", WAITING_APPROVAL: "warning" } as const;

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "danger" | "success" | "warning" }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-semibold tabular-nums", tone === "danger" && "text-danger", tone === "success" && "text-success", tone === "warning" && "text-warning")}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

/** Keep the current query string while changing some parameters. */
export function withParams(path: string, current: Record<string, string | string[] | undefined>, change: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const one = Array.isArray(v) ? v[0] : v;
    if (one) sp.set(k, one);
  }
  for (const [k, v] of Object.entries(change)) {
    if (v === undefined || v === "") sp.delete(k);
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
}

export function Pager({ path, params, page, pages, labels }: { path: string; params: Record<string, string | string[] | undefined>; page: number; pages: number; labels: { previous: string; next: string; page: string } }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
      <span>{labels.page}</span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className="hover:underline" href={withParams(path, params, { page: page - 1 })}>
            {labels.previous}
          </Link>
        ) : null}
        {page < pages ? (
          <Link className="hover:underline" href={withParams(path, params, { page: page + 1 })}>
            {labels.next}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** Sortable column header link. */
export function SortLink({ path, params, field, current, dir, children }: { path: string; params: Record<string, string | string[] | undefined>; field: string; current: string; dir: string; children: ReactNode }) {
  const active = current === field;
  return (
    <Link href={withParams(path, params, { sort: field, dir: active && dir === "desc" ? "asc" : "desc", page: undefined })} className="inline-flex items-center gap-1 hover:text-foreground">
      {children}
      {active ? <span aria-hidden>{dir === "desc" ? "↓" : "↑"}</span> : null}
    </Link>
  );
}

/** Date range selector (GET form): from / to, plus quick presets. */
export function RangeForm({ action, from, to, labels, hidden = {} }: { action: string; from: string; to: string; labels: { from: string; to: string; apply: string; presets: { key: string; label: string; from: string; to: string }[] }; hidden?: Record<string, string> }) {
  return (
    <div className="flex flex-wrap items-end gap-2 print:hidden">
      <form action={action} className="flex flex-wrap items-end gap-2">
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="grid gap-1 text-xs text-muted-foreground">
          {labels.from}
          <Input type="date" name="from" defaultValue={from} className="h-8 w-40" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {labels.to}
          <Input type="date" name="to" defaultValue={to} className="h-8 w-40" />
        </label>
        <Button type="submit" size="sm" variant="secondary">
          {labels.apply}
        </Button>
      </form>
      <div className="flex flex-wrap gap-1">
        {labels.presets.map((p) => (
          <Link key={p.key} href={withParams(action, hidden, { from: p.from, to: p.to })} className={cn("rounded-md border px-2 py-1 text-xs hover:bg-muted", p.from === from && p.to === to && "bg-muted font-medium")}>
            {p.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Range presets relative to today (UTC calendar days). */
export function rangePresets(t: (k: string) => string, now = new Date()) {
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = d(now);
  const q = Math.floor(m / 3) * 3;
  return [
    { key: "month", label: t("finance.range.thisMonth"), from: d(new Date(Date.UTC(y, m, 1))), to: today },
    { key: "lastMonth", label: t("finance.range.lastMonth"), from: d(new Date(Date.UTC(y, m - 1, 1))), to: d(new Date(Date.UTC(y, m, 0))) },
    { key: "quarter", label: t("finance.range.thisQuarter"), from: d(new Date(Date.UTC(y, q, 1))), to: today },
    { key: "ytd", label: t("finance.range.ytd"), from: d(new Date(Date.UTC(y, 0, 1))), to: today },
    { key: "12m", label: t("finance.range.last12"), from: d(new Date(Date.UTC(y, m - 11, 1))), to: today },
  ];
}

/** Simple grouped bar chart (CSS), values in minor units; negative values render below the axis. */
export function BarChart({ rows, series, format, label }: { rows: { label: string; values: bigint[] }[]; series: { name: string; className: string }[]; format: (v: bigint) => string; label: string }) {
  const max = rows.reduce((m, r) => r.values.reduce((mm, v) => (v < 0n ? (-v > mm ? -v : mm) : v > mm ? v : mm), m), 0n);
  const pct = (v: bigint) => (max === 0n ? 0 : Number(((v < 0n ? -v : v) * 1000n) / max) / 10);
  return (
    <figure className="grid gap-2" aria-label={label}>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1">
            <span aria-hidden className={cn("inline-block size-2.5 rounded-sm", s.className)} />
            {s.name}
          </span>
        ))}
      </div>
      <div className="flex h-44 items-end gap-2 overflow-x-auto border-b pb-1">
        {rows.map((r) => (
          <div key={r.label} className="flex h-full min-w-10 flex-1 flex-col items-center justify-end gap-1">
            <div className="flex h-full w-full items-end justify-center gap-0.5">
              {r.values.map((v, i) => (
                <div
                  key={i}
                  title={`${series[i]?.name}: ${format(v)}`}
                  className={cn("w-full max-w-4 rounded-t-sm", series[i]?.className, v < 0n && "opacity-50")}
                  style={{ height: `${Math.max(pct(v), v === 0n ? 0 : 1)}%` }}
                />
              ))}
            </div>
            <span className="text-[10px] whitespace-nowrap text-muted-foreground">{r.label}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>;
}

export function StatusBadge({ tone, children }: { tone: "neutral" | "accent" | "success" | "warning" | "danger"; children: ReactNode }) {
  return <Badge tone={tone}>{children}</Badge>;
}

/** Horizontal utilization bar (green → amber at 80% → red over 100%). */
export function UsageBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full", pct > 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-success")} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="w-12 text-end text-xs tabular-nums">{Math.round(pct)}%</span>
    </div>
  );
}
