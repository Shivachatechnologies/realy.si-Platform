"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarSearch, CheckCircle2, ClipboardList, FileText, Mail, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useAction } from "@/components/comms/client";
import { useT } from "@/i18n/client";
import { formatDateTime } from "@/i18n/format";
import { api } from "@/lib/api-client";

interface Item {
  title: string;
  owner?: string | null;
  dueDate?: string | null;
}

export interface IntelData {
  meeting: { id: string; status: string; startsAt: string; attendeeEmail: string | null };
  intel: {
    agenda: string | null;
    prepBrief: string | null;
    prepBuiltAt: string | null;
    transcript: string | null;
    transcriptSource: string | null;
    transcriptAt: string | null;
    summary: string | null;
    decisions: string[];
    actionItems: Item[];
    proposedOutcome: string | null;
    followUpSubject: string | null;
    followUpBody: string | null;
    followUpStatus: string;
    appliedAt: string | null;
    results: { type: string; id: string; label: string; href?: string }[];
  } | null;
  prepTask: { id: string; status: string; errorMessage: string | null } | null;
  processTask: { id: string; status: string; errorMessage: string | null } | null;
  transcriptCalls: { id: string; createdAt: string; durationSec: number | null; outcome: string | null }[];
}

const PENDING = ["QUEUED", "RUNNING", "WAITING_APPROVAL"];
const FOLLOW_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = { NONE: "neutral", DRAFT: "info", AWAITING_APPROVAL: "warning", SENT: "success", FAILED: "danger" };

type PanelProps = { base: string; kind: "crm" | "comms"; data: IntelData; canEdit: boolean; aiReady: boolean; locale: string; tz: string };

/** Meeting intelligence: prep brief & agenda, transcript → summary/action items/follow-up, confirmed outcome. */
export function MeetingIntelPanel(props: PanelProps) {
  const i = props.data.intel;
  // Editable fields start from the server's values; a new server version (refresh after AI work) resets them.
  const version = JSON.stringify([i?.agenda, i?.summary, i?.actionItems, i?.followUpSubject, i?.followUpBody, i?.appliedAt, i?.followUpStatus]);
  return <IntelPanel key={version} {...props} />;
}

function IntelPanel({ base, kind, data, canEdit, aiReady, locale, tz }: PanelProps) {
  const t = useT();
  const router = useRouter();
  const path = `${base}/comms/meeting-intel/${kind}/${data.meeting.id}`;
  const i = data.intel;
  const pending = PENDING.includes(data.prepTask?.status ?? "") || PENDING.includes(data.processTask?.status ?? "");
  useEffect(() => {
    if (!pending) return;
    const h = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(h);
  }, [pending, router]);

  const prep = useAction();
  const agendaA = useAction();
  const tr = useAction();
  const proc = useAction();
  const save = useAction();
  const apply = useAction();
  const mail = useAction();
  const done = useAction();

  const [agenda, setAgenda] = useState(i?.agenda ?? "");
  const [source, setSource] = useState<"upload" | "voice_call">(data.transcriptCalls.length && !i?.transcript ? "voice_call" : "upload");
  const [text, setText] = useState("");
  const [callId, setCallId] = useState(data.transcriptCalls[0]?.id ?? "");
  const [summary, setSummary] = useState(i?.summary ?? "");
  const [items, setItems] = useState<Item[]>(i?.actionItems ?? []);
  const [subject, setSubject] = useState(i?.followUpSubject ?? "");
  const [body, setBody] = useState(i?.followUpBody ?? "");
  const [outcome, setOutcome] = useState(i?.proposedOutcome && !/^unclear/i.test(i.proposedOutcome) ? i.proposedOutcome : "");
  const [opts, setOpts] = useState({ createTasks: true, addNote: true });

  const taskState = (task: IntelData["prepTask"]) =>
    task && PENDING.includes(task.status) ? <Badge tone="accent" pulse>{t("communication.intel.working")}</Badge> : task?.status === "FAILED" ? <Badge tone="danger">{t("communication.intel.failed")}</Badge> : null;
  const [now] = useState(() => Date.now());
  const started = new Date(data.meeting.startsAt).getTime() <= now;

  return (
    <div className="grid gap-4">
      {!aiReady ? <Notice tone="warning">{t("communication.intel.aiMissing")}</Notice> : null}

      <Card>
        <CardHeader icon={<ClipboardList />} title={<span className="flex items-center gap-2">{t("communication.intel.prepTitle")}{taskState(data.prepTask)}</span>} description={t("communication.intel.prepHint")}
          actions={canEdit && aiReady && data.meeting.status === "SCHEDULED" ? (
            <Button type="button" size="sm" variant="soft" disabled={prep.busy || pending} aria-busy={prep.busy} onClick={() => void prep.run(() => api(`${path}/prep`, { method: "POST", body: {} }))}>
              <Sparkles aria-hidden />
              {i?.prepBuiltAt ? t("communication.intel.regenerate") : t("communication.intel.generatePrep")}
            </Button>
          ) : undefined}
        />
        <CardBody className="grid gap-4">
          <FormError error={prep.error} />
          {data.prepTask?.status === "FAILED" ? <Notice tone="danger">{data.prepTask.errorMessage ?? t("communication.intel.failed")}</Notice> : null}
          <div className="grid gap-2">
            <label htmlFor="intel-agenda" className="text-[13px] font-medium">{t("communication.intel.agenda")}</label>
            <Textarea id="intel-agenda" rows={6} value={agenda} onChange={(e) => setAgenda(e.target.value)} disabled={!canEdit} placeholder={t("communication.intel.agendaPlaceholder")} />
            {canEdit ? (
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="secondary" disabled={agendaA.busy || !agenda.trim() || data.meeting.status !== "SCHEDULED"} onClick={() => void agendaA.run(() => api(`${path}/agenda`, { method: "POST", body: { agenda } }))}>{t("communication.intel.saveAgenda")}</Button>
                <FormError error={agendaA.error} />
              </div>
            ) : null}
          </div>
          {i?.prepBrief ? (
            <div className="grid gap-1">
              <h3 className="text-[13px] font-medium">{t("communication.intel.brief")}</h3>
              <div className="whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm leading-relaxed">{i.prepBrief}</div>
              <p className="text-xs text-muted-foreground">{t("communication.intel.briefNote")}</p>
            </div>
          ) : !data.prepTask ? (
            <p className="text-sm text-muted-foreground">{t("communication.intel.noBrief")}</p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader icon={<FileText />} title={<span className="flex items-center gap-2">{t("communication.intel.transcriptTitle")}{taskState(data.processTask)}</span>} description={i?.transcriptAt ? t("communication.intel.transcriptAdded", { when: formatDateTime(i.transcriptAt, locale, tz), source: t(`communication.intel.sources.${i.transcriptSource ?? "upload"}`), chars: i.transcript?.length ?? 0 }) : t("communication.intel.transcriptHint")} />
        <CardBody className="grid gap-3">
          {canEdit ? (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void tr.run(() => api(`${path}/transcript`, { method: "POST", body: source === "upload" ? { source, text } : { source, callId } }), () => setText(""));
              }}
            >
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("communication.intel.source")}>
                {(["upload", "voice_call"] as const).map((s) => (
                  <label key={s} className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm">
                    <input type="radio" name="intel-source" checked={source === s} onChange={() => setSource(s)} disabled={s === "voice_call" && !data.transcriptCalls.length} />
                    {t(`communication.intel.sources.${s}`)}
                  </label>
                ))}
              </div>
              {source === "upload" ? (
                <>
                  <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("communication.intel.pastePlaceholder")} aria-label={t("communication.intel.paste")} />
                  <label className="inline-flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
                    <Upload aria-hidden className="size-3.5" />
                    {t("communication.intel.uploadFile")}
                    <input
                      type="file"
                      accept=".txt,.vtt,.srt,.md,text/plain,text/vtt"
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file || file.size > 2_000_000) return;
                        void file.text().then((v) => setText(v.slice(0, 200_000)));
                      }}
                    />
                  </label>
                </>
              ) : (
                <Select value={callId} onChange={(e) => setCallId(e.target.value)} aria-label={t("communication.intel.pickCall")}>
                  {data.transcriptCalls.map((c) => (
                    <option key={c.id} value={c.id}>{formatDateTime(c.createdAt, locale, tz)}{c.outcome ? ` · ${c.outcome.toLowerCase().replace(/_/g, " ")}` : ""}</option>
                  ))}
                </Select>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" size="sm" variant="secondary" disabled={tr.busy || (source === "upload" ? !text.trim() : !callId)}>{t("communication.intel.saveTranscript")}</Button>
                {i?.transcript && aiReady ? (
                  <Button type="button" size="sm" disabled={proc.busy || pending} aria-busy={proc.busy} onClick={() => void proc.run(() => api(`${path}/process`, { method: "POST", body: {} }))}>
                    <Sparkles aria-hidden />
                    {t("communication.intel.process")}
                  </Button>
                ) : null}
              </div>
              <FormError error={tr.error ?? proc.error} />
            </form>
          ) : null}
          {data.processTask?.status === "FAILED" ? <Notice tone="danger">{data.processTask.errorMessage ?? t("communication.intel.failed")}</Notice> : null}
        </CardBody>
      </Card>

      {i?.summary || (i?.actionItems?.length ?? 0) > 0 ? (
        <Card>
          <CardHeader icon={<CheckCircle2 />} title={t("communication.intel.resultsTitle")} description={i?.appliedAt ? t("communication.intel.appliedAt", { when: formatDateTime(i.appliedAt, locale, tz) }) : t("communication.intel.resultsHint")} />
          <CardBody className="grid gap-4">
            <div className="grid gap-1">
              <label htmlFor="intel-summary" className="text-[13px] font-medium">{t("communication.intel.summary")}</label>
              <Textarea id="intel-summary" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} disabled={!canEdit || !!i?.appliedAt} />
            </div>
            {i?.decisions.length ? (
              <div className="grid gap-1">
                <h3 className="text-[13px] font-medium">{t("communication.intel.decisions")}</h3>
                <ul className="list-disc ps-5 text-sm">{i.decisions.map((d, k) => <li key={k}>{d}</li>)}</ul>
              </div>
            ) : null}
            <div className="grid gap-2">
              <h3 className="text-[13px] font-medium">{t("communication.intel.actionItems")}</h3>
              {items.map((it, k) => (
                <div key={k} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_auto]">
                  <Input value={it.title} onChange={(e) => setItems(items.map((x, j) => (j === k ? { ...x, title: e.target.value } : x)))} aria-label={t("communication.intel.itemTitle")} disabled={!canEdit || !!i?.appliedAt} />
                  <Input value={it.owner ?? ""} onChange={(e) => setItems(items.map((x, j) => (j === k ? { ...x, owner: e.target.value || null } : x)))} placeholder={t("communication.intel.owner")} aria-label={t("communication.intel.owner")} disabled={!canEdit || !!i?.appliedAt} />
                  <Input type="date" value={it.dueDate ?? ""} onChange={(e) => setItems(items.map((x, j) => (j === k ? { ...x, dueDate: e.target.value || null } : x)))} aria-label={t("communication.intel.due")} disabled={!canEdit || !!i?.appliedAt} />
                  <Button type="button" size="icon" variant="ghost" aria-label={t("communication.intel.removeItem")} disabled={!canEdit || !!i?.appliedAt} onClick={() => setItems(items.filter((_, j) => j !== k))}><Trash2 aria-hidden /></Button>
                </div>
              ))}
              {canEdit && !i?.appliedAt ? (
                <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => setItems([...items, { title: "", owner: null, dueDate: null }])}><Plus aria-hidden />{t("communication.intel.addItem")}</Button>
              ) : null}
            </div>
            {canEdit && !i?.appliedAt ? (
              <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={opts.createTasks} onChange={(e) => setOpts({ ...opts, createTasks: e.target.checked })} />{t(kind === "crm" ? "communication.intel.createFollowUps" : "communication.intel.createTasks")}</label>
                  <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={opts.addNote} onChange={(e) => setOpts({ ...opts, addNote: e.target.checked })} />{t(kind === "crm" ? "communication.intel.addCrmNote" : "communication.intel.addNotes")}</label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" disabled={save.busy} onClick={() => void save.run(() => api(path, { method: "PATCH", body: { summary, actionItems: items.filter((x) => x.title.trim()) } }))}>{t("communication.intel.saveEdits")}</Button>
                  <Button type="button" size="sm" disabled={apply.busy} aria-busy={apply.busy} onClick={() => void apply.run(async () => { await api(path, { method: "PATCH", body: { summary, actionItems: items.filter((x) => x.title.trim()) } }); return api(`${path}/apply`, { method: "POST", body: opts }); })}>{t("communication.intel.apply")}</Button>
                </div>
                <FormError error={save.error ?? apply.error} />
              </div>
            ) : null}
            {i?.results.length ? (
              <ul className="grid gap-1 text-sm">
                {i.results.map((r) => <li key={`${r.type}-${r.id}`} className="flex items-center gap-2"><CheckCircle2 aria-hidden className="size-3.5 text-success" />{r.href ? <Link href={`/${locale}${r.href}`} className="hover:underline">{r.label}</Link> : r.label}</li>)}
              </ul>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {kind === "crm" && (i?.followUpBody || i?.summary) ? (
        <Card>
          <CardHeader icon={<Mail />} title={<span className="flex items-center gap-2">{t("communication.intel.emailTitle")}<Badge tone={FOLLOW_TONE[i?.followUpStatus ?? "NONE"] ?? "neutral"}>{t(`communication.intel.followUp.${i?.followUpStatus ?? "NONE"}`)}</Badge></span>} description={data.meeting.attendeeEmail ? t("communication.intel.emailTo", { email: data.meeting.attendeeEmail }) : t("communication.intel.emailNoRecipient")} />
          <CardBody className="grid gap-3">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("communication.intel.subject")} aria-label={t("communication.intel.subject")} disabled={!canEdit || ["AWAITING_APPROVAL", "SENT"].includes(i?.followUpStatus ?? "")} />
            <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} aria-label={t("communication.intel.emailBody")} disabled={!canEdit || ["AWAITING_APPROVAL", "SENT"].includes(i?.followUpStatus ?? "")} />
            <p className="text-xs text-muted-foreground">{t("communication.intel.emailNote")}</p>
            {canEdit && !["AWAITING_APPROVAL", "SENT"].includes(i?.followUpStatus ?? "") ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" disabled={mail.busy} onClick={() => void mail.run(() => api(path, { method: "PATCH", body: { followUpSubject: subject, followUpBody: body } }))}>{t("communication.intel.saveDraft")}</Button>
                <Button type="button" size="sm" disabled={mail.busy || !subject.trim() || !body.trim() || !data.meeting.attendeeEmail} onClick={() => void mail.run(async () => { await api(path, { method: "PATCH", body: { followUpSubject: subject, followUpBody: body } }); return api(`${path}/follow-up-email`, { method: "POST", body: {} }); })}>
                  <Mail aria-hidden />
                  {t("communication.intel.requestSend")}
                </Button>
              </div>
            ) : null}
            {i?.followUpStatus === "AWAITING_APPROVAL" ? <Notice tone="warning" action={<Link href={`/${locale}/approvals`} className="text-sm font-medium text-primary hover:underline">{t("communication.intel.openApprovals")}</Link>}>{t("communication.intel.emailAwaiting")}</Notice> : null}
            <FormError error={mail.error} />
          </CardBody>
        </Card>
      ) : null}

      {data.meeting.status === "SCHEDULED" && canEdit ? (
        <Card>
          <CardHeader icon={<CheckCircle2 />} title={t("communication.intel.outcomeTitle")} description={t("communication.intel.outcomeHint")} />
          <CardBody className="grid gap-3">
            {!started ? <p className="text-sm text-muted-foreground">{t("communication.intel.notStarted")}</p> : null}
            <Textarea rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder={t("communication.intel.outcomePlaceholder")} aria-label={t("communication.intel.outcome")} disabled={!started} />
            {i?.proposedOutcome ? <p className="text-xs text-muted-foreground">{t("communication.intel.proposed", { outcome: i.proposedOutcome })}</p> : null}
            <div>
              <Button type="button" size="sm" disabled={done.busy || !started || !outcome.trim()} onClick={() => window.confirm(t("communication.intel.confirmDone")) && void done.run(() => api(`${path}/outcome`, { method: "POST", body: { outcome } }))}>{t("communication.intel.markDone")}</Button>
            </div>
            <FormError error={done.error} />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

interface Availability {
  timeZone: string;
  sources: Record<"google" | "microsoft" | "calendly" | "realy", "connected" | "not_connected" | "error">;
  slots: { startsAt: string; endsAt: string }[];
  calendly: { eventType: string; startsAt: string; url: string | null }[];
}

/** Free slots from the connected calendars, Realy meetings and Calendly (fetched on demand). */
export function AvailabilityPanel({ base, locale }: { base: string; locale: string }) {
  const t = useT();
  const [days, setDays] = useState(5);
  const [duration, setDuration] = useState(30);
  const [data, setData] = useState<Availability | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await api<Availability>(`${base}/comms/availability?days=${days}&duration=${duration}`));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader icon={<CalendarSearch />} title={t("communication.intel.availabilityTitle")} description={t("communication.intel.availabilityHint")} />
      <CardBody className="grid gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs"><span className="text-muted-foreground">{t("communication.intel.days")}</span><Input type="number" min={1} max={14} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-20" /></label>
          <label className="grid gap-1 text-xs"><span className="text-muted-foreground">{t("communication.intel.duration")}</span><Input type="number" min={15} max={240} step={15} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-24" /></label>
          <Button type="button" size="sm" variant="secondary" disabled={busy} aria-busy={busy} onClick={() => void load()}>{t("communication.intel.findSlots")}</Button>
        </div>
        <FormError error={error} />
        {data ? (
          <>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {(["google", "microsoft", "calendly", "realy"] as const).map((s) => (
                <Badge key={s} tone={data.sources[s] === "connected" ? "success" : data.sources[s] === "error" ? "danger" : "neutral"}>{t(`communication.intel.cal.${s}`)} · {t(`communication.intel.calState.${data.sources[s]}`)}</Badge>
              ))}
            </div>
            {data.sources.google !== "connected" && data.sources.microsoft !== "connected" ? (
              <Notice tone="info" action={<Link href={`/${locale}/integrations`} className="text-sm font-medium text-primary hover:underline">{t("communication.intel.connectCalendar")}</Link>}>{t("communication.intel.noCalendar")}</Notice>
            ) : null}
            {data.slots.length ? (
              <ul className="flex flex-wrap gap-2">
                {data.slots.map((s) => <li key={s.startsAt}><Badge tone="accent">{formatDateTime(s.startsAt, locale, data.timeZone)}</Badge></li>)}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("communication.intel.noSlots")}</p>
            )}
            {data.calendly.length ? (
              <div className="grid gap-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Calendly</h3>
                <ul className="grid gap-1 text-sm">
                  {data.calendly.map((c) => <li key={`${c.eventType}-${c.startsAt}`}>{c.eventType} · {formatDateTime(c.startsAt, locale, data.timeZone)}{c.url ? <> · <a href={c.url} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">{t("communication.intel.bookingLink")}</a></> : null}</li>)}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
