import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { ActionButton } from "@/components/comms/client";
import { EventChip, NewEventButton } from "@/components/comms/calendar";
import { hrefWith } from "@/components/comms/bits";
import { areaPage } from "@/components/comms/context";
import { getT } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/i18n/format";
import { calendarRange } from "@/server/modules/comms/calendar";
import { connectionStatuses } from "@/server/modules/comms/connections-bridge";
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
  const [data, conns] = await Promise.all([calendarRange(viewer.ctx, org.id, company.id, from, to, { mine }), connectionStatuses(org.id, company.id)]);
  const byDay = new Map<string, { kind: "meeting" | "event"; start: Date; node: React.ReactNode }[]>();
  const bounds = cells.map((c) => {
    const [y, m, d] = c.key.split("-").map(Number) as [number, number, number];
    const start = zonedTime(tz, y, m, d, 0, 0);
    const next = zonedParts(tz, new Date(start.getTime() + 36 * 3_600_000));
    return { key: c.key, start, end: zonedTime(tz, next.year, next.month, next.day, 0, 0) };
  });
  const add = (start: Date, end: Date, item: { kind: "meeting" | "event"; start: Date; node: React.ReactNode }) => {
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
  const path = `/${locale}/communication/calendar`;
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
      <div className="flex flex-wrap gap-4 px-4 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-primary/40" /> {t("communication.calendar.legendMeetings")}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-warning/40" /> {t("communication.calendar.legendEvents")}
        </span>
      </div>
    </Card>,
  );
}
