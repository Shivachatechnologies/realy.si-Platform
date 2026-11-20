"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

type Mode = "DAILY" | "WEEKLY" | "MONTHLY" | "TREND_RISK";

/** "Generate now": creates a briefing (an AI task) for the chosen mode. */
export function BriefingForm({ apiBase, modes, profile, defaultMode }: { apiBase: string; modes: readonly Mode[]; profile?: "ai_ceo" | "bi_analyst"; defaultMode?: Mode }) {
  const t = useT();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(defaultMode ?? modes[0]!);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`${apiBase}/intelligence/briefings`, { body: { mode, ...(profile ? { profile } : {}) } });
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="briefing-mode" className="sr-only">
          {t("intelligence.mode")}
        </label>
        <Select id="briefing-mode" className="h-8 w-56" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          {modes.map((m) => (
            <option key={m} value={m}>
              {t(`intelligence.modes.${m}`)}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" disabled={busy}>
          <Sparkles aria-hidden />
          {busy ? t("intelligence.generating") : t("intelligence.generate")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}
