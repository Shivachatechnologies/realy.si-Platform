import type { ReactNode } from "react";
import { Database } from "lucide-react";
import { Timestamp } from "../timestamp";

/** Stream F page helpers: data-source and last-updated strip, byte and percent formatting, "not tracked" cell. */

/** "Source: api_request_logs · updated 2 min ago": every F page names where its numbers come from. */
export function SourceNote({ source, at, label, extra }: { source: string; at?: Date | null; label: { source: string; updated: string }; extra?: ReactNode }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Database className="size-3" aria-hidden />
        {label.source}: <span className="font-mono">{source}</span>
      </span>
      {at ? (
        <span>
          {label.updated} <Timestamp value={at} mode="relative" />
        </span>
      ) : null}
      {extra}
    </p>
  );
}

export function bytes(n: number | null | undefined, locale: string): string {
  if (n === null || n === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 && i ? 1 : 0 }).format(v)} ${units[i]}`;
}

export function pct(n: number | null | undefined, locale: string): string | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: n < 0.1 ? 1 : 0 }).format(n);
}

/** Minor currency units → formatted amount. */
export function money(minor: number, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

/** Query string from params (empty values dropped). */
export function qs(params: Record<string, string | undefined>, extra: Record<string, string | undefined> = {}) {
  const s = new URLSearchParams(Object.entries({ ...params, ...extra }).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `?${s}` : "";
}
