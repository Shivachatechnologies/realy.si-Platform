"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Hand, Lightbulb, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export const MODES = ["OFF", "MANUAL", "ASSISTED", "APPROVAL_REQUIRED", "AUTONOMOUS"] as const;
export type Mode = (typeof MODES)[number];
const ICONS = { OFF: Ban, MANUAL: Hand, ASSISTED: Lightbulb, APPROVAL_REQUIRED: ShieldCheck, AUTONOMOUS: Sparkles } as const;

export interface WindowValue {
  days: number[];
  from: string | null;
  to: string | null;
}

/**
 * Mode picker for the company or one department: five plain-language modes (plus "same as company" for departments)
 * and an optional schedule window. Posts to the Autopilot API and refreshes the page.
 */
export function ModePicker({
  path,
  department,
  current,
  allowInherit,
  window: initialWindow,
  canManage,
  compact = false,
}: {
  path: string;
  department: string;
  /** The scope's own mode; null = inherits the company's. */
  current: Mode | null;
  allowInherit: boolean;
  window: WindowValue;
  canManage: boolean;
  compact?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const id = useId();
  const [mode, setMode] = useState<Mode | null>(current);
  const [days, setDays] = useState<number[]>(initialWindow.days);
  const [from, setFrom] = useState(initialWindow.from ?? "");
  const [to, setTo] = useState(initialWindow.to ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dirty = mode !== current || days.join(",") !== initialWindow.days.join(",") || (from || null) !== initialWindow.from || (to || null) !== initialWindow.to;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(path, { body: { department, mode, ...(mode ? { windowDays: [...days].sort(), windowFrom: from || null, windowTo: to || null } : {}) } });
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const options: (Mode | null)[] = allowInherit ? [null, ...MODES] : [...MODES];
  return (
    <div className="grid gap-3">
      <div role="radiogroup" aria-label={t("autopilot.company.title")} className={cn("grid gap-2", compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-5")}>
        {options.map((m) => {
          const Icon = m ? ICONS[m] : null;
          const selected = mode === m;
          return (
            <button
              key={m ?? "inherit"}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!canManage || busy}
              onClick={() => setMode(m)}
              className={cn(
                "grid gap-1 rounded-lg border p-3 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed motion-reduce:transition-none",
                selected ? "border-primary bg-primary/8 shadow-elev-1" : "bg-surface hover:bg-surface-2",
                !canManage && !selected ? "opacity-60" : null,
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                {Icon ? <Icon className={cn("size-4 shrink-0", selected ? "text-primary" : "text-muted-foreground")} aria-hidden /> : null}
                {m ? t(`autopilot.modes.${m}`) : t("autopilot.inherit")}
              </span>
              {!compact && m ? <span className="text-xs text-muted-foreground">{t(`autopilot.modeHelp.${m}`)}</span> : null}
            </button>
          );
        })}
      </div>
      {compact && mode ? <p className="text-xs text-muted-foreground">{t(`autopilot.modeHelp.${mode}`)}</p> : null}

      {mode && mode !== "OFF" && mode !== "MANUAL" ? (
        <fieldset className="grid gap-2 rounded-lg border bg-surface-2/50 p-3" disabled={!canManage || busy}>
          <legend className="px-1 text-[13px] font-medium">{t("autopilot.window.title")}</legend>
          <p className="text-xs text-muted-foreground">{t("autopilot.window.hint")}</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("autopilot.window.days")}>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const on = days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDays(on ? days.filter((x) => x !== d) : [...days, d])}
                  className={cn("min-w-11 rounded-md border px-2 py-1 text-xs", on ? "border-primary bg-primary/10 text-primary" : "bg-surface text-muted-foreground")}
                >
                  {t(`autopilot.days.${d}`)}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs" htmlFor={`${id}-from`}>
              {t("autopilot.window.from")}
              <Input id={`${id}-from`} type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="w-32" />
            </label>
            <label className="grid gap-1 text-xs" htmlFor={`${id}-to`}>
              {t("autopilot.window.to")}
              <Input id={`${id}-to`} type="time" value={to} onChange={(e) => setTo(e.target.value)} className="w-32" />
            </label>
            {from || to || days.length ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDays([]);
                  setFrom("");
                  setTo("");
                }}
              >
                {t("autopilot.window.anyTime")}
              </Button>
            ) : null}
          </div>
        </fieldset>
      ) : null}

      {canManage && dirty ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" loading={busy} onClick={() => void save()}>
            {t("autopilot.save")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setMode(current);
              setDays(initialWindow.days);
              setFrom(initialWindow.from ?? "");
              setTo(initialWindow.to ?? "");
            }}
          >
            {t("autopilot.cancel")}
          </Button>
        </div>
      ) : null}
      {error ? <FormError error={error} /> : null}
    </div>
  );
}
