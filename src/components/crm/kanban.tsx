"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAction } from "./kit";

export interface BoardCard {
  id: string;
  name: string;
  accountName: string | null;
  ownerName: string | null;
  amount: string;
  weighted: string;
  probability: number;
  close: string | null;
  overdue: boolean;
  stale: boolean;
}
export interface BoardColumn {
  id: string;
  name: string;
  type: "OPEN" | "WON" | "LOST";
  probability: number;
  total: string;
  weighted: string;
  deals: BoardCard[];
}

/** Kanban board of one pipeline: drag cards between stages (HTML5 drag and drop) or use the arrow buttons. */
export function PipelineBoard({ base, locale, columns, canManage }: { base: string; locale: string; columns: BoardColumn[]; canManage: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const move = (dealId: string, stage: BoardColumn) => {
    let lostReason: string | undefined;
    if (stage.type === "LOST") {
      lostReason = window.prompt(t("crm.deals.lostReasonPrompt"))?.trim() || undefined;
      if (!lostReason) return;
    }
    void run(() => api(`${base}/crm/deals/${dealId}/stage`, { body: { stageId: stage.id, lostReason } }));
  };
  const stageOf = (dealId: string) => columns.findIndex((c) => c.deals.some((d) => d.id === dealId));
  return (
    <div className="grid gap-2">
      <FormError error={error} />
      <div className="flex gap-3 overflow-x-auto pb-2" aria-busy={busy}>
        {columns.map((col, ci) => (
          <section
            key={col.id}
            aria-label={col.name}
            className={cn("flex w-72 shrink-0 flex-col rounded-lg border bg-surface-2", over === col.id && dragging ? "ring-2 ring-primary" : "")}
            onDragOver={(e) => {
              if (!canManage || !dragging) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOver(col.id);
            }}
            onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              setOver(null);
              setDragging(null);
              if (id && stageOf(id) !== ci) move(id, col);
            }}
          >
            <header className="grid gap-0.5 border-b px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-sm font-semibold">{col.name}</h3>
                <Badge tone={col.type === "WON" ? "success" : col.type === "LOST" ? "danger" : "neutral"}>{col.deals.length}</Badge>
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {col.total}
                {col.type === "OPEN" ? ` · ${t("crm.weighted")} ${col.weighted} · ${col.probability}%` : ""}
              </p>
            </header>
            <ul className="grid min-h-24 content-start gap-2 p-2">
              {col.deals.map((d) => (
                <li
                  key={d.id}
                  draggable={canManage && !busy}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", d.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(d.id);
                  }}
                  onDragEnd={() => (setDragging(null), setOver(null))}
                  className={cn("grid gap-1 rounded-md border bg-surface p-2 text-sm shadow-xs", canManage ? "cursor-grab active:cursor-grabbing" : "", dragging === d.id ? "opacity-50" : "")}
                >
                  <Link href={`/${locale}/crm/deals/${d.id}`} className="font-medium hover:underline">
                    {d.name}
                  </Link>
                  {d.accountName ? <span className="truncate text-xs text-muted-foreground">{d.accountName}</span> : null}
                  <span className="flex flex-wrap items-center gap-1 text-xs">
                    <span className="font-medium tabular-nums">{d.amount}</span>
                    <span className="text-muted-foreground">· {d.probability}%</span>
                    {d.stale ? <Badge tone="warning">{t("crm.deals.stale")}</Badge> : null}
                  </span>
                  <span className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
                    <span className="truncate">{d.ownerName ?? t("crm.unassigned")}</span>
                    {d.close ? <span className={d.overdue ? "text-warning" : undefined}>{d.close}</span> : null}
                  </span>
                  {canManage ? (
                    <span className="flex justify-between">
                      <Button type="button" size="icon" variant="ghost" className="size-7" disabled={busy || ci === 0} aria-label={t("crm.pipeline.moveBack")} title={columns[ci - 1]?.name} onClick={() => move(d.id, columns[ci - 1]!)}>
                        <ChevronLeft aria-hidden className="rtl:rotate-180" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        disabled={busy || ci === columns.length - 1}
                        aria-label={t("crm.pipeline.moveForward")}
                        title={columns[ci + 1]?.name}
                        onClick={() => move(d.id, columns[ci + 1]!)}
                      >
                        <ChevronRight aria-hidden className="rtl:rotate-180" />
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
              {col.deals.length === 0 ? <li className="p-2 text-center text-xs text-muted-foreground">{t("crm.pipeline.emptyStage")}</li> : null}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
