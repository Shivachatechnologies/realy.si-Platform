/** Line diff of two texts (LCS), pure and client-safe. Used for the workflow version comparison. */

export interface DiffRow {
  /** "same" | "removed" (left only) | "added" (right only) | "changed" (left and right differ on this row). */
  kind: "same" | "removed" | "added" | "changed";
  left: string | null;
  right: string | null;
  leftNo: number | null;
  rightNo: number | null;
}

const MAX_LINES = 4000;

/** Side-by-side rows: unchanged lines aligned, adjacent removed/added runs paired as "changed". */
export function sideBySide(leftText: string, rightText: string): DiffRow[] {
  const a = leftText.split("\n").slice(0, MAX_LINES);
  const b = rightText.split("\n").slice(0, MAX_LINES);
  const n = a.length;
  const m = b.length;
  // LCS lengths, suffix table.
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = a[i] === b[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const ops: { kind: "same" | "removed" | "added"; i?: number; j?: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) ops.push({ kind: "same", i: i++, j: j++ });
    else if (L[i + 1]![j]! >= L[i]![j + 1]!) ops.push({ kind: "removed", i: i++ });
    else ops.push({ kind: "added", j: j++ });
  }
  while (i < n) ops.push({ kind: "removed", i: i++ });
  while (j < m) ops.push({ kind: "added", j: j++ });

  const rows: DiffRow[] = [];
  for (let k = 0; k < ops.length; ) {
    const op = ops[k]!;
    if (op.kind === "same") {
      rows.push({ kind: "same", left: a[op.i!]!, right: b[op.j!]!, leftNo: op.i! + 1, rightNo: op.j! + 1 });
      k++;
      continue;
    }
    const removed: number[] = [];
    const added: number[] = [];
    while (k < ops.length && ops[k]!.kind !== "same") {
      const o = ops[k]!;
      if (o.kind === "removed") removed.push(o.i!);
      else added.push(o.j!);
      k++;
    }
    for (let r = 0; r < Math.max(removed.length, added.length); r++) {
      const li = removed[r];
      const rj = added[r];
      rows.push({
        kind: li !== undefined && rj !== undefined ? "changed" : li !== undefined ? "removed" : "added",
        left: li !== undefined ? a[li]! : null,
        right: rj !== undefined ? b[rj]! : null,
        leftNo: li !== undefined ? li + 1 : null,
        rightNo: rj !== undefined ? rj + 1 : null,
      });
    }
  }
  return rows;
}
