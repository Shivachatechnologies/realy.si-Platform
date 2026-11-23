import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ArrowUpRight, Lightbulb } from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";
import { isAppError } from "@/server/core/errors";
import { Avatar } from "./avatar";

export { Avatar };

/**
 * Page header strip of the admin console: what this is (title + description), why it matters (`why`), what you can do
 * (`actions`, primary action first) — on the Realy Control icon tile.
 */
export function AdminHeader({
  title,
  description,
  actions,
  icon,
  why,
  eyebrow,
  meta,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: ReactNode;
  why?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <PageHeader
      title={title}
      description={description}
      icon={icon}
      eyebrow={eyebrow}
      actions={actions}
      meta={
        why || meta ? (
          <>
            {why ? (
              <span className="inline-flex max-w-2xl items-start gap-1.5 text-xs text-muted-foreground">
                <Lightbulb className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
                <span>{why}</span>
              </span>
            ) : null}
            {meta}
          </>
        ) : undefined
      }
    />
  );
}

const TILE_TONE = {
  danger: "text-danger",
  warning: "text-warning",
  success: "text-success",
} as const;

/** A KPI tile that links to its section; optional icon and sparkline (`spark`). */
export function StatTile({
  label,
  value,
  hint,
  href,
  tone,
  icon,
  spark,
  live,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: "danger" | "warning" | "success";
  icon?: ReactNode;
  spark?: ReactNode;
  live?: boolean;
  className?: string;
}) {
  const body = (
    <>
      {tone ? <span aria-hidden className={cn("absolute inset-y-3 start-0 w-0.5 rounded-full bg-current", TILE_TONE[tone])} /> : null}
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {live ? <span aria-hidden className="live-dot size-1.5 text-success" data-pulse="true" /> : null}
          <span className="truncate">{label}</span>
        </span>
        {icon ? (
          <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground [&_svg]:size-3.5">
            {icon}
          </span>
        ) : null}
      </div>
      <div className={cn("mt-1.5 text-2xl font-semibold tracking-tight tabular-nums", tone && TILE_TONE[tone])}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
      {spark ? <div className="mt-2">{spark}</div> : null}
      {href ? <ArrowUpRight aria-hidden className="absolute end-3 bottom-3 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 rtl:-scale-x-100" /> : null}
    </>
  );
  const cls = cn("reveal group relative block h-full min-w-0 rounded-lg border bg-surface p-4 shadow-elev-1", href && "hover-lift focus-visible:outline-2", className);
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("stagger grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4", className)}>{children}</div>;
}

/** Smart empty state: what is missing, why, and what to do (optional action). */
export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid justify-items-center gap-2 px-6 py-10 text-center">
      {icon ? (
        <span aria-hidden className="grid size-11 place-items-center rounded-xl border-gradient text-primary [--gradient-fill:var(--surface)] [&_svg]:size-5">
          {icon}
        </span>
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {body ? <p className="max-w-sm text-xs text-muted-foreground">{body}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** Section card title row used across the console (title, hint and a trailing link/action). */
export function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
      {children}
      <ArrowUpRight className="size-3 rtl:-scale-x-100" aria-hidden />
    </Link>
  );
}

/** Render `forbidden` service errors as a notice; rethrow anything else. */
export async function guard<T>(p: Promise<T>, message: string): Promise<{ ok: true; value: T } | { ok: false; node: ReactNode }> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    if (isAppError(e) && (e.code === "forbidden" || e.code === "mfa_required")) return { ok: false, node: <Notice tone="warning">{message}</Notice> };
    throw e;
  }
}

export interface FilterDef {
  name: string;
  label: string;
  options: { value: string; label: string }[];
}

/** GET filter bar: search box plus selects; submitting reloads the page with the query string. */
export function FilterBar({ action, q, qLabel, filters, values, submitLabel, extra }: { action: string; q?: string; qLabel?: string; filters: FilterDef[]; values: Record<string, string | undefined>; submitLabel: string; extra?: ReactNode }) {
  return (
    <form className="flex flex-wrap items-end gap-2 border-b p-3" action={action}>
      {qLabel !== undefined ? <Input name="q" type="search" defaultValue={q} maxLength={200} aria-label={qLabel} placeholder={qLabel} className="w-full sm:w-64" /> : null}
      {filters.map((f) => (
        <Select key={f.name} name={f.name} defaultValue={values[f.name] ?? ""} aria-label={f.label} className="w-auto">
          <option value="">{f.label}</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ))}
      {extra}
      <Button type="submit" variant="secondary">
        {submitLabel}
      </Button>
    </form>
  );
}

/** "Next page" link keeping the current filters. */
export function NextPage({ base, params, cursor, label }: { base: string; params: Record<string, string | undefined>; cursor: string | null; label: string }) {
  if (!cursor) return null;
  const qs = new URLSearchParams(Object.entries({ ...params, cursor }).filter((e): e is [string, string] => !!e[1]));
  return (
    <div className="flex justify-end border-t p-3">
      <Button asChild size="sm" variant="secondary">
        <Link href={`${base}?${qs}`}>{label}</Link>
      </Button>
    </div>
  );
}

/** First string value of a search param. */
export const sp = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 200) : Array.isArray(v) ? v[0]?.slice(0, 200) : undefined);

export function Empty({ children }: { children: ReactNode }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>;
}

/** Key/value rows for detail cards. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-w-0 justify-between gap-3 border-b pb-1.5 sm:block sm:border-0 sm:pb-0">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="min-w-0 truncate">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Micro-USD → formatted USD string. */
export function usd(micros: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: micros < 10_000_000 ? 2 : 0 }).format(micros / 1_000_000);
}

/** Vertical activity timeline (actor avatar, action, reason, time). */
export function AuditTimeline({ items }: { items: { id: string; who: string; action: string; security: boolean; reason: string | null; iso: string; exact: string; relative: string; extra?: ReactNode }[] }) {
  return (
    <ol className="relative grid px-4 py-3">
      <span aria-hidden className="absolute inset-y-6 start-[1.85rem] w-px bg-border" />
      {items.map((a, i) => (
        <li key={a.id} className="reveal relative flex gap-3 py-2" style={{ "--i": Math.min(i, 10) } as React.CSSProperties}>
          <Avatar name={a.who} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="max-w-full truncate font-medium">{a.who}</span>
              <Badge tone={a.security ? "warning" : "accent"} className="font-mono">
                {a.action}
              </Badge>
              {a.extra}
              <time dateTime={a.iso} title={a.exact} className="ms-auto text-xs text-muted-foreground">
                {a.relative}
              </time>
            </div>
            {a.reason ? <p className="mt-0.5 truncate text-xs text-muted-foreground">“{a.reason}”</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** One-tap filter chips (links) for a single query parameter; other filters are kept. */
export function QuickFilters({ base, name, value, options, params, label }: { base: string; name: string; value?: string; options: { value: string; label: string; count?: number }[]; params: Record<string, string | undefined>; label: string }) {
  const href = (v: string) => {
    const qs = new URLSearchParams(Object.entries({ ...params, [name]: v || undefined, cursor: undefined }).filter((e): e is [string, string] => !!e[1]));
    const s = qs.toString();
    return s ? `${base}?${s}` : base;
  };
  return (
    <nav aria-label={label} className="flex gap-1.5 overflow-x-auto px-3 pt-3 pb-1">
      {options.map((o) => {
        const active = (value ?? "") === o.value;
        return (
          <Link
            key={o.value || "all"}
            href={href(o.value)}
            aria-current={active ? "true" : undefined}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-2",
              active ? "border-primary/40 bg-accent text-accent-foreground" : "text-muted-foreground hover:border-border-strong hover:text-foreground",
            )}
          >
            {o.label}
            {o.count !== undefined ? <span className="tabular-nums opacity-70">{o.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
