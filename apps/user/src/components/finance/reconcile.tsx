"use client";

import { useState } from "react";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAction } from "./ui";

export interface ReconcileRow {
  id: string;
  date: string;
  description: string;
  detail: string;
  amount: string;
  negative: boolean;
  ticked: boolean;
}

/** Tick the statement's transactions; the server recomputes the cleared balance and difference on refresh. */
export function ReconcileTicker({ base, id, rows, editable }: { base: string; id: string; rows: ReconcileRow[]; editable: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const tick = (ids: string[], cleared: boolean) => {
    setPending(new Set(ids));
    void run(() => api(`${base}/reconciliations/${id}`, { method: "PATCH", body: { action: "tick", transactionIds: ids, cleared } }), () => setPending(new Set()));
  };
  const unticked = rows.filter((r) => !r.ticked).map((r) => r.id);
  const ticked = rows.filter((r) => r.ticked).map((r) => r.id);
  return (
    <div className="grid gap-2">
      {editable && rows.length ? (
        <div className="flex gap-3 px-4 pt-3 text-xs">
          <button type="button" className="hover:underline disabled:opacity-50" disabled={busy || !unticked.length} onClick={() => tick(unticked.slice(0, 500), true)}>
            {t("finance.reconciliation.tickAll")}
          </button>
          <button type="button" className="hover:underline disabled:opacity-50" disabled={busy || !ticked.length} onClick={() => tick(ticked.slice(0, 500), false)}>
            {t("finance.reconciliation.untickAll")}
          </button>
        </div>
      ) : null}
      <ul className="grid divide-y">
        {rows.map((r) => (
          <li key={r.id}>
            <label className={cn("flex items-center gap-3 px-4 py-2 text-sm", editable && "cursor-pointer hover:bg-muted/50", pending.has(r.id) && "opacity-50")}>
              <input type="checkbox" className="size-4" checked={r.ticked} disabled={!editable || busy} onChange={(e) => tick([r.id], e.target.checked)} />
              <span className="w-24 shrink-0 text-muted-foreground">{r.date}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.description}</span>
                {r.detail ? <span className="block truncate text-xs text-muted-foreground">{r.detail}</span> : null}
              </span>
              <span className={cn("tabular-nums", r.negative ? "text-danger" : "text-success")}>{r.amount}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="px-4 pb-3">
        <FormError error={error} />
      </div>
    </div>
  );
}
