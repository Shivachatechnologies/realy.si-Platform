"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle2, CircleDashed, GitBranch, Loader2, RotateCcw, Square, XCircle } from "lucide-react";
import { LiveDot } from "@/components/motion/live-dot";
import { AiAvatar } from "@/components/workforce/avatar";
import { useI18n } from "@/i18n/client";
import { formatRelativeTime } from "@/i18n/format";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export type LaneStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "WAITING_APPROVAL";

export interface LaneTask {
  id: string;
  title: string;
  status: LaneStatus;
  role: string;
  employee: { id: string; name: string; initials: string; paused: boolean } | null;
  createdAt: string;
  delegated: boolean;
  subject: string | null;
  tokens: number;
}

const LANES = [
  { key: "queued", statuses: ["QUEUED"], icon: CircleDashed, tone: "text-muted-foreground", bar: "bg-muted-foreground/40" },
  { key: "running", statuses: ["RUNNING"], icon: Loader2, tone: "text-info", bar: "bg-info" },
  { key: "done", statuses: ["COMPLETED"], icon: CheckCircle2, tone: "text-success", bar: "bg-success" },
  { key: "failed", statuses: ["FAILED", "CANCELLED"], icon: XCircle, tone: "text-danger", bar: "bg-danger" },
] as const;

const PER_LANE = 12;

/**
 * Mission control board: the company's AI tasks in four live lanes (waiting → working → done / stopped), from their
 * real statuses. Cards glide to their new lane when the page refreshes (static under reduced motion).
 */
export function TaskLanes({ tasks, base, canRun, aiReady, moreHrefs }: { tasks: LaneTask[]; base: string; canRun: boolean; aiReady: boolean; moreHrefs: Record<string, string> }) {
  const { t, locale } = useI18n();
  const reduce = useReducedMotion();
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" role="list" aria-label={t("missionControl.lanes.label")}>
      {LANES.map((lane) => {
        const items = tasks.filter((x) => (lane.statuses as readonly string[]).includes(x.status));
        const Icon = lane.icon;
        return (
          <section key={lane.key} role="listitem" aria-label={t(`missionControl.lanes.${lane.key}`)} className="grid min-w-0 content-start gap-2 rounded-lg border bg-surface-2/50 p-2">
            <header className="flex items-center gap-2 px-1 pt-1">
              <Icon aria-hidden className={cn("size-4", lane.tone, lane.key === "running" && items.length && !reduce && "animate-spin")} />
              <h3 className="text-sm font-semibold">{t(`missionControl.lanes.${lane.key}`)}</h3>
              {lane.key === "running" && items.length ? <LiveDot tone="info" /> : null}
              <span className="ms-auto rounded-full bg-surface px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{items.length}</span>
            </header>
            <p className="px-1 text-[11px] text-muted-foreground">{t(`missionControl.lanes.${lane.key}Hint`)}</p>
            <ul className="grid gap-2">
              <AnimatePresence initial={false}>
                {items.slice(0, PER_LANE).map((x) => (
                  <motion.li
                    key={x.id}
                    layout={!reduce}
                    layoutId={reduce ? undefined : `task-${x.id}`}
                    initial={reduce ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0, scale: 0.97 }}
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  >
                    <LaneCard task={x} bar={lane.bar} locale={locale} base={base} canRun={canRun} aiReady={aiReady} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
            {items.length === 0 ? <p className="rounded-md border border-dashed px-2 py-4 text-center text-xs text-muted-foreground">{t(`missionControl.lanes.${lane.key}Empty`)}</p> : null}
            {items.length > PER_LANE ? (
              <Link href={moreHrefs[lane.statuses[0]] ?? "#"} className="px-1 text-xs text-primary hover:underline">
                {t("missionControl.lanes.more", { count: items.length - PER_LANE })}
              </Link>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function LaneCard({ task: x, bar, locale, base, canRun, aiReady }: { task: LaneTask; bar: string; locale: string; base: string; canRun: boolean; aiReady: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const active = x.status === "QUEUED" || x.status === "RUNNING";
  const stopped = x.status === "FAILED" || x.status === "CANCELLED";
  async function act(action: "cancel" | "retry") {
    if (action === "cancel" && !window.confirm(t("agentTasks.confirmCancel"))) return;
    setBusy(true);
    try {
      await api(`${base}/tasks/${x.id}/${action}`, { method: "POST" });
    } catch {
      /* the detail page shows the reason */
    } finally {
      setBusy(false);
      router.refresh();
    }
  }
  return (
    <div className="hover-lift relative overflow-hidden rounded-md border bg-surface p-2.5 text-sm shadow-elev-1">
      <span aria-hidden className={cn("absolute inset-y-0 start-0 w-0.5", bar, x.status === "RUNNING" && "animate-pulse")} />
      <div className="flex items-start gap-2">
        {x.employee ? <AiAvatar id={x.employee.id} initials={x.employee.initials} size="sm" paused={x.employee.paused} working={x.status === "RUNNING"} /> : null}
        <div className="grid min-w-0 flex-1 gap-0.5">
          <Link href={`/${locale}/tasks/${x.id}`} className="line-clamp-2 font-medium hover:underline">
            {x.title}
          </Link>
          <span className="truncate text-xs text-muted-foreground">{x.employee ? `${x.employee.name} · ${x.role}` : x.role}</span>
          <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <time dateTime={x.createdAt}>{formatRelativeTime(x.createdAt, locale)}</time>
            {x.delegated ? (
              <span className="inline-flex items-center gap-0.5">
                <GitBranch className="size-3" aria-hidden />
                {t("workforce.queue.delegated")}
              </span>
            ) : null}
            {x.subject ? <span className="rounded bg-muted px-1">{x.subject}</span> : null}
          </span>
        </div>
      </div>
      {canRun && (active || (stopped && aiReady)) ? (
        <div className="mt-1.5 flex justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={() => act(active ? "cancel" : "retry")}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {active ? <Square className="size-3" aria-hidden /> : <RotateCcw className="size-3" aria-hidden />}
            {active ? t("agentTasks.cancel") : t("agentTasks.retry")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
