import type { ListingCategory, ListingType, ManifestInput } from "./manifest";

/**
 * Built-in marketplace catalog, published by Realy. Merged with organization-published listings from the database
 * (service.ts) so the marketplace is useful on day one. Names and summaries are localized under
 * marketplace.catalog.<slug>.{name,summary}; the structures they install are company data (stay as written).
 */

export const BUILTIN_PUBLISHER = {
  slug: "realy",
  name: "Realy",
  description: "Templates, blueprints and AI employees maintained by the Realy team.",
  website: "https://realy.si",
  verified: true,
} as const;

export interface BuiltinVersion {
  version: string;
  releasedAt: string;
  changelog: string;
  manifest: ManifestInput;
}

export interface BuiltinListing {
  slug: string;
  type: ListingType;
  category: ListingCategory;
  tags: string[];
  /** Fallback English copy (UI uses marketplace.catalog.<slug>.*). */
  name: string;
  summary: string;
  versions: BuiltinVersion[];
  createdAt: string;
}

// ───────────── Building blocks ─────────────

type Dept = NonNullable<ManifestInput["departments"]>[number];
type Proj = NonNullable<ManifestInput["projects"]>[number];
type Obj = NonNullable<ManifestInput["objectives"]>[number];
type Role = NonNullable<ManifestInput["roles"]>[number];
type Flow = NonNullable<ManifestInput["workflows"]>[number];
type Emp = NonNullable<ManifestInput["aiEmployees"]>[number];

const D: Record<string, Dept> = {
  leadership: {
    name: "Leadership",
    description: "Company direction, strategy and governance.",
    teams: [{ name: "Executive Team" }],
  },
  sales: {
    name: "Sales",
    description: "Pipeline generation and closing revenue.",
    teams: [{ name: "Business Development" }, { name: "Account Executives" }],
  },
  marketing: {
    name: "Marketing",
    description: "Brand, demand generation and content.",
    teams: [{ name: "Growth" }, { name: "Content & Brand" }],
  },
  engineering: {
    name: "Engineering",
    description: "Builds and operates the product.",
    teams: [{ name: "Platform" }, { name: "Product Engineering" }, { name: "Quality" }],
  },
  product: {
    name: "Product",
    description: "Discovery, roadmap and product decisions.",
    teams: [{ name: "Product Management" }, { name: "Design" }],
  },
  support: {
    name: "Customer Success",
    description: "Onboarding, support and retention.",
    teams: [{ name: "Support" }, { name: "Onboarding" }],
  },
  finance: {
    name: "Finance",
    description: "Accounting, billing, planning and reporting.",
    teams: [{ name: "Accounting" }, { name: "FP&A" }],
  },
  people: {
    name: "People",
    description: "Hiring, onboarding and employee experience.",
    teams: [{ name: "Talent Acquisition" }, { name: "People Operations" }],
  },
  operations: {
    name: "Operations",
    description: "Processes, vendors and internal tooling.",
    teams: [{ name: "Business Operations" }],
  },
  legal: {
    name: "Legal & Compliance",
    description: "Contracts, policies and regulatory compliance.",
    teams: [{ name: "Legal" }, { name: "Compliance" }],
  },
  research: {
    name: "Research",
    description: "Applied research and model development.",
    teams: [{ name: "Applied ML" }, { name: "Data" }],
  },
  delivery: {
    name: "Client Delivery",
    description: "Delivers client projects on time and on budget.",
    teams: [{ name: "Project Management" }, { name: "Creative" }, { name: "Strategy" }],
  },
  risk: {
    name: "Risk",
    description: "Fraud, credit and operational risk.",
    teams: [{ name: "Fraud Prevention" }, { name: "Risk Analytics" }],
  },
  security: {
    name: "Security",
    description: "Information security and incident response.",
    teams: [{ name: "Security Engineering" }],
  },
  merchandising: {
    name: "Merchandising",
    description: "Catalog, pricing and assortment.",
    teams: [{ name: "Catalog" }, { name: "Pricing" }],
  },
  fulfillment: {
    name: "Fulfillment",
    description: "Inventory, warehousing and shipping.",
    teams: [{ name: "Inventory" }, { name: "Logistics" }],
  },
  consulting: {
    name: "Consulting",
    description: "Advisory engagements and practice areas.",
    teams: [{ name: "Strategy Practice" }, { name: "Transformation Practice" }],
  },
  protocol: {
    name: "Protocol",
    description: "Smart contracts, nodes and protocol upgrades.",
    teams: [{ name: "Smart Contracts" }, { name: "Infrastructure" }],
  },
  community: {
    name: "Community",
    description: "Developer relations and ecosystem growth.",
    teams: [{ name: "Developer Relations" }, { name: "Ecosystem" }],
  },
};

const R = {
  salesManager: {
    key: "sales-manager",
    name: "Sales manager",
    description: "Manages the pipeline and sales team.",
    permissions: ["companies.read", "sales.read", "sales.manage", "analytics.read", "projects.read"],
  },
  marketingManager: {
    key: "marketing-manager",
    name: "Marketing manager",
    description: "Runs campaigns and content.",
    permissions: ["companies.read", "marketing.read", "marketing.manage", "analytics.read", "projects.read"],
  },
  engineeringLead: {
    key: "engineering-lead",
    name: "Engineering lead",
    description: "Leads delivery of the product.",
    permissions: ["companies.read", "projects.read", "projects.manage", "workflows.read", "integrations.read"],
  },
  supportLead: {
    key: "support-lead",
    name: "Support lead",
    description: "Leads customer support.",
    permissions: ["companies.read", "support.read", "support.manage", "communication.read"],
  },
  financeManager: {
    key: "finance-manager",
    name: "Finance manager",
    description: "Owns accounting and reporting.",
    permissions: ["companies.read", "finance.read", "finance.manage", "analytics.read"],
  },
  peopleManager: {
    key: "people-manager",
    name: "People manager",
    description: "Owns hiring and people operations.",
    permissions: ["companies.read", "hr.read", "hr.manage"],
  },
  opsManager: {
    key: "operations-manager",
    name: "Operations manager",
    description: "Owns processes and vendors.",
    permissions: ["companies.read", "operations.read", "operations.manage", "projects.read", "projects.manage"],
  },
  complianceOfficer: {
    key: "compliance-officer",
    name: "Compliance officer",
    description: "Reviews audit trails and policies.",
    permissions: ["companies.read", "audit.read", "finance.read", "brain.read"],
  },
  deliveryLead: {
    key: "delivery-lead",
    name: "Delivery lead",
    description: "Runs client projects.",
    permissions: ["companies.read", "projects.read", "projects.manage", "objectives.read", "objectives.manage"],
  },
} satisfies Record<string, Role>;

const F = {
  leadFollowUp: {
    key: "lead-follow-up",
    name: "New lead follow-up",
    trigger: "lead.created",
    description: "Assign an owner and schedule a follow-up within one business day.",
  },
  dealWon: {
    key: "deal-won-handoff",
    name: "Closed-won handoff",
    trigger: "deal.won",
    description: "Create an onboarding project and notify Customer Success.",
  },
  invoiceOverdue: {
    key: "invoice-overdue",
    name: "Overdue invoice reminder",
    trigger: "invoice.overdue",
    description: "Remind the customer and alert Finance.",
  },
  ticketEscalation: {
    key: "ticket-escalation",
    name: "Urgent ticket escalation",
    trigger: "ticket.created",
    description: "Escalate urgent tickets to the support lead.",
  },
  employeeJoined: {
    key: "employee-onboarding",
    name: "Employee onboarding",
    trigger: "employee.joined",
    description: "Create onboarding tasks for the new hire and their manager.",
  },
  candidateApplied: {
    key: "candidate-screening",
    name: "Candidate screening",
    trigger: "candidate.applied",
    description: "Acknowledge the application and queue a screening task.",
  },
  contentPublished: {
    key: "content-distribution",
    name: "Content distribution",
    trigger: "content.published",
    description: "Share new content to social channels and the newsletter.",
  },
  weeklyReport: {
    key: "weekly-report",
    name: "Weekly business report",
    trigger: "schedule.tick",
    description: "Compile KPIs every Monday and post them to leadership.",
  },
} satisfies Record<string, Flow>;

const E = {
  research: {
    profile: "research_analyst",
    name: "Research Analyst",
    description: "Market and competitor briefs grounded in company documents.",
  },
  product: {
    profile: "product_manager",
    name: "Product Manager",
    description: "PRDs, specs and roadmap drafts.",
  },
  marketing: {
    profile: "marketing_strategist",
    name: "Marketing Strategist",
    description: "Positioning, campaigns and content drafts.",
  },
  sales: {
    profile: "sales_researcher",
    name: "Sales Researcher",
    description: "Account briefs and outreach drafts.",
  },
  ops: {
    profile: "operations_assistant",
    name: "Operations Assistant",
    description: "Project plans, checklists and status summaries.",
  },
} satisfies Record<string, Emp>;

const PIPE = {
  b2b: {
    name: "B2B sales",
    stages: ["Lead", "Qualified", "Demo", "Proposal", "Negotiation", "Won", "Lost"],
  },
  agency: {
    name: "New business",
    stages: ["Inquiry", "Discovery call", "Proposal", "Pitch", "Signed", "Lost"],
  },
  partnerships: {
    name: "Partnerships",
    stages: ["Identified", "Intro", "Evaluation", "Agreement", "Live"],
  },
};

const P = {
  launch: {
    name: "Product launch",
    tasks: [
      {
        title: "Define launch goals and success metrics",
        priority: "HIGH",
        dueInDays: 7,
      },
      {
        title: "Write positioning and messaging",
        priority: "HIGH",
        dueInDays: 14,
      },
      { title: "Prepare launch assets (site, email, social)", dueInDays: 21 },
      { title: "Brief sales and support", dueInDays: 25 },
      {
        title: "Launch and monitor first-week metrics",
        priority: "URGENT",
        dueInDays: 30,
      },
    ],
  },
  gtm: {
    name: "Go-to-market setup",
    tasks: [
      {
        title: "Define ideal customer profile",
        priority: "HIGH",
        dueInDays: 7,
      },
      { title: "Build target account list", dueInDays: 14 },
      { title: "Create outbound sequences", dueInDays: 21 },
      { title: "Set up CRM pipeline stages", dueInDays: 10 },
    ],
  },
  mvp: {
    name: "MVP build",
    tasks: [
      { title: "Write product requirements", priority: "HIGH", dueInDays: 7 },
      { title: "Design core user flows", dueInDays: 14 },
      { title: "Set up CI/CD and environments", dueInDays: 10 },
      { title: "Implement core features", priority: "HIGH", dueInDays: 45 },
      { title: "Run beta with design partners", dueInDays: 60 },
    ],
  },
  hiring: {
    name: "First hires",
    tasks: [
      {
        title: "Define the hiring plan for the next two quarters",
        priority: "HIGH",
        dueInDays: 7,
      },
      { title: "Write job descriptions", dueInDays: 14 },
      { title: "Set up interview process and scorecards", dueInDays: 21 },
    ],
  },
  finance: {
    name: "Finance foundations",
    tasks: [
      {
        title: "Open business bank account and set up accounting",
        priority: "HIGH",
        dueInDays: 7,
      },
      { title: "Define chart of accounts", dueInDays: 14 },
      { title: "Set up invoicing and payment collection", dueInDays: 21 },
      { title: "Build a 12-month budget", dueInDays: 30 },
    ],
  },
  compliance: {
    name: "Compliance program",
    tasks: [
      {
        title: "Map applicable regulations and licenses",
        priority: "URGENT",
        dueInDays: 14,
      },
      { title: "Draft KYC/AML policy", priority: "HIGH", dueInDays: 30 },
      { title: "Appoint compliance officer", dueInDays: 21 },
      { title: "Schedule first internal audit", dueInDays: 90 },
    ],
  },
  security: {
    name: "Security baseline",
    tasks: [
      {
        title: "Enforce two-factor authentication for all members",
        priority: "HIGH",
        dueInDays: 7,
      },
      { title: "Inventory systems and data", dueInDays: 14 },
      { title: "Write incident response plan", dueInDays: 30 },
      { title: "Run third-party penetration test", dueInDays: 90 },
    ],
  },
  clientOnboarding: {
    name: "Client onboarding playbook",
    tasks: [
      { title: "Create kickoff deck template", dueInDays: 7 },
      {
        title: "Define statement-of-work template",
        priority: "HIGH",
        dueInDays: 10,
      },
      { title: "Set up client reporting cadence", dueInDays: 14 },
    ],
  },
  store: {
    name: "Store launch",
    tasks: [
      {
        title: "Finalize product catalog and pricing",
        priority: "HIGH",
        dueInDays: 14,
      },
      {
        title: "Configure payments, shipping and taxes",
        priority: "HIGH",
        dueInDays: 21,
      },
      { title: "Write return and refund policy", dueInDays: 14 },
      { title: "Launch email capture and welcome flow", dueInDays: 28 },
    ],
  },
  model: {
    name: "Model development",
    tasks: [
      {
        title: "Define evaluation benchmarks",
        priority: "HIGH",
        dueInDays: 14,
      },
      { title: "Assemble and document training data", dueInDays: 30 },
      { title: "Train baseline model", dueInDays: 45 },
      { title: "Red-team and safety review", priority: "HIGH", dueInDays: 60 },
    ],
  },
  practice: {
    name: "Practice development",
    tasks: [
      {
        title: "Define service offerings and rate card",
        priority: "HIGH",
        dueInDays: 10,
      },
      { title: "Publish two case studies", dueInDays: 30 },
      { title: "Build proposal library", dueInDays: 21 },
    ],
  },
  mainnet: {
    name: "Mainnet readiness",
    tasks: [
      {
        title: "Complete smart contract audit",
        priority: "URGENT",
        dueInDays: 45,
      },
      { title: "Launch bug bounty", priority: "HIGH", dueInDays: 50 },
      { title: "Publish token and governance documentation", dueInDays: 30 },
      { title: "Run testnet incentive program", dueInDays: 60 },
    ],
  },
} satisfies Record<string, Proj>;

const O = {
  revenue: {
    title: "Reach first $100k ARR",
    description: "Prove repeatable revenue.",
    targetInDays: 180,
    milestones: [
      {
        title: "First 5 paying customers",
        dueInDays: 60,
        project: "Go-to-market setup",
      },
      { title: "$50k ARR", dueInDays: 120 },
      { title: "$100k ARR", dueInDays: 180 },
    ],
  },
  launch: {
    title: "Launch the product publicly",
    targetInDays: 90,
    milestones: [
      {
        title: "Beta with design partners",
        dueInDays: 60,
        project: "MVP build",
      },
      { title: "Public launch", dueInDays: 90, project: "Product launch" },
    ],
  },
  team: {
    title: "Build the founding team",
    targetInDays: 120,
    milestones: [
      { title: "Hiring plan approved", dueInDays: 14, project: "First hires" },
      { title: "First three hires onboarded", dueInDays: 120 },
    ],
  },
  compliance: {
    title: "Be licensed and audit-ready",
    targetInDays: 180,
    milestones: [
      {
        title: "Regulatory map complete",
        dueInDays: 14,
        project: "Compliance program",
      },
      { title: "Policies approved", dueInDays: 45 },
      { title: "First internal audit passed", dueInDays: 180 },
    ],
  },
  clients: {
    title: "Sign 10 retainer clients",
    targetInDays: 180,
    milestones: [
      { title: "Rate card and offers published", dueInDays: 14 },
      { title: "5 retainers signed", dueInDays: 90 },
      { title: "10 retainers signed", dueInDays: 180 },
    ],
  },
  gmv: {
    title: "Reach $250k GMV",
    targetInDays: 180,
    milestones: [
      { title: "Store live", dueInDays: 30, project: "Store launch" },
      { title: "First 1,000 orders", dueInDays: 120 },
      { title: "$250k GMV", dueInDays: 180 },
    ],
  },
  model: {
    title: "Ship the first production model",
    targetInDays: 120,
    milestones: [
      {
        title: "Benchmarks defined",
        dueInDays: 14,
        project: "Model development",
      },
      { title: "Baseline beats benchmark", dueInDays: 60 },
      { title: "Model in production", dueInDays: 120 },
    ],
  },
  mainnet: {
    title: "Launch mainnet securely",
    targetInDays: 120,
    milestones: [
      { title: "Audit complete", dueInDays: 45, project: "Mainnet readiness" },
      { title: "Testnet program complete", dueInDays: 90 },
      { title: "Mainnet live", dueInDays: 120 },
    ],
  },
} satisfies Record<string, Obj>;

const BLUEPRINT_CONFIG: ManifestInput["config"] = ["workspaceId", "startDate", "fiscalYearStartMonth", "confirmCurrency", "includeRoles", "includeProjects", "includeObjectives"];

/** v1.0.0 = structure + projects; v1.1.0 adds objectives, roles, workflows, AI employees and pipelines. */
function blueprint(slug: string, name: string, summary: string, tags: string[], full: ManifestInput, createdAt: string): BuiltinListing {
  const base: ManifestInput = {
    departments: full.departments,
    projects: full.projects,
    settings: full.settings,
    config: ["workspaceId", "startDate", "fiscalYearStartMonth", "confirmCurrency", "includeProjects"],
  };
  return {
    slug,
    type: "INDUSTRY_BLUEPRINT",
    category: "industry",
    tags,
    name,
    summary,
    createdAt,
    versions: [
      {
        version: "1.0.0",
        releasedAt: createdAt,
        changelog: "Initial release: departments, teams and starter projects.",
        manifest: base,
      },
      {
        version: "1.1.0",
        releasedAt: "2026-09-15",
        changelog: "Adds objectives with milestones, custom roles, workflows, AI employees and a sales pipeline.",
        manifest: { ...full, config: BLUEPRINT_CONFIG },
      },
    ],
  };
}

function single(
  slug: string,
  type: ListingType,
  category: ListingCategory,
  name: string,
  summary: string,
  tags: string[],
  manifest: ManifestInput,
  createdAt = "2026-06-01",
): BuiltinListing {
  return {
    slug,
    type,
    category,
    tags,
    name,
    summary,
    createdAt,
    versions: [
      {
        version: "1.0.0",
        releasedAt: createdAt,
        changelog: "Initial release.",
        manifest,
      },
    ],
  };
}

function department(slug: string, name: string, summary: string, dept: Dept, extra: ManifestInput): BuiltinListing {
  return single(
    slug,
    "DEPARTMENT_TEMPLATE",
    "operations",
    name,
    summary,
    ["department"],
    {
      departments: [dept],
      ...extra,
      config: ["workspaceId", "startDate", "includeRoles", "includeProjects"],
    },
    "2026-07-01",
  );
}

export const BUILTIN_LISTINGS: BuiltinListing[] = [
  blueprint(
    "saas-company",
    "SaaS company",
    "A complete operating structure for a B2B SaaS business.",
    ["saas", "b2b", "subscription"],
    {
      departments: [D.leadership!, D.product!, D.engineering!, D.sales!, D.marketing!, D.support!, D.finance!, D.people!],
      roles: [R.salesManager, R.marketingManager, R.engineeringLead, R.supportLead, R.financeManager],
      projects: [P.mvp, P.gtm, P.launch, P.finance],
      objectives: [O.launch, O.revenue],
      workflows: [F.leadFollowUp, F.dealWon, F.invoiceOverdue, F.ticketEscalation, F.weeklyReport],
      aiEmployees: [E.product, E.sales, E.marketing, E.research],
      pipelines: [PIPE.b2b],
      settings: { fiscalYearStartMonth: 1 },
    },
    "2026-06-01",
  ),
  blueprint(
    "ai-startup",
    "AI startup",
    "Research, product and go-to-market for an AI-first company.",
    ["ai", "startup", "research"],
    {
      departments: [D.leadership!, D.research!, D.engineering!, D.product!, D.sales!, D.security!, D.people!],
      roles: [R.engineeringLead, R.salesManager, R.peopleManager],
      projects: [P.model, P.mvp, P.security, P.hiring],
      objectives: [O.model, O.team],
      workflows: [F.leadFollowUp, F.candidateApplied, F.weeklyReport],
      aiEmployees: [E.research, E.product, E.ops],
      pipelines: [PIPE.b2b, PIPE.partnerships],
      settings: { fiscalYearStartMonth: 1 },
    },
    "2026-06-01",
  ),
  blueprint(
    "agency",
    "Agency",
    "Client delivery, new business and creative teams for a services agency.",
    ["agency", "services", "clients"],
    {
      departments: [D.leadership!, D.delivery!, D.sales!, D.marketing!, D.finance!, D.people!],
      roles: [R.deliveryLead, R.salesManager, R.financeManager],
      projects: [P.clientOnboarding, P.practice, P.finance],
      objectives: [O.clients],
      workflows: [F.leadFollowUp, F.dealWon, F.invoiceOverdue],
      aiEmployees: [E.marketing, E.sales, E.ops],
      pipelines: [PIPE.agency],
      settings: { fiscalYearStartMonth: 1 },
    },
    "2026-06-10",
  ),
  blueprint(
    "fintech",
    "Fintech",
    "Regulated financial product with risk, compliance and security built in.",
    ["fintech", "compliance", "payments"],
    {
      departments: [D.leadership!, D.product!, D.engineering!, D.risk!, D.legal!, D.security!, D.finance!, D.support!],
      roles: [R.complianceOfficer, R.engineeringLead, R.financeManager, R.supportLead],
      projects: [P.compliance, P.security, P.mvp, P.finance],
      objectives: [O.compliance, O.launch],
      workflows: [F.ticketEscalation, F.invoiceOverdue, F.weeklyReport],
      aiEmployees: [E.research, E.ops],
      pipelines: [PIPE.partnerships],
      settings: { fiscalYearStartMonth: 1 },
    },
    "2026-06-10",
  ),
  blueprint(
    "ecommerce",
    "E-commerce brand",
    "Merchandising, fulfillment, marketing and support for an online store.",
    ["ecommerce", "retail", "d2c"],
    {
      departments: [D.leadership!, D.merchandising!, D.marketing!, D.fulfillment!, D.support!, D.finance!],
      roles: [R.marketingManager, R.opsManager, R.supportLead],
      projects: [P.store, P.launch, P.finance],
      objectives: [O.gmv],
      workflows: [F.contentPublished, F.ticketEscalation, F.weeklyReport],
      aiEmployees: [E.marketing, E.ops],
      pipelines: [PIPE.partnerships],
      settings: { fiscalYearStartMonth: 2 },
    },
    "2026-06-20",
  ),
  blueprint(
    "consultancy",
    "Consultancy",
    "Practice areas, engagements and business development for a consulting firm.",
    ["consulting", "advisory", "services"],
    {
      departments: [D.leadership!, D.consulting!, D.sales!, D.operations!, D.finance!, D.people!],
      roles: [R.deliveryLead, R.salesManager, R.opsManager],
      projects: [P.practice, P.clientOnboarding, P.hiring],
      objectives: [O.clients, O.team],
      workflows: [F.leadFollowUp, F.dealWon, F.invoiceOverdue, F.weeklyReport],
      aiEmployees: [E.research, E.sales, E.ops],
      pipelines: [PIPE.agency],
      settings: { fiscalYearStartMonth: 4 },
    },
    "2026-06-20",
  ),
  blueprint(
    "blockchain-company",
    "Blockchain company",
    "Protocol engineering, security, community and compliance for a web3 company.",
    ["blockchain", "web3", "protocol"],
    {
      departments: [D.leadership!, D.protocol!, D.security!, D.community!, D.legal!, D.finance!],
      roles: [R.engineeringLead, R.complianceOfficer, R.financeManager],
      projects: [P.mainnet, P.security, P.compliance],
      objectives: [O.mainnet, O.compliance],
      workflows: [F.contentPublished, F.weeklyReport],
      aiEmployees: [E.research, E.marketing],
      pipelines: [PIPE.partnerships],
      settings: { fiscalYearStartMonth: 1 },
    },
    "2026-07-01",
  ),

  single("lean-startup", "COMPANY_TEMPLATE", "operations", "Lean startup", "A minimal structure for a founding team: leadership, product and growth.", ["startup", "founders"], {
    departments: [D.leadership!, D.product!, D.marketing!],
    projects: [P.mvp, P.hiring, P.finance],
    objectives: [O.launch, O.team],
    workflows: [F.weeklyReport],
    aiEmployees: [E.product, E.research],
    config: ["workspaceId", "startDate", "fiscalYearStartMonth", "includeProjects", "includeObjectives"],
  }),
  single("remote-first", "COMPANY_TEMPLATE", "people", "Remote-first company", "People operations, async rituals and security for distributed teams.", ["remote", "people"], {
    departments: [D.leadership!, D.people!, D.operations!, D.security!],
    roles: [R.peopleManager, R.opsManager],
    projects: [
      P.hiring,
      P.security,
      {
        name: "Async operating rhythm",
        tasks: [
          {
            title: "Write communication guidelines",
            priority: "HIGH",
            dueInDays: 7,
          },
          { title: "Set up weekly written updates", dueInDays: 10 },
          { title: "Define meeting-free focus days", dueInDays: 14 },
        ],
      },
    ],
    workflows: [F.employeeJoined, F.weeklyReport],
    config: ["workspaceId", "startDate", "includeRoles", "includeProjects"],
  }),

  department("sales-department", "Sales department", "Sales teams, a B2B pipeline, a sales manager role and go-to-market project.", D.sales!, {
    roles: [R.salesManager],
    projects: [P.gtm],
    workflows: [F.leadFollowUp, F.dealWon],
    pipelines: [PIPE.b2b],
    aiEmployees: [E.sales],
  }),
  department("marketing-department", "Marketing department", "Growth and content teams with a launch project and content distribution.", D.marketing!, {
    roles: [R.marketingManager],
    projects: [P.launch],
    workflows: [F.contentPublished],
    aiEmployees: [E.marketing],
  }),
  department("engineering-department", "Engineering department", "Platform, product and quality teams with an MVP and security baseline.", D.engineering!, {
    roles: [R.engineeringLead],
    projects: [P.mvp, P.security],
  }),
  department("support-department", "Customer success department", "Support and onboarding teams with escalation workflow.", D.support!, {
    roles: [R.supportLead],
    projects: [
      {
        name: "Support foundations",
        tasks: [
          { title: "Define support SLAs", priority: "HIGH", dueInDays: 7 },
          { title: "Write top 20 help center articles", dueInDays: 21 },
          { title: "Set up escalation path", dueInDays: 10 },
        ],
      },
    ],
    workflows: [F.ticketEscalation],
  }),
  department("finance-department", "Finance department", "Accounting and FP&A teams with finance foundations and overdue invoice reminders.", D.finance!, {
    roles: [R.financeManager],
    projects: [P.finance],
    workflows: [F.invoiceOverdue],
  }),
  department("people-department", "People department", "Talent acquisition and people operations with onboarding workflows.", D.people!, {
    roles: [R.peopleManager],
    projects: [P.hiring],
    workflows: [F.employeeJoined, F.candidateApplied],
  }),

  single(
    "ai-sdr",
    "AI_EMPLOYEE",
    "sales",
    "AI sales development rep",
    "Researches accounts and drafts outreach for your pipeline; sends nothing without approval.",
    ["sales", "outbound"],
    { aiEmployees: [E.sales], workflows: [F.leadFollowUp] },
  ),
  single(
    "ai-marketing-strategist",
    "AI_EMPLOYEE",
    "marketing",
    "AI marketing strategist",
    "Positioning, campaign plans and content drafts grounded in your documents.",
    ["marketing", "content"],
    { aiEmployees: [E.marketing] },
  ),
  single(
    "ai-product-manager",
    "AI_EMPLOYEE",
    "engineering",
    "AI product manager",
    "PRDs, specifications and roadmap proposals from your products and customers.",
    ["product", "roadmap"],
    { aiEmployees: [E.product] },
  ),
  single(
    "ai-operations-assistant",
    "AI_EMPLOYEE",
    "operations",
    "AI operations assistant",
    "Project plans, checklists and status summaries for your teams.",
    ["operations", "projects"],
    { aiEmployees: [E.ops] },
  ),

  single("market-research-agent", "AI_AGENT", "data", "Market research agent", "Produces cited market and competitor briefs on demand.", ["research", "competitors"], {
    aiEmployees: [E.research],
    skills: [
      {
        key: "competitor-brief",
        name: "Competitor brief",
        description: "Structured competitor comparison.",
      },
    ],
  }),
  single(
    "weekly-briefing-agent",
    "AI_AGENT",
    "productivity",
    "Weekly briefing agent",
    "Compiles a weekly business briefing from your objectives and KPIs.",
    ["reporting", "executive"],
    { aiEmployees: [E.ops], workflows: [F.weeklyReport] },
  ),

  single("meeting-notes-skill", "SKILL", "productivity", "Meeting notes", "Turns meeting transcripts into decisions, owners and action items.", ["meetings", "notes"], {
    skills: [
      {
        key: "meeting-notes",
        name: "Meeting notes",
        description: "Summaries with decisions and action items.",
      },
    ],
  }),
  single("contract-review-skill", "SKILL", "operations", "Contract review", "Highlights risky clauses and missing terms in contracts for human review.", ["legal", "contracts"], {
    skills: [
      {
        key: "contract-review",
        name: "Contract review",
        description: "Clause-by-clause risk notes.",
      },
    ],
  }),
  single("seo-audit-skill", "SKILL", "marketing", "SEO audit", "Audits pages for search best practices and proposes fixes.", ["seo", "marketing"], {
    skills: [
      {
        key: "seo-audit",
        name: "SEO audit",
        description: "On-page SEO checklist and recommendations.",
      },
    ],
  }),

  single("lead-follow-up-workflow", "WORKFLOW", "sales", "Lead follow-up", "Assigns new leads and schedules a follow-up within one business day.", ["sales", "automation"], {
    workflows: [F.leadFollowUp],
  }),
  single("invoice-reminders-workflow", "WORKFLOW", "finance", "Invoice reminders", "Reminds customers about overdue invoices and alerts Finance.", ["finance", "collections"], {
    workflows: [F.invoiceOverdue],
  }),
  single("employee-onboarding-workflow", "WORKFLOW", "people", "Employee onboarding", "Creates onboarding tasks for every new hire and their manager.", ["hr", "onboarding"], {
    workflows: [F.employeeJoined],
  }),

  single("slack-integration", "INTEGRATION", "productivity", "Slack", "Post notifications, approvals and briefings to Slack channels.", ["chat", "notifications"], {
    integrations: [
      {
        provider: "slack",
        name: "Slack",
        description: "Channels and direct messages.",
      },
    ],
  }),
  single(
    "google-workspace-integration",
    "INTEGRATION",
    "productivity",
    "Google Workspace",
    "Calendar, Gmail and Drive for meetings, email and documents.",
    ["email", "calendar", "documents"],
    {
      integrations: [
        {
          provider: "google",
          name: "Google Workspace",
          description: "Gmail, Calendar and Drive.",
        },
      ],
    },
  ),
  single("stripe-integration", "INTEGRATION", "finance", "Stripe", "Sync payments, invoices and customers from Stripe.", ["payments", "billing"], {
    integrations: [
      {
        provider: "stripe",
        name: "Stripe",
        description: "Payments and invoices.",
      },
    ],
  }),
  single("hubspot-integration", "INTEGRATION", "sales", "HubSpot", "Two-way sync of contacts, companies and deals with HubSpot.", ["crm", "sales"], {
    integrations: [
      {
        provider: "hubspot",
        name: "HubSpot",
        description: "Contacts, companies and deals.",
      },
    ],
  }),
];

export const builtinKey = (slug: string) => `${BUILTIN_PUBLISHER.slug}/${slug}`;
