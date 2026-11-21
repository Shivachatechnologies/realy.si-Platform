/**
 * Organization designer — deterministic sizing (pure; no I/O, client-safe).
 *
 * From the founder's inputs (size preset, industry, business model, goals, workload, AI budget, revenue target) this
 * proposes departments, roles and reporting lines. Rules:
 *  - every role is justified by a driver (a goal, a workload figure, or span of control) and carries that reason;
 *  - the preset is an upper bound, never a quota: roles are not created just to reach a number;
 *  - management layers come from span of control (managers above SPAN specialists, executives for large departments);
 *  - the monthly AI budget (when given) trims the lowest-priority capacity first.
 */

export const SIZE_PRESETS = ["solo", "5", "10", "25", "50", "100", "250", "500", "1000", "custom"] as const;
export type SizePreset = (typeof SIZE_PRESETS)[number];
/** Upper bound of AI employees per preset ("1,000+" is bounded only by workload and MAX_HEADCOUNT). */
export const PRESET_CAP: Record<Exclude<SizePreset, "custom">, number> = { solo: 1, "5": 5, "10": 10, "25": 25, "50": 50, "100": 100, "250": 250, "500": 500, "1000": 5000 };
export const MAX_HEADCOUNT = 5000;

export const BUSINESS_MODELS = ["b2b_saas", "b2c_app", "marketplace", "agency", "ecommerce", "services", "other"] as const;
export type BusinessModel = (typeof BUSINESS_MODELS)[number];

export const DESIGN_GOALS = ["grow_revenue", "generate_leads", "brand_awareness", "customer_support", "launch_product", "operational_efficiency", "hire_team", "manage_finances", "fundraising", "expand_markets"] as const;
export type DesignGoal = (typeof DESIGN_GOALS)[number];

export const WORKLOAD_KEYS = ["leadsPerMonth", "openDeals", "ticketsPerMonth", "chatsPerMonth", "inboundCallsPerMonth", "outboundCallsPerMonth", "contentPerMonth", "socialPostsPerMonth", "invoicesPerMonth", "activeProjects", "hiresPerQuarter", "products", "integrations", "humanEmployees"] as const;
export type WorkloadKey = (typeof WORKLOAD_KEYS)[number];

export interface DesignInputs {
  preset: SizePreset;
  /** Only for preset "custom". */
  customHeadcount?: number | null;
  industry: string;
  businessModel: BusinessModel;
  goals: DesignGoal[];
  workload: Partial<Record<WorkloadKey, number>>;
  /** Monthly AI budget in USD cents; null = no budget constraint. */
  monthlyBudgetCents?: number | null;
  /** Monthly revenue target in whole currency units; used to estimate missing sales / support / finance workload. */
  monthlyRevenueTarget?: number | null;
}

export const DEPARTMENT_KEYS = ["executive", "sales", "marketing", "finance", "hr", "engineering", "product", "support", "operations", "research"] as const;
export type DesignDepartment = (typeof DEPARTMENT_KEYS)[number];
export type DesignLevel = "EXECUTIVE" | "MANAGER" | "SPECIALIST";

/** Why a role exists (rendered as workforce.designer.reasons.<code> with params). */
export interface RoleReason {
  code: "top" | "solo" | "goal" | "workload" | "estimated" | "span" | "department_head" | "coordination" | "ai";
  params?: Record<string, string | number>;
  /** AI refinement's own explanation (data, shown as a quote). */
  text?: string;
}

export interface DesignRole {
  /** Stable key within the design (idempotent provisioning), e.g. "sales.sdr.3". */
  key: string;
  profileKey: string;
  name: string;
  level: DesignLevel;
  department: DesignDepartment;
  reportsTo: string | null;
  reason: RoleReason;
  monthlyCostCents: number;
}

export interface DesignGroup {
  department: DesignDepartment;
  profileKey: string;
  level: DesignLevel;
  count: number;
  reason: RoleReason;
  monthlyCostCents: number;
}

export interface DesignProposal {
  version: 1;
  cap: number;
  total: number;
  /** Roles the workload justified before the cap / budget trimmed them. */
  demand: number;
  monthlyCostCents: number;
  departments: { key: DesignDepartment; headcount: number; monthlyCostCents: number; executive: string | null }[];
  groups: DesignGroup[];
  /** Ordered: executives, then managers, then specialists (provisioning order). */
  roles: DesignRole[];
  /** Workload the designer estimated (not given by the founder). */
  assumptions: { key: WorkloadKey; value: number; basis: "revenue_target" }[];
  notes: ("below_preset" | "trimmed_to_preset" | "trimmed_for_budget" | "no_drivers" | "solo")[];
  costPerTaskMicros: number;
}

/** Span of control: a manager per this many specialists; a department head above this many people. */
export const SPAN = 7;
const DEPT_HEAD_AT = 4;

/** Tasks per month an AI employee typically runs, by level (for the budget estimate). */
export const TASKS_PER_MONTH: Record<DesignLevel, number> = { EXECUTIVE: 60, MANAGER: 90, SPECIALIST: 120 };

interface SpecialistRule {
  profileKey: string;
  /** Workload driver and capacity per AI employee per month (quarter for hires). */
  driver?: WorkloadKey;
  capacity?: number;
  /** Goals that justify one of these on their own. */
  goals?: DesignGoal[];
  /** Business models where the goal rule applies (default: all). */
  models?: BusinessModel[];
  /** Lower = more important (trimmed last). */
  priority: number;
}

interface DepartmentRule {
  key: DesignDepartment;
  head: string;
  manager: string;
  specialists: SpecialistRule[];
}

export const DEPARTMENT_RULES: DepartmentRule[] = [
  {
    key: "sales",
    head: "ai_cro",
    manager: "sales_manager",
    specialists: [
      { profileKey: "sdr", driver: "leadsPerMonth", capacity: 300, goals: ["generate_leads", "grow_revenue"], models: ["b2b_saas", "agency", "services", "other"], priority: 1 },
      { profileKey: "account_executive", driver: "openDeals", capacity: 25, goals: ["grow_revenue"], models: ["b2b_saas", "agency", "services", "marketplace", "other"], priority: 1 },
      { profileKey: "voice_caller", driver: "outboundCallsPerMonth", capacity: 600, priority: 3 },
      { profileKey: "sales_researcher", goals: ["expand_markets"], models: ["b2b_saas", "agency", "services"], priority: 4 },
    ],
  },
  {
    key: "marketing",
    head: "cmo",
    manager: "growth_manager",
    specialists: [
      { profileKey: "content_writer", driver: "contentPerMonth", capacity: 25, goals: ["brand_awareness", "generate_leads"], priority: 2 },
      { profileKey: "social_media_manager", driver: "socialPostsPerMonth", capacity: 60, goals: ["brand_awareness"], priority: 3 },
      { profileKey: "seo_specialist", goals: ["generate_leads"], models: ["b2b_saas", "b2c_app", "ecommerce", "marketplace", "services"], priority: 3 },
      { profileKey: "paid_ads_specialist", goals: ["grow_revenue"], models: ["b2c_app", "ecommerce", "marketplace"], priority: 3 },
      { profileKey: "marketing_analyst", goals: ["expand_markets"], priority: 4 },
    ],
  },
  {
    key: "support",
    head: "cs_director",
    manager: "support_lead",
    specialists: [
      { profileKey: "support_agent", driver: "ticketsPerMonth", capacity: 500, goals: ["customer_support"], priority: 1 },
      { profileKey: "website_chat_agent", driver: "chatsPerMonth", capacity: 1500, priority: 2 },
      { profileKey: "voice_receptionist", driver: "inboundCallsPerMonth", capacity: 800, priority: 2 },
    ],
  },
  {
    key: "finance",
    head: "ai_cfo",
    manager: "ai_cfo",
    specialists: [{ profileKey: "bookkeeper", driver: "invoicesPerMonth", capacity: 400, goals: ["manage_finances", "fundraising"], priority: 2 }],
  },
  {
    key: "operations",
    head: "ai_coo",
    manager: "operations_manager",
    specialists: [
      { profileKey: "ai_project_manager", driver: "activeProjects", capacity: 6, goals: ["operational_efficiency"], models: ["agency", "services"], priority: 2 },
      { profileKey: "automation_architect", goals: ["operational_efficiency"], priority: 3 },
    ],
  },
  {
    key: "hr",
    head: "ai_chro",
    manager: "hr_manager",
    specialists: [
      { profileKey: "recruiter", driver: "hiresPerQuarter", capacity: 8, goals: ["hire_team"], priority: 2 },
      { profileKey: "hr_policy_assistant", driver: "humanEmployees", capacity: 150, priority: 4 },
    ],
  },
  {
    key: "product",
    head: "product_director",
    manager: "product_director",
    specialists: [{ profileKey: "product_manager", driver: "products", capacity: 2, goals: ["launch_product"], models: ["b2b_saas", "b2c_app", "marketplace"], priority: 2 }],
  },
  {
    key: "engineering",
    head: "ai_cto",
    manager: "ai_cto",
    specialists: [{ profileKey: "integrations_engineer", driver: "integrations", capacity: 12, goals: ["operational_efficiency"], models: ["b2b_saas", "marketplace"], priority: 3 }],
  },
  {
    key: "research",
    head: "research_analyst",
    manager: "research_analyst",
    specialists: [
      { profileKey: "research_analyst", goals: ["expand_markets", "fundraising"], priority: 4 },
      { profileKey: "bi_analyst", goals: ["fundraising", "operational_efficiency"], priority: 4 },
    ],
  },
];

/** English display names for provisioned employees (stored data; the UI shows translated role names next to them). */
export const ROLE_NAMES: Record<string, string> = {
  ai_ceo: "AI CEO",
  ai_coo: "AI COO",
  ai_cto: "AI CTO",
  ai_cfo: "AI CFO",
  cmo: "AI CMO",
  ai_cro: "AI CRO",
  ai_chro: "AI CHRO",
  cs_director: "AI Customer Success Director",
  product_director: "AI Product Director",
  sales_manager: "AI Sales Manager",
  growth_manager: "AI Growth Manager",
  support_lead: "AI Support Lead",
  operations_manager: "AI Operations Manager",
  hr_manager: "AI HR Manager",
  sdr: "AI SDR",
  account_executive: "AI Account Executive",
  voice_caller: "AI Voice Caller",
  sales_researcher: "AI Sales Researcher",
  content_writer: "AI Content Writer",
  social_media_manager: "AI Social Media Manager",
  seo_specialist: "AI SEO Specialist",
  paid_ads_specialist: "AI Paid Ads Specialist",
  marketing_analyst: "AI Marketing Analyst",
  support_agent: "AI Support Agent",
  website_chat_agent: "AI Website Chat Agent",
  voice_receptionist: "AI Voice Receptionist",
  bookkeeper: "AI Bookkeeper",
  ai_project_manager: "AI Project Manager",
  automation_architect: "AI Automation Architect",
  recruiter: "AI Recruiter",
  hr_policy_assistant: "AI HR Policy Assistant",
  product_manager: "AI Product Manager",
  integrations_engineer: "AI Integrations Engineer",
  research_analyst: "AI Research Analyst",
  bi_analyst: "AI BI Analyst",
};

/** Profiles the designer (and the AI refinement) may use. */
export const DESIGN_PROFILE_KEYS = Object.keys(ROLE_NAMES);

/** Average won-deal value (currency units) and lead → won rate per business model: only to estimate missing workload. */
const MODEL_ECONOMICS: Record<BusinessModel, { deal: number; winRate: number; ticketsPerDeal: number; invoicesPerDeal: number; outbound: boolean }> = {
  b2b_saas: { deal: 5000, winRate: 0.05, ticketsPerDeal: 2, invoicesPerDeal: 1, outbound: true },
  b2c_app: { deal: 60, winRate: 0.02, ticketsPerDeal: 0.15, invoicesPerDeal: 0, outbound: false },
  marketplace: { deal: 200, winRate: 0.03, ticketsPerDeal: 0.3, invoicesPerDeal: 0, outbound: false },
  agency: { deal: 8000, winRate: 0.1, ticketsPerDeal: 1, invoicesPerDeal: 1, outbound: true },
  ecommerce: { deal: 70, winRate: 0.02, ticketsPerDeal: 0.1, invoicesPerDeal: 0, outbound: false },
  services: { deal: 3000, winRate: 0.08, ticketsPerDeal: 1, invoicesPerDeal: 1, outbound: true },
  other: { deal: 1000, winRate: 0.05, ticketsPerDeal: 0.5, invoicesPerDeal: 0.5, outbound: true },
};

export const capOf = (inputs: Pick<DesignInputs, "preset" | "customHeadcount">) =>
  inputs.preset === "custom" ? Math.max(1, Math.min(MAX_HEADCOUNT, Math.round(inputs.customHeadcount ?? 1))) : PRESET_CAP[inputs.preset];

/** Missing workload estimated from the revenue target (never from the preset). */
export function estimateWorkload(inputs: DesignInputs): { workload: Partial<Record<WorkloadKey, number>>; assumptions: DesignProposal["assumptions"] } {
  const w = { ...inputs.workload };
  const assumptions: DesignProposal["assumptions"] = [];
  const target = inputs.monthlyRevenueTarget ?? 0;
  if (target > 0) {
    const e = MODEL_ECONOMICS[inputs.businessModel];
    const deals = Math.ceil(target / e.deal);
    const put = (key: WorkloadKey, value: number) => {
      if (w[key] == null && value > 0) {
        w[key] = Math.round(value);
        assumptions.push({ key, value: Math.round(value), basis: "revenue_target" });
      }
    };
    put("leadsPerMonth", deals / e.winRate);
    if (e.outbound) put("openDeals", deals * 3);
    put("ticketsPerMonth", deals * e.ticketsPerDeal * 3);
    put("invoicesPerMonth", deals * e.invoicesPerDeal * 3);
  }
  return { workload: w, assumptions };
}

interface Demand {
  department: DesignDepartment;
  profileKey: string;
  count: number;
  priority: number;
  reason: RoleReason;
}

/** Specialist demand per rule: workload ÷ capacity, else 1 when a selected goal needs the role. */
function specialistDemand(inputs: DesignInputs, workload: Partial<Record<WorkloadKey, number>>, estimated: Set<WorkloadKey>): Demand[] {
  const out: Demand[] = [];
  const goals = new Set(inputs.goals);
  for (const d of DEPARTMENT_RULES) {
    for (const r of d.specialists) {
      const volume = r.driver ? (workload[r.driver] ?? 0) : 0;
      if (r.driver && r.capacity && volume > 0) {
        const count = Math.ceil(volume / r.capacity);
        out.push({ department: d.key, profileKey: r.profileKey, count, priority: r.priority, reason: { code: estimated.has(r.driver) ? "estimated" : "workload", params: { driver: r.driver, volume, capacity: r.capacity } } });
        continue;
      }
      const goal = (r.goals ?? []).find((g) => goals.has(g));
      if (goal && (!r.models || r.models.includes(inputs.businessModel))) out.push({ department: d.key, profileKey: r.profileKey, count: 1, priority: r.priority + 1, reason: { code: "goal", params: { goal } } });
    }
  }
  return out;
}

const RANK: Record<DesignLevel, number> = { EXECUTIVE: 0, MANAGER: 1, SPECIALIST: 2 };

/** Estimated monthly cost of one AI employee at a level (USD cents). */
export const roleCostCents = (level: DesignLevel, costPerTaskMicros: number) => Math.round((TASKS_PER_MONTH[level] * costPerTaskMicros) / 10_000);

/** Build the org (roles + reporting lines) from specialist counts. */
function build(demand: Demand[], opts: { costPerTaskMicros: number; heads: boolean; managers: boolean; aiReasons?: Map<string, string> }) {
  const roles: DesignRole[] = [];
  const cost = (l: DesignLevel) => roleCostCents(l, opts.costPerTaskMicros);
  const ceo: DesignRole = { key: "executive.ai_ceo", profileKey: "ai_ceo", name: ROLE_NAMES.ai_ceo!, level: "EXECUTIVE", department: "executive", reportsTo: null, reason: { code: "top" }, monthlyCostCents: cost("EXECUTIVE") };
  roles.push(ceo);
  const byDept = new Map<DesignDepartment, Demand[]>();
  for (const d of demand) if (d.count > 0) byDept.set(d.department, [...(byDept.get(d.department) ?? []), d]);
  const heads: DesignRole[] = [];
  const managers: DesignRole[] = [];
  const specialists: DesignRole[] = [];
  for (const rule of DEPARTMENT_RULES) {
    const list = byDept.get(rule.key);
    if (!list) continue;
    const s = list.reduce((a, d) => a + d.count, 0);
    const managerCount = opts.managers && s >= 3 ? Math.ceil(s / SPAN) : 0;
    const needsHead = opts.heads && s + managerCount >= DEPT_HEAD_AT && (managerCount > 1 || rule.head !== rule.manager);
    let head: DesignRole | null = null;
    if (needsHead) {
      head = { key: `${rule.key}.head`, profileKey: rule.head, name: ROLE_NAMES[rule.head] ?? rule.head, level: "EXECUTIVE", department: rule.key, reportsTo: ceo.key, reason: { code: "department_head", params: { people: s + managerCount } }, monthlyCostCents: cost("EXECUTIVE") };
      heads.push(head);
    }
    // Span of control applies to managers too: above SPAN managers, senior managers sit between them and the head.
    const seniorCount = managerCount > SPAN ? Math.ceil(managerCount / SPAN) : 0;
    const leadProfile = head && rule.manager === rule.head ? (list[0]!.profileKey ?? rule.manager) : rule.manager;
    const seniors: DesignRole[] = [];
    for (let i = 0; i < seniorCount; i++) {
      seniors.push({
        key: `${rule.key}.senior.${i + 1}`,
        profileKey: leadProfile,
        name: `${ROLE_NAMES[leadProfile] ?? leadProfile} (senior)${seniorCount > 1 ? ` ${i + 1}` : ""}`,
        level: "MANAGER",
        department: rule.key,
        reportsTo: head?.key ?? ceo.key,
        reason: { code: "span", params: { specialists: managerCount, span: SPAN } },
        monthlyCostCents: cost("MANAGER"),
      });
    }
    managers.push(...seniors);
    const mgrs: DesignRole[] = [];
    for (let i = 0; i < managerCount; i++) {
      const profileKey = leadProfile;
      mgrs.push({
        key: `${rule.key}.manager.${i + 1}`,
        profileKey,
        name: `${ROLE_NAMES[profileKey] ?? profileKey}${managerCount > 1 ? ` ${i + 1}` : ""}${head && rule.manager === rule.head ? " (team lead)" : ""}`,
        level: "MANAGER",
        department: rule.key,
        reportsTo: seniors.length ? seniors[i % seniors.length]!.key : (head?.key ?? ceo.key),
        reason: { code: "span", params: { specialists: s, span: SPAN } },
        monthlyCostCents: cost("MANAGER"),
      });
    }
    managers.push(...mgrs);
    let slot = 0;
    for (const d of list) {
      for (let i = 0; i < d.count; i++) {
        const manager = mgrs.length ? mgrs[slot++ % mgrs.length]! : null;
        const ai = opts.aiReasons?.get(d.profileKey);
        specialists.push({
          key: `${rule.key}.${d.profileKey}.${i + 1}`,
          profileKey: d.profileKey,
          name: `${ROLE_NAMES[d.profileKey] ?? d.profileKey}${d.count > 1 ? ` ${i + 1}` : ""}`,
          level: "SPECIALIST",
          department: rule.key,
          reportsTo: manager?.key ?? head?.key ?? ceo.key,
          reason: ai ? { ...d.reason, text: ai } : d.reason,
          monthlyCostCents: cost("SPECIALIST"),
        });
      }
    }
  }
  // Many department heads → a COO coordinates operations-style departments (when operations has no head yet).
  if (heads.length >= 5 && !heads.some((h) => h.profileKey === "ai_coo")) {
    const coo: DesignRole = { key: "operations.head", profileKey: "ai_coo", name: ROLE_NAMES.ai_coo!, level: "EXECUTIVE", department: "operations", reportsTo: ceo.key, reason: { code: "coordination", params: { heads: heads.length } }, monthlyCostCents: cost("EXECUTIVE") };
    for (const h of heads) if (h.department === "hr" || h.department === "finance" || h.department === "research") h.reportsTo = coo.key;
    // Before the heads it coordinates (managers-first provisioning order).
    heads.unshift(coo);
  }
  roles.push(...heads, ...managers, ...specialists);
  return roles;
}

/** The deterministic proposal. `overrides` (AI refinement) replaces specialist counts per profile; reasons are kept. */
export function designOrganization(inputs: DesignInputs, opts: { costPerTaskMicros: number; overrides?: Map<string, { count: number; reason?: string }> }): DesignProposal {
  const cap = capOf(inputs);
  const { workload, assumptions } = estimateWorkload(inputs);
  const estimated = new Set(assumptions.map((a) => a.key));
  let demand = specialistDemand(inputs, workload, estimated);
  const aiReasons = new Map<string, string>();
  if (opts.overrides) {
    for (const [profileKey, o] of opts.overrides) {
      const existing = demand.find((d) => d.profileKey === profileKey);
      const rule = DEPARTMENT_RULES.find((r) => r.specialists.some((s) => s.profileKey === profileKey));
      if (o.reason) aiReasons.set(profileKey, o.reason.slice(0, 300));
      if (existing) existing.count = Math.max(0, Math.round(o.count));
      else if (rule && o.count > 0 && o.reason) demand.push({ department: rule.key, profileKey, count: Math.round(o.count), priority: 5, reason: { code: "ai" } });
    }
    demand = demand.filter((d) => d.count > 0);
  }
  const notes: DesignProposal["notes"] = [];
  const optsBuild = { costPerTaskMicros: opts.costPerTaskMicros, heads: true, managers: true, aiReasons };
  let roles = build(demand, optsBuild);
  const demandTotal = roles.length;
  if (cap === 1) {
    roles = roles.slice(0, 1);
    roles[0]!.reason = { code: "solo" };
    notes.push("solo");
  } else {
    const budget = inputs.monthlyBudgetCents ?? null;
    const total = () => roles.reduce((a, r) => a + r.monthlyCostCents, 0);
    let trimmedCap = false;
    let trimmedBudget = false;
    for (let guard = 0; guard < 20_000; guard++) {
      const overCap = roles.length > cap;
      const overBudget = budget !== null && total() > budget && roles.length > 1;
      if (!overCap && !overBudget) break;
      if (overCap) trimmedCap = true;
      else trimmedBudget = true;
      // Small caps: flatten the hierarchy first (department heads, then managers).
      if (optsBuild.heads && roles.some((r) => r.key.endsWith(".head")) && cap < 25) optsBuild.heads = false;
      else if (optsBuild.managers && roles.some((r) => r.level === "MANAGER") && cap < 10) optsBuild.managers = false;
      else {
        const biggest = [...demand].sort((a, b) => b.count - a.count || b.priority - a.priority)[0];
        // Large excess: shrink in bigger steps (keeps 1,000+ designs fast); the last steps go one by one.
        const excess = overCap ? roles.length - cap : Math.ceil((total() - budget!) / Math.max(1, roleCostCents("SPECIALIST", opts.costPerTaskMicros)));
        if (biggest && biggest.count > 1) biggest.count -= Math.max(1, Math.min(biggest.count - 1, Math.floor(excess / 2)));
        else {
          const drop = [...demand].sort((a, b) => b.priority - a.priority)[0];
          if (!drop) break;
          demand = demand.filter((d) => d !== drop);
        }
      }
      roles = build(demand, optsBuild);
    }
    if (trimmedCap) notes.push("trimmed_to_preset");
    if (trimmedBudget) notes.push("trimmed_for_budget");
  }
  if (!demand.length && cap > 1) notes.push("no_drivers");
  else if (roles.length < cap && cap > 1 && inputs.preset !== "1000" && !notes.includes("trimmed_to_preset")) notes.push("below_preset");
  roles.sort((a, b) => RANK[a.level] - RANK[b.level]);
  // Reports must come after their managers: heads → managers → specialists already holds; COO is a head.
  const groupsMap = new Map<string, DesignGroup>();
  for (const r of roles) {
    const k = `${r.department}|${r.profileKey}|${r.level}`;
    const g = groupsMap.get(k) ?? { department: r.department, profileKey: r.profileKey, level: r.level, count: 0, reason: r.reason, monthlyCostCents: 0 };
    g.count++;
    g.monthlyCostCents += r.monthlyCostCents;
    groupsMap.set(k, g);
  }
  const deptMap = new Map<DesignDepartment, DesignProposal["departments"][number]>();
  for (const r of roles) {
    const d = deptMap.get(r.department) ?? { key: r.department, headcount: 0, monthlyCostCents: 0, executive: null };
    d.headcount++;
    d.monthlyCostCents += r.monthlyCostCents;
    if (r.level === "EXECUTIVE" && !d.executive) d.executive = r.key;
    deptMap.set(r.department, d);
  }
  return {
    version: 1,
    cap,
    total: roles.length,
    demand: demandTotal,
    monthlyCostCents: roles.reduce((a, r) => a + r.monthlyCostCents, 0),
    departments: DEPARTMENT_KEYS.flatMap((k) => (deptMap.has(k) ? [deptMap.get(k)!] : [])),
    groups: [...groupsMap.values()].sort((a, b) => DEPARTMENT_KEYS.indexOf(a.department) - DEPARTMENT_KEYS.indexOf(b.department) || RANK[a.level] - RANK[b.level]),
    roles,
    assumptions,
    notes,
    costPerTaskMicros: opts.costPerTaskMicros,
  };
}
