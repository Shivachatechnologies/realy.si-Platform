import { z } from "zod";
import { db } from "@/server/core/db";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { createRisk, getWorkProject, listWorkProjects, parseProjectFilters } from "./projects";
import { getSprint, projectAgile } from "./agile";
import { createWorkTask, myTasks, PRIORITIES, TASK_STATUSES, updateWorkTask, workload } from "./tasks";
import { PRODUCT_TOOLS } from "./product-ai-tools";
import { deadlineRisks, workloadBalance } from "./delivery";
import { detectBottlenecks } from "./bottlenecks";
import { addProcessVersion, getProcess } from "./operations";
import { executeObjective, executeObjectiveInput, executionStatus, objectiveExecutionStatus, type ExecutionStatus } from "./execution";

/** AI tools of the work module, registered in src/server/modules/tools/modules.ts. */

const blockerReason = { overdue: "overdue", unassigned: "no owner", stalled: "no progress for 7+ days", not_started: "should have started" } as const;
function executionText(s: ExecutionStatus) {
  const t = s.totals;
  const lines = [
    `Project ${s.project.id} "${s.project.name}" [${s.project.status}] — computed health ${s.health} (set by people: ${s.manualHealth}). ${t.done}/${t.total} tasks done (${t.progress}%), ${t.open} open: ${t.ready} ready to start, ${t.blocked} blocked, ${t.overdue} overdue, ${t.stalled} stalled. ${t.dependencies} dependencies.`,
    s.complete ? "All tasks are done." : `Remaining critical path ${s.criticalDays} day(s): projected finish ${day(s.projectedFinish)}${s.project.dueDate ? ` vs due ${day(s.project.dueDate)}${s.projectedLate ? " — LATE" : ""}` : ""}.`,
    s.objectives.length ? `Objectives: ${s.objectives.map((o) => `"${o.objectiveTitle}" (${o.objectiveId}, milestone ${o.completedAt ? "done" : "open"})`).join("; ")}.` : "Not linked to an objective.",
    s.milestones.length ? `Milestones:\n${s.milestones.map((m) => `- ${m.title}: ${m.done}/${m.total} done${m.dueDate ? `, due ${day(m.dueDate)}` : ""}${m.completedAt ? " (completed)" : m.late ? " — LATE" : ""}`).join("\n")}` : "No milestones.",
    s.criticalBlockers.length ? `Critical blockers (holding up other work):\n${s.criticalBlockers.map((b) => `- Task ${b.id} "${b.title}" [${b.status}] blocks ${b.waiting} task(s): ${b.reasons.map((r) => blockerReason[r]).join(", ")}${b.externalProjectId ? ` (in another project ${b.externalProjectId})` : ""}`).join("\n")}` : "No critical blockers.",
    s.ready.length ? `Ready to start:\n${s.ready.slice(0, 15).map((x) => `- Task ${x.id} "${x.title}" [${x.priority}]${x.assigneeId ? "" : " — unassigned"}${x.dueDate ? `, due ${day(x.dueDate)}` : ""}`).join("\n")}` : "Nothing is ready to start.",
    s.stalled.length ? `Stalled:\n${s.stalled.slice(0, 10).map((x) => `- Task ${x.id} "${x.title}" [${x.status}]`).join("\n")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

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
  read_deadline_risks: def({
    name: "read_deadline_risks",
    version: 1,
    description: "Deadline risks across live projects from real tasks and milestones: overdue tasks, tasks due within 3 days not started, milestones due soon with open tasks, and projects whose remaining work at the recent pace finishes after the due date (projection).",
    input: z.object({}).strict(),
    modelSchema: empty,
    permissions: ["projects.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: () => "Read deadline risks",
    async execute(_i, { ctx, organizationId, companyId }) {
      const risks = await deadlineRisks(ctx, organizationId, companyId);
      if (!risks.length) return { content: "No deadline risks detected in live projects.", count: 0 };
      const content = risks
        .map((r) => `- [${r.severity}] ${r.projectName} (${r.projectId}): ${r.kind.replace(/_/g, " ")} — ${r.count}${r.label ? `, milestone "${r.label}"` : ""}${r.date ? `, date ${r.date}` : ""}${r.weeks != null ? `, ~${r.weeks} weeks of work at the recent pace` : ""}`)
        .join("\n");
      return { content, count: risks.length, records: [...new Set(risks.map((r) => `project:${r.projectId}`))] };
    },
  }),

  read_workload_balance: def({
    name: "read_workload_balance",
    version: 1,
    description: "Open work per person (tasks, points, overdue) with who is overloaded or light, and concrete reassignment suggestions (not-started tasks to the lightest-loaded member of the same project). Apply a suggestion with assign_task.",
    input: z.object({}).strict(),
    modelSchema: empty,
    permissions: ["projects.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: () => "Read workload balance",
    async execute(_i, { ctx, organizationId, companyId }) {
      const w = await workloadBalance(ctx, organizationId, companyId);
      if (!w.rows.length) return { content: "No open assigned tasks.", count: 0 };
      const people = w.rows.map((r) => `- ${r.name ?? r.userId} (${r.userId}): ${r.open} open, ${r.points} pts, ${r.overdue} overdue — ${r.load}`).join("\n");
      const sugg = w.suggestions.map((s) => `- Move task ${s.taskId} "${s.title}"${s.projectName ? ` (${s.projectName})` : ""} from ${s.fromName ?? s.fromId} to ${s.toName ?? s.toId} (${s.toId})`).join("\n");
      return { content: `Team average ${w.averagePoints} pts.\n${people}\nSuggestions:\n${sugg || "- none"}`, count: w.rows.length };
    },
  }),

  read_ops_bottlenecks: def({
    name: "read_ops_bottlenecks",
    version: 1,
    description: "Operations bottlenecks from real records: checklist runs past due, workflow runs stuck or failing, support tickets waiting too long or past SLA, approvals left pending, slow task cycle times and stalled work in progress — with counts, age and severity.",
    input: z.object({}).strict(),
    modelSchema: empty,
    permissions: ["operations.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 25_000,
    summarize: () => "Read operations bottlenecks",
    async execute(_i, { ctx, organizationId, companyId }) {
      const b = await detectBottlenecks(ctx, organizationId, companyId);
      const head = `Task cycle time (median, last 60 days): ${b.cycle.companyMedianDays ?? "no data"} days.`;
      if (!b.items.length) return { content: `${head}\nNo bottlenecks detected.`, count: 0 };
      return { content: `${head}\n${b.items.map((x) => `- [${x.severity}] ${x.area}/${x.kind}: ${x.summary}`).join("\n")}`, count: b.items.length };
    },
  }),

  read_process: def({
    name: "read_process",
    version: 1,
    description: "Read an operations process (SOP) with its current steps and version history.",
    input: z.object({ processId: uuid }).strict(),
    modelSchema: { type: "object", properties: { processId: { type: "string" } }, required: ["processId"], additionalProperties: false },
    permissions: ["operations.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read a process",
    async execute({ processId }, { ctx, organizationId, companyId }) {
      const p = await getProcess(ctx, organizationId, companyId, processId);
      const steps = p.shown?.steps.map((st, i) => `${i + 1}. ${st.title}${st.detail ? ` — ${st.detail}` : ""}`).join("\n") || "(no steps yet)";
      return {
        content: `Process ${p.id}: ${p.title}${p.category ? ` [${p.category}]` : ""}, owner ${p.ownerName ?? "none"}, version ${p.currentVersion} of ${p.versions.length}.\n${p.description ?? ""}\nSteps:\n${steps}`,
        records: [`ops_process:${p.id}`],
      };
    },
  }),

  propose_process_version: def({
    name: "propose_process_version",
    version: 1,
    description: "Propose saving new steps as the next version of an operations process (SOP). A person must approve it; earlier versions are kept.",
    input: z
      .object({
        processId: uuid,
        steps: z.array(z.object({ title: z.string().trim().min(1).max(300), detail: z.string().trim().max(5000).optional() }).strict()).min(1).max(200),
        changeNote: z.string().trim().max(500).optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        processId: { type: "string" },
        steps: { type: "array", items: { type: "object", properties: { title: { type: "string" }, detail: { type: "string" } }, required: ["title"], additionalProperties: false } },
        changeNote: { type: "string" },
      },
      required: ["processId", "steps"],
      additionalProperties: false,
    },
    permissions: ["operations.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ steps }) => `Save a new process version with ${steps.length} step(s)`,
    async execute({ processId, steps, changeNote }, { ctx, organizationId, companyId }) {
      const r = await addProcessVersion(ctx, organizationId, companyId, processId, { steps, changeNote });
      return { content: `Saved version ${r.version} of the process.`, records: [`ops_process:${processId}`] };
    },
  }),
  plan_objective_execution: def({
    name: "plan_objective_execution",
    version: 1,
    description:
      "Propose turning an active objective into executable work: one project with milestones and tasks, where each task lists the tasks it depends on (finish-to-start, by index in the task list). Tasks are scheduled after their predecessors automatically; the project is linked to the objective so its progress is tracked until every task is done. A person must approve it first.",
    input: executeObjectiveInput.strict(),
    modelSchema: {
      type: "object",
      properties: {
        objectiveId: { type: "string", description: "Objective id (read_objectives)" },
        name: { type: "string", description: "Project name" },
        description: { type: "string" },
        startDate: { type: "string", description: "YYYY-MM-DD (default today)" },
        dueDate: { type: "string", description: "YYYY-MM-DD (default: the objective's target date)" },
        ownerId: { type: "string", description: "User id of the project owner (default: the requester)" },
        milestones: { type: "array", items: { type: "object", properties: { title: { type: "string" }, offsetDays: { type: "integer", description: "Days after the start" } }, required: ["title", "offsetDays"], additionalProperties: false } },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              priority: { type: "string", enum: [...PRIORITIES] },
              offsetDays: { type: "integer", description: "Earliest start, days after the project start" },
              durationDays: { type: "integer" },
              points: { type: "integer" },
              milestone: { type: "string", description: "Exact title of one of the milestones" },
              dependsOn: { type: "array", items: { type: "integer" }, description: "Indexes of tasks in this list that must be done first" },
              assigneeId: { type: "string", description: "User id (read_team_workload)" },
            },
            required: ["title"],
            additionalProperties: false,
          },
        },
      },
      required: ["objectiveId", "name", "tasks"],
      additionalProperties: false,
    },
    permissions: ["projects.manage", "objectives.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 60_000,
    summarize: ({ name, tasks, milestones }) => `Create project "${name}" with ${milestones?.length ?? 0} milestone(s) and ${tasks.length} task(s) for an objective`,
    async execute(input, { ctx, organizationId, companyId }) {
      const r = await executeObjective(ctx, organizationId, companyId, input);
      return {
        content: `Created project ${r.projectId} (${r.startDate} → ${r.dueDate}) with ${r.milestones} milestone(s), ${r.tasks} task(s) and ${r.dependencies} dependencies${r.rescheduled ? `; ${r.rescheduled} task(s) were moved after their predecessors` : ""}. It is linked to objective ${r.objectiveId} and tracked with read_execution_status.`,
        records: [`project:${r.projectId}`, `objective:${r.objectiveId}`, `milestone:${r.objectiveMilestoneId}`],
      };
    },
  }),

  read_execution_status: def({
    name: "read_execution_status",
    version: 1,
    description:
      "Execution tracking of a project or of every project carrying an objective: progress per milestone, tasks ready to start, blocked tasks and the root blockers holding them up (overdue, unassigned, stalled, not started), remaining critical path vs the due date and a computed health.",
    input: z.object({ projectId: uuid.optional(), objectiveId: uuid.optional() }).strict().refine((v) => !!v.projectId !== !!v.objectiveId, { message: "Give either projectId or objectiveId" }),
    modelSchema: { type: "object", properties: { projectId: { type: "string" }, objectiveId: { type: "string" } }, required: [], additionalProperties: false },
    permissions: ["projects.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 30_000,
    actionClass: "read",
    summarize: ({ objectiveId }) => (objectiveId ? "Read an objective's execution status" : "Read a project's execution status"),
    async execute({ projectId, objectiveId }, { ctx, organizationId, companyId }) {
      if (projectId) {
        const s = await executionStatus(ctx, organizationId, companyId, projectId);
        return { content: executionText(s), count: s.totals.total, records: [`project:${projectId}`] };
      }
      const o = await objectiveExecutionStatus(ctx, organizationId, companyId, objectiveId!);
      if (!o.projects.length) return { content: `Objective "${o.objective.title}" has no project carrying it yet${o.hiddenProjects ? ` that you can see (${o.hiddenProjects} hidden)` : ""}. Propose one with plan_objective_execution.`, count: 0 };
      const head = `Objective "${o.objective.title}" [${o.objective.status}]${o.objective.targetDate ? `, target ${day(o.objective.targetDate)}` : ""}: ${o.totals.projects} project(s), ${o.totals.done}/${o.totals.total} tasks done (${o.totals.progress}%), ${o.totals.blocked} blocked, ${o.totals.criticalBlockers} critical blocker(s), overall health ${o.health}${o.complete ? ", all work done" : ""}.`;
      return { content: [head, ...o.projects.map(executionText)].join("\n\n"), count: o.totals.total, records: [`objective:${o.objective.id}`, ...o.projects.map((p) => `project:${p.project.id}`)] };
    },
  }),

  ...PRODUCT_TOOLS,
};
