"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";

export interface ScheduleValues {
  aiEmployeeId: string;
  name: string;
  kind: "RECURRING" | "EVENT";
  frequency: "HOURLY" | "DAILY" | "WEEKLY";
  timeOfDay: string;
  weekday: number;
  eventType: string;
  instructions: string;
  briefingMode: "" | "DAILY" | "WEEKLY" | "MONTHLY" | "TREND_RISK";
  enabled: boolean;
}

const BRIEFING_PROFILES = ["ai_ceo", "bi_analyst"];

/** Create or edit an AI schedule (recurring job or event trigger). */
export function ScheduleForm({
  apiBase,
  employees,
  eventTypes,
  scheduleId,
  initial,
  onDone,
}: {
  apiBase: string;
  employees: { id: string; name: string; profileKey: string }[];
  eventTypes: readonly string[];
  scheduleId?: string;
  initial?: Partial<ScheduleValues>;
  onDone?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = useState<ScheduleValues>({
    aiEmployeeId: employees[0]?.id ?? "",
    name: "",
    kind: "RECURRING",
    frequency: "DAILY",
    timeOfDay: "09:00",
    weekday: 1,
    eventType: eventTypes[0] ?? "",
    instructions: "",
    briefingMode: "",
    enabled: true,
    ...initial,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fields = error instanceof ApiError ? error.fieldErrors() : {};
  const set = <K extends keyof ScheduleValues>(k: K, val: ScheduleValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const employee = employees.find((e) => e.id === v.aiEmployeeId);
  const canBrief = !!employee && BRIEFING_PROFILES.includes(employee.profileKey);
  const id = scheduleId ?? "new";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      aiEmployeeId: v.aiEmployeeId,
      name: v.name,
      kind: v.kind,
      frequency: v.kind === "RECURRING" ? v.frequency : null,
      timeOfDay: v.kind === "RECURRING" ? v.timeOfDay : null,
      weekday: v.kind === "RECURRING" && v.frequency === "WEEKLY" ? v.weekday : null,
      eventType: v.kind === "EVENT" ? v.eventType : null,
      instructions: v.instructions,
      briefingMode: canBrief && v.briefingMode ? v.briefingMode : null,
      enabled: v.enabled,
    };
    try {
      await api(scheduleId ? `${apiBase}/workforce/schedules/${scheduleId}` : `${apiBase}/workforce/schedules`, { method: scheduleId ? "PATCH" : "POST", body });
      if (!scheduleId) setV((s) => ({ ...s, name: "", instructions: "" }));
      onDone?.();
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("plans.form.employee")} htmlFor={`${id}-employee`} error={fields.aiEmployeeId}>
          <Select id={`${id}-employee`} value={v.aiEmployeeId} required onChange={(e) => set("aiEmployeeId", e.target.value)}>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("plans.form.name")} htmlFor={`${id}-name`} error={fields.name}>
          <Input id={`${id}-name`} value={v.name} maxLength={120} required onChange={(e) => set("name", e.target.value)} />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t("plans.form.kind")}</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {(["RECURRING", "EVENT"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="radio" name={`${id}-kind`} checked={v.kind === k} onChange={() => set("kind", k)} />
              {t(`plans.kinds.${k}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {v.kind === "RECURRING" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("plans.form.frequency")} htmlFor={`${id}-frequency`}>
            <Select id={`${id}-frequency`} value={v.frequency} onChange={(e) => set("frequency", e.target.value as ScheduleValues["frequency"])}>
              {(["HOURLY", "DAILY", "WEEKLY"] as const).map((f) => (
                <option key={f} value={f}>
                  {t(`plans.frequencies.${f}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={v.frequency === "HOURLY" ? t("plans.form.minute") : t("plans.form.time")} htmlFor={`${id}-time`} error={fields.timeOfDay}>
            {v.frequency === "HOURLY" ? (
              <Select id={`${id}-time`} value={v.timeOfDay.slice(3)} onChange={(e) => set("timeOfDay", `00:${e.target.value}`)}>
                {["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"].map((m) => (
                  <option key={m} value={m}>
                    :{m}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id={`${id}-time`} type="time" value={v.timeOfDay} required onChange={(e) => set("timeOfDay", e.target.value)} />
            )}
          </Field>
          {v.frequency === "WEEKLY" ? (
            <Field label={t("plans.form.weekday")} htmlFor={`${id}-weekday`}>
              <Select id={`${id}-weekday`} value={v.weekday} onChange={(e) => set("weekday", Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <option key={d} value={d}>
                    {t(`plans.weekdays.${d}`)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      ) : (
        <Field label={t("plans.form.event")} htmlFor={`${id}-event`} hint={t("plans.form.eventHint")} error={fields.eventType}>
          <Select id={`${id}-event`} value={v.eventType} onChange={(e) => set("eventType", e.target.value)}>
            {eventTypes.map((ev) => (
              <option key={ev} value={ev}>
                {ev}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {canBrief ? (
        <Field label={t("plans.form.briefing")} htmlFor={`${id}-briefing`} hint={t("plans.form.briefingHint")}>
          <Select id={`${id}-briefing`} value={v.briefingMode} onChange={(e) => set("briefingMode", e.target.value as ScheduleValues["briefingMode"])}>
            <option value="">{t("plans.form.briefingNone")}</option>
            {(["DAILY", "WEEKLY", "MONTHLY", "TREND_RISK"] as const).map((m) => (
              <option key={m} value={m}>
                {t(`intelligence.modes.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label={t("plans.form.instructions")} htmlFor={`${id}-instructions`} hint={t("plans.form.instructionsHint")} error={fields.instructions}>
        <Textarea id={`${id}-instructions`} rows={4} maxLength={6000} required value={v.instructions} onChange={(e) => set("instructions", e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        {t("plans.form.enabled")}
      </label>
      <FormError error={error} />
      <div>
        <Button type="submit" disabled={busy || !v.aiEmployeeId}>
          {busy ? t("common.saving") : scheduleId ? t("common.save") : t("plans.form.create")}
        </Button>
      </div>
    </form>
  );
}
