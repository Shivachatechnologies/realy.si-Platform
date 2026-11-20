"use client";

import { useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Lock, MessageSquare, Paperclip, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { QuickTaskForm } from "./task-forms";

export interface BoardCard {
  id: string;
  title: string;
  status: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  due: string | null;
  overdue: boolean;
  assigneeName: string | null;
  points: number | null;
  labels: string[];
  blocked: boolean;
  subtasks: number;
  comments: number;
  attachments: number;
  recurring: boolean;
}

const COLUMNS = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"] as const;
const PRIORITY_TONE = { URGENT: "danger", HIGH: "warning", MEDIUM: "neutral", LOW: "neutral" } as const;

/** Kanban board: HTML5 drag-and-drop between and within columns, plus ← → buttons for keyboard and touch. */
export function KanbanBoard({ base, locale, projectId, sprintId, cards: initial, canManage }: { base: string; locale: string; projectId: string; sprintId?: string; cards: BoardCard[]; canManage: boolean }) {
  const t = useT();
  const router = useRouter();
  const [cards, setCards] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ status: string; beforeId: string | null } | null>(null);
  const [error, setError] = useState<unknown>(null);
  // Adopt fresh server data after router.refresh() (render-time sync, no effect).
  const [source, setSource] = useState(initial);
  if (source !== initial) {
    setSource(initial);
    setCards(initial);
  }

  const column = (s: string) => cards.filter((c) => c.status === s);

  async function move(id: string, status: string, beforeId: string | null) {
    const card = cards.find((c) => c.id === id);
    if (!card || beforeId === id) return;
    const target = cards.filter((c) => c.status === status && c.id !== id);
    const idx = beforeId ? target.findIndex((c) => c.id === beforeId) : target.length;
    const after = idx >= 0 ? (target[idx]?.id ?? null) : null;
    const prev = idx > 0 ? target[idx - 1]!.id : null;
    const previous = cards;
    // Optimistic: reinsert locally.
    const rest = cards.filter((c) => c.id !== id);
    const moved = { ...card, status };
    const insertAt = after ? rest.findIndex((c) => c.id === after) : rest.length;
    setCards([...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)]);
    setError(null);
    try {
      await api(`${base}/tasks/${id}/move`, { body: { status, beforeId: prev, afterId: after } });
      router.refresh();
    } catch (err) {
      setCards(previous);
      setError(err);
    }
  }

  const onDrop = (e: DragEvent, status: string) => {
    e.preventDefault();
    const id = dragId ?? e.dataTransfer.getData("text/plain");
    setDragId(null);
    setOver(null);
    if (id) void move(id, status, over?.status === status ? over.beforeId : null);
  };

  return (
    <div className="grid gap-2">
      <FormError error={error} />
      <div className="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
        {COLUMNS.map((status, ci) => {
          const items = column(status);
          const points = items.reduce((n, c) => n + (c.points ?? 0), 0);
          return (
            <section
              key={status}
              aria-label={t(`work.taskStatus.${status}`)}
              className={cn("flex min-h-48 flex-col gap-2 rounded-lg border bg-surface-2 p-2", over?.status === status && "ring-2 ring-primary/40")}
              onDragOver={(e) => {
                if (!canManage) return;
                e.preventDefault();
                if (over?.status !== status) setOver({ status, beforeId: null });
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
              }}
              onDrop={(e) => onDrop(e, status)}
            >
              <header className="flex items-center justify-between px-1 text-xs font-medium">
                <span>{t(`work.taskStatus.${status}`)}</span>
                <span className="text-muted-foreground">
                  {items.length}
                  {points ? ` · ${t("work.pointsShort", { count: points })}` : ""}
                </span>
              </header>
              <ol className="grid gap-2">
                {items.map((c) => (
                  <li
                    key={c.id}
                    draggable={canManage}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", c.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(c.id);
                    }}
                    onDragEnd={() => (setDragId(null), setOver(null))}
                    onDragOver={(e) => {
                      if (!canManage) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const below = e.clientY > rect.top + rect.height / 2;
                      const idx = items.findIndex((x) => x.id === c.id);
                      const beforeId = below ? (items[idx + 1]?.id ?? null) : c.id;
                      if (over?.status !== status || over.beforeId !== beforeId) setOver({ status, beforeId });
                    }}
                    className={cn(
                      "grid gap-1.5 rounded-md border bg-surface p-2 text-sm shadow-xs",
                      canManage && "cursor-grab active:cursor-grabbing",
                      dragId === c.id && "opacity-50",
                      over?.status === status && over.beforeId === c.id && dragId !== c.id && "border-t-2 border-t-primary",
                    )}
                  >
                    <Link href={`/${locale}/projects/tasks/${c.id}`} className="font-medium break-words hover:underline">
                      {c.title}
                    </Link>
                    <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      {c.priority !== "MEDIUM" ? <Badge tone={PRIORITY_TONE[c.priority]}>{t(`work.priority.${c.priority}`)}</Badge> : null}
                      {c.blocked ? (
                        <Badge tone="warning" title={t("work.task.blocked")}>
                          <Lock className="size-3" aria-hidden />
                          {t("work.task.blocked")}
                        </Badge>
                      ) : null}
                      {c.points != null ? <Badge>{t("work.pointsShort", { count: c.points })}</Badge> : null}
                      {c.labels.slice(0, 3).map((l) => (
                        <Badge key={l}>{l}</Badge>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{c.assigneeName ?? t("work.unassigned")}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {c.recurring ? <Repeat className="size-3" aria-label={t("work.task.recurring")} /> : null}
                        {c.comments ? (
                          <span className="flex items-center gap-0.5">
                            <MessageSquare className="size-3" aria-hidden />
                            {c.comments}
                          </span>
                        ) : null}
                        {c.attachments ? (
                          <span className="flex items-center gap-0.5">
                            <Paperclip className="size-3" aria-hidden />
                            {c.attachments}
                          </span>
                        ) : null}
                        {c.due ? <span className={c.overdue ? "text-danger" : ""}>{c.due}</span> : null}
                      </span>
                    </div>
                    {canManage ? (
                      <div className="flex justify-between">
                        <button
                          type="button"
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                          disabled={ci === 0}
                          aria-label={t("work.board.moveTo", { status: ci > 0 ? t(`work.taskStatus.${COLUMNS[ci - 1]}`) : "" })}
                          onClick={() => void move(c.id, COLUMNS[ci - 1]!, null)}
                        >
                          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                          disabled={ci === COLUMNS.length - 1}
                          aria-label={t("work.board.moveTo", { status: ci < COLUMNS.length - 1 ? t(`work.taskStatus.${COLUMNS[ci + 1]}`) : "" })}
                          onClick={() => void move(c.id, COLUMNS[ci + 1]!, null)}
                        >
                          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
              {canManage ? <QuickTaskForm base={base} projectId={projectId} status={status} sprintId={sprintId} label={t("work.board.quickAdd")} /> : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
