import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, isAppError, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask, getTask } from "@/server/modules/agents/service";
import { profileByKey } from "@/server/modules/agents/profiles";
import { visibleMetrics } from "@/server/modules/bi/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { createWorkProject } from "@/server/modules/work/projects";
import { createWorkTask, PRIORITIES } from "@/server/modules/work/tasks";
import { eligibleUserIds } from "@/server/modules/work/shared";
import { keyResultInput, validateKeyResult } from "./key-results";
import { authorize, createMilestone, createObjective, eligibleMembers, isUuid } from "./service";

/**
 * AI decomposition of a company goal: an agent task (subject company_goal) returns a strict JSON plan
 * (objectives → key results → milestones → project → tasks); a person reviews and edits it, then applies it, which
 * creates the records through the objectives and work services (each emits its own domain events).
 */

export const PLAN_SUBJECT = "company_goal";
const MAX_INSTRUCTIONS = 8000;

// ───────────── The AI's plan (lenient on nulls, strict on shape) ─────────────

const optStr = (max: number) =>
  z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v.slice(0, max) : undefined));
const offset = z.coerce.number().int().min(0).max(1100).nullish().transform((v) => v ?? undefined);
const upper = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : v);

const aiTask = z.object({
  title: z.string().trim().min(1).max(300),
  description: optStr(2000),
  department: optStr(120),
  role: optStr(120),
  dueInDays: offset,
  priority: z.preprocess(upper, z.enum(PRIORITIES)).catch("MEDIUM").default("MEDIUM"),
});
const aiProject = z.object({
  name: z.string().trim().min(1).max(120),
  description: optStr(5000),
  department: optStr(120),
  role: optStr(120),
  dueInDays: offset,
  tasks: z.array(aiTask).max(30).default([]),
});
const aiKeyResult = z.object({
  title: z.string().trim().min(1).max(200),
  metricKey: optStr(100),
  baseline: z.coerce.number().finite().nullish().transform((v) => v ?? 0),
  target: z.coerce.number().finite(),
  direction: z.preprocess(upper, z.enum(["INCREASE", "DECREASE"])).catch("INCREASE").default("INCREASE"),
  unit: optStr(30),
});
const aiMilestone = z.object({
  title: z.string().trim().min(1).max(200),
  dueInDays: offset,
  project: aiProject.nullish().transform((v) => v ?? undefined),
});
const aiObjective = z.object({
  title: z.string().trim().min(1).max(200),
  description: optStr(2000),
  department: optStr(120),
  role: optStr(120),
  targetInDays: offset,
  keyResults: z.array(aiKeyResult).max(10).default([]),
  milestones: z.array(aiMilestone).max(12).default([]),
});
export const aiPlanSchema = z.object({ objectives: z.array(aiObjective).min(1).max(10) });
export type AiPlan = z.infer<typeof aiPlanSchema>;

/** The first JSON object in the text: a ```json fenced block if present, else the first balanced {...}. */
export function extractJson(text: string): string | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = fence?.[1]?.includes("{") ? [fence[1], text] : [text];
  for (const src of candidates) {
    const start = src.indexOf("{");
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < src.length; i++) {
      const c = src[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

export type PlanParse = { ok: true; plan: AiPlan } | { ok: false; error: "no_output" | "no_json" | "invalid_json" | "invalid_plan"; issues: string[] };

/** Parse an agent task's output into a plan; failures are reported truthfully (never patched up). */
export function parsePlanOutput(output: string | null | undefined): PlanParse {
  if (!output?.trim()) return { ok: false, error: "no_output", issues: [] };
  const json = extractJson(output);
  if (!json) return { ok: false, error: "no_json", issues: [] };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: "invalid_json", issues: [err instanceof Error ? err.message : String(err)] };
  }
  const r = aiPlanSchema.safeParse(data);
  if (!r.success) return { ok: false, error: "invalid_plan", issues: r.error.issues.slice(0, 12).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  return { ok: true, plan: r.data };
}

// ───────────── Starting the decomposition ─────────────

export const startPlanInput = z.object({ guidance: z.string().trim().max(1500).optional() });

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function planInstructions(ctx: RequestContext, organizationId: string, companyId: string, goal: { title: string; description: string | null; horizon: string; targetDate: Date | null }, guidance?: string) {
  const chain = await authorize(ctx, organizationId, companyId, "objectives.manage");
  const [company, departments, employees, objectives, metrics] = await Promise.all([
    db().company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { name: true, baseCurrency: true, operatingCountryCodes: true, targetMarketCodes: true } }),
    db().department.findMany({ where: { organizationId, companyId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 30 }),
    db().employee.findMany({ where: { organizationId, companyId, status: { not: "TERMINATED" }, title: { not: null } }, select: { departmentId: true, title: true }, take: 1000 }),
    db().objective.findMany({ where: { organizationId, companyId, status: "ACTIVE" }, select: { title: true }, take: 30 }),
    visibleMetrics(ctx, chain),
  ]);
  const roles = new Map<string, Set<string>>();
  for (const e of employees) if (e.departmentId && e.title) (roles.get(e.departmentId) ?? roles.set(e.departmentId, new Set()).get(e.departmentId)!).add(e.title);
  const today = new Date();
  const deptLines = departments.map((d) => `- ${d.name}${roles.get(d.id)?.size ? `: ${[...roles.get(d.id)!].slice(0, 8).join(", ")}` : ""}`);
  const metricLines = metrics.map((m) => `${m.key} (${m.unit === "money" ? `money, ${company.baseCurrency}` : m.unit}, ${m.kind === "flow" ? "sum over the period" : "value at period end"})`);
  const schema =
    '{"objectives":[{"title":"...","description":"...","department":"<department name>|null","role":"<job title>|null","targetInDays":90,' +
    '"keyResults":[{"title":"...","metricKey":"<metric key>|null","baseline":0,"target":100,"direction":"increase|decrease","unit":"<unit when metricKey is null>|null"}],' +
    '"milestones":[{"title":"...","dueInDays":30,"project":{"name":"...","description":"...","department":"...|null","role":"...|null","dueInDays":45,' +
    '"tasks":[{"title":"...","description":"...","department":"...|null","role":"...|null","dueInDays":10,"priority":"low|medium|high|urgent"}]}|null}]}]}';
  const parts = [
    "Decompose the company goal below into an executable plan for the company's teams.",
    `Goal: ${goal.title}`,
    goal.description ? `Details: ${goal.description}` : null,
    `Horizon: ${goal.horizon === "YEAR" ? "this year" : "this quarter"}. Today: ${iso(today)}.${goal.targetDate ? ` Target date: ${iso(goal.targetDate)} (${Math.max(1, Math.round((goal.targetDate.getTime() - today.getTime()) / 86_400_000))} days from today).` : ""}`,
    `Company: ${company.name}; currency ${company.baseCurrency}${company.operatingCountryCodes.length ? `; operates in ${company.operatingCountryCodes.join(", ")}` : ""}${company.targetMarketCodes.length ? `; target markets ${company.targetMarketCodes.join(", ")}` : ""}.`,
    guidance ? `Founder's guidance: ${guidance}` : null,
    deptLines.length ? `Departments (name: job titles):\n${deptLines.join("\n")}` : "The company has no departments recorded yet; leave department null and suggest a role.",
    objectives.length ? `Existing active objectives (do not duplicate): ${objectives.map((o) => o.title).join("; ")}` : null,
    "You may first use your read tools (company documents, objectives) to ground the plan. Never invent facts about the company.",
    "OUTPUT FORMAT — reply with ONLY one JSON object (no prose, no markdown fences), exactly this shape:",
    schema,
    "Rules: 2-5 objectives; 1-4 key results each; 1-5 milestones each; a milestone has at most one project with 2-10 concrete tasks (or project null). dueInDays/targetInDays are days from today and stay within the horizon. department must be one of the listed names or null; role is a job title (prefer listed ones). Use metricKey only from the list below, with baseline and target in that metric's unit (money in major units, percent as 0-100); otherwise set metricKey null and give a unit.",
  ].filter(Boolean) as string[];
  let text = parts.join("\n\n");
  const metricBlock = `Metrics available for key results:\n${metricLines.join("\n")}`;
  if (text.length + metricBlock.length + 2 <= MAX_INSTRUCTIONS) text += `\n\n${metricBlock}`;
  else text += `\n\n${metricBlock.slice(0, Math.max(0, MAX_INSTRUCTIONS - text.length - 40))}\n(more metrics omitted)`;
  return text.slice(0, MAX_INSTRUCTIONS);
}

/** Create the AI decomposition task for a goal (ai_ceo when available, else research_analyst). */
export async function startGoalPlan(ctx: RequestContext, organizationId: string, companyId: string, goalId: string, raw: z.input<typeof startPlanInput> = {}) {
  const input = startPlanInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "objectives.manage");
  if (!isUuid(goalId)) throw notFound("Goal");
  const goal = await db().companyGoal.findFirst({ where: { id: goalId, organizationId, companyId } });
  if (!goal) throw notFound("Goal");
  if (goal.planAppliedAt) throw conflict("This goal's plan was already applied", { reason: "objectives_plan_applied" });
  if (Object.keys((goal.planApplied ?? {}) as object).length) throw conflict("Part of the current plan was already applied; finish applying it first", { reason: "objectives_plan_partial" });
  if (goal.planTaskId) {
    const running = await db().agentTask.findFirst({ where: { id: goal.planTaskId, companyId, status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } });
    if (running) throw conflict("A plan is already being generated", { reason: "objectives_plan_running" });
  }
  const task = await createTask(ctx, organizationId, companyId, {
    profile: profileByKey("ai_ceo") ? "ai_ceo" : "research_analyst",
    title: `Plan: ${goal.title}`.slice(0, 200),
    instructions: await planInstructions(ctx, organizationId, companyId, goal, input.guidance),
    subject: { type: PLAN_SUBJECT, id: goal.id },
  });
  await transaction(async (tx) => {
    await tx.companyGoal.update({ where: { id: goal.id }, data: { planTaskId: task.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "company_goal.plan_requested", resourceType: "company_goal", resourceId: goal.id, newValue: { taskId: task.id, profile: task.profile } });
  });
  return task;
}

/** The goal's latest plan task (null when none, or when the viewer may not read AI tasks) and its parsed plan. */
export async function planState(ctx: RequestContext, organizationId: string, companyId: string, goal: { planTaskId: string | null }) {
  if (!goal.planTaskId) return { task: null, parsed: null, forbidden: false };
  try {
    const task = await getTask(ctx, organizationId, companyId, goal.planTaskId);
    return { task, parsed: task.status === "COMPLETED" ? parsePlanOutput(task.output) : null, forbidden: false };
  } catch (err) {
    if (isAppError(err) && (err.code === "forbidden" || err.code === "not_found")) return { task: null, parsed: null, forbidden: err.code === "forbidden" };
    throw err;
  }
}

// ───────────── Applying the reviewed plan ─────────────

const key = z.string().regex(/^[a-z0-9.]{1,40}$/);
const optUuid = z.string().uuid().or(z.literal("")).nullable().optional();
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).nullable().optional();
const blank = <T>(v: T | "" | null | undefined): T | undefined => (v === "" || v === null || v === undefined ? undefined : v);

const applyTask = z.object({ key, title: z.string().trim().min(1).max(300), description: z.string().trim().max(2000).optional(), assigneeId: optUuid, dueDate: optDate, priority: z.enum(PRIORITIES).default("MEDIUM") });
const applyProject = z.object({ key, name: z.string().trim().min(1).max(120), description: z.string().trim().max(5000).optional(), ownerId: optUuid, dueDate: optDate, tasks: z.array(applyTask).max(30).default([]) });
const applyMilestone = z.object({ key, title: z.string().trim().min(1).max(200), dueDate: optDate, project: applyProject.nullable().optional() });
const applyObjective = z.object({
  key,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  ownerId: optUuid,
  departmentId: optUuid,
  startDate: optDate,
  targetDate: optDate,
  keyResults: z.array(z.object({ key }).and(keyResultInput)).max(10).default([]),
  milestones: z.array(applyMilestone).max(12).default([]),
});
export const applyPlanInput = z.object({ objectives: z.array(applyObjective).min(1).max(10) });
export type ApplyPlanInput = z.input<typeof applyPlanInput>;

export interface ApplyCounts {
  objectives: number;
  keyResults: number;
  milestones: number;
  projects: number;
  tasks: number;
  /** Items created by an earlier, interrupted apply (resumed, not duplicated). */
  resumed: number;
}

/**
 * Create the reviewed plan. Everything is validated first (permissions, owners, metrics). Records are then created
 * through the objectives and work services — each in its own transaction, emitting objective.created / project.created
 * / task.created. Progress is recorded per item, so if something fails midway, applying again resumes without duplicates.
 */
export async function applyGoalPlan(ctx: RequestContext, organizationId: string, companyId: string, goalId: string, raw: ApplyPlanInput) {
  const plan = applyPlanInput.parse(raw);
  const chain = await authorize(ctx, organizationId, companyId, "objectives.manage");
  if (!isUuid(goalId)) throw notFound("Goal");
  const goal = await db().companyGoal.findFirst({ where: { id: goalId, organizationId, companyId } });
  if (!goal) throw notFound("Goal");
  if (goal.planAppliedAt) throw conflict("This goal's plan was already applied", { reason: "objectives_plan_applied" });
  if (goal.status !== "ACTIVE") throw conflict("Only active goals can be planned", { reason: "objectives_goal_inactive" });

  const keys = plan.objectives.flatMap((o) => [o.key, ...o.keyResults.map((k) => k.key), ...o.milestones.flatMap((m) => [m.key, ...(m.project ? [m.project.key, ...m.project.tasks.map((t) => t.key)] : [])])]);
  if (new Set(keys).size !== keys.length) throw invalid("Plan items must have unique keys", { reason: "objectives_plan_keys" });

  const projects = plan.objectives.flatMap((o) => o.milestones.flatMap((m) => (m.project ? [m.project] : [])));
  if (projects.length) await requirePermission(ctx, "projects.manage", chain);
  for (const o of plan.objectives) for (const kr of o.keyResults) await validateKeyResult(ctx, organizationId, companyId, kr);
  const objectiveOwners = [...new Set(plan.objectives.flatMap((o) => (blank(o.ownerId) ? [o.ownerId!] : [])))];
  if (objectiveOwners.length && (await eligibleMembers(db(), organizationId, chain, "objectives.read", objectiveOwners)).length !== objectiveOwners.length) {
    throw invalid("An objective owner has no access to objectives", { reason: "objectives_owner_ineligible" });
  }
  const workPeople = [...new Set(projects.flatMap((p) => [blank(p.ownerId), ...p.tasks.map((t) => blank(t.assigneeId))].filter((v): v is string => !!v)))];
  if (workPeople.length && (await eligibleUserIds(db(), organizationId, chain, "projects.read", workPeople)).length !== workPeople.length) {
    throw invalid("A project owner or assignee has no access to projects", { reason: "work_user_ineligible" });
  }

  const done: Record<string, string> = { ...((goal.planApplied ?? {}) as Record<string, string>) };
  const counts: ApplyCounts = { objectives: 0, keyResults: 0, milestones: 0, projects: 0, tasks: 0, resumed: 0 };
  const record = async (k: string, id: string, what: Exclude<keyof ApplyCounts, "resumed">) => {
    done[k] = id;
    counts[what]++;
    await db().companyGoal.update({ where: { id: goal.id }, data: { planApplied: done } });
  };
  const once = async (k: string, what: Exclude<keyof ApplyCounts, "resumed">, create: () => Promise<{ id: string }>) => {
    if (done[k]) {
      counts.resumed++;
      return done[k];
    }
    const row = await create();
    await record(k, row.id, what);
    return row.id;
  };

  try {
    for (const o of plan.objectives) {
      const objectiveId = await once(o.key, "objectives", () =>
        createObjective(ctx, organizationId, companyId, {
          title: o.title,
          description: o.description,
          ownerId: blank(o.ownerId),
          departmentId: blank(o.departmentId),
          startDate: blank(o.startDate),
          targetDate: blank(o.targetDate),
          goalId: goal.id,
          keyResults: o.keyResults,
        }),
      );
      for (const m of o.milestones) {
        let projectId: string | undefined;
        if (m.project) {
          const p = m.project;
          const memberIds = [...new Set(p.tasks.flatMap((t) => (blank(t.assigneeId) ? [t.assigneeId!] : [])))];
          projectId = await once(p.key, "projects", () =>
            createWorkProject(ctx, organizationId, companyId, { name: p.name, description: p.description, ownerId: blank(p.ownerId), status: "PLANNED", startDate: new Date().toISOString().slice(0, 10), dueDate: blank(p.dueDate), memberIds }),
          );
          for (const t of p.tasks) {
            await once(t.key, "tasks", () =>
              createWorkTask(ctx, organizationId, companyId, { projectId, title: t.title, description: t.description, assigneeId: blank(t.assigneeId), dueDate: blank(t.dueDate), priority: t.priority }),
            );
          }
        }
        await once(m.key, "milestones", () => createMilestone(ctx, organizationId, companyId, { objectiveId, title: m.title, dueDate: blank(m.dueDate) ?? undefined, projectId }));
      }
    }
  } catch (err) {
    const created = Object.keys(done).length;
    if (isAppError(err)) throw new AppError(err.code, created ? `${err.message} (${created} items were created; fix the problem and apply again to continue)` : err.message, { ...err.details, partial: counts });
    throw err;
  }
  counts.keyResults = plan.objectives.reduce((s, o) => s + o.keyResults.length, 0);
  await transaction(async (tx) => {
    await tx.companyGoal.update({ where: { id: goal.id }, data: { planAppliedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "company_goal.plan_applied", resourceType: "company_goal", resourceId: goal.id, newValue: { ...counts, taskId: goal.planTaskId } });
  });
  return { goalId: goal.id, counts };
}
