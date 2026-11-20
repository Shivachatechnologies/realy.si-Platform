import { z } from "zod";
import { manifestSchema, PRIORITIES } from "@/server/modules/marketplace/manifest";
import type { RunMode } from "./brief";

/**
 * The builder's ordered steps. Every AI step is a real agent task whose deliverable is saved in Company Brain.
 * Structural steps also end with a strict JSON block (validated with the schemas below) that the builder converts
 * into records: a generated marketplace manifest (installed with the marketplace installer), graph products,
 * company goals, strategy and finance plan items. `effect` names what the engine does with the parsed JSON.
 */

const name = z.string().trim().min(1).max(120);
const desc = z.string().trim().max(2000).optional();
const days = z.number().int().min(0).max(3650);

export const productsSchema = z.object({
  products: z.array(z.object({ name, description: desc, pricing: z.string().trim().max(300).optional() })).min(1).max(20),
  revenueStreams: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
});
export const strategySchema = z.object({
  mission: z.string().trim().min(1).max(2000),
  vision: z.string().trim().min(1).max(2000),
  values: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
});
export const nameIdeasSchema = z.object({
  nameIdeas: z.array(z.object({ name, rationale: z.string().trim().max(500).default("") })).min(3).max(8),
});
export const goalsSchema = z.object({
  goals: z
    .array(z.object({ title: z.string().trim().min(1).max(300), description: desc, horizon: z.enum(["QUARTER", "YEAR"]).default("QUARTER") }))
    .min(1)
    .max(5),
  objectives: manifestSchema.shape.objectives.unwrap().min(1).max(10),
});
export const structureSchema = z.object({ departments: manifestSchema.shape.departments.unwrap().min(1).max(15) });
export const aiEmployeesSchema = z.object({ aiEmployees: manifestSchema.shape.aiEmployees.unwrap().min(1).max(15) });
export const projectsSchema = z.object({
  projects: z
    .array(
      z.object({
        name,
        tasks: z
          .array(z.object({ title: z.string().trim().min(1).max(200), description: desc, priority: z.enum(PRIORITIES).default("MEDIUM"), dueInDays: days.optional() }))
          .min(1)
          .max(30),
      }),
    )
    .min(1)
    .max(10),
});
export const pipelinesSchema = z.object({ pipelines: manifestSchema.shape.pipelines.unwrap().min(1).max(3) });
export const workflowsSchema = z.object({ workflows: manifestSchema.shape.workflows.unwrap().min(1).max(10) });
export const financeSchema = z.object({
  items: z
    .array(z.object({ name: z.string().trim().min(1).max(200), monthOffset: z.number().int().min(0).max(23), amount: z.number().min(-1e10).max(1e10).refine((v) => v !== 0, "amount must not be 0"), notes: z.string().trim().max(500).optional() }))
    .min(1)
    .max(40),
  budgets: z.array(z.object({ name, months: z.number().int().min(1).max(24), amount: z.number().positive().max(1e10) })).max(12).default([]),
});
export const configurationSchema = z.object({
  departments: manifestSchema.shape.departments.unwrap().max(15).default([]),
  aiEmployees: manifestSchema.shape.aiEmployees.unwrap().max(15).default([]),
  projects: projectsSchema.shape.projects.optional().default([]),
  workflows: manifestSchema.shape.workflows.unwrap().max(10).default([]),
  pipelines: manifestSchema.shape.pipelines.unwrap().max(3).default([]),
});

/**
 * The onboarding journey's Company Blueprint: everything the founder edits and approves in one place before any record
 * is created. AI output must propose at least one department; the founder's edited version may be anything (manual).
 */
const blueprintShape = (min: number) =>
  z.object({
    summary: z.string().trim().max(2000).optional(),
    departments: manifestSchema.shape.departments.unwrap().min(min).max(15),
    products: z.array(z.object({ name, description: desc, pricing: z.string().trim().max(300).optional() })).max(20).default([]),
    goals: goalsSchema.shape.goals.element.array().max(5).default([]),
    objectives: manifestSchema.shape.objectives.unwrap().max(10).default([]),
    projects: z
      .array(
        z.object({
          name,
          tasks: z
            .array(z.object({ title: z.string().trim().min(1).max(200), description: desc, priority: z.enum(PRIORITIES).default("MEDIUM"), dueInDays: days.optional() }))
            .max(30)
            .default([]),
        }),
      )
      .max(10)
      .default([]),
    workflows: manifestSchema.shape.workflows.unwrap().max(10).default([]),
  });
export const blueprintSchema = blueprintShape(1);
/** What the founder approves (possibly built by hand when AI is not available). */
export const blueprintInput = blueprintShape(0);
export type Blueprint = z.output<typeof blueprintInput>;

export const ORG_LEVELS = ["EXECUTIVE", "MANAGER", "SPECIALIST"] as const;
const workforceShape = (min: number) =>
  z.object({
    team: z
      .array(
        z.object({
          /** Stable key inside the plan (reportsTo points at it). */
          key: z.string().trim().regex(/^[a-z0-9_-]{1,40}$/),
          profile: z.string().trim().regex(/^[a-z_]{2,60}$/),
          name: z.string().trim().min(1).max(80),
          title: z.string().trim().max(120).optional(),
          level: z.enum(ORG_LEVELS).default("SPECIALIST"),
          reportsTo: z.string().trim().max(40).optional().nullable(),
          responsibilities: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
          goals: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
        }),
      )
      .min(min)
      .max(15),
  });
export const workforcePlanSchema = workforceShape(1);
export const workforceInput = workforceShape(0);
export type WorkforcePlan = z.output<typeof workforceInput>;

export type Effect = "products" | "strategy" | "name" | "goals" | "structure" | "install" | "finance" | "configuration" | "blueprint" | "workforce";

export interface StepDef {
  key: string;
  kind: "ai" | "system";
  profile?: string;
  /** Brain tag for the department the deliverable belongs to. */
  department: string;
  prompt: string;
  schema?: z.ZodType;
  /** JSON shape shown to the model. */
  shape?: string;
  effect?: Effect;
}

const PRODUCTS_SHAPE = `{"products":[{"name":"...","description":"...","pricing":"e.g. 29 USD / month"}],"revenueStreams":["..."]}`;
const STRATEGY_SHAPE = `{"mission":"...","vision":"...","values":["..."]}`;
const GOALS_SHAPE = `{"goals":[{"title":"...","description":"...","horizon":"QUARTER|YEAR"}],"objectives":[{"title":"...","description":"...","targetInDays":90,"milestones":[{"title":"...","dueInDays":30}]}]}`;
const STRUCTURE_SHAPE = `{"departments":[{"name":"Marketing","description":"...","teams":[{"name":"Content","description":"..."}]}]}`;
const PROJECTS_SHAPE = `{"projects":[{"name":"...","tasks":[{"title":"...","description":"...","priority":"LOW|MEDIUM|HIGH|URGENT","dueInDays":14}]}]}`;
const PIPELINES_SHAPE = `{"pipelines":[{"name":"...","stages":["Qualified","Demo","Proposal","Negotiation","Won","Lost"]}]}`;
const WORKFLOWS_SHAPE = `{"workflows":[{"key":"<template key or a new snake_case key>","name":"...","trigger":"<event type>","description":"..."}]}`;
const AI_EMPLOYEES_SHAPE = `{"aiEmployees":[{"profile":"<role profile key>","name":"<a person-like name>","description":"what this AI employee focuses on"}]}`;
const FINANCE_SHAPE = `{"items":[{"name":"...","monthOffset":0,"amount":-1200,"notes":"..."}],"budgets":[{"name":"Marketing","months":6,"amount":3000}]}`;

export const NEW_IDEA_STEPS: StepDef[] = [
  { key: "idea_analysis", kind: "ai", profile: "research_analyst", department: "research", prompt: "Analyze the business idea: the problem it solves, for whom, why now, the core value proposition, key assumptions to validate and the biggest unknowns." },
  { key: "market_research", kind: "ai", profile: "research_analyst", department: "research", prompt: "Research the market: market definition, size estimate method (top-down and bottom-up with stated assumptions), segments, trends, regulation and the target countries' specifics." },
  { key: "competitors", kind: "ai", profile: "research_analyst", department: "research", prompt: "Map the competitive landscape: direct and indirect competitors and substitutes, their positioning, pricing and weaknesses, and where this business can win." },
  { key: "demand", kind: "ai", profile: "research_analyst", department: "research", prompt: "Assess demand: signals of demand, willingness to pay, purchase triggers, seasonality, and cheap experiments to validate demand in the first 30 days." },
  { key: "customers_personas", kind: "ai", profile: "marketing_strategist", department: "marketing", prompt: "Define the ideal customer profile and 3–4 personas: goals, pains, jobs-to-be-done, objections, buying process and the channels where they can be reached." },
  { key: "opportunities_risks", kind: "ai", profile: "ai_ceo", department: "executive", prompt: "List the main opportunities and risks (market, product, execution, financial, legal) with likelihood, impact and a mitigation for each." },
  { key: "positioning", kind: "ai", profile: "cmo", department: "marketing", prompt: "Write the positioning: category, target customer, key benefit, reasons to believe, differentiation and the core messaging. Also write the mission, vision and values.", schema: strategySchema, shape: STRATEGY_SHAPE, effect: "strategy" },
  { key: "business_model", kind: "ai", profile: "ai_cfo", department: "finance", prompt: "Design the business model: the products or services to offer at launch, pricing for each, revenue streams, unit economics (with stated assumptions) and the cost structure.", schema: productsSchema, shape: PRODUCTS_SHAPE, effect: "products" },
  { key: "business_plan", kind: "ai", profile: "ai_ceo", department: "executive", prompt: "Write a concise business plan: executive summary, problem, solution, market, competition, business model, go-to-market, operations, team, milestones, financial overview and funding needs." },
  { key: "brand", kind: "ai", profile: "cmo", department: "marketing", prompt: "Write the brand strategy and identity brief: brand personality, voice and tone, visual direction (colors, typography, imagery) and taglines. Propose 3 to 8 company name ideas with a short rationale each (check them for obvious conflicts with known brands).", schema: nameIdeasSchema, shape: `{"nameIdeas":[{"name":"...","rationale":"..."}]}`, effect: "name" },
  { key: "product_roadmap", kind: "ai", profile: "product_manager", department: "product", prompt: "Write the product roadmap: MVP scope, the first three releases with their goals and features, what is explicitly out of scope, and how success is measured." },
  { key: "objectives_kpis", kind: "ai", profile: "ai_ceo", department: "executive", prompt: "Set the company goals, objectives and KPIs for the first year: up to 5 goals, and objectives with measurable milestones (with due dates in days from today).", schema: goalsSchema, shape: GOALS_SHAPE, effect: "goals" },
  { key: "org_structure", kind: "ai", profile: "ai_ceo", department: "executive", prompt: "Design the organization: the departments the company needs now (lean — only what the next 12 months require), the teams inside each and their responsibilities.", schema: structureSchema, shape: STRUCTURE_SHAPE, effect: "structure" },
  { key: "ai_employees", kind: "ai", profile: "ai_ceo", department: "executive", prompt: "Choose the AI employees the company should hire first (3 to 10): one per role that removes the most work, with a focus description each.", schema: aiEmployeesSchema, shape: AI_EMPLOYEES_SHAPE, effect: "install" },
  { key: "projects_tasks", kind: "ai", profile: "operations_assistant", department: "operations", prompt: "Plan the first projects (3 to 6) with concrete starter tasks, priorities and due dates in days from today, covering product, go-to-market and operations setup.", schema: projectsSchema, shape: PROJECTS_SHAPE, effect: "install" },
  { key: "go_to_market", kind: "ai", profile: "sales_manager", department: "sales", prompt: "Write the marketing, sales and go-to-market strategy: channels, campaigns for the first 90 days, sales process, outreach approach, partnerships and the metrics to watch. Define the sales pipeline(s) with their stages.", schema: pipelinesSchema, shape: PIPELINES_SHAPE, effect: "install" },
  { key: "operational_workflows", kind: "ai", profile: "operations_assistant", department: "operations", prompt: "Define the operational workflows to automate (lead intake, onboarding, support, invoicing, reviews…): for each, what triggers it and what it does.", schema: workflowsSchema, shape: WORKFLOWS_SHAPE, effect: "install" },
  { key: "launch_plan", kind: "ai", profile: "ai_ceo", department: "executive", prompt: "Write the launch plan: pre-launch, launch week and the first 90 days, week by week, with owners (departments or AI employees), checkpoints and go/no-go criteria." },
  { key: "financial_plan", kind: "ai", profile: "ai_cfo", department: "finance", prompt: "Write the initial financial plan for 12 months: revenue forecast, costs, hiring, cash runway against the starting budget, and break-even. List the planned one-off and monthly cash movements (expenses negative, income positive, in the company's base currency) and department budgets.", schema: financeSchema, shape: FINANCE_SHAPE, effect: "finance" },
];

export const EXISTING_STEPS: StepDef[] = [
  { key: "website_ingest", kind: "system", department: "research", prompt: "" },
  { key: "business_analysis", kind: "ai", profile: "research_analyst", department: "research", prompt: "Analyze the existing business from its documents and website pages in Company Brain: what it sells, positioning, customers, revenue model and operations. List every product or service you find.", schema: productsSchema, shape: PRODUCTS_SHAPE, effect: "products" },
  { key: "market_competitors", kind: "ai", profile: "research_analyst", department: "research", prompt: "Assess the business's market and competitors: market, segments, competitors and how this business compares on offer, price and positioning." },
  { key: "positioning_review", kind: "ai", profile: "cmo", department: "marketing", prompt: "Review the business's positioning and messaging and recommend improvements. State the mission, vision and values as the sources describe them (or as you recommend, marked as a recommendation).", schema: strategySchema, shape: STRATEGY_SHAPE, effect: "strategy" },
  { key: "opportunities_weaknesses", kind: "ai", profile: "ai_ceo", department: "executive", prompt: "List the business's biggest opportunities and weaknesses (offer, customers, marketing, sales, operations, finance) with the evidence for each and a recommended action." },
  { key: "goals", kind: "ai", profile: "ai_ceo", department: "executive", prompt: "Recommend goals, objectives and KPIs for the next 12 months with measurable milestones (due dates in days from today).", schema: goalsSchema, shape: GOALS_SHAPE, effect: "goals" },
  { key: "recommended_configuration", kind: "ai", profile: "ai_ceo", department: "executive", prompt: "Recommend how to run this business on the platform: departments and teams, AI employees to hire, the first projects with tasks, automated workflows and sales pipelines. Explain each recommendation briefly.", schema: configurationSchema, shape: `{"departments":[...],"aiEmployees":[...],"projects":[...],"workflows":[...],"pipelines":[...]} — each as in: ${STRUCTURE_SHAPE} ${AI_EMPLOYEES_SHAPE} ${PROJECTS_SHAPE} ${WORKFLOWS_SHAPE} ${PIPELINES_SHAPE}`, effect: "configuration" },
];

// ───────────── Onboarding journey (6 stages) ─────────────
// Intelligence (live web research through the integrations research service + AI research tasks) → one Company
// Blueprint the founder edits and approves → the AI workforce plan the founder approves → after launch the builder keeps
// working in the background (positioning, go-to-market, launch plan, financial plan).

const BLUEPRINT_SHAPE = `{"summary":"one paragraph","departments":[{"name":"Marketing","description":"...","teams":[{"name":"Content","description":"..."}]}],"products":[{"name":"...","description":"...","pricing":"e.g. 29 USD / month"}],"goals":[{"title":"...","description":"...","horizon":"QUARTER|YEAR"}],"objectives":[{"title":"...","description":"...","targetInDays":90,"milestones":[{"title":"...","dueInDays":30}]}],"projects":[{"name":"...","tasks":[{"title":"...","description":"...","priority":"LOW|MEDIUM|HIGH|URGENT","dueInDays":14}]}],"workflows":[{"key":"<template key or a new snake_case key>","name":"...","trigger":"<event type>","description":"..."}]}`;
const WORKFORCE_SHAPE = `{"team":[{"key":"ceo","profile":"ai_ceo","name":"<a person-like name>","title":"Chief Executive","level":"EXECUTIVE","reportsTo":null,"responsibilities":["..."],"goals":["<one of the blueprint goals or objectives>"]},{"key":"marketing_lead","profile":"cmo","name":"...","title":"...","level":"MANAGER","reportsTo":"ceo","responsibilities":["..."],"goals":["..."]}]}`;

const WEB_RESEARCH: StepDef = { key: "web_research", kind: "system", department: "research", prompt: "" };
const BLUEPRINT: StepDef = {
  key: "company_blueprint",
  kind: "ai",
  profile: "ai_ceo",
  department: "executive",
  prompt:
    "Design the Company Blueprint from the research deliverables: a lean set of departments with teams (only what the next 12 months need), the products or services to offer at launch with pricing, up to 5 company goals, measurable objectives with milestones, the first 3 to 6 projects with concrete starter tasks, and the operational workflows to automate. Keep every item specific to this business.",
  schema: blueprintSchema,
  shape: BLUEPRINT_SHAPE,
  effect: "blueprint",
};
const WORKFORCE: StepDef = {
  key: "workforce_plan",
  kind: "ai",
  profile: "ai_ceo",
  department: "executive",
  prompt:
    "Propose the AI workforce for the approved Company Blueprint (3 to 10 AI employees): exactly one AI CEO (level EXECUTIVE, reportsTo null), department managers (level MANAGER, reporting to the CEO) and specialists (level SPECIALIST, reporting to a manager). For each, the responsibilities and the blueprint goals or objectives it owns.",
  schema: workforcePlanSchema,
  shape: WORKFORCE_SHAPE,
  effect: "workforce",
};
const plain = (key: string): StepDef => {
  const d = [...NEW_IDEA_STEPS, ...EXISTING_STEPS].find((s) => s.key === key)!;
  return { key: d.key, kind: d.kind, profile: d.profile, department: d.department, prompt: d.prompt.replace(/ List every product or service you find\./, "") };
};
const step = (key: string) => [...NEW_IDEA_STEPS, ...EXISTING_STEPS].find((s) => s.key === key)!;

export const JOURNEY_NEW_IDEA_STEPS: StepDef[] = [
  WEB_RESEARCH,
  plain("idea_analysis"),
  plain("market_research"),
  plain("competitors"),
  plain("customers_personas"),
  { ...plain("business_model"), prompt: "Design the business model: the products or services to offer at launch, pricing for each, revenue streams, unit economics (with stated assumptions) and the cost structure." },
  plain("opportunities_risks"),
  BLUEPRINT,
  WORKFORCE,
  step("positioning"),
  step("go_to_market"),
  step("launch_plan"),
  step("financial_plan"),
];
export const JOURNEY_EXISTING_STEPS: StepDef[] = [
  step("website_ingest"),
  WEB_RESEARCH,
  plain("business_analysis"),
  plain("market_competitors"),
  plain("opportunities_weaknesses"),
  BLUEPRINT,
  WORKFORCE,
  step("positioning_review"),
  step("go_to_market"),
  step("financial_plan"),
];
/** Journey steps shown in the Intelligence stage; everything after the workforce plan runs after launch. */
export const JOURNEY_RESEARCH_KEYS = ["website_ingest", "web_research", "idea_analysis", "market_research", "competitors", "customers_personas", "business_model", "opportunities_risks", "business_analysis", "market_competitors", "opportunities_weaknesses"];
export const BLUEPRINT_KEY = BLUEPRINT.key;
export const WORKFORCE_KEY = WORKFORCE.key;

export const stepsFor = (mode: RunMode, journey = false): StepDef[] =>
  journey ? (mode === "NEW_IDEA" ? JOURNEY_NEW_IDEA_STEPS : JOURNEY_EXISTING_STEPS) : mode === "NEW_IDEA" ? NEW_IDEA_STEPS : EXISTING_STEPS;
export const stepDef = (mode: RunMode, key: string, journey = false): StepDef | undefined => stepsFor(mode, journey).find((s) => s.key === key);
export const ALL_STEP_KEYS = [...new Set([...NEW_IDEA_STEPS, ...EXISTING_STEPS, ...JOURNEY_NEW_IDEA_STEPS, ...JOURNEY_EXISTING_STEPS].map((s) => s.key))];
