"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useAction } from "@/components/comms/client";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const STAGES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL"] as const;
const LABELS = ["HOT", "WARM", "NURTURE"] as const;

/** Plan an autonomous calling run: plain-language goal + criteria. Planning calls nobody. */
export function RunPlanner({ base, locale, agents }: { base: string; locale: string; agents: { id: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const { busy, error, run } = useAction();
  const [f, setF] = useState({ goal: "", purpose: "", agentId: agents[0]?.id ?? "", stages: ["QUALIFIED"] as string[], labels: [] as string[], minScore: "", maxCalls: 100, cooldownDays: 14, consent: "lawful_basis", maxConcurrent: 2, qualifiedOnly: false });
  const toggle = (k: "stages" | "labels", v: string) => setF((p) => ({ ...p, [k]: p[k].includes(v) ? p[k].filter((x) => x !== v) : [...p[k], v] }));
  if (!agents.length) return <Notice tone="warning">{t("voice.runs.noAgent")}</Notice>;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () =>
            api<{ runId: string }>(`${base}/voice/runs`, {
              method: "POST",
              body: {
                goal: f.goal,
                purpose: f.purpose,
                agentId: f.agentId || undefined,
                maxConcurrent: f.maxConcurrent,
                criteria: { stages: f.stages, labels: f.labels, ...(f.minScore !== "" ? { minScore: Number(f.minScore) } : {}), maxCalls: f.maxCalls, cooldownDays: f.cooldownDays, consent: f.consent, qualifiedOnly: f.qualifiedOnly },
              },
            }),
          (r) => router.push(`/${locale}/voice/campaigns/runs/${r.runId}`),
        );
      }}
    >
      <Field label={t("voice.runs.goal")} htmlFor="run-goal" hint={t("voice.runs.goalHint")}>
        <Input id="run-goal" required minLength={3} maxLength={500} value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} placeholder={t("voice.runs.goalPlaceholder")} />
      </Field>
      <Field label={t("voice.runs.purpose")} htmlFor="run-purpose" hint={t("voice.runs.purposeHint")}>
        <Textarea id="run-purpose" required minLength={3} maxLength={600} rows={3} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder={t("voice.runs.purposePlaceholder")} />
      </Field>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-[13px] font-medium">{t("voice.runs.stages")}</legend>
        <div className="flex flex-wrap gap-1.5">
          {STAGES.map((s) => (
            <button key={s} type="button" aria-pressed={f.stages.includes(s)} onClick={() => toggle("stages", s)} className={cn("rounded-md border px-2.5 py-1.5 text-sm", f.stages.includes(s) ? "border-primary bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted")}>
              {t(`voice.campaigns.stage.${s}`)}
            </button>
          ))}
          {LABELS.map((s) => (
            <button key={s} type="button" aria-pressed={f.labels.includes(s)} onClick={() => toggle("labels", s)} className={cn("rounded-md border border-dashed px-2.5 py-1.5 text-sm", f.labels.includes(s) ? "border-primary bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted")}>
              {t(`voice.runs.labels.${s}`)}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("voice.runs.minScore")} htmlFor="run-score">
          <Input id="run-score" type="number" min={0} max={100} value={f.minScore} onChange={(e) => setF({ ...f, minScore: e.target.value })} placeholder="60" />
        </Field>
        <Field label={t("voice.runs.maxCalls")} htmlFor="run-max">
          <Input id="run-max" type="number" min={1} max={200} required value={f.maxCalls} onChange={(e) => setF({ ...f, maxCalls: Number(e.target.value) })} />
        </Field>
        <Field label={t("voice.runs.cooldown")} htmlFor="run-cool">
          <Input id="run-cool" type="number" min={0} max={90} required value={f.cooldownDays} onChange={(e) => setF({ ...f, cooldownDays: Number(e.target.value) })} />
        </Field>
        <Field label={t("voice.runs.concurrency")} htmlFor="run-conc">
          <Input id="run-conc" type="number" min={1} max={10} required value={f.maxConcurrent} onChange={(e) => setF({ ...f, maxConcurrent: Number(e.target.value) })} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("voice.runs.agent")} htmlFor="run-agent">
          <Select id="run-agent" value={f.agentId} onChange={(e) => setF({ ...f, agentId: e.target.value })}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label={t("voice.runs.consent")} htmlFor="run-consent" hint={t("voice.runs.consentHint")}>
          <Select id="run-consent" value={f.consent} onChange={(e) => setF({ ...f, consent: e.target.value })}>
            <option value="lawful_basis">{t("voice.runs.consentLawful")}</option>
            <option value="recorded_only">{t("voice.runs.consentRecorded")}</option>
          </Select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={f.qualifiedOnly} onChange={(e) => setF({ ...f, qualifiedOnly: e.target.checked })} />
        {t("voice.runs.qualifiedOnly")}
      </label>
      <Notice tone="info">{t("voice.runs.planNote")}</Notice>
      <FormError error={error} />
      <div>
        <Button type="submit" disabled={busy || !f.stages.length} aria-busy={busy}>
          <Sparkles aria-hidden />
          {t("voice.runs.plan")}
        </Button>
      </div>
    </form>
  );
}

/** Start (files the single approval) or cancel a run. */
export function RunActions({ base, runId, status, canPost, people }: { base: string; runId: string; status: string; canPost: boolean; people: number }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [result, setResult] = useState<string | null>(null);
  if (!canPost) return null;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {status === "PLANNED" ? (
          <Button type="button" disabled={busy || !people} aria-busy={busy} onClick={() => void run(() => api<{ status: string }>(`${base}/voice/runs/${runId}/start`, { method: "POST", body: {} }), (r) => setResult(r.status))}>
            <Play aria-hidden />
            {t("voice.runs.start", { count: people })}
          </Button>
        ) : null}
        {["PLANNED", "AWAITING_APPROVAL", "RUNNING"].includes(status) ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => window.confirm(t("voice.runs.cancelConfirm")) && void run(() => api(`${base}/voice/runs/${runId}/cancel`, { method: "POST", body: {} }))}>
            <XCircle aria-hidden />
            {t("voice.runs.cancel")}
          </Button>
        ) : null}
      </div>
      {result ? <p className="text-sm text-success" role="status">{t(result === "AWAITING_APPROVAL" ? "voice.runs.filed" : "voice.runs.startedNow")}</p> : null}
      <FormError error={error} />
    </div>
  );
}
