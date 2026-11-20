"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, ClipboardCheck, ExternalLink, History, MessageSquarePlus, Send, Sparkles, Trash2, X } from "lucide-react";
import { AiCore, AnimatedProgress, LiveDot, TypingText } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { FormError, useErrorMessage } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { CommandSessionView } from "@/server/modules/guide/command";
import { AiNetwork, type NetworkNode } from "./ai-network";
import { Markdown } from "./markdown";
import { ACTIVE_PHASES, isActive, workPhase, type WorkPhase } from "./phase";
import { toolStepLabel, toolVerb } from "./tool-labels";
import { MicButton } from "./voice-input";

type Message = CommandSessionView["messages"][number];
type TaskView = NonNullable<Message["task"]>;
interface SessionRow {
  id: string;
  title: string;
  updatedAt: string;
  _count: { messages: number };
}
interface Bootstrap {
  data: SessionRow[];
  suggestions: string[];
  ai: { configured: boolean; canRun: boolean };
}

const POLL_MS = 2500;

/** Signature AI Command workspace: give the company a command, watch its AI employees work on it from real data. */
export function CommandWorkspace({ base, initialSessionId, initialQuery }: { base: string; initialSessionId: string | null; initialQuery: string | null }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [session, setSession] = useState<CommandSessionView | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [text, setText] = useState(initialQuery ?? "");
  const [interim, setInterim] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [bootKey, setBootKey] = useState(0);
  const loadBoot = useCallback(() => setBootKey((k) => k + 1), []);
  useEffect(() => {
    let stop = false;
    api<Bootstrap>(`${base}/guide/command`)
      .then((d) => {
        if (!stop) setBoot(d);
      })
      .catch((err: unknown) => {
        if (!stop) setError(err);
      });
    return () => {
      stop = true;
    };
  }, [base, bootKey]);

  // Load the open session and poll it while any AI employee is still working.
  const active = !!session?.messages.some((m) => (m.task && isActive(m.task.status)) || m.children.some((c) => isActive(c.status)));
  useEffect(() => {
    if (!sessionId) return;
    let stop = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const s = await api<CommandSessionView>(`${base}/guide/command/${sessionId}`);
        if (stop) return;
        setSession(s);
        const running = s.messages.some((m) => (m.task && isActive(m.task.status)) || m.children.some((c) => isActive(c.status)));
        if (running) timer = window.setTimeout(tick, POLL_MS);
      } catch (err) {
        if (stop) return;
        if (err instanceof ApiError && err.code === "not_found") {
          setSessionId(null);
          setSession(null);
        } else {
          setError(err);
          timer = window.setTimeout(tick, POLL_MS * 2);
        }
      }
    };
    void tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
    // Re-arm polling after each new command (session.updatedAt changes) as well as on session switch.
  }, [base, sessionId, session?.updatedAt]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "end" });
  }, [session?.messages.length]);

  const openSession = (id: string | null) => {
    setSessionId(id);
    if (!id) setSession(null);
    setHistoryOpen(false);
    router.replace(id ? `${pathname}?s=${id}` : pathname, { scroll: false });
  };

  const submit = async (e?: FormEvent, override?: string) => {
    e?.preventDefault();
    const command = (override ?? text).trim();
    if (command.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api<CommandSessionView>(`${base}/guide/command`, { body: { text: command, locale, ...(sessionId ? { sessionId } : {}) } });
      setSession(s);
      if (s.id !== sessionId) {
        setSessionId(s.id);
        router.replace(`${pathname}?s=${s.id}`, { scroll: false });
      }
      setText("");
      loadBoot();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`${base}/guide/command/${id}`, { method: "DELETE" });
      if (id === sessionId) openSession(null);
      loadBoot();
    } catch (err) {
      setError(err);
    }
  };

  const decide = async (approvalId: string, decision: "approve" | "reject") => {
    try {
      await api(`${base}/approvals/${approvalId}/decision`, { body: { decision } });
      if (sessionId) setSession(await api<CommandSessionView>(`${base}/guide/command/${sessionId}`));
    } catch (err) {
      setError(err);
    }
  };

  const aiBlocked = boot ? (!boot.ai.configured ? "notConfigured" : !boot.ai.canRun ? "forbidden" : null) : null;
  const groups = groupMessages(session?.messages ?? []);

  return (
    <div className="relative grid min-h-[calc(100dvh-7rem)] gap-4 lg:grid-cols-[16rem_1fr]">
      {/* History */}
      <aside
        className={cn(
          "glass fixed inset-y-0 start-0 z-50 w-72 max-w-[85vw] border-e p-3 shadow-elev-4 transition-transform duration-300 motion-reduce:transition-none lg:static lg:z-auto lg:w-auto lg:max-w-none lg:translate-x-0 lg:rounded-xl lg:border lg:shadow-elev-1",
          historyOpen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full lg:rtl:translate-x-0",
        )}
        aria-label={t("guide.command.history")}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <History className="size-4" aria-hidden />
            {t("guide.command.history")}
          </h2>
          <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted lg:hidden" onClick={() => setHistoryOpen(false)} aria-label={t("guide.close")}>
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <Button type="button" variant="secondary" size="sm" className="mb-3 w-full" onClick={() => openSession(null)}>
          <MessageSquarePlus aria-hidden />
          {t("guide.command.new")}
        </Button>
        {boot && boot.data.length === 0 ? <p className="text-xs text-muted-foreground">{t("guide.command.noHistory")}</p> : null}
        <ul className="grid gap-1">
          {boot?.data.map((s) => (
            <li key={s.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => openSession(s.id)}
                aria-current={s.id === sessionId ? "true" : undefined}
                className={cn("min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-start text-sm hover:bg-muted", s.id === sessionId && "bg-accent text-accent-foreground")}
              >
                {s.title}
              </button>
              <button type="button" onClick={() => void remove(s.id)} className="rounded p-1 text-muted-foreground opacity-60 hover:text-danger group-hover:opacity-100" aria-label={t("guide.command.delete", { title: s.title })}>
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border glass shadow-elev-2">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted lg:hidden" onClick={() => setHistoryOpen(true)} aria-label={t("guide.command.history")}>
            <History className="size-4" aria-hidden />
          </button>
          <h1 className="text-sm font-semibold tracking-tight">{t("guide.command.title")}</h1>
          {active ? (
            <span className="ms-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <LiveDot tone="info" />
              {t("guide.command.working")}
            </span>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6" aria-live="polite">
          {!session ? (
            <div className="mx-auto grid max-w-2xl justify-items-center gap-5 py-6 text-center">
              <div className="relative grid place-items-center">
                <AiCore className="size-56 sm:size-64" />
              </div>
              <div className="grid gap-2 animate-fade-up">
                <h2 className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
                  <span className="text-gradient">{t("guide.command.headline")}</span>
                </h2>
                <p className="text-sm text-muted-foreground">{t("guide.command.subline")}</p>
              </div>
              {boot ? (
                <ul className="flex flex-wrap justify-center gap-2 stagger">
                  {boot.suggestions.map((k) => (
                    <li key={k}>
                      <button
                        type="button"
                        disabled={!!aiBlocked}
                        onClick={() => {
                          setText(t(`guide.command.suggest.${k}`));
                          inputRef.current?.focus();
                        }}
                        className="hover-lift rounded-full border bg-surface/80 px-3.5 py-2 text-sm shadow-elev-1 hover:border-primary/50 disabled:opacity-50"
                      >
                        <Sparkles className="me-1.5 inline size-3.5 text-primary" aria-hidden />
                        {t(`guide.command.suggest.${k}`)}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <AnimatedProgress label={t("guide.loading")} size="sm" className="max-w-xs" />
              )}
            </div>
          ) : (
            <div className="mx-auto grid max-w-3xl gap-8">
              {groups.map((g) => (
                <CommandGroup key={g.user.id} user={g.user} agents={g.agents} canDecide={session.canDecide} onDecide={decide} />
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t p-3">
          {aiBlocked ? <Notice tone="warning" className="mb-2">{t(`guide.ai.${aiBlocked}`)}</Notice> : null}
          {error ? (
            <div className="mb-2">
              <FormError error={error} />
            </div>
          ) : null}
          <form onSubmit={(e) => void submit(e)} className="flex items-end gap-2">
            <label htmlFor="ai-command-input" className="sr-only">
              {t("guide.command.inputLabel")}
            </label>
            <textarea
              id="ai-command-input"
              ref={inputRef}
              rows={2}
              value={interim ? `${text}${text ? " " : ""}${interim}` : text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              maxLength={2000}
              disabled={!!aiBlocked}
              placeholder={t("guide.command.placeholder")}
              className="max-h-40 min-h-12 flex-1 resize-none rounded-lg border bg-surface px-3 py-2.5 text-sm shadow-elev-1 outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            />
            <MicButton onText={(v) => setText((a) => (a ? `${a} ${v}` : v))} onInterim={setInterim} className="size-12" />
            <Button type="submit" variant="gradient" className="h-12" loading={busy} disabled={!!aiBlocked || text.trim().length < 2}>
              {busy ? null : <Send aria-hidden className="rtl:-scale-x-100" />}
              <span className="hidden sm:inline">{t("guide.command.run")}</span>
            </Button>
          </form>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{t("guide.command.safety")}</p>
        </div>
      </section>
      {historyOpen ? <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setHistoryOpen(false)} aria-hidden /> : null}
    </div>
  );
}

function groupMessages(messages: Message[]) {
  const groups: { user: Message; agents: Message[] }[] = [];
  for (const m of messages) {
    if (m.role === "USER") groups.push({ user: m, agents: [] });
    else groups[groups.length - 1]?.agents.push(m);
  }
  return groups;
}

function agentName(t: (k: string) => string, m: { profile: string | null; task: { employeeName: string | null } | null }) {
  return m.task?.employeeName ?? (m.profile ? t(`profiles.${m.profile}.name`) : t("guide.command.aiEmployee"));
}

function CommandGroup({ user, agents, canDecide, onDecide }: { user: Message; agents: Message[]; canDecide: boolean; onDecide: (id: string, d: "approve" | "reject") => Promise<void> }) {
  const { t } = useI18n();
  const nodes: NetworkNode[] = [];
  for (const a of agents) {
    if (!a.task) continue;
    nodes.push({ id: a.task.id, label: agentName(t, a), active: isActive(a.task.status), status: a.task.status });
    for (const c of a.children) nodes.push({ id: c.id, label: c.employeeName ?? t(`profiles.${c.profile}.name`), active: isActive(c.status), status: c.status, parent: a.task.id });
  }
  return (
    <div className="grid gap-4">
      <div className="ms-auto max-w-[85%] rounded-2xl rounded-ee-sm bg-brand-gradient px-4 py-2.5 text-sm text-primary-foreground shadow-glow animate-fade-up">{user.content}</div>
      {nodes.length > 1 ? (
        <div className="flex justify-center rounded-xl border bg-surface/50 p-2 animate-fade-up">
          <AiNetwork nodes={nodes} />
        </div>
      ) : null}
      <div className="grid gap-3">
        {agents.map((a) => (
          <AgentCard key={a.id} message={a} canDecide={canDecide} onDecide={onDecide} />
        ))}
      </div>
    </div>
  );
}

function PhaseStepper({ phase }: { phase: WorkPhase }) {
  const { t } = useI18n();
  const idx = phase === "done" ? ACTIVE_PHASES.length : ACTIVE_PHASES.indexOf(phase);
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[11px]" aria-label={t("guide.command.phases")}>
      {ACTIVE_PHASES.map((p, i) => (
        <li
          key={p}
          aria-current={i === idx ? "step" : undefined}
          className={cn(
            "rounded-full border px-2 py-0.5 transition-colors",
            i < idx ? "border-success/40 text-success" : i === idx ? "border-primary bg-accent font-semibold text-accent-foreground" : "text-muted-foreground opacity-60",
          )}
        >
          {t(`guide.phase.${p}`)}
        </li>
      ))}
    </ol>
  );
}

function AgentCard({ message, canDecide, onDecide }: { message: Message; canDecide: boolean; onDecide: (id: string, d: "approve" | "reject") => Promise<void> }) {
  const { t, locale } = useI18n();
  const errorText = useErrorMessage();
  const name = agentName(t, message);
  const task = message.task;
  if (!task) {
    const reason = message.errorReason ?? "internal_error";
    return (
      <div className="rounded-xl border bg-surface p-4 animate-fade-up">
        <p className="text-sm font-semibold">{name}</p>
        <p className="mt-1 text-sm text-danger">{errorText(new ApiError(reason, reason, { reason }))}</p>
      </div>
    );
  }
  const phase = workPhase(task, message.children);
  const running = isActive(task.status);
  return (
    <article className={cn("relative overflow-hidden rounded-xl p-4 animate-fade-up", running ? "border-gradient shadow-glow" : "border bg-surface")}>
      <header className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="relative grid size-10 place-items-center">
          {running ? <AiCore className="absolute size-14" /> : null}
          <span className={cn("relative grid size-9 place-items-center rounded-full border text-xs font-bold", task.status === "COMPLETED" ? "border-success/50 text-success" : task.status === "FAILED" ? "border-danger/50 text-danger" : "border-primary/50 text-primary", "bg-surface")}>
            {name.slice(0, 2).toUpperCase()}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{name}</p>
          <p className="text-xs text-muted-foreground">{message.profile ? t(`profiles.${message.profile}.name`) : null} · {t(`guide.command.intents.${message.intent ?? "fallback"}`)}</p>
        </div>
        <Badge tone={task.status === "COMPLETED" ? "success" : task.status === "FAILED" ? "danger" : running ? "info" : "neutral"}>{t(`guide.phase.${phase}`)}</Badge>
      </header>

      {phase !== "failed" && phase !== "cancelled" ? <div className="mt-3"><PhaseStepper phase={phase} /></div> : null}
      {running ? <AnimatedProgress className="mt-3" label={t(`guide.phase.${phase}`)} size="sm" active /> : null}

      {task.trace.length ? (
        <ol className="mt-3 grid gap-1.5 border-s ps-3">
          {task.trace.map((s, i) => {
            const latest = i === task.trace.length - 1 && running;
            return (
              <li key={i} className={cn("relative text-xs", latest ? "text-foreground" : "text-muted-foreground")}>
                <span aria-hidden className={cn("absolute -start-[17px] top-1 size-2 rounded-full", s.failed ? "bg-danger" : toolVerb(s.tool) === "delegate" ? "bg-primary-2" : "bg-primary")} />
                {latest ? <TypingText text={toolStepLabel(t, s.tool)} speed={16} /> : toolStepLabel(t, s.tool)}
                {s.failed ? <span className="ms-1 text-danger">· {t("guide.command.stepFailed")}</span> : null}
              </li>
            );
          })}
        </ol>
      ) : running ? (
        <p className="mt-3 text-xs text-muted-foreground">
          <TypingText text={t(task.status === "QUEUED" ? "guide.command.queued" : "guide.command.thinking")} speed={20} />
        </p>
      ) : null}

      {message.children.length ? (
        <div className="mt-3 grid gap-1.5">
          <p className="text-xs font-semibold">{t("guide.command.collaborators")}</p>
          <ul className="grid gap-1">
            {message.children.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                {isActive(c.status) ? <LiveDot tone="info" /> : <Check className="size-3 text-success" aria-hidden />}
                <span className="font-medium">{c.employeeName ?? t(`profiles.${c.profile}.name`)}</span>
                <span className="text-muted-foreground">· {t(`guide.phase.${workPhase(c)}`)}</span>
                <Link href={`/${locale}/tasks/${c.id}`} className="ms-auto text-primary hover:underline">
                  {t("guide.task.open")}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ApprovalList task={task} delegated={message.children} canDecide={canDecide} onDecide={onDecide} />

      {task.status === "FAILED" ? <p className="mt-3 text-sm text-danger">{task.errorMessage ?? t("guide.task.failed")}</p> : null}
      {task.output ? (
        <div className="mt-3 rounded-lg border bg-surface-2/60 p-3 animate-fade-in">
          <Markdown text={task.output} />
          <p className="mt-2 text-[11px] text-muted-foreground">{t("guide.task.review")}</p>
        </div>
      ) : null}
      <footer className="mt-3 flex flex-wrap gap-3 text-xs">
        <Link href={`/${locale}/tasks/${task.id}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
          {t("guide.task.open")} <ExternalLink className="size-3" aria-hidden />
        </Link>
      </footer>
    </article>
  );
}

function ApprovalList({ task, delegated, canDecide, onDecide }: { task: TaskView; delegated: TaskView[]; canDecide: boolean; onDecide: (id: string, d: "approve" | "reject") => Promise<void> }) {
  const { t, locale } = useI18n();
  const [pending, setPending] = useState<string | null>(null);
  const approvals = [...task.approvals, ...delegated.flatMap((c) => c.approvals)];
  if (!approvals.length) return null;
  return (
    <div className="mt-3 grid gap-1.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <ClipboardCheck className="size-3.5" aria-hidden />
        {t("guide.task.approvals", { count: approvals.length })}
      </p>
      <ul className="grid gap-1.5">
        {approvals.map((a) => (
          <li key={a.id} className="grid gap-1.5 rounded-md border bg-surface px-3 py-2 text-xs sm:flex sm:items-center sm:justify-between">
            <span className="min-w-0">{a.summary}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              {a.status === "PENDING" && canDecide ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    loading={pending === `${a.id}:approve`}
                    onClick={async () => {
                      setPending(`${a.id}:approve`);
                      await onDecide(a.id, "approve");
                      setPending(null);
                    }}
                  >
                    {t("guide.command.approve")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    loading={pending === `${a.id}:reject`}
                    onClick={async () => {
                      setPending(`${a.id}:reject`);
                      await onDecide(a.id, "reject");
                      setPending(null);
                    }}
                  >
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
