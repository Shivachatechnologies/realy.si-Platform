"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarCheck, Clock, Repeat, Sparkles, Zap } from "lucide-react";
import { FormError } from "@/components/form-error";
import { FlowSteps, ResumeNote, SavedIndicator } from "@/components/cockpit/flow-bits";
import { useGuidedDraft } from "@/components/cockpit/use-guided-draft";
import { AiAvatar } from "@/components/workforce/avatar";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const BRIEFING_PROFILES = ["ai_ceo", "bi_analyst"];
const WEEK = [1, 2, 3, 4, 5, 6, 0];
/** Ready-made recurring jobs per department (aiPlans.ideas.<id>.name / .body). */
const IDEAS: Record<string, string[]> = {
  executive: ["weekly_review", "morning_brief"],
  finance: ["cash_monday", "overdue_chase"],
  sales: ["pipeline_monday", "new_lead_research"],
  marketing: ["content_week", "campaign_check"],
  hr: ["people_pulse"],
  support: ["support_digest", "ticket_triage"],
  operations: ["ops_week"],
  research: ["kpi_week"],
};
const ideasFor = (dept: string) => [...(IDEAS[dept] ?? []), ...(dept === "executive" ? [] : IDEAS.executive!.slice(0, 1))];

export interface PlanEmployee {
  id: string;
  name: string;
  initials: string;
  profileKey: string;
  department: string;
}

/**
 * Plain-language plan editor: who → when → what, read back as one sentence ("Every Monday at 09:00, Ada (AI CFO) will
 * …") before it is saved as a real AI schedule. Answers are saved as you go.
 */
export function PlanComposer({ apiBase, employees, eventTypes, draft, timezone }: { apiBase: string; employees: PlanEmployee[]; eventTypes: readonly string[]; draft: { step: number; data: Record<string, unknown> } | null; timezone: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const defaults = useMemo(
    () => ({ aiEmployeeId: employees[0]?.id ?? "", when: "WEEKLY", weekday: 1, timeOfDay: "09:00", minute: "00", eventType: eventTypes[0] ?? "", name: "", instructions: "", briefingMode: "" }),
    [employees, eventTypes],
  );
  const d = useGuidedDraft(apiBase, "plans.editor", defaults, draft);
  const [reached, setReached] = useState(d.step);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<string | null>(null);
  const fields = error instanceof ApiError ? error.fieldErrors() : {};
  const v = d.data;
  const emp = employees.find((e) => e.id === v.aiEmployeeId) ?? employees[0];
  const when = String(v.when);
  const eventLabel = (ev: string) => (t(`timeline.events.${ev.replace(/\./g, "_")}`) === `timeline.events.${ev.replace(/\./g, "_")}` ? ev : t(`timeline.events.${ev.replace(/\./g, "_")}`));
  const whenText =
    when === "EVENT"
      ? t("aiPlans.sentence.event", { event: eventLabel(String(v.eventType)) })
      : when === "HOURLY"
        ? t("aiPlans.sentence.hourly", { minute: String(v.minute) })
        : when === "WEEKLY"
          ? t("aiPlans.sentence.weekly", { day: t(`plans.weekdays.${Number(v.weekday)}`), time: String(v.timeOfDay) })
          : t("aiPlans.sentence.daily", { time: String(v.timeOfDay) });
  const roleName = emp ? t(`profiles.${emp.profileKey}.name`) : "";
  const go = (i: number) => {
    d.setStep(i);
    setReached((r) => Math.max(r, i));
  };
  const steps = [t("aiPlans.composer.steps.who"), t("aiPlans.composer.steps.when"), t("aiPlans.composer.steps.what"), t("aiPlans.composer.steps.check")];
  const canNext = d.step === 0 ? !!emp : d.step === 1 ? (when === "EVENT" ? !!v.eventType : !!v.timeOfDay) : d.step === 2 ? !!String(v.name).trim() && !!String(v.instructions).trim() : true;

  async function save() {
    if (!emp) return;
    setBusy(true);
    setError(null);
    const recurring = when !== "EVENT";
    try {
      await api(`${apiBase}/workforce/schedules`, {
        body: {
          aiEmployeeId: emp.id,
          name: String(v.name).trim(),
          kind: recurring ? "RECURRING" : "EVENT",
          frequency: recurring ? when : null,
          timeOfDay: recurring ? (when === "HOURLY" ? `00:${v.minute}` : String(v.timeOfDay)) : null,
          weekday: when === "WEEKLY" ? Number(v.weekday) : null,
          eventType: recurring ? null : String(v.eventType),
          instructions: String(v.instructions).trim(),
          briefingMode: BRIEFING_PROFILES.includes(emp.profileKey) && v.briefingMode ? v.briefingMode : null,
          enabled: true,
        },
      });
      setCreated(String(v.name).trim());
      await d.clear();
      setReached(0);
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const option = (key: string, icon: React.ReactNode) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={when === key}
      onClick={() => d.set("when", key)}
      className={cn("hover-lift flex items-start gap-2 rounded-lg border bg-surface p-3 text-start text-sm", when === key && "border-primary ring-2 ring-primary/30")}
    >
      <span aria-hidden className="mt-0.5 text-primary [&_svg]:size-4">
        {icon}
      </span>
      <span className="grid gap-0.5">
        <span className="font-medium">{t(`aiPlans.composer.when.${key}`)}</span>
        <span className="text-xs text-muted-foreground">{t(`aiPlans.composer.when.${key}Hint`)}</span>
      </span>
    </button>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FlowSteps steps={steps} current={d.step} reached={reached} onGo={go} label={t("aiPlans.composer.title")} />
        <SavedIndicator state={d.saved} />
      </div>
      {created ? <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success" aria-live="polite">{t("aiPlans.composer.created", { name: created })}</p> : null}
      {d.resumed && d.step > 0 && !created ? <ResumeNote onReset={() => void d.clear().then(() => setReached(0))} /> : null}

      {d.step === 0 ? (
        <div className="grid gap-3 animate-fade-up">
          <h3 className="font-semibold">{t("aiPlans.composer.whoQ")}</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label={t("aiPlans.composer.whoQ")}>
            {employees.map((e) => (
              <button
                key={e.id}
                type="button"
                role="radio"
                aria-checked={emp?.id === e.id}
                onClick={() => d.set("aiEmployeeId", e.id)}
                className={cn("hover-lift flex items-center gap-3 rounded-lg border bg-surface p-3 text-start", emp?.id === e.id && "border-primary ring-2 ring-primary/30")}
              >
                <AiAvatar id={e.id} initials={e.initials} size="md" />
                <span className="grid min-w-0">
                  <span className="truncate font-medium">{e.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{t(`profiles.${e.profileKey}.name`)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {d.step === 1 ? (
        <div className="grid gap-3 animate-fade-up">
          <div>
            <h3 className="font-semibold">{t("aiPlans.composer.whenQ")}</h3>
            <p className="text-xs text-muted-foreground">{t("plans.timezoneNote", { tz: timezone })}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("aiPlans.composer.whenQ")}>
            {option("WEEKLY", <CalendarCheck />)}
            {option("DAILY", <Repeat />)}
            {option("HOURLY", <Clock />)}
            {option("EVENT", <Zap />)}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {when === "WEEKLY" ? (
              <Field label={t("plans.form.weekday")} htmlFor="pl-day">
                <Select id="pl-day" value={Number(v.weekday)} onChange={(e) => d.set("weekday", Number(e.target.value))}>
                  {WEEK.map((n) => (
                    <option key={n} value={n}>
                      {t(`plans.weekdays.${n}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {when === "WEEKLY" || when === "DAILY" ? (
              <Field label={t("plans.form.time")} htmlFor="pl-time">
                <Input id="pl-time" type="time" value={String(v.timeOfDay)} onChange={(e) => d.set("timeOfDay", e.target.value)} />
              </Field>
            ) : null}
            {when === "HOURLY" ? (
              <Field label={t("plans.form.minute")} htmlFor="pl-minute">
                <Select id="pl-minute" value={String(v.minute)} onChange={(e) => d.set("minute", e.target.value)}>
                  {["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"].map((m) => (
                    <option key={m} value={m}>
                      :{m}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {when === "EVENT" ? (
              <Field label={t("plans.form.event")} htmlFor="pl-event" hint={t("plans.form.eventHint")} className="sm:col-span-3">
                <Select id="pl-event" value={String(v.eventType)} onChange={(e) => d.set("eventType", e.target.value)}>
                  {eventTypes.map((ev) => (
                    <option key={ev} value={ev}>
                      {eventLabel(ev)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
        </div>
      ) : null}

      {d.step === 2 && emp ? (
        <div className="grid gap-3 animate-fade-up">
          <div>
            <h3 className="font-semibold">{t("aiPlans.composer.whatQ", { name: emp.name })}</h3>
            <p className="text-sm text-muted-foreground">{t("aiPlans.composer.whatHint")}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {ideasFor(emp.department).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => d.patch({ name: t(`aiPlans.ideas.${id}.name`), instructions: t(`aiPlans.ideas.${id}.body`) })}
                className="hover-lift flex items-start gap-2 rounded-md border bg-surface-2/60 p-2.5 text-start text-sm"
              >
                <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span className="grid gap-0.5">
                  <span className="font-medium">{t(`aiPlans.ideas.${id}.name`)}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{t(`aiPlans.ideas.${id}.body`)}</span>
                </span>
              </button>
            ))}
          </div>
          <Field label={t("plans.form.name")} htmlFor="pl-name" error={fields.name}>
            <Input id="pl-name" value={String(v.name)} maxLength={120} onChange={(e) => d.set("name", e.target.value)} />
          </Field>
          <Field label={t("plans.form.instructions")} htmlFor="pl-instr" hint={t("plans.form.instructionsHint")} error={fields.instructions}>
            <Textarea id="pl-instr" rows={5} maxLength={6000} value={String(v.instructions)} onChange={(e) => d.set("instructions", e.target.value)} />
          </Field>
          {BRIEFING_PROFILES.includes(emp.profileKey) ? (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">{t("aiPlans.composer.advanced")}</summary>
              <Field label={t("plans.form.briefing")} htmlFor="pl-brief" hint={t("plans.form.briefingHint")} className="mt-2">
                <Select id="pl-brief" value={String(v.briefingMode)} onChange={(e) => d.set("briefingMode", e.target.value)}>
                  <option value="">{t("plans.form.briefingNone")}</option>
                  {(["DAILY", "WEEKLY", "MONTHLY", "TREND_RISK"] as const).map((m) => (
                    <option key={m} value={m}>
                      {t(`intelligence.modes.${m}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </details>
          ) : null}
        </div>
      ) : null}

      {d.step === 3 && emp ? (
        <div className="grid gap-3 animate-fade-up">
          <h3 className="font-semibold">{t("aiPlans.composer.checkQ")}</h3>
          <blockquote className="rounded-lg border-gradient p-4 text-base leading-relaxed [--gradient-fill:var(--surface)]">
            {t("aiPlans.sentence.full", { when: whenText, name: emp.name, role: roleName, job: String(v.name) })}
          </blockquote>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{String(v.instructions)}</p>
          <p className="text-xs text-muted-foreground">{t("aiPlans.composer.safety")}</p>
          <FormError error={error} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {d.step > 0 ? (
          <Button type="button" variant="ghost" onClick={() => go(d.step - 1)}>
            <ArrowLeft aria-hidden className="rtl:-scale-x-100" /> {t("cockpit.back")}
          </Button>
        ) : null}
        {d.step < 3 ? (
          <Button type="button" onClick={() => go(d.step + 1)} disabled={!canNext}>
            {t("common.next")} <ArrowRight aria-hidden className="rtl:-scale-x-100" />
          </Button>
        ) : (
          <Button type="button" variant="gradient" onClick={save} disabled={busy} aria-busy={busy}>
            <CalendarCheck aria-hidden /> {busy ? t("common.saving") : t("aiPlans.composer.save")}
          </Button>
        )}
      </div>
    </div>
  );
}
