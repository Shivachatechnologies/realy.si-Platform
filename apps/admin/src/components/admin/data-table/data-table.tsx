"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { DropdownMenu } from "radix-ui";
import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, ChevronLeft, ChevronRight, ChevronsLeft, Columns3, Database, Download, FilterX, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useShell } from "@/components/shell/shell-context";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { SavedView } from "@/server/modules/admin/preferences";
import { Timestamp } from "../timestamp";
import { hrefWith, PAGE_SIZES, toCsv } from "./params";
import type { DataTableColumn, DataTableExport, DataTableMeta, DataTablePagination, DataTableRow } from "./types";

export type { DataTableColumn, DataTableExport, DataTableMeta, DataTablePagination, DataTableRow } from "./types";

// ───────────── Selection (bulk actions) ─────────────

interface Selection {
  ids: string[];
  clear: () => void;
}
const SelectionContext = createContext<Selection>({ ids: [], clear: () => {} });

/** Inside `bulkBar`: the selected row ids and a `clear()` (bulk action components call their own API). */
export function useDataTableSelection() {
  return useContext(SelectionContext);
}

const storageKey = (id: string) => `realy.admin.dt.${id}.columns`;
const COLUMNS_EVENT = "realy:dt-columns";
function subscribeColumns(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(COLUMNS_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(COLUMNS_EVENT, cb);
  };
}
function readColumns(raw: string | null): string[] | null {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null;
  } catch {
    return null;
  }
}
function storedColumnsRaw(id: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(id));
  } catch {
    return null;
  }
}
const subscribeMinute = (cb: () => void) => {
  const timer = window.setInterval(cb, 60_000);
  return () => window.clearInterval(timer);
};
const minuteNow = () => Math.floor(Date.now() / 60_000) * 60_000;

/**
 * Reusable console table (stream A). Server-side pagination (keyset cursor + page size), server sorting, saved
 * views (per admin, optionally shared), column visibility (remembered per table in this browser and stored in saved
 * views), filter reset, export only when `exportOptions.allowed` (server endpoint or current-page CSV), row selection
 * with a bulk-action bar, density from the admin's compact-mode preference, and a data-source / last-updated /
 * stale indicator. All state lives in the URL, so a view is shareable and the back button works.
 * See docs/admin/STREAMS.md § DataTable for the contract.
 */
export function DataTable({
  id,
  columns,
  rows,
  query = {},
  filterKeys,
  pagination,
  sort,
  exportOptions,
  selectable = false,
  bulkBar,
  meta,
  toolbar,
  empty,
  caption,
  savedViews = true,
}: {
  /** Stable table id ("users", "audit"): saved views and column memory are keyed by it. Lower-case. */
  id: string;
  columns: DataTableColumn[];
  rows: DataTableRow[];
  /** Current filter values (from searchParams, without cursor/pageSize/sort/dir). */
  query?: Record<string, string | undefined>;
  /** Which query keys are filters (reset clears them; saved views store them). Default: every key of `query`. */
  filterKeys?: readonly string[];
  pagination?: DataTablePagination;
  sort?: { by: string; dir: "asc" | "desc" } | null;
  exportOptions?: DataTableExport;
  selectable?: boolean;
  /** Shown while rows are selected; read the ids with useDataTableSelection(). */
  bulkBar?: ReactNode;
  meta?: DataTableMeta;
  /** Filters (e.g. a <form> with selects) rendered above the table. */
  toolbar?: ReactNode;
  empty?: ReactNode;
  caption?: string;
  savedViews?: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const toast = useToast();
  const { prefs } = useShell();
  const filters = useMemo(() => Object.fromEntries(Object.entries(query).filter((e): e is [string, string] => !!e[1] && (!filterKeys || filterKeys.includes(e[0])))), [query, filterKeys]);
  const tableQuery = { pageSize: pagination && pagination.pageSize !== 25 ? pagination.pageSize : undefined, sort: sort?.by, dir: sort?.by ? sort.dir : undefined };

  const defaults = useMemo(() => columns.filter((c) => !c.defaultHidden).map((c) => c.id), [columns]);
  // Column choice per table, remembered in this browser (server render and first paint use the defaults).
  const storedRaw = useSyncExternalStore(
    subscribeColumns,
    () => storedColumnsRaw(id),
    () => null,
  );
  const visible = useMemo(() => readColumns(storedRaw)?.filter((c) => columns.some((col) => col.id === c)) ?? defaults, [storedRaw, columns, defaults]);
  const setColumns = useCallback(
    (next: string[]) => {
      try {
        window.localStorage.setItem(storageKey(id), JSON.stringify(next));
      } catch {
        /* private mode: nothing to remember */
      }
      window.dispatchEvent(new Event(COLUMNS_EVENT));
    },
    [id],
  );
  const shown = columns.filter((c) => c.hideable === false || visible.includes(c.id));

  // Selection belongs to the rows it was made on: a new page (other row ids) starts empty.
  const rowKey = rows.map((r) => r.id).join(",");
  const [sel, setSel] = useState<{ key: string; ids: string[] }>({ key: rowKey, ids: [] });
  const selected = useMemo(() => (sel.key === rowKey ? sel.ids : []), [sel, rowKey]);
  const setSelected = (next: string[] | ((cur: string[]) => string[])) => setSel((s) => ({ key: rowKey, ids: typeof next === "function" ? next(s.key === rowKey ? s.ids : []) : next }));
  const selectableRows = rows.filter((r) => !r.disabled);
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selected.includes(r.id));
  const selection = useMemo(() => ({ ids: selected, clear: () => setSel({ key: rowKey, ids: [] }) }), [selected, rowKey]);

  const nav = (params: Record<string, string | number | undefined>) => router.push(hrefWith(pathname, params));
  const sortHref = (col: string) => {
    const dir = sort?.by === col && sort.dir === "desc" ? "asc" : "desc";
    return hrefWith(pathname, { ...filters, ...tableQuery, sort: col, dir, cursor: undefined });
  };

  const exportCsv = () => {
    const cols = shown.filter((c) => rows.some((r) => r.csv && c.id in r.csv));
    const csv = toCsv(
      cols.map((c) => c.header),
      rows.map((r) => cols.map((c) => r.csv?.[c.id] ?? "")),
    );
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportOptions?.filename ?? `${id}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("admin.shell.table.exported", { count: rows.length }));
  };

  const now = useSyncExternalStore(subscribeMinute, minuteNow, () => 0);
  const stale = now > 0 && meta?.loadedAt && meta.staleAfterMs ? now - meta.loadedAt > meta.staleAfterMs : false;
  const hasFilters = Object.keys(filters).length > 0;
  const density = prefs.density === "compact" ? "compact" : "default";

  return (
    <SelectionContext.Provider value={selection}>
      <div className="grid min-w-0 gap-0 overflow-hidden rounded-lg border bg-surface shadow-elev-1">
        <div className="flex flex-wrap items-center gap-2 border-b p-2">
          {toolbar ? <div className="min-w-0 flex-1">{toolbar}</div> : <div className="flex-1" />}
          <div className="flex flex-wrap items-center gap-1.5">
            {hasFilters ? (
              <Button asChild size="sm" variant="ghost">
                <Link href={hrefWith(pathname, { pageSize: tableQuery.pageSize })}>
                  <FilterX aria-hidden />
                  {t("admin.common.clearFilters")}
                </Link>
              </Button>
            ) : null}
            {savedViews ? <SavedViewsMenu table={id} filters={filters} columns={visible} onApply={(v) => (v.columns.length ? setColumns(v.columns) : setColumns(defaults))} /> : null}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button size="sm" variant="secondary" aria-label={t("admin.shell.table.columns")}>
                  <Columns3 aria-hidden />
                  <span className="hidden sm:inline">{t("admin.shell.table.columns")}</span>
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-48 rounded-lg border bg-surface p-1 shadow-elev-3">
                  {columns
                    .filter((c) => c.hideable !== false)
                    .map((c) => (
                      <DropdownMenu.CheckboxItem
                        key={c.id}
                        checked={visible.includes(c.id)}
                        onSelect={(e) => e.preventDefault()}
                        onCheckedChange={(on) => setColumns(on ? columns.filter((x) => x.id === c.id || visible.includes(x.id)).map((x) => x.id) : visible.filter((v) => v !== c.id))}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent"
                      >
                        <span className={cn("grid size-4 place-items-center rounded border text-[10px]", visible.includes(c.id) && "border-primary bg-primary text-primary-foreground")}>{visible.includes(c.id) ? "✓" : ""}</span>
                        {c.header}
                      </DropdownMenu.CheckboxItem>
                    ))}
                  <DropdownMenu.Separator className="my-1 h-px bg-border" />
                  <DropdownMenu.Item onSelect={() => setColumns(defaults)} className="cursor-pointer rounded-md px-2 py-1.5 text-xs text-muted-foreground outline-none data-[highlighted]:bg-accent">
                    {t("admin.shell.table.resetColumns")}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            {exportOptions?.allowed ? (
              exportOptions.href ? (
                <Button asChild size="sm" variant="secondary">
                  <a href={hrefWith(exportOptions.href, filters)} download>
                    <Download aria-hidden />
                    <span className="hidden sm:inline">{t("admin.shell.table.export")}</span>
                  </a>
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!rows.length} title={t("admin.shell.table.exportPageHint")}>
                  <Download aria-hidden />
                  <span className="hidden sm:inline">{t("admin.shell.table.exportPage")}</span>
                </Button>
              )
            ) : null}
          </div>
        </div>
        {selectable && selected.length ? (
          <div role="region" aria-label={t("admin.shell.table.bulk")} className="flex flex-wrap items-center gap-2 border-b bg-accent/50 px-3 py-2 text-sm">
            <span className="font-medium">{t("admin.shell.table.selected", { count: selected.length })}</span>
            <button type="button" onClick={() => setSelected([])} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
              {t("admin.shell.table.clearSelection")}
            </button>
            <div className="ms-auto flex flex-wrap gap-2">{bulkBar}</div>
          </div>
        ) : null}
        {rows.length === 0 ? (
          (empty ?? <p className="p-6 text-center text-sm text-muted-foreground">{hasFilters ? t("admin.common.tryOtherFilters") : t("common.noResults")}</p>)
        ) : (
          <Table density={density}>
            {caption ? <caption className="sr-only">{caption}</caption> : null}
            <THead>
              <Tr className="hover:bg-transparent">
                {selectable ? (
                  <Th className="w-8">
                    <input
                      type="checkbox"
                      aria-label={t("admin.shell.table.selectAll")}
                      checked={allSelected}
                      onChange={(e) => setSelected(e.target.checked ? selectableRows.map((r) => r.id) : [])}
                      className="size-4 accent-[var(--primary)]"
                    />
                  </Th>
                ) : null}
                {shown.map((c) => (
                  <Th key={c.id} className={cn(c.align === "end" && "text-end", c.className)} aria-sort={sort?.by === c.id ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                    {c.sortable ? (
                      <Link href={sortHref(c.id)} className={cn("inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-2", c.align === "end" && "flex-row-reverse")}>
                        {c.header}
                        {sort?.by === c.id ? sort.dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden /> : <ArrowUpDown className="size-3 opacity-40" aria-hidden />}
                      </Link>
                    ) : (
                      c.header
                    )}
                  </Th>
                ))}
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => {
                const isSel = selected.includes(r.id);
                return (
                  <Tr
                    key={r.id}
                    data-state={isSel ? "selected" : undefined}
                    className={cn(r.href && "cursor-pointer")}
                    onClick={
                      r.href
                        ? (e) => {
                            if ((e.target as HTMLElement).closest("a,button,input,label,select,textarea")) return;
                            router.push(r.href!);
                          }
                        : undefined
                    }
                  >
                    {selectable ? (
                      <Td className="w-8">
                        <input
                          type="checkbox"
                          disabled={r.disabled}
                          aria-label={t("admin.shell.table.selectRow")}
                          checked={isSel}
                          onChange={(e) => setSelected((s) => (e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)))}
                          className="size-4 accent-[var(--primary)]"
                        />
                      </Td>
                    ) : null}
                    {shown.map((c, i) => (
                      <Td key={c.id} className={cn(c.align === "end" && "text-end tabular-nums", c.className)}>
                        {i === 0 && r.href ? (
                          <Link href={r.href} className="hover:underline focus-visible:outline-2">
                            {r.cells[c.id]}
                          </Link>
                        ) : (
                          r.cells[c.id]
                        )}
                      </Td>
                    ))}
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-3 py-2 text-xs text-muted-foreground">
          {meta?.source ? (
            <span className="inline-flex items-center gap-1" title={t("admin.shell.table.source")}>
              <Database className="size-3" aria-hidden />
              <span className="font-mono">{meta.source}</span>
            </span>
          ) : null}
          {meta?.loadedAt ? (
            <span className={cn("inline-flex items-center gap-1", stale && "text-warning")}>
              {t("admin.shell.updated")} <Timestamp value={new Date(meta.loadedAt)} mode="relative" />
              {stale ? (
                <button type="button" onClick={() => router.refresh()} className="font-medium underline-offset-2 hover:underline">
                  {t("admin.shell.staleRefresh")}
                </button>
              ) : null}
            </span>
          ) : null}
          {pagination ? (
            <div className="ms-auto flex flex-wrap items-center gap-2">
              {typeof pagination.total === "number" ? <span>{t("admin.shell.table.total", { count: pagination.total })}</span> : null}
              <label className="inline-flex items-center gap-1">
                <span>{t("admin.shell.table.pageSize")}</span>
                <Select value={String(pagination.pageSize)} onChange={(e) => nav({ ...filters, ...tableQuery, pageSize: Number(e.target.value), cursor: undefined })} className="h-7 w-auto py-0 text-xs">
                  {(pagination.pageSizes ?? PAGE_SIZES).map((n) => (
                    <option key={n} value={n}>
                      {new Intl.NumberFormat(locale).format(n)}
                    </option>
                  ))}
                </Select>
              </label>
              <PageButtons pagination={pagination} first={hrefWith(pathname, { ...filters, ...tableQuery })} next={pagination.nextCursor ? hrefWith(pathname, { ...filters, ...tableQuery, cursor: pagination.nextCursor }) : null} />
            </div>
          ) : null}
        </div>
      </div>
    </SelectionContext.Provider>
  );
}

function PageButtons({ first, next }: { pagination: DataTablePagination; first: string; next: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const onLater = useSearchParams()?.has("cursor") ?? false;
  const btn = "inline-flex h-7 items-center gap-1 rounded-md border bg-surface px-2 text-xs text-foreground hover:bg-muted focus-visible:outline-2 aria-disabled:pointer-events-none aria-disabled:opacity-40";
  return (
    <nav aria-label={t("admin.shell.table.pagination")} className="flex items-center gap-1">
      <Link href={first} aria-disabled={!onLater} tabIndex={onLater ? undefined : -1} className={btn} title={t("admin.shell.table.first")}>
        <ChevronsLeft className="size-3 rtl:-scale-x-100" aria-hidden />
        <span className="sr-only">{t("admin.shell.table.first")}</span>
      </Link>
      <button type="button" disabled={!onLater} aria-disabled={!onLater} onClick={() => router.back()} className={btn}>
        <ChevronLeft className="size-3 rtl:-scale-x-100" aria-hidden />
        {t("admin.shell.table.previous")}
      </button>
      {next ? (
        <Link href={next} className={btn}>
          {t("admin.shell.table.next")}
          <ChevronRight className="size-3 rtl:-scale-x-100" aria-hidden />
        </Link>
      ) : (
        <span aria-disabled className={btn}>
          {t("admin.shell.table.next")}
          <ChevronRight className="size-3 rtl:-scale-x-100" aria-hidden />
        </span>
      )}
    </nav>
  );
}

/** Saved views of one table: apply (own and shared), save the current filters and columns, delete own. */
function SavedViewsMenu({ table, filters, columns, onApply }: { table: string; filters: Record<string, string>; columns: string[]; onApply: (v: SavedView) => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const toast = useToast();
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    api<{ data: SavedView[] }>(`/api/v1/admin/me/saved-views?page=${encodeURIComponent(table)}`)
      .then((r) => setViews(r.data))
      .catch(() => setFailed(true));
  }, [table]);
  const save = async () => {
    if (saving || !name.trim()) return;
    setSaving(true);
    try {
      await api("/api/v1/admin/me/saved-views", { method: "POST", body: { page: table, name: name.trim(), query: filters, columns, shared } });
      toast.success(t("admin.shell.views.saved", { name: name.trim() }));
      setDialog(false);
      setName("");
      setViews(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("admin.shell.views.saveFailed"));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (v: SavedView) => {
    try {
      await api(`/api/v1/admin/me/saved-views/${v.id}`, { method: "DELETE" });
      setViews((xs) => xs?.filter((x) => x.id !== v.id) ?? null);
      toast.success(t("admin.shell.views.deleted", { name: v.name }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("admin.shell.views.saveFailed"));
    }
  };
  const item = "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent";
  return (
    <>
      <DropdownMenu.Root onOpenChange={(o) => o && views === null && load()}>
        <DropdownMenu.Trigger asChild>
          <Button size="sm" variant="secondary" aria-label={t("admin.shell.views.title")}>
            <Bookmark aria-hidden />
            <span className="hidden sm:inline">{t("admin.shell.views.title")}</span>
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-64 rounded-lg border bg-surface p-1 shadow-elev-3">
            {failed ? (
              <p className="px-2 py-2 text-xs text-danger">{t("admin.shell.views.loadFailed")}</p>
            ) : views === null ? (
              <p className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
                {t("common.loading")}
              </p>
            ) : views.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">{t("admin.shell.views.none")}</p>
            ) : (
              views.map((v) => (
                <div key={v.id} className="flex items-center">
                  <DropdownMenu.Item
                    className={cn(item, "min-w-0 flex-1")}
                    onSelect={() => {
                      onApply(v);
                      router.push(hrefWith(pathname, v.query));
                    }}
                  >
                    <span className="truncate">{v.name}</span>
                    {v.shared ? <span className="ms-auto text-[10px] text-muted-foreground">{v.mine ? t("admin.shell.views.sharedByYou") : t("admin.shell.views.shared")}</span> : null}
                  </DropdownMenu.Item>
                  {v.mine ? (
                    <button type="button" aria-label={t("admin.shell.views.delete", { name: v.name })} onClick={() => void remove(v)} className="grid size-7 place-items-center rounded text-muted-foreground hover:text-danger focus-visible:outline-2">
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  ) : null}
                </div>
              ))
            )}
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item className={item} onSelect={() => setDialog(true)}>
              {t("admin.shell.views.saveCurrent")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent title={t("admin.shell.views.saveCurrent")} description={t("admin.shell.views.saveHint")} closeLabel={t("common.close")}>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field label={t("admin.shell.views.name")} htmlFor={`view-name-${table}`}>
              <Input id={`view-name-${table}`} value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="size-4 accent-[var(--primary)]" />
              {t("admin.shell.views.shareWithAdmins")}
            </label>
            <div className="flex justify-end">
              <Button type="submit" disabled={saving || !name.trim()} aria-busy={saving}>
                {t("common.save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
