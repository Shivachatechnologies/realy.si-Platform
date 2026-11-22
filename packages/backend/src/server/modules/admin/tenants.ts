import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { getOrgOverride, getPlanLimits } from "@/server/core/platform-controls";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { daysAgo, isUuid, reasonSchema, utcMonthStart } from "./access";
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
    select: { id: true, name: true, slug: true, status: true, defaultLocale: true, createdAt: true, createdById: true },
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
