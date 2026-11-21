/**
 * AI Guide page-context registry: what every app page is, why it matters, what you can do there, the typical next
 * steps, which AI employee profile and read tools fit it, and its guided steps. Pure data (no server imports), so it
 * can be used on the server and in client components. All human text lives in i18n under `guide.pages.<key>.*`
 * (title, what, why, can, steps.<stepKey>) and `guide.questions.<key>.*`.
 *
 * Pages need no code of their own: the guide resolves the current URL path against `pattern`, falling back to the
 * closest parent route.
 */

/** Real-state counters the guide can read (implemented in ./state.ts, each behind the module's read permission). */
export const METRIC_KEYS = [
  "leads",
  "deals",
  "openDeals",
  "contacts",
  "customers",
  "salesTargets",
  "proposals",
  "invoices",
  "overdueInvoices",
  "expenses",
  "bills",
  "employees",
  "departments",
  "openJobs",
  "candidates",
  "policies",
  "pendingLeave",
  "projects",
  "openTasks",
  "productFeatures",
  "productIdeas",
  "products",
  "opsProcesses",
  "campaigns",
  "content",
  "brandKit",
  "openTickets",
  "kbArticles",
  "workflows",
  "activeWorkflows",
  "aiEmployees",
  "agentTasks",
  "brainDocs",
  "graphEntities",
  "objectives",
  "companyGoals",
  "milestones",
  "strategy",
  "approvalsPending",
  "connections",
  "announcements",
  "channels",
  "meetings",
  "dashboards",
  "reports",
  "installs",
  "members",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/** Department identity (accent colour + icon in the guide UI). */
export type GuideModule =
  | "core"
  | "ai"
  | "analytics"
  | "knowledge"
  | "company"
  | "sales"
  | "marketing"
  | "support"
  | "projects"
  | "product"
  | "operations"
  | "finance"
  | "hr"
  | "communication"
  | "automation"
  | "platform";

/** Essential questions the "do this for me" conversation may ask (labels: guide.questions.<key>.label / .example). */
export const QUESTIONS = {
  goal: { type: "text" },
  audience: { type: "text" },
  topic: { type: "text" },
  who: { type: "text" },
  amount: { type: "text" },
  role: { type: "text" },
  process: { type: "text" },
  tone: { type: "choice", options: ["friendly", "professional", "bold"], recommended: "professional" },
  deadline: { type: "choice", options: ["thisWeek", "thisMonth", "thisQuarter"], recommended: "thisMonth" },
  count: { type: "choice", options: ["3", "5", "10"], recommended: "5" },
  priority: { type: "choice", options: ["low", "medium", "high"], recommended: "medium" },
  details: { type: "text", optional: true },
} as const satisfies Record<string, { type: "text" | "choice"; options?: readonly string[]; recommended?: string; optional?: boolean }>;
export type QuestionKey = keyof typeof QUESTIONS;

export interface GuideStep {
  key: string;
  /** Where the step is done (path after /{locale}). */
  href?: string;
  /** CSS selector of the control to highlight when the person is on `href` ("Show me"). */
  selector?: string;
  /** Done automatically when the company's real count satisfies this (otherwise the person marks it done). */
  done?: { metric: MetricKey; min?: number; max?: number };
  /** The AI can do this step: the essential questions it asks first. */
  ai?: { questions: QuestionKey[] };
}

export interface GuidePage {
  /** Stable key (camelCase; i18n guide.pages.<key>). */
  key: string;
  /** Route after /{locale}; "[param]" matches one record id (UUID) segment. "" is the Command Center. */
  pattern: string;
  module: GuideModule;
  /** AI employee profile that answers and acts for this page (falls back to research_analyst when not installed). */
  profile: string;
  /** The read tools relevant here (named to the AI in its instructions). */
  tools: string[];
  /** Counters shown as facts and used by steps. */
  metrics: MetricKey[];
  steps: GuideStep[];
  /** Typical next pages (paths after /{locale}). */
  next: string[];
  /** Detail pages: the route param holding the record id and the AI-task subject type of that record. */
  subject?: { param: string; type: string };
}

const S = (key: string, href?: string, extra: Omit<GuideStep, "key" | "href"> = {}): GuideStep => ({ key, href, ...extra });
const HEAD = "main h1";
const FORM = "main form";
const TABLE = "main table, main [role='table'], main ul";

export const GUIDE_PAGES: GuidePage[] = [
  {
    key: "commandCenter",
    pattern: "",
    module: "core",
    profile: "ai_ceo",
    tools: ["read_company_kpis", "read_department_summary", "read_open_issues", "read_objectives"],
    metrics: ["approvalsPending", "objectives", "aiEmployees", "leads"],
    steps: [
      S("goal", "/objectives", { done: { metric: "objectives", min: 1 }, selector: FORM }),
      S("knowledge", "/brain", { done: { metric: "brainDocs", min: 1 } }),
      S("hire", "/workforce/hire", { done: { metric: "aiEmployees", min: 1 } }),
    ],
    next: ["/objectives", "/workforce", "/approvals"],
  },
  {
    key: "builder",
    pattern: "/builder",
    module: "ai",
    profile: "ai_ceo",
    tools: ["read_company_graph", "read_objectives", "search_company_brain"],
    metrics: ["brainDocs", "objectives"],
    steps: [S("describe", "/builder", { selector: FORM }), S("review", "/builder"), S("apply", "/builder")],
    next: ["/company", "/workforce", "/objectives"],
  },
  {
    key: "intelligence",
    pattern: "/intelligence",
    module: "ai",
    profile: "ai_ceo",
    tools: ["read_company_kpis", "read_open_issues", "read_department_summary"],
    metrics: ["approvalsPending", "agentTasks"],
    steps: [S("read", "/intelligence", { selector: HEAD }), S("issues", "/intelligence"), S("act", "/approvals", { done: { metric: "approvalsPending", max: 0 } })],
    next: ["/analytics", "/approvals", "/objectives"],
  },
  {
    key: "analytics",
    pattern: "/analytics",
    module: "analytics",
    profile: "bi_analyst",
    tools: ["read_company_kpis", "read_metric_series", "read_department_summary"],
    metrics: ["dashboards", "reports"],
    steps: [
      S("kpis", "/analytics", { selector: HEAD }),
      S("dashboard", "/analytics/dashboards", { done: { metric: "dashboards", min: 1 }, ai: { questions: ["goal", "details"] } }),
      S("report", "/analytics/reports", { done: { metric: "reports", min: 1 } }),
    ],
    next: ["/analytics/dashboards", "/analytics/reports", "/intelligence"],
  },
  {
    key: "objectives",
    pattern: "/objectives",
    module: "core",
    profile: "ai_ceo",
    tools: ["read_objectives", "read_company_kpis"],
    metrics: ["objectives", "companyGoals", "milestones"],
    steps: [
      S("create", "/objectives", { done: { metric: "objectives", min: 1 }, selector: FORM, ai: { questions: ["goal", "deadline"] } }),
      S("goals", "/objectives/goals", { done: { metric: "companyGoals", min: 1 } }),
      S("milestones", "/plans", { done: { metric: "milestones", min: 1 } }),
    ],
    next: ["/objectives/goals", "/plans", "/projects"],
  },
  {
    key: "tasks",
    pattern: "/tasks",
    module: "ai",
    profile: "research_analyst",
    tools: ["read_ai_employees", "read_task_result"],
    metrics: ["agentTasks", "aiEmployees"],
    steps: [S("assign", "/tasks", { done: { metric: "agentTasks", min: 1 }, selector: FORM }), S("review", "/tasks", { selector: TABLE }), S("approve", "/approvals", { done: { metric: "approvalsPending", max: 0 } })],
    next: ["/workforce", "/approvals"],
  },
  {
    key: "taskDetail",
    pattern: "/tasks/[taskId]",
    module: "ai",
    profile: "research_analyst",
    tools: ["read_task_result"],
    metrics: ["approvalsPending"],
    steps: [S("readResult", undefined, { selector: HEAD }), S("approve", "/approvals", { done: { metric: "approvalsPending", max: 0 } })],
    next: ["/tasks", "/approvals"],
  },
  {
    key: "workforce",
    pattern: "/workforce",
    module: "ai",
    profile: "ai_ceo",
    tools: ["read_ai_employees", "read_task_result"],
    metrics: ["aiEmployees", "agentTasks"],
    steps: [
      S("hire", "/workforce/hire", { done: { metric: "aiEmployees", min: 1 } }),
      S("assign", "/tasks", { done: { metric: "agentTasks", min: 1 } }),
      S("usage", "/workforce/usage"),
    ],
    next: ["/workforce/hire", "/tasks", "/approvals"],
  },
  {
    key: "workforceHire",
    pattern: "/workforce/hire",
    module: "ai",
    profile: "ai_ceo",
    tools: ["read_ai_employees"],
    metrics: ["aiEmployees"],
    steps: [S("pick", "/workforce/hire", { selector: TABLE }), S("hire", "/workforce/hire", { done: { metric: "aiEmployees", min: 1 } }), S("assign", "/tasks", { done: { metric: "agentTasks", min: 1 } })],
    next: ["/workforce", "/tasks"],
  },
  {
    key: "plans",
    pattern: "/plans",
    module: "core",
    profile: "operations_assistant",
    tools: ["read_objectives", "read_projects"],
    metrics: ["milestones", "objectives"],
    steps: [S("milestone", "/plans", { done: { metric: "milestones", min: 1 }, selector: FORM, ai: { questions: ["goal", "deadline"] } }), S("link", "/objectives"), S("projects", "/projects", { done: { metric: "projects", min: 1 } })],
    next: ["/objectives", "/projects"],
  },
  {
    key: "activity",
    pattern: "/activity",
    module: "core",
    profile: "chief_of_staff",
    tools: ["read_announcements", "read_open_issues"],
    metrics: ["approvalsPending"],
    steps: [S("review", "/activity", { selector: TABLE }), S("approvals", "/approvals", { done: { metric: "approvalsPending", max: 0 } })],
    next: ["/approvals", "/intelligence"],
  },
  {
    key: "approvals",
    pattern: "/approvals",
    module: "core",
    profile: "ai_ceo",
    tools: ["read_task_result", "read_open_issues"],
    metrics: ["approvalsPending"],
    steps: [S("review", "/approvals", { selector: TABLE }), S("decide", "/approvals", { done: { metric: "approvalsPending", max: 0 } })],
    next: ["/tasks", "/activity"],
  },
  {
    key: "company",
    pattern: "/company",
    module: "company",
    profile: "research_analyst",
    tools: ["read_company_graph", "search_company_brain", "read_objectives"],
    metrics: ["strategy", "brainDocs", "graphEntities"],
    steps: [S("profile", "/company", { selector: FORM }), S("strategy", "/company/strategy", { done: { metric: "strategy", min: 1 }, ai: { questions: ["goal", "audience"] } }), S("knowledge", "/brain", { done: { metric: "brainDocs", min: 1 } })],
    next: ["/company/strategy", "/organization", "/brain"],
  },
  {
    key: "organization",
    pattern: "/organization",
    module: "company",
    profile: "org_admin_assistant",
    tools: ["read_org_structure", "read_headcount_summary"],
    metrics: ["departments", "employees"],
    steps: [S("departments", "/organization", { done: { metric: "departments", min: 1 } }), S("people", "/hr/employees", { done: { metric: "employees", min: 1 } }), S("chart", "/organization/chart")],
    next: ["/organization/chart", "/hr/employees", "/settings/members"],
  },
  {
    key: "graph",
    pattern: "/graph",
    module: "knowledge",
    profile: "research_analyst",
    tools: ["read_company_graph"],
    metrics: ["graphEntities"],
    steps: [S("add", "/graph", { done: { metric: "graphEntities", min: 1 }, selector: FORM }), S("connect", "/graph"), S("explore", "/graph")],
    next: ["/brain", "/products", "/customers"],
  },
  {
    key: "brain",
    pattern: "/brain",
    module: "knowledge",
    profile: "knowledge_manager",
    tools: ["search_company_brain", "read_company_memory"],
    metrics: ["brainDocs"],
    steps: [S("upload", "/brain", { done: { metric: "brainDocs", min: 1 }, selector: FORM }), S("ask", "/brain/ask"), S("memory", "/brain/memory")],
    next: ["/brain/ask", "/brain/memory", "/documents"],
  },
  {
    key: "documents",
    pattern: "/documents",
    module: "knowledge",
    profile: "knowledge_manager",
    tools: ["search_company_brain"],
    metrics: ["brainDocs"],
    steps: [S("upload", "/brain", { done: { metric: "brainDocs", min: 1 } }), S("ask", "/brain/ask")],
    next: ["/brain", "/brain/ask"],
  },
  {
    key: "products",
    pattern: "/products",
    module: "company",
    profile: "product_manager",
    tools: ["read_company_graph", "search_company_brain"],
    metrics: ["products"],
    steps: [S("add", "/products", { done: { metric: "products", min: 1 }, selector: FORM }), S("describe", "/brain"), S("roadmap", "/product")],
    next: ["/product", "/marketing", "/sales"],
  },
  {
    key: "customers",
    pattern: "/customers",
    module: "sales",
    profile: "account_executive",
    tools: ["read_contacts", "read_account", "read_company_graph"],
    metrics: ["customers", "contacts"],
    steps: [S("add", "/crm/accounts", { done: { metric: "customers", min: 1 } }), S("contacts", "/crm/contacts", { done: { metric: "contacts", min: 1 } }), S("support", "/support")],
    next: ["/crm/accounts", "/crm/contacts", "/support"],
  },
  {
    key: "marketing",
    pattern: "/marketing",
    module: "marketing",
    profile: "cmo",
    tools: ["read_campaigns", "read_marketing_kpis", "read_brand_kit", "read_content_library"],
    metrics: ["campaigns", "content", "brandKit"],
    steps: [
      S("brand", "/marketing/brand", { done: { metric: "brandKit", min: 1 } }),
      S("campaign", "/marketing/campaigns", { done: { metric: "campaigns", min: 1 }, ai: { questions: ["goal", "audience", "deadline"] } }),
      S("content", "/marketing/content", { done: { metric: "content", min: 1 }, ai: { questions: ["topic", "audience", "tone"] } }),
    ],
    next: ["/marketing/campaigns", "/marketing/content", "/marketing/social"],
  },
  {
    key: "marketingCampaigns",
    pattern: "/marketing/campaigns",
    module: "marketing",
    profile: "campaign_strategist",
    tools: ["read_campaigns", "read_marketing_kpis", "read_brand_kit"],
    metrics: ["campaigns"],
    steps: [S("create", "/marketing/campaigns", { done: { metric: "campaigns", min: 1 }, selector: FORM, ai: { questions: ["goal", "audience", "deadline"] } }), S("content", "/marketing/content"), S("launch", "/marketing/campaigns")],
    next: ["/marketing/content", "/marketing/email", "/marketing/social"],
  },
  {
    key: "marketingCampaign",
    pattern: "/marketing/campaigns/[campaignId]",
    module: "marketing",
    profile: "campaign_strategist",
    tools: ["read_campaign", "read_marketing_kpis"],
    metrics: ["content"],
    steps: [S("plan", undefined, { selector: HEAD, ai: { questions: ["goal", "details"] } }), S("content", "/marketing/content", { ai: { questions: ["topic", "tone"] } }), S("measure", "/marketing")],
    next: ["/marketing/content", "/marketing/campaigns"],
  },
  {
    key: "marketingContent",
    pattern: "/marketing/content",
    module: "marketing",
    profile: "content_writer",
    tools: ["read_content_library", "read_brand_kit"],
    metrics: ["content", "brandKit"],
    steps: [S("brand", "/marketing/brand", { done: { metric: "brandKit", min: 1 } }), S("write", "/marketing/content", { done: { metric: "content", min: 1 }, selector: FORM, ai: { questions: ["topic", "audience", "tone"] } }), S("schedule", "/marketing/content/calendar")],
    next: ["/marketing/content/calendar", "/marketing/social"],
  },
  {
    key: "sales",
    pattern: "/sales",
    module: "sales",
    profile: "sales_manager",
    tools: ["read_pipeline_summary", "read_deals"],
    metrics: ["openDeals", "salesTargets", "leads"],
    steps: [S("targets", "/sales/targets", { done: { metric: "salesTargets", min: 1 } }), S("pipeline", "/crm/pipeline", { done: { metric: "deals", min: 1 } }), S("team", "/sales/team")],
    next: ["/crm/pipeline", "/sales/targets", "/sales/reports"],
  },
  {
    key: "crm",
    pattern: "/crm",
    module: "sales",
    profile: "sdr",
    tools: ["read_leads", "read_pipeline_summary", "read_contacts"],
    metrics: ["leads", "deals", "contacts"],
    steps: [
      S("lead", "/crm", { done: { metric: "leads", min: 1 }, selector: FORM, ai: { questions: ["audience", "count"] } }),
      S("qualify", "/crm", { selector: TABLE }),
      S("deal", "/crm/deals", { done: { metric: "deals", min: 1 } }),
    ],
    next: ["/crm/deals", "/crm/pipeline", "/crm/contacts"],
  },
  {
    key: "crmLead",
    pattern: "/crm/[leadId]",
    module: "sales",
    profile: "sdr",
    tools: ["read_lead", "read_leads"],
    metrics: ["deals"],
    subject: { param: "leadId", type: "lead" },
    steps: [S("research", undefined, { selector: HEAD, ai: { questions: ["details"] } }), S("followUp", undefined, { ai: { questions: ["tone", "details"] } }), S("convert", "/crm/deals")],
    next: ["/crm", "/crm/deals"],
  },
  {
    key: "crmDeals",
    pattern: "/crm/deals",
    module: "sales",
    profile: "account_executive",
    tools: ["read_deals", "read_pipeline_summary"],
    metrics: ["deals", "openDeals"],
    steps: [S("create", "/crm/deals", { done: { metric: "deals", min: 1 }, selector: FORM }), S("pipeline", "/crm/pipeline"), S("proposal", "/crm/proposals", { done: { metric: "proposals", min: 1 } })],
    next: ["/crm/pipeline", "/crm/proposals"],
  },
  {
    key: "crmDeal",
    pattern: "/crm/deals/[dealId]",
    module: "sales",
    profile: "account_executive",
    tools: ["read_deal", "read_proposals"],
    metrics: ["proposals"],
    subject: { param: "dealId", type: "crm_deal" },
    steps: [S("review", undefined, { selector: HEAD }), S("proposal", undefined, { ai: { questions: ["amount", "details"] } }), S("followUp", undefined, { ai: { questions: ["deadline", "details"] } })],
    next: ["/crm/pipeline", "/crm/proposals", "/finance/invoices/new"],
  },
  {
    key: "crmAccount",
    pattern: "/crm/accounts/[accountId]",
    module: "sales",
    profile: "account_executive",
    tools: ["read_account", "read_contacts", "read_deals"],
    metrics: ["contacts"],
    subject: { param: "accountId", type: "account" },
    steps: [S("brief", undefined, { selector: HEAD, ai: { questions: ["details"] } }), S("contacts", "/crm/contacts"), S("deal", "/crm/deals")],
    next: ["/crm/deals", "/crm/contacts"],
  },
  {
    key: "support",
    pattern: "/support",
    module: "support",
    profile: "support_lead",
    tools: ["read_support_queue", "search_kb_articles"],
    metrics: ["openTickets", "kbArticles"],
    steps: [
      S("queue", "/support", { done: { metric: "openTickets", max: 0 }, selector: TABLE }),
      S("knowledge", "/support/knowledge", { done: { metric: "kbArticles", min: 1 }, ai: { questions: ["topic", "audience"] } }),
      S("settings", "/support/settings"),
    ],
    next: ["/support/knowledge", "/support/dashboard", "/support/customers"],
  },
  {
    key: "supportTicket",
    pattern: "/support/tickets/[ticketId]",
    module: "support",
    profile: "support_agent",
    tools: ["read_ticket", "search_kb_articles"],
    metrics: ["kbArticles"],
    subject: { param: "ticketId", type: "ticket" },
    steps: [S("read", undefined, { selector: HEAD }), S("reply", undefined, { selector: FORM, ai: { questions: ["tone", "details"] } }), S("resolve")],
    next: ["/support", "/support/knowledge"],
  },
  {
    key: "projects",
    pattern: "/projects",
    module: "projects",
    profile: "ai_project_manager",
    tools: ["read_projects", "read_team_workload", "read_my_workload"],
    metrics: ["projects", "openTasks"],
    steps: [
      S("create", "/projects", { done: { metric: "projects", min: 1 }, selector: FORM, ai: { questions: ["goal", "deadline"] } }),
      S("tasks", "/projects/tasks", { done: { metric: "openTasks", min: 1 } }),
      S("mine", "/projects/my-tasks"),
    ],
    next: ["/projects/my-tasks", "/projects/tasks", "/projects/templates"],
  },
  {
    key: "project",
    pattern: "/projects/[projectId]",
    module: "projects",
    profile: "ai_project_manager",
    tools: ["read_project", "read_sprint", "read_team_workload"],
    metrics: ["openTasks"],
    subject: { param: "projectId", type: "project" },
    steps: [S("plan", undefined, { selector: HEAD, ai: { questions: ["goal", "deadline"] } }), S("board"), S("risks", undefined, { ai: { questions: ["details"] } })],
    next: ["/projects", "/projects/my-tasks"],
  },
  {
    key: "product",
    pattern: "/product",
    module: "product",
    profile: "product_manager",
    tools: ["read_company_graph", "search_company_brain", "read_objectives"],
    metrics: ["productIdeas", "productFeatures"],
    steps: [
      S("ideas", "/product/ideas", { done: { metric: "productIdeas", min: 1 } }),
      S("features", "/product/features", { done: { metric: "productFeatures", min: 1 }, ai: { questions: ["goal", "audience"] } }),
      S("prioritize", "/product/prioritization"),
    ],
    next: ["/product/ideas", "/product/prioritization", "/product/releases"],
  },
  {
    key: "operations",
    pattern: "/operations",
    module: "operations",
    profile: "operations_assistant",
    tools: ["read_projects", "search_company_brain"],
    metrics: ["opsProcesses"],
    steps: [S("process", "/operations/processes", { done: { metric: "opsProcesses", min: 1 }, ai: { questions: ["process", "details"] } }), S("checklists", "/operations/checklists"), S("incidents", "/operations/incidents")],
    next: ["/operations/processes", "/operations/checklists", "/workflows"],
  },
  {
    key: "finance",
    pattern: "/finance",
    module: "finance",
    profile: "ai_cfo",
    tools: ["read_financial_summary", "read_cashflow_forecast", "read_invoices", "read_budget_status"],
    metrics: ["invoices", "overdueInvoices", "expenses"],
    steps: [
      S("settings", "/finance/settings"),
      S("invoice", "/finance/invoices/new", { done: { metric: "invoices", min: 1 }, ai: { questions: ["who", "amount", "details"] } }),
      S("expense", "/finance/transactions", { done: { metric: "expenses", min: 1 } }),
    ],
    next: ["/finance/invoices/new", "/finance/cashflow", "/finance/reports"],
  },
  {
    key: "financeInvoices",
    pattern: "/finance/invoices",
    module: "finance",
    profile: "bookkeeper",
    tools: ["read_invoices", "read_financial_summary"],
    metrics: ["invoices", "overdueInvoices"],
    steps: [S("create", "/finance/invoices/new", { done: { metric: "invoices", min: 1 } }), S("overdue", "/finance/invoices", { done: { metric: "overdueInvoices", max: 0 }, selector: TABLE }), S("recurring", "/finance/recurring")],
    next: ["/finance/invoices/new", "/finance/receivables"],
  },
  {
    key: "financeInvoiceNew",
    pattern: "/finance/invoices/new",
    module: "finance",
    profile: "bookkeeper",
    tools: ["read_invoices"],
    metrics: ["invoices", "customers"],
    steps: [S("customer", "/finance/invoices/new", { selector: "main form select, main form input" }), S("lines", "/finance/invoices/new", { selector: FORM }), S("save", "/finance/invoices/new", { done: { metric: "invoices", min: 1 }, ai: { questions: ["who", "amount", "details"] } })],
    next: ["/finance/invoices", "/finance/receivables"],
  },
  {
    key: "financeInvoice",
    pattern: "/finance/invoices/[id]",
    module: "finance",
    profile: "bookkeeper",
    tools: ["read_invoices"],
    metrics: ["overdueInvoices"],
    steps: [S("review", undefined, { selector: HEAD }), S("send"), S("payment")],
    next: ["/finance/invoices", "/finance/receivables"],
  },
  {
    key: "hr",
    pattern: "/hr",
    module: "hr",
    profile: "people_analyst",
    tools: ["read_headcount_summary", "read_hr_policies", "read_open_jobs"],
    metrics: ["employees", "openJobs", "policies", "pendingLeave"],
    steps: [
      S("employees", "/hr/employees", { done: { metric: "employees", min: 1 } }),
      S("policies", "/hr/policies", { done: { metric: "policies", min: 1 }, ai: { questions: ["topic", "details"] } }),
      S("leave", "/hr/leave", { done: { metric: "pendingLeave", max: 0 } }),
    ],
    next: ["/hr/employees", "/hr/recruiting", "/hr/policies"],
  },
  {
    key: "hrRecruiting",
    pattern: "/hr/recruiting",
    module: "hr",
    profile: "recruiter",
    tools: ["read_open_jobs", "read_candidate"],
    metrics: ["openJobs", "candidates"],
    steps: [
      S("job", "/hr/recruiting", { done: { metric: "openJobs", min: 1 }, selector: FORM, ai: { questions: ["role", "details"] } }),
      S("candidates", "/hr/recruiting", { done: { metric: "candidates", min: 1 } }),
      S("interviews", "/hr/recruiting"),
    ],
    next: ["/hr/employees", "/hr/onboarding"],
  },
  {
    key: "hrJob",
    pattern: "/hr/recruiting/jobs/[jobId]",
    module: "hr",
    profile: "recruiter",
    tools: ["read_open_jobs", "read_candidate"],
    metrics: ["candidates"],
    subject: { param: "jobId", type: "hr_job" },
    steps: [S("description", undefined, { selector: HEAD, ai: { questions: ["details"] } }), S("candidates"), S("shortlist", undefined, { ai: { questions: ["details"] } })],
    next: ["/hr/recruiting"],
  },
  {
    key: "hrCandidate",
    pattern: "/hr/recruiting/candidates/[candidateId]",
    module: "hr",
    profile: "recruiter",
    tools: ["read_candidate", "read_open_jobs"],
    metrics: [],
    subject: { param: "candidateId", type: "hr_candidate" },
    steps: [S("review", undefined, { selector: HEAD }), S("score", undefined, { ai: { questions: ["details"] } }), S("decide")],
    next: ["/hr/recruiting"],
  },
  {
    key: "communication",
    pattern: "/communication",
    module: "communication",
    profile: "chief_of_staff",
    tools: ["read_announcements", "read_meeting"],
    metrics: ["announcements", "channels", "meetings"],
    steps: [
      S("announce", "/communication/announcements", { done: { metric: "announcements", min: 1 }, ai: { questions: ["topic", "tone"] } }),
      S("channel", "/communication/channels", { done: { metric: "channels", min: 1 } }),
      S("meeting", "/communication/meetings", { done: { metric: "meetings", min: 1 } }),
    ],
    next: ["/communication/inbox", "/communication/calendar"],
  },
  {
    key: "workflows",
    pattern: "/workflows",
    module: "automation",
    profile: "automation_architect",
    tools: ["read_workflows", "read_workflow_runs"],
    metrics: ["workflows", "activeWorkflows"],
    steps: [
      S("template", "/workflows/templates", { done: { metric: "workflows", min: 1 }, ai: { questions: ["process", "details"] } }),
      S("activate", "/workflows", { done: { metric: "activeWorkflows", min: 1 }, selector: TABLE }),
      S("runs", "/workflows/runs"),
    ],
    next: ["/workflows/templates", "/workflows/runs", "/integrations"],
  },
  {
    key: "workflow",
    pattern: "/workflows/[workflowId]",
    module: "automation",
    profile: "automation_architect",
    tools: ["read_workflows", "read_workflow_runs"],
    metrics: ["activeWorkflows"],
    subject: { param: "workflowId", type: "workflow" },
    steps: [S("review", undefined, { selector: HEAD }), S("improve", undefined, { ai: { questions: ["goal", "details"] } }), S("activate")],
    next: ["/workflows/runs", "/workflows"],
  },
  {
    key: "integrations",
    pattern: "/integrations",
    module: "platform",
    profile: "integrations_engineer",
    tools: ["read_integrations", "read_sync_runs"],
    metrics: ["connections"],
    steps: [S("connect", "/integrations", { done: { metric: "connections", min: 1 }, selector: TABLE }), S("sync", "/integrations/syncs"), S("webhooks", "/integrations/webhooks")],
    next: ["/workflows", "/marketplace"],
  },
  {
    key: "marketplace",
    pattern: "/marketplace",
    module: "platform",
    profile: "research_analyst",
    tools: ["read_marketplace_listings"],
    metrics: ["installs"],
    steps: [S("browse", "/marketplace", { selector: TABLE }), S("install", "/marketplace", { done: { metric: "installs", min: 1 } }), S("installed", "/marketplace/installed")],
    next: ["/marketplace/installed", "/workflows"],
  },
  {
    key: "settings",
    pattern: "/settings",
    module: "platform",
    profile: "org_admin_assistant",
    tools: ["read_org_structure"],
    metrics: ["members"],
    steps: [S("members", "/settings/members", { done: { metric: "members", min: 2 } }), S("roles", "/settings/roles"), S("security", "/settings/security")],
    next: ["/settings/members", "/settings/security", "/settings/billing"],
  },
];

const PAGE_BY_KEY = new Map(GUIDE_PAGES.map((p) => [p.key, p]));
export const guidePageByKey = (key: string): GuidePage | undefined => PAGE_BY_KEY.get(key);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);

const segments = (path: string) => path.split("/").filter(Boolean);

/** Match one pattern against path segments; returns params and a specificity score (static segments weigh more). */
function matchPattern(pattern: string, parts: string[]): { params: Record<string, string>; score: number } | null {
  const pat = segments(pattern);
  if (pat.length !== parts.length) return null;
  const params: Record<string, string> = {};
  let score = 0;
  for (let i = 0; i < pat.length; i++) {
    const p = pat[i]!;
    const v = parts[i]!;
    if (p.startsWith("[") && p.endsWith("]")) {
      // Params are record ids: anything else ("import", "settings") is a static sub-page of the parent.
      if (!UUID.test(v)) return null;
      params[p.slice(1, -1)] = v;
      score += 1;
    } else if (p === v) score += 3;
    else return null;
  }
  return { params, score };
}

export interface ResolvedPage {
  page: GuidePage;
  /** Path after the locale, normalized ("" for the Command Center). */
  path: string;
  params: Record<string, string>;
  /** True when the exact route has no entry and a parent route's context is used. */
  inherited: boolean;
}

/** Strip a leading locale segment ("/de-DE/crm" → "/crm") when `locales` contains it. */
export function stripLocale(pathname: string, locales: readonly string[]): string {
  const clean = pathname.split(/[?#]/)[0] ?? "";
  const parts = segments(clean);
  if (parts[0] && locales.includes(parts[0])) parts.shift();
  return parts.length ? `/${parts.join("/")}` : "";
}

/** Resolve an app path (without locale) to its registry entry, falling back to the closest parent route. */
export function resolveGuidePage(path: string): ResolvedPage {
  const parts = segments(path).slice(0, 8);
  for (let len = parts.length; len >= 0; len--) {
    const sub = parts.slice(0, len);
    let best: { page: GuidePage; params: Record<string, string>; score: number } | null = null;
    for (const page of GUIDE_PAGES) {
      const m = matchPattern(page.pattern, sub);
      if (m && (!best || m.score > best.score)) best = { page, ...m };
    }
    if (best) return { page: best.page, path: sub.length ? `/${sub.join("/")}` : "", params: best.params, inherited: len !== parts.length };
  }
  return { page: GUIDE_PAGES[0]!, path: "", params: {}, inherited: parts.length > 0 };
}

/** Every metric a page needs: its own facts plus those its steps are checked against. */
export function pageMetrics(page: GuidePage): MetricKey[] {
  const set = new Set<MetricKey>(page.metrics);
  for (const s of page.steps) if (s.done) set.add(s.done.metric);
  return [...set];
}

export function stepDoneByState(step: GuideStep, counts: Partial<Record<MetricKey, number | null>>): boolean | null {
  if (!step.done) return null;
  const n = counts[step.done.metric];
  if (n === null || n === undefined) return null;
  if (step.done.min !== undefined && n < step.done.min) return false;
  if (step.done.max !== undefined && n > step.done.max) return false;
  return true;
}
