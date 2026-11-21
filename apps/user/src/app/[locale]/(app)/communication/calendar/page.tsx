import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { ActionButton } from "@/components/comms/client";
import { EventChip, NewEventButton } from "@/components/comms/calendar";
import { hrefWith } from "@/components/comms/bits";
import { RemindersPanel } from "@/components/comms/reminders";
import { areaPage } from "@/components/comms/context";
import { getT } from "@/i18n/server";
import { formatDate, formatDateTime, formatMoney } from "@/i18n/format";
import { CALENDAR_LAYERS, calendarRange, type CalendarLayer } from "@/server/modules/comms/calendar";
import { connectionStatuses } from "@/server/modules/comms/connections-bridge";
import { listMyReminders } from "@/server/modules/comms/reminders";
import { zonedParts, zonedTime } from "@/server/modules/comms/time";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("communication.calendar.title") };
}

const DAY = 86_400_000;
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export default async function CalendarPage({ searchParams }: PageProps<"/[locale]/communication/calendar">) {
  const p = await areaPage("communication", "calendar");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, wrap } = p;
  const sp = await searchParams;
  const view = sp.view === "week" ? "week" : "month";
  const mine = sp.mine === "1";
  const hidden = new Set((typeof sp.hide === "string" ? sp.hide : "").split(",").filter((x): x is CalendarLayer => (CALENDAR_LAYERS as readonly string[]).includes(x)));
  const layers = CALENDAR_LAYERS.filter((l) => !hidden.has(l));
  const today = zonedParts(tz, new Date());
  const anchorRaw = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : ymd(today.year, today.month, today.day);
  const [ay, am, ad] = anchorRaw.split("-").map(Number) as [number, number, number];
  // Grid start: Monday on/before the 1st (month) or the anchor (week), at local midnight.
  const firstLocal = view === "month" ? zonedTime(tz, ay, am, 1, 12) : zonedTime(tz, ay, am, ad, 12);
  const back = zonedParts(tz, firstLocal).isoWeekday - 1;
  const gridStartNoon = new Date(firstLocal.getTime() - back * DAY);
  const days = view === "month" ? 42 : 7;
  const cells = Array.from({ length: days }, (_, i) => {
    const noon = new Date(gridStartNoon.getTime() + i * DAY);
    const pp = zonedParts(tz, noon);
    return { key: ymd(pp.year, pp.month, pp.day), day: pp.day, month: pp.month, noon };
  });
  const from = zonedTime(tz, ...(cells[0]!.key.split("-").map(Number) as [number, number, number]), 0, 0);
  const lastParts = cells[cells.length - 1]!.key.split("-").map(Number) as [number, number, number];
  const to = new Date(zonedTime(tz, ...lastParts, 0, 0).getTime() + DAY);
  const [data, conns, reminders] = await Promise.all([calendarRange(viewer.ctx, org.id, company.id, from, to, { mine, layers }), connectionStatuses(org.id, company.id), listMyReminders(viewer.ctx, org.id, company.id)]);
  type Item = { kind: "meeting" | "event" | "leave" | "holiday" | "crm"; start: Date; node: React.ReactNode };
  const byDay = new Map<string, Item[]>();
  /** Date-only rows (@db.Date, UTC midnight): place by their calendar date, not by time zone. */
  const addDays = (startDay: Date, endDay: Date, item: Item) => {
    for (let d = startDay.getTime(), n = 0; d <= endDay.getTime() && n < 62; d += DAY, n++) {
      const key = new Date(d).toISOString().slice(0, 10);
      if (cells.some((c) => c.key === key)) byDay.set(key, [...(byDay.get(key) ?? []), item]);
    }
  };
  const bounds = cells.map((c) => {
    const [y, m, d] = c.key.split("-").map(Number) as [number, number, number];
    const start = zonedTime(tz, y, m, d, 0, 0);
    const next = zonedParts(tz, new Date(start.getTime() + 36 * 3_600_000));
    return { key: c.key, start, end: zonedTime(tz, next.year, next.month, next.day, 0, 0) };
  });
  const add = (start: Date, end: Date, item: Item) => {
    for (const b of bounds) {
      const overlaps = start < b.end && (end > b.start || (+end === +start && start >= b.start));
      if (overlaps) byDay.set(b.key, [...(byDay.get(b.key) ?? []), item]);
    }
  };
  for (const m of data.meetings) {
    add(m.startsAt, m.endsAt, {
      kind: "meeting",
      start: m.startsAt,
      node: (
        <Link key={`m-${m.id}`} href={`/${locale}/communication/meetings/${m.id}`} className={cn("block truncate rounded-sm px-1 text-[11px] leading-5 hover:bg-accent", m.status === "COMPLETED" ? "bg-muted text-muted-foreground" : "bg-primary/10")}>
          {formatDate(m.startsAt, locale, tz, { timeStyle: "short" })} {m.title}
        </Link>
      ),
    });
  }
  for (const e of data.events) {
    add(e.startsAt, e.endsAt, {
      kind: "event",
      start: e.startsAt,
      node: (
        <EventChip
          key={`e-${e.id}`}
          base={base}
          canManage={data.canManage}
          event={{ id: e.id, title: e.title, description: e.description, location: e.location, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt.toISOString(), allDay: e.allDay, when: e.allDay ? formatDate(e.startsAt, locale, tz) : `${formatDateTime(e.startsAt, locale, tz)} – ${formatDateTime(e.endsAt, locale, tz)}` }}
        />
      ),
    });
  }
  for (const h of data.holidays) {
    addDays(h.date, h.date, {
      kind: "holiday",
      start: h.date,
      node: (
        <span key={`h-${h.id}`} className="block truncate rounded-sm bg-success/15 px-1 text-[11px] leading-5" title={h.name}>
          {h.name}
        </span>
      ),
    });
  }
  for (const l of data.leave) {
    addDays(l.startDate, l.endDate, {
      kind: "leave",
      start: l.startDate,
      node: (
        <span key={`l-${l.id}`} className="block truncate rounded-sm bg-accent/60 px-1 text-[11px] leading-5" title={`${l.name} · ${l.type}`} style={l.color ? { borderInlineStart: `3px solid ${l.color}` } : undefined}>
          {t("communication.calendar.onLeave", { name: l.own ? t("communication.calendar.you") : l.name })}
        </span>
      ),
    });
  }
  for (const f of data.followUps) {
    add(f.dueAt, f.dueAt, {
      kind: "crm",
      start: f.dueAt,
      node: (
        <Link key={`f-${f.id}`} href={`/${locale}${f.href}`} className="block truncate rounded-sm bg-danger/10 px-1 text-[11px] leading-5 hover:bg-danger/20" title={f.note}>
          {formatDate(f.dueAt, locale, tz, { timeStyle: "short" })} {f.label ? `${f.label}: ` : ""}
          {f.note}
        </Link>
      ),
    });
  }
  for (const d of data.deals) {
    if (!d.expectedCloseDate) continue;
    addDays(d.expectedCloseDate, d.expectedCloseDate, {
      kind: "crm",
      start: d.expectedCloseDate,
      node: (
        <Link key={`d-${d.id}`} href={`/${locale}/crm/deals/${d.id}`} className="block truncate rounded-sm bg-danger/10 px-1 text-[11px] leading-5 hover:bg-danger/20" title={formatMoney({ amountMinor: d.amountMinor, currency: d.currency }, locale)}>
          {t("communication.calendar.dealCloses", { name: d.name })}
        </Link>
      ),
    });
  }
  const path = `/${locale}/communication/calendar`;
  const toggleHref = (l: CalendarLayer) => {
    const next = new Set(hidden);
    if (next.has(l)) next.delete(l);
    else next.add(l);
    return hrefWith(path, sp, { hide: [...next].join(",") || undefined });
  };
  const LAYER_SWATCH: Record<CalendarLayer, string> = { meetings: "bg-primary/40", events: "bg-warning/40", leave: "bg-accent", holidays: "bg-success/40", crm: "bg-danger/30" };
  const availableLayers = CALENDAR_LAYERS.filter((l) => l !== "crm" || data.layers.crm || hidden.has("crm"));
  const shift = (n: number) => {
    if (view === "week") {
      const pp = zonedParts(tz, new Date(zonedTime(tz, ay, am, ad, 12).getTime() + n * 7 * DAY));
      return ymd(pp.year, pp.month, pp.day);
    }
    const m0 = am - 1 + n;
    return ymd(ay + Math.floor(m0 / 12), ((m0 % 12) + 12) % 12 + 1, 1);
  };
  const title = view === "month" ? formatDate(zonedTime(tz, ay, am, 15, 12), locale, tz, { month: "long", year: "numeric" }) : `${formatDate(cells[0]!.noon, locale, tz)} – ${formatDate(cells[6]!.noon, locale, tz)}`;
  const todayKey = ymd(today.year, today.month, today.day);
  const calendarConnected = conns.google_calendar === "CONNECTED" || conns.outlook_calendar === "CONNECTED";

  return wrap(
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
    <Card>
      <CardHeader
        title={title}
        description={t("communication.calendar.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {data.canManage && calendarConnected ? (
              <ActionButton path={`${base}/comms/calendar-sync`}>{t("communication.calendar.syncNow")}</ActionButton>
            ) : null}
            {data.canManage ? <NewEventButton base={base} /> : null}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm">
        <Link className="rounded-md border px-2 py-1 hover:bg-muted" href={hrefWith(path, sp, { date: shift(-1) })} aria-label={t("common.previous")}>
          ←
        </Link>
        <Link className="rounded-md border px-2 py-1 hover:bg-muted" href={hrefWith(path, sp, { date: undefined })}>
          {t("communication.calendar.today")}
        </Link>
        <Link className="rounded-md border px-2 py-1 hover:bg-muted" href={hrefWith(path, sp, { date: shift(1) })} aria-label={t("common.next")}>
          →
        </Link>
        <span className="ms-auto flex gap-1">
          {(["month", "week"] as const).map((v) => (
            <Link key={v} href={hrefWith(path, sp, { view: v === "month" ? undefined : v })} aria-current={view === v ? "page" : undefined} className={cn("rounded-md px-2 py-1", view === v ? "bg-muted font-medium" : "hover:bg-muted")}>
              {t(`communication.calendar.${v}`)}
            </Link>
          ))}
          <Link href={hrefWith(path, sp, { mine: mine ? undefined : "1" })} aria-pressed={mine} className={cn("rounded-md px-2 py-1", mine ? "bg-muted font-medium" : "hover:bg-muted")}>
            {t("communication.calendar.onlyMine")}
          </Link>
        </span>
      </div>
      {!calendarConnected ? (
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">
          {t("communication.calendar.notConnected")}{" "}
          <Link href={`/${locale}/integrations`} className="underline">
            {t("communication.connectIntegrations")}
          </Link>
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <div className="grid min-w-[42rem] grid-cols-7">
          {cells.slice(0, 7).map((c) => (
            <div key={`h-${c.key}`} className="border-b px-2 py-1 text-xs font-medium text-muted-foreground">
              {formatDate(c.noon, locale, tz, { weekday: "short" })}
            </div>
          ))}
          {cells.map((c) => {
            const items = (byDay.get(c.key) ?? []).sort((a, b) => +a.start - +b.start);
            const outside = view === "month" && c.month !== am;
            return (
              <div key={c.key} className={cn("grid content-start gap-0.5 border-b border-e p-1", view === "month" ? "min-h-24" : "min-h-64", outside && "bg-surface-2/60")}>
                <span className={cn("mb-0.5 text-xs", c.key === todayKey ? "w-fit rounded-full bg-primary px-1.5 text-primary-foreground" : outside ? "text-muted-foreground/60" : "text-muted-foreground")}>
                  {view === "week" ? formatDate(c.noon, locale, tz, { day: "numeric", month: "short" }) : c.day}
                </span>
                {items.slice(0, view === "month" ? 4 : 30).map((it) => it.node)}
                {view === "month" && items.length > 4 ? (
                  <Link href={hrefWith(path, sp, { view: "week", date: c.key })} className="text-[11px] text-muted-foreground hover:underline">
                    {t("communication.calendar.more", { count: items.length - 4 })}
                  </Link>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs" role="group" aria-label={t("communication.calendar.layers")}>
        <span className="text-muted-foreground">{t("communication.calendar.layers")}:</span>
        {availableLayers.map((l) => (
          <Link key={l} href={toggleHref(l)} aria-pressed={!hidden.has(l)} className={cn("flex items-center gap-1 rounded-md border px-2 py-1", hidden.has(l) ? "text-muted-foreground line-through opacity-70" : "hover:bg-muted")}>
            <span className={cn("inline-block size-2 rounded-sm", LAYER_SWATCH[l])} aria-hidden /> {t(`communication.calendar.layer.${l}`)}
          </Link>
        ))}
        {!hidden.has("leave") ? <span className="text-muted-foreground">· {t(data.layers.leaveScope === "all" ? "communication.calendar.leaveAll" : "communication.calendar.leaveOwn")}</span> : null}
      </div>
    </Card>
    <div className="grid content-start gap-4">
      <RemindersPanel
        base={base}
        reminders={reminders.map((r) => ({ id: r.id, kind: r.kind, title: r.title, remindAt: r.remindAt.toISOString(), when: formatDateTime(r.remindAt, locale, tz), href: r.href, sent: Boolean(r.sentAt) }))}
      />
    </div>
    </div>,
  );
}
