import Link from "next/link";
import { BookOpenText, Globe, Search, Sparkles } from "lucide-react";
import { AnimatedProgress, LiveDot } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Markdown } from "@/components/guide/markdown";
import { STEP_TONE } from "@/components/builder/frame";
import { LiveRefresh, RetryStep } from "@/components/builder/run-controls";
import type { Translate } from "@/i18n/translate";
import { formatDateTime, formatRelativeTime } from "@/i18n/format";
import type { AiAvailability, JourneyView } from "@/server/modules/builder/journey-view";
import { cn } from "@/lib/utils";
import { StageGo } from "./stage-go";

const hostOf = (u: string | null) => {
  try {
    return u ? new URL(u).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};
const DONE = new Set(["COMPLETED", "SKIPPED"]);
const LIVE = new Set(["RUNNING", "APPLYING"]);

/** Research radar: one node per research step around the company core; colour = real status, the running one pulses. */
function Radar({ steps, label, center }: { steps: JourneyView["research"]; label: string; center: string }) {
  const n = Math.max(steps.length, 1);
  return (
    <figure className="relative mx-auto aspect-square w-full max-w-[22rem]" aria-label={label}>
      <svg viewBox="0 0 200 200" className="size-full" aria-hidden>
        <defs>
          <radialGradient id="radar-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="radar-sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.45" />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="96" fill="url(#radar-glow)" />
        {[30, 55, 80].map((r) => (
          <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="var(--border-strong)" strokeOpacity="0.55" strokeDasharray="1.5 3" />
        ))}
        {steps.some((s) => LIVE.has(s.status)) ? (
          <g className="origin-center animate-[spin_5s_linear_infinite] motion-reduce:animate-none" style={{ transformBox: "view-box" }}>
            <path d="M100 100 L180 100 A80 80 0 0 0 156.6 43.4 Z" fill="url(#radar-sweep)" />
          </g>
        ) : null}
        {steps.map((s, i) => {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          const x = 100 + Math.cos(a) * 80;
          const y = 100 + Math.sin(a) * 80;
          const tone = s.status === "COMPLETED" ? "var(--success)" : s.status === "FAILED" ? "var(--danger)" : LIVE.has(s.status) ? "var(--primary)" : "var(--border-strong)";
          return (
            <g key={s.id}>
              <line x1="100" y1="100" x2={x} y2={y} stroke={tone} strokeOpacity={DONE.has(s.status) || LIVE.has(s.status) ? 0.6 : 0.25} strokeDasharray={s.status === "COMPLETED" ? undefined : "3 3"} />
              {LIVE.has(s.status) ? <circle cx={x} cy={y} r="11" fill="var(--primary)" opacity="0.25" className="animate-ping motion-reduce:animate-none" style={{ transformOrigin: `${x}px ${y}px` }} /> : null}
              <circle cx={x} cy={y} r="6.5" fill={tone} stroke="var(--surface)" strokeWidth="2" />
            </g>
          );
        })}
        <circle cx="100" cy="100" r="17" fill="var(--primary)" />
        <circle cx="100" cy="100" r="17" fill="none" stroke="var(--surface)" strokeOpacity="0.5" strokeWidth="2" />
      </svg>
      <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 text-center text-[11px] font-semibold text-muted-foreground">{center}</figcaption>
    </figure>
  );
}

/**
 * Stage 3 — Intelligence: the real AI research of the journey run. Every row is a builder step with its AI task: who
 * works on it, when it was queued, started and finished, how many lookups the AI made, and the deliverable it saved in
 * Company Brain. When AI or live research is not available, the stage says so plainly and offers to continue manually.
 */
export function IntelligenceStage({ t, locale, timezone, v, ai, provider, base, canManage }: { t: Translate; locale: string; timezone: string; v: JourneyView; ai: AiAvailability; provider: string | null; base: string; canManage: boolean }) {
  const steps = v.research;
  const done = steps.filter((s) => DONE.has(s.status)).length;
  const running = steps.find((s) => LIVE.has(s.status));
  const failed = steps.filter((s) => s.status === "FAILED");
  const allDone = steps.length > 0 && done === steps.length;
  const web = steps.find((s) => s.key === "web_research");
  const webOutcome = (web?.result ?? null) as { status?: string; reason?: string; results?: number; providerId?: string } | null;
  const sources = v.sources.filter((s) => s.status === "INGESTED");
  const live = v.run.status === "RUNNING";

  return (
    <div className="grid gap-4">
      <LiveRefresh base={base} active={live} />
      {!ai.ok ? (
        <Notice tone="warning" title={t("onboarding.journey.intelligence.aiOff.title")} action={<StageGo to="blueprint" variant="secondary" query="manual=1">{t("onboarding.journey.intelligence.manual")}</StageGo>}>
          {t(`onboarding.journey.intelligence.aiOff.${ai.reason === "ai_not_configured" ? "notConfigured" : "refused"}`)}
        </Notice>
      ) : null}
      {!provider ? (
        <Notice
          tone="info"
          title={t("onboarding.journey.intelligence.noResearch.title")}
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href={`/${locale}/integrations`}>{t("onboarding.journey.intelligence.noResearch.connect")}</Link>
            </Button>
          }
        >
          {t("onboarding.journey.intelligence.noResearch.body")}
        </Notice>
      ) : null}
      {v.run.status === "DRAFT" ? <Notice tone="info">{t("onboarding.journey.intelligence.draft")}</Notice> : null}

      <section className="relative grid gap-6 overflow-hidden rounded-[1.75rem] border bg-surface/60 p-4 shadow-elev-2 backdrop-blur sm:p-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:items-center">
        <Radar steps={steps} label={t("onboarding.journey.intelligence.radar", { done, total: steps.length })} center={v.run.companyName} />
        <div className="grid gap-3">
          <p className="text-[11px] font-semibold tracking-[0.1em] text-primary uppercase">{t("onboarding.journey.intelligence.progress")}</p>
          <p className="font-display text-4xl tabular-nums">
            {done}
            <span className="text-muted-foreground"> / {steps.length}</span>
          </p>
          <AnimatedProgress value={done} max={Math.max(1, steps.length)} label={t("onboarding.journey.intelligence.progress")} size="sm" />
          <p className="flex items-center gap-2 text-sm" aria-live="polite">
            {running ? (
              <>
                <LiveDot tone="primary" />
                {t("onboarding.journey.intelligence.now", { step: t(`builder.steps.${running.key}`), who: running.task ? t(`profiles.${running.task.profile}.name`) : t("onboarding.journey.intelligence.system") })}
              </>
            ) : allDone ? (
              <Badge tone="success">{t("onboarding.journey.intelligence.allDone")}</Badge>
            ) : failed.length ? (
              <span className="text-danger">{t("onboarding.journey.intelligence.failed", { count: failed.length })}</span>
            ) : live ? (
              <span className="text-muted-foreground">{t("onboarding.journey.intelligence.queued")}</span>
            ) : (
              <span className="text-muted-foreground">{t(`builder.runStatus.${v.run.status}`)}</span>
            )}
          </p>
          {webOutcome ? (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Globe className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {webOutcome.status === "done"
                ? t("onboarding.journey.intelligence.web.done", { count: webOutcome.results ?? 0, provider: webOutcome.providerId ?? "" })
                : webOutcome.reason === "not_connected"
                  ? t("onboarding.journey.intelligence.web.notConnected")
                  : webOutcome.reason === "no_topic"
                    ? t("onboarding.journey.intelligence.web.noTopic")
                    : t("onboarding.journey.intelligence.web.failed")}
            </p>
          ) : null}
        </div>
      </section>

      <ol className="relative grid gap-3 before:absolute before:start-[1.15rem] before:top-2 before:bottom-2 before:w-px before:bg-border">
        {steps.map((s) => {
          const task = s.task;
          return (
            <li key={s.id} className="relative grid grid-cols-[2.3rem_minmax(0,1fr)] gap-2">
              <span className={cn("relative z-[1] mt-2 grid size-9 place-items-center rounded-full border bg-surface [&_svg]:size-4", s.status === "COMPLETED" && "border-success/50 text-success", LIVE.has(s.status) && "border-primary text-primary shadow-glow", s.status === "FAILED" && "border-danger/50 text-danger")}>
                {s.key === "web_research" || s.key === "website_ingest" ? <Search aria-hidden /> : <Sparkles aria-hidden />}
              </span>
              <article className={cn("grid gap-2 rounded-2xl border bg-surface p-3 shadow-elev-1 sm:p-4", LIVE.has(s.status) && "border-primary/60 shadow-glow")}>
                <header className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{t(`builder.steps.${s.key}`)}</h3>
                  <Badge tone={STEP_TONE[s.status]} pulse={LIVE.has(s.status)}>
                    {t(`builder.stepStatus.${s.status}`)}
                  </Badge>
                  {task ? <span className="text-xs text-muted-foreground">{t(`profiles.${task.profile}.name`)}</span> : null}
                </header>
                {task ? (
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <div>
                      <dt className="inline">{t("onboarding.journey.intelligence.task.status")}: </dt>
                      <dd className="inline font-medium text-foreground">{t(`agentTasks.status.${task.status}`)}</dd>
                    </div>
                    {task.startedAt ? (
                      <div title={formatDateTime(task.startedAt, locale, timezone)}>
                        <dt className="inline">{t("onboarding.journey.intelligence.task.started")}: </dt>
                        <dd className="inline">{formatRelativeTime(task.startedAt, locale)}</dd>
                      </div>
                    ) : (
                      <div>
                        <dt className="inline">{t("onboarding.journey.intelligence.task.queued")}: </dt>
                        <dd className="inline">{formatRelativeTime(task.queuedAt, locale)}</dd>
                      </div>
                    )}
                    {task.completedAt ? (
                      <div title={formatDateTime(task.completedAt, locale, timezone)}>
                        <dt className="inline">{t("onboarding.journey.intelligence.task.finished")}: </dt>
                        <dd className="inline">{formatRelativeTime(task.completedAt, locale)}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt className="sr-only">{t("onboarding.journey.intelligence.task.lookupsLabel")}</dt>
                      <dd className="inline">{t("onboarding.journey.intelligence.task.lookups", { count: task.lookups })}</dd>
                    </div>
                    {task.citations ? <dd className="inline">{t("onboarding.journey.intelligence.task.citations", { count: task.citations })}</dd> : null}
                  </dl>
                ) : s.key === "web_research" && s.result ? null : s.status === "PENDING" ? (
                  <p className="text-xs text-muted-foreground">{t("onboarding.journey.intelligence.waiting")}</p>
                ) : null}
                {task?.excerpt ? (
                  <details className="group rounded-xl bg-surface-2/70 px-3 py-2" open={s.key !== "web_research"}>
                    <summary className="cursor-pointer text-xs font-medium text-primary">{t("onboarding.journey.intelligence.result")}</summary>
                    <Markdown text={task.excerpt} className="mt-2 text-sm" />
                  </details>
                ) : null}
                {s.status === "FAILED" ? (
                  <div className="grid gap-2">
                    <Notice tone="danger">
                      {s.errorMessage ?? task?.errorMessage}
                      {s.errorIssues.length ? <span className="mt-1 block font-mono text-[11px]">{s.errorIssues.join(" · ")}</span> : null}
                    </Notice>
                    {canManage && v.run.status !== "CANCELLED" ? <RetryStep base={base} stepId={s.id} /> : null}
                  </div>
                ) : null}
                {s.brainDocumentId ? (
                  <Link className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline" href={`/${locale}/brain/${s.brainDocumentId}`}>
                    <BookOpenText className="size-3.5" aria-hidden />
                    {t("onboarding.journey.intelligence.readFull")}
                  </Link>
                ) : null}
              </article>
            </li>
          );
        })}
      </ol>

      {sources.length ? (
        <section className="grid gap-2 rounded-2xl border bg-surface/70 p-4">
          <h2 className="text-sm font-semibold">{t("onboarding.journey.intelligence.sources", { count: sources.length })}</h2>
          <ul className="flex flex-wrap gap-1.5">
            {sources.slice(0, 40).map((s) =>
              s.url ? (
                <li key={s.id}>
                  <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-[16rem] items-center gap-1 truncate rounded-full border bg-surface px-2.5 py-1 text-xs hover:border-primary" title={s.title}>
                    <Globe className="size-3 shrink-0" aria-hidden />
                    <span className="truncate">{hostOf(s.url)}</span>
                  </a>
                </li>
              ) : (
                <li key={s.id} className="inline-flex max-w-[16rem] items-center gap-1 truncate rounded-full border bg-surface px-2.5 py-1 text-xs">
                  <BookOpenText className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{s.title}</span>
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-surface/80 p-3 backdrop-blur">
        <StageGo to="vision" variant="ghost" back>
          {t("common.previous")}
        </StageGo>
        <div className="grid justify-items-end gap-1">
          <StageGo to="blueprint">{allDone || v.blueprint.proposal ? t("onboarding.journey.intelligence.toBlueprint") : t("onboarding.journey.intelligence.continueWhileWorking")}</StageGo>
          {!allDone && canManage ? <span className="text-xs text-muted-foreground">{t("onboarding.journey.intelligence.continueHint")}</span> : null}
        </div>
      </div>
    </div>
  );
}
