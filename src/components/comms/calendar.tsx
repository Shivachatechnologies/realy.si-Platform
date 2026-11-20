"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ActionButton, isoToLocal, localToIso, useAction } from "./client";

export interface EventView {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  when: string;
}

function EventForm({ base, initial, onDone }: { base: string; initial?: EventView; onDone: () => void }) {
  const t = useT();
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const [f, setF] = useState({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    location: initial?.location ?? "",
    startsAt: isoToLocal(initial?.startsAt ?? now.toISOString()),
    endsAt: isoToLocal(initial?.endsAt ?? new Date(now.getTime() + 3_600_000).toISOString()),
    allDay: initial?.allDay ?? false,
  });
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const body = { ...f, startsAt: localToIso(f.startsAt), endsAt: localToIso(f.endsAt) };
        void run(() => (initial ? api(`${base}/comms/events/${initial.id}`, { method: "PATCH", body }) : api(`${base}/comms/events`, { body })), onDone);
      }}
    >
      <Field label={t("communication.calendar.eventTitle")} htmlFor="ev-title" className="sm:col-span-2">
        <Input id="ev-title" required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </Field>
      <Field label={t("communication.meetings.starts")} htmlFor="ev-start">
        <Input id="ev-start" type="datetime-local" required value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />
      </Field>
      <Field label={t("communication.meetings.ends")} htmlFor="ev-end">
        <Input id="ev-end" type="datetime-local" required value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={f.allDay} onChange={(e) => setF({ ...f, allDay: e.target.checked })} />
        {t("communication.calendar.allDay")}
      </label>
      <Field label={t("communication.meetings.location")} htmlFor="ev-loc" className="sm:col-span-2">
        <Input id="ev-loc" maxLength={300} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
      </Field>
      <Field label={t("communication.calendar.eventDescription")} htmlFor="ev-desc" className="sm:col-span-2">
        <Textarea id="ev-desc" rows={3} maxLength={5000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      <div className="grid gap-2 sm:col-span-2">
        <FormError error={error} />
        <div>
          <Button type="submit" disabled={busy || !f.title.trim()}>
            {initial ? t("common.save") : t("communication.calendar.addEvent")}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function NewEventButton({ base }: { base: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden />
          {t("communication.calendar.addEvent")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("communication.calendar.addEvent")} closeLabel={t("common.close")}>
        <EventForm base={base} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Company event chip: opens details (and edit / delete for managers). */
export function EventChip({ base, event, canManage }: { base: string; event: EventView; canManage: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setEditing(false);
      }}
    >
      <DialogTrigger asChild>
        <button type="button" className="block w-full truncate rounded-sm bg-warning/15 px-1 text-start text-[11px] leading-5 hover:bg-warning/25">
          {event.title}
        </button>
      </DialogTrigger>
      <DialogContent title={event.title} description={event.when} closeLabel={t("common.close")}>
        {editing ? (
          <EventForm base={base} initial={event} onDone={() => setOpen(false)} />
        ) : (
          <div className="grid gap-3 text-sm">
            {event.location ? <p>{event.location}</p> : null}
            {event.description ? <p className="whitespace-pre-wrap text-muted-foreground">{event.description}</p> : null}
            {canManage ? (
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
                  {t("communication.edit")}
                </Button>
                <ActionButton path={`${base}/comms/events/${event.id}`} method="DELETE" variant="danger" confirm={t("communication.confirmDelete")} onDone={() => setOpen(false)}>
                  {t("communication.delete")}
                </ActionButton>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
