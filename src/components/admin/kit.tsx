import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";
import { isAppError } from "@/server/core/errors";

/** Page title row of the admin console. */
export function AdminHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A KPI tile that links to its section. */
export function StatTile({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: "danger" | "warning" | "success" }) {
  const body = (
    <Card className={cn("h-full p-4 transition-colors", href && "hover:bg-muted/50")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular", tone === "danger" && "text-danger", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-lg focus-visible:outline-2">
      {body}
    </Link>
  ) : (
    body
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{children}</div>;
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
