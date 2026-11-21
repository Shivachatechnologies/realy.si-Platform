"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";

/** "Ask the CEO": the AI CEO takes the request as a real command run (it decides and delegates), then AI Command opens it. */
export function CeoAsk({ base, suggestions, disabled }: { base: string; suggestions: string[]; disabled: string | null }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(value: string) {
    const command = value.trim();
    if (command.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api<{ id: string }>(`${base}/guide/command`, { body: { text: command, mode: "ceo", locale } });
      router.push(`/${locale}/command?s=${s.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(text);
      }}
    >
      <label htmlFor="ceo-ask" className="sr-only">
        {t("command.ceo.ask.label")}
      </label>
      <div className="flex flex-col gap-2 rounded-2xl border bg-surface p-2 shadow-elev-1 sm:flex-row sm:items-end">
        <textarea
          id="ceo-ask"
          rows={2}
          maxLength={2000}
          value={text}
          disabled={!!disabled || busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(text);
            }
          }}
          placeholder={t("command.ceo.ask.placeholder")}
          className="min-h-14 w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" loading={busy} disabled={!!disabled || text.trim().length < 2}>
          <Send aria-hidden className="rtl:-scale-x-100" />
          {t("command.ceo.ask.submit")}
        </Button>
      </div>
      {disabled ? <p className="text-xs text-muted-foreground">{disabled}</p> : null}
      {!disabled && suggestions.length ? (
        <ul className="flex flex-wrap gap-2" aria-label={t("command.ceo.ask.suggestions")}>
          {suggestions.map((s) => (
            <li key={s}>
              <button type="button" disabled={busy} onClick={() => void submit(s)} className="min-h-9 rounded-full border bg-surface px-3 text-xs hover:border-primary/40 hover:text-primary">
                {s}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <FormError error={error} /> : null}
    </form>
  );
}
