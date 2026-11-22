import Link from "next/link";
import type { ReactNode } from "react";
import { Columns3, Database, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { NextPage } from "@/components/admin/kit";

/**
 * Stream B's local directory table (users, organizations). Stream A is building the shared `AC/data-table`; this
 * wrapper keeps the same contract — server-side cursor pagination, page size, column visibility (`cols`), filter
 * reset and a data-source line — with GET forms only (no client state), so it can be swapped for the shared table
 * without changing the pages' data functions.
 */
export interface DirectoryColumn<T> {
  key: string;
  label: string;
  /** Always shown (identity column). */
  fixed?: boolean;
  /** Hidden unless chosen. */
  optional?: boolean;
  className?: string;
  render: (row: T) => ReactNode;
}

export const PAGE_SIZES = [25, 50, 100, 200] as const;

export function visibleColumns<T>(columns: DirectoryColumn<T>[], cols: string | undefined) {
  const chosen = cols ? new Set(cols.split(",").filter(Boolean)) : null;
  return columns.filter((c) => c.fixed || (chosen ? chosen.has(c.key) : !c.optional));
}

export function DirectoryTable<T extends { id: string }>({
  columns,
  rows,
  params,
  base,
  nextCursor,
  limit,
  labels,
  source,
  empty,
  filtered,
}: {
  columns: DirectoryColumn<T>[];
  rows: T[];
  params: Record<string, string | undefined>;
  base: string;
  nextCursor: string | null;
  limit: number;
  labels: { columns: string; apply: string; pageSize: string; reset: string; next: string; source: string };
  source: string;
  empty: ReactNode;
  filtered: boolean;
}) {
  const shown = visibleColumns(columns, params.cols);
  const keep = (omit: string[]) =>
    Object.entries(params)
      .filter(([k, v]) => v && !omit.includes(k) && k !== "cursor")
      .map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
        <details className="relative">
          <summary className="inline-flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-md border px-2.5 font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2">
            <Columns3 className="size-3.5" aria-hidden />
            {labels.columns}
          </summary>
          <form action={base} className="absolute start-0 top-8 z-20 grid min-w-52 gap-1.5 rounded-md border bg-surface p-3 shadow-elev-2">
            {keep(["cols"])}
            {columns
              .filter((c) => !c.fixed)
              .map((c) => (
                <label key={c.key} className="flex items-center gap-2">
                  <input type="checkbox" name="col" value={c.key} defaultChecked={shown.includes(c)} />
                  {c.label}
                </label>
              ))}
            <Button type="submit" size="sm" variant="secondary" className="mt-1">
              {labels.apply}
            </Button>
          </form>
        </details>
        <form action={base} className="flex items-center gap-1.5">
          {keep(["limit"])}
          <label htmlFor="dir-limit" className="text-muted-foreground">
            {labels.pageSize}
          </label>
          <Select id="dir-limit" name="limit" defaultValue={String(limit)} className="h-7 w-auto py-0 text-xs">
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" variant="ghost">
            {labels.apply}
          </Button>
        </form>
        {filtered ? (
          <Link href={base} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            <RotateCcw className="size-3" aria-hidden />
            {labels.reset}
          </Link>
        ) : null}
        <span className="ms-auto inline-flex items-center gap-1 text-muted-foreground" title={labels.source}>
          <Database className="size-3" aria-hidden />
          {source}
        </span>
      </div>
      {rows.length === 0 ? (
        empty
      ) : (
        <Table density="compact" stickyHeader>
          <THead>
            <Tr>
              {shown.map((c) => (
                <Th key={c.key} className={c.className}>
                  {c.label}
                </Th>
              ))}
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Tr key={r.id}>
                {shown.map((c) => (
                  <Td key={c.key} className={c.className}>
                    {c.render(r)}
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      <NextPage base={base} params={params} cursor={nextCursor} label={labels.next} />
    </>
  );
}

/** Column checkboxes submit `col=a&col=b`; pages fold them into the `cols` parameter. */
export function colsParam(query: Record<string, string | string[] | undefined>): string | undefined {
  const raw = query.col ?? query.cols;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const clean = list.map((c) => c.trim()).filter((c) => /^[a-zA-Z]{1,24}$/.test(c));
  return clean.length ? [...new Set(clean)].slice(0, 20).join(",") : undefined;
}
