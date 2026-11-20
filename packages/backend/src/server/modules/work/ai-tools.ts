import { z } from "zod";
import { db } from "@/server/core/db";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { createRisk, getWorkProject, listWorkProjects, parseProjectFilters } from "./projects";
import { getSprint, projectAgile } from "./agile";
import { createWorkTask, myTasks, PRIORITIES, TASK_STATUSES, updateWorkTask, workload } from "./tasks";
import { PRODUCT_TOOLS } from "./product-ai-tools";

/** AI tools of the work module, registered in src/server/modules/tools/modules.ts. */

const dayRe = /^\d{4}-\d{2}-\d{2}$/;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");
const uuid = z.string().uuid();
const empty = { type: "object", properties: {}, required: [], additionalProperties: false };

type TaskLine = { id: string; title: string; status: string; priority: string; dueDate: Date | null; estimatePoints: number | null; assignee: { name: string } | null };
const taskLine = (t: TaskLine) =>
  `- Task ${t.id} [${t.status}] [${t.priority}] ${t.title} — ${t.assignee?.name ?? "unassigned"}, due ${day(t.dueDate)}${t.estimatePoints != null ? `, ${t.estimatePoints} pts` : ""}`;

export const WORK_TOOLS: Record<string, ToolDefinition> = {
  read_projects: def({
    name: "read_projects",
    version: 1,
    description: "Lists the company's active (non-archived) projects with status, health, owner, due date, progress, overdue tasks and open risks. Use the ids with read_project.",
    input: z.object({}).strict(),
    modelSchema: empty,
    permissions: ["projects.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "List projects",
    async execute(_i, { ctx, organizationId, companyId }) {
      const { data } = await listWorkProjects(ctx, organizationId, companyId, parseProjectFilters({}));
      if (!data.length) return { content: "The company has no projects.", count: 0 };
      const content = data
        .map((p) => `- Project ${p.id} "${p.name}" [${p.status}/${p.health}] owner ${p.owner?.name ?? "none"}, due ${day(p.dueDate)}, ${p.tasksDone}/${p.tasksTotal} tasks done, ${p.overdue} overdue, ${p.openRisks} open risks`)
        .join("\n");
      return { content, count: data.length, records: data.map((p) => `project:${p.id}`) };
    },
  }),

  read_project: def({
    name: "read_project",
    version: 1,
    description: "Reads one project: details, budget, members, milestones, deliverables, risks, the active sprint and open tasks (up to 150) with assignees, dates and dependencies.",
    input: z.object({ projectId: uuid }).strict(),
    modelSchema: { type: "object", properties: { projectId: { type: "string", description: "Project id" } }, required: ["projectId"], additionalProperties: false },
    permissions: ["projects.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: () => "Read a project",
    async execute({ projectId }, { ctx, organizationId, companyId }) {
      const p = await getWorkProject(ctx, organizationId, companyId, projectId);
      const [tasks, deps, agile, deliverables] = await Promise.all([
        db().workTask.findMany({
          where: { projectId, companyId, archivedAt: null, status: { notIn: ["DONE", "CANCELLED"] } },
          orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
          take: 150,
          select: { id: true, title: true, status: true, priority: true, dueDate: true, estimatePoints: true, assignee: { select: { name: true } } },
        }),
        db().workTaskDependency.findMany({ where: { companyId, task: { projectId } }, select: { taskId: true, dependsOnId: true }, take: 500 }),
        projectAgile(ctx, organizationId, companyId, projectId),
        db().workProjectDeliverable.findMany({ where: { projectId, companyId }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }], take: 100, select: { title: true, status: true, dueDate: true, ownerId: true } }),
      ]);
      const active = agile.sprints.find((s) => s.status === "ACTIVE");
      const money = (m: bigint | null) => (m == null ? "—" : `${(Number(m) / 100).toFixed(2)} ${p.currency ?? ""}`);
      const lines = [
        `Project ${p.id} "${p.name}" [${p.status}] health ${p.health} (data suggests ${p.suggestedHealth})`,
        p.description ? `Description: ${p.description}` : null,
        `Owner: ${p.owner?.name ?? "none"}; start ${day(p.startDate)}, due ${day(p.dueDate)}`,
        `Progress: ${p.stats.done}/${p.stats.total} tasks done, ${p.stats.inProgress} in progress, ${p.stats.overdueTasks} overdue`,
        `Budget: ${money(p.budget.budgetMinor)}; spent ${money(p.budget.spentMinor)} (time ${money(p.budget.timeCostMinor)}, expenses ${money(p.budget.expenseMinor)}); ${Math.round(p.budget.minutes / 60)} h logged`,
        `Members: ${p.members.map((m) => `${m.user.name} (${m.userId}${m.role ? `, ${m.role}` : ""})`).join("; ") || "none"}`,
        `Milestones:\n${p.projectMilestones.map((m) => `- ${m.title} due ${day(m.dueDate)} ${m.completedAt ? "[done]" : `[${m.tasksDone}/${m.tasksTotal} tasks]`}`).join("\n") || "(none)"}`,
        `Deliverables:\n${deliverables.map((d) => `- [${d.status}] ${d.title} due ${day(d.dueDate)}${d.ownerId ? ` owner ${d.ownerId}` : " (no owner)"}`).join("\n") || "(none)"}`,
        `Risks:\n${p.risks.map((r) => `- [${r.status}] ${r.title} P${r.probability}×I${r.impact}=${r.exposure}${r.mitigation ? `; mitigation: ${r.mitigation}` : ""}${r.ownerName ? `; owner ${r.ownerName}` : ""}`).join("\n") || "(none)"}`,
        active ? `Active sprint ${active.id} "${active.name}" ${day(active.startDate)}–${day(active.endDate)}: ${active.donePoints}/${active.points} pts${active.goal ? `; goal: ${active.goal}` : ""}` : "No active sprint.",
        agile.avgVelocity != null ? `Average velocity: ${agile.avgVelocity} pts/sprint` : null,
        `Open tasks (${tasks.length}):\n${tasks.map(taskLine).join("\n") || "(none)"}`,
        deps.length ? `Dependencies (task waits for):\n${deps.map((d) => `- ${d.taskId} after ${d.dependsOnId}`).join("\n")}` : null,
      ];
      return { content: lines.filter(Boolean).join("\n"), count: tasks.length, records: [`project:${projectId}`] };
    },
  }),

  read_sprint: def({
    name: "read_sprint",
    version: 1,
    description: "Reads a sprint: goal, dates, capacity, committed and completed points, burndown (remaining vs ideal per day), tasks and retrospective notes.",
    input: z.object({ sprintId: uuid }).strict(),
    modelSchema: { type: "object", properties: { sprintId: { type: "string" } }, required: ["sprintId"], additionalProperties: false },
    permissions: ["projects.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read a sprint",
    async execute({ sprintId }, { ctx, organizationId, companyId }) {
      const s = await getSprint(ctx, organizationId, companyId, sprintId);
      const lines = [
        `Sprint ${s.id} "${s.name}" [${s.status}] ${day(s.startDate)}–${day(s.endDate)}, project ${s.project.name} (${s.project.id})`,
        s.goal ? `Goal: ${s.goal}` : "No goal set.",
        `Capacity ${s.capacityPoints ?? "—"} pts; committed ${s.committedPoints ?? "—"}; scope now ${s.totals.points}; done ${s.totals.donePoints} pts (${s.totals.done}/${s.totals.tasks} tasks)`,
        `Burndown (date: remaining / ideal):\n${s.burndown.series.map((b) => `${b.date}: ${b.remaining ?? "—"} / ${b.ideal}`).join("\n")}`,
        `Tasks:\n${s.tasks.map(taskLine).join("\n") || "(none)"}`,
        s.retro.length ? `Retrospective:\n${s.retro.map((r) => `- ${r.kind}: ${r.text}`).join("\n")}` : null,
      ];
      return { content: lines.filter(Boolean).join("\n"), count: s.tasks.length, records: [`sprint:${sprintId}`] };
    },
  }),

  read_my_workload: def({
    name: "read_my_workload",
    version: 1,
    description: "Lists the open tasks assigned to the person this task works for, grouped into overdue, today, this week and later.",
    input: z.object({}).strict(),
    modelSchema: empty,
    permissions: ["projects.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read my workload",
    async execute(_i, { ctx, organizationId, companyId }) {
      const m = await myTasks(ctx, organizationId, companyId);
      const section = (name: string, rows: TaskLine[]) => `${name} (${rows.length}):\n${rows.map(taskLine).join("\n") || "(none)"}`;
      const n = m.overdue.length + m.today.length + m.week.length + m.later.length;
      return { content: [section("Overdue", m.overdue), section("Due today", m.today), section("This week", m.week), section("Later / no date", m.later)].join("\n\n"), count: n };
    },
  }),

  read_team_workload: def({
    name: "read_team_workload",
    version: 1,
    description: "Open work per person (open tasks, story points, overdue) across the company or for one project, plus project members without open work (with user ids).",
    input: z.object({ projectId: uuid.optional() }).strict(),
    modelSchema: { type: "object", properties: { projectId: { type: "string", description: "Optional project id" } }, required: [], additionalProperties: false },
    permissions: ["projects.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read team workload",
    async execute({ projectId }, { ctx, organizationId, companyId }) {
      const rows = await workload(ctx, organizationId, companyId, { projectId });
      const members = projectId ? await db().projectMember.findMany({ where: { projectId, companyId }, select: { userId: true, role: true, user: { select: { name: true } } } }) : [];
      const lines = rows.map((r) => `- ${r.name} (${r.userId}): ${r.open} open tasks, ${r.points} pts, ${r.overdue} overdue`);
      const free = members.filter((m) => !rows.some((r) => r.userId === m.userId)).map((m) => `- ${m.user.name} (${m.userId})${m.role ? `, ${m.role}` : ""}: no open tasks`);
      return { content: [...lines, ...free].join("\n") || "Nobody has open tasks.", count: rows.length + free.length };
    },
  }),

  create_work_task: def({
    name: "create_work_task",
    version: 1,
    description: "Propose creating a task (optionally in a project, assigned, with dates and an estimate). A human must approve it.",
    input: z
      .object({
        projectId: uuid.optional(),
        title: z.string().trim().min(1).max(300),
        description: z.string().trim().max(5000).optional(),
        priority: z.enum(PRIORITIES).optional(),
        assigneeId: uuid.optional(),
        startDate: z.string().regex(dayRe).optional(),
        dueDate: z.string().regex(dayRe).optional(),
        estimatePoints: z.number().int().min(0).max(100).optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: [...PRIORITIES] },
        assigneeId: { type: "string", description: "User id from read_team_workload or read_project" },
        startDate: { type: "string", description: "YYYY-MM-DD" },
        dueDate: { type: "string", description: "YYYY-MM-DD" },
        estimatePoints: { type: "integer" },
      },
      required: ["title"],
      additionalProperties: false,
    },
    permissions: ["projects.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ title, dueDate }) => `Create task "${title}"${dueDate ? ` due ${dueDate}` : ""}`,
    async execute(input, { ctx, organizationId, companyId }) {
      const t = await createWorkTask(ctx, organizationId, companyId, { ...input, labels: [] });
      return { content: `Created task ${t.id} "${t.title}".`, records: [`work_task:${t.id}`] };
    },
  }),

  update_task_status: def({
    name: "update_task_status",
    version: 1,
    description: "Propose changing a task's status (BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, DONE, CANCELLED). A human must approve it.",
    input: z.object({ taskId: uuid, status: z.enum(TASK_STATUSES) }).strict(),
    modelSchema: { type: "object", properties: { taskId: { type: "string" }, status: { type: "string", enum: [...TASK_STATUSES] } }, required: ["taskId", "status"], additionalProperties: false },
    permissions: ["projects.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ status }) => `Set a task's status to ${status}`,
    async execute({ taskId, status }, { ctx, organizationId, companyId }) {
      const t = await updateWorkTask(ctx, organizationId, companyId, taskId, { status });
      return { content: `Task "${t.title}" is now ${t.status}.`, records: [`work_task:${t.id}`] };
    },
  }),

  assign_task: def({
    name: "assign_task",
    version: 1,
    description: "Propose assigning a task to a person (or unassigning with an empty assigneeId). The assignee is notified. A human must approve it.",
    input: z.object({ taskId: uuid, assigneeId: uuid.or(z.literal("")) }).strict(),
    modelSchema: {
      type: "object",
      properties: { taskId: { type: "string" }, assigneeId: { type: "string", description: "User id, or an empty string to unassign" } },
      required: ["taskId", "assigneeId"],
      additionalProperties: false,
    },
    permissions: ["projects.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ assigneeId }) => (assigneeId ? "Assign a task" : "Unassign a task"),
    async execute({ taskId, assigneeId }, { ctx, organizationId, companyId }) {
      const t = await updateWorkTask(ctx, organizationId, companyId, taskId, { assigneeId: assigneeId || null });
      return { content: assigneeId ? `Assigned "${t.title}".` : `Unassigned "${t.title}".`, records: [`work_task:${t.id}`] };
    },
  }),

  create_risk: def({
    name: "create_risk",
    version: 1,
    description: "Propose adding a risk to a project's risk register (probability and impact 1–5, mitigation, optional owner). A human must approve it.",
    input: z
      .object({
        projectId: uuid,
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(4000).optional(),
        probability: z.number().int().min(1).max(5),
        impact: z.number().int().min(1).max(5),
        mitigation: z.string().trim().max(4000).optional(),
        ownerId: uuid.optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        probability: { type: "integer", description: "1 (rare) to 5 (almost certain)" },
        impact: { type: "integer", description: "1 (minor) to 5 (severe)" },
        mitigation: { type: "string" },
        ownerId: { type: "string" },
      },
      required: ["projectId", "title", "probability", "impact"],
      additionalProperties: false,
    },
    permissions: ["projects.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ title, probability, impact }) => `Add risk "${title}" (P${probability}×I${impact})`,
    async execute(input, { ctx, organizationId, companyId }) {
      const r = await createRisk(ctx, organizationId, companyId, input.projectId, { ...input, status: "OPEN" });
      return { content: `Added risk "${r.title}" to the register.`, records: [`project_risk:${r.id}`] };
    },
  }),
  ...PRODUCT_TOOLS,
};
