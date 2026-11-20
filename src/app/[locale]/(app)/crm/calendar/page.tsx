import type { Metadata } from "next";
import Link from "next/link";
import { CrmFrame, crmContext } from "@/components/crm/shell";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { crmCalendar } from "@/server/modules/crm/activities";
import { isUuid } from "@/server/modules/crm/common";
import { listOwners } from "@/server/modules/crm/service";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.calendar") };
}

const KIND_STYLE = { follow_up: "border-s-warning", meeting: "border-s-primary", close: "border-s-success" } as const;

/** Month grid of lead/CRM follow-ups, meetings and expected deal closes. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await crmContext();
  const query = await searchParams;
  if (!c.company || !c.canRead) return <CrmFrame active="calendar">{null}</CrmFrame>;
  const { t, locale, org, company, viewer, tz } = c;
  const month = typeof query.month === "string" ? query.month : "";
  const ownerRaw = typeof query.owner === "string" ? query.owner : "me";
  const owner = ownerRaw === "me" || isUuid(ownerRaw) ? ownerRaw : ownerRaw === "all" ? undefined : "me";
  const [cal, owners] = await Promise.all([crmCalendar(viewer.ctx, org.id, company.id, month, { owner }), listOwners(viewer.ctx, org.id, company.id)]);
  const key = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
  const prev = cal.month === 1 ? key(cal.year - 1, 12) : key(cal.year, cal.month - 1);
  const next = cal.month === 12 ? key(cal.year + 1, 1) : key(cal.year, cal.month + 1);
  const ownerQs = `&owner=${owner ?? "all"}`;
  // Week starts Monday; cells cover the full weeks around the month (dates by the company timezone).
  const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const utcDayKey = (d: Date) => d.toISOString().slice(0, 10);
  const byDay = new Map<string, typeof cal.items>();
  for (const it of cal.items) {
    const k = it.kind === "close" ? utcDayKey(it.date) : dayKey(it.date);
    byDay.set(k, [...(byDay.get(k) ?? []), it]);
  }
  const first = new Date(Date.UTC(cal.year, cal.month - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(cal.year, cal.month, 0)).getUTCDate();
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
  const todayKey = dayKey(new Date());
  const weekdays = Array.from({ length: 7 }, (_, i) => formatDate(new Date(Date.UTC(2024, 0, 1 + i)), locale, "UTC", { weekday: "short" }));
  return (
    <CrmFrame active="calendar" subtitle={t("crm.calendar.subtitle")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="secondary">
            <Link href={`/${locale}/crm/calendar?month=${prev}${ownerQs}`}>←</Link>
          </Button>
          <h2 className="min-w-40 text-center font-semibold">{formatDate(first, locale, "UTC", { month: "long", year: "numeric" })}</h2>
          <Button asChild size="sm" variant="secondary">
            <Link href={`/${locale}/crm/calendar?month=${next}${ownerQs}`}>→</Link>
          </Button>
        </div>
        <form className="flex items-center gap-2" action={`/${locale}/crm/calendar`}>
          <input type="hidden" name="month" value={key(cal.year, cal.month)} />
          <Select name="owner" defaultValue={owner ?? "all"} aria-label={t("crm.owner")} className="w-48">
            <option value="me">{t("crm.mine")}</option>
            <option value="all">{t("crm.allOwners")}</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" variant="secondary">
            {t("crm.applyFilters")}
          </Button>
        </form>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="border-s-4 border-s-warning ps-1">{t("crm.calendar.followUp")}</span>
        <span className="border-s-4 border-s-primary ps-1">{t("crm.calendar.meeting")}</span>
        <span className="border-s-4 border-s-success ps-1">{t("crm.calendar.close")}</span>
      </div>
      <Card className="overflow-x-auto">
        <div className="grid min-w-[700px] grid-cols-7 text-xs">
          {weekdays.map((w) => (
            <div key={w} className="border-b bg-surface-2 p-2 font-medium text-muted-foreground">
              {w}
            </div>
          ))}
          {Array.from({ length: cells }, (_, i) => {
            const dayNum = i - offset + 1;
            const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
            const k = inMonth ? key(cal.year, cal.month) + `-${String(dayNum).padStart(2, "0")}` : "";
            const items = inMonth ? (byDay.get(k) ?? []) : [];
            return (
              <div key={i} className={cn("min-h-28 border-b border-e p-1", inMonth ? "" : "bg-muted/30")}>
                {inMonth ? <div className={cn("mb-1 text-end font-medium", k === todayKey ? "text-primary" : "text-muted-foreground")}>{dayNum}</div> : null}
                <ul className="grid gap-1">
                  {items.slice(0, 6).map((it) => (
                    <li key={`${it.kind}-${it.id}`}>
                      <Link
                        href={`/${locale}${it.href}`}
                        className={cn("block truncate rounded-sm border-s-4 bg-surface px-1 py-0.5 hover:bg-muted", KIND_STYLE[it.kind], it.done ? "text-muted-foreground line-through" : "")}
                        title={it.title}
                      >
                        {it.title}
                      </Link>
                    </li>
                  ))}
                  {items.length > 6 ? <li className="px-1 text-muted-foreground">{t("crm.calendar.more", { count: items.length - 6 })}</li> : null}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>
      {cal.items.length === 0 ? <p className="text-sm text-muted-foreground">{t("crm.calendar.empty")}</p> : null}
    </CrmFrame>
  );
}
