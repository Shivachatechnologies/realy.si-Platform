"use client";

import Link from "next/link";
import { useState } from "react";
import { ExternalLink, LifeBuoy, RotateCcw, Sparkles } from "lucide-react";
import { FormError } from "@/components/form-error";
import { AnimatedProgress } from "@/components/motion/animated-progress";
import { LiveDot } from "@/components/motion/live-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { isActive, useAgentTask, type LiveTask } from "./use-agent-task";

export interface HelpMeProps {
  /** Company API prefix: /api/v1/organizations/:org/companies/:company */
  base: string;
  /** AI employee role profile that does the work (e.g. "recruiter", "ai_project_manager"). */
  profile: string;
  /** The record or page the help is about (shown on that record's AI history). */
  subject: { type: string; id: string };
  title: string;
  /** Page context and what to do — the AI only acts through its tools and proposals need approval. */
  instructions: string;
  /** The latest earlier help task for this subject, so a reload shows its progress and result. */
  initial?: LiveTask | null;
  aiReady: boolean;
  label?: string;
  /** Suggested next step once the AI has finished. */
  nextHint?: string;
  variant?: "default" | "secondary";
  className?: string;
}

/**
 * "Help me do this": creates a real AI task with the page context, then follows it live (status, output) and suggests
 * the next step. Nothing is faked: without an AI provider it says so; failures are shown with a retry.
 */
export function HelpMeButton({ base, profile, subject, title, instructions, initial = null, aiReady, label, nextHint, variant = "secondary", className }: HelpMeProps) {
  const { t, locale } = useI18n();
  const { task, track, pollError } = useAgentTask(base, initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [details, setDetails] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const extra = details.trim() ? `\n\nThe person added: ${details.trim().slice(0, 1500)}` : "";
      const created = await api<LiveTask>(`${base}/tasks`, { method: "POST", body: { profile, subject, title: title.slice(0, 200), instructions: `${instructions}${extra}`.slice(0, 8000) } });
      track({ id: created.id, title: created.title, status: created.status, output: null });
      setShowDetails(false);
      setDetails("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!aiReady) {
    return (
      <span className={cn("inline-flex", className)} title={t("guideKit.help.notConfigured")}>
        <Button type="button" variant={variant} size="sm" disabled>
          <LifeBuoy aria-hidden /> {label ?? t("guideKit.help.label")}
        </Button>
      </span>
    );
  }

  const running = isActive(task?.status);
  const output = task?.output ?? "";
  const long = output.length > 700;
  return (
    <div className={cn("grid min-w-0 gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant={variant} size="sm" onClick={start} disabled={busy || running} aria-busy={busy || running}>
          <Sparkles aria-hidden /> {task && !running ? t("guideKit.help.again") : (label ?? t("guideKit.help.label"))}
        </Button>
        {!running ? (
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground hover:underline" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)}>
            {t("guideKit.help.addDetails")}
          </button>
        ) : null}
      </div>
      {showDetails && !running ? (
        <Textarea rows={2} maxLength={1500} value={details} onChange={(e) => setDetails(e.target.value)} placeholder={t("guideKit.help.detailsPlaceholder")} aria-label={t("guideKit.help.addDetails")} className="max-w-xl" />
      ) : null}
      <FormError error={error} />
      {task ? (
        <div className="grid max-w-3xl gap-2 rounded-md border bg-surface-2/60 p-3 text-sm" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            {running ? <LiveDot tone="primary" /> : null}
            <Badge tone={task.status === "COMPLETED" ? "success" : task.status === "FAILED" ? "danger" : running ? "info" : "neutral"}>{t(`guideKit.help.status.${task.status}`)}</Badge>
            <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
            <Link href={`/${locale}/tasks/${task.id}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              {t("guideKit.help.open")} <ExternalLink className="size-3" aria-hidden />
            </Link>
          </div>
          {running ? (
            <div className="grid gap-1">
              <AnimatedProgress label={t("guideKit.help.working")} active />
              <p className="text-xs text-muted-foreground">{t(task.status === "QUEUED" ? "guideKit.help.queued" : "guideKit.help.working")}</p>
            </div>
          ) : null}
          {pollError ? <p className="text-xs text-warning">{t("guideKit.help.pollError")}</p> : null}
          {task.status === "COMPLETED" && output ? (
            <>
              <div className={cn("overflow-hidden whitespace-pre-wrap rounded bg-surface p-2 text-sm", !expanded && long && "max-h-48")}>{output}</div>
              {long ? (
                <button type="button" className="justify-self-start text-xs text-primary hover:underline" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? t("guideKit.help.less") : t("guideKit.help.more")}
                </button>
              ) : null}
              <Notice tone="info">
                {nextHint ?? t("guideKit.help.next")}{" "}
                <Link href={`/${locale}/approvals`} className="font-medium underline">
                  {t("guideKit.help.approvals")}
                </Link>
              </Notice>
            </>
          ) : null}
          {task.status === "FAILED" || task.status === "CANCELLED" ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-danger">
              <span>{task.errorMessage || t("guideKit.help.failed")}</span>
              <Button type="button" size="sm" variant="ghost" onClick={start} disabled={busy}>
                <RotateCcw aria-hidden /> {t("guideKit.help.retry")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
