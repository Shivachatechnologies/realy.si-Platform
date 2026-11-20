"use client";

import { Check, CloudOff, Loader2, RotateCcw } from "lucide-react";
import { useI18n } from "@/i18n/client";

/** "Saved — you can leave and continue later" indicator for guided journeys. */
export function SavedIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  const { t } = useI18n();
  if (state === "idle") return null;
  const Icon = state === "saving" ? Loader2 : state === "saved" ? Check : CloudOff;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" aria-live="polite">
      <Icon className={state === "saving" ? "size-3 animate-spin" : "size-3"} aria-hidden />
      {t(`cockpit.draft.${state}`)}
    </span>
  );
}

/** Shown when a journey was resumed from saved answers, with a "start over" escape hatch. */
export function ResumeNote({ onReset }: { onReset: () => void }) {
  const { t } = useI18n();
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-md bg-info/8 px-2.5 py-1.5 text-xs text-info">
      {t("cockpit.draft.resumed")}
      <button type="button" onClick={onReset} className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline">
        <RotateCcw className="size-3" aria-hidden />
        {t("cockpit.draft.startOver")}
      </button>
    </p>
  );
}

/** Compact client-side progress indicator for a guided journey (steps are buttons; only reached steps are clickable). */
export function FlowSteps({ steps, current, reached, onGo, label }: { steps: string[]; current: number; reached: number; onGo: (i: number) => void; label: string }) {
  return (
    <nav aria-label={label} className="overflow-x-auto">
      <ol className="flex min-w-max items-center gap-1 text-xs sm:text-sm">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s} className="flex items-center gap-1" aria-current={active ? "step" : undefined}>
              <button
                type="button"
                disabled={i > reached || active}
                onClick={() => onGo(i)}
                className="flex items-center gap-1.5 rounded-md px-1.5 py-1 enabled:hover:bg-muted disabled:cursor-default"
              >
                <span
                  aria-hidden
                  className={
                    active
                      ? "grid size-6 place-items-center rounded-full bg-brand-gradient text-[11px] font-semibold text-primary-foreground shadow-glow"
                      : done
                        ? "grid size-6 place-items-center rounded-full border border-success/40 bg-success/10 text-success"
                        : "grid size-6 place-items-center rounded-full border text-[11px] text-muted-foreground"
                  }
                >
                  {done ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className={active ? "whitespace-nowrap font-medium" : "whitespace-nowrap text-muted-foreground"}>{s}</span>
              </button>
              {i < steps.length - 1 ? <span aria-hidden className={done ? "h-px w-4 bg-success/50 sm:w-8" : "h-px w-4 bg-border sm:w-8"} /> : null}
            </li>
          );
        })}
      </ol>
      <p className="sr-only">{`${current + 1} / ${steps.length}`}</p>
    </nav>
  );
}
