import { z } from "zod";
import { CHANNELS } from "@/server/modules/marketing/common";
import { PRIORITIES } from "@/server/modules/marketplace/manifest";
import { workforcePlanSchema } from "./steps";

/**
 * The Founder Kit: every deliverable a first-time founder needs, in dependency order. Each AI deliverable is an agent task
 * (Markdown + an optional strict JSON block validated with the schema below); the logo is generated with the integrations
 * image service. `actions` name what "Turn this into action" can create from the deliverable (builder/kit-actions.ts).
 */

export const KIT_KEYS = [
  "idea_refinement",
  "market_research",
  "competitor_research",
  "customer_personas",
  "business_model_canvas",
  "revenue_model",
  "pricing",
  "business_plan",
  "brand_positioning",
  "name_ideas",
  "logo",
  "website_structure",
  "marketing_strategy",
  "sales_strategy",
  "launch_roadmap",
  "financial_forecast",
  "ai_workforce",
] as const;
export type KitKey = (typeof KIT_KEYS)[number];
export const isKitKey = (v: unknown): v is KitKey => typeof v === "string" && (KIT_KEYS as readonly string[]).includes(v);

export const KIT_ACTIONS = ["create_project", "create_objectives", "create_campaigns", "save_icp", "save_strategy", "create_budgets", "create_products", "use_workforce", "use_name", "pin_logo"] as const;
export type KitAction = (typeof KIT_ACTIONS)[number];

const s = (max: number) => z.string().trim().min(1).max(max);
const list = (max: number, len = 300) => z.array(s(len)).max(max).default([]);
const days = z.number().int().min(0).max(730);

export const personasSchema = z.object({
  personas: z
    .array(z.object({ name: s(80), role: s(160), summary: s(600), goals: list(6), pains: list(6), objections: list(6), channels: list(6, 120) }))
    .min(2)
    .max(5),
  icp: s(4000),
});
export const canvasSchema = z.object({
  customerSegments: list(8),
  valuePropositions: list(8),
  channels: list(8),
  customerRelationships: list(8),
  revenueStreams: list(8),
  keyResources: list(8),
  keyActivities: list(8),
  keyPartners: list(8),
  costStructure: list(8),
});
export const REVENUE_TYPES = ["subscription", "one_time", "usage", "commission", "advertising", "licensing", "services", "other"] as const;
export const revenueSchema = z.object({
  streams: z.array(z.object({ name: s(120), type: z.enum(REVENUE_TYPES).catch("other"), description: s(600), sharePercent: z.number().min(0).max(100).optional() })).min(1).max(8),
});
export const PRICE_INTERVALS = ["month", "year", "one_time", "usage"] as const;
export const pricingSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  tiers: z.array(z.object({ name: s(80), price: z.number().min(0).max(1e9), interval: z.enum(PRICE_INTERVALS).catch("month"), audience: s(300), features: list(10, 200) })).min(1).max(5),
  rationale: z.string().trim().max(2000).default(""),
});
export const positioningSchema = z.object({
  statement: s(1000),
  category: s(200),
  targetCustomer: s(500),
  keyBenefit: s(500),
  differentiators: list(6),
  mission: s(1000),
  vision: s(1000),
  values: list(8, 200),
  taglines: list(6, 160),
  visual: z.object({ colors: list(5, 60), style: z.string().trim().max(300).default("") }).default({ colors: [], style: "" }),
});
const domain = z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,63}(\.[a-z]{2,24}){1,2}$/);
export const namesSchema = z.object({ names: z.array(z.object({ name: s(80), rationale: z.string().trim().max(400).default(""), domain: domain.optional().catch(undefined) })).min(3).max(10) });
export const websiteSchema = z.object({
  pages: z
    .array(z.object({ slug: z.string().trim().regex(/^\/[a-z0-9\-/]{0,80}$/), title: s(120), purpose: s(400), sections: z.array(z.object({ heading: s(160), content: s(1200) })).min(1).max(10) }))
    .min(1)
    .max(15),
});
export const marketingSchema = z.object({
  campaigns: z
    .array(z.object({ name: s(120), objective: s(400), description: z.string().trim().max(2000).default(""), channels: z.array(z.enum(CHANNELS)).max(6).catch([]).default([]), durationDays: z.number().int().min(1).max(365).default(30), budget: z.number().min(0).max(1e9).optional() }))
    .min(1)
    .max(6),
});
export const salesSchema = z.object({
  icp: s(4000),
  stages: list(8, 100),
  playbook: z.array(z.object({ title: s(160), description: z.string().trim().max(800).default("") })).max(10).default([]),
});
export const roadmapSchema = z.object({
  projectName: s(120),
  milestones: z
    .array(
      z.object({
        title: s(200),
        description: z.string().trim().max(1000).optional(),
        dueInDays: days,
        tasks: z.array(z.object({ title: s(200), description: z.string().trim().max(1000).optional(), priority: z.enum(PRIORITIES).catch("MEDIUM").default("MEDIUM"), dueInDays: days.optional() })).max(10).default([]),
      }),
    )
    .min(1)
    .max(8),
  objectives: z.array(z.object({ title: s(200), description: z.string().trim().max(1000).optional(), targetInDays: days })).max(5).default([]),
});
export const forecastSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  startingCash: z.number().min(0).max(1e11).default(0),
  assumptions: z.array(z.object({ label: s(160), value: s(200) })).min(1).max(20),
  months: z
    .array(z.object({ month: z.number().int().min(1).max(12), revenue: z.number().min(0).max(1e11), costs: z.number().min(0).max(1e11), note: z.string().trim().max(200).optional() }))
    .length(12),
  budgets: z.array(z.object({ name: s(120), months: z.number().int().min(1).max(12), amount: z.number().positive().max(1e11) })).max(8).default([]),
});
export const sourcesSchema = z.object({ sources: z.array(z.object({ title: z.string(), url: z.string(), snippet: z.string().optional() })).default([]), research: z.string().optional() });

export interface KitDef {
  key: KitKey;
  kind: "ai" | "image";
  profile: string;
  department: string;
  deps: KitKey[];
  prompt: string;
  schema?: z.ZodType;
  shape?: string;
  /** Live web research before the task (integrations research service); results are cited as sources. */
  research?: "market" | "competitors";
  actions: KitAction[];
}

export const KIT: KitDef[] = [
  {
    key: "idea_refinement",
    kind: "ai",
    profile: "research_analyst",
    department: "research",
    deps: [],
    prompt:
      "Refine the founder's idea into a sharp concept a beginner understands: a one-sentence pitch, the problem and who has it, the solution, why now, the unfair advantage, the riskiest assumptions (with a cheap test for each in the first 30 days) and what to cut from the first version.",
    actions: [],
  },
  {
    key: "market_research",
    kind: "ai",
    profile: "research_analyst",
    department: "research",
    deps: ["idea_refinement"],
    research: "market",
    prompt:
      "Research the market: definition, segments, size estimate (top-down and bottom-up, every number with its assumption), growth trends, buying behaviour, regulation and the specifics of the target countries.",
    actions: [],
  },
  {
    key: "competitor_research",
    kind: "ai",
    profile: "research_analyst",
    department: "research",
    deps: ["idea_refinement"],
    research: "competitors",
    prompt:
      "Map the competitors: direct competitors, indirect alternatives and substitutes in a comparison table (offer, target customer, pricing if public, strengths, weaknesses), then the gaps this business can win. Only name companies that appear in the sources or that you are certain exist; never invent a competitor or a price.",
    actions: [],
  },
  {
    key: "customer_personas",
    kind: "ai",
    profile: "marketing_strategist",
    department: "marketing",
    deps: ["idea_refinement"],
    prompt: "Write 3 or 4 customer personas (goals, pains, objections, where to reach them) and the ideal customer profile (ICP) in plain language: who they are, the problem, good-fit and bad-fit signs, and how to approach them.",
    schema: personasSchema,
    shape: `{"personas":[{"name":"Busy Clinic Owner","role":"...","summary":"...","goals":["..."],"pains":["..."],"objections":["..."],"channels":["..."]}],"icp":"plain-language ideal customer profile"}`,
    actions: ["save_icp"],
  },
  {
    key: "brand_positioning",
    kind: "ai",
    profile: "cmo",
    department: "marketing",
    deps: ["customer_personas", "competitor_research"],
    prompt: "Write the brand positioning: positioning statement, category, target customer, key benefit, differentiators, mission, vision, values, tagline options, tone of voice and visual direction (colours and style).",
    schema: positioningSchema,
    shape: `{"statement":"...","category":"...","targetCustomer":"...","keyBenefit":"...","differentiators":["..."],"mission":"...","vision":"...","values":["..."],"taglines":["..."],"visual":{"colors":["deep teal #0F766E"],"style":"..."}}`,
    actions: ["save_strategy"],
  },
  {
    key: "name_ideas",
    kind: "ai",
    profile: "cmo",
    department: "marketing",
    deps: ["brand_positioning"],
    prompt:
      "Propose 6 to 8 company names that fit the positioning: short, easy to spell and say, with a rationale each and one suggested domain. Avoid names of well-known brands. You cannot check whether a name or domain is available: say so and never claim availability.",
    schema: namesSchema,
    shape: `{"names":[{"name":"...","rationale":"...","domain":"example.com"}]}`,
    actions: ["use_name"],
  },
  {
    key: "logo",
    kind: "image",
    profile: "creative_designer",
    department: "marketing",
    deps: ["brand_positioning"],
    prompt: "",
    actions: ["pin_logo"],
  },
  {
    key: "business_model_canvas",
    kind: "ai",
    profile: "ai_ceo",
    department: "executive",
    deps: ["market_research", "competitor_research", "customer_personas"],
    prompt: "Fill in the Business Model Canvas for this business (all nine blocks, specific and short) and explain the 3 most important choices in it.",
    schema: canvasSchema,
    shape: `{"customerSegments":["..."],"valuePropositions":["..."],"channels":["..."],"customerRelationships":["..."],"revenueStreams":["..."],"keyResources":["..."],"keyActivities":["..."],"keyPartners":["..."],"costStructure":["..."]}`,
    actions: [],
  },
  {
    key: "revenue_model",
    kind: "ai",
    profile: "ai_cfo",
    department: "finance",
    deps: ["business_model_canvas"],
    prompt: "Design the revenue model: each revenue stream, how it is charged, its expected share of revenue in year one (as an assumption), unit economics (CAC, gross margin, payback — as labelled assumptions) and what has to be true for it to work.",
    schema: revenueSchema,
    shape: `{"streams":[{"name":"...","type":"subscription|one_time|usage|commission|advertising|licensing|services|other","description":"...","sharePercent":70}]}`,
    actions: [],
  },
  {
    key: "pricing",
    kind: "ai",
    profile: "ai_cfo",
    department: "finance",
    deps: ["revenue_model", "competitor_research"],
    prompt: "Recommend launch pricing in the company's base currency: 1 to 4 tiers or packages with price, billing interval, who each is for and what it includes, the reasoning (value, competitors, costs) and how to test the price in the first 60 days.",
    schema: pricingSchema,
    shape: `{"currency":"EUR","tiers":[{"name":"Starter","price":29,"interval":"month|year|one_time|usage","audience":"...","features":["..."]}],"rationale":"..."}`,
    actions: ["create_products"],
  },
  {
    key: "website_structure",
    kind: "ai",
    profile: "content_strategist",
    department: "marketing",
    deps: ["brand_positioning", "pricing"],
    prompt: "Design the website: the sitemap for launch (5 to 10 pages) and for every page its purpose and an outline of its sections with draft copy (headline and short body) in the brand's voice.",
    schema: websiteSchema,
    shape: `{"pages":[{"slug":"/","title":"Home","purpose":"...","sections":[{"heading":"...","content":"..."}]}]}`,
    actions: [],
  },
  {
    key: "marketing_strategy",
    kind: "ai",
    profile: "cmo",
    department: "marketing",
    deps: ["brand_positioning", "customer_personas"],
    prompt: "Write the marketing strategy for the first 90 days: goals and KPIs, channel mix with rationale, messaging per persona, content plan, budget split (assumptions) and 2 to 4 launch campaigns. Do not publish or schedule anything.",
    schema: marketingSchema,
    shape: `{"campaigns":[{"name":"...","objective":"...","description":"...","channels":[${CHANNELS.map((c) => `"${c}"`).join("|")}],"durationDays":30,"budget":500}]}`,
    actions: ["create_campaigns"],
  },
  {
    key: "sales_strategy",
    kind: "ai",
    profile: "sales_manager",
    department: "sales",
    deps: ["customer_personas", "pricing"],
    prompt: "Write the sales strategy: the ideal customer profile, how leads are found, the sales process and pipeline stages, outreach approach (respecting consent and opt-out), objection handling, and a step-by-step playbook for the first 20 customers. Do not contact anyone.",
    schema: salesSchema,
    shape: `{"icp":"plain-language ideal customer profile","stages":["Qualified","Demo","Proposal","Negotiation"],"playbook":[{"title":"...","description":"..."}]}`,
    actions: ["save_icp"],
  },
  {
    key: "financial_forecast",
    kind: "ai",
    profile: "ai_cfo",
    department: "finance",
    deps: ["pricing", "revenue_model"],
    prompt:
      "Build a 12-month financial projection driven by explicit assumptions (customers per month, conversion, price, churn, costs by category, hires): monthly revenue and total costs, cumulative cash from the starting cash, break-even month and the biggest risks. It is a projection, not a forecast of certain results: say so. Also propose department budgets.",
    schema: forecastSchema,
    shape: `{"currency":"EUR","startingCash":10000,"assumptions":[{"label":"New customers per month","value":"5, growing 15% monthly"}],"months":[{"month":1,"revenue":0,"costs":2500,"note":"..."}],"budgets":[{"name":"Marketing","months":6,"amount":3000}]}  (exactly 12 months)`,
    actions: ["create_budgets"],
  },
  {
    key: "business_plan",
    kind: "ai",
    profile: "ai_ceo",
    department: "executive",
    deps: ["business_model_canvas", "financial_forecast", "marketing_strategy"],
    prompt: "Write the business plan from the kit's deliverables: executive summary, problem, solution, market, competition, business model and pricing, go-to-market, operations, team (including the AI workforce), milestones, financial overview (from the projection, labelled as such) and funding needs.",
    actions: [],
  },
  {
    key: "launch_roadmap",
    kind: "ai",
    profile: "ai_ceo",
    department: "executive",
    deps: ["business_plan"],
    prompt: "Plan the launch roadmap for the next 90 days: 4 to 6 milestones (pre-launch, launch, first customers…) each with concrete tasks, priorities and due dates in days from today, and up to 3 measurable objectives.",
    schema: roadmapSchema,
    shape: `{"projectName":"Launch","milestones":[{"title":"...","description":"...","dueInDays":30,"tasks":[{"title":"...","description":"...","priority":"LOW|MEDIUM|HIGH|URGENT","dueInDays":7}]}],"objectives":[{"title":"...","description":"...","targetInDays":90}]}`,
    actions: ["create_project", "create_objectives"],
  },
  {
    key: "ai_workforce",
    kind: "ai",
    profile: "ai_ceo",
    department: "executive",
    deps: ["launch_roadmap"],
    prompt: "Propose the AI workforce that runs this company (3 to 8 AI employees): exactly one AI CEO (level EXECUTIVE, reportsTo null), managers reporting to the CEO and specialists reporting to a manager, each with responsibilities and the roadmap goals it owns.",
    schema: workforcePlanSchema,
    shape: `{"team":[{"key":"ceo","profile":"ai_ceo","name":"<a person-like name>","title":"Chief Executive","level":"EXECUTIVE","reportsTo":null,"responsibilities":["..."],"goals":["..."]}]}`,
    actions: ["use_workforce"],
  },
];

export const kitDef = (key: string): KitDef | undefined => KIT.find((d) => d.key === key);
