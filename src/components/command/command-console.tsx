"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { History, MessageSquarePlus, Send, Sparkles, Trash2, X } from "lucide-react";
import { AiCore, AnimatedProgress, LiveDot } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { MicButton } from "@/components/guide/voice-input";
import { isActive } from "@/components/guide/phase";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { CommandSessionView } from "@/server/modules/guide/command";
import { CommandRunCard } from "./run-view";
import { StageRail, STAGE_ORDER } from "./stage-rail";

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
const OPEN_RUN = new Set(["PLANNED", "RUNNING", "REVIEWING"]);

/** Live while any run is open or any step's (or delegated) task is still queued/running. */
function isLive(s: CommandSessionView | null) {
  if (!s) return false;
  return (
    s.runs.some((r) => OPEN_RUN.has(r.status) || r.steps.some((st) => (st.task && isActive(st.task.status)) || st.children.some((c) => isActive(c.status)))) ||
    s.messages.some((m) => (m.task && isActive(m.task.status)) || m.children.some((c) => isActive(c.status)))
  );
}

/**
 * AI Command — the company's central operating console. A command is understood (intents, company facts, matching
 * knowledge), planned (persisted steps), delegated to AI employees as real tasks, executed through permissioned tools
 * with approvals, reviewed and completed with a recommended next action. Every stage shown comes from stored rows.
 */
export function CommandConsole({ base, initialSessionId, initialQuery, autoRun }: { base: string; initialSessionId: string | null; initialQuery: string | null; autoRun: boolean }) {
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
  const [bootKey, setBootKey] = useState(0);
  const autoRan = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const loadBoot = useCallback(() => setBootKey((k) => k + 1), []);

  useEffect(() => {
    let stop = false;
    api<Bootstrap>(`${base}/guide/command`)
      .then((d) => !stop && setBoot(d))
      .catch((err: unknown) => !stop && setError(err));
    return () => {
      stop = true;
    };
  }, [base, bootKey]);

  // Load the open session; keep polling while its AI work is live (the server also advances waiting steps on read).
  useEffect(() => {
    if (!sessionId) return;
    let stop = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const s = await api<CommandSessionView>(`${base}/guide/command/${sessionId}`);
        if (stop) return;
        setSession(s);
        if (isLive(s)) timer = window.setTimeout(tick, POLL_MS);
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
  }, [base, sessionId, session?.updatedAt]);

  const count = (session?.runs.length ?? 0) + (session?.messages.length ?? 0);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "end" });
  }, [count]);

  const openSession = (id: string | null) => {
    setSessionId(id);
    if (!id) setSession(null);
    setHistoryOpen(false);
    router.replace(id ? `${pathname}?s=${id}` : pathname, { scroll: false });
  };

  const submit = useCallback(
    async (e?: FormEvent, override?: string) => {
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
    },
    [base, busy, loadBoot, locale, pathname, router, sessionId, text],
  );

  const aiBlocked = boot ? (!boot.ai.configured ? "notConfigured" : !boot.ai.canRun ? "forbidden" : null) : null;

  // "Run" from the Command Center / insights hands the command over with ?q=…&run=1.
  useEffect(() => {
    if (!autoRun || autoRan.current || !boot || aiBlocked || !initialQuery || initialSessionId) return;
    autoRan.current = true;
    void submit(undefined, initialQuery);
  }, [autoRun, boot, aiBlocked, initialQuery, initialSessionId, submit]);

  const refresh = async () => {
    if (sessionId) setSession(await api<CommandSessionView>(`${base}/guide/command/${sessionId}`));
  };
  const decide = async (approvalId: string, decision: "approve" | "reject") => {
    try {
      await api(`${base}/approvals/${approvalId}/decision`, { body: { decision } });
      await refresh();
    } catch (err) {
      setError(err);
    }
  };
  const cancel = async (runId: string) => {
    if (!sessionId) return;
    try {
      setSession(await api<CommandSessionView>(`${base}/guide/command/${sessionId}/runs/${runId}/cancel`, { method: "POST" }));
    } catch (err) {
      setError(err);
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
  const followUp = (next: string) => {
    setText(next);
    inputRef.current?.focus();
  };

  const live = isLive(session);
  const runByMessage = new Map((session?.runs ?? []).map((r) => [r.messageId, r]));
  // Commands given before plans existed answer with ASSISTANT messages that follow their USER message.
  const legacy = new Map<string, CommandSessionView["messages"]>();
  let lastUser: string | null = null;
  for (const m of session?.messages ?? []) {
    if (m.role === "USER") lastUser = m.id;
    else if (lastUser) legacy.set(lastUser, [...(legacy.get(lastUser) ?? []), m]);
  }

  return (
    <div className="relative grid min-h-[calc(100dvh-7rem)] gap-4 lg:grid-cols-[17rem_1fr]">
      <aside
        className={cn(
          "glass fixed inset-y-0 start-0 z-50 w-72 max-w-[85vw] border-e p-3 shadow-elev-4 transition-transform duration-300 motion-reduce:transition-none lg:static lg:z-auto lg:w-auto lg:max-w-none lg:translate-x-0 lg:rounded-2xl lg:border lg:shadow-elev-1",
          historyOpen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full lg:rtl:translate-x-0",
        )}
        aria-label={t("guide.command.history")}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <History className="size-4" aria-hidden />
            {t("guide.command.history")}
          </h2>
          <button type="button" className="grid size-9 place-items-center rounded text-muted-foreground hover:bg-muted lg:hidden" onClick={() => setHistoryOpen(false)} aria-label={t("guide.close")}>
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
                className={cn("min-h-9 min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-start text-sm hover:bg-muted", s.id === sessionId && "bg-accent text-accent-foreground")}
              >
                {s.title}
              </button>
              <button type="button" onClick={() => void remove(s.id)} className="grid size-9 place-items-center rounded text-muted-foreground opacity-60 hover:text-danger group-hover:opacity-100" aria-label={t("guide.command.delete", { title: s.title })}>
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="relative flex min-w-0 flex-col overflow-hidden rounded-2xl border glass shadow-elev-2">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <button type="button" className="grid size-9 place-items-center rounded text-muted-foreground hover:bg-muted lg:hidden" onClick={() => setHistoryOpen(true)} aria-label={t("guide.command.history")}>
            <History className="size-4" aria-hidden />
          </button>
          <h1 className="font-display text-base tracking-tight">{t("guide.command.title")}</h1>
          {live ? (
            <span className="ms-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <LiveDot tone="info" />
              {t("guide.command.working")}
            </span>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 sm:px-6" aria-live="polite">
          {!session ? (
            <div className="mx-auto grid max-w-2xl justify-items-center gap-6 py-4 text-center">
              <AiCore className="size-44 sm:size-56" />
              <div className="grid gap-2 animate-fade-up">
                <h2 className="font-display text-3xl tracking-[-0.02em] sm:text-4xl">
                  <span className="text-gradient">{t("guide.command.headline")}</span>
                </h2>
                <p className="text-sm text-muted-foreground">{t("guide.command.subline")}</p>
              </div>
              <HowItWorks />
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
                        className="hover-lift min-h-10 rounded-full border bg-surface/80 px-3.5 py-2 text-sm shadow-elev-1 hover:border-primary/50 disabled:opacity-50"
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
            <div className="mx-auto grid max-w-4xl gap-10">
              {session.messages
                .filter((m) => m.role === "USER")
                .map((m) => {
                  const run = runByMessage.get(m.id);
                  if (run) return <CommandRunCard key={m.id} run={run} canDecide={session.canDecide} onDecide={decide} onCancel={cancel} onFollowUp={followUp} />;
                  const assigned = legacy.get(m.id) ?? [];
                  return (
                    <section key={m.id} className="grid gap-3">
                      <div className="ms-auto max-w-[88%] rounded-2xl rounded-ee-sm bg-brand-gradient px-4 py-2.5 text-sm text-primary-foreground">{m.content}</div>
                      <ul className="grid gap-2">
                        {assigned.map((a) => (
                          <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border bg-surface p-3 text-sm">
                            <span className="font-medium">{a.task?.employeeName ?? (a.profile ? t(`profiles.${a.profile}.name`) : t("guide.command.aiEmployee"))}</span>
                            <span className="text-xs text-muted-foreground">{a.task ? t(`guide.task.status.${a.task.status}`) : a.errorReason}</span>
                            {a.task ? (
                              <Link href={`/${locale}/tasks/${a.task.id}`} className="ms-auto text-xs font-medium text-primary hover:underline">
                                {t("guide.task.open")}
                              </Link>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
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
              className="max-h-40 min-h-12 flex-1 resize-none rounded-xl border bg-surface px-3 py-2.5 text-base shadow-elev-1 outline-none focus-visible:ring-2 focus-visible:ring-primary/50 sm:text-sm"
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

/** Plain-language explanation of the pipeline (a static legend of the stages, not progress). */
function HowItWorks() {
  const { t } = useI18n();
  const legend = Object.fromEntries(STAGE_ORDER.map((k) => [k, "pending" as const])) as Record<(typeof STAGE_ORDER)[number], "pending">;
  return (
    <div className="grid w-full gap-3 rounded-2xl border bg-surface/70 p-4 text-start">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("command.ai.howTitle")}</p>
      <StageRail stages={legend} details={Object.fromEntries(STAGE_ORDER.map((k) => [k, t(`command.ai.how.${k}`)]))} />
    </div>
  );
}
