import { cn } from "@/lib/utils";

/**
 * Before/after diff of two JSON values (audit old_value / new_value), flattened to dotted paths. Pure and
 * server-renderable. Values are shown as stored; nothing is editable.
 */
export type DiffKind = "added" | "removed" | "changed" | "same";
export interface DiffRow {
  path: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function flatten(v: unknown, prefix = "", out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (isObj(v) && Object.keys(v).length) {
    for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(v) && v.length && v.every((x) => isObj(x) || Array.isArray(x))) {
    v.forEach((x, i) => flatten(x, `${prefix}[${i}]`, out));
  } else {
    out.set(prefix || "(value)", v);
  }
  return out;
}

/** Diff rows, changed first (exported for tests). */
export function jsonDiff(before: unknown, after: unknown): DiffRow[] {
  const a = before === null || before === undefined ? new Map<string, unknown>() : flatten(before);
  const b = after === null || after === undefined ? new Map<string, unknown>() : flatten(after);
  const rows: DiffRow[] = [];
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    const has = [a.has(path), b.has(path)];
    const x = a.get(path);
    const y = b.get(path);
    const kind: DiffKind = !has[0] ? "added" : !has[1] ? "removed" : JSON.stringify(x) === JSON.stringify(y) ? "same" : "changed";
    rows.push({ path, kind, before: x, after: y });
  }
  const order: Record<DiffKind, number> = { changed: 0, added: 1, removed: 2, same: 3 };
  return rows.sort((p, q) => order[p.kind] - order[q.kind] || p.path.localeCompare(q.path));
}

const show = (v: unknown) => (v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));

const TONE: Record<DiffKind, string> = {
  added: "bg-success/10",
  removed: "bg-danger/10",
  changed: "bg-warning/10",
  same: "",
};

export function JsonDiff({ before, after, labels }: { before: unknown; after: unknown; labels: { path: string; before: string; after: string; empty: string; kinds: Record<DiffKind, string> } }) {
  const rows = jsonDiff(before, after);
  if (!rows.length) return <p className="p-4 text-sm text-muted-foreground">{labels.empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-start text-muted-foreground">
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {labels.path}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {labels.before}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {labels.after}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.path} className={cn("border-b align-top last:border-0", TONE[r.kind])}>
              <td className="px-3 py-1.5 font-mono whitespace-nowrap">
                {r.path} <span className="sr-only">({labels.kinds[r.kind]})</span>
                {r.kind !== "same" ? <span className="ms-1 text-[10px] text-muted-foreground uppercase">{labels.kinds[r.kind]}</span> : null}
              </td>
              <td className={cn("max-w-md px-3 py-1.5 font-mono break-all", r.kind === "removed" || r.kind === "changed" ? "text-danger line-through decoration-danger/40" : "text-muted-foreground")}>{show(r.before)}</td>
              <td className={cn("max-w-md px-3 py-1.5 font-mono break-all", r.kind === "added" || r.kind === "changed" ? "text-success" : "text-muted-foreground")}>{show(r.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
