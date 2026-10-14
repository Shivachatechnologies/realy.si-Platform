"use client";

import { ArrowUp, Sparkles } from "lucide-react";
import { useT } from "@/i18n/client";
import { Badge } from "@/components/ui/badge";

/**
 * The primary command. Objective planning ships in Phase 3, so the input is shown but cannot submit —
 * the UI never pretends to execute something it can't.
 */
export function ObjectiveBar() {
  const t = useT();
  return (
    <div className="rounded-lg border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="size-4 text-primary" aria-hidden />
        <h2 className="text-base font-semibold tracking-tight">{t("command.objectivePrompt")}</h2>
        <Badge tone="warning" className="ms-auto">{t("common.comingInPhase", { phase: 3 })}</Badge>
      </div>
      <form
        onSubmit={(e) => e.preventDefault()}
        className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 focus-within:border-ring"
        aria-describedby="objective-note"
      >
        <label htmlFor="objective" className="sr-only">{t("command.objectivePrompt")}</label>
        <input id="objective" disabled placeholder={t("command.objectivePlaceholder")} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed" />
        <button type="submit" disabled className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground opacity-40" aria-label={t("command.planObjective")}>
          <ArrowUp className="size-4" />
        </button>
      </form>
      <p id="objective-note" className="mt-2 text-xs text-muted-foreground">{t("command.objectiveUnavailable")}</p>
    </div>
  );
}
