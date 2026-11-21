import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { CrmFrame, crmContext } from "@/components/crm/shell";
import { NextActionBoard } from "@/components/crm/revenue/next-actions";
import { toSubjectView } from "@/components/crm/revenue/panels";
import { EngineStatus, Figure, PriorityOrbit } from "@/components/crm/revenue/visuals";
import { getT } from "@/i18n/server";
import { formatDateTime, formatMoney } from "@/i18n/format";
import { revenueChannels } from "@/server/modules/crm/channels";
import { listCrmMeetings } from "@/server/modules/crm/meetings";
import { nextActions, todaySnapshot } from "@/server/modules/crm/next-actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.today") };
}

/** Today: the ranked "next best action" for every open lead and deal, with the real numbers that matter. */
export default async function TodayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await crmContext();
  if (!c.company || !c.canRead) return <CrmFrame active="today">{null}</CrmFrame>;
  const { t, locale, tz, org, company, viewer, base } = c;
  const q = await searchParams;
  const mine = q.mine === "1";
  const [subjects, snap, channels, meetings] = await Promise.all([
    nextActions(viewer.ctx, org.id, company.id, { mine }),
    todaySnapshot(viewer.ctx, org.id, company.id),
    revenueChannels(org.id, company.id),
    listCrmMeetings(viewer.ctx, org.id, company.id, { upcoming: true, take: 6 }),
  ]);
  const counts: [number, number, number] = [1, 2, 3].map((p) => subjects.filter((s) => s.actions[0]!.priority === p).length) as [number, number, number];
  const money = (m: bigint) => formatMoney({ amountMinor: m, currency: snap.currency }, locale);
  return (
    <CrmFrame active="today" eyebrow={t("crm.rev.today.eyebrow")} title={t("crm.rev.today.title")} subtitle={t("crm.rev.today.subtitle")}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label={t("crm.rev.today.forecast")} value={money(snap.weightedMinor)} caption={t("crm.rev.today.forecastHint", { open: money(snap.openMinor), deals: snap.openDeals })} tone="primary" href={`/${locale}/sales`} />
        <Figure label={t("crm.rev.today.approvals")} value={snap.pending} caption={t("crm.rev.today.approvalsHint")} tone={snap.pending ? "warning" : undefined} href={`/${locale}/crm/outreach`} />
        <Figure label={t("crm.rev.today.meetings")} value={snap.meetings} caption={t("crm.rev.today.meetingsHint")} href={`/${locale}/crm/meetings`} />
        <Figure label={t("crm.rev.today.followUps")} value={snap.due} caption={t("crm.rev.today.followUpsHint", { enrolled: snap.enrolled })} href={`/${locale}/crm/calendar`} />
      </div>
      {snap.otherCurrency ? <p className="text-xs text-muted-foreground">{t("crm.rev.today.otherCurrency", { count: snap.otherCurrency })}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="grid content-start gap-3" aria-labelledby="nba-h">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="grid gap-0.5">
              <h2 id="nba-h" className="font-display text-2xl">{t("crm.rev.today.listTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("crm.rev.today.listHint")}</p>
            </div>
            <div className="flex gap-1 text-sm">
              <Link href={`/${locale}/crm/today`} aria-current={!mine ? "page" : undefined} className={!mine ? "font-semibold underline" : "text-muted-foreground hover:underline"}>
                {t("crm.rev.today.everyone")}
              </Link>
              <span aria-hidden>·</span>
              <Link href={`/${locale}/crm/today?mine=1`} aria-current={mine ? "page" : undefined} className={mine ? "font-semibold underline" : "text-muted-foreground hover:underline"}>
                {t("crm.rev.today.mine")}
              </Link>
            </div>
          </div>
          {subjects.length ? (
            <NextActionBoard base={base} locale={locale} subjects={subjects.map((s) => toSubjectView(s, locale))} canManage={c.canManage} aiText={channels.aiText.length > 0} />
          ) : (
            <div className="grid gap-2 rounded-xl border border-dashed p-6 text-center">
              <p className="font-display text-xl">{t("crm.rev.today.emptyTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("crm.rev.today.emptyText")}</p>
              <div className="flex flex-wrap justify-center gap-3 text-sm">
                <Link href={`/${locale}/crm/discover`} className="font-medium text-primary underline">
                  {t("crm.rev.today.emptyDiscover")}
                </Link>
                <Link href={`/${locale}/crm`} className="font-medium text-primary underline">
                  {t("crm.rev.today.emptyAdd")}
                </Link>
              </div>
            </div>
          )}
        </section>
        <aside className="grid content-start gap-4">
          <section className="grid gap-3 rounded-xl border bg-surface p-4 shadow-elev-1">
            <h2 className="font-display text-lg">{t("crm.rev.today.focus")}</h2>
            <PriorityOrbit counts={counts} labels={[t("crm.rev.nba.priority.1"), t("crm.rev.nba.priority.2"), t("crm.rev.nba.priority.3")]} />
          </section>
          <section className="grid gap-3 rounded-xl border bg-surface p-4 shadow-elev-1">
            <h2 className="flex items-center gap-2 font-display text-lg">
              <CalendarClock className="size-4 text-primary" aria-hidden />
              {t("crm.rev.today.upcoming")}
            </h2>
            {meetings.length ? (
              <ul className="grid gap-2 text-sm">
                {meetings.map((m) => (
                  <li key={m.id} className="grid">
                    <Link href={`/${locale}${m.dealId ? `/crm/deals/${m.dealId}` : m.leadId ? `/crm/${m.leadId}` : m.contactId ? `/crm/contacts/${m.contactId}` : "/crm/meetings"}`} className="font-medium hover:underline">
                      {m.title}
                    </Link>
                    <span className="text-xs text-muted-foreground">{formatDateTime(m.startsAt, locale, tz)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("crm.rev.meet.none")}</p>
            )}
          </section>
          <EngineStatus channels={channels} locale={locale} t={t} />
        </aside>
      </div>
    </CrmFrame>
  );
}
