import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { logger } from "@/server/core/logger";
import { notifyUsers } from "@/server/modules/notifications/service";
import { departmentManagers, runManagerTask } from "@/server/modules/cockpit/department-manager";
import { addDays, authorize, authorizeProject, dayString, today, userNames } from "./shared";

/**
 * Delivery radar for projects: deadline risks and workload balancing suggestions computed from real tasks and
 * milestones, the exportable status report, and the jobs that run them (weekly AI status reports by the hired AI project
 * manager, daily deadline-risk notifications to project owners).
 */

const OPEN = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW"] as const;
const LIVE_PROJECTS = { status: { in: ["PLANNED", "ACTIVE"] as ("PLANNED" | "ACTIVE")[] }, archivedAt: null };

export type DeadlineRiskKind = "overdue_tasks" | "due_soon_not_started" | "milestone_at_risk" | "projected_late";
export interface DeadlineRisk {
  projectId: string;
  projectName: string;
  ownerId: string | null;
  kind: DeadlineRiskKind;
  severity: "high" | "medium";
  count: number;
  /** Milestone title or the project due date, depending on the kind. */
  label: string | null;
  date: string | null;
  /** For projected_late: weeks of remaining work at the recent pace. */
  weeks: number | null;
}

async function risksFor(organizationId: string, companyId: string, projectIds?: string[]) {
  const now = today();
  const projects = await db().project.findMany({
    where: { organizationId, companyId, ...LIVE_PROJECTS, ...(projectIds ? { id: { in: projectIds } } : {}) },
    select: { id: true, name: true, ownerId: true, dueDate: true },
    take: 200,
  });
  if (!projects.length) return [];
  const ids = projects.map((p) => p.id);
  const [tasks, done, milestones] = await Promise.all([
    db().workTask.findMany({
      where: { organizationId, companyId, projectId: { in: ids }, archivedAt: null, status: { in: [...OPEN] } },
      select: { projectId: true, status: true, dueDate: true, milestoneId: true },
      take: 20_000,
    }),
    db().workTask.groupBy({ by: ["projectId"], where: { organizationId, companyId, projectId: { in: ids }, status: "DONE", completedAt: { gte: addDays(now, -28) } }, _count: { _all: true } }),
    db().projectMilestone.findMany({ where: { organizationId, companyId, projectId: { in: ids }, completedAt: null, dueDate: { gte: addDays(now, -30), lte: addDays(now, 14) } }, select: { id: true, projectId: true, title: true, dueDate: true } }),
  ]);
  const pace = new Map(done.map((d) => [d.projectId, d._count._all / 4]));
  const out: DeadlineRisk[] = [];
  for (const p of projects) {
    const mine = tasks.filter((t) => t.projectId === p.id);
    const base = { projectId: p.id, projectName: p.name, ownerId: p.ownerId, label: null, date: null, weeks: null };
    const overdue = mine.filter((t) => t.dueDate && t.dueDate < now).length;
    if (overdue) out.push({ ...base, kind: "overdue_tasks", severity: overdue >= 3 ? "high" : "medium", count: overdue });
    const soon = mine.filter((t) => t.dueDate && t.dueDate >= now && t.dueDate <= addDays(now, 3) && (t.status === "BACKLOG" || t.status === "TODO")).length;
    if (soon) out.push({ ...base, kind: "due_soon_not_started", severity: "medium", count: soon });
    for (const m of milestones.filter((x) => x.projectId === p.id)) {
      const open = mine.filter((t) => t.milestoneId === m.id).length;
      if (!open) continue;
      const late = m.dueDate! < now;
      out.push({ ...base, kind: "milestone_at_risk", severity: late || open >= 5 ? "high" : "medium", count: open, label: m.title, date: dayString(m.dueDate) });
    }
    if (p.dueDate && mine.length) {
      const perWeek = pace.get(p.id) ?? 0;
      const weeks = perWeek > 0 ? Math.ceil((mine.length / perWeek) * 10) / 10 : null;
      const finish = weeks != null ? addDays(now, Math.ceil(weeks * 7)) : null;
      if ((finish && finish > p.dueDate) || (weeks == null && p.dueDate <= addDays(now, 14))) {
        out.push({ ...base, kind: "projected_late", severity: p.dueDate < now || (finish && finish.getTime() - p.dueDate.getTime() > 14 * 86_400_000) ? "high" : "medium", count: mine.length, date: dayString(p.dueDate), weeks });
      }
    }
  }
  return out.sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === "high" ? -1 : 1));
}

export async function deadlineRisks(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  return risksFor(organizationId, companyId);
}

export interface WorkloadRow {
  userId: string;
  name: string | null;
  open: number;
  points: number;
  overdue: number;
  load: "over" | "balanced" | "light";
}
export interface ReassignSuggestion {
  taskId: string;
  title: string;
  projectId: string | null;
  projectName: string | null;
  fromId: string;
  fromName: string | null;
  toId: string;
  toName: string | null;
  dueDate: string | null;
}

/**
 * Open work per assignee (tasks, story points — 1 per unestimated task — and overdue) and suggestions to move not-yet-
 * started, lower-priority tasks from overloaded people (≥ 1.5× the team average) to the lightest-loaded member of the
 * same project. Applying a suggestion is a normal reassignment by a person.
 */
export async function workloadBalance(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const now = today();
  const tasks = await db().workTask.findMany({
    where: { organizationId, companyId, archivedAt: null, status: { in: [...OPEN] }, assigneeId: { not: null } },
    select: { id: true, title: true, status: true, priority: true, assigneeId: true, projectId: true, estimatePoints: true, dueDate: true, project: { select: { name: true } } },
    take: 10_000,
  });
  const per = new Map<string, { open: number; points: number; overdue: number }>();
  for (const t of tasks) {
    const r = per.get(t.assigneeId!) ?? { open: 0, points: 0, overdue: 0 };
    r.open++;
    r.points += t.estimatePoints ?? 1;
    if (t.dueDate && t.dueDate < now) r.overdue++;
    per.set(t.assigneeId!, r);
  }
  const ids = [...per.keys()];
  const names = await userNames(db(), ids);
  const avg = ids.length ? [...per.values()].reduce((s, r) => s + r.points, 0) / ids.length : 0;
  const rows: WorkloadRow[] = ids
    .map((id) => {
      const r = per.get(id)!;
      return { userId: id, name: names.get(id) ?? null, ...r, load: (ids.length > 1 && r.points >= avg * 1.5 && r.open >= 4 ? "over" : r.points <= avg * 0.6 ? "light" : "balanced") as WorkloadRow["load"] };
    })
    .sort((a, b) => b.points - a.points);
  const projectIds = [...new Set(tasks.map((t) => t.projectId).filter((v): v is string => !!v))];
  const members = projectIds.length ? await db().projectMember.findMany({ where: { companyId, projectId: { in: projectIds } }, select: { projectId: true, userId: true } }) : [];
  const load = new Map(rows.map((r) => [r.userId, r.points]));
  const rank = { LOW: 0, MEDIUM: 1, HIGH: 2, URGENT: 3 } as const;
  const suggestions: ReassignSuggestion[] = [];
  for (const over of rows.filter((r) => r.load === "over")) {
    const movable = tasks
      .filter((t) => t.assigneeId === over.userId && t.projectId && (t.status === "TODO" || t.status === "BACKLOG"))
      .sort((a, b) => rank[a.priority] - rank[b.priority])
      .slice(0, 5);
    for (const t of movable) {
      if ((load.get(over.userId) ?? 0) <= avg * 1.2) break;
      const candidates = members.filter((m) => m.projectId === t.projectId && m.userId !== over.userId).map((m) => m.userId);
      const target = candidates.sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0))[0];
      if (!target || (load.get(target) ?? 0) + (t.estimatePoints ?? 1) >= (load.get(over.userId) ?? 0)) continue;
      const pts = t.estimatePoints ?? 1;
      load.set(over.userId, (load.get(over.userId) ?? 0) - pts);
      load.set(target, (load.get(target) ?? 0) + pts);
      suggestions.push({ taskId: t.id, title: t.title, projectId: t.projectId, projectName: t.project?.name ?? null, fromId: over.userId, fromName: over.name, toId: target, toName: names.get(target) ?? null, dueDate: dayString(t.dueDate) });
    }
  }
  if (suggestions.length) {
    const missing = suggestions.filter((s) => !s.toName).map((s) => s.toId);
    if (missing.length) {
      const more = await userNames(db(), missing);
      for (const s of suggestions) s.toName ??= more.get(s.toId) ?? null;
    }
  }
  return { rows, averagePoints: Math.round(avg * 10) / 10, suggestions: suggestions.slice(0, 12) };
}

/** Plain-text (Markdown) status report of one project from its real tasks, milestones and risks — for export. */
export async function projectReport(ctx: RequestContext, organizationId: string, companyId: string, projectId: string) {
  await authorizeProject(ctx, organizationId, companyId, projectId, "projects.read");
  const now = today();
  const p = await db().project.findFirst({
    where: { id: projectId, organizationId, companyId },
    select: { id: true, name: true, status: true, health: true, startDate: true, dueDate: true, ownerId: true, description: true },
  });
  if (!p) return null;
  const [tasks, milestones, risks, risksAhead] = await Promise.all([
    db().workTask.findMany({ where: { projectId, companyId, archivedAt: null }, select: { title: true, status: true, dueDate: true, assigneeId: true, completedAt: true }, take: 5000 }),
    db().projectMilestone.findMany({ where: { projectId, companyId }, orderBy: { dueDate: { sort: "asc", nulls: "last" } }, select: { title: true, dueDate: true, completedAt: true } }),
    db().projectRisk.findMany({ where: { projectId, companyId, status: { in: ["OPEN", "MITIGATING"] } }, select: { title: true, probability: true, impact: true, status: true }, take: 50 }),
    risksFor(organizationId, companyId, [projectId]),
  ]);
  const names = await userNames(db(), [p.ownerId, ...tasks.map((t) => t.assigneeId)]);
  const count = (s: string) => tasks.filter((t) => t.status === s).length;
  const live = tasks.filter((t) => t.status !== "CANCELLED");
  const doneN = count("DONE");
  const overdue = tasks.filter((t) => (OPEN as readonly string[]).includes(t.status) && t.dueDate && t.dueDate < now);
  const doneWeek = tasks.filter((t) => t.completedAt && t.completedAt >= addDays(now, -7));
  const lines = [
    `# ${p.name} — status report`,
    `Generated ${dayString(now)} from the project's tasks, milestones and risks.`,
    "",
    `- Status: ${p.status} · Health: ${p.health}`,
    `- Owner: ${p.ownerId ? (names.get(p.ownerId) ?? "—") : "—"}`,
    `- Dates: ${dayString(p.startDate) ?? "—"} → ${dayString(p.dueDate) ?? "—"}`,
    `- Progress: ${doneN} of ${live.length} tasks done (${live.length ? Math.round((doneN / live.length) * 100) : 0}%)`,
    `- Tasks: ${count("BACKLOG")} backlog, ${count("TODO")} to do, ${count("IN_PROGRESS")} in progress, ${count("IN_REVIEW")} in review`,
    `- Completed in the last 7 days: ${doneWeek.length}`,
    "",
    "## Milestones",
    ...(milestones.length ? milestones.map((m) => `- [${m.completedAt ? "x" : " "}] ${m.title}${m.dueDate ? ` (due ${dayString(m.dueDate)})` : ""}${!m.completedAt && m.dueDate && m.dueDate < now ? " — LATE" : ""}`) : ["- none"]),
    "",
    "## Overdue work",
    ...(overdue.length ? overdue.slice(0, 50).map((t) => `- ${t.title} — due ${dayString(t.dueDate)}, ${t.assigneeId ? (names.get(t.assigneeId) ?? "assigned") : "unassigned"}`) : ["- none"]),
    "",
    "## Deadline risks",
    ...(risksAhead.length ? risksAhead.map((r) => `- [${r.severity}] ${r.kind.replace(/_/g, " ")}: ${r.count}${r.label ? ` — ${r.label}` : ""}${r.date ? ` (${r.date})` : ""}${r.weeks != null ? `, ~${r.weeks} weeks of work left at the recent pace` : ""}`) : ["- none detected"]),
    "",
    "## Open risks",
    ...(risks.length ? risks.map((r) => `- ${r.title} (probability ${r.probability}/5, impact ${r.impact}/5, ${r.status})`) : ["- none"]),
    "",
  ];
  return { name: p.name, markdown: lines.join("\n") };
}

// ───────────── Jobs ─────────────

const weekStart = (d: Date) => addDays(today(d), -((today(d).getUTCDay() + 6) % 7));

/** Mondays: the hired AI project manager writes a status report for each live project (once per project per week). */
export async function runWeeklyProjectReports(now = new Date()) {
  if (now.getUTCDay() !== 1) return 0;
  const since = weekStart(now);
  let queued = 0;
  for (const m of await departmentManagers(["ai_project_manager", "delivery_analyst"])) {
    const projects = await db().project.findMany({ where: { organizationId: m.organizationId, companyId: m.companyId, status: "ACTIVE", archivedAt: null }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" }, take: 20 });
    for (const p of projects) {
      const id = await runManagerTask(m, "work", {
        title: `Weekly status report: ${p.name}`,
        subject: { type: "project", id: p.id },
        since,
        instructions: `Write this week's status report for the project. Read it with read_project first (and read_team_workload for who is overloaded). Cover: overall status and health, progress since last week (tasks done vs open), milestones (done, upcoming, at risk), overdue work and who owns it, open risks, and the 3–5 most important next steps with owners. Flag deadline risks plainly. Use only the data returned; do not invent facts. Do not change records unless a new risk clearly needs registering (create_risk, approved by a person).\n\nProject id: ${p.id}\nProject name: ${p.name}\nToday: ${dayString(today(now))}`,
      });
      if (id) queued++;
    }
  }
  return queued;
}

/** Daily: notify each project owner once a day about high-severity deadline risks in their projects. */
export async function runDeadlineRiskAlerts(now = new Date()) {
  const start = today(now);
  const companies = await db().project.findMany({ where: { ...LIVE_PROJECTS, ownerId: { not: null } }, distinct: ["companyId"], select: { organizationId: true, companyId: true }, take: 2000 });
  let sent = 0;
  for (const c of companies) {
    try {
      const risks = (await risksFor(c.organizationId, c.companyId)).filter((r) => r.severity === "high" && r.ownerId);
      const byProject = new Map<string, DeadlineRisk>();
      for (const r of risks) if (!byProject.has(r.projectId)) byProject.set(r.projectId, r);
      for (const r of byProject.values()) {
        const href = `/projects/${r.projectId}`;
        const already = await db().notification.findFirst({ where: { organizationId: c.organizationId, userId: r.ownerId!, type: "work.deadlineRisk", createdAt: { gte: start }, payload: { path: ["href"], equals: href } }, select: { id: true } });
        if (already) continue;
        await transaction((tx) => notifyUsers(tx, c.organizationId, [r.ownerId], "work.deadlineRisk", { companyId: c.companyId, title: r.projectName, href }));
        sent++;
      }
    } catch (err) {
      logger.warn({ err, companyId: c.companyId }, "deadline risk alerts failed");
    }
  }
  return sent;
}
