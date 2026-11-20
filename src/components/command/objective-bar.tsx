"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";

/**
 * The primary command: the founder types a goal; it becomes a company goal and (when AI is available) an AI
 * decomposition task. The plan is reviewed and applied by a person on /objectives/plan/<goalId>.
 */
export function ObjectiveBar({ base, locale, canManage, canPlan, note }: { base: string | null; locale: string; canManage: boolean; canPlan: boolean; note?: string | null }) {
  const t = useT();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [horizon, setHorizon] = useState<"QUARTER" | "YEAR">("QUARTER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const enabled = !!base && canManage;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!enabled || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ goal: { id: string }; planError: { reason: string | null; code: string } | null }>(`${base}/goals`, { body: { title: title.trim(), horizon, plan: canPlan } });
      const q = r.planError ? `?planError=${encodeURIComponent(r.planError.reason ?? r.planError.code)}` : "";
      router.push(`/${locale}/objectives/plan/${r.goal.id}${q}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="size-4 text-primary" aria-hidden />
        <h2 className="text-base font-semibold tracking-tight">{t("command.objectivePrompt")}</h2>
        <Link href={`/${locale}/objectives/goals`} className="ms-auto text-xs text-muted-foreground hover:underline">
          {t("command.allGoals")}
        </Link>
      </div>
      {enabled ? (
        <form onSubmit={submit} className="grid gap-2" aria-describedby="objective-note">
          <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 focus-within:border-ring">
            <label htmlFor="objective" className="sr-only">
              {t("command.objectivePrompt")}
            </label>
            <input
              id="objective"
              value={title}
              maxLength={300}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("command.objectivePlaceholder")}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <select aria-label={t("objectives.goals.horizon")} value={horizon} onChange={(e) => setHorizon(e.target.value as "QUARTER" | "YEAR")} className="rounded-sm bg-transparent text-xs text-muted-foreground outline-none">
              <option value="QUARTER">{t("objectives.goals.horizons.QUARTER")}</option>
              <option value="YEAR">{t("objectives.goals.horizons.YEAR")}</option>
            </select>
            <button type="submit" disabled={busy || !title.trim()} className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40" aria-label={t("command.planObjective")}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
            </button>
          </div>
          <p id="objective-note" className="text-xs text-muted-foreground">
            {canPlan ? t("command.objectiveHint") : (note ?? t("command.objectiveNoAi"))}
          </p>
          <FormError error={error} />
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">{base ? t("command.objectiveForbidden") : t("command.noCompany")}</p>
      )}
    </div>
  );
}
