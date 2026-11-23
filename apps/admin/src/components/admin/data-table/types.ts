import type { ReactNode } from "react";

/** One column. `id` is stable (saved views store it); `header` is already translated. */
export interface DataTableColumn {
  id: string;
  header: string;
  align?: "start" | "end";
  /** The server sorts by it (?sort=<id>&dir=). */
  sortable?: boolean;
  /** May be hidden from the column menu (default true). */
  hideable?: boolean;
  /** Hidden until the admin shows it. */
  defaultHidden?: boolean;
  className?: string;
}

/**
 * One row. `cells` are rendered nodes (server components may build them: they serialize). `csv` gives the plain
 * export values per column id (falls back to nothing for that column). `href` makes the row keyboard-openable.
 */
export interface DataTableRow {
  id: string;
  cells: Record<string, ReactNode>;
  csv?: Record<string, string | number | boolean | null>;
  href?: string;
  /** Row is not selectable (e.g. already handled). */
  disabled?: boolean;
}

export interface DataTablePagination {
  /** Cursor of the next page, or null on the last page. */
  nextCursor: string | null;
  pageSize: number;
  pageSizes?: readonly number[];
  /** Total rows when the server counts them (bounded); omit when unknown. */
  total?: number | null;
}

export interface DataTableExport {
  /** The admin may export (decided on the server with the page's export permission). */
  allowed: boolean;
  /** Server export endpoint (gets the current filters as query); without it the current page exports as CSV. */
  href?: string;
  filename?: string;
}

export interface DataTableMeta {
  /** Where the rows come from ("audit_logs", "Stripe API"). */
  source?: string;
  /** When the data was read (ms epoch). Shown as "Updated …"; older than `staleAfterMs` shows a stale marker. */
  loadedAt?: number;
  staleAfterMs?: number;
}
