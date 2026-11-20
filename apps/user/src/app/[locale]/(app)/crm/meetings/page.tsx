import type { Metadata } from "next";
import Link from "next/link";
import { CrmFrame, crmContext } from "@/components/crm/shell";
import { MeetingActions } from "@/components/crm/revenue/meetings";
import { EngineStatus } from "@/components/crm/revenue/visuals";
import { Badge } from "@/components/ui/badge";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { revenueChannels } from "@/server/modules/crm/channels";
import { listCrmMeetings } from "@/server/modules/crm/meetings";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.meetings") };
}

/** Sales meetings: what's coming up, what happened, calendar files and outcomes. Booking happens on a lead/contact/deal. */
export default async function MeetingsPage() {
  const c = await crmContext();
  if (!c.company || !c.canRead) return <CrmFrame active="meetings">{null}</CrmFrame>;
  const { t, locale, tz, org, company, viewer, base } = c;
  const [upcoming, recent, channels] = await Promise.all([
    listCrmMeetings(viewer.ctx, org.id, company.id, { upcoming: true, take: 50 }),
    listCrmMeetings(viewer.ctx, org.id, company.id, { take: 30 }),
    revenueChannels(org.id, company.id),
  ]);
  const past = recent.filter((m) => !upcoming.some((u) => u.id === m.id));
  const href = (m: (typeof recent)[number]) => `/${locale}${m.dealId ? `/crm/deals/${m.dealId}` : m.leadId ? `/crm/${m.leadId}` : m.contactId ? `/crm/contacts/${m.contactId}` : "/crm"}`;
  const row = (m: (typeof recent)[number]) => {
    const d = new Date(m.startsAt);
    return (
      <li key={m.id} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-3 rounded-xl border bg-surface p-3 shadow-elev-1">
        <div className="grid place-content-center rounded-lg bg-accent p-2 text-center text-accent-foreground">
          <span className="text-xs uppercase">{new Intl.DateTimeFormat(locale, { month: "short", timeZone: tz }).format(d)}</span>
          <span className="font-display text-2xl leading-none tabular-nums">{new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: tz }).format(d)}</span>
        </div>
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={href(m)} className="truncate font-medium hover:underline">
              {m.title}
            </Link>
            <Badge tone={m.status === "SCHEDULED" ? "accent" : m.status === "COMPLETED" ? "success" : "neutral"}>{t(`crm.rev.meet.status.${m.status}`)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {formatDateTime(m.startsAt, locale, tz)}
            {m.attendeeName ? ` · ${m.attendeeName}` : ""}
            {m.location ? ` · ${m.location}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {m.externalId ? t(m.inviteSentAt ? "crm.rev.meet.onCalendarGuest" : "crm.rev.meet.onCalendar", { email: m.attendeeEmail ?? "" }) : m.calendarError ? t("crm.rev.meet.calendarFailed") : t("crm.rev.meet.notOnCalendar")}
          </p>
          {m.outcome ? <p className="whitespace-pre-wrap text-sm">{m.outcome}</p> : null}
          <MeetingActions base={base} id={m.id} scheduled={m.status === "SCHEDULED"} canManage={c.canManage} retry={!m.externalId && !!channels.calendar} />
        </div>
      </li>
    );
  };
  return (
    <CrmFrame active="meetings" eyebrow={t("crm.rev.meet.eyebrow")} title={t("crm.rev.meet.pageTitle")} subtitle={t("crm.rev.meet.subtitle")}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid content-start gap-4">
          <section className="grid gap-3" aria-labelledby="up-h">
            <h2 id="up-h" className="font-display text-2xl">{t("crm.rev.meet.upcoming", { count: upcoming.length })}</h2>
            {upcoming.length ? <ul className="grid gap-3">{upcoming.map(row)}</ul> : <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{t("crm.rev.meet.emptyUpcoming")}</p>}
          </section>
          {past.length ? (
            <section className="grid gap-3" aria-labelledby="past-h">
              <h2 id="past-h" className="font-display text-xl">{t("crm.rev.meet.past")}</h2>
              <ul className="grid gap-3">{past.map(row)}</ul>
            </section>
          ) : null}
        </div>
        <aside className="grid content-start gap-4">
          <EngineStatus channels={channels} locale={locale} t={t} />
        </aside>
      </div>
    </CrmFrame>
  );
}
