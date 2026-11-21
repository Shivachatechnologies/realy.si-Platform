"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, ExternalLink, LifeBuoy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SystemPulse } from "@/components/motion/system-pulse";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** Client building blocks of the guided journeys (Sales OS and Finance OS). */

export type TaskStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export interface TaskView {
  id: string;
  status: TaskStatus;
  title?: string;
  output: string | null;
}

const TONE = { QUEUED: "neutral", RUNNING: "accent", COMPLETED: "success", FAILED: "danger", CANCELLED: "neutral" } as const;
export const isActive = (s?: TaskStatus | null) => s === "QUEUED" || s === "RUNNING";

/** A real agent task: live status, the deliverable once it exists, and a link to the full task. Never invents output. */
export function AiTaskCard({ task, locale, maxChars = 1600, className }: { task: TaskView | null | undefined; locale: string; maxChars?: number; className?: string }) {
  const t = useT();
  if (!task) return null;
  const running = isActive(task.status);
  return (
    <div className={cn("grid gap-2 rounded-md border bg-surface-2/60 p-3 text-sm", running && "shimmer", className)} aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE[task.status]} pulse={running}>
          {t(`agentTasks.status.${task.status}`)}
        </Badge>
        {running ? <SystemPulse active label={t("crm.guided.aiWorking")} /> : null}
        <Link href={`/${locale}/tasks/${task.id}`} className="ms-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
          {t("crm.guided.openTask")}
          <ExternalLink aria-hidden className="size-3" />
        </Link>
      </div>
      {task.output ? (
        <p className="whitespace-pre-wrap break-words">
          {task.output.length > maxChars ? `${task.output.slice(0, maxChars)}…` : task.output}
        </p>
      ) : task.status === "FAILED" ? (
        <p className="text-danger">{t("crm.guided.aiFailed")}</p>
      ) : running ? (
        <p className="text-muted-foreground">{t("crm.guided.aiWait")}</p>
      ) : null}
    </div>
  );
}

/** Polls one task until it finishes (used where the page itself doesn't refresh). */
export function useTaskPoll(base: string, taskId: string | null) {
  const [task, setTask] = useState<TaskView | null>(null);
  useEffect(() => {
    if (!taskId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = await api<TaskView>(`${base}/tasks/${taskId}`);
        if (stop) return;
        setTask(r);
        if (isActive(r.status)) timer = setTimeout(tick, 3000);
      } catch {
        if (!stop) timer = setTimeout(tick, 6000);
      }
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [base, taskId]);
  return task;
}

/**
 * "Help me do this": creates an AI task (right profile, linked to the record/page) through `url` with `body`, then shows
 * its real progress and result inline. `base` is the company API base (for polling the task).
 */
export function HelpMeButton({ base, url, body, locale, label, withQuestion = true }: { base: string; url: string; body: Record<string, unknown>; locale: string; label?: string; withQuestion?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const task = useTaskPoll(base, taskId);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>(url, { body: { ...body, ...(request.trim() ? { request: request.trim() } : {}), locale } });
      setTaskId(r.id);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="relative">
      <Button type="button" size="sm" variant="soft" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <LifeBuoy aria-hidden />
        {label ?? t("crm.guided.helpMe")}
      </Button>
      {open ? (
        <div className="absolute end-0 top-full z-30 mt-2 grid w-[min(92vw,26rem)] gap-2 rounded-lg border bg-surface p-3 shadow-elev-2 animate-fade-up">
          <p className="text-sm font-medium">{t("crm.guided.helpTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("crm.guided.helpHint")}</p>
          {!taskId ? (
            <>
              {withQuestion ? (
                <Input aria-label={t("crm.guided.helpQuestion")} placeholder={t("crm.guided.helpQuestion")} value={request} maxLength={1000} onChange={(e) => setRequest(e.target.value)} />
              ) : null}
              <Button type="button" size="sm" loading={busy} onClick={() => void start()}>
                {t("crm.guided.helpStart")}
              </Button>
            </>
          ) : (
            <AiTaskCard task={task ?? { id: taskId, status: "QUEUED", output: null }} locale={locale} maxChars={1200} />
          )}
          {task?.status === "COMPLETED" ? <p className="text-xs text-muted-foreground">{t("crm.guided.helpNext")}</p> : null}
          <FormError error={error} />
        </div>
      ) : null}
    </div>
  );
}

/** Horizontal progress indicator; finished steps are clickable (go back), the current one is highlighted. */
export function Stepper({ steps, current, done, onSelect, label }: { steps: string[]; current: number; done: (i: number) => boolean; onSelect?: (i: number) => void; label: string }) {
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto px-1">
      <ol className="flex min-w-max items-center gap-1">
        {steps.map((s, i) => {
          const isDone = done(i);
          const isCurrent = i === current;
          const clickable = !!onSelect && (isDone || i <= current);
          return (
            <li key={s} className="flex items-center gap-1">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => onSelect?.(i)}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  isCurrent ? "border-primary bg-primary text-primary-foreground shadow-glow" : isDone ? "border-success/40 bg-success/10 text-success" : "text-muted-foreground",
                  clickable && !isCurrent && "hover:border-border-strong",
                )}
              >
                <span className={cn("grid size-4 place-items-center rounded-full text-[10px] font-semibold", isCurrent ? "bg-primary-foreground/20" : "bg-muted")}>
                  {isDone && !isCurrent ? <Check aria-hidden className="size-3" /> : i + 1}
                </span>
                <span className="whitespace-nowrap">{s}</span>
              </button>
              {i < steps.length - 1 ? <span aria-hidden className={cn("h-px w-4", isDone ? "bg-success/50" : "bg-border")} /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** A selectable answer card (radio semantics) with an optional "Recommended" marker. */
export function ChoiceCard({ name, value, checked, onChange, title, description, recommended, recommendedLabel, children }: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (v: string) => void;
  title: string;
  description?: string;
  recommended?: boolean;
  recommendedLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <label className={cn("hover-lift relative grid cursor-pointer gap-1 rounded-lg border p-3 text-sm transition-colors", checked ? "border-primary bg-primary/5 shadow-glow" : "bg-surface hover:border-border-strong")}>
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} className="sr-only" />
      <span className="flex items-center gap-2 font-medium">
        <span aria-hidden className={cn("grid size-4 place-items-center rounded-full border", checked ? "border-primary bg-primary" : "")}>
          {checked ? <span className="size-1.5 rounded-full bg-primary-foreground" /> : null}
        </span>
        {title}
        {recommended ? (
          <Badge tone="brand" shape="pill" className="ms-auto">
            {recommendedLabel}
          </Badge>
        ) : null}
      </span>
      {description ? <span className="text-muted-foreground">{description}</span> : null}
      {children}
    </label>
  );
}
