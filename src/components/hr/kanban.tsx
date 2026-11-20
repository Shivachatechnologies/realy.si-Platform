"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { useErrorMessage } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export interface KanbanCard {
  id: string;
  name: string;
  job: string;
  stage: string;
  aiScore: number | null;
  rating: number | null;
  applied: string;
}

const STAGES = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED"] as const;
const MOVABLE = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "REJECTED"];

/** Candidate pipeline board: drag a card to another column (or use its stage menu) to move it. Hiring uses the hire flow. */
export function CandidateKanban({ base, cards }: { base: string; cards: KanbanCard[] }) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const message = useErrorMessage();
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, string>>({});
  const stageOf = (c: KanbanCard) => local[c.id] ?? c.stage;

  async function move(id: string, stage: string) {
    const card = cards.find((c) => c.id === id);
    if (!card || stageOf(card) === stage || !MOVABLE.includes(stage) || stageOf(card) === "HIRED") return;
    setError(null);
    setLocal((l) => ({ ...l, [id]: stage }));
    try {
      await api(`${base}/hr/candidates/${id}`, { method: "PATCH", body: { stage } });
      router.refresh();
    } catch (err) {
      setLocal((l) => {
        const next = { ...l };
        delete next[id];
        return next;
      });
      setError(message(err));
    }
  }

  return (
    <div className="grid gap-2">
      {error ? (
        <p role="alert" className="px-3 text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-3 overflow-x-auto p-3">
        {STAGES.map((s) => {
          const items = cards.filter((c) => stageOf(c) === s);
          return (
            <section
              key={s}
              aria-label={t(`hr.stages.${s}`)}
              onDragOver={(e) => {
                if (MOVABLE.includes(s)) {
                  e.preventDefault();
                  setOver(s);
                }
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                void move(e.dataTransfer.getData("text/plain"), s);
              }}
              className={cn("flex w-60 shrink-0 flex-col gap-2 rounded-lg border bg-surface-2 p-2", over === s && "ring-2 ring-primary")}
            >
              <header className="flex items-center justify-between px-1 text-xs font-medium">
                <span>{t(`hr.stages.${s}`)}</span>
                <Badge>{items.length}</Badge>
              </header>
              {items.map((c) => (
                <article key={c.id} draggable={stageOf(c) !== "HIRED"} onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)} className="grid gap-1 rounded-md border bg-surface p-2 text-sm shadow-xs">
                  <Link href={`/${locale}/hr/recruiting/candidates/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  <span className="truncate text-xs text-muted-foreground">{c.job}</span>
                  <div className="flex flex-wrap items-center gap-1">
                    {c.aiScore != null ? <Badge tone={c.aiScore >= 70 ? "success" : c.aiScore >= 40 ? "warning" : "danger"}>{t("hr.recruiting.aiScoreShort", { score: c.aiScore })}</Badge> : null}
                    {c.rating ? <Badge>{"★".repeat(c.rating)}</Badge> : null}
                    <span className="text-[11px] text-muted-foreground">{c.applied}</span>
                  </div>
                  {stageOf(c) !== "HIRED" ? (
                    <select aria-label={t("hr.recruiting.moveTo")} className="h-7 rounded border bg-surface px-1 text-xs" value={stageOf(c)} onChange={(e) => void move(c.id, e.target.value)}>
                      {MOVABLE.map((m) => (
                        <option key={m} value={m}>
                          {t(`hr.stages.${m}`)}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
