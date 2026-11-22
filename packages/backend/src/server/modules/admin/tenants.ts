import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { getOrgOverride, getPlanLimits, invalidateOrgState } from "@/server/core/platform-controls";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { daysAgo, isUuid, reasonSchema, requireAnyPlatform, requireConfirmation, utcMonthStart } from "./access";
import { aiUsageSince } from "./overview";

/** A tenant view (access to an organization's details) stays open for this long within one admin session. */
export const TENANT_VIEW_TTL_MS = 8 * 60 * 60_000;

/** Has this admin session already given a reason for viewing this organization? */
export async function hasTenantViewGrant(ctx: RequestContext, organizationId: string) {
  if (!ctx.sessionId || !isUuid(organizationId)) return false;
  const hit = await db().auditLog.findFirst({
    where: {
      action: "platform.tenant_viewed",
      organizationId,
      actorId: ctx.actor.id,
      createdAt: { gte: new Date(Date.now() - TENANT_VIEW_TTL_MS) },
      newValue: { path: ["sessionId"], equals: ctx.sessionId },
    },
    select: { id: true },
  });
  return !!hit;
}

export const tenantViewInput = z.object({ reason: reasonSchema });

/** Record that an administrator opened a tenant's details, with their reason (audit: platform.tenant_viewed). */
export async function recordTenantView(ctx: RequestContext, organizationId: string, raw: z.input<typeof tenantViewInput>) {
  const { reason } = tenantViewInput.parse(raw);
  if (!isUuid(organizationId)) throw notFound("Organization");
  await transaction(async (tx) => {
    await requirePermission(ctx, "platform.organizations.read", platformChain(), tx);
    if (!(await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true } }))) throw notFound("Organization");
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId, action: "platform.tenant_viewed", resourceType: "organization", resourceId: organizationId, newValue: { sessionId: ctx.sessionId }, reason });
  });
  return { ok: true };
}

/** Cheap per-module row counts for one organization ("modules in use"). */
async function moduleCounts(organizationId: string) {
  const w = { where: { organizationId } };
  const [leads, deals, contacts, accounts, campaigns, content, invoices, transactions, employees, candidates, projects, workTasks, channels, announcements, tickets, workflows, workflowRuns, connections, aiEmployees, agentTasks, dashboards, installs, documents, objectives] =
    await Promise.all([
      db().lead.count(w),
      db().crmDeal.count(w),
      db().contact.count(w),
      db().account.count(w),
      db().marketingCampaign.count(w),
      db().marketingContent.count(w),
      db().invoice.count(w),
      db().financeTransaction.count(w),
      db().employee.count(w),
      db().hrCandidate.count(w),
      db().project.count(w),
      db().workTask.count(w),
      db().commsChannel.count(w),
      db().commsAnnouncement.count(w),
      db().supportTicket.count(w),
      db().workflow.count(w),
      db().workflowRun.count(w),
      db().integrationConnection.count(w),
      db().aiEmployee.count(w),
      db().agentTask.count(w),
      db().biDashboard.count(w),
      db().marketplaceInstallation.count(w),
      db().brainDocument.count(w),
      db().objective.count(w),
    ]);
  return [
    { module: "crm", counts: { leads, deals, contacts, accounts } },
    { module: "marketing", counts: { campaigns, content } },
    { module: "finance", counts: { invoices, transactions } },
    { module: "hr", counts: { employees, candidates } },
    { module: "work", counts: { projects, tasks: workTasks } },
    { module: "comms", counts: { channels, announcements } },
    { module: "support", counts: { tickets } },
    { module: "automation", counts: { workflows, runs: workflowRuns } },
    { module: "integrations", counts: { connections } },
    { module: "workforce", counts: { aiEmployees, tasks: agentTasks } },
    { module: "bi", counts: { dashboards } },
    { module: "marketplace", counts: { installs } },
    { module: "brain", counts: { documents } },
    { module: "objectives", counts: { objectives } },
  ];
}

/** Everything a platform admin needs about one organization. Callers record the tenant view first. */
export async function getPlatformOrganization(ctx: RequestContext, organizationId: string) {
  await requirePermission(ctx, "platform.organizations.read", platformChain());
  if (!isUuid(organizationId)) throw notFound("Organization");
  const org = await db().organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true, status: true, defaultLocale: true, createdAt: true, createdById: true, closedAt: true, closedReason: true },
  });
  if (!org) throw notFound("Organization");
  const [memberships, grants, companies, subscriptions, modules, tasks30, tasksFailed30, recentTasks, aiMonth, usage, activity, override, plan] = await Promise.all([
    db().membership.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, take: 100, select: { status: true, createdAt: true, user: { select: { id: true, email: true, name: true, status: true } } } }),
    db().roleAssignment.findMany({ where: { organizationId, principalType: "USER" }, take: 5000, select: { principalId: true, role: { select: { key: true } } } }),
    db().company.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, take: 500, select: { id: true, name: true, status: true, stage: true, deletedAt: true, createdAt: true } }),
    db().subscription.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, status: true, interval: true, currency: true, currentPeriodEnd: true, trialEndsAt: true, cancelAtPeriodEnd: true, plan: { select: { key: true, name: true } } },
    }),
    moduleCounts(organizationId),
    db().agentTask.count({ where: { organizationId, createdAt: { gte: daysAgo(30) } } }),
    db().agentTask.count({ where: { organizationId, status: "FAILED", createdAt: { gte: daysAgo(30) } } }),
    db().agentTask.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, companyId: true, title: true, profile: true, status: true, model: true, inputTokens: true, outputTokens: true, errorCode: true, createdAt: true } }),
    aiUsageSince(utcMonthStart(), { organizationId }),
    db().usageRecord.groupBy({ by: ["meter"], where: { organizationId, occurredAt: { gte: utcMonthStart() } }, _sum: { quantity: true } }),
    db().auditLog.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 30 }),
    getOrgOverride(organizationId),
    getPlanLimits(organizationId),
  ]);
  const rolesOf = (userId: string) => grants.filter((g) => g.principalId === userId).map((g) => g.role.key);
  const members = memberships.map((m) => ({ ...m, roles: [...new Set(rolesOf(m.user.id))] }));
  return {
    ...org,
    owners: members.filter((m) => m.roles.includes("ORGANIZATION_OWNER")).map((m) => m.user),
    members,
    companies,
    subscriptions,
    modules,
    ai: { tasks30d: tasks30, failed30d: tasksFailed30, month: aiMonth, recentTasks },
    usage: usage.map((u) => ({ meter: u.meter, quantity: Number(u._sum.quantity ?? 0) })),
    activity,
    override,
    plan,
  };
}

// ───────────── Archive (CLOSED) ─────────────

export const closeOrgInput = z.object({ reason: reasonSchema, confirm: z.string().max(200) });

/**
 * Archive an organization: status CLOSED with closedAt / closedReason. Members lose all tenant access (rbac grants
 * nothing in CLOSED organizations, the workspace switcher lists only ACTIVE ones), sessions pointing at it are
 * detached, and its AI work stops with the organization's API access. Data is kept; reopening restores access.
 * Typed confirmation: the organization's slug.
 */
export async function closeOrganization(ctx: RequestContext, organizationId: string, raw: z.input<typeof closeOrgInput>) {
  const input = closeOrgInput.parse(raw);
  if (!isUuid(organizationId)) throw notFound("Organization");
  const result = await transaction(async (tx) => {
    await requirePermission(ctx, "platform.organizations.manage", platformChain(), tx);
    const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { slug: true, status: true } });
    if (!org) throw notFound("Organization");
    if (org.status === "CLOSED") throw conflict("The organization is already archived");
    requireConfirmation(input.confirm, org.slug);
    const closedAt = new Date();
    await tx.organization.update({ where: { id: organizationId }, data: { status: "CLOSED", closedAt, closedReason: input.reason } });
    const detached = await tx.session.updateMany({ where: { activeOrganizationId: organizationId, revokedAt: null }, data: { activeOrganizationId: null } });
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId, action: "platform.organization.closed", resourceType: "organization", resourceId: organizationId, oldValue: { status: org.status }, newValue: { status: "CLOSED", closedAt, detachedSessions: detached.count }, reason: input.reason });
    return { id: organizationId, status: "CLOSED" as const, closedAt };
  });
  invalidateOrgState(organizationId);
  return result;
}

export const reopenOrgInput = z.object({ reason: reasonSchema });

export async function reopenOrganization(ctx: RequestContext, organizationId: string, raw: z.input<typeof reopenOrgInput>) {
  const { reason } = reopenOrgInput.parse(raw);
  if (!isUuid(organizationId)) throw notFound("Organization");
  const result = await transaction(async (tx) => {
    await requirePermission(ctx, "platform.organizations.manage", platformChain(), tx);
    const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { status: true, closedAt: true } });
    if (!org) throw notFound("Organization");
    if (org.status !== "CLOSED") throw conflict("Only archived organizations can be reopened");
    await tx.organization.update({ where: { id: organizationId }, data: { status: "ACTIVE", closedAt: null, closedReason: null } });
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId, action: "platform.organization.reopened", resourceType: "organization", resourceId: organizationId, oldValue: { status: "CLOSED", closedAt: org.closedAt }, newValue: { status: "ACTIVE" }, reason });
    return { id: organizationId, status: "ACTIVE" as const };
  });
  invalidateOrgState(organizationId);
  return result;
}

// ───────────── Security, AI workforce and access history (detail tabs) ─────────────

/** Member MFA coverage, enterprise policy, SSO, API keys, live sessions and pending invitations of one organization. */
export async function organizationSecurity(ctx: RequestContext, organizationId: string) {
  await requirePermission(ctx, "platform.organizations.read", platformChain());
  if (!isUuid(organizationId)) throw notFound("Organization");
  if (!(await db().organization.findUnique({ where: { id: organizationId }, select: { id: true } }))) throw notFound("Organization");
  const now = new Date();
  const [members, policy, sso, domains, keys, sessions, invites] = await Promise.all([
    db().membership.findMany({ where: { organizationId, status: "ACTIVE" }, take: 5000, select: { user: { select: { id: true, mfaEnabled: true, status: true } } } }),
    db().enterpriseOrgSettings.findUnique({ where: { organizationId }, select: { requireMfa: true, sessionTimeoutMinutes: true, ipAllowlist: true, enforceSso: true, maxMembers: true, maxApiKeys: true } }),
    db().enterpriseSsoConnection.findMany({ where: { organizationId }, select: { id: true, protocol: true, name: true, enabled: true, issuer: true, createdAt: true, updatedAt: true } }),
    db().enterpriseSsoDomain.findMany({ where: { organizationId }, select: { id: true, domain: true, verifiedAt: true } }),
    db().apiKey.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, name: true, prefix: true, lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true } }),
    db().session.count({ where: { revokedAt: null, expiresAt: { gt: now }, user: { memberships: { some: { organizationId, status: "ACTIVE" } } } } }),
    db().invitation.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, email: true, expiresAt: true, acceptedAt: true, revokedAt: true, deliveryStatus: true, createdAt: true, role: { select: { key: true } } } }),
  ]);
  const withMfa = members.filter((m) => m.user.mfaEnabled).length;
  return {
    mfa: { members: members.length, withMfa, coverage: members.length ? withMfa / members.length : null },
    policy,
    sso,
    domains,
    apiKeys: keys.map((k) => ({ ...k, state: k.revokedAt ? "revoked" : k.expiresAt && k.expiresAt <= now ? "expired" : "active" })),
    liveSessions: sessions,
    invitations: invites.map((i) => ({ ...i, state: i.acceptedAt ? "accepted" : i.revokedAt ? "revoked" : i.expiresAt <= now ? "expired" : "pending" })),
  };
}

/** AI workforce summary of one organization: employees by status, 30-day cost from cost_ledger_entries, budgets. */
export async function organizationAiSummary(ctx: RequestContext, organizationId: string) {
  await requireAnyPlatform(ctx, ["platform.organizations.read", "platform.ai.read"]);
  if (!isUuid(organizationId)) throw notFound("Organization");
  const from = daysAgo(30);
  const [employees, byStatus, ledger, budgets, override] = await Promise.all([
    db().aiEmployee.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, take: 200, select: { id: true, name: true, department: true, status: true, autonomy: true, monthlyTokenBudget: true, companyId: true } }),
    db().aiEmployee.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
    db().costLedgerEntry.groupBy({ by: ["category"], where: { organizationId, occurredAt: { gte: from } }, _sum: { costMicros: true, inputTokens: true, outputTokens: true }, _count: { _all: true } }),
    db().costBudget.findMany({ where: { organizationId }, take: 100, select: { id: true, scope: true, scopeKey: true, limitMicros: true, hardStop: true, companyId: true } }),
    getOrgOverride(organizationId),
  ]);
  return {
    employees,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    ledger30d: ledger.map((r) => ({ category: r.category, costMicros: Number(r._sum.costMicros ?? 0n), tokens: (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0), entries: r._count._all })),
    budgets: budgets.map((b) => ({ ...b, limitMicros: Number(b.limitMicros) })),
    aiDisabled: override.aiDisabled,
  };
}

const ACCESS_ACTIONS = [
  "platform.tenant_viewed",
  "platform.impersonation.started",
  "platform.impersonation.redeemed",
  "platform.impersonation.ended",
  "platform.organization.member_added",
  "platform.organization.member_removed",
  "platform.organization.member_role_changed",
  "platform.organization.data_exported",
  "role.assigned",
  "role.revoked",
];

/** Who accessed or changed access to this organization: tenant views, impersonations, member and role changes. */
export async function organizationAccessHistory(ctx: RequestContext, organizationId: string) {
  await requirePermission(ctx, "platform.organizations.read", platformChain());
  if (!isUuid(organizationId)) throw notFound("Organization");
  const rows = await db().auditLog.findMany({ where: { organizationId, action: { in: ACCESS_ACTIONS } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, action: true, actorId: true, actorType: true, resourceId: true, reason: true, ip: true, createdAt: true } });
  const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
  const people = ids.length ? await db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  return rows.map((r) => ({ ...r, actor: people.find((p) => p.id === r.actorId) ?? null }));
}

// ───────────── Export authorized data ─────────────

export const adminExportInput = z.object({ companyId: z.string().uuid(), reason: reasonSchema });

/**
 * Export one company's data (the tenant export of enterprise/data.ts: secrets omitted, recorded as an
 * EnterpriseDataRequest). Requires platform.data.export (MFA) and platform.organizations.read; audited as the admin
 * with the reason before the stream starts.
 */
export async function adminExportCompanyData(ctx: RequestContext, organizationId: string, raw: z.input<typeof adminExportInput>) {
  const input = adminExportInput.parse(raw);
  if (!isUuid(organizationId)) throw notFound("Organization");
  await requirePermission(ctx, "platform.organizations.read", platformChain());
  await requirePermission(ctx, "platform.data.export", platformChain());
  const company = await db().company.findFirst({ where: { id: input.companyId, organizationId }, select: { id: true, name: true } });
  if (!company) throw notFound("Company");
  await transaction((tx) => writeAudit(tx, ctx, { category: "SECURITY", organizationId, action: "platform.organization.data_exported", resourceType: "company", resourceId: company.id, newValue: { companyName: company.name }, reason: input.reason }));
  const { exportCompanyData } = await import("@/server/modules/enterprise/data");
  return exportCompanyData({ ...systemContext(ctx.requestId), ip: ctx.ip, userAgent: ctx.userAgent }, organizationId, company.id);
}
