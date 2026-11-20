import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { workContext } from "@/components/work/context";
import { SectionTabs, StatCard } from "@/components/work/ui";
import { ProjectsAreaTabs, TaskCalendar, TaskTable } from "@/components/work/views";
import { getT } from "@/i18n/server";
import { monthRange } from "@/server/modules/work/calendar";
import { param } from "@/server/modules/work/shared";
import { calendarTasks, myTasks } from "@/server/modules/work/tasks";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.tabs.myTasks") };
}

export default async function MyTasksPage({ searchParams }: PageProps<"/[locale]/projects/my-tasks">) {
  const t = await getT();
  const w = await workContext("projects", t("modules.projects.title"), t("work.projectsSubtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company } = w;
  const raw = await searchParams;
  const view = param(raw, "view") === "calendar" ? "calendar" : "list";
  const path = `/${locale}/projects/my-tasks`;
  const mine = await myTasks(viewer.ctx, org.id, company.id);
  const r = monthRange(param(raw, "month"));
  const cal = view === "calendar" ? await calendarTasks(viewer.ctx, org.id, company.id, { from: r.from, to: r.to }, { mine: true }) : [];
  const groups = [
    { key: "overdue", rows: mine.overdue },
    { key: "today", rows: mine.today },
    { key: "week", rows: mine.week },
    { key: "later", rows: mine.later },
    { key: "done", rows: mine.done },
  ] as const;
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {w.header}
      <ProjectsAreaTabs t={t} locale={locale} active="my" />
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label={t("work.my.overdue")} value={mine.overdue.length} tone={mine.overdue.length ? "danger" : undefined} />
        <StatCard label={t("work.my.today")} value={mine.today.length} />
        <StatCard label={t("work.my.week")} value={mine.week.length} />
        <StatCard label={t("work.my.doneRecently")} value={mine.done.length} tone="success" />
      </div>
      <SectionTabs
        label={t("work.my.views")}
        active={view}
        tabs={[
          { key: "list", href: path, label: t("work.tabs.list") },
          { key: "calendar", href: `${path}?view=calendar`, label: t("work.tabs.calendar") },
        ]}
      />
      {view === "calendar" ? (
        <Card>
          <TaskCalendar t={t} locale={locale} month={r.month} tasks={cal} prevHref={`${path}?view=calendar&month=${r.prev}`} nextHref={`${path}?view=calendar&month=${r.next}`} todayHref={`${path}?view=calendar`} />
        </Card>
      ) : groups.every((g) => !g.rows.length) ? (
        <Card>
          <p className="p-4 text-sm text-muted-foreground">
            {t("work.my.empty")}{" "}
            <Link href={`/${locale}/projects/tasks`} className="underline">
              {t("work.tabs.allTasks")}
            </Link>
          </p>
        </Card>
      ) : (
        groups
          .filter((g) => g.rows.length)
          .map((g) => (
            <Card key={g.key}>
              <CardHeader title={t(`work.my.${g.key}`)} description={t("work.task.count", { count: g.rows.length })} />
              <TaskTable t={t} locale={locale} rows={[...g.rows]} showProject />
            </Card>
          ))
      )}
    </div>
  );
}
