import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask as createAgentTask } from "@/server/modules/agents/service";
import { applyBlueprint, createWorkProject } from "./projects";
import { actorId, addDays, authorize, authorizeProject, day, dayString, isUuid, today, toDay, uuid } from "./shared";
import { updateWorkTask } from "./tasks";
import { blueprintSchema } from "./templates";
import { parsePlan, planTask } from "./kickoff-plan";

export { parsePlan, planSchema, type ProjectPlan } from "./kickoff-plan";

/**
 * Guided project start (/projects/start): the person describes the work in plain words → the AI project manager proposes
 * a plan (milestones + tasks, as JSON) → the person reviews/ticks it → the project is created through the work services
 * (createWorkProject + applyBlueprint) → people are assigned (updateWorkTask) → timeline.
 */
export const kickoffInput = z.object({
  description: z.string().trim().min(10).max(4000),
  startDate: day.optional().or(z.literal("").transform(() => undefined)),
  dueDate: day.optional().or(z.literal("").transform(() => undefined)),
});
export const replanInput = z.object({ feedback: z.string().trim().max(1500).optional() });

export const applyInput = z.object({
  name: z.string().trim().min(1).max(120),
  milestones: z.array(z.object({ title: z.string().trim().min(1).max(200), offsetDays: z.number().int().min(0).max(3650) })).max(30),
  tasks: z.array(planTask).min(1).max(80),
  memberIds: z.array(uuid).max(50).default([]),
});
export const assignInput = z.object({ assignments: z.array(z.object({ taskId: uuid, assigneeId: uuid.or(z.literal("")) })).max(200), finish: z.boolean().default(true) });

function planInstructions(description: string, start: string, due: string | null, feedback?: string, previous?: string | null) {
  return [
    "A person who is not a project-management expert described what they are working on. Propose a practical project plan.",
    "You may call read_team_workload and read_projects for context. Do NOT call create_work_task, assign_task, update_task_status or create_risk: this plan is reviewed by the person first and created by them.",
    "Reply with ONE JSON object in a ```json code block and nothing else, shaped exactly like:",
    '{"name": "short project name", "summary": "one or two plain sentences", "milestones": [{"title": "...", "offsetDays": 14}], "tasks": [{"title": "...", "description": "...", "priority": "LOW|MEDIUM|HIGH|URGENT", "offsetDays": 0, "durationDays": 3, "points": 2, "milestone": "exact milestone title"}]}',
    `offsetDays count from the project start (${start}).${due ? ` Everything must finish by ${due}.` : ""} Use 3–6 milestones and 8–25 concrete tasks with clear, plain titles, in a sensible order.`,
    `\nWhat they are working on:\n${description}`,
    feedback ? `\nThey reviewed your previous plan and asked: ${feedback}` : "",
    previous ? `\nPrevious plan (improve it):\n${previous.slice(0, 3000)}` : "",
  ].join("\n");
}

async function requireKickoff(organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Kickoff");
  const k = await db().workProjectKickoff.findFirst({ where: { id, organizationId, companyId } });
  if (!k) throw notFound("Kickoff");
  return k;
}

export async function startKickoff(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof kickoffInput>) {
  const input = kickoffInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "projects.manage");
  const start = input.startDate ?? dayString(today())!;
  const k = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const row = await tx.workProjectKickoff.create({
      data: { organizationId, companyId, description: input.description, startDate: toDay(start), dueDate: toDay(input.dueDate), step: "plan", createdById: actorId(ctx, organizationId) },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "work.kickoff.started", resourceType: "work_project_kickoff", resourceId: row.id });
    return row;
  });
  try {
    const task = await createAgentTask(ctx, organizationId, companyId, {
      profile: "ai_project_manager",
      title: `Project plan: ${input.description.slice(0, 120)}`,
      instructions: planInstructions(input.description, start, input.dueDate ?? null).slice(0, 8000),
      subject: { type: "work_kickoff", id: k.id },
    });
    await db().workProjectKickoff.update({ where: { id: k.id }, data: { agentTaskId: task.id } });
    return { id: k.id, taskId: task.id };
  } catch (err) {
    // Without a plan task the kickoff is useless; don't leave an orphan behind.
    await db().workProjectKickoff.delete({ where: { id: k.id } }).catch(() => undefined);
    throw err;
  }
}

/** Ask the AI project manager for a new version of the plan (optionally with the person's feedback). */
export async function replanKickoff(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof replanInput>) {
  const { feedback } = replanInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "projects.manage");
  const k = await requireKickoff(organizationId, companyId, id);
  if (k.projectId) throw invalid("The project was already created", { reason: "work_kickoff_applied" });
  const prev = k.agentTaskId ? await db().agentTask.findFirst({ where: { id: k.agentTaskId, companyId }, select: { output: true } }) : null;
  const task = await createAgentTask(ctx, organizationId, companyId, {
    profile: "ai_project_manager",
    title: `Project plan (revised): ${k.description.slice(0, 100)}`,
    instructions: planInstructions(k.description, dayString(k.startDate ?? today())!, dayString(k.dueDate), feedback, prev?.output).slice(0, 8000),
    subject: { type: "work_kickoff", id: k.id },
  });
  await db().workProjectKickoff.update({ where: { id: k.id }, data: { agentTaskId: task.id, step: "plan" } });
  return { id: k.id, taskId: task.id };
}

export async function getKickoff(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const k = await requireKickoff(organizationId, companyId, id);
  const task = k.agentTaskId
    ? await db().agentTask.findFirst({ where: { id: k.agentTaskId, organizationId, companyId }, select: { id: true, title: true, status: true, output: true, errorMessage: true } })
    : null;
  return { kickoff: k, task, plan: task?.status === "COMPLETED" ? parsePlan(task.output) : null };
}

/** The viewer's unfinished guided starts (resume list). */
export async function listKickoffs(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "projects.manage");
  return db().workProjectKickoff.findMany({ where: { organizationId, companyId, createdById: ctx.actor.id ?? organizationId, step: { not: "done" } }, orderBy: { updatedAt: "desc" }, take: 10 });
}

/** Create the project from the reviewed plan (only the ticked items are sent). */
export async function applyKickoff(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof applyInput>) {
  const input = applyInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "projects.manage");
  const k = await requireKickoff(organizationId, companyId, id);
  if (k.projectId) throw invalid("The project was already created", { reason: "work_kickoff_applied" });
  const titles = new Set(input.milestones.map((m) => m.title));
  const blueprint = blueprintSchema.parse({
    milestones: input.milestones,
    tasks: input.tasks.map((t) => ({ ...t, labels: [], milestone: t.milestone && titles.has(t.milestone) ? t.milestone : undefined })),
  });
  const start = k.startDate ?? today();
  const lastDay = blueprint.tasks.reduce((m, t) => Math.max(m, t.offsetDays + t.durationDays), 0);
  const project = await createWorkProject(ctx, organizationId, companyId, {
    name: input.name,
    description: k.description,
    status: "ACTIVE",
    startDate: dayString(start),
    dueDate: dayString(k.dueDate ?? addDays(start, Math.max(lastDay, ...blueprint.milestones.map((m) => m.offsetDays)))),
    memberIds: input.memberIds,
  });
  return transaction(async (tx) => {
    await authorizeProject(ctx, organizationId, companyId, project.id, "projects.manage", tx);
    const applied = await applyBlueprint(tx, ctx, organizationId, companyId, project.id, blueprint, start);
    await tx.workProjectKickoff.update({ where: { id: k.id }, data: { projectId: project.id, step: "assign" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "work.kickoff.applied", resourceType: "project", resourceId: project.id, newValue: applied });
    return { projectId: project.id, ...applied };
  });
}

/** Assign people to the new project's tasks (each change goes through updateWorkTask: eligibility, audit, notify). */
export async function assignKickoff(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof assignInput>) {
  const input = assignInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "projects.manage");
  const k = await requireKickoff(organizationId, companyId, id);
  if (!k.projectId) throw invalid("Create the project first", { reason: "work_kickoff_not_applied" });
  const tasks = await db().workTask.findMany({ where: { organizationId, companyId, projectId: k.projectId, id: { in: input.assignments.map((a) => a.taskId) } }, select: { id: true, assigneeId: true } });
  let changed = 0;
  for (const a of input.assignments) {
    const t = tasks.find((x) => x.id === a.taskId);
    if (!t || (t.assigneeId ?? "") === a.assigneeId) continue;
    await updateWorkTask(ctx, organizationId, companyId, a.taskId, { assigneeId: a.assigneeId || null });
    changed++;
  }
  if (input.finish) await db().workProjectKickoff.update({ where: { id: k.id }, data: { step: "done" } });
  return { changed, projectId: k.projectId };
}

// ─── Insights for the visual identity (real data only) ──────────────────────────────────────────────────────────────

const OPEN = { notIn: ["DONE", "CANCELLED"] } as { notIn: ("DONE" | "CANCELLED")[] };

/** Workload heatmap: open assigned tasks per person, bucketed by due week (late, next 6 weeks). */
export async function workloadHeatmap(ctx: RequestContext, organizationId: string, companyId: string, opts: { projectId?: string } = {}) {
  if (opts.projectId) await authorizeProject(ctx, organizationId, companyId, opts.projectId, "projects.read");
  else await authorize(ctx, organizationId, companyId, "projects.read");
  const now = today();
  const horizon = addDays(now, 42);
  const rows = await db().workTask.findMany({
    where: { organizationId, companyId, archivedAt: null, status: OPEN, assigneeId: { not: null }, dueDate: { not: null, lt: horizon }, ...(opts.projectId ? { projectId: opts.projectId } : {}) },
    select: { assigneeId: true, dueDate: true },
    take: 5000,
  });
  const people = new Map<string, number[]>();
  for (const r of rows) {
    const idx = r.dueDate! < now ? 0 : 1 + Math.min(5, Math.floor((r.dueDate!.getTime() - now.getTime()) / (7 * 86_400_000)));
    const arr = people.get(r.assigneeId!) ?? [0, 0, 0, 0, 0, 0, 0];
    arr[idx]!++;
    people.set(r.assigneeId!, arr);
  }
  const users = await db().user.findMany({ where: { id: { in: [...people.keys()] } }, select: { id: true, name: true } });
  return {
    weeks: Array.from({ length: 6 }, (_, i) => addDays(now, i * 7)),
    rows: users.map((u) => ({ userId: u.id, name: u.name, cells: people.get(u.id)! })).sort((a, b) => b.cells.reduce((x, y) => x + y, 0) - a.cells.reduce((x, y) => x + y, 0)).slice(0, 15),
  };
}

/** Delay detection: for each project, how many open tasks are late and by how many days the latest one slipped. */
export async function projectDelays(ctx: RequestContext, organizationId: string, companyId: string, projectIds: string[]) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  if (!projectIds.length) return new Map<string, { late: number; maxDays: number }>();
  const now = today();
  const rows = await db().workTask.groupBy({
    by: ["projectId"],
    where: { organizationId, companyId, archivedAt: null, status: OPEN, projectId: { in: projectIds }, dueDate: { lt: now } },
    _count: { _all: true },
    _min: { dueDate: true },
  });
  return new Map(rows.map((r) => [r.projectId!, { late: r._count._all, maxDays: r._min.dueDate ? Math.round((now.getTime() - r._min.dueDate.getTime()) / 86_400_000) : 0 }]));
}
