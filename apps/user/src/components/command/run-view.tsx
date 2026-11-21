"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Check, ChevronDown, ClipboardCheck, Crown, ExternalLink, RotateCcw, Search, Square } from "lucide-react";
import { AnimatedProgress, LiveDot, TypingText } from "@/components/motion";
import { AiAvatar } from "@/components/graphics/ai-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useErrorMessage } from "@/components/form-error";
import { Markdown } from "@/components/guide/markdown";
import { isActive, workPhase } from "@/components/guide/phase";
import { toolStepLabel, toolVerb } from "@/components/guide/tool-labels";
import { useI18n } from "@/i18n/client";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { CommandSessionView } from "@/server/modules/guide/command";
import { StageRail, type StageKey } from "./stage-rail";

export type RunView = CommandSessionView["runs"][number];
type StepView = RunView["steps"][number];
type TaskView = NonNullable<StepView["task"]>;
type Decide = (approvalId: string, decision: "approve" | "reject") => Promise<void>;
type Retry = (runId: string, stepId: string) => Promise<void>;

const stepState = (s: StepView) => (s.task ? s.task.status : s.status);
const tone = (state: string) => (state === "COMPLETED" ? "success" : state === "FAILED" || state === "BLOCKED" ? "danger" : state === "QUEUED" || state === "RUNNING" ? "info" : "neutral") as "success" | "danger" | "info" | "neutral";

/** One command and everything that happened to it, from the persisted run. */
export function CommandRunCard({
  run,
  canDecide,
  onDecide,
  onCancel,
  onFollowUp,
  onRetry,
}: {
  run: RunView;
  canDecide: boolean;
  onDecide: Decide;
  onCancel: (runId: string) => Promise<void>;
  onFollowUp: (text: string, parentRunId: string) => void;
  onRetry?: Retry;
}) {
  const { t, locale } = useI18n();
  const [cancelling, setCancelling] = useState(false);
  const open = run.status === "PLANNED" || run.status === "RUNNING" || run.status === "REVIEWING";
  const work = run.steps.filter((s) => s.kind !== "REVIEW");
  const review = run.steps.find((s) => s.kind === "REVIEW");
  const approvals = run.steps.flatMap((s) => [...(s.task?.approvals ?? []), ...s.children.flatMap((c) => c.approvals)]);
  const pending = approvals.filter((a) => a.status === "PENDING").length;
  const delegated = run.steps.filter((s) => s.status === "DELEGATED").length;
  const done = work.filter((s) => stepState(s) === "COMPLETED").length;
  const details: Partial<Record<StageKey, string>> = {
    understanding: t("command.ai.detail.understanding", { count: run.understanding.intents.length }),
    planning: t("command.ai.detail.planning", { count: run.steps.length }),
    delegation: t("command.ai.detail.delegation", { done: delegated, total: run.steps.length }),
    execution: t("command.ai.detail.execution", { done, total: work.length }),
    review: pending ? t("command.ai.detail.approvals", { count: pending }) : undefined,
  };
  const result = review?.task?.output ?? (work.length === 1 ? work[0]!.task?.output : null) ?? null;

  return (
    <section className="grid gap-4" aria-label={run.text}>
      <div className="ms-auto max-w-[88%] rounded-2xl rounded-ee-sm bg-brand-gradient px-4 py-2.5 text-sm text-primary-foreground shadow-glow animate-fade-up">{run.text}</div>
      <article className={cn("relative overflow-hidden rounded-2xl border bg-surface/80 p-4 shadow-elev-1 backdrop-blur sm:p-5", open && "border-gradient shadow-glow")}>
        <header className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone={run.status === "COMPLETED" ? "success" : run.status === "FAILED" ? "danger" : run.status === "CANCELLED" ? "neutral" : "info"}>{t(`command.ai.runStatus.${run.status}`)}</Badge>
          {run.origin === "CEO" ? (
            <Badge tone="accent">
              <Crown className="me-1 inline size-3" aria-hidden />
              {t("command.ai.fromCeo")}
            </Badge>
          ) : null}
          {open ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <LiveDot tone="info" />
              {t("command.ai.live")}
            </span>
          ) : null}
          {open ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ms-auto"
              loading={cancelling}
              onClick={async () => {
                setCancelling(true);
                await onCancel(run.id);
                setCancelling(false);
              }}
            >
              <Square aria-hidden />
              {t("command.ai.cancel")}
            </Button>
          ) : null}
        </header>
        <StageRail stages={run.stages} details={details} />

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]">
          <Understanding run={run} />
          <PlanGraph run={run} />
        </div>

        <ol className="mt-5 grid gap-3">
          {run.steps.map((s) => (
            <li key={s.id}>
              <StepCard step={s} run={run} canDecide={canDecide} onDecide={onDecide} onRetry={onRetry} />
            </li>
          ))}
        </ol>

        {result && run.status === "COMPLETED" ? (
          <div className="mt-5 rounded-xl border bg-surface-2/60 p-4 animate-fade-in">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("command.ai.result")}</p>
            <Markdown text={result} />
            <p className="mt-3 text-[11px] text-muted-foreground">{t("guide.task.review")}</p>
            {run.documentId ? (
              <Link href={`/${locale}/brain/${run.documentId}`} className="mt-2 inline-flex min-h-9 items-center gap-1 text-xs font-medium text-primary hover:underline">
                <BookOpen className="size-3.5" aria-hidden />
                {t("command.ai.savedToBrain")}
              </Link>
            ) : run.documentError ? (
              <p className="mt-2 text-[11px] text-muted-foreground">{t("command.ai.notSavedToBrain")}</p>
            ) : null}
          </div>
        ) : null}
        {run.status === "COMPLETED" && run.nextAction ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-primary">{t("command.ai.nextAction")}</span>
            <span className="min-w-0 flex-1 text-sm">{run.nextAction}</span>
            <Button type="button" size="sm" onClick={() => onFollowUp(run.nextAction!, run.id)}>
              {t("command.ai.runNext")}
              <ArrowRight aria-hidden className="rtl:-scale-x-100" />
            </Button>
          </div>
        ) : null}
        {run.status === "FAILED" ? <p className="mt-4 text-sm text-danger">{t("command.ai.failed")}</p> : null}
      </article>
    </section>
  );
}

function Understanding({ run }: { run: RunView }) {
  const { t, locale } = useI18n();
  const u = run.understanding;
  const facts = Object.entries(u.facts);
  return (
    <div className="grid content-start gap-3 rounded-xl border bg-surface p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("command.ai.understood")}</p>
      <ul className="flex flex-wrap gap-1.5">
        {u.intents.map((i) => (
          <li key={i.key}>
            <Badge tone="accent">{t(`guide.command.intents.${i.key}`)}</Badge>
          </li>
        ))}
        {u.research ? (
          <li>
            <Badge tone="info">
              <Search className="me-1 inline size-3" aria-hidden />
              {t("command.ai.researchFirst")}
            </Badge>
          </li>
        ) : null}
      </ul>
      <p className="text-xs text-muted-foreground">{facts.length ? t("command.ai.factsUsed", { count: facts.length }) : t("command.ai.noFacts")}</p>
      {u.sources.length ? (
        <div className="grid gap-1">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <BookOpen className="size-3.5" aria-hidden />
            {t("command.ai.knowledgeUsed", { count: u.sources.length })}
          </p>
          <ul className="grid gap-0.5">
            {u.sources.slice(0, 6).map((s) => (
              <li key={s.ref} className="truncate text-xs">
                <span className="me-1 font-mono text-[10px] text-muted-foreground">[{s.ref}]</span>
                <Link href={`/${locale}${s.href}`} className="hover:underline">
                  {s.title}
                </Link>
                {s.passage ? <span className="text-muted-foreground"> · {t("brain.passage", { n: s.passage })}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("command.ai.noKnowledge")}</p>
      )}
    </div>
  );
}

/** The plan as a dependency graph: research → departments → review, coloured by each step's real state. */
function PlanGraph({ run }: { run: RunView }) {
  const { t } = useI18n();
  const cols = [run.steps.filter((s) => s.kind === "RESEARCH"), run.steps.filter((s) => s.kind === "DEPARTMENT"), run.steps.filter((s) => s.kind === "REVIEW")].filter((c) => c.length);
  const W = 360;
  const rowH = 44;
  const H = Math.max(96, Math.max(...cols.map((c) => c.length)) * rowH + 16);
  const pos = new Map<number, { x: number; y: number }>();
  cols.forEach((c, ci) => {
    const x = cols.length === 1 ? W / 2 : 40 + (ci * (W - 80)) / (cols.length - 1);
    c.forEach((s, ri) => pos.set(s.position, { x, y: H / 2 + (ri - (c.length - 1) / 2) * rowH }));
  });
  const colour = (s: StepView) => {
    const st = stepState(s);
    return st === "COMPLETED" ? "var(--success)" : st === "FAILED" || st === "BLOCKED" ? "var(--danger)" : st === "SKIPPED" || st === "CANCELLED" || st === "WAITING" ? "var(--border-strong, var(--border))" : "var(--primary)";
  };
  const summary = run.steps.map((s) => `${s.title}: ${t(`command.ai.stepState.${stepState(s)}`)}`).join(", ");
  return (
    <figure className="grid content-start gap-2 rounded-xl border bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--primary)_7%,var(--surface)),var(--surface)_75%)] p-3">
      <figcaption className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("command.ai.plan")}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("command.ai.planAria", { summary })} className="h-auto w-full">
        {run.steps.flatMap((s) =>
          s.dependsOn.map((d) => {
            const a = pos.get(d);
            const b = pos.get(s.position);
            if (!a || !b) return null;
            const live = isActive(stepState(s));
            const mx = (a.x + b.x) / 2;
            return (
              <path
                key={`${d}-${s.position}`}
                d={`M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`}
                fill="none"
                stroke={colour(s)}
                strokeOpacity={live ? 0.9 : 0.45}
                strokeWidth={live ? 1.6 : 1}
                strokeDasharray={live ? "4 4" : undefined}
                className={live ? "motion-safe:animate-[cmd-dash_1.2s_linear_infinite]" : undefined}
              />
            );
          }),
        )}
        {run.steps.map((s) => {
          const p = pos.get(s.position)!;
          const live = isActive(stepState(s));
          return (
            <g key={s.id}>
              {live ? <circle cx={p.x} cy={p.y} r={19} fill="none" stroke="var(--primary)" strokeOpacity="0.35" className="core-breathe" /> : null}
              <circle cx={p.x} cy={p.y} r={14} fill="var(--surface)" stroke={colour(s)} strokeWidth="1.8" />
              <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="9" fontWeight={700} fill="var(--foreground)">
                {s.position + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <style>{`@keyframes cmd-dash { to { stroke-dashoffset: -16; } }`}</style>
    </figure>
  );
}

function StepCard({ step, run, canDecide, onDecide, onRetry }: { step: StepView; run: RunView; canDecide: boolean; onDecide: Decide; onRetry?: Retry }) {
  const { t, locale } = useI18n();
  const [retrying, setRetrying] = useState(false);
  const errorText = useErrorMessage();
  const [expanded, setExpanded] = useState(false);
  const task = step.task;
  const st = stepState(step);
  const running = isActive(st);
  const name = task?.employeeName ?? t(`profiles.${step.profile}.name`);
  const deps = run.steps.filter((d) => step.dependsOn.includes(d.position));
  return (
    <div className={cn("rounded-xl border bg-surface p-3 sm:p-4", running && "border-primary/40")}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-xs text-muted-foreground">{String(step.position + 1).padStart(2, "0")}</span>
        <AiAvatar seed={task?.employeeName ?? step.profile} department={step.profile} size={32} active={running} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{step.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {name} · {t(`command.ai.kind.${step.kind}`)}
          </p>
        </div>
        <Badge tone={tone(st)}>{task ? t(`guide.phase.${workPhase(task, step.children)}`) : t(`command.ai.stepState.${st}`)}</Badge>
      </div>

      {step.status === "WAITING" && deps.length ? <p className="mt-2 text-xs text-muted-foreground">{t("command.ai.waitingFor", { steps: deps.map((d) => d.position + 1).join(", ") })}</p> : null}
      {step.status === "BLOCKED" ? <p className="mt-2 text-sm text-danger">{errorText(new ApiError(step.errorReason ?? "internal_error", step.errorReason ?? "internal_error", { reason: step.errorReason ?? "internal_error" }))}</p> : null}
      {step.status === "SKIPPED" ? <p className="mt-2 text-xs text-muted-foreground">{t("command.ai.skipped")}</p> : null}
      {step.canRetry && onRetry ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={retrying}
            onClick={async () => {
              setRetrying(true);
              await onRetry(run.id, step.id);
              setRetrying(false);
            }}
          >
            <RotateCcw aria-hidden />
            {t("command.ai.retryStep")}
          </Button>
          {step.attempts ? <span className="text-xs text-muted-foreground">{t("command.ai.attempts", { count: step.attempts })}</span> : null}
        </div>
      ) : null}

      {task ? (
        <>
          {running ? <AnimatedProgress className="mt-3" label={t(`guide.phase.${workPhase(task, step.children)}`)} size="sm" active /> : null}
          <Trace task={task} running={running} />
          {step.children.length ? (
            <ul className="mt-3 grid gap-1">
              <li className="text-xs font-semibold">{t("guide.command.collaborators")}</li>
              {step.children.map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
                  {isActive(c.status) ? <LiveDot tone="info" /> : <Check className="size-3 text-success" aria-hidden />}
                  <span className="font-medium">{c.employeeName ?? t(`profiles.${c.profile}.name`)}</span>
                  <span className="text-muted-foreground">· {t(`guide.phase.${workPhase(c)}`)}</span>
                  <Link href={`/${locale}/tasks/${c.id}`} className="ms-auto text-primary hover:underline">
                    {t("guide.task.open")}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <Approvals list={[...task.approvals, ...step.children.flatMap((c) => c.approvals)]} canDecide={canDecide} onDecide={onDecide} />
          {task.status === "FAILED" ? <p className="mt-3 text-sm text-danger">{task.errorMessage ?? t("guide.task.failed")}</p> : null}
          {task.output && step.kind !== "REVIEW" ? (
            <div className="mt-3">
              <button type="button" onClick={() => setExpanded((v) => !v)} className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-primary" aria-expanded={expanded}>
                <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden />
                {t(expanded ? "command.ai.hideResult" : "command.ai.showResult")}
              </button>
              {expanded ? (
                <div className="mt-2 rounded-lg border bg-surface-2/60 p-3 animate-fade-in">
                  <Markdown text={task.output} />
                </div>
              ) : null}
            </div>
          ) : null}
          <Link href={`/${locale}/tasks/${task.id}`} className="mt-2 inline-flex min-h-9 items-center gap-1 text-xs font-medium text-primary hover:underline">
            {t("guide.task.open")} <ExternalLink className="size-3" aria-hidden />
          </Link>
        </>
      ) : null}
    </div>
  );
}

function Trace({ task, running }: { task: TaskView; running: boolean }) {
  const { t } = useI18n();
  if (!task.trace.length) {
    return running ? (
      <p className="mt-3 text-xs text-muted-foreground">
        <TypingText text={t(task.status === "QUEUED" ? "guide.command.queued" : "guide.command.thinking")} speed={20} />
      </p>
    ) : null;
  }
  return (
    <ol className="mt-3 grid gap-1.5 border-s ps-3">
      {task.trace.slice(-8).map((s, i, arr) => {
        const latest = i === arr.length - 1 && running;
        return (
          <li key={i} className={cn("relative text-xs", latest ? "text-foreground" : "text-muted-foreground")}>
            <span aria-hidden className={cn("absolute -start-[17px] top-1 size-2 rounded-full", s.failed ? "bg-danger" : toolVerb(s.tool) === "delegate" ? "bg-primary-2" : "bg-primary")} />
            {latest ? <TypingText text={toolStepLabel(t, s.tool)} speed={16} /> : toolStepLabel(t, s.tool)}
            {s.failed ? <span className="ms-1 text-danger">· {t("guide.command.stepFailed")}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function Approvals({ list, canDecide, onDecide }: { list: TaskView["approvals"]; canDecide: boolean; onDecide: Decide }) {
  const { t, locale } = useI18n();
  const [pending, setPending] = useState<string | null>(null);
  if (!list.length) return null;
  const act = async (id: string, d: "approve" | "reject") => {
    setPending(`${id}:${d}`);
    await onDecide(id, d);
    setPending(null);
  };
  return (
    <div className="mt-3 grid gap-1.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <ClipboardCheck className="size-3.5" aria-hidden />
        {t("guide.task.approvals", { count: list.length })}
      </p>
      <ul className="grid gap-1.5">
        {list.map((a) => (
          <li key={a.id} className="grid gap-2 rounded-md border bg-surface px-3 py-2 text-xs sm:flex sm:items-center sm:justify-between">
            <span className="min-w-0">{a.summary}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              {a.status === "PENDING" && canDecide ? (
                <>
                  <Button type="button" size="sm" loading={pending === `${a.id}:approve`} onClick={() => void act(a.id, "approve")}>
                    {t("guide.command.approve")}
                  </Button>
                  <Button type="button" size="sm" variant="secondary" loading={pending === `${a.id}:reject`} onClick={() => void act(a.id, "reject")}>
                    {t("guide.command.reject")}
                  </Button>
                </>
              ) : (
                <Badge tone={a.status === "PENDING" ? "warning" : a.status === "EXECUTED" || a.status === "APPROVED" ? "success" : a.status === "FAILED" ? "danger" : "neutral"}>{t(`guide.approval.${a.status}`)}</Badge>
              )}
            </span>
          </li>
        ))}
      </ul>
      <Link href={`/${locale}/approvals`} className="text-xs font-medium text-primary hover:underline">
        {t("guide.task.reviewApprovals")}
      </Link>
    </div>
  );
}
