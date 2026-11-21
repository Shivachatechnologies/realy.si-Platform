import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { HrRequestStatus } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { forbidden, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { can } from "@/server/modules/rbac/service";
import { actorId, authorize, employeeName, isUuid, myEmployee, optText, patchText, uuid } from "./access";

/** HR policies (versioned documents with acknowledgement tracking) and generic employee requests to HR. */

export const POLICY_CATEGORIES = ["general", "conduct", "leave", "security", "benefits", "remote", "health"] as const;
export const REQUEST_TYPES = ["equipment", "document", "data_change", "expense", "other"] as const;
export const REQUEST_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "REJECTED"] as const;

export const policyInput = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.enum(POLICY_CATEGORIES).default("general"),
  body: z.string().trim().min(1).max(100_000),
  requiresAck: z.boolean().default(true),
  publish: z.boolean().default(false),
});
export const policyPatch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  category: z.enum(POLICY_CATEGORIES).optional(),
  body: z.string().trim().min(1).max(100_000).optional(),
  requiresAck: z.boolean().optional(),
  publish: z.boolean().optional(),
});
export const requestInput = z.object({
  type: z.enum(REQUEST_TYPES),
  subject: z.string().trim().min(1).max(200),
  details: optText(5000),
  /** HR may file on behalf of an employee. */
  employeeId: uuid.optional().or(z.literal("").transform(() => undefined)),
});
export const requestPatch = z.object({ status: z.enum(REQUEST_STATUSES), resolution: patchText(5000) });

const currentHeadcountWhere = (organizationId: string, companyId: string) => ({ organizationId, companyId, archivedAt: null, status: { not: "TERMINATED" as const } });

export async function listPolicies(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await authorize(ctx, organizationId, companyId, "hr.read");
  const manage = await can(ctx, "hr.manage", chain);
  const me = await myEmployee(db(), ctx, organizationId, companyId);
  const policies = await db().hrPolicy.findMany({
    where: { organizationId, companyId, archivedAt: null, ...(manage ? {} : { publishedAt: { not: null } }) },
    orderBy: [{ category: "asc" }, { title: "asc" }],
    take: 300,
  });
  const [acks, headcount, myAcks] = await Promise.all([
    manage ? db().hrPolicyAck.groupBy({ by: ["policyId", "version"], where: { companyId, policyId: { in: policies.map((p) => p.id) }, employee: currentHeadcountWhere(organizationId, companyId) }, _count: { _all: true } }) : [],
    manage ? db().employee.count({ where: currentHeadcountWhere(organizationId, companyId) }) : 0,
    me ? db().hrPolicyAck.findMany({ where: { companyId, employeeId: me.id, policyId: { in: policies.map((p) => p.id) } }, select: { policyId: true, version: true, acknowledgedAt: true } }) : [],
  ]);
  return policies.map((p) => ({
    ...p,
    ackCount: acks.find((a) => a.policyId === p.id && a.version === p.version)?._count._all ?? 0,
    headcount,
    myAck: myAcks.find((a) => a.policyId === p.id && a.version === p.version) ?? null,
  }));
}

export async function getPolicy(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  const chain = await authorize(ctx, organizationId, companyId, "hr.read");
  const manage = await can(ctx, "hr.manage", chain);
  if (!isUuid(id)) throw notFound("Policy");
  const p = await db().hrPolicy.findFirst({ where: { id, organizationId, companyId, archivedAt: null, ...(manage ? {} : { publishedAt: { not: null } }) } });
  if (!p) throw notFound("Policy");
  const me = await myEmployee(db(), ctx, organizationId, companyId);
  const myAck = me ? await db().hrPolicyAck.findFirst({ where: { policyId: id, employeeId: me.id, version: p.version } }) : null;
  let tracking: { employee: { id: string; firstName: string; lastName: string | null }; acknowledgedAt: Date | null }[] = [];
  if (manage) {
    const [people, acks] = await Promise.all([
      db().employee.findMany({ where: currentHeadcountWhere(organizationId, companyId), select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: "asc" }, take: 2000 }),
      db().hrPolicyAck.findMany({ where: { policyId: id, version: p.version }, select: { employeeId: true, acknowledgedAt: true } }),
    ]);
    tracking = people.map((e) => ({ employee: e, acknowledgedAt: acks.find((a) => a.employeeId === e.id)?.acknowledgedAt ?? null }));
  }
  return { ...p, myAck, tracking, canAck: !!me && !!p.publishedAt && p.requiresAck, manage };
}

export async function createPolicy(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof policyInput>) {
  const input = policyInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const p = await tx.hrPolicy.create({
      data: { organizationId, companyId, title: input.title, category: input.category, body: input.body, requiresAck: input.requiresAck, publishedAt: input.publish ? new Date() : null, createdById: actorId(ctx, organizationId) },
    });
    if (input.publish && input.requiresAck) await notifyAll(tx, organizationId, companyId, p.title, p.id);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.policy.created", resourceType: "hr_policy", resourceId: p.id, newValue: { title: p.title, published: input.publish } });
    return p;
  });
}

async function notifyAll(tx: Parameters<Parameters<typeof transaction>[0]>[0], organizationId: string, companyId: string, title: string, policyId: string) {
  const people = await tx.employee.findMany({ where: { ...currentHeadcountWhere(organizationId, companyId), userId: { not: null } }, select: { userId: true } });
  await notifyUsers(tx, organizationId, people.map((p) => p.userId), "hr.policy_published", { companyId, title, href: `/hr/policies/${policyId}` });
}

/** Editing the body of a published policy bumps its version, so everyone acknowledges the new text. */
export async function updatePolicy(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof policyPatch>) {
  const input = policyPatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const p = isUuid(id) ? await tx.hrPolicy.findFirst({ where: { id, organizationId, companyId, archivedAt: null } }) : null;
    if (!p) throw notFound("Policy");
    const bodyChanged = input.body !== undefined && input.body !== p.body;
    const publishing = input.publish === true && !p.publishedAt;
    const updated = await tx.hrPolicy.update({
      where: { id },
      data: {
        ...(input.title ? { title: input.title } : {}),
        ...(input.category ? { category: input.category } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.requiresAck !== undefined ? { requiresAck: input.requiresAck } : {}),
        ...(bodyChanged && p.publishedAt ? { version: p.version + 1 } : {}),
        ...(publishing ? { publishedAt: new Date() } : input.publish === false ? { publishedAt: null } : {}),
      },
    });
    if (updated.publishedAt && updated.requiresAck && (publishing || (bodyChanged && p.publishedAt))) await notifyAll(tx, organizationId, companyId, updated.title, id);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.policy.updated", resourceType: "hr_policy", resourceId: id, oldValue: { version: p.version }, newValue: { version: updated.version, published: !!updated.publishedAt } });
    return updated;
  });
}

export async function archivePolicy(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const p = isUuid(id) ? await tx.hrPolicy.findFirst({ where: { id, organizationId, companyId, archivedAt: null } }) : null;
    if (!p) throw notFound("Policy");
    await tx.hrPolicy.update({ where: { id }, data: { archivedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.policy.archived", resourceType: "hr_policy", resourceId: id });
    return { ok: true };
  });
}

export async function acknowledgePolicy(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.read", tx);
    const me = await myEmployee(tx, ctx, organizationId, companyId);
    if (!me) throw forbidden("Your account is not linked to an employee record", { reason: "hr_not_employee" });
    const p = isUuid(id) ? await tx.hrPolicy.findFirst({ where: { id, organizationId, companyId, archivedAt: null, publishedAt: { not: null } } }) : null;
    if (!p) throw notFound("Policy");
    await tx.hrPolicyAck.upsert({
      where: { policyId_employeeId_version: { policyId: id, employeeId: me.id, version: p.version } },
      create: { organizationId, companyId, policyId: id, employeeId: me.id, version: p.version },
      update: {},
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.policy.acknowledged", resourceType: "hr_policy", resourceId: id, newValue: { version: p.version } });
    return { ok: true };
  });
}

// ─── Employee requests ──────────────────────────────────────────────────────────────────────────────────────────────

export async function listRequests(ctx: RequestContext, organizationId: string, companyId: string, filters: { status?: HrRequestStatus; mine?: boolean } = {}) {
  const chain = await authorize(ctx, organizationId, companyId, "hr.read");
  const manage = await can(ctx, "hr.manage", chain);
  const me = await myEmployee(db(), ctx, organizationId, companyId);
  const where: Prisma.HrEmployeeRequestWhereInput = { organizationId, companyId, ...(filters.status ? { status: filters.status } : {}) };
  if (filters.mine || !manage) {
    if (!me) return [];
    where.employeeId = me.id;
  }
  return db().hrEmployeeRequest.findMany({ where, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 300, include: { employee: { select: { id: true, firstName: true, lastName: true } } } });
}

export async function createRequest(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof requestInput>) {
  const input = requestInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "hr.read", tx);
    const me = await myEmployee(tx, ctx, organizationId, companyId);
    let employeeId = me?.id;
    if (input.employeeId && input.employeeId !== me?.id) {
      if (!(await can(ctx, "hr.manage", chain, tx))) throw forbidden("Only HR can file for someone else");
      employeeId = input.employeeId;
      if (!(await tx.employee.findFirst({ where: { id: employeeId, organizationId, companyId, archivedAt: null } }))) throw notFound("Employee");
    }
    if (!employeeId) throw forbidden("Your account is not linked to an employee record", { reason: "hr_not_employee" });
    const r = await tx.hrEmployeeRequest.create({ data: { organizationId, companyId, employeeId, type: input.type, subject: input.subject, details: input.details || null } });
    const name = me && me.id === employeeId ? employeeName(me) : input.subject;
    const recipients = (await usersWithPermission(tx, organizationId, companyId, "hr.manage")).filter((u) => u !== ctx.actor.id);
    await notifyUsers(tx, organizationId, recipients, "hr.request_created", { companyId, title: `${name}: ${input.subject}`, href: "/hr/requests" });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.request.created", resourceType: "hr_employee_request", resourceId: r.id, newValue: { type: input.type, subject: input.subject } });
    return r;
  });
}

export async function updateRequest(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof requestPatch>) {
  const input = requestPatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const r = isUuid(id) ? await tx.hrEmployeeRequest.findFirst({ where: { id, organizationId, companyId }, include: { employee: { select: { userId: true } } } }) : null;
    if (!r) throw notFound("Request");
    if ((input.status === "REJECTED" || input.status === "RESOLVED") && !input.resolution && !r.resolution) throw invalid("Add a resolution note", { reason: "hr_resolution_required" });
    const done = input.status === "RESOLVED" || input.status === "REJECTED";
    await tx.hrEmployeeRequest.update({
      where: { id },
      data: { status: input.status, ...(input.resolution !== undefined ? { resolution: input.resolution || null } : {}), handledById: ctx.actor.id, resolvedAt: done ? new Date() : null },
    });
    if (done) await notifyUsers(tx, organizationId, [r.employee.userId], "hr.request_updated", { companyId, title: r.subject, href: "/hr/me" });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.request.updated", resourceType: "hr_employee_request", resourceId: id, oldValue: { status: r.status }, newValue: input });
    return { ok: true };
  });
}

/** Published policies the viewer still has to acknowledge. */
export async function policiesToAcknowledge(ctx: RequestContext, organizationId: string, companyId: string) {
  return (await listPolicies(ctx, organizationId, companyId)).filter((p) => p.publishedAt && p.requiresAck && !p.myAck);
}
