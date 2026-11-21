"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, ExternalLink, GripVertical, Lock, Mail, Megaphone, PenLine, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

/** Mirrors server CalendarItem (calendar.ts) — kept local so this client file has no server imports. */
export interface CalendarEntry {
  key: string;
  kind: "content" | "post" | "autopilot" | "email";
  id: string;
  title: string;
  status: string;
  label: string;
  at: string;
  href: string;
  movable: boolean;
  lock?: "published" | "provider" | "running" | "status";
}

const KIND_ICON = { content: PenLine, post: Megaphone, autopilot: Sparkles, email: Mail } as const;
const KIND_TONE = { content: "border-s-[color:var(--primary)]", post: "border-s-[color:var(--success)]", autopilot: "border-s-[color:var(--warning)]", email: "border-s-[color:var(--info,var(--primary))]" } as const;
const KINDS = ["content", "post", "autopilot", "email"] as const;
const STATUS_NS = { content: "marketing.contentStatus", post: "marketing.postStatus", autopilot: "marketing.studio.stage", email: "marketing.emailStatus" } as const;

const fmtDay = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const fmtTime = (d: Date, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (day: string) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0

function readTzPref(): "company" | "local" {
  try {
    return window.localStorage.getItem("mkt-calendar-tz") === "local" ? "local" : "company";
  } catch {
    return "company";
  }
}

/**
 * Premium marketing calendar: month and week views of every scheduled item, time-zone aware (company or your own),
 * drag an item to another day to reschedule it (keeps its time of day), or select it to set an exact date and time.
 * Items already published, being sent, or scheduled at a provider show a lock and cannot be moved.
 */
export function MarketingCalendar({ items: initial, anchor, view, companyTz, base, canManage }: { items: CalendarEntry[]; anchor: string; view: "month" | "week"; companyTz: string; base: string; canManage: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [tzMode, setTzMode] = useState<"company" | "local">("company");
  const [localTz, setLocalTz] = useState(companyTz);
  const [kinds, setKinds] = useState<Set<string>>(new Set(KINDS));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // New server data (navigation, refresh) replaces the local copy.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setItems(initial);
  }
  useEffect(() => {
    // Browser-only values are read after hydration so server and client render the same first frame.
    /* eslint-disable react-hooks/set-state-in-effect */
    setLocalTz(Intl.DateTimeFormat().resolvedOptions().timeZone || companyTz);
    setTzMode(readTzPref());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [companyTz]);

  const tz = tzMode === "local" ? localTz : companyTz;
  const today = fmtDay(new Date(), tz);
  const visible = useMemo(() => items.filter((i) => kinds.has(i.kind)), [items, kinds]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEntry[]>();
    for (const i of visible) {
      const k = fmtDay(new Date(i.at), tz);
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return m;
  }, [visible, tz]);

  // Grid days for the view.
  const days = useMemo(() => {
    if (view === "week") {
      const start = addDays(anchor, -weekday(anchor));
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const first = `${anchor.slice(0, 7)}-01`;
    const start = addDays(first, -weekday(first));
    const out: string[] = [];
    for (let d = start; out.length < 42; d = addDays(d, 1)) {
      out.push(d);
      if (out.length >= 35 && d.slice(0, 7) !== anchor.slice(0, 7) && weekday(d) === 6) break;
    }
    return out;
  }, [anchor, view]);

  const nav = (dir: -1 | 1) => {
    const next = view === "week" ? addDays(anchor, dir * 7) : (() => {
      const d = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + dir);
      return d.toISOString().slice(0, 10);
    })();
    router.push(`?view=${view}&date=${next}`);
  };
  const title =
    view === "week"
      ? `${new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${days[0]}T12:00:00Z`))} – ${new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${days[6]}T12:00:00Z`))}`
      : new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${anchor.slice(0, 7)}-15T12:00:00Z`));
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + i))));

  async function move(item: CalendarEntry, day: string, time: string) {
    setError(null);
    setBusyKey(item.key);
    const before = items;
    try {
      const r = await api<{ at: string }>(`${base}/calendar/reschedule`, { body: { kind: item.kind, id: item.id, day, time, timeZone: tz } });
      setItems((list) => list.map((x) => (x.key === item.key ? { ...x, at: r.at } : x)));
      router.refresh();
    } catch (err) {
      setItems(before);
      setError(err);
    } finally {
      setBusyKey(null);
    }
  }

  const sel = selected ? items.find((i) => i.key === selected) : undefined;

  function Chip({ item, compact }: { item: CalendarEntry; compact?: boolean }) {
    const Icon = KIND_ICON[item.kind];
    const canDrag = canManage && item.movable;
    return (
      <button
        type="button"
        draggable={canDrag}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", item.key);
          e.dataTransfer.effectAllowed = "move";
          setDragKey(item.key);
        }}
        onDragEnd={() => {
          setDragKey(null);
          setOverDay(null);
        }}
        onClick={() => setSelected(item.key === selected ? null : item.key)}
        aria-pressed={selected === item.key}
        title={item.title}
        className={cn(
          "group grid w-full gap-0.5 rounded-md border border-s-[3px] bg-surface px-1.5 py-1 text-start text-[11px] shadow-elev-1 transition hover:shadow-elev-2 motion-reduce:transition-none",
          KIND_TONE[item.kind],
          canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
          dragKey === item.key && "opacity-40",
          busyKey === item.key && "animate-pulse motion-reduce:animate-none",
          selected === item.key && "ring-2 ring-primary",
        )}
      >
        <span className="flex items-center gap-1">
          {canDrag ? <GripVertical className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" aria-hidden /> : !item.movable ? <Lock className="size-3 shrink-0 text-muted-foreground" aria-hidden /> : null}
          <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="tabular-nums text-muted-foreground">{fmtTime(new Date(item.at), tz)}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
        </span>
        {!compact ? <span className="truncate text-[10px] text-muted-foreground">{item.label}</span> : null}
      </button>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => nav(-1)} aria-label={t("common.previous")}>
            <ChevronLeft className="rtl:-scale-x-100" aria-hidden />
          </Button>
          <h2 className="min-w-44 text-center font-display text-display">{title}</h2>
          <Button type="button" variant="ghost" size="sm" onClick={() => nav(1)} aria-label={t("common.next")}>
            <ChevronRight className="rtl:-scale-x-100" aria-hidden />
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => router.push(`?view=${view}&date=${fmtDay(new Date(), tz)}`)}>
            {t("marketing.calendar.today")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border p-0.5 text-xs" role="group" aria-label={t("marketing.calendar.view")}>
            {(["month", "week"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => router.push(`?view=${v}&date=${anchor}`)} className={cn("rounded px-2.5 py-1.5", view === v ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground")}>
                {t(`marketing.calendar.views.${v}`)}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
            <Clock className="size-3.5 text-muted-foreground" aria-hidden />
            <select
              value={tzMode}
              onChange={(e) => {
                const v = e.target.value === "local" ? "local" : "company";
                setTzMode(v);
                try {
                  window.localStorage.setItem("mkt-calendar-tz", v);
                } catch {
                  /* storage unavailable: preference lasts for this visit */
                }
              }}
              className="bg-transparent outline-none"
              aria-label={t("marketing.calendar.timezone")}
            >
              <option value="company">{t("marketing.calendar.companyTz", { tz: companyTz })}</option>
              <option value="local">{t("marketing.calendar.localTz", { tz: localTz })}</option>
            </select>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("marketing.calendar.filter")}>
        {KINDS.map((k) => {
          const Icon = KIND_ICON[k];
          const on = kinds.has(k);
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() => setKinds((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
              className={cn("flex min-h-8 items-center gap-1.5 rounded-full border border-s-[3px] px-3 text-xs", KIND_TONE[k], on ? "bg-surface" : "bg-transparent text-muted-foreground opacity-60")}
            >
              <Icon className="size-3.5" aria-hidden />
              {t(`marketing.calendar.kinds.${k}`)}
              <span className="tabular-nums text-muted-foreground">{items.filter((i) => i.kind === k).length}</span>
            </button>
          );
        })}
        {canManage ? <span className="ms-auto self-center text-[11px] text-muted-foreground">{t("marketing.calendar.dragHint")}</span> : null}
      </div>

      <FormError error={error} />

      <div className="overflow-x-auto rounded-xl border bg-surface/80 shadow-elev-1 backdrop-blur">
        <div className={cn("grid min-w-[760px] grid-cols-7")}>
          {weekdays.map((w, i) => (
            <div key={w} className={cn("border-b px-2 py-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase", i >= 5 && "bg-muted/30")}>
              {view === "week" ? `${w} ${new Date(`${days[i]}T12:00:00Z`).getUTCDate()}` : w}
            </div>
          ))}
          {days.map((d, i) => {
            const list = (byDay.get(d) ?? []).sort((a, b) => a.at.localeCompare(b.at));
            const outside = view === "month" && d.slice(0, 7) !== anchor.slice(0, 7);
            const past = d < today;
            return (
              <div
                key={d}
                onDragOver={(e) => {
                  if (!dragKey) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overDay !== d) setOverDay(d);
                }}
                onDragLeave={() => setOverDay((o) => (o === d ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  const key = e.dataTransfer.getData("text/plain") || dragKey;
                  setOverDay(null);
                  setDragKey(null);
                  const item = items.find((x) => x.key === key);
                  if (!item || fmtDay(new Date(item.at), tz) === d) return;
                  // Optimistic: show it on the new day while the server confirms (reverted on error).
                  const time = fmtTime(new Date(item.at), tz);
                  setItems((l) => l.map((x) => (x.key === item.key ? { ...x, at: new Date(new Date(item.at).getTime() + (Date.parse(`${d}T12:00:00Z`) - Date.parse(`${fmtDay(new Date(item.at), tz)}T12:00:00Z`))).toISOString() } : x)));
                  void move(item, d, time);
                }}
                className={cn(
                  "grid content-start gap-1 border-b border-e p-1.5 transition-colors",
                  view === "week" ? "min-h-[26rem]" : "min-h-28",
                  outside && "bg-muted/25",
                  i % 7 >= 5 && !outside && "bg-muted/10",
                  overDay === d && "bg-accent ring-2 ring-inset ring-primary/50",
                )}
              >
                {view === "month" ? (
                  <span className={cn("mb-0.5 grid size-6 place-items-center rounded-full text-xs tabular-nums", d === today ? "bg-primary font-semibold text-primary-foreground" : past || outside ? "text-muted-foreground/70" : "text-muted-foreground")}>
                    {new Date(`${d}T12:00:00Z`).getUTCDate()}
                  </span>
                ) : d === today ? (
                  <span className="mb-1 h-0.5 rounded-full bg-primary" aria-label={t("marketing.calendar.today")} />
                ) : null}
                {(view === "month" ? list.slice(0, 4) : list).map((item) => (
                  <Chip key={item.key} item={item} compact={view === "month"} />
                ))}
                {view === "month" && list.length > 4 ? (
                  <button type="button" onClick={() => router.push(`?view=week&date=${d}`)} className="text-start text-[11px] text-primary hover:underline">
                    {t("marketing.calendar.more", { count: list.length - 4 })}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="size-4" aria-hidden />
          {t("marketing.calendar.empty")}
        </p>
      ) : null}

      {sel ? <MovePanel key={sel.key} item={sel} tz={tz} canManage={canManage} onClose={() => setSelected(null)} onMove={(day, time) => void move(sel, day, time)} busy={busyKey === sel.key} /> : null}
    </div>
  );
}

function MovePanel({ item, tz, canManage, onClose, onMove, busy }: { item: CalendarEntry; tz: string; canManage: boolean; onClose: () => void; onMove: (day: string, time: string) => void; busy: boolean }) {
  const { t } = useI18n();
  const [day, setDay] = useState(fmtDay(new Date(item.at), tz));
  const [time, setTime] = useState(fmtTime(new Date(item.at), tz));
  return (
    <section className="glass sticky bottom-3 z-20 grid gap-3 rounded-xl border p-4 shadow-elev-3 animate-fade-up sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" aria-label={item.title}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <StatusBadge status={item.status} label={t(`${STATUS_NS[item.kind]}.${item.status}`)} />
          <span className="text-[11px] text-muted-foreground">{t(`marketing.calendar.kinds.${item.kind}`)} · {item.label}</span>
        </div>
        <p className="mt-1 truncate font-medium">{item.title}</p>
        {!item.movable ? <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" aria-hidden />{t(`marketing.calendar.lock.${item.lock ?? "status"}`)}</p> : null}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {canManage && item.movable ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onMove(day, time);
            }}
          >
            <label className="grid gap-1 text-[11px] text-muted-foreground">
              {t("marketing.calendar.date")}
              <Input type="date" required value={day} onChange={(e) => setDay(e.target.value)} className="h-9 w-40" />
            </label>
            <label className="grid gap-1 text-[11px] text-muted-foreground">
              {t("marketing.calendar.time", { tz })}
              <Input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className="h-9 w-28" />
            </label>
            <Button type="submit" size="sm" disabled={busy}>
              {t("marketing.calendar.move")}
            </Button>
          </form>
        ) : null}
        <Link href={item.href} className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted">
          <ExternalLink className="size-3.5" aria-hidden />
          {t("marketing.calendar.open")}
        </Link>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label={t("marketing.calendar.close")}>
          <X aria-hidden />
        </Button>
      </div>
    </section>
  );
}
