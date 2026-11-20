"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  Crosshair,
  Lightbulb,
  ListChecks,
  Maximize2,
  RotateCcw,
  Send,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { AiCore, AnimatedProgress } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { GuideContext } from "@/server/modules/guide/service";
import { GuideRequestView } from "./guide-request-view";
import { moduleStyle } from "./module-style";
import { MicButton } from "./voice-input";

type Mode = "explain" | "guide" | "do" | "next" | "recommend" | "result";
type Step = GuideContext["steps"][number];
type Question = NonNullable<Step["ai"]>["questions"][number];

const prefersReduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Scroll to and briefly ring the element a step points at ("Show me"). Returns false when it is not on screen. */
function highlight(selector: string): boolean {
  let el: HTMLElement | null = null;
  try {
    el = document.querySelector<HTMLElement>(selector);
  } catch {
    return false;
  }
  if (!el) return false;
  el.scrollIntoView({ behavior: prefersReduced() ? "auto" : "smooth", block: "center" });
  const prev = { outline: el.style.outline, offset: el.style.outlineOffset, radius: el.style.borderRadius };
  el.style.outline = "3px solid var(--primary)";
  el.style.outlineOffset = "4px";
  el.style.borderRadius = el.style.borderRadius || "8px";
  if (el.tabIndex >= 0 || /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.focus({ preventScroll: true });
  window.setTimeout(() => {
    el.style.outline = prev.outline;
    el.style.outlineOffset = prev.offset;
    el.style.borderRadius = prev.radius;
  }, 2600);
  return true;
}

const ACTIONS: { mode: Exclude<Mode, "result">; icon: typeof Sparkles }[] = [
  { mode: "explain", icon: Lightbulb },
  { mode: "guide", icon: ListChecks },
  { mode: "do", icon: Wand2 },
  { mode: "next", icon: Compass },
  { mode: "recommend", icon: Crosshair },
];

/** The guide panel body: knows the current page, explains it, walks through it, does steps and recommends what's next. */
export function GuidePanel({ base, pathname, onClose, titleId }: { base: string | null; pathname: string; onClose: () => void; titleId: string }) {
  const { t, locale } = useI18n();
  const [ctx, setCtx] = useState<GuideContext | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [mode, setMode] = useState<Mode>("explain");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [doStep, setDoStep] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [ask, setAsk] = useState("");
  const [interim, setInterim] = useState("");

  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    // Fetch on open and on navigation / after changes; state is set only when the request resolves.
    if (!base) return;
    let stop = false;
    api<GuideContext>(`${base}/guide/context?path=${encodeURIComponent(pathname)}`)
      .then((d) => {
        if (stop) return;
        setCtx(d);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (!stop) setLoadError(err);
      });
    return () => {
      stop = true;
    };
  }, [base, pathname, reloadKey]);

  // A new page starts on "Explain".
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setMode("explain");
    setRequestId(null);
    setDoStep(null);
  }

  const send = async (kind: string, extra: { question?: string; stepKey?: string; answers?: Record<string, string> } = {}) => {
    if (!base) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>(`${base}/guide/requests`, { body: { kind, path: pathname, locale, ...extra } });
      setRequestId(r.id);
      setMode("result");
      load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const saveProgress = async (body: { stepKey?: string; done?: boolean; current?: boolean; reset?: boolean }) => {
    if (!base || !ctx) return;
    try {
      await api(`${base}/guide/progress`, { body: { pageKey: ctx.page.key, ...body } });
      load();
    } catch (err) {
      setError(err);
    }
  };

  const p = ctx ? `guide.pages.${ctx.page.key}` : "";
  const style = moduleStyle(ctx?.page.module);
  const Icon = style.icon;
  const firstOpen = ctx?.steps.find((s) => !s.done) ?? null;
  const nextLink = ctx?.page.next[0] ?? null;
  const aiBlocked = ctx ? (!ctx.ai.configured ? "notConfigured" : !ctx.ai.canRun ? "forbidden" : null) : null;

  const submitAsk = (e: FormEvent) => {
    e.preventDefault();
    const q = ask.trim();
    if (!q) return;
    void send("ASK", { question: q }).then(() => setAsk(""));
  };

  const aiButton = (kind: string, label: string) =>
    aiBlocked ? null : (
      <Button type="button" variant="soft" size="sm" loading={busy} onClick={() => void send(kind)} className="justify-self-start">
        <Sparkles aria-hidden />
        {label}
      </Button>
    );

  let body: ReactNode = null;
  if (!base) {
    body = (
      <Notice tone="info" action={<Link href={`/${locale}/onboarding`} className="text-xs font-medium text-primary hover:underline">{t("guide.noCompanyAction")}</Link>}>
        {t("guide.noCompany")}
      </Notice>
    );
  } else if (loadError && !ctx) {
    body = <FormError error={loadError} />;
  } else if (!ctx) {
    body = <AnimatedProgress label={t("guide.loading")} size="sm" />;
  } else if (mode === "explain") {
    body = (
      <div className="grid gap-3 stagger">
        <Section title={t("guide.labels.what")}>{t(`${p}.what`)}</Section>
        <Section title={t("guide.labels.why")}>{t(`${p}.why`)}</Section>
        <Section title={t("guide.labels.can")}>{t(`${p}.can`)}</Section>
        {ctx.page.metrics.some((m) => typeof ctx.counts[m] === "number") ? (
          <Section title={t("guide.labels.state")}>
            <ul className="flex flex-wrap gap-1.5">
              {ctx.page.metrics.map((m) =>
                typeof ctx.counts[m] === "number" ? (
                  <li key={m} className="rounded-full border bg-surface px-2.5 py-1 text-xs font-medium text-foreground">
                    {t(`guide.metrics.${m}`, { count: ctx.counts[m] as number })}
                  </li>
                ) : null,
              )}
            </ul>
          </Section>
        ) : null}
        {firstOpen ? (
          <NextCard
            title={t(`${p}.steps.${firstOpen.key}`)}
            why={firstOpen.metric && ctx.counts[firstOpen.metric] === 0 ? t("guide.labels.becauseZero", { what: t(`guide.metrics.${firstOpen.metric}`, { count: 0 }) }) : t("guide.labels.firstOpen")}
            href={firstOpen.href}
          />
        ) : null}
        {aiButton("EXPLAIN", t("guide.ai.explain"))}
      </div>
    );
  } else if (mode === "guide") {
    body = (
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t("guide.progress", { done: ctx.progress.done, total: ctx.progress.total })}</span>
            <button type="button" onClick={() => void saveProgress({ reset: true })} className="inline-flex items-center gap-1 hover:text-foreground">
              <RotateCcw className="size-3" aria-hidden />
              {t("guide.reset")}
            </button>
          </div>
          <AnimatedProgress value={ctx.progress.done} max={Math.max(1, ctx.progress.total)} label={t("guide.progress", { done: ctx.progress.done, total: ctx.progress.total })} tone={ctx.progress.done === ctx.progress.total ? "success" : "primary"} />
        </div>
        {ctx.progress.current && ctx.progress.done > 0 ? (
          <Notice
            tone="info"
            action={(() => {
              const cur = ctx.steps.find((s) => s.key === ctx.progress.current);
              return cur?.href ? (
                <Link href={`/${locale}${cur.href}`} className="text-xs font-medium text-primary hover:underline">
                  {t("guide.resume")}
                </Link>
              ) : null;
            })()}
          >
            {t("guide.resumeAt", { step: t(`${p}.steps.${ctx.progress.current}`) })}
          </Notice>
        ) : null}
        <ol className="grid gap-2 stagger">
          {ctx.steps.map((s, i) => (
            <StepRow
              key={s.key}
              index={i}
              step={s}
              label={t(`${p}.steps.${s.key}`)}
              current={ctx.progress.current === s.key}
              onPage={!!s.href && pathname.replace(/^\/[^/]+/, "") === s.href}
              canAi={!aiBlocked}
              onToggle={(done) => void saveProgress({ stepKey: s.key, done })}
              onGo={() => void saveProgress({ stepKey: s.key, current: true })}
              onDo={() => {
                setDoStep(s.key);
                setMode("do");
              }}
            />
          ))}
        </ol>
        {aiButton("GUIDE", t("guide.ai.guide"))}
      </div>
    );
  } else if (mode === "do") {
    const doable = ctx.steps.filter((s) => s.ai);
    const chosen = doable.find((s) => s.key === doStep);
    body = aiBlocked ? (
      <Notice tone="warning">{t(`guide.ai.${aiBlocked}`)}</Notice>
    ) : chosen ? (
      <DoConversation
        key={chosen.key}
        label={t(`${p}.steps.${chosen.key}`)}
        questions={chosen.ai!.questions}
        busy={busy}
        onBack={() => setDoStep(null)}
        onSubmit={(answers) => void send("DO", { stepKey: chosen.key, answers })}
      />
    ) : (
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">{t("guide.do.intro")}</p>
        <ul className="grid gap-2 stagger">
          {doable.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => setDoStep(s.key)}
                className="hover-lift flex w-full items-center justify-between gap-2 rounded-md border bg-surface px-3 py-2.5 text-start text-sm focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="flex items-center gap-2">
                  <Wand2 className="size-4 text-primary" aria-hidden />
                  {t(`${p}.steps.${s.key}`)}
                </span>
                {s.done ? <Check className="size-4 text-success" aria-label={t("guide.done")} /> : <ArrowRight className="size-4 text-muted-foreground rtl:rotate-180" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
        <FreeDo busy={busy} onSubmit={(q) => void send("DO", { question: q })} />
        <p className="text-[11px] text-muted-foreground">{t("guide.do.safety")}</p>
      </div>
    );
  } else if (mode === "next") {
    body = (
      <div className="grid gap-3 stagger">
        {ctx.onboarding.unfinishedRun ? (
          <NextCard title={t("guide.recs.builderResume.title")} why={t("guide.recs.builderResume.why")} href="/builder" highlight />
        ) : null}
        {firstOpen ? <NextCard title={t(`${p}.steps.${firstOpen.key}`)} why={t("guide.labels.onThisPage")} href={firstOpen.href} /> : null}
        {ctx.recommendations
          .filter((r) => r.key !== "builderResume")
          .map((r) => (
            <NextCard key={r.key} title={t(`guide.recs.${r.key}.title`, { count: r.count ?? 0 })} why={t(`guide.recs.${r.key}.why`)} href={r.href} />
          ))}
        <Section title={t("guide.labels.related")}>
          <ul className="flex flex-wrap gap-1.5">
            {ctx.page.next.map((n) => (
              <li key={n.href}>
                <Link href={`/${locale}${n.href}`} className="inline-flex items-center gap-1 rounded-full border bg-surface px-2.5 py-1 text-xs font-medium hover:border-primary/50 hover:text-primary">
                  {t(`guide.pages.${n.pageKey}.title`)}
                  <ArrowRight className="size-3 rtl:rotate-180" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
        {aiButton("NEXT", t("guide.ai.next"))}
      </div>
    );
  } else if (mode === "recommend") {
    const top = ctx.onboarding.unfinishedRun ? null : firstOpen;
    const rec = ctx.recommendations[0];
    body = (
      <div className="grid gap-3">
        {top ? (
          <NextCard title={t(`${p}.steps.${top.key}`)} why={t("guide.recommend.stepWhy")} href={top.href} highlight />
        ) : rec ? (
          <NextCard title={t(`guide.recs.${rec.key}.title`, { count: rec.count ?? 0 })} why={t(`guide.recs.${rec.key}.why`)} href={rec.href} highlight />
        ) : (
          <Notice tone="success">{t("guide.recommend.allDone")}</Notice>
        )}
        {aiBlocked ? null : <RecommendAsk busy={busy} onSubmit={(q) => void send("RECOMMEND", q ? { question: q } : {})} />}
      </div>
    );
  } else if (mode === "result" && requestId && base) {
    body = (
      <div className="grid gap-3">
        <button type="button" onClick={() => setMode("explain")} className="inline-flex items-center gap-1 justify-self-start text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3 rtl:rotate-180" aria-hidden />
          {t("guide.back")}
        </button>
        <GuideRequestView base={base} requestId={requestId} nextHref={nextLink?.href} nextLabel={nextLink ? t(`guide.pages.${nextLink.pageKey}.title`) : null} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="relative flex items-start gap-3 border-b px-4 py-3">
        <span aria-hidden className={cn("relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br", style.ring)}>
          <AiCore className="absolute size-16 opacity-60" />
          <Icon className={cn("relative size-5", style.tone)} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-primary uppercase">{t("guide.title")}</p>
          <h2 id={titleId} className="truncate text-sm font-semibold">
            {ctx ? t(`${p}.title`) : t("guide.title")}
          </h2>
        </div>
        <Link
          href={`/${locale}/command`}
          onClick={onClose}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("guide.expand")}
          title={`${t("guide.expand")} (⌘J)`}
        >
          <Maximize2 className="size-4" aria-hidden />
        </Link>
        <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("guide.close")}>
          <X className="size-4" aria-hidden />
        </button>
      </header>

      {base && ctx ? (
        <nav aria-label={t("guide.actionsLabel")} className="grid grid-cols-5 gap-1 border-b px-2 py-2">
          {ACTIONS.map(({ mode: m, icon: I }) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
                if (m !== "do") setDoStep(null);
              }}
              aria-pressed={mode === m}
              className={cn(
                "grid justify-items-center gap-1 rounded-md px-1 py-2 text-center text-[11px] leading-tight font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary",
                mode === m && "bg-accent text-accent-foreground",
              )}
            >
              <I className="size-4" aria-hidden />
              {t(`guide.actions.${m}`)}
            </button>
          ))}
        </nav>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {aiBlocked && mode !== "do" ? <Notice tone="info" className="mb-3">{t(`guide.ai.${aiBlocked}`)}</Notice> : null}
        {error ? (
          <div className="mb-3">
            <FormError error={error} />
          </div>
        ) : null}
        {body}
        {ctx && ctx.requests.length && mode !== "result" ? (
          <details className="mt-4 text-xs">
            <summary className="cursor-pointer font-medium text-muted-foreground">{t("guide.recent")}</summary>
            <ul className="mt-2 grid gap-1">
              {ctx.requests.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setRequestId(r.id);
                      setMode("result");
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-start hover:bg-muted"
                  >
                    <span className="truncate">{r.question ?? (r.stepKey ? t(`${p}.steps.${r.stepKey}`) : t(`guide.actions.${r.kind === "ASK" ? "ask" : kindMode(r.kind)}`))}</span>
                    <span className="shrink-0 text-muted-foreground">{r.status ? t(`guide.task.status.${r.status}`) : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {base && ctx && !aiBlocked ? (
        <form onSubmit={submitAsk} className="flex items-end gap-2 border-t px-3 py-3">
          <label className="sr-only" htmlFor="guide-ask">
            {t("guide.askLabel")}
          </label>
          <textarea
            id="guide-ask"
            rows={1}
            value={interim ? `${ask}${ask ? " " : ""}${interim}` : ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            maxLength={2000}
            placeholder={t("guide.askPlaceholder")}
            className="max-h-32 min-h-9 flex-1 resize-none rounded-md border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          />
          <MicButton onText={(text) => setAsk((a) => (a ? `${a} ${text}` : text))} onInterim={setInterim} />
          <Button type="submit" size="icon" loading={busy} disabled={!ask.trim()} aria-label={t("guide.send")}>
            {busy ? null : <Send aria-hidden className="rtl:-scale-x-100" />}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

const kindMode = (kind: string) => ({ EXPLAIN: "explain", GUIDE: "guide", DO: "do", NEXT: "next", RECOMMEND: "recommend" })[kind] ?? "explain";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1">
      <h3 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{title}</h3>
      <div className="text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function NextCard({ title, why, href, highlight: hl }: { title: string; why: string; href?: string | null; highlight?: boolean }) {
  const { t, locale } = useI18n();
  return (
    <div className={cn("grid gap-1 rounded-lg border p-3", hl ? "border-gradient shadow-glow" : "bg-surface")}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground">{why}</p>
      {href ? (
        <Link href={`/${locale}${href}`} className="mt-1 inline-flex items-center gap-1 justify-self-start text-xs font-semibold text-primary hover:underline">
          {t("guide.go")}
          <ArrowRight className="size-3 rtl:rotate-180" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

function StepRow({
  index,
  step,
  label,
  current,
  onPage,
  canAi,
  onToggle,
  onGo,
  onDo,
}: {
  index: number;
  step: Step;
  label: string;
  current: boolean;
  onPage: boolean;
  canAi: boolean;
  onToggle: (done: boolean) => void;
  onGo: () => void;
  onDo: () => void;
}) {
  const { t, locale } = useI18n();
  const [missing, setMissing] = useState(false);
  return (
    <li className={cn("grid gap-2 rounded-lg border p-3", current && !step.done ? "border-primary/50 bg-accent/40" : "bg-surface")}>
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={() => onToggle(!step.done)}
          disabled={step.auto === true}
          aria-pressed={step.done}
          aria-label={step.done ? t("guide.undo") : t("guide.markDone")}
          className={cn(
            "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default",
            step.done ? "border-success bg-success text-success-foreground" : "text-muted-foreground hover:border-primary",
          )}
        >
          {step.done ? <Check className="size-3" aria-hidden /> : index + 1}
        </button>
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-medium", step.done && "text-muted-foreground line-through decoration-1")}>{label}</p>
          {step.auto === true ? <p className="text-[11px] text-success">{t("guide.autoDone")}</p> : null}
        </div>
      </div>
      {!step.done ? (
        <div className="flex flex-wrap gap-1.5 ps-7">
          {step.href && !onPage ? (
            <Button asChild size="sm" variant="secondary">
              <Link href={`/${locale}${step.href}`} onClick={onGo}>
                {t("guide.go")}
              </Link>
            </Button>
          ) : null}
          {step.selector && (onPage || !step.href) ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setMissing(!highlight(step.selector!))}>
              <Crosshair aria-hidden />
              {t("guide.showMe")}
            </Button>
          ) : null}
          {step.ai && canAi ? (
            <Button type="button" size="sm" variant="soft" onClick={onDo}>
              <Wand2 aria-hidden />
              {t("guide.actions.do")}
            </Button>
          ) : null}
          {missing ? <p className="w-full text-[11px] text-muted-foreground">{t("guide.notOnScreen")}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

/** "Do this for me": essential questions one at a time (recommended choice preselected), then the AI task starts. */
function DoConversation({ label, questions, busy, onBack, onSubmit }: { label: string; questions: Question[]; busy: boolean; onBack: () => void; onSubmit: (answers: Record<string, string>) => void }) {
  const { t } = useI18n();
  const initial = useMemo(() => Object.fromEntries(questions.map((q) => [q.key, q.recommended ?? ""])), [questions]);
  const [answers, setAnswers] = useState<Record<string, string>>(initial);
  const [i, setI] = useState(0);
  const q = questions[i];
  const last = i >= questions.length - 1;
  const value = q ? (answers[q.key] ?? "") : "";
  const canNext = !q || q.optional || value.trim().length > 0;

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (!canNext) return;
    if (last) onSubmit(answers);
    else setI(i + 1);
  };

  return (
    <form onSubmit={next} className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={i === 0 ? onBack : () => setI(i - 1)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3 rtl:rotate-180" aria-hidden />
          {t("guide.back")}
        </button>
        {questions.length ? <span className="text-xs text-muted-foreground">{t("guide.do.questionOf", { n: i + 1, total: questions.length })}</span> : null}
      </div>
      <div className="rounded-lg border-gradient p-3 shadow-glow">
        <p className="text-[11px] font-semibold tracking-[0.06em] text-primary uppercase">{t("guide.do.task")}</p>
        <p className="text-sm font-semibold">{label}</p>
      </div>
      {questions.length ? <AnimatedProgress value={i + 1} max={questions.length} label={t("guide.do.questionOf", { n: i + 1, total: questions.length })} size="sm" /> : null}
      {q ? (
        <fieldset key={q.key} className="grid gap-2 animate-fade-up">
          <legend className="mb-1 text-sm font-medium">
            {t(`guide.questions.${q.key}.label`)}
            {q.optional ? <span className="ms-1 text-xs font-normal text-muted-foreground">({t("common.optional")})</span> : null}
          </legend>
          {q.type === "choice" ? (
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {q.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={value === o}
                  onClick={() => setAnswers({ ...answers, [q.key]: o })}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                    value === o ? "border-primary bg-accent text-accent-foreground" : "bg-surface hover:border-primary/50",
                  )}
                >
                  {/^\d+$/.test(o) ? o : t(`guide.questions.${q.key}.options.${o}`)}
                  {q.recommended === o ? <span className="ms-1 text-[10px] text-primary">· {t("guide.recommended")}</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <textarea
              rows={3}
              autoFocus
              value={value}
              maxLength={1000}
              onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
              placeholder={t(`guide.questions.${q.key}.example`)}
              className="rounded-md border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            />
          )}
        </fieldset>
      ) : null}
      <Button type="submit" variant={last ? "gradient" : "default"} loading={busy} disabled={!canNext} className="justify-self-end">
        {last ? (
          <>
            <Sparkles aria-hidden />
            {t("guide.do.start")}
          </>
        ) : (
          t("guide.next")
        )}
      </Button>
      <p className="text-[11px] text-muted-foreground">{t("guide.do.safety")}</p>
    </form>
  );
}

function FreeDo({ busy, onSubmit }: { busy: boolean; onSubmit: (q: string) => void }) {
  const { t } = useI18n();
  const [v, setV] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSubmit(v.trim());
      }}
      className="grid gap-2"
    >
      <label htmlFor="guide-free-do" className="text-xs font-medium">
        {t("guide.do.other")}
      </label>
      <div className="flex gap-2">
        <input id="guide-free-do" value={v} maxLength={2000} onChange={(e) => setV(e.target.value)} placeholder={t("guide.do.otherPlaceholder")} className="h-9 min-w-0 flex-1 rounded-md border bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50" />
        <MicButton onText={(text) => setV((a) => (a ? `${a} ${text}` : text))} />
        <Button type="submit" size="sm" loading={busy} disabled={!v.trim()}>
          {t("guide.do.start")}
        </Button>
      </div>
    </form>
  );
}

function RecommendAsk({ busy, onSubmit }: { busy: boolean; onSubmit: (q: string) => void }) {
  const { t } = useI18n();
  const [v, setV] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v.trim());
      }}
      className="grid gap-2"
    >
      <label htmlFor="guide-rec" className="text-xs font-medium">
        {t("guide.recommend.question")}
      </label>
      <input id="guide-rec" value={v} maxLength={2000} onChange={(e) => setV(e.target.value)} placeholder={t("guide.recommend.placeholder")} className="h-9 rounded-md border bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50" />
      <Button type="submit" variant="soft" size="sm" loading={busy} className="justify-self-start">
        <Sparkles aria-hidden />
        {t("guide.ai.recommend")}
      </Button>
    </form>
  );
}
