"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardCheck, ExternalLink } from "lucide-react";
import { AnimatedProgress, LiveDot, TypingText } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { Markdown } from "./markdown";
import { isActive, workPhase } from "./phase";
import { toolStepLabel } from "./tool-labels";

export interface GuideRequestData {
  id: string;
  kind: string;
  stepKey: string | null;
  question: string | null;
  task: {
    id: string;
    title: string;
    status: string;
    output: string | null;
    errorMessage: string | null;
    steps: number;
    currentTool: string | null;
    tools: { tool: string; failed: boolean }[];
  } | null;
  approvals: { id: string; tool: string; summary: string; status: string; risk: string }[];
}

const POLL_MS = 2500;

/** Live view of one guide request's AI task: real status, current step, result, approvals and the next step. */
export function GuideRequestView({ base, requestId, nextHref, nextLabel }: { base: string; requestId: string; nextHref?: string | null; nextLabel?: string | null }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<GuideRequestData | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const d = await api<GuideRequestData>(`${base}/guide/requests/${requestId}`);
        if (stop) return;
        setData(d);
        setError(null);
        if (!d.task || isActive(d.task.status)) timer = window.setTimeout(load, POLL_MS);
      } catch (err) {
        if (stop) return;
        setError(err);
        timer = window.setTimeout(load, POLL_MS * 2);
      }
    };
    void load();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [base, requestId]);

  if (error && !data) return <FormError error={error} />;
  if (!data) return <AnimatedProgress label={t("guide.loading")} size="sm" />;
  const task = data.task;
  if (!task) return <p className="text-sm text-muted-foreground">{t("guide.task.missing")}</p>;
  const phase = workPhase({ status: task.status, trace: task.tools, output: task.output });
  const active = isActive(task.status);

  return (
    <div className="grid gap-3" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {active ? <LiveDot tone="info" /> : null}
        <span className="font-medium">{t(`guide.phase.${phase}`)}</span>
        <Badge tone={task.status === "COMPLETED" ? "success" : task.status === "FAILED" ? "danger" : "neutral"}>{t(`guide.task.status.${task.status}`)}</Badge>
        {task.steps > 0 ? <span className="text-xs text-muted-foreground">{t("guide.task.steps", { count: task.steps })}</span> : null}
      </div>
      {active ? <AnimatedProgress label={t(`guide.phase.${phase}`)} size="sm" active /> : null}
      {task.tools.length ? (
        <ol className="grid gap-1 text-xs text-muted-foreground">
          {task.tools.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span aria-hidden className={s.failed ? "size-1.5 rounded-full bg-danger" : "size-1.5 rounded-full bg-primary"} />
              {i === task.tools.length - 1 && active ? <TypingText text={toolStepLabel(t, s.tool)} speed={18} /> : toolStepLabel(t, s.tool)}
            </li>
          ))}
        </ol>
      ) : null}
      {task.status === "FAILED" ? <p className="text-sm text-danger">{task.errorMessage ?? t("guide.task.failed")}</p> : null}
      {task.output ? (
        <div className="rounded-md border bg-surface-2/60 p-3">
          <Markdown text={task.output} />
          <p className="mt-2 text-[11px] text-muted-foreground">{t("guide.task.review")}</p>
        </div>
      ) : null}
      {data.approvals.length ? (
        <div className="grid gap-1.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold">
            <ClipboardCheck className="size-3.5" aria-hidden />
            {t("guide.task.approvals", { count: data.approvals.length })}
          </p>
          <ul className="grid gap-1">
            {data.approvals.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-2 rounded-md border px-2 py-1.5 text-xs">
                <span className="min-w-0">{a.summary}</span>
                <Badge tone={a.status === "PENDING" ? "warning" : a.status === "EXECUTED" || a.status === "APPROVED" ? "success" : "neutral"}>{t(`guide.approval.${a.status}`)}</Badge>
              </li>
            ))}
          </ul>
          <Link href={`/${locale}/approvals`} className="text-xs font-medium text-primary hover:underline">
            {t("guide.task.reviewApprovals")}
          </Link>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Link href={`/${locale}/tasks/${task.id}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
          {t("guide.task.open")} <ExternalLink className="size-3" aria-hidden />
        </Link>
        {!active && nextHref ? (
          <Link href={`/${locale}${nextHref}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            {t("guide.task.next", { page: nextLabel ?? nextHref })} <ArrowRight className="size-3 rtl:rotate-180" aria-hidden />
          </Link>
        ) : null}
      </div>
    </div>
  );
}
