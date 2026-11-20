import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MarketingShell, loadMarketing } from "@/components/marketing/shell";
import { HelpPanel, InfoStrip } from "@/components/marketing/studio";
import { MarketingCalendar } from "@/components/marketing/marketing-calendar";
import { getT } from "@/i18n/server";
import { param } from "@/server/modules/marketing/common";
import { calendarFeed } from "@/server/modules/marketing/calendar";
import { listHelpTasks } from "@/server/modules/marketing/intelligence";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.calendar") };
}

const DAY = 86_400_000;

export default async function MarketingCalendarPage({ searchParams }: PageProps<"/[locale]/marketing/calendar">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "calendar" as const, title: t("marketing.calendar.title"), subtitle: t("marketing.calendar.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, tz, aiReady, canManage, canRunAgents } = m;
  const sp = await searchParams;
  const view = param(sp, "view") === "week" ? "week" : "month";
  const rawDate = param(sp, "date") ?? (param(sp, "month") ? `${param(sp, "month")}-01` : undefined);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const anchor = rawDate && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(rawDate) ? rawDate : today;
  // Window: the whole month grid (or week) plus two days of margin on each side so any viewer time zone is covered.
  const a = new Date(`${anchor}T00:00:00Z`);
  const from = view === "week" ? new Date(a.getTime() - 9 * DAY) : new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1) - 9 * DAY);
  const to = view === "week" ? new Date(a.getTime() + 9 * DAY) : new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1) + 15 * DAY);
  const [items, help] = await Promise.all([calendarFeed(viewer.ctx, org.id, company.id, from, to, `/${locale}`), listHelpTasks(org.id, company.id, "calendar")]);

  return (
    <MarketingShell
      {...shell}
      actions={
        canManage ? (
          <div className="flex flex-wrap gap-2">
            <Link href={`/${locale}/marketing/social`} className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-surface px-3 text-sm hover:bg-muted">
              <Plus className="size-4" aria-hidden />
              {t("marketing.calendar.newPost")}
            </Link>
            <Link href={`/${locale}/marketing/content`} className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-surface px-3 text-sm hover:bg-muted">
              <Plus className="size-4" aria-hidden />
              {t("marketing.calendar.newContent")}
            </Link>
          </div>
        ) : null
      }
    >
      <InfoStrip t={t} k="calendar" />
      <Card variant="glass" className="p-3 sm:p-4">
        <MarketingCalendar items={items} anchor={anchor} view={view} companyTz={tz} base={base} canManage={canManage} />
      </Card>
      <HelpPanel t={t} base={base} page="calendar" tasks={help} locale={locale} tz={tz} aiReady={aiReady} canRun={canRunAgents} />
    </MarketingShell>
  );
}
