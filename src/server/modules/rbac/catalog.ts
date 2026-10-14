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
]);

/** Never assignable to AI identities (docs/rbac.md §6). */
export const NEVER_FOR_AGENTS = new Set([
  "roles.assign",
  "roles.manage",
  "ownership.modify",
  "finance.transfer",
  "billing.manage",
  "organizations.delete",
  ...PLATFORM_ONLY,
]);

const all = (pred: (k: string) => boolean) => PERMISSIONS.map((p) => p.key).filter(pred);
const tenantKeys = all((k) => !PLATFORM_ONLY.has(k));
const companyResources = [
  "companies",
  "workspaces",
  "projects",
  "finance",
  "agents",
  "workflows",
  "integrations",
  "analytics",
  "marketing",
  "sales",
  "operations",
  "support",
];
const businessAreas = ["marketing", "sales", "operations", "support", "analytics", "finance", "agents", "workflows", "integrations"];

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
    ],
  },
  {
    key: "BILLING_ADMIN",
    name: "Billing admin",
    description: "Pricing catalog and subscriptions.",
    assignableAt: PLATFORM_SCOPES,
    permissions: ["pricing.read", "pricing.manage", "platform.subscriptions.read", "platform.subscriptions.manage", "platform.audit.read", "globalization.read"],
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
    permissions: ["platform.security.read", "platform.security.manage", "platform.audit.read", "flags.read", "platform.users.read"],
  },
  {
    key: "CONTENT_ADMIN",
    name: "Content admin",
    description: "Platform content and translations.",
    assignableAt: PLATFORM_SCOPES,
    permissions: ["platform.content.manage", "globalization.read"],
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
      "users.read",
      ...businessAreas.map((a) => `${a}.read`),
      "workflows.manage",
      "workflows.execute",
      "agents.run",
      "marketing.manage",
      "sales.manage",
      "operations.manage",
      "support.manage",
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
      ...businessAreas.filter((a) => a !== "finance").map((a) => `${a}.read`),
      "workflows.execute",
    ],
  },
  {
    key: "VIEWER",
    name: "Viewer",
    description: "Read-only access.",
    assignableAt: TENANT_SCOPES,
    permissions: tenantKeys.filter((k) => k.endsWith(".read") && !["finance.read", "billing.read", "audit.read", "ownership.read"].includes(k)),
  },
];

export const SYSTEM_ROLE_KEYS = SYSTEM_ROLES.map((r) => r.key);
