"use client";

import { Brain, Check, ClipboardCheck, Flag, GitBranch, ListChecks, Play, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

export type StageKey = "understanding" | "planning" | "delegation" | "execution" | "review" | "completion";
export type StageState = "done" | "active" | "pending" | "failed" | "skipped";
export const STAGE_ORDER: StageKey[] = ["understanding", "planning", "delegation", "execution", "review", "completion"];

const ICONS: Record<StageKey, LucideIcon> = { understanding: Brain, planning: ListChecks, delegation: GitBranch, execution: Play, review: ClipboardCheck, completion: Flag };

/**
 * The six stages of a command, each coloured by its real state (derived on the server from the run, its plan steps,
 * their agent tasks and approvals). Several stages can be active at once (e.g. research executing while the
 * departments wait to be delegated) — the rail shows that honestly instead of a fake linear progress bar.
 */
export function StageRail({ stages, details, compact = false }: { stages: Record<StageKey, StageState>; details?: Partial<Record<StageKey, string>>; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <ol className={cn("grid grid-cols-6 gap-1", compact ? "" : "sm:gap-2")} aria-label={t("command.ai.stagesLabel")}>
      {STAGE_ORDER.map((k, i) => {
        const s = stages[k];
        const Icon = s === "done" ? Check : s === "failed" ? X : ICONS[k];
        return (
          <li key={k} className="relative grid justify-items-center gap-1 text-center" aria-current={s === "active" ? "step" : undefined}>
            {i > 0 ? (
              <span
                aria-hidden
                className={cn(
                  "absolute end-1/2 top-[15px] h-px w-full -translate-y-1/2",
                  stages[STAGE_ORDER[i - 1]!] === "done" ? "bg-success/60" : "bg-border",
                  compact && "top-[11px]",
                )}
              />
            ) : null}
            <span
              className={cn(
                "relative grid place-items-center rounded-full border bg-surface transition-colors",
                compact ? "size-[22px]" : "size-[30px]",
                s === "done" && "border-success/60 bg-success/10 text-success",
                s === "active" && "border-primary bg-primary/10 text-primary shadow-glow",
                s === "failed" && "border-danger/60 bg-danger/10 text-danger",
                (s === "pending" || s === "skipped") && "text-muted-foreground",
                s === "skipped" && "opacity-50",
              )}
            >
              {s === "active" ? <span aria-hidden className="absolute inset-0 rounded-full border border-primary/50 motion-safe:animate-ping" /> : null}
              <Icon className={compact ? "size-3" : "size-3.5"} aria-hidden />
            </span>
            {compact ? (
              <span className="sr-only">
                {t(`command.ai.stages.${k}`)}: {t(`command.ai.stageState.${s}`)}
              </span>
            ) : (
              <span className="grid gap-0.5">
                <span className={cn("text-[11px] font-medium leading-tight", s === "pending" || s === "skipped" ? "text-muted-foreground" : "text-foreground")}>{t(`command.ai.stages.${k}`)}</span>
                <span className="hidden text-[10px] leading-tight text-muted-foreground sm:block">{details?.[k] ?? t(`command.ai.stageState.${s}`)}</span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
