import Link from "next/link";
import type { ReactNode } from "react";
import { BookOpen, CheckCircle2, CircleDashed, FilePen, GitBranch, Inbox, LineChart, Loader2, Play, Search, Send, ShieldQuestion, Wrench, XCircle } from "lucide-react";
import { toolStepLabel, toolVerb } from "@/components/guide/tool-labels";
import { formatDateTime } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import type { ToolCallRecord } from "@/server/modules/agents/runtime";

const VERB_ICON: Record<ReturnType<typeof toolVerb>, ReactNode> = {
  read: <BookOpen />,
  search: <Search />,
  draft: <FilePen />,
  change: <Wrench />,
  send: <Send />,
  delegate: <GitBranch />,
  analyze: <LineChart />,
  other: <Wrench />,
};

interface Step {
  key: string;
  icon: ReactNode;
  tone: "neutral" | "info" | "success" | "danger" | "warning" | "primary";
  title: ReactNode;
  detail?: ReactNode;
  at?: Date | null;
}

const TONE = {
  neutral: "border-border bg-surface text-muted-foreground",
  info: "border-info/40 bg-info/10 text-info",
  success: "border-success/40 bg-success/10 text-success",
  danger: "border-danger/40 bg-danger/10 text-danger",
  warning: "border-warning/40 bg-warning/10 text-warning",
  primary: "border-primary/40 bg-primary/10 text-primary",
};

/**
 * What the AI did, step by step, from the task's real trace: created → picked up → each tool call in plain words
 * (with results, failures and approval requests) → finished.
 */
export function ExecutionTimeline({
  task,
  calls,
  t,
  locale,
  timeZone,
  createdBy,
}: {
  task: { status: string; createdAt: Date; startedAt: Date | null; completedAt: Date | null; errorMessage: string | null; errorCode: string | null; attempts: number };
  calls: ToolCallRecord[];
  t: Translate;
  locale: string;
  timeZone: string;
  createdBy: string;
}) {
  const steps: Step[] = [{ key: "created", icon: <Inbox />, tone: "neutral", title: t("missionControl.timeline.created", { who: createdBy }), at: task.createdAt }];
  if (task.startedAt) steps.push({ key: "started", icon: <Play />, tone: "info", title: t("missionControl.timeline.started"), detail: task.attempts > 1 ? t("agentTasks.attempts", { count: task.attempts }) : undefined, at: task.startedAt });
  calls.forEach((c, i) => {
    const label = toolStepLabel(t, c.tool);
    if (c.error) {
      steps.push({ key: `c${i}`, icon: <XCircle />, tone: "danger", title: label, detail: t("missionControl.timeline.toolFailed", { error: c.error }) });
    } else if (c.approvalId) {
      steps.push({
        key: `c${i}`,
        icon: <ShieldQuestion />,
        tone: "warning",
        title: label,
        detail: (
          <Link href={`/${locale}/approvals#pending`} className="text-primary hover:underline">
            {t("missionControl.timeline.askedApproval")}
          </Link>
        ),
      });
    } else {
      const query = typeof c.input.query === "string" ? c.input.query : null;
      steps.push({
        key: `c${i}`,
        icon: VERB_ICON[toolVerb(c.tool)],
        tone: toolVerb(c.tool) === "delegate" ? "primary" : "neutral",
        title: label,
        detail: [query ? `“${query}”` : null, t("missionControl.timeline.results", { count: c.results })].filter(Boolean).join(" · "),
      });
    }
  });
  if (task.status === "RUNNING") steps.push({ key: "working", icon: <Loader2 className="animate-spin motion-reduce:animate-none" />, tone: "info", title: t("missionControl.timeline.working") });
  if (task.status === "QUEUED") steps.push({ key: "waiting", icon: <CircleDashed />, tone: "neutral", title: t("missionControl.timeline.waiting") });
  if (task.status === "COMPLETED") steps.push({ key: "done", icon: <CheckCircle2 />, tone: "success", title: t("missionControl.timeline.done"), at: task.completedAt });
  if (task.status === "FAILED") steps.push({ key: "failed", icon: <XCircle />, tone: "danger", title: t("missionControl.timeline.failed"), detail: task.errorMessage ?? task.errorCode ?? undefined, at: task.completedAt });
  if (task.status === "CANCELLED") steps.push({ key: "cancelled", icon: <XCircle />, tone: "neutral", title: t("missionControl.timeline.cancelled"), at: task.completedAt });

  return (
    <ol className="relative grid gap-0" aria-label={t("missionControl.timeline.title")}>
      {steps.map((s, i) => (
        <li key={s.key} className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-4 last:pb-0" style={{ "--i": i } as React.CSSProperties}>
          {i < steps.length - 1 ? <span aria-hidden className="absolute start-4 top-8 bottom-0 w-px -translate-x-1/2 bg-border rtl:translate-x-1/2" /> : null}
          <span aria-hidden className={cn("relative z-[1] grid size-8 place-items-center rounded-full border [&_svg]:size-4", TONE[s.tone])}>
            {s.icon}
          </span>
          <div className="grid min-w-0 gap-0.5 pt-1 animate-fade-up">
            <p className="text-sm font-medium">{s.title}</p>
            {s.detail ? <p className="break-words text-xs text-muted-foreground">{s.detail}</p> : null}
            {s.at ? <time className="text-[11px] text-muted-foreground" dateTime={s.at.toISOString()}>{formatDateTime(s.at, locale, timeZone)}</time> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
