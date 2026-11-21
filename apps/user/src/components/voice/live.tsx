"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRightLeft, Bot, CalendarClock, Headset, Mic, MicOff, PhoneIncoming, PhoneOff, PhoneOutgoing, Radio, RotateCcw, User, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { formatDateTime, formatMoney } from "@/i18n/format";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatDuration, OUTCOMES, STATUS_TONE } from "./bits";

type Support = "yes" | "partial" | "no";
type Caps = Record<"placeCall" | "endCall" | "transfer" | "humanTakeover" | "mute" | "hold" | "liveTranscript" | "liveEvents" | "recording" | "cost", Support> & { layer: "vapi" | "retell" | "twilio" | null };

export interface LiveCall {
  id: string;
  lane: "active" | "incoming" | "outgoing";
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  provider: string | null;
  telephony: string;
  person: string | null;
  phone: string | null;
  leadId: string | null;
  contactId: string | null;
  purpose: string | null;
  agent: { id: string; name: string } | null;
  campaign: { id: string; name: string } | null;
  startedAt: string | null;
  createdAt: string;
  costMinor: string | null;
  costCurrency: string;
  muted: boolean;
  transferredTo: string | null;
  takenOverAt: string | null;
  attempt: number;
  capabilities: Caps;
}

export interface LiveBoardData {
  now: string;
  calls: LiveCall[];
  counts: { active: number; incoming: number; outgoing: number; queued: number; awaiting: number };
  queue: { id: string; toNumber: string; subjectName: string | null; scheduledFor: string | null; attempt: number; retryOfId: string | null; due: boolean; agent: { name: string } | null; campaign: { id: string; name: string } | null }[];
  awaiting: { id: string; toNumber: string; subjectName: string | null; createdAt: string; campaign: { name: string } | null }[];
  recent: { id: string; direction: string; status: string; subjectName: string | null; toNumber: string; fromNumber: string | null; outcome: string | null; durationSec: number | null; endedAt: string | null; outcomeSetById: string | null }[];
  rules: { maxConcurrent: number; window: string; days: number[]; timeZone: string; openNow: boolean; telephony: string; humanTransferNumber: string | null; retryMaxAttempts: number; retryDelayMin: number };
}

interface Line {
  id: string;
  role: string;
  text: string;
  at: number | null;
  ts: number;
}

const POLL_MS = 2000;

/** Poll a JSON endpoint every `ms` while the tab is visible; returns the latest data and the last error. */
function usePoll<T>(path: string | null, ms: number, initial: T | null, onData?: (d: T) => void) {
  const [data, setData] = useState<T | null>(initial);
  const [error, setError] = useState<unknown>(null);
  const cb = useRef(onData);
  useEffect(() => {
    cb.current = onData;
  }, [onData]);
  useEffect(() => {
    if (!path) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (stop) return;
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        try {
          const d = await api<T>(path);
          if (!stop) {
            setData(d);
            setError(null);
            cb.current?.(d);
          }
        } catch (err) {
          if (!stop) setError(err);
        }
      }
      if (!stop) timer = setTimeout(tick, ms);
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [path, ms]);
  return { data, error };
}

function Elapsed({ from, now }: { from: string | null; now: number }) {
  if (!from) return <span className="tabular-nums text-muted-foreground">—</span>;
  return <span className="tabular-nums">{formatDuration(Math.max(0, Math.round((now - new Date(from).getTime()) / 1000)))}</span>;
}

/** Live call center: lanes of live calls, the selected call's streaming transcript and controls, the queue. */
export function LiveCallCenter({ base, locale, tz, initial, canPost }: { base: string; locale: string; tz: string; initial: LiveBoardData; canPost: boolean }) {
  const t = useT();
  const { data, error } = usePoll<LiveBoardData>(`${base}/voice/live`, POLL_MS, initial);
  const board = data ?? initial;
  const [selected, setSelected] = useState<string | null>(initial.calls.find((c) => c.lane === "active")?.id ?? initial.calls[0]?.id ?? null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const selectedCall = board.calls.find((c) => c.id === selected) ?? null;
  const lanes = (["active", "incoming", "outgoing"] as const).map((lane) => ({ lane, calls: board.calls.filter((c) => c.lane === lane) }));
  const icons = { active: Radio, incoming: PhoneIncoming, outgoing: PhoneOutgoing };
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1", board.rules.openNow ? "border-success/40 text-success" : "border-warning/40 text-warning")}>
          <span aria-hidden className={cn("size-1.5 rounded-full", board.rules.openNow ? "bg-success motion-safe:animate-pulse" : "bg-warning")} />
          {board.rules.openNow ? t("voice.live2.windowOpen", { window: board.rules.window, tz: board.rules.timeZone }) : t("voice.live2.windowClosed", { window: board.rules.window, tz: board.rules.timeZone })}
        </span>
        <span className="rounded-full border px-2.5 py-1">{t("voice.live2.concurrency", { live: board.calls.length, max: board.rules.maxConcurrent })}</span>
        <span className="rounded-full border px-2.5 py-1">{t(`voice.live2.telephony.${board.rules.telephony}`)}</span>
        <span className="rounded-full border px-2.5 py-1">{t("voice.live2.retries", { attempts: board.rules.retryMaxAttempts, minutes: board.rules.retryDelayMin })}</span>
        {error ? <span className="text-danger">{t("voice.live2.reconnecting")}</span> : <span>{t("voice.live2.updating")}</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="grid content-start gap-4">
          {lanes.map(({ lane, calls }) => {
            const Icon = icons[lane];
            return (
              <Card key={lane}>
                <CardHeader icon={<Icon />} title={<span className="flex items-center gap-2">{t(`voice.live2.lanes.${lane}`)}<Badge tone={calls.length ? "accent" : "neutral"}>{calls.length}</Badge></span>} />
                {calls.length ? (
                  <ul className="divide-y">
                    {calls.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(c.id)}
                          aria-pressed={selected === c.id}
                          className={cn("grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-4 py-3 text-start hover:bg-muted/50 focus-visible:bg-muted/60", selected === c.id && "bg-accent/40")}
                        >
                          <span className="truncate text-sm font-medium">{c.person ?? c.phone ?? t("voice.calls.unknown")}</span>
                          <span className="text-sm"><Elapsed from={c.startedAt} now={now} /></span>
                          <span className="truncate text-xs text-muted-foreground">
                            {c.agent?.name ?? "—"} · {c.provider ? t(`voice.providers.${c.provider.toLowerCase()}.name`) : t("voice.live2.customBridge")}
                            {c.telephony === "TWILIO" ? " · Twilio" : ""}
                            {c.campaign ? ` · ${c.campaign.name}` : ""}
                          </span>
                          <Badge tone={STATUS_TONE[c.status] ?? "neutral"} pulse>{t(`voice.status.${c.status}`)}</Badge>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 py-5 text-sm text-muted-foreground">{t(`voice.live2.empty.${lane}`)}</p>
                )}
              </Card>
            );
          })}
        </div>

        <div className="grid content-start gap-4">
          {selectedCall ? (
            <CallConsole key={selectedCall.id} base={base} locale={locale} call={selectedCall} now={now} canPost={canPost} humanNumber={board.rules.humanTransferNumber} />
          ) : (
            <Card>
              <div className="grid place-items-center gap-2 px-6 py-14 text-center">
                <Headset aria-hidden className="size-8 text-muted-foreground" />
                <p className="text-sm font-medium">{t("voice.live2.noneSelected")}</p>
                <p className="max-w-sm text-xs text-muted-foreground">{t("voice.live2.noneSelectedHint")}</p>
              </div>
            </Card>
          )}
          <QueueCard board={board} locale={locale} tz={tz} base={base} canPost={canPost} />
        </div>
      </div>
    </div>
  );
}

function CallConsole({ base, locale, call, now, canPost, humanNumber }: { base: string; locale: string; call: LiveCall; now: number; canPost: boolean; humanNumber: string | null }) {
  const t = useT();
  const [lines, setLines] = useState<Line[]>([]);
  const cursor = useRef<number | null>(null);
  const seen = useRef(new Set<string>());
  const list = useRef<HTMLOListElement>(null);
  const [path, setPath] = useState(`${base}/voice/calls/${call.id}/transcript`);
  const onData = useCallback((d: { lines: Line[]; cursor: number | null }) => {
    const fresh = d.lines.filter((l) => !seen.current.has(l.id));
    fresh.forEach((l) => seen.current.add(l.id));
    if (fresh.length) setLines((prev) => [...prev, ...fresh]);
    if (d.cursor && d.cursor !== cursor.current) {
      cursor.current = d.cursor;
      setPath(`${base}/voice/calls/${call.id}/transcript?after=${d.cursor}`);
    }
  }, [base, call.id]);
  usePoll<{ lines: Line[]; cursor: number | null }>(path, POLL_MS, null, onData);
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const caps = call.capabilities;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [transferTo, setTransferTo] = useState("");
  const [outcome, setOutcome] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const act = async (key: string, path: string, body: unknown) => {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      await api(path, { method: "POST", body });
      setDone(key);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };
  const control = (action: string, extra: Record<string, unknown> = {}) => act(action, `${base}/voice/calls/${call.id}/control`, { action, ...extra });
  const why = (cap: keyof Caps) => (caps[cap] === "yes" ? undefined : t("voice.live2.notSupported", { provider: caps.layer ? t(`voice.live2.layers.${caps.layer}`) : t("voice.live2.thisProvider") }));
  const ctrl = ({ k, cap, onClick, icon, label, variant = "secondary" }: { k: string; cap: keyof Caps; onClick: () => void; icon: ReactNode; label: string; variant?: "secondary" | "danger" | "soft" }) => {
    const ok = canPost && caps[cap] === "yes";
    return (
      <span className="inline-grid gap-0.5">
        <Button type="button" size="sm" variant={variant} disabled={!ok || !!busy} aria-busy={busy === k} title={why(cap)} onClick={onClick}>
          {icon}
          {label}
        </Button>
        {caps[cap] !== "yes" ? <span className="max-w-[11rem] text-[11px] leading-tight text-muted-foreground">{why(cap)}</span> : null}
      </span>
    );
  };
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {call.leadId ? <Link href={`/${locale}/crm/${call.leadId}`} className="hover:underline">{call.person ?? call.phone}</Link> : call.contactId ? <Link href={`/${locale}/crm/contacts/${call.contactId}`} className="hover:underline">{call.person ?? call.phone}</Link> : (call.person ?? call.phone ?? t("voice.calls.unknown"))}
            <Badge tone={STATUS_TONE[call.status] ?? "neutral"} pulse>{t(`voice.status.${call.status}`)}</Badge>
            {call.muted ? <Badge tone="warning">{t("voice.live2.aiMuted")}</Badge> : null}
            {call.takenOverAt ? <Badge tone="info">{t("voice.live2.takenOver")}</Badge> : null}
          </span>
        }
        description={`${t(`voice.direction.${call.direction}`)} · ${call.phone ?? "—"}${call.attempt > 1 ? ` · ${t("voice.live2.attempt", { n: call.attempt })}` : ""}`}
        actions={<Link href={`/${locale}/voice/calls/${call.id}`} className="text-xs font-medium text-primary hover:underline">{t("voice.live2.openCall")}</Link>}
      />
      <CardBody className="grid gap-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">{t("voice.calls.duration")}</dt><dd className="text-lg font-semibold"><Elapsed from={call.startedAt} now={now} /></dd></div>
          <div><dt className="text-xs text-muted-foreground">{t("voice.calls.agent")}</dt><dd className="truncate">{call.agent?.name ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{t("voice.live2.provider")}</dt><dd>{call.provider ? t(`voice.providers.${call.provider.toLowerCase()}.name`) : t("voice.live2.customBridge")}{call.telephony === "TWILIO" ? " + Twilio" : ""}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{t("voice.live2.liveCost")}</dt><dd className="tabular-nums">{call.costMinor !== null ? formatMoney({ amountMinor: call.costMinor, currency: call.costCurrency }, locale) : <span className="text-muted-foreground" title={t("voice.live2.costPending")}>{t("voice.live2.costPendingShort")}</span>}</dd></div>
        </dl>
        {call.purpose ? <p className="line-clamp-2 text-xs text-muted-foreground">{call.purpose}</p> : null}

        <section aria-label={t("voice.live2.transcript")} className="grid gap-2">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-danger motion-safe:animate-pulse" />
            {t("voice.live2.transcript")}
            {caps.liveTranscript !== "yes" ? <span className="font-normal normal-case">· {t(caps.liveTranscript === "partial" ? "voice.live2.transcriptPartial" : "voice.live2.transcriptNone")}</span> : null}
          </h3>
          <ol ref={list} className="grid max-h-80 gap-2 overflow-y-auto rounded-lg border bg-muted/20 p-3" aria-live="polite" aria-relevant="additions">
            {lines.length ? (
              lines.map((l) => {
                const agent = l.role === "agent";
                const human = l.role === "human";
                return (
                  <li key={l.id} className={cn("flex gap-2", !agent && !human && "flex-row-reverse")}>
                    <span aria-hidden className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", agent ? "bg-accent text-accent-foreground" : human ? "bg-info/15 text-info" : "bg-muted text-muted-foreground")}>
                      {agent ? <Bot className="size-3" /> : human ? <Users className="size-3" /> : <User className="size-3" />}
                    </span>
                    <p className={cn("max-w-[85%] rounded-lg border px-2.5 py-1.5 text-sm leading-relaxed", agent ? "bg-surface" : "bg-muted/60")}>
                      <span className="sr-only">{agent ? call.agent?.name ?? "AI" : human ? t("voice.live2.human") : t("voice.call.caller")}: </span>
                      {l.text}
                    </p>
                  </li>
                );
              })
            ) : (
              <li className="py-6 text-center text-xs text-muted-foreground">{t("voice.live2.waitingTranscript")}</li>
            )}
          </ol>
        </section>

        <section aria-label={t("voice.live2.controls")} className="grid gap-3">
          <div className="flex flex-wrap items-start gap-2">
            {ctrl({ k: "end", cap: "endCall", variant: "danger", onClick: () => window.confirm(t("voice.live2.endConfirm")) && void control("end"), icon: <PhoneOff aria-hidden />, label: t("voice.live2.end") })}
            {ctrl({ k: call.muted ? "unmute" : "mute", cap: "mute", onClick: () => void control(call.muted ? "unmute" : "mute"), icon: call.muted ? <Mic aria-hidden /> : <MicOff aria-hidden />, label: call.muted ? t("voice.live2.unmute") : t("voice.live2.mute") })}
            {ctrl({ k: "takeover", cap: "humanTakeover", variant: "soft", onClick: () => (humanNumber ? window.confirm(t("voice.live2.takeoverConfirm", { number: humanNumber })) && void control("takeover") : setError(new Error(t("voice.live2.noHumanNumber")))), icon: <Headset aria-hidden />, label: t("voice.live2.takeover") })}
            {ctrl({ k: "hold", cap: "hold", onClick: () => void control("hold"), icon: <Radio aria-hidden />, label: t("voice.live2.hold") })}
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (transferTo.trim()) void control("transfer", { number: transferTo.trim() });
            }}
          >
            <label className="grid gap-1 text-xs">
              <span className="text-muted-foreground">{t("voice.live2.transferTo")}</span>
              <Input value={transferTo} onChange={(e) => setTransferTo(e.target.value)} placeholder="+44 20 7946 0958" inputMode="tel" className="w-48" disabled={!canPost || caps.transfer !== "yes"} />
            </label>
            <Button type="submit" size="sm" variant="secondary" disabled={!canPost || caps.transfer !== "yes" || !transferTo.trim() || !!busy} title={why("transfer")}>
              <ArrowRightLeft aria-hidden />
              {t("voice.live2.transfer")}
            </Button>
          </form>
          {call.status === "IN_PROGRESS" && canPost ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (outcome) void act("outcome", `${base}/voice/calls/${call.id}/outcome`, { outcome });
              }}
            >
              <label className="grid gap-1 text-xs">
                <span className="text-muted-foreground">{t("voice.live2.outcome")}</span>
                <Select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="w-52">
                  <option value="">{t("voice.live2.pickOutcome")}</option>
                  {OUTCOMES.map((o) => <option key={o} value={o}>{t(`voice.outcomes.${o}`)}</option>)}
                </Select>
              </label>
              <Button type="submit" size="sm" variant="secondary" disabled={!outcome || !!busy}>{t("voice.live2.saveOutcome")}</Button>
            </form>
          ) : null}
          {done ? <p className="text-xs text-success" role="status">{t("voice.live2.done")}</p> : null}
          <FormError error={error} />
        </section>
      </CardBody>
    </Card>
  );
}

function QueueCard({ board, locale, tz, base, canPost }: { board: LiveBoardData; locale: string; tz: string; base: string; canPost: boolean }) {
  const t = useT();
  return (
    <Card>
      <CardHeader icon={<CalendarClock />} title={t("voice.live2.queue")} description={t("voice.live2.queueHint", { queued: board.counts.queued, awaiting: board.counts.awaiting })} />
      <CardBody className="grid gap-4">
        {board.counts.awaiting ? (
          <Notice tone="warning" action={<Link href={`/${locale}/approvals`} className="text-sm font-medium text-primary hover:underline">{t("voice.call.openApprovals")}</Link>}>
            {t("voice.live2.awaiting", { count: board.counts.awaiting })}
          </Notice>
        ) : null}
        {board.queue.length ? (
          <ul className="grid gap-2">
            {board.queue.slice(0, 12).map((q) => (
              <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="min-w-0">
                  <Link href={`/${locale}/voice/calls/${q.id}`} className="font-medium hover:underline">{q.subjectName ?? q.toNumber}</Link>
                  <span className="block truncate text-xs text-muted-foreground">
                    {q.campaign?.name ?? q.agent?.name ?? "—"}
                    {q.attempt > 1 ? ` · ${q.retryOfId ? t("voice.live2.retryN", { n: q.attempt }) : t("voice.live2.attempt", { n: q.attempt })}` : ""}
                  </span>
                </span>
                <Badge tone={q.due ? "accent" : "info"}>{q.due ? t("voice.live2.dueNow") : q.scheduledFor ? formatDateTime(q.scheduledFor, locale, tz) : "—"}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("voice.live2.queueEmpty")}</p>
        )}
        {board.recent.length ? (
          <div className="grid gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("voice.live2.justEnded")}</h3>
            <ul className="grid gap-2">
              {board.recent.map((r) => (
                <RecentRow key={r.id} r={r} base={base} locale={locale} canPost={canPost} />
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function RecentRow({ r, base, locale, canPost }: { r: LiveBoardData["recent"][number]; base: string; locale: string; canPost: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState("");
  const [outcome, setOutcome] = useState(r.outcome ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const post = async (path: string, body: unknown, ok: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: "POST", body });
      setMsg(ok);
      setOpen(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="grid gap-2 rounded-md border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/${locale}/voice/calls/${r.id}`} className="min-w-0 truncate font-medium hover:underline">{r.subjectName ?? (r.direction === "INBOUND" ? r.fromNumber : r.toNumber)}</Link>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">{formatDuration(r.durationSec)}</span>
          {r.outcome ? <Badge>{t(`voice.outcomes.${r.outcome}`)}</Badge> : <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{t(`voice.status.${r.status}`)}</Badge>}
        </span>
      </div>
      {canPost ? (
        <div className="flex flex-wrap items-end gap-2">
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label={t("voice.live2.outcome")} className="h-8 w-44 text-xs">
            <option value="">{t("voice.live2.pickOutcome")}</option>
            {OUTCOMES.map((o) => <option key={o} value={o}>{t(`voice.outcomes.${o}`)}</option>)}
          </Select>
          <Button type="button" size="sm" variant="ghost" disabled={!outcome || outcome === r.outcome || busy} onClick={() => void post(`${base}/voice/calls/${r.id}/outcome`, { outcome }, t("voice.live2.done"))}>{t("voice.live2.saveOutcome")}</Button>
          {r.direction === "OUTBOUND" ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              <RotateCcw aria-hidden />
              {t("voice.live2.callback")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {open ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void post(`${base}/voice/calls/${r.id}/retry`, at ? { at: new Date(at).toISOString() } : {}, t("voice.live2.callbackFiled"));
          }}
        >
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">{t("voice.live2.callbackAt")}</span>
            <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="h-8 w-56 text-xs" />
          </label>
          <Button type="submit" size="sm" disabled={busy}>{at ? t("voice.live2.scheduleCallback") : t("voice.live2.retryNow")}</Button>
          <span className="w-full text-[11px] text-muted-foreground">{t("voice.live2.callbackHint")}</span>
        </form>
      ) : null}
      {msg ? <p className="text-xs text-success" role="status">{msg}</p> : null}
      <FormError error={error} />
    </li>
  );
}
