import Link from "next/link";
import { Clock, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CalendarPlan {
  id: string;
  name: string;
  enabled: boolean;
  kind: "RECURRING" | "EVENT";
  frequency: "HOURLY" | "DAILY" | "WEEKLY" | null;
  timeOfDay: string | null;
  weekday: number | null;
  eventLabel: string | null;
  employee: { id: string; name: string };
}

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const HUES = ["bg-primary/12 border-primary/30 text-primary", "bg-success/12 border-success/30 text-success", "bg-warning/12 border-warning/30 text-warning", "bg-info/12 border-info/30 text-info", "bg-danger/12 border-danger/30 text-danger", "bg-primary-2/12 border-primary-2/30 text-primary-2"];
const hueFor = (id: string) => HUES[Array.from(id).reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length]!;

/**
 * The week of recurring AI work: one column per weekday with each plan at its time (daily plans in every column,
 * hourly plans as a band), event-triggered plans alongside. Today is highlighted; paused plans are faded.
 */
export function WeekCalendar({ plans, todayWeekday, locale, labels }: { plans: CalendarPlan[]; todayWeekday: number; locale: string; labels: { weekday: (n: number) => string; hourly: (minute: string) => string; events: string; eventsEmpty: string; paused: string; today: string; nothing: string } }) {
  const recurring = plans.filter((p) => p.kind === "RECURRING");
  const hourly = recurring.filter((p) => p.frequency === "HOURLY");
  const events = plans.filter((p) => p.kind === "EVENT");
  const chip = (p: CalendarPlan, time?: string | null) => (
    <Link
      key={p.id}
      href={`/${locale}/workforce/${p.employee.id}`}
      title={`${p.name} — ${p.employee.name}${p.enabled ? "" : ` (${labels.paused})`}`}
      className={cn("hover-lift grid gap-0.5 rounded-md border px-2 py-1.5 text-[11px] leading-tight", hueFor(p.employee.id), !p.enabled && "opacity-45 grayscale")}
    >
      {time ? <span className="font-semibold tabular-nums">{time}</span> : null}
      <span className="line-clamp-2 font-medium text-foreground">{p.name}</span>
      <span className="truncate opacity-80">{p.employee.name}</span>
    </Link>
  );
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="overflow-x-auto">
        <div className="grid min-w-[44rem] grid-cols-7 gap-1.5">
          {WEEK.map((wd) => {
            const items = recurring
              .filter((p) => p.frequency === "DAILY" || (p.frequency === "WEEKLY" && p.weekday === wd))
              .sort((a, b) => (a.timeOfDay ?? "").localeCompare(b.timeOfDay ?? ""));
            const isToday = wd === todayWeekday;
            return (
              <section key={wd} aria-label={labels.weekday(wd)} className={cn("grid min-h-48 content-start gap-1.5 rounded-lg border p-1.5", isToday ? "border-primary/50 bg-primary/5 shadow-glow" : "bg-surface-2/40")}>
                <h3 className="flex items-center justify-between px-1 pb-1 text-xs font-semibold">
                  {labels.weekday(wd)}
                  {isToday ? <span className="rounded-full bg-brand-gradient px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">{labels.today}</span> : null}
                </h3>
                {hourly.length ? (
                  <div className="grid gap-1">
                    {hourly.map((p) => (
                      <div key={p.id} className={cn("flex items-center gap-1 rounded border border-dashed px-1.5 py-1 text-[10px]", hueFor(p.employee.id), !p.enabled && "opacity-45")} title={`${p.name} — ${p.employee.name}`}>
                        <Clock className="size-3 shrink-0" aria-hidden />
                        <span className="truncate">{labels.hourly(p.timeOfDay?.slice(3) ?? "00")}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {items.map((p) => (
                  <div key={p.id}>
                    {chip(p, p.timeOfDay)}
                  </div>
                ))}
                {!items.length && !hourly.length ? <p className="px-1 pt-4 text-center text-[11px] text-muted-foreground">{labels.nothing}</p> : null}
              </section>
            );
          })}
        </div>
      </div>
      <aside className="grid content-start gap-2 rounded-lg border bg-surface-2/40 p-2" aria-label={labels.events}>
        <h3 className="flex items-center gap-1.5 px-1 text-xs font-semibold">
          <Zap className="size-3.5 text-warning" aria-hidden /> {labels.events}
        </h3>
        {events.length ? (
          events.map((p) => (
            <div key={p.id} className="grid gap-1">
              <span className="px-1 text-[11px] text-muted-foreground">{p.eventLabel}</span>
              {chip(p)}
            </div>
          ))
        ) : (
          <p className="px-1 text-[11px] text-muted-foreground">{labels.eventsEmpty}</p>
        )}
      </aside>
    </div>
  );
}
