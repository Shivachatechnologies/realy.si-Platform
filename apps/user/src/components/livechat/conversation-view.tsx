"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Hand, Send, Undo2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { formatDateTime } from "@/i18n/format";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export interface ChatMessage {
  id: string;
  author: "VISITOR" | "AI" | "AGENT" | "SYSTEM";
  authorUserId: string | null;
  kind: string;
  body: string;
  meta: unknown;
  createdAt: string;
}

interface Poll {
  status: string;
  assigneeId: string | null;
  outcomes: string[];
  aiThinking: boolean;
  visitorOnline: boolean;
  messages: ChatMessage[];
}

const OUTCOMES = ["answered", "lead", "ticket", "meeting", "handoff", "knowledge_gap", "spam", "resolved", "follow_up"] as const;

/**
 * Live conversation: polls new messages every few seconds, lets a person reply (taking over from the AI), hand back to
 * the AI, close, and tag the outcome. Sends a "typing" signal while the person writes, shown in the visitor's widget.
 */
export function ConversationView({
  base,
  conversationId,
  initial,
  canManage,
  aiEnabled,
  names,
  viewerId,
}: {
  base: string;
  conversationId: string;
  initial: Poll;
  canManage: boolean;
  aiEnabled: boolean;
  names: Record<string, string>;
  viewerId: string;
}) {
  const { t, locale, timeZone } = useI18n();
  const router = useRouter();
  const path = `${base}/livechat/conversations/${conversationId}`;
  const [state, setState] = useState<Poll>(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);
  const last = state.messages.at(-1)?.createdAt;

  const poll = useCallback(async () => {
    try {
      const r = await api<Poll>(`${path}/poll${last ? `?after=${encodeURIComponent(last)}` : ""}`);
      setState((s) => {
        const known = new Set(s.messages.map((m) => m.id));
        const fresh = r.messages.filter((m) => !known.has(m.id));
        return { ...r, messages: fresh.length ? [...s.messages, ...fresh] : s.messages };
      });
    } catch {
      /* transient; next tick retries */
    }
  }, [path, last]);

  useEffect(() => {
    if (state.status === "CLOSED") return;
    const every = state.status === "HUMAN_ACTIVE" ? 2500 : 4000;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, every);
    return () => clearInterval(id);
  }, [poll, state.status]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages.length]);

  async function act(action: "take_over" | "return_to_ai" | "close") {
    setBusy(true);
    setError(null);
    try {
      await api(`${path}/actions`, { body: { action } });
      await poll();
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await api(`${path}/messages`, { body: { body } });
      setDraft("");
      await poll();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function onType(v: string) {
    setDraft(v);
    if (state.status === "HUMAN_ACTIVE" && Date.now() - lastTyping.current > 3000) {
      lastTyping.current = Date.now();
      void api(`${path}/actions`, { body: { action: "typing" } }).catch(() => undefined);
    }
  }

  async function toggleOutcome(o: string) {
    const next = state.outcomes.includes(o) ? state.outcomes.filter((x) => x !== o) : [...state.outcomes, o];
    setState((s) => ({ ...s, outcomes: next }));
    try {
      await api(`${path}/outcomes`, { method: "PUT", body: { outcomes: next } });
    } catch (err) {
      setError(err);
    }
  }

  const closed = state.status === "CLOSED";
  const mine = state.status === "HUMAN_ACTIVE" && state.assigneeId === viewerId;
  return (
    <div className="grid min-h-[60vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Badge tone={state.status === "WAITING_HUMAN" ? "warning" : state.status === "AI_ACTIVE" ? "brand" : state.status === "HUMAN_ACTIVE" ? "info" : "neutral"} shape="pill" pulse={state.status === "WAITING_HUMAN"}>
          {t(`livechat.status.${state.status}`)}
        </Badge>
        {state.status === "HUMAN_ACTIVE" && state.assigneeId ? <span className="text-xs text-muted-foreground">{t("livechat.view.handledBy", { name: names[state.assigneeId] ?? t("livechat.authors.AGENT") })}</span> : null}
        <span className="text-xs text-muted-foreground">{state.visitorOnline ? t("livechat.view.visitorOnline") : t("livechat.view.visitorAway")}</span>
        <span className="ms-auto flex flex-wrap gap-2">
          {canManage && !closed && !mine ? (
            <Button size="sm" disabled={busy} onClick={() => void act("take_over")}>
              <Hand className="size-4" aria-hidden />
              {t("livechat.view.takeOver")}
            </Button>
          ) : null}
          {canManage && !closed && aiEnabled && state.status !== "AI_ACTIVE" ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act("return_to_ai")}>
              <Undo2 className="size-4" aria-hidden />
              {t("livechat.view.returnToAi")}
            </Button>
          ) : null}
          {canManage && !closed ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act("close")}>
              <X className="size-4" aria-hidden />
              {t("livechat.view.close")}
            </Button>
          ) : null}
        </span>
      </div>

      <div ref={logRef} className="grid content-start gap-2 overflow-y-auto bg-surface-2/40 p-4" role="log" aria-live="polite" aria-label={t("livechat.view.transcript")} tabIndex={0}>
        {state.messages.map((m) => (
          <Message key={m.id} m={m} names={names} locale={locale} timeZone={timeZone} />
        ))}
        {state.aiThinking ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Bot className="size-3.5" aria-hidden />
            {t("livechat.view.aiThinking")}
          </p>
        ) : null}
      </div>

      <div className="grid gap-2 border-t p-3">
        {canManage ? (
          <div className="flex flex-wrap gap-1" role="group" aria-label={t("livechat.view.outcomes")}>
            {OUTCOMES.map((o) => (
              <button
                key={o}
                type="button"
                aria-pressed={state.outcomes.includes(o)}
                onClick={() => void toggleOutcome(o)}
                className={cn("rounded-full border px-2 py-0.5 text-xs", state.outcomes.includes(o) ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {t(`livechat.outcomes.${o}`)}
              </button>
            ))}
          </div>
        ) : null}
        {canManage && !closed ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <Textarea
              value={draft}
              maxLength={4000}
              rows={2}
              placeholder={state.status === "HUMAN_ACTIVE" ? t("livechat.view.replyPlaceholder") : t("livechat.view.replyTakesOver")}
              aria-label={t("livechat.view.reply")}
              onChange={(e) => onType(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              className="min-h-[2.75rem] flex-1"
            />
            <Button type="submit" disabled={busy || !draft.trim()} aria-label={t("livechat.view.send")}>
              <Send className="size-4" aria-hidden />
            </Button>
          </form>
        ) : closed ? (
          <p className="text-sm text-muted-foreground">{t("livechat.view.closedNote")}</p>
        ) : null}
        <FormError error={error} />
      </div>
    </div>
  );
}

function Message({ m, names, locale, timeZone }: { m: ChatMessage; names: Record<string, string>; locale: string; timeZone: string }) {
  const { t } = useI18n();
  const time = formatDateTime(m.createdAt, locale, timeZone);
  if (m.kind === "contact_request") return <p className="justify-self-center text-xs text-muted-foreground">{t("livechat.view.contactRequested")}</p>;
  if (m.author === "SYSTEM") {
    const number = m.meta && typeof m.meta === "object" ? String((m.meta as Record<string, unknown>).number ?? "") : "";
    return (
      <p className="justify-self-center rounded-full bg-muted px-3 py-0.5 text-center text-xs text-muted-foreground">
        {t(`livechat.events.${m.body}`, { number })} · <time dateTime={m.createdAt}>{time}</time>
      </p>
    );
  }
  const visitor = m.author === "VISITOR";
  const meta = m.meta && typeof m.meta === "object" ? (m.meta as { sources?: { ref: string; title: string; type: string }[]; actions?: { action: string; ok: boolean }[] }) : {};
  return (
    <div className={cn("grid max-w-[85%] gap-1", visitor ? "justify-self-start" : "justify-self-end")}>
      <span className={cn("text-[11px] text-muted-foreground", visitor ? "" : "text-end")}>
        {m.author === "AGENT" ? names[m.authorUserId ?? ""] || t("livechat.authors.AGENT") : t(`livechat.authors.${m.author}`)} · <time dateTime={m.createdAt}>{time}</time>
      </span>
      <div className={cn("whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm", visitor ? "border bg-surface" : m.author === "AI" ? "bg-primary/10" : "bg-info/10")}>{m.body}</div>
      {meta.sources?.length || meta.actions?.length ? (
        <div className="flex flex-wrap justify-end gap-1">
          {meta.sources?.map((s) => (
            <Badge key={s.ref} tone="neutral">
              {t(`livechat.view.source.${s.type}`)}: {s.title}
            </Badge>
          ))}
          {meta.actions?.map((a, i) => (
            <Badge key={`${a.action}-${i}`} tone={a.ok ? "success" : "danger"}>
              {t(`livechat.view.action.${a.action}`)}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
