import { z } from "zod";
import { db, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError } from "@/server/core/errors";
import { pageInput, prismaPage, toPage } from "@/server/core/pagination";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const activityFilters = z.object({
  actor: z.string().uuid().optional().catch(undefined),
  resource: z.string().regex(/^[a-z_]{2,60}$/).optional().catch(undefined),
  module: z.string().regex(/^[a-z_]{2,40}$/).optional().catch(undefined),
  from: day.optional().catch(undefined),
  to: day.optional().catch(undefined),
  company: z.string().uuid().optional().catch(undefined),
  view: z.enum(["audit", "events"]).catch("audit").default("audit"),
  type: z.string().regex(/^[a-z_.]{2,60}$/).optional().catch(undefined),
});
export type ActivityFilters = z.infer<typeof activityFilters>;

const range = (f: ActivityFilters) =>
  f.from || f.to
    ? { createdAt: { ...(f.from ? { gte: new Date(`${f.from}T00:00:00Z`) } : {}), ...(f.to ? { lt: new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000) } : {}) } }
    : {};

/** Viewer must be an organization member; `audit.read` sees everyone's actions, others only their own. */
export async function activityAccess(ctx: RequestContext, organizationId: string) {
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw new AppError("unauthenticated", "Sign in required");
  const all = await can(ctx, "audit.read", orgChain(organizationId));
  if (!all) {
    const m = await db().membership.findUnique({ where: { organizationId_userId: { organizationId, userId: ctx.actor.id } }, select: { status: true } });
    if (m?.status !== "ACTIVE") throw new AppError("not_found", "Organization not found");
  }
  return { all, userId: ctx.actor.id };
}

/** Company activity from the audit log (newest first, cursor paginated). */
export async function listActivity(ctx: RequestContext, organizationId: string, raw: Record<string, unknown> = {}) {
  const f = activityFilters.parse(raw);
  const page = pageInput.parse({ limit: raw.limit ?? 50, cursor: raw.cursor });
  const access = await activityAccess(ctx, organizationId);
  const where: Prisma.AuditLogWhereInput = {
    organizationId,
    ...(access.all ? (f.actor ? { actorId: f.actor } : {}) : { actorId: access.userId }),
    ...(f.resource ? { resourceType: f.resource } : {}),
    ...(f.module ? { action: { startsWith: `${f.module}.` } } : {}),
    ...(f.company ? { OR: [{ newValue: { path: ["companyId"], equals: f.company } }, { oldValue: { path: ["companyId"], equals: f.company } }] } : {}),
    ...range(f),
  };
  const rows = await db().auditLog.findMany({ where, orderBy: { id: "desc" }, ...prismaPage(page) });
  const result = toPage(rows, page);
  const actorIds = [...new Set(result.data.map((r) => r.actorId).filter((x): x is string => !!x))];
  const actors = await db().user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  return { ...result, actors: new Map(actors.map((a) => [a.id, a.name])), all: access.all };
}

/** Filter options: resource types and modules seen in the log, and members (actors). */
export async function activityFacets(ctx: RequestContext, organizationId: string) {
  const access = await activityAccess(ctx, organizationId);
  const scope = { organizationId, ...(access.all ? {} : { actorId: access.userId }) };
  const [resources, actions, members] = await Promise.all([
    db().auditLog.groupBy({ by: ["resourceType"], where: scope, orderBy: { resourceType: "asc" }, take: 100 }),
    db().auditLog.groupBy({ by: ["action"], where: scope, orderBy: { action: "asc" }, take: 500 }),
    access.all ? db().membership.findMany({ where: { organizationId }, select: { user: { select: { id: true, name: true } } }, take: 500 }) : Promise.resolve([]),
  ]);
  return {
    resources: resources.map((r) => r.resourceType),
    modules: [...new Set(actions.map((a) => a.action.split(".")[0]!))].sort(),
    actors: members.map((m) => m.user).sort((a, b) => a.name.localeCompare(b.name)),
    all: access.all,
  };
}

/** Domain events of a company (audit.read only). */
export async function listDomainEvents(ctx: RequestContext, organizationId: string, companyId: string, raw: Record<string, unknown> = {}) {
  await requirePermission(ctx, "audit.read", orgChain(organizationId));
  const f = activityFilters.parse(raw);
  const page = pageInput.parse({ limit: raw.limit ?? 50, cursor: raw.cursor });
  const rows = await db().event.findMany({
    where: {
      organizationId,
      companyId,
      ...(f.type ? { type: f.type } : {}),
      ...(f.actor ? { actorId: f.actor } : {}),
      ...(f.from || f.to ? { occurredAt: range(f).createdAt } : {}),
    },
    orderBy: { id: "desc" },
    select: { id: true, type: true, aggregateType: true, aggregateId: true, actorType: true, actorId: true, payload: true, occurredAt: true },
    ...prismaPage(page),
  });
  const result = toPage(rows, page);
  const actorIds = [...new Set(result.data.map((r) => r.actorId).filter((x): x is string => !!x))];
  const actors = await db().user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  return { ...result, actors: new Map(actors.map((a) => [a.id, a.name])) };
}

/** In-app link for an audited resource (path after /{locale}), when there is a page for it. */
export function resourceHref(resourceType: string, resourceId: string | null): string | null {
  const id = resourceId ?? "";
  const map: Record<string, string> = {
    agent_task: `/tasks/${id}`,
    ai_employee: `/workforce/${id}`,
    ai_schedule: "/plans",
    ai_briefing: "/intelligence",
    approval: "/approvals",
    lead: `/crm/${id}`,
    bi_dashboard: `/analytics/dashboards/${id}`,
    bi_report: `/analytics/reports/${id}`,
    objective: "/objectives",
    milestone: "/objectives",
    project: "/projects",
    brain_document: `/brain/${id}`,
    graph_entity: "/graph",
    graph_edge: "/graph",
    company: "/company",
    membership: "/settings/members",
    invitation: "/settings/members",
    invoice: `/finance/invoices/${id}`,
    finance_bill: `/finance/bills/${id}`,
    estimate: `/finance/estimates/${id}`,
    ticket: `/support/tickets/${id}`,
    kb_article: `/support/knowledge/${id}`,
    marketing_campaign: `/marketing/campaigns/${id}`,
    employee: `/hr/employees/${id}`,
    hr_candidate: `/hr/recruiting/candidates/${id}`,
    hr_job: `/hr/recruiting/jobs/${id}`,
    crm_deal: `/crm/deals/${id}`,
    account: `/crm/accounts/${id}`,
    contact: `/crm/contacts/${id}`,
    work_project: `/projects/${id}`,
    work_task: `/projects/tasks/${id}`,
    workflow: `/workflows/${id}`,
    workflow_run: "/workflows/runs",
    workflow_approval: "/approvals",
    ops_process: `/operations/processes/${id}`,
    ops_checklist: `/operations/checklists/${id}`,
    ops_incident: `/operations/incidents/${id}`,
    ops_asset: "/operations/assets",
  };
  const href = map[resourceType];
  if (!href) return null;
  return href.endsWith("/") ? null : href;
}

/** Number of logged actions per day (UTC) over the last `days` days, oldest first — for the timeline's activity bars. */
export async function activityByDay(ctx: RequestContext, organizationId: string, days = 14, companyId?: string) {
  const access = await activityAccess(ctx, organizationId);
  const since = new Date(Date.now() - (Date.now() % 86_400_000) - (days - 1) * 86_400_000);
  const rows = await db().auditLog.findMany({
    where: {
      organizationId,
      createdAt: { gte: since },
      ...(access.all ? {} : { actorId: access.userId }),
      ...(companyId ? { OR: [{ newValue: { path: ["companyId"], equals: companyId } }, { oldValue: { path: ["companyId"], equals: companyId } }] } : {}),
    },
    select: { createdAt: true },
    take: 20_000,
  });
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = r.createdAt.toISOString().slice(0, 10);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    return { day, count: counts.get(day) ?? 0 };
  });
}
