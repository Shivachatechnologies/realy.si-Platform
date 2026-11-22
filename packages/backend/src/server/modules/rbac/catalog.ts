import type { ScopeType } from "@/generated/prisma/enums";

/**
 * Permission catalog and system roles (docs/rbac.md). This file is the single source of truth:
 * the seed writes it to the database and tests assert against it.
 */

interface PermissionDef {
  key: string;
  description: string;
  platformOnly?: boolean;
}

const tenant = (resource: string, actions: string[], what: string): PermissionDef[] =>
  actions.map((action) => ({ key: `${resource}.${action}`, description: `${action} ${what}` }));

const platform = (resource: string, actions: string[], what: string): PermissionDef[] =>
  actions.map((action) => ({ key: `${resource}.${action}`, description: `${action} ${what}`, platformOnly: true }));

export const PERMISSIONS: PermissionDef[] = [
  ...tenant("users", ["read", "manage"], "organization members and invitations"),
  ...tenant("roles", ["read", "manage", "assign"], "roles and role assignments"),
  ...tenant("organizations", ["read", "manage", "delete"], "the organization"),
  ...tenant("companies", ["read", "manage", "delete"], "companies"),
  ...tenant("workspaces", ["read", "manage"], "workspaces"),
  ...tenant("projects", ["read", "manage"], "projects"),
  ...tenant("graph", ["read", "manage"], "the company graph"),
  ...tenant("brain", ["read", "manage"], "Company Brain documents"),
  ...tenant("approvals", ["read", "decide"], "approval requests for AI actions"),
  ...tenant("objectives", ["read", "manage"], "objectives and milestones"),
  ...tenant("billing", ["read", "manage"], "subscription and billing profile"),
  ...tenant("finance", ["read", "manage", "transfer"], "company finance"),
  ...tenant("agents", ["read", "manage", "run"], "digital employees"),
  ...tenant("workflows", ["read", "manage", "execute"], "workflows"),
  ...tenant("integrations", ["read", "manage"], "integrations"),
  ...tenant("analytics", ["read", "manage"], "analytics"),
  ...tenant("marketing", ["read", "manage"], "marketing"),
  ...tenant("sales", ["read", "manage"], "sales"),
  ...tenant("operations", ["read", "manage"], "operations"),
  ...tenant("support", ["read", "manage"], "customer support"),
  ...tenant("hr", ["read", "manage"], "people, recruiting, leave and performance"),
  ...tenant("payroll", ["read", "manage"], "salaries and payroll"),
  ...tenant("communication", ["read", "post", "manage"], "announcements, discussions, meetings and inbox"),
  ...tenant("marketplace", ["read", "install"], "marketplace listings and installed templates"),
  ...tenant("developer", ["read", "manage"], "API keys, webhooks and developer settings"),
  ...tenant("ownership", ["read", "modify"], "ownership and equity"),
  ...tenant("audit", ["read"], "audit logs"),
  ...platform("pricing", ["read", "manage"], "plans, prices and promotions"),
  ...platform("globalization", ["read", "manage"], "countries, regions, currencies, locales, tax"),
  ...platform("flags", ["read", "manage"], "feature flags"),
  ...platform("platform.users", ["read", "manage"], "all platform users"),
  ...platform("platform.organizations", ["read", "manage"], "all organizations"),
  ...platform("platform.subscriptions", ["read", "manage"], "all subscriptions"),
  ...platform("platform.security", ["read", "manage"], "platform security settings"),
  ...platform("platform.support", ["read", "manage"], "support tooling"),
  ...platform("platform.content", ["manage"], "platform content and translations"),
  { key: "platform.audit.read", description: "read platform audit logs", platformOnly: true },
  // Super Admin Control Center: global kill switches / platform settings, and the platform AI policy.
  { key: "platform.controls.manage", description: "change platform kill switches, maintenance and platform settings", platformOnly: true },
  ...platform("platform.ai", ["read", "manage"], "the platform AI workforce policy, models and budgets"),
  // Control Center workstreams (docs/admin/STREAMS.md), all added in Step 0 so streams never edit this list in parallel.
  ...platform("platform.incidents", ["read", "manage"], "platform incidents, health, alerts and postmortems"),
  { key: "platform.alerts.manage", description: "acknowledge, assign, snooze, resolve and escalate platform alerts", platformOnly: true },
  { key: "platform.billing.refund", description: "issue refunds and handle disputes for platform payments", platformOnly: true },
  { key: "platform.roles.manage", description: "create, clone, edit and delete custom platform roles; run access reviews", platformOnly: true },
  { key: "platform.impersonate", description: "start an audited, time-boxed impersonation session as a user", platformOnly: true },
  ...platform("platform.data", ["read", "export"], "database operations, migration status, integrity checks and data exports"),
  { key: "platform.logs.read", description: "read platform logs, error groups and API request logs", platformOnly: true },
  { key: "platform.copilot.use", description: "use the read-only admin copilot", platformOnly: true },
];

export const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key));
export const PLATFORM_ONLY = new Set(PERMISSIONS.filter((p) => p.platformOnly).map((p) => p.key));

/** Require an MFA-verified session (docs/rbac.md §4). */
export const MFA_GATED = new Set([
  "pricing.manage",
  "globalization.manage",
  "flags.manage",
  "roles.assign",
  "roles.manage",
  "billing.manage",
  "finance.transfer",
  "ownership.modify",
  "organizations.delete",
  "platform.security.manage",
  "platform.users.manage",
  "platform.organizations.manage",
  "platform.subscriptions.manage",
  "platform.support.manage",
  "platform.controls.manage",
  "platform.ai.manage",
  "platform.billing.refund",
  "platform.roles.manage",
  "platform.impersonate",
  "platform.data.export",
  "payroll.manage",
  "developer.manage",
]);

/** Never assignable to AI identities (docs/rbac.md §6). */
export const NEVER_FOR_AGENTS = new Set([
  "approvals.decide",
  "roles.assign",
  "roles.manage",
  "ownership.modify",
  "finance.transfer",
  "billing.manage",
  "organizations.delete",
  "payroll.manage",
  "developer.manage",
  ...PLATFORM_ONLY,
]);

const all = (pred: (k: string) => boolean) => PERMISSIONS.map((p) => p.key).filter(pred);
const tenantKeys = all((k) => !PLATFORM_ONLY.has(k));
const companyResources = [
  "companies",
  "workspaces",
  "projects",
  "graph",
  "brain",
  "approvals",
  "objectives",
  "finance",
  "agents",
  "workflows",
  "integrations",
  "analytics",
  "marketing",
  "sales",
  "operations",
  "support",
  "hr",
  "payroll",
  "communication",
  "marketplace",
  "developer",
];
const businessAreas = ["marketing", "sales", "operations", "support", "analytics", "finance", "agents", "workflows", "integrations", "hr", "communication", "marketplace"];

export interface SystemRoleDef {
  key: string;
  name: string;
  description: string;
  assignableAt: ScopeType[];
  permissions: string[];
}

const PLATFORM_SCOPES: ScopeType[] = ["PLATFORM"];
const TENANT_SCOPES: ScopeType[] = ["ORGANIZATION", "COMPANY", "WORKSPACE", "PROJECT"];

export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    key: "SUPER_ADMIN",
    name: "Super admin",
    description: "Every platform permission.",
    assignableAt: PLATFORM_SCOPES,
    permissions: [...PLATFORM_ONLY],
  },
  {
    key: "PLATFORM_ADMIN",
    name: "Platform admin",
    description: "Operates the platform: pricing, globalization, flags, organizations.",
    assignableAt: PLATFORM_SCOPES,
    permissions: [
      "pricing.read",
      "pricing.manage",
      "globalization.read",
      "globalization.manage",
      "flags.read",
      "flags.manage",
      "platform.users.read",
      "platform.organizations.read",
      "platform.organizations.manage",
      "platform.subscriptions.read",
      "platform.support.read",
      "platform.audit.read",
      "platform.ai.read",
      "platform.incidents.read",
      "platform.incidents.manage",
      "platform.alerts.manage",
      "platform.data.read",
      "platform.logs.read",
      "platform.copilot.use",
    ],
  },
  {
    key: "BILLING_ADMIN",
    name: "Billing admin",
    description: "Pricing catalog and subscriptions.",
    assignableAt: PLATFORM_SCOPES,
    permissions: ["pricing.read", "pricing.manage", "platform.subscriptions.read", "platform.subscriptions.manage", "platform.audit.read", "globalization.read", "platform.billing.refund"],
  },
  {
    key: "FINANCE_ADMIN",
    name: "Finance admin",
    description: "Read-only revenue and pricing visibility.",
    assignableAt: PLATFORM_SCOPES,
    permissions: ["pricing.read", "platform.subscriptions.read", "platform.audit.read", "globalization.read"],
  },
  {
    key: "SUPPORT_ADMIN",
    name: "Support admin",
    description: "Support tooling with read access to users and organizations.",
    assignableAt: PLATFORM_SCOPES,
    permissions: ["platform.support.read", "platform.support.manage", "platform.users.read", "platform.organizations.read"],
  },
  {
    key: "SECURITY_ADMIN",
    name: "Security admin",
    description: "Security settings and audit.",
    assignableAt: PLATFORM_SCOPES,
    permissions: ["platform.security.read", "platform.security.manage", "platform.audit.read", "flags.read", "platform.users.read", "platform.incidents.read", "platform.logs.read"],
  },
  {
    key: "CONTENT_ADMIN",
    name: "Content admin",
    description: "Platform content and translations.",
    assignableAt: PLATFORM_SCOPES,
    permissions: ["platform.content.manage", "globalization.read"],
  },
  {
    key: "AI_OPERATIONS_ADMIN",
    name: "AI operations admin",
    description: "Operates the AI workforce platform-wide: models, routing, budgets, task logs and AI employees.",
    assignableAt: PLATFORM_SCOPES,
    permissions: ["platform.ai.read", "platform.ai.manage", "platform.organizations.read", "platform.audit.read", "platform.incidents.read", "platform.logs.read", "platform.copilot.use"],
  },
  {
    key: "READ_ONLY_ADMIN",
    name: "Read-only admin",
    description: "Sees every Control Center area without changing anything.",
    assignableAt: PLATFORM_SCOPES,
    permissions: ["pricing.read", "globalization.read", "flags.read", "platform.users.read", "platform.organizations.read", "platform.subscriptions.read", "platform.security.read", "platform.support.read", "platform.audit.read", "platform.ai.read", "platform.incidents.read", "platform.data.read", "platform.logs.read"],
  },
  {
    key: "REGION_ADMIN",
    name: "Region admin",
    description: "Pricing and configuration for one region and its countries.",
    assignableAt: ["REGION"],
    permissions: ["pricing.read", "pricing.manage", "globalization.read", "globalization.manage", "flags.read"],
  },
  {
    key: "COUNTRY_ADMIN",
    name: "Country admin",
    description: "Pricing and configuration for one country.",
    assignableAt: ["COUNTRY"],
    permissions: ["pricing.read", "pricing.manage", "globalization.read", "globalization.manage"],
  },
  {
    key: "ORGANIZATION_OWNER",
    name: "Owner",
    description: "Full control of the organization, including ownership and billing.",
    assignableAt: ["ORGANIZATION"],
    permissions: tenantKeys,
  },
  {
    key: "ORGANIZATION_ADMIN",
    name: "Admin",
    description: "Administers the organization except ownership, deletion and money movement.",
    assignableAt: ["ORGANIZATION"],
    permissions: tenantKeys.filter((k) => !["ownership.modify", "organizations.delete", "finance.transfer"].includes(k)),
  },
  {
    key: "COMPANY_ADMIN",
    name: "Company admin",
    description: "Administers one company.",
    assignableAt: ["COMPANY"],
    permissions: [
      ...tenantKeys.filter((k) => companyResources.includes(k.split(".")[0]!)),
      "users.read",
      "roles.read",
      "roles.assign",
      "audit.read",
      "ownership.read",
    ].filter((k) => !["finance.transfer", "companies.delete"].includes(k)),
  },
  {
    key: "MANAGER",
    name: "Manager",
    description: "Reads all business areas and manages day-to-day work.",
    assignableAt: ["COMPANY", "WORKSPACE"],
    permissions: [
      "companies.read",
      "workspaces.read",
      "projects.read",
      "projects.manage",
      "graph.read",
      "graph.manage",
      "brain.read",
      "brain.manage",
      "approvals.read",
      "approvals.decide",
      "objectives.read",
      "objectives.manage",
      "users.read",
      ...businessAreas.map((a) => `${a}.read`),
      "workflows.manage",
      "workflows.execute",
      "agents.run",
      "marketing.manage",
      "sales.manage",
      "operations.manage",
      "support.manage",
      "hr.manage",
      "communication.post",
      "communication.manage",
      "marketplace.install",
      "analytics.manage",
      "integrations.manage",
      "agents.manage",
    ],
  },
  {
    key: "MEMBER",
    name: "Member",
    description: "Works on projects and runs workflows.",
    assignableAt: ["COMPANY", "WORKSPACE", "PROJECT"],
    permissions: [
      "companies.read",
      "workspaces.read",
      "projects.read",
      "projects.manage",
      "graph.read",
      "brain.read",
      "approvals.read",
      "objectives.read",
      ...businessAreas.filter((a) => a !== "finance").map((a) => `${a}.read`),
      "workflows.execute",
      "communication.post",
      "agents.run",
    ],
  },
  {
    key: "VIEWER",
    name: "Viewer",
    description: "Read-only access.",
    assignableAt: TENANT_SCOPES,
    permissions: tenantKeys.filter((k) => k.endsWith(".read") && !["finance.read", "billing.read", "audit.read", "ownership.read", "payroll.read", "developer.read"].includes(k)),
  },
];

export const SYSTEM_ROLE_KEYS = SYSTEM_ROLES.map((r) => r.key);
