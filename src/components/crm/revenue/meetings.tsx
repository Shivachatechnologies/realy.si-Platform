"use client";

import { useState, type FormEvent } from "react";
import { CalendarCheck, CalendarPlus, CalendarX, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "../kit";
import type { RecipientRef } from "./outreach";

/** Tomorrow 10:00 local time, as a datetime-local value. */
function defaultStart() {
  const d = new Date(Date.now() + 86_400_000);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Book a meeting with the customer; added to the connected calendar when there is one. */
export function MeetingScheduler({ base, refs, defaultTitle, calendar }: { base: string; refs: RecipientRef; defaultTitle: string; calendar: string | null }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [title, setTitle] = useState(defaultTitle);
  const [start, setStart] = useState(defaultStart);
  const [duration, setDuration] = useState(30);
  const [location, setLocation] = useState("");
  const [agenda, setAgenda] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const startsAt = new Date(start);
    if (Number.isNaN(startsAt.getTime())) return;
    void run(
      () => api<{ calendar: string }>(`${base}/crm/meetings`, { body: { ...refs, title, startsAt: startsAt.toISOString(), durationMin: duration, location: location || undefined, agenda: agenda || undefined, addToCalendar: !!calendar } }),
      (r) => setResult(r.calendar),
    );
  };
  return (
    <form onSubmit={submit} className="grid gap-3">
      <Field label={t("crm.rev.meet.title")} htmlFor="m-title">
        <Input id="m-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field label={t("crm.rev.meet.when")} htmlFor="m-start">
          <Input id="m-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
        </Field>
        <Field label={t("crm.rev.meet.duration")} htmlFor="m-dur">
          <Select id="m-dur" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {[15, 30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>
                {t("crm.rev.meet.minutes", { count: m })}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("crm.rev.meet.location")} htmlFor="m-loc">
        <Input id="m-loc" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} placeholder={t("crm.rev.meet.locationPlaceholder")} />
      </Field>
      <Field label={t("crm.rev.meet.agenda")} htmlFor="m-agenda">
        <Textarea id="m-agenda" rows={3} value={agenda} onChange={(e) => setAgenda(e.target.value)} maxLength={5000} />
      </Field>
      <p className="text-xs text-muted-foreground">{calendar ? t("crm.rev.meet.willAdd", { calendar: t(`crm.rev.channels.${calendar}`) }) : t("crm.rev.meet.noCalendar")}</p>
      <Button type="submit" disabled={busy} aria-busy={busy}>
        <CalendarPlus aria-hidden />
        {t("crm.rev.meet.book")}
      </Button>
      {result ? <p role="status" className={result === "failed" ? "text-sm text-danger" : "text-sm text-success"}>{t(`crm.rev.meet.result.${result}`)}</p> : null}
      <FormError error={error} />
    </form>
  );
}

/** Row actions of a meeting: calendar file, complete with notes, cancel, retry calendar. */
export function MeetingActions({ base, id, scheduled, canManage, retry }: { base: string; id: string; scheduled: boolean; canManage: boolean; retry: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [notes, setNotes] = useState("");
  const [closing, setClosing] = useState(false);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="secondary">
          <a href={`${base}/crm/meetings/${id}/ics`}>
            <Download aria-hidden />
            {t("crm.rev.meet.ics")}
          </a>
        </Button>
        {scheduled && canManage ? (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={() => setClosing((v) => !v)}>
              <CalendarCheck aria-hidden />
              {t("crm.rev.meet.done")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t("crm.rev.meet.confirmCancel"))) void run(() => api(`${base}/crm/meetings/${id}`, { method: "PATCH", body: { status: "CANCELLED" } }));
              }}
            >
              <CalendarX aria-hidden />
              {t("crm.rev.meet.cancel")}
            </Button>
            {retry ? (
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api(`${base}/crm/meetings/${id}/calendar`, { body: {} }))}>
                <RefreshCw aria-hidden />
                {t("crm.rev.meet.retry")}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      {closing ? (
        <div className="grid gap-2">
          <Textarea aria-label={t("crm.rev.meet.notes")} placeholder={t("crm.rev.meet.notesPlaceholder")} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          <Button type="button" size="sm" disabled={busy} onClick={() => void run(() => api(`${base}/crm/meetings/${id}`, { method: "PATCH", body: { status: "COMPLETED", outcome: notes || undefined } }))}>
            {t("crm.rev.meet.saveDone")}
          </Button>
        </div>
      ) : null}
      <FormError error={error} />
    </div>
  );
}
