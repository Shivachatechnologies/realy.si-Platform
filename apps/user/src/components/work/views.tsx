import Link from "next/link";
import { Lock, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { formatDate } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { GrowBar } from "./motion-bits";
import { PRIORITY_TONE, STATUS_TONE, type TabDef, SectionTabs } from "./ui";

export interface TaskRow {
  id: string;
  title: string;
  status: keyof typeof STATUS_TONE;
  priority: keyof typeof PRIORITY_TONE;
  startDate: Date | null;
  dueDate: Date | null;
  estimatePoints: number | null;
  labels: string[];
  recurrence: string | null;
  assignee: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  _count: { subtasks: number; comments: number; attachments: number; dependsOn: number };
}

const DAY = 86_400_000;
const utcToday = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};
const isOpen = (s: string) => s !== "DONE" && s !== "CANCELLED";

export function ProjectTabs({ t, locale, projectId, active }: { t: Translate; locale: string; projectId: string; active: string }) {
  const p = `/${locale}/projects/${projectId}`;
  const tabs: TabDef[] = [
    { key: "overview", href: p, label: t("work.tabs.overview") },
    { key: "board", href: `${p}/board`, label: t("work.tabs.board") },
    { key: "list", href: `${p}/list`, label: t("work.tabs.list") },
    { key: "timeline", href: `${p}/timeline`, label: t("work.tabs.timeline") },
    { key: "calendar", href: `${p}/calendar`, label: t("work.tabs.calendar") },
    { key: "sprints", href: `${p}/sprints`, label: t("work.tabs.sprints") },
  ];
  return <SectionTabs tabs={tabs} active={active} label={t("work.tabs.projectLabel")} />;
}

export function ProjectsAreaTabs({ t, locale, active }: { t: Translate; locale: string; active: string }) {
  const tabs: TabDef[] = [
    { key: "projects", href: `/${locale}/projects`, label: t("work.tabs.projects") },
    { key: "start", href: `/${locale}/projects/start`, label: t("work.tabs.start") },
    { key: "my", href: `/${locale}/projects/my-tasks`, label: t("work.tabs.myTasks") },
    { key: "tasks", href: `/${locale}/projects/tasks`, label: t("work.tabs.allTasks") },
    { key: "templates", href: `/${locale}/projects/templates`, label: t("work.tabs.templates") },
  ];
  return <SectionTabs tabs={tabs} active={active} label={t("work.tabs.projectsLabel")} />;
}

/** Sortable task table (sorting via links preserving the other query params). */
export function TaskTable({ t, locale, rows, showProject, sortLink, sort, dir }: { t: Translate; locale: string; rows: TaskRow[]; showProject?: boolean; sortLink?: (key: string) => string; sort?: string; dir?: string }) {
  const today = utcToday();
  const head = (key: string, label: string) =>
    sortLink ? (
      <Link href={sortLink(key)} className="hover:text-foreground" aria-sort={sort === key ? (dir === "desc" ? "descending" : "ascending") : undefined}>
        {label}
        {sort === key ? (dir === "desc" ? " ↓" : " ↑") : ""}
      </Link>
    ) : (
      label
    );
  return (
    <Table>
      <THead>
        <Tr>
          <Th>{head("title", t("work.task.title"))}</Th>
          {showProject ? <Th>{t("work.task.project")}</Th> : null}
          <Th>{head("status", t("work.task.status"))}</Th>
          <Th>{head("priority", t("work.task.priority"))}</Th>
          <Th>{t("work.task.assignee")}</Th>
          <Th>{head("due", t("work.dueDate"))}</Th>
          <Th className="text-end">{t("work.task.estimateShort")}</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((r) => {
          const overdue = r.dueDate && r.dueDate < today && isOpen(r.status);
          return (
            <Tr key={r.id}>
              <Td className="max-w-[28rem]">
                <Link href={`/${locale}/projects/tasks/${r.id}`} className="font-medium break-words hover:underline">
                  {r.title}
                </Link>
                <span className="ms-2 inline-flex flex-wrap gap-1 align-middle">
                  {r.recurrence ? <Repeat className="size-3 text-muted-foreground" aria-label={t("work.task.recurring")} /> : null}
                  {r._count.dependsOn ? <Lock className="size-3 text-muted-foreground" aria-label={t("work.task.hasDependencies")} /> : null}
                  {r._count.subtasks ? <span className="text-xs text-muted-foreground">{t("work.task.subtaskCount", { count: r._count.subtasks })}</span> : null}
                  {r.labels.slice(0, 3).map((l) => (
                    <Badge key={l}>{l}</Badge>
                  ))}
                </span>
              </Td>
              {showProject ? (
                <Td className="text-muted-foreground">
                  {r.project ? (
                    <Link href={`/${locale}/projects/${r.project.id}`} className="hover:underline">
                      {r.project.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </Td>
              ) : null}
              <Td>
                <Badge tone={STATUS_TONE[r.status]}>{t(`work.taskStatus.${r.status}`)}</Badge>
              </Td>
              <Td>
                <Badge tone={PRIORITY_TONE[r.priority]}>{t(`work.priority.${r.priority}`)}</Badge>
              </Td>
              <Td className="text-muted-foreground">{r.assignee?.name ?? t("work.unassigned")}</Td>
              <Td className={cn("whitespace-nowrap", overdue ? "text-danger" : "text-muted-foreground")}>{r.dueDate ? formatDate(r.dueDate, locale, "UTC") : "—"}</Td>
              <Td className="text-end tabular-nums text-muted-foreground">{r.estimatePoints ?? "—"}</Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}

/** Month grid of tasks by due date (weeks start on Monday). */
export function TaskCalendar({ t, locale, month, tasks, prevHref, nextHref, todayHref }: { t: Translate; locale: string; month: string; tasks: TaskRow[]; prevHref: string; nextHref: string; todayHref: string }) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - offset * DAY);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weeks = Math.ceil((offset + daysInMonth) / 7);
  const today = utcToday().getTime();
  const byDay = new Map<number, TaskRow[]>();
  for (const task of tasks) if (task.dueDate) byDay.set(task.dueDate.getTime(), [...(byDay.get(task.dueDate.getTime()) ?? []), task]);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const title = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex gap-2 text-xs">
          <Link href={prevHref} className="rounded-md border px-2 py-1 hover:bg-muted">
            {t("work.calendar.prev")}
          </Link>
          <Link href={todayHref} className="rounded-md border px-2 py-1 hover:bg-muted">
            {t("work.calendar.today")}
          </Link>
          <Link href={nextHref} className="rounded-md border px-2 py-1 hover:bg-muted">
            {t("work.calendar.next")}
          </Link>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[42rem] grid-cols-7 border-t text-xs">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="border-b border-e px-2 py-1 font-medium text-muted-foreground">
              {weekday.format(new Date(start.getTime() + i * DAY))}
            </div>
          ))}
          {Array.from({ length: weeks * 7 }, (_, i) => {
            const d = new Date(start.getTime() + i * DAY);
            const inMonth = d.getUTCMonth() === m - 1;
            const items = byDay.get(d.getTime()) ?? [];
            return (
              <div key={i} className={cn("min-h-24 border-b border-e p-1", !inMonth && "bg-surface-2 text-muted-foreground")}>
                <div className={cn("mb-1 text-end", d.getTime() === today && "font-semibold text-primary")}>{d.getUTCDate()}</div>
                <ul className="grid gap-0.5">
                  {items.slice(0, 4).map((task) => (
                    <li key={task.id}>
                      <Link
                        href={`/${locale}/projects/tasks/${task.id}`}
                        className={cn(
                          "block truncate rounded px-1 py-0.5 hover:underline",
                          task.status === "DONE" ? "bg-success/10 line-through" : d.getTime() < today && isOpen(task.status) ? "bg-danger/10" : "bg-accent",
                        )}
                        title={task.title}
                      >
                        {task.title}
                      </Link>
                    </li>
                  ))}
                  {items.length > 4 ? <li className="px-1 text-muted-foreground">{t("work.calendar.more", { count: items.length - 4 })}</li> : null}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Gantt-style timeline: one row per task, bars from start to due on a day grid grouped by week. */
export function Timeline({
  t,
  locale,
  tasks,
  deps,
  milestones,
}: {
  t: Translate;
  locale: string;
  tasks: TaskRow[];
  deps: { taskId: string; dependsOnId: string }[];
  milestones: { id: string; title: string; dueDate: Date | null; completedAt: Date | null }[];
}) {
  const dates = [...tasks.flatMap((x) => [x.startDate, x.dueDate]), ...milestones.map((m) => m.dueDate)].filter((d): d is Date => !!d);
  if (!dates.length) return <p className="p-4 text-sm text-muted-foreground">{t("work.timeline.empty")}</p>;
  const min = Math.min(...dates.map((d) => d.getTime()));
  const max = Math.max(...dates.map((d) => d.getTime()));
  const minD = new Date(min);
  const start = new Date(min - ((minD.getUTCDay() + 6) % 7) * DAY);
  const weeks = Math.min(52, Math.max(4, Math.ceil((max - start.getTime()) / DAY / 7) + 1));
  const days = weeks * 7;
  const col = (d: Date) => Math.max(1, Math.min(days, Math.round((d.getTime() - start.getTime()) / DAY) + 1));
  const today = utcToday();
  const todayCol = today >= start && col(today) <= days && today.getTime() - start.getTime() < days * DAY ? col(today) : null;
  const weekFmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const titles = new Map(tasks.map((x) => [x.id, x.title]));
  const grid = { gridTemplateColumns: `repeat(${days}, minmax(0.6rem, 1fr))` };
  return (
    <div className="overflow-x-auto [--grow-origin:left] rtl:[--grow-origin:right]">
      <div className="grid min-w-[56rem] grid-cols-[14rem_minmax(0,1fr)] text-xs">
        <div className="border-b border-e px-2 py-1 font-medium text-muted-foreground">{t("work.task.title")}</div>
        <div className="grid border-b" style={grid}>
          {Array.from({ length: weeks }, (_, w) => (
            <div key={w} className="border-e px-1 py-1 text-muted-foreground" style={{ gridColumn: `${w * 7 + 1} / span 7` }}>
              {weekFmt.format(new Date(start.getTime() + w * 7 * DAY))}
            </div>
          ))}
        </div>
        {milestones.filter((m) => m.dueDate).length ? (
          <>
            <div className="border-b border-e px-2 py-1 font-medium">{t("work.timeline.milestones")}</div>
            <div className="relative grid border-b py-1" style={grid}>
              {milestones
                .filter((m) => m.dueDate)
                .map((m) => (
                  <span key={m.id} className="z-10 truncate" style={{ gridColumn: `${col(m.dueDate!)} / span 1`, gridRow: 1 }} title={`${m.title} · ${formatDate(m.dueDate!, locale, "UTC")}`}>
                    <span className={cn("inline-block size-2.5 rotate-45", m.completedAt ? "bg-success" : "bg-warning")} aria-label={m.title} />
                  </span>
                ))}
            </div>
          </>
        ) : null}
        {tasks.map((x, rowIndex) => {
          const s = x.startDate ?? x.dueDate!;
          const e = x.dueDate ?? x.startDate!;
          const from = col(s);
          const span = Math.max(1, col(e) - from + 1);
          const waits = deps.filter((d) => d.taskId === x.id).map((d) => titles.get(d.dependsOnId)).filter(Boolean);
          const late = x.dueDate && x.dueDate < today && isOpen(x.status);
          const lateDays = late ? Math.round((today.getTime() - x.dueDate!.getTime()) / DAY) : 0;
          return (
            <div key={x.id} className="contents">
              <div className="flex min-w-0 items-center gap-1 border-b border-e px-2 py-1.5">
                <Link href={`/${locale}/projects/tasks/${x.id}`} className="truncate hover:underline" title={x.title}>
                  {x.title}
                </Link>
                {late ? (
                  <Badge tone="danger" pulse className="shrink-0">
                    {t("work.delay.lateBy", { count: lateDays })}
                  </Badge>
                ) : null}
              </div>
              <div className="relative grid items-center border-b py-1.5" style={grid}>
                {todayCol ? <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-primary/50" style={{ insetInlineStart: `${((todayCol - 0.5) / days) * 100}%` }} /> : null}
                <GrowBar
                  index={rowIndex}
                  className={cn(
                    "h-3 rounded-sm",
                    x.status === "DONE" ? "bg-success/60" : late ? "bg-danger/70" : x.status === "IN_PROGRESS" || x.status === "IN_REVIEW" ? "bg-primary" : "bg-primary/40",
                  )}
                  style={{ gridColumn: `${from} / span ${span}`, gridRow: 1 }}
                  title={`${x.title}: ${formatDate(s, locale, "UTC")} – ${formatDate(e, locale, "UTC")}${waits.length ? ` · ${t("work.task.waitsFor")}: ${waits.join(", ")}` : ""}`}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="flex flex-wrap gap-3 p-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-sm bg-primary/40" />{t("work.timeline.planned")}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-sm bg-primary" />{t("work.timeline.inProgress")}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-sm bg-success/60" />{t("work.timeline.done")}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-sm bg-danger/70" />{t("work.timeline.late")}</span>
        <span className="flex items-center gap-1"><span className="inline-block size-2 rotate-45 bg-warning" />{t("work.timeline.milestone")}</span>
      </p>
    </div>
  );
}

/** Burndown chart (SVG): ideal (dashed) vs remaining points per day. */
export function BurndownChart({ t, series, scope }: { t: Translate; series: { date: string; ideal: number; remaining: number | null }[]; scope: number }) {
  const W = 600;
  const H = 220;
  const pad = { l: 32, r: 12, t: 12, b: 24 };
  const max = Math.max(scope, ...series.map((s) => s.remaining ?? 0), 1);
  const x = (i: number) => pad.l + (i / Math.max(1, series.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ideal = series.map((s, i) => `${i ? "L" : "M"}${x(i)},${y(s.ideal)}`).join(" ");
  const actualPts = series.map((s, i) => (s.remaining == null ? null : [x(i), y(s.remaining)] as const)).filter((p): p is readonly [number, number] => !!p);
  const actual = actualPts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
  const ticks = [0, Math.round(max / 2), max];
  return (
    <figure className="grid gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t("work.agile.burndown")}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
            <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {v}
            </text>
          </g>
        ))}
        {series.map((s, i) =>
          i === 0 || i === series.length - 1 || i % Math.ceil(series.length / 6) === 0 ? (
            <text key={s.date} x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {s.date.slice(5)}
            </text>
          ) : null,
        )}
        <path d={ideal} fill="none" className="stroke-muted-foreground" strokeDasharray="4 4" strokeWidth={1.5} />
        {actual ? <path d={actual} fill="none" className="stroke-primary" strokeWidth={2.5} strokeLinejoin="round" /> : null}
        {actualPts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={2.5} className="fill-primary" />
        ))}
      </svg>
      <figcaption className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-primary" />{t("work.agile.remaining")}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0 w-4 border-t border-dashed border-muted-foreground" />{t("work.agile.ideal")}</span>
      </figcaption>
    </figure>
  );
}

/** Velocity chart: committed vs completed points per completed sprint. */
export function VelocityChart({ t, data }: { t: Translate; data: { id: string; name: string; committed: number; completed: number }[] }) {
  if (!data.length) return <p className="text-sm text-muted-foreground">{t("work.agile.noVelocity")}</p>;
  const max = Math.max(1, ...data.flatMap((d) => [d.committed, d.completed]));
  return (
    <figure className="grid gap-2">
      <div className="flex h-44 items-end gap-3 overflow-x-auto border-b pb-1" role="img" aria-label={t("work.agile.velocity")}>
        {data.map((d) => (
          <div key={d.id} className="flex min-w-14 flex-1 flex-col items-center gap-1">
            <div className="flex h-36 w-full items-end justify-center gap-1">
              <div className="w-1/3 rounded-t bg-muted-foreground/30" style={{ height: `${(d.committed / max) * 100}%` }} title={`${t("work.agile.committed")}: ${d.committed}`} />
              <div className="w-1/3 rounded-t bg-primary" style={{ height: `${(d.completed / max) * 100}%` }} title={`${t("work.agile.completed")}: ${d.completed}`} />
            </div>
            <span className="w-full truncate text-center text-[11px] text-muted-foreground" title={d.name}>
              {d.name}
            </span>
          </div>
        ))}
      </div>
      <figcaption className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm bg-muted-foreground/30" />{t("work.agile.committed")}</span>
        <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm bg-primary" />{t("work.agile.completed")}</span>
      </figcaption>
    </figure>
  );
}
