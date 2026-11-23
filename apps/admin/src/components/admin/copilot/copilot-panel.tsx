"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowUpRight, Send, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SkeletonText } from "@/components/ui/skeleton";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";

interface Source {
  ref: string;
  tool: string;
  summary: string;
  records: { label: string; href: string; detail?: string }[];
  unavailable?: string;
}
interface Answer {
  answer: string;
  model: string;
  sources: Source[];
}
interface Turn {
  question: string;
  answer?: Answer;
  error?: unknown;
}

/**
 * Read-only Admin Copilot conversation. Answers cite tool results ([T1]…); every source lists the console records it
 * read, linked. The copilot never acts: links open the page where the existing, confirmed action lives.
 */
export function CopilotPanel({ base, suggestions }: { base: string; suggestions: string[] }) {
  const { t } = useI18n();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const ask = async (question: string) => {
    const text = question.trim();
    if (text.length < 3 || busy) return;
    setBusy(true);
    setQ("");
    const history = turns.flatMap((x) => (x.answer ? [{ role: "user" as const, text: x.question.slice(0, 4000) }, { role: "assistant" as const, text: x.answer.answer.slice(0, 4000) }] : [])).slice(-8);
    setTurns((cur) => [...cur, { question: text }]);
    try {
      const r = await api<Answer>("/api/v1/admin/copilot", { method: "POST", body: { question: text, history } });
      setTurns((cur) => cur.map((x, i) => (i === cur.length - 1 ? { ...x, answer: r } : x)));
    } catch (err) {
      setTurns((cur) => cur.map((x, i) => (i === cur.length - 1 ? { ...x, error: err } : x)));
    } finally {
      setBusy(false);
      requestAnimationFrame(() => end.current?.scrollIntoView({ block: "end", behavior: "smooth" }));
    }
  };
  return (
    <div className="grid gap-4">
      {turns.length === 0 ? (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => void ask(s)} className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-2">
              {s}
            </button>
          ))}
        </div>
      ) : null}
      <ol className="grid gap-4" aria-live="polite">
        {turns.map((turn, i) => (
          <li key={i} className="grid gap-2">
            <p className="justify-self-end rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground">{turn.question}</p>
            {turn.answer ? (
              <div className="grid gap-3 rounded-lg border bg-surface p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="size-3.5 text-primary" aria-hidden />
                  {t("admin.copilot.answeredBy", { model: turn.answer.model })}
                </div>
                <div className="text-sm whitespace-pre-wrap">{turn.answer.answer}</div>
                {turn.answer.sources.length ? (
                  <div className="grid gap-2 border-t pt-3">
                    <p className="text-xs font-medium">{t("admin.copilot.sources")}</p>
                    {turn.answer.sources.map((s) => (
                      <div key={s.ref} className="grid gap-1 text-xs">
                        <div className="flex items-center gap-2">
                          <Badge tone="accent" className="font-mono">
                            {s.ref}
                          </Badge>
                          <span className="font-mono">{s.tool}</span>
                          {s.unavailable ? <Badge tone="warning">{s.unavailable}</Badge> : null}
                        </div>
                        <ul className="flex flex-wrap gap-1.5 ps-1">
                          {s.records.slice(0, 8).map((r) => (
                            <li key={r.href + r.label}>
                              <Link href={`${base}${r.href}`} className="inline-flex items-center gap-1 rounded border px-2 py-0.5 hover:bg-muted">
                                {r.label}
                                {r.detail ? <span className="text-muted-foreground">· {r.detail}</span> : null}
                                <ArrowUpRight className="size-3 rtl:-scale-x-100" aria-hidden />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("admin.copilot.noSources")}</p>
                )}
              </div>
            ) : turn.error ? (
              <FormError error={turn.error} />
            ) : (
              <div className="rounded-lg border bg-surface p-4" aria-busy="true">
                <SkeletonText rows={3} />
              </div>
            )}
          </li>
        ))}
      </ol>
      <div ref={end} />
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <Textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(q);
            }
          }}
          maxLength={2000}
          rows={3}
          aria-label={t("admin.copilot.ask")}
          placeholder={t("admin.copilot.placeholder")}
        />
        <div className="flex items-center justify-between gap-2">
          <Notice className="flex-1 py-1.5 text-xs">{t("admin.copilot.readOnly")}</Notice>
          <Button type="submit" disabled={busy || q.trim().length < 3}>
            <Send />
            {t("admin.copilot.ask")}
          </Button>
        </div>
      </form>
    </div>
  );
}
