/**
 * DataTable URL conventions (stream A), shared by server pages and the client table. Pure functions: safe on both.
 *
 *   ?cursor=<opaque>      keyset cursor of the page (the server decides its format)
 *   ?pageSize=<n>         rows per page (one of PAGE_SIZES; default DEFAULT_PAGE_SIZE)
 *   ?sort=<col>&dir=asc|desc
 *   anything else         filters (the page's own names: q, status, …)
 */
export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;
export const TABLE_PARAMS = ["cursor", "pageSize", "sort", "dir"] as const;

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined)?.slice(0, 300);

/** Parse the table params of a page's `searchParams` (bounded; unknown sort columns fall back to `defaultSort`). */
export function tableParams(raw: Raw, opts: { sortable?: readonly string[]; defaultSort?: { by: string; dir: "asc" | "desc" }; pageSizes?: readonly number[]; defaultPageSize?: number } = {}) {
  const sizes = opts.pageSizes ?? PAGE_SIZES;
  const n = Number(first(raw.pageSize));
  const pageSize = sizes.includes(n) ? n : (opts.defaultPageSize ?? DEFAULT_PAGE_SIZE);
  const by = first(raw.sort);
  const dir = first(raw.dir) === "asc" ? "asc" : "desc";
  const sort = by && opts.sortable?.includes(by) ? { by, dir: dir as "asc" | "desc" } : (opts.defaultSort ?? null);
  return { cursor: first(raw.cursor) || undefined, pageSize, sort };
}

/** The filter values of `searchParams` (every string param except the table's own), for saved views and reset. */
export function filterParams(raw: Raw, keys?: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if ((TABLE_PARAMS as readonly string[]).includes(k) || (keys && !keys.includes(k))) continue;
    const s = first(v);
    if (s) out[k] = s;
  }
  return out;
}

/** `path?query` with empty values dropped. */
export function hrefWith(path: string, params: Record<string, string | number | undefined | null>) {
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== null && e[1] !== "").map(([k, v]) => [k, String(v)]));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/** RFC 4180 CSV cell; also defuses spreadsheet formulas (=, +, -, @ prefixes). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n");
}
