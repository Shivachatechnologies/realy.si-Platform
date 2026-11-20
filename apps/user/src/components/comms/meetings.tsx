"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, ListChecks, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { isoToLocal, localToIso, PeoplePicker, useAction, type Person } from "./client";

interface MeetingDraft {
  id?: string;
  title: string;
  agenda: string;
  location: string;
  startsAt: string;
  endsAt: string;
  attendeeIds: string[];
  /** Part of a recurring series (edit offers "this and following"). */
  inSeries?: boolean;
}

export interface AgendaTemplateView {
  id: string;
  name: string;
  body: string;
}

/** Create / edit a meeting, with the free-slot helper, agenda templates and (on create) weekly / biweekly recurrence. */
export function MeetingForm({ base, locale, people, me, initial, templates = [] }: { base: string; locale: string; people: Person[]; me: string; initial?: MeetingDraft; templates?: AgendaTemplateView[] }) {
  const { t, locale: loc } = useI18n();
  const router = useRouter();
  const [f, setF] = useState(() => {
    const start = new Date();
    start.setHours(start.getHours() + 1, 0, 0, 0);
    return {
    title: initial?.title ?? "",
    agenda: initial?.agenda ?? "",
    location: initial?.location ?? "",
    startsAt: isoToLocal(initial?.startsAt ?? start.toISOString()),
    endsAt: isoToLocal(initial?.endsAt ?? new Date(start.getTime() + 30 * 60_000).toISOString()),
    attendeeIds: initial?.attendeeIds ?? [],
    recurrence: "" as "" | "WEEKLY" | "BIWEEKLY",
    occurrences: "6",
    scope: "this" as "this" | "following",
    };
  });
  const [slots, setSlots] = useState<{ startsAt: string; endsAt: string }[] | null>(null);
  const { busy, error, run } = useAction();
  const suggest = useAction();
  const duration = Math.max(15, Math.round((new Date(f.endsAt).getTime() - new Date(f.startsAt).getTime()) / 60_000) || 30);
  return (
    <form
      className="grid gap-3 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const common = { title: f.title, agenda: f.agenda, location: f.location, startsAt: localToIso(f.startsAt), endsAt: localToIso(f.endsAt), attendeeIds: f.attendeeIds };
        const body = initial?.id
          ? { ...common, scope: initial.inSeries ? f.scope : "this" }
          : { ...common, ...(f.recurrence ? { recurrence: f.recurrence, occurrences: Number(f.occurrences) } : {}) };
        void run(
          () => (initial?.id ? api(`${base}/comms/meetings/${initial.id}`, { method: "PATCH", body }) : api<{ id: string }>(`${base}/comms/meetings`, { body })),
          (r) => router.push(`/${locale}/communication/meetings/${initial?.id ?? (r as { id: string }).id}`),
        );
      }}
    >
      <Field label={t("communication.meetings.titleLabel")} htmlFor="mt-title" className="sm:col-span-2">
        <Input id="mt-title" required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </Field>
      <Field label={t("communication.meetings.starts")} htmlFor="mt-start">
        <Input id="mt-start" type="datetime-local" required value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />
      </Field>
      <Field label={t("communication.meetings.ends")} htmlFor="mt-end">
        <Input id="mt-end" type="datetime-local" required value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
      </Field>
      <Field label={t("communication.meetings.location")} htmlFor="mt-loc" className="sm:col-span-2">
        <Input id="mt-loc" maxLength={300} value={f.location} placeholder={t("communication.meetings.locationPlaceholder")} onChange={(e) => setF({ ...f, location: e.target.value })} />
      </Field>
      <div className="grid gap-1.5 sm:col-span-2">
        <span className="text-sm font-medium">{t("communication.meetings.attendees")}</span>
        <PeoplePicker people={people} value={f.attendeeIds} onChange={(attendeeIds) => setF({ ...f, attendeeIds })} exclude={[me]} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={suggest.busy}
            onClick={() => void suggest.run(() => api<{ data: { startsAt: string; endsAt: string }[] }>(`${base}/comms/scheduling`, { body: { attendeeIds: [me, ...f.attendeeIds], durationMinutes: Math.min(duration, 480), days: 5 } }), (r) => setSlots(r.data))}
          >
            <CalendarClock aria-hidden />
            {t("communication.meetings.findTime")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("communication.meetings.findTimeHint")}</span>
        </div>
        <FormError error={suggest.error} />
        {slots ? (
          slots.length ? (
            <div className="flex flex-wrap gap-1.5">
              {slots.map((s) => (
                <button key={s.startsAt} type="button" className="rounded-md border px-2 py-1 text-xs hover:bg-muted" onClick={() => setF({ ...f, startsAt: isoToLocal(s.startsAt), endsAt: isoToLocal(s.endsAt) })}>
                  {new Date(s.startsAt).toLocaleString(loc, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("communication.meetings.noSlots")}</p>
          )
        ) : null}
      </div>
      {!initial?.id ? (
        <>
          <Field label={t("communication.meetings.repeat")} htmlFor="mt-repeat">
            <Select id="mt-repeat" value={f.recurrence} onChange={(e) => setF({ ...f, recurrence: e.target.value as typeof f.recurrence })}>
              <option value="">{t("communication.meetings.repeatNone")}</option>
              <option value="WEEKLY">{t("communication.meetings.recurrence.WEEKLY")}</option>
              <option value="BIWEEKLY">{t("communication.meetings.recurrence.BIWEEKLY")}</option>
            </Select>
          </Field>
          {f.recurrence ? (
            <Field label={t("communication.meetings.occurrences")} htmlFor="mt-occ" hint={t("communication.meetings.occurrencesHint")}>
              <Input id="mt-occ" type="number" min={2} max={26} required value={f.occurrences} onChange={(e) => setF({ ...f, occurrences: e.target.value })} />
            </Field>
          ) : (
            <span />
          )}
        </>
      ) : initial.inSeries ? (
        <Field label={t("communication.meetings.applyTo")} htmlFor="mt-scope" className="sm:col-span-2">
          <Select id="mt-scope" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as "this" | "following" })}>
            <option value="this">{t("communication.meetings.scopeThis")}</option>
            <option value="following">{t("communication.meetings.scopeFollowing")}</option>
          </Select>
        </Field>
      ) : null}
      {templates.length ? (
        <Field label={t("communication.meetings.agendaTemplate")} htmlFor="mt-tpl" className="sm:col-span-2">
          <Select
            id="mt-tpl"
            value=""
            onChange={(e) => {
              const tpl = templates.find((x) => x.id === e.target.value);
              if (tpl && (!f.agenda.trim() || window.confirm(t("communication.meetings.replaceAgenda")))) setF({ ...f, agenda: tpl.body });
            }}
          >
            <option value="">{t("communication.meetings.useTemplate")}</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label={t("communication.meetings.agenda")} htmlFor="mt-agenda" className="sm:col-span-2">
        <Textarea id="mt-agenda" rows={4} maxLength={10000} value={f.agenda} onChange={(e) => setF({ ...f, agenda: e.target.value })} />
      </Field>
      <div className="grid gap-2 sm:col-span-2">
        <FormError error={error} />
        <div>
          <Button type="submit" disabled={busy || !f.title.trim()}>
            {initial?.id ? t("common.save") : t("communication.meetings.schedule")}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Notes editor (plain text, markdown-ish). */
export function NotesEditor({ base, meetingId, initial, disabled }: { base: string; meetingId: string; initial: string; disabled: boolean }) {
  const { t } = useI18n();
  const [notes, setNotes] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/comms/meetings/${meetingId}`, { method: "PATCH", body: { notes } }), () => setSaved(true));
      }}
    >
      <Textarea rows={10} maxLength={50000} value={notes} disabled={disabled} placeholder={t("communication.meetings.notesPlaceholder")} onChange={(e) => {
        setNotes(e.target.value);
        setSaved(false);
      }} aria-label={t("communication.meetings.notes")} />
      <FormError error={error} />
      {!disabled ? (
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={busy || notes === initial}>
            {t("communication.meetings.saveNotes")}
          </Button>
          {saved ? <span className="text-xs text-success">{t("communication.saved")}</span> : null}
        </div>
      ) : null}
    </form>
  );
}

export function DecisionsEditor({ base, meetingId, decisions, disabled }: { base: string; meetingId: string; decisions: string[]; disabled: boolean }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const { busy, error, run } = useAction();
  const save = (next: string[]) => run(() => api(`${base}/comms/meetings/${meetingId}`, { method: "PATCH", body: { decisions: next } }));
  return (
    <div className="grid gap-2">
      {decisions.length ? (
        <ul className="grid gap-1">
          {decisions.map((d, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              <span className="flex-1">{d}</span>
              {!disabled ? (
                <button type="button" className="text-muted-foreground hover:text-danger" onClick={() => void save(decisions.filter((_, j) => j !== i))} aria-label={t("communication.delete")}>
                  <X className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("communication.meetings.noDecisions")}</p>
      )}
      {!disabled ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void save([...decisions, text.trim()]).then(() => setText(""));
          }}
        >
          <Input value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder={t("communication.meetings.addDecision")} aria-label={t("communication.meetings.addDecision")} />
          <Button type="submit" size="sm" variant="secondary" disabled={busy || !text.trim()}>
            <Plus aria-hidden />
          </Button>
        </form>
      ) : null}
      <FormError error={error} />
    </div>
  );
}

interface ItemDraft {
  title: string;
  assigneeId: string;
  dueDate: string;
}

function ItemsEditor({ items, setItems, attendees }: { items: ItemDraft[]; setItems: (v: ItemDraft[]) => void; attendees: Person[] }) {
  const { t } = useI18n();
  return (
    <ul className="grid gap-2">
      {items.map((it, i) => (
        <li key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_9.5rem_auto]">
          <Input value={it.title} maxLength={300} required aria-label={t("communication.meetings.actionTitle")} placeholder={t("communication.meetings.actionTitle")} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
          <Select value={it.assigneeId} aria-label={t("communication.meetings.assignee")} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, assigneeId: e.target.value } : x)))}>
            <option value="">{t("communication.meetings.unassigned")}</option>
            {attendees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Input type="date" value={it.dueDate} aria-label={t("communication.meetings.due")} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
          <Button type="button" variant="ghost" size="sm" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label={t("communication.delete")}>
            <X />
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** Add action items by hand (WorkTasks assigned to attendees). */
export function AddActionItems({ base, meetingId, attendees }: { base: string; meetingId: string; attendees: Person[] }) {
  const { t } = useI18n();
  const [items, setItems] = useState<ItemDraft[]>([{ title: "", assigneeId: "", dueDate: "" }]);
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const payload = items.filter((i) => i.title.trim()).map((i) => ({ title: i.title, assigneeId: i.assigneeId || null, dueDate: i.dueDate || null }));
        if (payload.length) void run(() => api(`${base}/comms/meetings/${meetingId}/action-items`, { body: { items: payload } }), () => setItems([{ title: "", assigneeId: "", dueDate: "" }]));
      }}
    >
      <ItemsEditor items={items} setItems={setItems} attendees={attendees} />
      <FormError error={error} />
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setItems([...items, { title: "", assigneeId: "", dueDate: "" }])}>
          <Plus aria-hidden />
          {t("communication.meetings.anotherItem")}
        </Button>
        <Button type="submit" size="sm" disabled={busy || !items.some((i) => i.title.trim())}>
          {t("communication.meetings.createItems")}
        </Button>
      </div>
    </form>
  );
}

/** "Create action items from summary": parse the completed AI summary's bullet list, let the user review, then create. */
export function ActionItemsFromSummary({ base, meetingId, taskId, attendees }: { base: string; meetingId: string; taskId: string; attendees: Person[] }) {
  const { t } = useI18n();
  const [items, setItems] = useState<ItemDraft[] | null>(null);
  const [done, setDone] = useState(false);
  const load = useAction();
  const create = useAction();
  if (done) return <Notice tone="success">{t("communication.meetings.itemsCreated")}</Notice>;
  if (!items) {
    return (
      <div className="grid gap-2">
        <div>
          <Button
            type="button"
            size="sm"
            disabled={load.busy}
            onClick={() =>
              void load.run(
                () => api<{ data: { title: string; assigneeId: string | null; dueDate: string | null }[] }>(`${base}/comms/meetings/${meetingId}/action-items?fromTask=${taskId}`),
                (r) => setItems(r.data.map((i) => ({ title: i.title, assigneeId: i.assigneeId ?? "", dueDate: i.dueDate ?? "" }))),
              )
            }
          >
            <ListChecks aria-hidden />
            {t("communication.meetings.fromSummary")}
          </Button>
        </div>
        <FormError error={load.error} />
      </div>
    );
  }
  if (!items.length) return <p className="text-xs text-muted-foreground">{t("communication.meetings.noItemsInSummary")}</p>;
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">{t("communication.meetings.reviewItems")}</p>
      <ItemsEditor items={items} setItems={(v) => setItems(v)} attendees={attendees} />
      <FormError error={create.error} />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={create.busy || !items.some((i) => i.title.trim())}
          onClick={() =>
            void create.run(
              () => api(`${base}/comms/meetings/${meetingId}/action-items`, { body: { items: items.filter((i) => i.title.trim()).map((i) => ({ title: i.title, assigneeId: i.assigneeId || null, dueDate: i.dueDate || null })) } }),
              () => setDone(true),
            )
          }
        >
          {t("communication.meetings.confirmCreate", { count: items.filter((i) => i.title.trim()).length })}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setItems(null)}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

export function ActionItemToggle({ base, meetingId, taskId, done, disabled }: { base: string; meetingId: string; taskId: string; done: boolean; disabled: boolean }) {
  const { t } = useI18n();
  const { busy, run } = useAction();
  return (
    <input
      type="checkbox"
      checked={done}
      disabled={busy || disabled}
      aria-label={t("communication.meetings.markDone")}
      onChange={(e) => void run(() => api(`${base}/comms/meetings/${meetingId}/action-items/${taskId}`, { method: "PATCH", body: { done: e.target.checked } }))}
    />
  );
}

/** Attendee response buttons (this occurrence, or the rest of the series). */
export function RsvpButtons({ base, meetingId, current, inSeries }: { base: string; meetingId: string; current: string | null; inSeries: boolean }) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  const [scope, setScope] = useState<"this" | "series">("this");
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {(["ACCEPTED", "TENTATIVE", "DECLINED"] as const).map((r) => (
          <Button key={r} type="button" size="sm" variant={current === r ? "default" : "secondary"} aria-pressed={current === r} disabled={busy} onClick={() => void run(() => api(`${base}/comms/meetings/${meetingId}/rsvp`, { body: { response: r, scope } }))}>
            {r === "ACCEPTED" ? <Check aria-hidden /> : r === "DECLINED" ? <X aria-hidden /> : null}
            {t(`communication.meetings.rsvpAction.${r}`)}
          </Button>
        ))}
        {inSeries ? (
          <Select className="w-auto" aria-label={t("communication.meetings.applyTo")} value={scope} onChange={(e) => setScope(e.target.value as "this" | "series")}>
            <option value="this">{t("communication.meetings.scopeThis")}</option>
            <option value="series">{t("communication.meetings.scopeSeries")}</option>
          </Select>
        ) : null}
      </div>
      <FormError error={error} />
    </div>
  );
}

/** Email the follow-up (summary, decisions, action items) to attendees and show the truthful delivery result. */
export function FollowUpEmail({ base, meetingId, last }: { base: string; meetingId: string; last: { at: string; sent: number; failed: number; notConfigured: number; skipped: number } | null }) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  const [includeNotes, setIncludeNotes] = useState(false);
  const [result, setResult] = useState(last);
  return (
    <div className="grid gap-2 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} />
        {t("communication.meetings.followUpIncludeNotes")}
      </label>
      <div>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(
              () => api<{ sent: number; failed: number; notConfigured: number; skipped: number }>(`${base}/comms/meetings/${meetingId}/follow-up`, { body: { includeNotes } }),
              (r) => setResult({ ...r, at: new Date().toISOString() }),
            )
          }
        >
          {busy ? t("communication.meetings.followUpSending") : result ? t("communication.meetings.followUpResend") : t("communication.meetings.followUpSend")}
        </Button>
      </div>
      <FormError error={error} />
      {result ? (
        result.notConfigured && !result.sent ? (
          <Notice tone="warning">{t("communication.meetings.followUpNotConfigured")}</Notice>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("communication.meetings.followUpResult", { sent: result.sent, failed: result.failed, notConfigured: result.notConfigured, skipped: result.skipped })}
          </p>
        )
      ) : null}
    </div>
  );
}

/** Agenda template manager (create, edit, delete). */
export function AgendaTemplates({ base, templates, me, canManage }: { base: string; templates: (AgendaTemplateView & { createdById: string })[]; me: string; canManage: boolean }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", body: "" });
  const { busy, error, run } = useAction();
  const startEdit = (tpl?: AgendaTemplateView) => {
    setEditing(tpl?.id ?? "new");
    setF({ name: tpl?.name ?? "", body: tpl?.body ?? "" });
  };
  return (
    <div className="grid gap-3">
      {templates.length ? (
        <ul className="grid divide-y rounded-md border">
          {templates.map((tpl) => (
            <li key={tpl.id} className="grid gap-1 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{tpl.name}</span>
                {tpl.createdById === me || canManage ? (
                  <>
                    <Button type="button" size="sm" variant="ghost" onClick={() => startEdit(tpl)}>
                      {t("communication.edit")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(t("communication.confirmDelete"))) void run(() => api(`${base}/comms/agenda-templates/${tpl.id}`, { method: "DELETE" }));
                      }}
                    >
                      {t("communication.delete")}
                    </Button>
                  </>
                ) : null}
              </div>
              <p className="line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{tpl.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("communication.meetings.noTemplates")}</p>
      )}
      {editing ? (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => (editing === "new" ? api(`${base}/comms/agenda-templates`, { body: f }) : api(`${base}/comms/agenda-templates/${editing}`, { method: "PATCH", body: f })),
              () => setEditing(null),
            );
          }}
        >
          <Field label={t("communication.meetings.templateName")} htmlFor="tpl-name">
            <Input id="tpl-name" required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label={t("communication.meetings.agenda")} htmlFor="tpl-body">
            <Textarea id="tpl-body" required rows={5} maxLength={10000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          </Field>
          <FormError error={error} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || !f.name.trim() || !f.body.trim()}>
              {t("common.save")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button type="button" size="sm" variant="secondary" onClick={() => startEdit()}>
            <Plus aria-hidden />
            {t("communication.meetings.newTemplate")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Delete one occurrence or this and the following ones of a recurring meeting. */
export function DeleteMeeting({ base, locale, meetingId, inSeries }: { base: string; locale: string; meetingId: string; inSeries: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const { busy, error, run } = useAction();
  const del = (scope: "this" | "following") => {
    if (!window.confirm(t("communication.confirmDelete"))) return;
    void run(() => api(`${base}/comms/meetings/${meetingId}?scope=${scope}`, { method: "DELETE" }), () => router.push(`/${locale}/communication/meetings`));
  };
  return (
    <span className="inline-grid gap-1">
      <span className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => del("this")}>
          {inSeries ? t("communication.meetings.deleteThis") : t("communication.delete")}
        </Button>
        {inSeries ? (
          <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => del("following")}>
            {t("communication.meetings.deleteFollowing")}
          </Button>
        ) : null}
      </span>
      <FormError error={error} />
    </span>
  );
}
