"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";

/** Ask the AI CEO a question: a new thread (or a follow-up in `conversationId`), with suggested questions. */
export function AskCeoForm({ apiBase, conversationId, suggestions = [], compact = false }: { apiBase: string; conversationId?: string; suggestions?: string[]; compact?: boolean }) {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fields = error instanceof ApiError ? error.fieldErrors() : {};

  async function ask(q: string) {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ conversationId: string }>(`${apiBase}/intelligence/conversations`, { body: { question: q, ...(conversationId ? { conversationId } : {}) } });
      setQuestion("");
      if (conversationId) router.refresh();
      else router.push(`/${locale}/intelligence/ceo?c=${r.conversationId}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void ask(question);
  }

  return (
    <div className="grid gap-2">
      <form onSubmit={submit} className="grid gap-2">
        <label htmlFor={`ask-${conversationId ?? "new"}`} className="sr-only">
          {t("intelligence.chat.placeholder")}
        </label>
        <Textarea
          id={`ask-${conversationId ?? "new"}`}
          rows={compact ? 2 : 3}
          maxLength={4000}
          value={question}
          placeholder={conversationId ? t("intelligence.chat.followUp") : t("intelligence.chat.placeholder")}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void ask(question);
            }
          }}
        />
        {fields.question ? <p className="text-xs text-danger">{fields.question}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={busy || question.trim().length < 2}>
            <Send aria-hidden className="rtl:-scale-x-100" />
            {busy ? t("intelligence.chat.asking") : t("intelligence.chat.ask")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("intelligence.chat.shortcut")}</span>
        </div>
      </form>
      {suggestions.length ? (
        <div className="flex flex-wrap gap-1.5" aria-label={t("intelligence.chat.suggested")}>
          {suggestions.map((s) => (
            <button key={s} type="button" disabled={busy} onClick={() => void ask(s)} className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
      ) : null}
      <FormError error={error} />
    </div>
  );
}
