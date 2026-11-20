import { formatDate } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";

/**
 * Project Gantt (SVG, server-rendered): task bars on a week grid, finish-to-start dependency arrows (red when the
 * successor starts before its predecessor ends), the longest dependency chain (critical path by duration), milestone
 * diamonds and today's line. Everything is drawn from the project's real tasks, dependencies and milestones.
 */

const DAY = 86_400_000;

export interface GanttTask {
  id: string;
  title: string;
  status: string;
  startDate: Date | null;
  dueDate: Date | null;
  estimatePoints: number | null;
  assignee: { id: string; name: string } | null;
}

export interface GanttMilestone {
  id: string;
  title: string;
  dueDate: Date | null;
  completedAt: Date | null;
}

const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

/** Longest chain through the dependency graph, weighted by task duration in days (CPM earliest finish). */
export function criticalPath(tasks: { id: string; days: number }[], deps: { taskId: string; dependsOnId: string }[]) {
  const ids = new Set(tasks.map((t) => t.id));
  const dur = new Map(tasks.map((t) => [t.id, t.days]));
  const preds = new Map<string, string[]>();
  for (const d of deps) {
    if (!ids.has(d.taskId) || !ids.has(d.dependsOnId)) continue;
    preds.set(d.taskId, [...(preds.get(d.taskId) ?? []), d.dependsOnId]);
  }
  const ef = new Map<string, number>();
  const via = new Map<string, string | null>();
  const visiting = new Set<string>();
  const finish = (id: string): number => {
    const known = ef.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // defensive: cycles are rejected on write
    visiting.add(id);
    let best = 0;
    let from: string | null = null;
    for (const p of preds.get(id) ?? []) {
      const f = finish(p);
      if (f > best) {
        best = f;
        from = p;
      }
    }
    visiting.delete(id);
    const v = best + (dur.get(id) ?? 1);
    ef.set(id, v);
    via.set(id, from);
    return v;
  };
  let end: string | null = null;
  let max = 0;
  for (const t of tasks) {
    const f = finish(t.id);
    if (f > max) {
      max = f;
      end = t.id;
    }
  }
  const chain = new Set<string>();
  for (let cur = end; cur; cur = via.get(cur) ?? null) chain.add(cur);
  // A single task is not a "chain": only report a critical path when dependencies are involved.
  return { ids: chain.size > 1 ? chain : new Set<string>(), days: chain.size > 1 ? max : 0 };
}

export function ProjectGantt({ t, locale, tasks, deps, milestones, hrefFor }: { t: Translate; locale: string; tasks: GanttTask[]; deps: { taskId: string; dependsOnId: string }[]; milestones: GanttMilestone[]; hrefFor: (taskId: string) => string }) {
  const dated = tasks.filter((x) => x.startDate || x.dueDate);
  const ms = milestones.filter((m) => m.dueDate);
  const all = [...dated.flatMap((x) => [x.startDate, x.dueDate]), ...ms.map((m) => m.dueDate)].filter((d): d is Date => !!d).map(utcDay);
  if (!all.length) return <p className="p-4 text-sm text-muted-foreground">{t("work.timeline.empty")}</p>;
  const now = new Date();
  const today = utcDay(now);
  const minDay = Math.min(...all);
  const start = minDay - (((new Date(minDay).getUTCDay() + 6) % 7) * DAY); // Monday of the first week
  const maxDay = Math.max(...all);
  const weeks = Math.min(78, Math.max(4, Math.ceil((maxDay - start) / DAY / 7) + 1));
  const days = weeks * 7;

  const LABEL = 220;
  const DAYW = weeks > 30 ? 9 : 16;
  const ROW = 30;
  const HEAD = 34;
  const MSLANE = ms.length ? 26 : 0;
  const W = LABEL + days * DAYW + 16;
  const H = HEAD + MSLANE + dated.length * ROW + 8;
  const dx = (v: number) => LABEL + ((v - start) / DAY) * DAYW;

  const rows = dated.map((x, i) => {
    const s = utcDay(x.startDate ?? x.dueDate!);
    const e = utcDay(x.dueDate ?? x.startDate!);
    const from = Math.min(s, e);
    const to = Math.max(s, e);
    return { ...x, i, from, to, x0: dx(from), x1: dx(to + DAY), y: HEAD + MSLANE + i * ROW, days: Math.round((to - from) / DAY) + 1 };
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const crit = criticalPath(rows, deps);
  const edges = deps
    .map((d) => ({ from: byId.get(d.dependsOnId), to: byId.get(d.taskId) }))
    .filter((e): e is { from: (typeof rows)[number]; to: (typeof rows)[number] } => !!e.from && !!e.to)
    .map((e) => ({ ...e, violated: e.to.from < e.from.to + DAY && e.to.status !== "DONE", critical: crit.ids.has(e.from.id) && crit.ids.has(e.to.id) }));
  const violations = edges.filter((e) => e.violated).length;
  const late = rows.filter((r) => r.to < today && r.status !== "DONE").length;
  const weekFmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });

  const fill = (r: (typeof rows)[number]) =>
    r.status === "DONE" ? "color-mix(in oklch, var(--success) 65%, var(--surface))" : r.to < today ? "var(--danger)" : r.status === "IN_PROGRESS" || r.status === "IN_REVIEW" ? "var(--primary)" : "color-mix(in oklch, var(--primary) 40%, var(--surface))";

  return (
    <figure className="grid gap-3">
      <div className="flex flex-wrap gap-2 px-4 text-xs">
        <span className="rounded-full border px-2.5 py-1">{t("projectsGantt.summary.tasks", { count: rows.length })}</span>
        <span className="rounded-full border px-2.5 py-1">{t("projectsGantt.summary.dependencies", { count: edges.length })}</span>
        {crit.days ? <span className="rounded-full border border-warning/50 bg-warning/10 px-2.5 py-1">{t("projectsGantt.summary.critical", { count: crit.ids.size, days: crit.days })}</span> : null}
        {violations ? <span className="rounded-full border border-danger/50 bg-danger/10 px-2.5 py-1 text-danger">{t("projectsGantt.summary.conflicts", { count: violations })}</span> : null}
        {late ? <span className="rounded-full border border-danger/50 bg-danger/10 px-2.5 py-1 text-danger">{t("projectsGantt.summary.late", { count: late })}</span> : null}
      </div>
      <div className="overflow-x-auto" dir="ltr">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-none" role="img" aria-label={t("projectsGantt.label", { count: rows.length })}>
          <defs>
            <marker id="g-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" fill="var(--muted-foreground)" />
            </marker>
            <marker id="g-arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" fill="var(--danger)" />
            </marker>
            <marker id="g-arrow-crit" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" fill="var(--warning)" />
            </marker>
            <clipPath id="g-label">
              <rect x={0} y={0} width={LABEL - 12} height={H} />
            </clipPath>
          </defs>

          {/* week grid */}
          {Array.from({ length: weeks }, (_, w) => {
            const x = LABEL + w * 7 * DAYW;
            return (
              <g key={w}>
                {w % 2 === 1 ? <rect x={x} y={HEAD} width={7 * DAYW} height={H - HEAD} fill="var(--muted)" opacity={0.35} /> : null}
                <line x1={x} x2={x} y1={HEAD - 8} y2={H} stroke="var(--border)" />
                {weeks <= 30 || w % 2 === 0 ? (
                  <text x={x + 4} y={HEAD - 14} className="fill-muted-foreground text-[10px]">
                    {weekFmt.format(new Date(start + w * 7 * DAY))}
                  </text>
                ) : null}
              </g>
            );
          })}
          <line x1={0} x2={W} y1={HEAD} y2={HEAD} stroke="var(--border)" />

          {/* milestones lane */}
          {ms.length ? (
            <g>
              <text x={8} y={HEAD + 17} className="fill-muted-foreground text-[11px] font-medium">
                {t("work.timeline.milestones")}
              </text>
              {ms.map((m) => {
                const x = dx(utcDay(m.dueDate!) + DAY / 2);
                return (
                  <g key={m.id}>
                    <line x1={x} x2={x} y1={HEAD} y2={H} stroke={m.completedAt ? "var(--success)" : "var(--warning)"} strokeDasharray="2 4" opacity={0.7} />
                    <rect x={x - 6} y={HEAD + 7} width={12} height={12} transform={`rotate(45 ${x} ${HEAD + 13})`} fill={m.completedAt ? "var(--success)" : "var(--warning)"}>
                      <title>{`${m.title} · ${formatDate(m.dueDate!, locale, "UTC")}`}</title>
                    </rect>
                  </g>
                );
              })}
              <line x1={0} x2={W} y1={HEAD + MSLANE} y2={HEAD + MSLANE} stroke="var(--border)" />
            </g>
          ) : null}

          {/* today */}
          {today >= start && today < start + days * DAY ? (
            <g>
              <line x1={dx(today + DAY / 2)} x2={dx(today + DAY / 2)} y1={HEAD - 6} y2={H} stroke="var(--primary)" strokeWidth={1.5} />
              <text x={dx(today + DAY / 2) + 3} y={HEAD - 3} className="fill-primary text-[9px] font-semibold">
                {t("projectsGantt.today")}
              </text>
            </g>
          ) : null}

          {/* dependency arrows (finish → start) */}
          {edges.map((e) => {
            const x1 = e.from.x1;
            const y1 = e.from.y + ROW / 2;
            const x2 = e.to.x0;
            const y2 = e.to.y + ROW / 2;
            const d = x2 - 8 >= x1 + 8 ? `M${x1},${y1} H${x1 + 8} V${y2} H${x2 - 1}` : `M${x1},${y1} h8 V${(y1 + y2) / 2} H${x2 - 10} V${y2} H${x2 - 1}`;
            return (
              <path
                key={`${e.from.id}-${e.to.id}`}
                d={d}
                fill="none"
                stroke={e.violated ? "var(--danger)" : e.critical ? "var(--warning)" : "var(--muted-foreground)"}
                strokeWidth={e.critical || e.violated ? 1.8 : 1.1}
                opacity={e.critical || e.violated ? 1 : 0.6}
                markerEnd={`url(#${e.violated ? "g-arrow-bad" : e.critical ? "g-arrow-crit" : "g-arrow"})`}
              />
            );
          })}

          {/* rows */}
          {rows.map((r) => {
            const critical = crit.ids.has(r.id);
            const w = Math.max(DAYW - 2, r.x1 - r.x0 - 2);
            return (
              <g key={r.id}>
                <line x1={0} x2={W} y1={r.y + ROW} y2={r.y + ROW} stroke="var(--border)" opacity={0.5} />
                <a href={hrefFor(r.id)}>
                  <text x={8} y={r.y + ROW / 2 + 4} clipPath="url(#g-label)" className="fill-foreground text-[12px] hover:underline">
                    {r.title}
                  </text>
                  <rect x={r.x0 + 1} y={r.y + 7} width={w} height={ROW - 14} rx={5} fill={fill(r)} stroke={critical ? "var(--warning)" : "transparent"} strokeWidth={critical ? 2 : 0} className="motion-safe:transition-opacity hover:opacity-85">
                    <title>{`${r.title}: ${formatDate(new Date(r.from), locale, "UTC")} – ${formatDate(new Date(r.to), locale, "UTC")} · ${t(`work.taskStatus.${r.status}`)}${r.assignee ? ` · ${r.assignee.name}` : ""}${r.estimatePoints != null ? ` · ${r.estimatePoints} pt` : ""}`}</title>
                  </rect>
                </a>
                {r.assignee ? (
                  <g>
                    <circle cx={r.x0 + w + 12} cy={r.y + ROW / 2} r={9} fill="var(--surface)" stroke="var(--border)" />
                    <text x={r.x0 + w + 12} y={r.y + ROW / 2 + 3} textAnchor="middle" className="fill-muted-foreground text-[8px] font-semibold">
                      {initials(r.assignee.name)}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
          <line x1={LABEL} x2={LABEL} y1={0} y2={H} stroke="var(--border)" />
        </svg>
      </div>
      <figcaption className="flex flex-wrap gap-3 px-4 pb-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-sm" style={{ background: "color-mix(in oklch, var(--primary) 40%, var(--surface))" }} />{t("work.timeline.planned")}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-sm bg-primary" />{t("work.timeline.inProgress")}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-sm bg-success/60" />{t("work.timeline.done")}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-sm bg-danger" />{t("work.timeline.late")}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded-sm border-2 border-warning" />{t("projectsGantt.legend.critical")}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-danger" />{t("projectsGantt.legend.conflict")}</span>
        <span className="flex items-center gap-1"><span className="inline-block size-2 rotate-45 bg-warning" />{t("work.timeline.milestone")}</span>
      </figcaption>
    </figure>
  );
}
