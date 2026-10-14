# Realy — Roles, Permissions & Scopes

> Status: **Frozen for Phase 1.** Implemented in `src/server/modules/rbac`.

## 1. Model

```
Principal (USER | SERVICE_ACCOUNT | AGENT)
   └─ role_assignments ── role ── role_permissions ── permission (resource.action)
            └─ scope (PLATFORM | REGION | COUNTRY | ORGANIZATION | COMPANY | WORKSPACE | PROJECT, scope_id)
```

A check is `can(principal, permission, target)` where `target` is a **scope chain** — the path from
the resource up to the root. A grant applies if its scope appears anywhere in the chain.

| Target | Chain (most specific → root) |
|---|---|
| a project | PROJECT:p → WORKSPACE:w → COMPANY:c → ORGANIZATION:o |
| a company | COMPANY:c → ORGANIZATION:o |
| UAE pricing / config | COUNTRY:AE → REGION:MIDDLE_EAST → PLATFORM:* |
| EU regional price | REGION:EU → PLATFORM:* |
| global price / plan definition | PLATFORM:* |

Tenant chains and platform chains are **disjoint**: an `ORGANIZATION_OWNER` never gains platform
permissions, and a `PLATFORM_ADMIN` is not implicitly a member of any organization. Platform staff
access to tenant data (support) goes through an explicit, time-boxed, audited support grant
(`support.impersonate`, Phase 2).

### Rules
1. **Deny by default.** No assignment → no access.
2. **No self-escalation.** A principal can grant a role only if it holds *every* permission in that
   role at (or above) the target scope, and holds `roles.assign` there. Agents can never hold
   `roles.assign` — AI identities cannot grant themselves or others permissions.
3. **Platform-only permissions** (`pricing.manage`, `globalization.manage`, `flags.manage`, …) can
   only be placed in system roles and assigned at PLATFORM/REGION/COUNTRY scope.
4. **Expiring grants** — `role_assignments.expires_at` is honored on every check.
5. **Critical permissions require an MFA-verified session** (see list in §4).
6. Every grant/revoke is audited (`category = SECURITY`).

## 2. Permission catalog (Phase 1 seed)

Format `resource.action`. `manage` implies `read` (enforced by seeding both into roles, never by
string magic).

| Resource | Actions | Scope level |
|---|---|---|
| `users` | read, manage | org |
| `roles` | read, manage, assign | org / platform |
| `organizations` | read, manage, delete | org |
| `companies` | read, manage, delete | org/company |
| `workspaces` | read, manage | company/workspace |
| `projects` | read, manage | workspace/project |
| `billing` | read, manage | org |
| `finance` | read, manage, transfer | company |
| `agents` | read, manage, run | company |
| `workflows` | read, manage, execute | company |
| `integrations` | read, manage | company |
| `analytics` | read, manage | company |
| `marketing` / `sales` / `operations` / `support` | read, manage | company |
| `ownership` | read, modify | company (FOUNDER-only autonomy) |
| `audit` | read | org / platform |
| `pricing` | read, manage | platform/region/country (platform-only) |
| `globalization` | read, manage | platform/region/country (platform-only) |
| `flags` | read, manage | platform (platform-only) |
| `platform.users` / `platform.organizations` | read, manage | platform |
| `platform.subscriptions` | read, manage | platform |
| `platform.security` | read, manage | platform |
| `platform.support` | read, manage | platform |
| `platform.content` | manage | platform |

## 3. System roles

| Role | Assignable at | Grants (summary) |
|---|---|---|
| SUPER_ADMIN | PLATFORM | every platform permission |
| PLATFORM_ADMIN | PLATFORM | platform.* read/manage, pricing.*, globalization.*, flags.*, audit.read |
| BILLING_ADMIN | PLATFORM | pricing.*, platform.subscriptions.*, audit.read |
| FINANCE_ADMIN | PLATFORM | platform.subscriptions.read, pricing.read, audit.read |
| SUPPORT_ADMIN | PLATFORM | platform.support.*, platform.users.read, platform.organizations.read |
| SECURITY_ADMIN | PLATFORM | platform.security.*, audit.read, flags.read |
| CONTENT_ADMIN | PLATFORM | platform.content.manage, globalization.read |
| REGION_ADMIN | REGION | pricing.*, globalization.*, flags.read — **only within that region's chain** |
| COUNTRY_ADMIN | COUNTRY | pricing.*, globalization.* — **only that country** |
| ORGANIZATION_OWNER | ORGANIZATION | every org/company permission incl. billing.manage, ownership.modify, organizations.delete |
| ORGANIZATION_ADMIN | ORGANIZATION | org/company permissions except ownership.modify, organizations.delete, finance.transfer |
| COMPANY_ADMIN | COMPANY | everything company-scoped except ownership.modify, finance.transfer |
| MANAGER | COMPANY / WORKSPACE | read all business areas, manage projects/workflows/marketing/sales/operations/support |
| MEMBER | COMPANY / WORKSPACE / PROJECT | read business areas, manage projects, workflows.execute |
| VIEWER | any tenant scope | *.read for tenant resources |

## 4. MFA-gated (critical) permissions
`pricing.manage`, `globalization.manage`, `flags.manage`, `roles.assign`, `roles.manage`,
`billing.manage`, `finance.transfer`, `ownership.modify`, `organizations.delete`,
`platform.security.manage`, `platform.users.manage`. In production these require
`session.mfa_verified_at` within the last 12 h; in development the gate can be relaxed with
`REALY_DEV_RELAX_MFA=true` (refused when `NODE_ENV=production`).

## 5. Custom roles

Organization admins with `roles.manage` create roles composed of non-platform permissions.
Example — *Marketing Manager*: `marketing.read`, `marketing.manage`, `analytics.read`; it does **not**
include `finance.manage` or `billing.manage`, and the API refuses to add platform-only permissions.

## 6. Agent permissions

Each digital employee is a principal (`principal_type = AGENT`) with role assignments scoped to its
company (or narrower). Agent roles are built from a curated subset; the following are **never**
assignable to agents: `roles.assign`, `roles.manage`, `ownership.modify`, `finance.transfer`,
`billing.manage`, `organizations.delete`, all `platform.*`. On top of RBAC, every agent tool call also
passes the autonomy/risk policy (`security.md` §5) — RBAC says *may it ever*, policy says *may it now
without a human*.

## 7. Evaluation & performance

`can()` loads the principal's non-expired assignments once per request (one indexed query), expands
role → permission sets (roles/permissions cached in-process for 60 s, invalidated by
`role.updated` events), and checks chain membership in memory. O(assignments) per check; typical
principals have < 10 assignments.
