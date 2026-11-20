"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useSubmit, type Option } from "./objective-forms";

interface GoalFields {
  title: string;
  description: string;
  horizon: "QUARTER" | "YEAR";
  ownerId: string;
  pillarId: string;
  targetDate: string;
}

const emptyGoal: GoalFields = { title: "", description: "", horizon: "QUARTER", ownerId: "", pillarId: "", targetDate: "" };

function GoalFieldset({ prefix, v, set, people, pillars }: { prefix: string; v: GoalFields; set: (p: Partial<GoalFields>) => void; people: Option[]; pillars: Option[] }) {
  const t = useT();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("objectives.goals.title")} htmlFor={`${prefix}-title`} className="sm:col-span-2">
        <Input id={`${prefix}-title`} value={v.title} maxLength={300} required placeholder={t("objectives.goals.titlePlaceholder")} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label={t("objectives.description")} htmlFor={`${prefix}-desc`} className="sm:col-span-2">
        <Textarea id={`${prefix}-desc`} value={v.description} maxLength={4000} rows={3} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      <Field label={t("objectives.goals.horizon")} htmlFor={`${prefix}-horizon`}>
        <Select id={`${prefix}-horizon`} value={v.horizon} onChange={(e) => set({ horizon: e.target.value as GoalFields["horizon"] })}>
          <option value="QUARTER">{t("objectives.goals.horizons.QUARTER")}</option>
          <option value="YEAR">{t("objectives.goals.horizons.YEAR")}</option>
        </Select>
      </Field>
      <Field label={t("objectives.targetDate")} htmlFor={`${prefix}-target`} hint={t("objectives.goals.targetHint")}>
        <Input id={`${prefix}-target`} type="date" value={v.targetDate} onChange={(e) => set({ targetDate: e.target.value })} />
      </Field>
      <Field label={t("objectives.owner")} htmlFor={`${prefix}-owner`}>
        <Select id={`${prefix}-owner`} value={v.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
          <option value="">{t("objectives.goals.ownerDefault")}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("strategy.pillar")} htmlFor={`${prefix}-pillar`}>
        <Select id={`${prefix}-pillar`} value={v.pillarId} onChange={(e) => set({ pillarId: e.target.value })}>
          <option value="">{t("strategy.noPillar")}</option>
          {pillars.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

export function NewGoalForm({ base, locale, people, pillars, canPlan }: { base: string; locale: string; people: Option[]; pillars: Option[]; canPlan: boolean }) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = useState<GoalFields>(emptyGoal);
  const [plan, setPlan] = useState(canPlan);
  const { busy, error, submit } = useSubmit(async () => {
    const r = await api<{ goal: { id: string }; planError: { reason: string | null; code: string } | null }>(`${base}/goals`, { body: { ...v, plan: canPlan && plan } });
    if (canPlan && plan) router.push(`/${locale}/objectives/plan/${r.goal.id}${r.planError ? `?planError=${encodeURIComponent(r.planError.reason ?? r.planError.code)}` : ""}`);
  }, () => setV(emptyGoal));
  return (
    <form onSubmit={submit} className="grid gap-3 border-b p-3">
      <GoalFieldset prefix="goal-new" v={v} set={(p) => setV({ ...v, ...p })} people={people} pillars={pillars} />
      {canPlan ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={plan} onChange={(e) => setPlan(e.target.checked)} />
          {t("objectives.goals.planWithAi")}
        </label>
      ) : null}
      <div>
        <Button type="submit" disabled={busy || !v.title.trim()}>
          {plan && canPlan ? <Sparkles aria-hidden /> : <Plus aria-hidden />}
          {plan && canPlan ? t("objectives.goals.createAndPlan") : t("objectives.goals.create")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function EditGoalDialog({ base, goal, people, pillars }: { base: string; goal: { id: string } & GoalFields; people: Option[]; pillars: Option[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<GoalFields>(goal);
  const { busy, error, submit } = useSubmit(() => api(`${base}/goals/${goal.id}`, { method: "PATCH", body: v }));
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), o && setV(goal))}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={t("objectives.goals.edit")} title={t("objectives.goals.edit")}>
          <Pencil aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent title={t("objectives.goals.edit")} closeLabel={t("common.close")} className="max-w-2xl">
        <form onSubmit={async (e) => (await submit(e)) && setOpen(false)} className="grid gap-3">
          <GoalFieldset prefix={`goal-${goal.id}`} v={v} set={(p) => setV({ ...v, ...p })} people={people} pillars={pillars} />
          <FormError error={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !v.title.trim()}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function GoalStatusSelect({ base, goalId, status }: { base: string; goalId: string; status: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <span className="inline-grid gap-1">
      <Select
        aria-label={t("common.status")}
        className="h-8 w-auto text-xs"
        value={status}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          setError(null);
          try {
            await api(`${base}/goals/${goalId}`, { method: "PATCH", body: { status: e.target.value } });
            router.refresh();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        {["ACTIVE", "ACHIEVED", "ABANDONED"].map((s) => (
          <option key={s} value={s}>
            {t(`objectives.status.${s}`)}
          </option>
        ))}
      </Select>
      <FormError error={error} />
    </span>
  );
}

/** Start or regenerate the AI decomposition, with optional guidance for the AI. */
export function GeneratePlanButton({ base, goalId, regenerate = false }: { base: string; goalId: string; regenerate?: boolean }) {
  const t = useT();
  const [guidance, setGuidance] = useState("");
  const { busy, error, submit } = useSubmit(() => api(`${base}/goals/${goalId}/plan`, { body: { guidance: guidance || undefined } }), () => setGuidance(""));
  return (
    <form onSubmit={submit} className="grid gap-2">
      <Field label={t("objectives.plan.guidance")} htmlFor={`guidance-${goalId}`} hint={t("objectives.plan.guidanceHint")}>
        <Textarea id={`guidance-${goalId}`} rows={2} maxLength={1500} value={guidance} onChange={(e) => setGuidance(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" variant={regenerate ? "secondary" : "default"} disabled={busy}>
          <Sparkles aria-hidden />
          {regenerate ? t("objectives.plan.regenerate") : t("objectives.plan.generate")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}
