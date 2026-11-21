import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TabDef {
  key: string;
  href: string;
  label: string;
}

/** Secondary navigation (underline tabs) for the work areas; scrolls horizontally on small screens. */
export function SectionTabs({ tabs, active, label }: { tabs: TabDef[]; active: string; label: string }) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b text-sm" aria-label={label}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn("-mb-px shrink-0 border-b-2 px-3 py-2 whitespace-nowrap", active === tab.key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warning" | "danger" | "success" }) {
  return (
    <div className="min-w-0 rounded-lg border bg-surface p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-semibold", tone === "warning" && "text-warning", tone === "danger" && "text-danger", tone === "success" && "text-success")}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Progress({ value, label, tone }: { value: number; label?: string; tone?: "warning" | "danger" }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2" title={label}>
      <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={cn("h-full rounded-full bg-primary", tone === "warning" && "bg-warning", tone === "danger" && "bg-danger")} style={{ width: `${v}%` }} />
      </div>
      <span className="w-9 text-end text-xs tabular-nums text-muted-foreground">{Math.round(v)}%</span>
    </div>
  );
}

/** Page-number pagination preserving the current query string. */
export function Pagination({ path, params, page, pageSize, total, labels }: { path: string; params: Record<string, string | string[] | undefined>; page: number; pageSize: number; total: number; labels: { prev: string; next: string; summary: string } }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      const one = Array.isArray(v) ? v[0] : v;
      if (one && k !== "page") q.set(k, one);
    }
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  const cls = "rounded-md border px-3 py-1 text-xs hover:bg-muted";
  return (
    <nav className="flex items-center justify-between gap-2 border-t p-3 text-xs text-muted-foreground" aria-label={labels.summary}>
      <span>{labels.summary}</span>
      <span className="flex gap-2">
        {page > 1 ? <Link className={cls} href={href(page - 1)}>{labels.prev}</Link> : null}
        {page < pages ? <Link className={cls} href={href(page + 1)}>{labels.next}</Link> : null}
      </span>
    </nav>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>;
}

export function Facts({ items, cols = 3 }: { items: [string, ReactNode][]; cols?: 2 | 3 | 4 | 5 }) {
  const grid = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4", 5: "sm:grid-cols-5" }[cols];
  return (
    <dl className={cn("grid gap-3 text-sm", grid)}>
      {items.map(([k, v]) => (
        <div key={k} className="grid min-w-0 gap-0.5">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export const PRIORITY_TONE = { URGENT: "danger", HIGH: "warning", MEDIUM: "neutral", LOW: "neutral" } as const;
export const STATUS_TONE = { BACKLOG: "neutral", TODO: "neutral", IN_PROGRESS: "accent", IN_REVIEW: "accent", DONE: "success", CANCELLED: "neutral" } as const;
export const PROJECT_STATUS_TONE = { PLANNED: "neutral", ACTIVE: "accent", ON_HOLD: "warning", COMPLETED: "success", CANCELLED: "neutral" } as const;
export const HEALTH_TONE = { ON_TRACK: "success", AT_RISK: "warning", OFF_TRACK: "danger" } as const;
export const TASK_TONE = { QUEUED: "neutral", RUNNING: "accent", COMPLETED: "success", FAILED: "danger", CANCELLED: "neutral" } as const;
export const ITEM_TONE = { PROPOSED: "neutral", PLANNED: "neutral", IN_PROGRESS: "accent", SHIPPED: "success", CANCELLED: "neutral" } as const;
export const SEVERITY_TONE = { SEV1: "danger", SEV2: "danger", SEV3: "warning", SEV4: "neutral" } as const;
export const INCIDENT_TONE = { OPEN: "danger", INVESTIGATING: "warning", MITIGATED: "accent", RESOLVED: "success", CLOSED: "neutral" } as const;
