import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, isAppError, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { createTask } from "@/server/modules/agents/service";
import { profileByKey } from "@/server/modules/agents/profiles";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { briefText, parseBrief } from "./brief";
import { BLUEPRINT_KEY, blueprintInput, type Blueprint } from "./steps";

/**
 * The company's first real work, started the moment the founder hires the AI team: the AI CEO's first weekly plan and
 * one first deliverable per department (brand brief, marketing plan, ICP + first lead list, finance setup checklist,
 * product PRD). Each is an ordinary agent task (subject builder_first_week → run), assigned to the hired AI employee of
 * that department when there is one, so the work shows in Tasks, on the employee and on the Launch stage. Idempotent per
 * deliverable: a retry only creates what is missing. AI acts through its own tools and autonomy rules: nothing here
 * sends, publishes or contacts anyone.
 */

export const FIRST_WEEK_SUBJECT = "builder_first_week";

export const FIRST_WEEK_KEYS = ["ceo_plan", "brand_brief", "marketing_plan", "icp_leads", "finance_checklist", "product_prd"] as const;
export type FirstWeekKey = (typeof FIRST_WEEK_KEYS)[number];

interface Deliverable {
  key: FirstWeekKey;
  /** Task title prefix (English, like every agent task title); the UI maps it back to the key. */
  title: string;
  /** Preferred roles, best first: a hired employee with one of these does the work, else the first existing role. */
  profiles: string[];
  prompt: string;
}

const DELIVERABLES: Deliverable[] = [
  {
    key: "ceo_plan",
    title: "First weekly plan",
    profiles: ["ai_ceo"],
    prompt:
      "Write the company's first weekly plan as its AI CEO: the 3 priorities of this week and why, what each department delivers this week (the department tasks listed below already exist — do not create duplicates), day-by-day sequencing, dependencies between the deliverables, risks, and the decisions the founder must make or approve this week. End with how success will be measured on Friday.",
  },
  {
    key: "brand_brief",
    title: "Brand brief",
    profiles: ["creative_designer", "content_strategist", "cmo", "marketing_strategist"],
    prompt:
      "Write the brand brief: positioning statement, target audience, brand promise, personality and tone of voice (with do/don't examples), messaging pillars, a tagline shortlist, visual direction (colour, type, imagery) and the first brand assets to produce.",
  },
  {
    key: "marketing_plan",
    title: "Marketing plan",
    profiles: ["cmo", "marketing_strategist", "growth_manager", "campaign_strategist"],
    prompt:
      "Write the first 90-day marketing plan: goals and KPIs, target segments, channel mix with rationale, the launch campaign outline, a content calendar for the first 4 weeks, budget split (as assumptions in the company currency) and the experiments to run first. Do not publish or schedule anything.",
  },
  {
    key: "icp_leads",
    title: "Ideal customer profile and first lead list",
    profiles: ["sales_manager", "sales_researcher"],
    prompt:
      "Define the ideal customer profile (firmographics, roles, pains, triggers, disqualifiers) and buyer personas, then build the first lead list. Use only your research tools for real, verifiable companies; if no research or lead-data tool is available, give the exact search criteria and sources to use instead and say plainly that no list could be researched. Never invent people, emails or phone numbers, and do not contact anyone.",
  },
  {
    key: "finance_checklist",
    title: "Finance setup checklist",
    profiles: ["ai_cfo", "bookkeeper"],
    prompt:
      "Write the finance setup checklist for this company in its home country: business bank account, accounting system and chart of accounts, invoicing and payment collection, tax registrations and deadlines to verify with an accountant, expense policy, a starting budget by department (assumptions) and the monthly finance routine. Mark every legal or tax point as something to confirm with a qualified professional.",
  },
  {
    key: "product_prd",
    title: "Product requirements document",
    profiles: ["product_manager", "product_researcher", "ai_project_manager"],
    prompt:
      "Write the first product requirements document (PRD) for the main product: problem, target users, jobs to be done, goals and non-goals, user stories with acceptance criteria for the first release, scope (must/should/could), success metrics, risks and open questions.",
  },
];

const deliverableOf = (title: string) => DELIVERABLES.find((d) => title.startsWith(`${d.title}:`)) ?? null;
export const firstWeekKeyOf = (title: string): FirstWeekKey | null => deliverableOf(title)?.key ?? null;

function blueprintFacts(bp: Blueprint | null) {
  if (!bp) return "";
  return [
    bp.summary && `Blueprint summary: ${bp.summary}`,
    bp.departments.length && `Departments: ${bp.departments.map((d) => d.name).join(", ")}`,
    bp.products.length && `Products: ${bp.products.map((p) => [p.name, p.pricing].filter(Boolean).join(" — ")).join("; ")}`,
    bp.goals.length && `Company goals: ${bp.goals.map((g) => g.title).join("; ")}`,
    bp.objectives.length && `Objectives: ${bp.objectives.map((o) => o.title).join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2500);
}

export type FirstWeekResult = { created: number; skipped: number; failed: number; reason?: string };

/**
 * Create the missing first-week tasks for a journey run. Errors on one deliverable (paused employee, budget) are counted
 * and the rest continue; a missing AI provider stops early with its reason so the Launch stage can say so.
 */
export async function kickoffFirstWeek(ctx: RequestContext, organizationId: string, companyId: string, runId: string): Promise<FirstWeekResult> {
  await requirePermission(ctx, "agents.run", await companyChain(db(), organizationId, companyId));
  const run = await db().builderRun.findFirst({ where: { id: runId, organizationId, companyId }, include: { company: { select: { name: true, baseCurrency: true } } } });
  if (!run) throw notFound("Builder run");
  if (run.status === "CANCELLED") throw conflict("This run was cancelled", { reason: "builder_not_active" });
  const bpStep = await db().builderStep.findFirst({ where: { runId, key: BLUEPRINT_KEY }, select: { status: true, data: true } });
  const parsed = bpStep?.status === "COMPLETED" ? blueprintInput.safeParse(bpStep.data) : null;
  const bp = parsed?.success ? parsed.data : null;

  const [existing, employees] = await Promise.all([
    db().agentTask.findMany({ where: { organizationId, companyId, subjectType: FIRST_WEEK_SUBJECT, subjectId: runId, status: { notIn: ["FAILED", "CANCELLED"] } }, select: { title: true } }),
    db().aiEmployee.findMany({ where: { organizationId, companyId, archivedAt: null, status: { not: "PAUSED" } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, profileKey: true } }),
  ]);
  const have = new Set(existing.map((t) => deliverableOf(t.title)?.key).filter(Boolean));
  const owner = (d: Deliverable) => {
    for (const p of d.profiles) {
      const e = employees.find((x) => x.profileKey === p);
      if (e) return { aiEmployeeId: e.id, label: e.name };
    }
    const p = d.profiles.find((k) => profileByKey(k));
    return p ? { profile: p, label: p } : null;
  };
  const owners = new Map(DELIVERABLES.map((d) => [d.key, owner(d)]));
  const team = DELIVERABLES.filter((d) => d.key !== "ceo_plan")
    .map((d) => `- ${d.title} → ${owners.get(d.key)?.label ?? "unassigned"}`)
    .join("\n");
  const context = [`Founder's brief:\n${briefText(parseBrief(run.brief), run.company.name)}\nCompany base currency: ${run.company.baseCurrency}`, blueprintFacts(bp)].filter(Boolean).join("\n\n");

  const result: FirstWeekResult = { created: 0, skipped: 0, failed: 0 };
  for (const d of DELIVERABLES) {
    if (have.has(d.key)) {
      result.skipped++;
      continue;
    }
    const who = owners.get(d.key);
    if (!who) {
      result.failed++;
      continue;
    }
    const instructions = [
      `This is week one of ${run.company.name}, a company just set up with the AI Company Builder. Your deliverable: ${d.title}.`,
      d.prompt,
      context,
      d.key === "ceo_plan" ? `Department deliverables already assigned this week:\n${team}` : "",
      `The Company Builder research and blueprint are in Company Brain (tag "builder"): search them with search_company_brain first and stay consistent with them.`,
      `Write the deliverable in Markdown with clear headings, specific to this business. Label assumptions as "Assumption:". Never present invented figures, customers or results as facts. Anything that would send, publish, pay or contact someone needs the founder's approval.`,
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 7900);
    try {
      const assignee = "aiEmployeeId" in who ? { aiEmployeeId: who.aiEmployeeId } : { profile: who.profile };
      await createTask(ctx, organizationId, companyId, { ...assignee, title: `${d.title}: ${run.company.name}`.slice(0, 200), instructions, subject: { type: FIRST_WEEK_SUBJECT, id: runId } });
      result.created++;
    } catch (err) {
      const reason = isAppError(err) ? (typeof err.details?.reason === "string" ? err.details.reason : err.code) : "internal_error";
      logger.warn({ runId, deliverable: d.key, reason }, "first-week task could not be created");
      result.failed++;
      result.reason ??= reason;
      // Without an AI provider or budget nothing else can start either.
      if (isAppError(err) && ["not_configured", "not_available", "forbidden"].includes(err.code)) break;
    }
  }
  if (result.created) {
    await writeAudit(db(), ctx, { category: "TENANT", organizationId, action: "builder.first_week.started", resourceType: "builder_run", resourceId: runId, newValue: result });
  }
  return result;
}

/** The first-week tasks of a run for the Launch stage (newest attempt per deliverable). */
export async function firstWeekTasks(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  await requirePermission(ctx, "agents.read", await companyChain(db(), organizationId, companyId));
  const rows = await db().agentTask.findMany({
    where: { organizationId, companyId, subjectType: FIRST_WEEK_SUBJECT, subjectId: runId },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, title: true, status: true, profile: true, aiEmployeeId: true, createdAt: true, completedAt: true },
  });
  const out = new Map<FirstWeekKey, (typeof rows)[number] & { key: FirstWeekKey }>();
  for (const r of rows) {
    const key = firstWeekKeyOf(r.title);
    if (key && !out.has(key)) out.set(key, { ...r, key });
  }
  return FIRST_WEEK_KEYS.flatMap((k) => (out.has(k) ? [out.get(k)!] : []));
}
