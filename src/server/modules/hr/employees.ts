import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { EmployeeStatus, EmploymentType } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, forbidden, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { can } from "@/server/modules/rbac/service";
import {
  actorId,
  authorize,
  day,
  employeeName,
  enumParam,
  isInReportingLine,
  isUuid,
  myEmployee,
  oneParam,
  optText,
  pageParam,
  patchText,
  requireEmployee,
  toDay,
  uuid,
} from "./access";
import { csvRecords, toCsv } from "./csv";
import { startChecklistTx } from "./onboarding";

/** Employee records: directory, profiles, lifecycle, history, designations, documents, user links and CSV import/export. */

export const EMPLOYEE_STATUSES = ["ONBOARDING", "ACTIVE", "ON_LEAVE", "OFFBOARDING", "TERMINATED"] as const;
export const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACTOR", "INTERN"] as const;
export const EMPLOYEE_SORTS = ["name", "title", "department", "start", "status"] as const;
export const DOCUMENT_CATEGORIES = ["contract", "id", "tax", "certificate", "review", "other"] as const;
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const PAGE_SIZE = 25;

/** Allowed lifecycle moves (TERMINATED can only be re-hired into onboarding). */
export const STATUS_TRANSITIONS: Record<EmployeeStatus, EmployeeStatus[]> = {
  ONBOARDING: ["ACTIVE", "OFFBOARDING", "TERMINATED"],
  ACTIVE: ["ON_LEAVE", "OFFBOARDING", "TERMINATED"],
  ON_LEAVE: ["ACTIVE", "OFFBOARDING", "TERMINATED"],
  OFFBOARDING: ["ACTIVE", "TERMINATED"],
  TERMINATED: ["ONBOARDING"],
};

const emptyToUndef = z.literal("").transform(() => undefined);
const emptyToNull = z.literal("").transform(() => null);
const optId = uuid.optional().or(emptyToUndef);
const patchId = uuid.nullable().optional().or(emptyToNull);
const skills = z.array(z.string().trim().min(1).max(60)).max(50);

export const employeeInput = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: optText(100),
  email: z.string().trim().email().max(254).optional().or(emptyToUndef),
  phone: optText(40),
  title: optText(120),
  designationId: optId,
  departmentId: optId,
  teamId: optId,
  managerId: optId,
  employmentType: z.enum(EMPLOYMENT_TYPES).default("FULL_TIME"),
  status: z.enum(["ONBOARDING", "ACTIVE"]).default("ACTIVE"),
  startDate: day.optional().or(emptyToUndef),
  location: optText(120),
  timezone: optText(64),
  employeeNumber: optText(40),
  skills: skills.default([]),
  /** Start the default onboarding checklist (status ONBOARDING only). */
  startOnboarding: z.boolean().default(true),
});

export const employeePatch = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: patchText(100),
  email: z.string().trim().email().max(254).nullable().optional().or(emptyToNull),
  phone: patchText(40),
  title: patchText(120),
  designationId: patchId,
  departmentId: patchId,
  teamId: patchId,
  managerId: patchId,
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  startDate: day.nullable().optional().or(emptyToNull),
  location: patchText(120),
  timezone: patchText(64),
  employeeNumber: patchText(40),
  skills: skills.optional(),
  workScheduleId: patchId,
  personalEmail: z.string().trim().email().max(254).nullable().optional().or(emptyToNull),
  dateOfBirth: day.nullable().optional().or(emptyToNull),
  address: patchText(500),
  emergencyName: patchText(120),
  emergencyPhone: patchText(40),
  bio: patchText(2000),
});

/** Fields an employee may edit on their own profile. */
export const selfPatch = employeePatch.pick({ phone: true, personalEmail: true, address: true, emergencyName: true, emergencyPhone: true, bio: true, skills: true, timezone: true });

export const statusInput = z.object({
  status: z.enum(EMPLOYEE_STATUSES),
  note: optText(1000),
  /** Effective date (end date when terminating). */
  date: day.optional().or(emptyToUndef),
  /** Start the offboarding/onboarding checklist that goes with the move. */
  startChecklist: z.boolean().default(true),
});
export const linkUserInput = z.object({ userId: uuid.nullable() });
export const designationInput = z.object({ name: z.string().trim().min(1).max(120), level: optText(40), description: optText(1000) });
export const designationPatch = z.object({ name: z.string().trim().min(1).max(120).optional(), level: patchText(40), description: patchText(1000) });
export const documentInput = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.enum(DOCUMENT_CATEGORIES).default("other"),
  filename: z.string().trim().min(1).max(200),
  contentBase64: z.string().min(1).max(Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 8),
});
export const importInput = z.object({ csv: z.string().min(1).max(2_000_000) });

const DOC_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".txt": "text/plain",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".odt": "application/vnd.oasis.opendocument.text",
};
export const ACCEPTED_DOCUMENT_EXTENSIONS = Object.keys(DOC_TYPES);

const nil = (v?: string | null) => (v ? v : null);

export interface EmployeeFilters {
  q?: string;
  department?: string;
  team?: string;
  status?: EmployeeStatus | "CURRENT";
  type?: EmploymentType;
  sort: (typeof EMPLOYEE_SORTS)[number];
  dir: "asc" | "desc";
  page: number;
}

export function parseEmployeeFilters(raw: Record<string, string | string[] | undefined>): EmployeeFilters {
  const department = oneParam(raw, "department");
  const team = oneParam(raw, "team");
  const status = oneParam(raw, "status");
  return {
    q: oneParam(raw, "q"),
    department: department === "none" || isUuid(department) ? department : undefined,
    team: team === "none" || isUuid(team) ? team : undefined,
    status: status === "CURRENT" ? "CURRENT" : enumParam(raw, "status", EMPLOYEE_STATUSES),
    type: enumParam(raw, "type", EMPLOYMENT_TYPES),
    sort: enumParam(raw, "sort", EMPLOYEE_SORTS) ?? "name",
    dir: oneParam(raw, "dir") === "desc" ? "desc" : "asc",
    page: pageParam(raw),
  };
}

function employeeWhere(organizationId: string, companyId: string, f: Partial<EmployeeFilters>): Prisma.EmployeeWhereInput {
  const where: Prisma.EmployeeWhereInput = { organizationId, companyId, archivedAt: null };
  if (f.department) where.departmentId = f.department === "none" ? null : f.department;
  if (f.team) where.teamId = f.team === "none" ? null : f.team;
  if (f.status === "CURRENT") where.status = { not: "TERMINATED" };
  else if (f.status) where.status = f.status;
  if (f.type) where.employmentType = f.type;
  if (f.q) {
    const contains = { contains: f.q, mode: "insensitive" as const };
    where.OR = [{ firstName: contains }, { lastName: contains }, { email: contains }, { title: contains }, { employeeNumber: contains }, { skills: { has: f.q } }, { location: contains }];
  }
  return where;
}

const directorySelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  title: true,
  status: true,
  employmentType: true,
  startDate: true,
  location: true,
  employeeNumber: true,
  userId: true,
  skills: true,
  department: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  manager: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.EmployeeSelect;

export async function listEmployees(ctx: RequestContext, organizationId: string, companyId: string, f: Partial<EmployeeFilters> = {}) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  const where = employeeWhere(organizationId, companyId, f);
  const dir = f.dir ?? "asc";
  const orderBy: Prisma.EmployeeOrderByWithRelationInput[] =
    f.sort === "title"
      ? [{ title: { sort: dir, nulls: "last" } }, { firstName: "asc" }]
      : f.sort === "department"
        ? [{ department: { name: dir } }, { firstName: "asc" }]
        : f.sort === "start"
          ? [{ startDate: { sort: dir, nulls: "last" } }, { firstName: "asc" }]
          : f.sort === "status"
            ? [{ status: dir }, { firstName: "asc" }]
            : [{ firstName: dir }, { lastName: dir }];
  const page = f.page ?? 1;
  const [rows, total] = await Promise.all([
    db().employee.findMany({ where, orderBy, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, select: directorySelect }),
    db().employee.count({ where }),
  ]);
  return { rows, total, page, pageSize: PAGE_SIZE, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/** Light list for pickers (manager, interviewer, lead...). */
export async function employeeOptions(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  return db().employee.findMany({
    where: { organizationId, companyId, archivedAt: null, status: { not: "TERMINATED" } },
    select: { id: true, firstName: true, lastName: true, title: true, userId: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: 2000,
  });
}

/**
 * Employee profile. Directory fields for hr.read; personal details, documents and history for HR managers, the
 * employee themselves and their managers (personal details and documents: HR and self only).
 */
export async function getEmployee(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string) {
  const chain = await authorize(ctx, organizationId, companyId, "hr.read");
  const e = await db().employee.findFirst({
    where: { id: isUuid(employeeId) ? employeeId : "00000000-0000-0000-0000-000000000000", organizationId, companyId },
    include: {
      department: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      designation: { select: { id: true, name: true, level: true } },
      workSchedule: { select: { id: true, name: true } },
      manager: { select: { id: true, firstName: true, lastName: true, title: true } },
      reports: { where: { archivedAt: null, status: { not: "TERMINATED" } }, select: { id: true, firstName: true, lastName: true, title: true, status: true }, orderBy: { firstName: "asc" } },
      user: { select: { id: true, name: true, email: true } },
    },
  });
  if (!e) throw notFound("Employee");
  const manage = await can(ctx, "hr.manage", chain);
  const me = await myEmployee(db(), ctx, organizationId, companyId);
  const isSelf = me?.id === e.id;
  const isManager = !!me && !isSelf && (await isInReportingLine(db(), companyId, e.id, me.id));
  const privileged = manage || isSelf;
  const [history, documents] = await Promise.all([
    privileged || isManager ? db().hrEmployeeEvent.findMany({ where: { employeeId: e.id, companyId }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
    privileged
      ? db().hrDocument.findMany({
          where: { employeeId: e.id, companyId },
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, category: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true },
        })
      : [],
  ]);
  const personal = privileged
    ? { personalEmail: e.personalEmail, dateOfBirth: e.dateOfBirth, address: e.address, emergencyName: e.emergencyName, emergencyPhone: e.emergencyPhone }
    : { personalEmail: null, dateOfBirth: null, address: null, emergencyName: null, emergencyPhone: null };
  return { ...e, ...personal, history, documents, access: { manage, isSelf, isManager, privileged } };
}

async function validateRefs(tx: Tx, organizationId: string, companyId: string, refs: { designationId?: string | null; departmentId?: string | null; teamId?: string | null; managerId?: string | null; workScheduleId?: string | null }, selfId?: string) {
  if (refs.departmentId && !(await tx.department.findFirst({ where: { id: refs.departmentId, organizationId, companyId, archivedAt: null }, select: { id: true } }))) throw notFound("Department");
  if (refs.teamId && !(await tx.team.findFirst({ where: { id: refs.teamId, organizationId, companyId, archivedAt: null }, select: { id: true } }))) throw notFound("Team");
  if (refs.designationId && !(await tx.hrDesignation.findFirst({ where: { id: refs.designationId, organizationId, companyId, archivedAt: null }, select: { id: true } }))) throw notFound("Designation");
  if (refs.workScheduleId && !(await tx.hrWorkSchedule.findFirst({ where: { id: refs.workScheduleId, organizationId, companyId, archivedAt: null }, select: { id: true } }))) throw notFound("Work schedule");
  if (refs.managerId) {
    await requireEmployee(tx, organizationId, companyId, refs.managerId);
    if (selfId && (refs.managerId === selfId || (await isInReportingLine(tx, companyId, refs.managerId, selfId)))) {
      throw invalid("This would create a reporting loop", { reason: "hr_manager_cycle" });
    }
  }
}

export async function logEmployeeEvent(tx: Tx, ctx: RequestContext, e: { id: string; organizationId: string; companyId: string }, kind: string, fromValue?: string | null, toValue?: string | null, note?: string | null) {
  await tx.hrEmployeeEvent.create({
    data: { organizationId: e.organizationId, companyId: e.companyId, employeeId: e.id, kind, fromValue: fromValue ?? null, toValue: toValue ?? null, note: note ?? null, actorId: ctx.actor.id },
  });
}

export async function emitJoined(tx: Tx, ctx: RequestContext, e: { id: string; organizationId: string; companyId: string; firstName: string; lastName: string | null; title: string | null; departmentId: string | null; startDate: Date | null; employmentType: string }) {
  await emitDomainEvent(tx, ctx, "employee.joined", {
    organizationId: e.organizationId,
    companyId: e.companyId,
    entityType: "employee",
    entityId: e.id,
    data: { name: employeeName(e), title: e.title, departmentId: e.departmentId, startDate: e.startDate, employmentType: e.employmentType },
  });
}

const designationTitle = async (tx: Tx, id?: string | null) => (id ? ((await tx.hrDesignation.findFirst({ where: { id }, select: { name: true } }))?.name ?? null) : null);

const uniqueNumber = (e: unknown) => {
  if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") throw conflict("This employee number is already used", { reason: "hr_employee_number_taken" });
  throw e;
};

export async function createEmployee(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof employeeInput>, opts: { tx?: Tx } = {}) {
  const input = employeeInput.parse(raw);
  const run = async (tx: Tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    await validateRefs(tx, organizationId, companyId, input);
    const title = input.title || (await designationTitle(tx, input.designationId));
    const e = await tx.employee
      .create({
        data: {
          organizationId,
          companyId,
          firstName: input.firstName,
          lastName: nil(input.lastName),
          email: nil(input.email),
          phone: nil(input.phone),
          title,
          designationId: nil(input.designationId),
          departmentId: nil(input.departmentId),
          teamId: nil(input.teamId),
          managerId: nil(input.managerId),
          employmentType: input.employmentType,
          status: input.status,
          startDate: toDay(input.startDate),
          location: nil(input.location),
          timezone: nil(input.timezone),
          employeeNumber: nil(input.employeeNumber),
          skills: input.skills,
          createdById: actorId(ctx, organizationId),
        },
      })
      .catch(uniqueNumber);
    await logEmployeeEvent(tx, ctx, e, "created", null, e.status);
    if (e.status === "ACTIVE") await emitJoined(tx, ctx, e);
    if (e.status === "ONBOARDING" && input.startOnboarding) await startChecklistTx(tx, ctx, organizationId, companyId, { employeeId: e.id, kind: "ONBOARDING" });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.employee.created", resourceType: "employee", resourceId: e.id, newValue: { name: employeeName(e), status: e.status, title } });
    return e;
  };
  return opts.tx ? run(opts.tx) : transaction(run);
}

export async function updateEmployee(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string, raw: z.input<typeof employeePatch>) {
  const input = employeePatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const before = await requireEmployee(tx, organizationId, companyId, employeeId);
    await validateRefs(tx, organizationId, companyId, input, employeeId);
    const data: Prisma.EmployeeUncheckedUpdateInput = {};
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) continue;
      if (k === "startDate" || k === "dateOfBirth") (data as Record<string, unknown>)[k] = toDay(v as string | null);
      else (data as Record<string, unknown>)[k] = v === "" ? null : v;
    }
    if (input.designationId && input.title === undefined) data.title = await designationTitle(tx, input.designationId);
    const e = await tx.employee.update({ where: { id: employeeId }, data }).catch(uniqueNumber);
    if (before.title !== e.title || before.departmentId !== e.departmentId) await logEmployeeEvent(tx, ctx, e, "job", [before.title, before.departmentId].filter(Boolean).join(" · ") || null, [e.title, e.departmentId].filter(Boolean).join(" · ") || null);
    if (before.managerId !== e.managerId) await logEmployeeEvent(tx, ctx, e, "manager", before.managerId, e.managerId);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.employee.updated", resourceType: "employee", resourceId: employeeId, newValue: Object.keys(input) });
    return e;
  });
}

/** The signed-in employee edits their own contact and personal details. */
export async function updateMyProfile(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof selfPatch>) {
  const input = selfPatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.read", tx);
    const me = await myEmployee(tx, ctx, organizationId, companyId);
    if (!me) throw forbidden("Your account is not linked to an employee record", { reason: "hr_not_employee" });
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) if (v !== undefined) data[k] = v === "" ? null : v;
    const e = await tx.employee.update({ where: { id: me.id }, data });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.employee.self_updated", resourceType: "employee", resourceId: me.id, newValue: Object.keys(input) });
    return e;
  });
}

/** Lifecycle move with history; emits employee.joined (→ ACTIVE the first time) and employee.left (→ TERMINATED). */
export async function changeEmployeeStatus(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string, raw: z.input<typeof statusInput>, opts: { tx?: Tx } = {}) {
  const input = statusInput.parse(raw);
  const run = async (tx: Tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const before = await requireEmployee(tx, organizationId, companyId, employeeId);
    if (before.status === input.status) return before;
    if (!STATUS_TRANSITIONS[before.status].includes(input.status)) {
      throw invalid(`Can't move from ${before.status} to ${input.status}`, { reason: "hr_status_transition" });
    }
    const date = toDay(input.date) ?? toDay(new Date().toISOString().slice(0, 10))!;
    const data: Prisma.EmployeeUncheckedUpdateInput = { status: input.status };
    if (input.status === "TERMINATED") data.endDate = date;
    if (input.status === "ONBOARDING") {
      data.endDate = null;
      data.startDate = date;
    }
    if (input.status === "ACTIVE" && !before.startDate) data.startDate = date;
    // employee.joined fires when someone becomes active for the first time (or again after re-hire via onboarding).
    const wasActiveBefore =
      input.status === "ACTIVE" && before.status !== "ONBOARDING"
        ? (await tx.hrEmployeeEvent.count({ where: { employeeId, companyId, toValue: "ACTIVE", kind: { in: ["status", "created"] } } })) > 0
        : false;
    const e = await tx.employee.update({ where: { id: employeeId }, data });
    await logEmployeeEvent(tx, ctx, e, "status", before.status, e.status, input.note);
    if (input.status === "ACTIVE" && !wasActiveBefore) await emitJoined(tx, ctx, e);
    if (input.status === "TERMINATED") {
      await emitDomainEvent(tx, ctx, "employee.left", {
        organizationId,
        companyId,
        entityType: "employee",
        entityId: e.id,
        data: { name: employeeName(e), title: e.title, departmentId: e.departmentId, endDate: date, previousStatus: before.status },
      });
      // Nobody reports to a former employee; their reports move up to their manager.
      await tx.employee.updateMany({ where: { companyId, managerId: e.id }, data: { managerId: e.managerId } });
    }
    if (input.startChecklist && input.status === "OFFBOARDING") await startChecklistTx(tx, ctx, organizationId, companyId, { employeeId: e.id, kind: "OFFBOARDING", startDate: date });
    if (input.startChecklist && input.status === "ONBOARDING") await startChecklistTx(tx, ctx, organizationId, companyId, { employeeId: e.id, kind: "ONBOARDING", startDate: date });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.employee.status_changed", resourceType: "employee", resourceId: employeeId, oldValue: { status: before.status }, newValue: { status: e.status, note: input.note } });
    return e;
  };
  return opts.tx ? run(opts.tx) : transaction(run);
}

/** Remove an employee record from the directory (kept for history). Terminate first. */
export async function archiveEmployee(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const e = await requireEmployee(tx, organizationId, companyId, employeeId);
    if (e.status !== "TERMINATED") throw invalid("Terminate the employee before archiving the record", { reason: "hr_archive_requires_terminated" });
    await tx.employee.update({ where: { id: employeeId }, data: { archivedAt: new Date(), userId: null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.employee.archived", resourceType: "employee", resourceId: employeeId });
    return { ok: true };
  });
}

/** Active organization members that can be linked to employee records (users.read). */
export async function linkableUsers(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "users.read");
  const members = await db().membership.findMany({
    where: { organizationId, status: "ACTIVE", user: { status: "ACTIVE" } },
    select: { user: { select: { id: true, name: true, email: true } } },
    take: 2000,
  });
  return members.map((m) => m.user).sort((a, b) => a.name.localeCompare(b.name));
}

export async function linkEmployeeUser(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string, raw: z.input<typeof linkUserInput>) {
  const input = linkUserInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    await authorize(ctx, organizationId, companyId, "users.read", tx);
    const e = await requireEmployee(tx, organizationId, companyId, employeeId);
    if (input.userId) {
      const member = await tx.membership.findFirst({ where: { organizationId, userId: input.userId, status: "ACTIVE" }, select: { id: true } });
      if (!member) throw invalid("This person is not a member of the organization", { reason: "hr_user_not_member" });
      const taken = await tx.employee.findFirst({ where: { companyId, userId: input.userId, archivedAt: null, id: { not: employeeId } }, select: { id: true } });
      if (taken) throw conflict("This user is already linked to another employee", { reason: "hr_user_already_linked" });
    }
    await tx.employee.update({ where: { id: employeeId }, data: { userId: input.userId } });
    await logEmployeeEvent(tx, ctx, e, "user_link", e.userId, input.userId);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.employee.user_linked", resourceType: "employee", resourceId: employeeId, oldValue: { userId: e.userId }, newValue: input });
    return { ok: true };
  });
}

// ─── Designations ───────────────────────────────────────────────────────────────────────────────────────────────────

export async function listDesignations(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  return db().hrDesignation.findMany({
    where: { organizationId, companyId, archivedAt: null },
    orderBy: { name: "asc" },
    include: { _count: { select: { employees: { where: { archivedAt: null, status: { not: "TERMINATED" } } } } } },
  });
}

const nameTaken = (e: unknown) => {
  if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") throw conflict("This name is already used", { reason: "hr_name_taken" });
  throw e;
};

export async function createDesignation(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof designationInput>) {
  const input = designationInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const d = await tx.hrDesignation.create({ data: { organizationId, companyId, name: input.name, level: nil(input.level), description: nil(input.description) } }).catch(nameTaken);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.designation.created", resourceType: "hr_designation", resourceId: d.id, newValue: input });
    return d;
  });
}

export async function updateDesignation(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof designationPatch>) {
  const input = designationPatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    if (!isUuid(id) || !(await tx.hrDesignation.findFirst({ where: { id, organizationId, companyId, archivedAt: null } }))) throw notFound("Designation");
    const d = await tx.hrDesignation
      .update({ where: { id }, data: { ...(input.name ? { name: input.name } : {}), ...(input.level !== undefined ? { level: nil(input.level) } : {}), ...(input.description !== undefined ? { description: nil(input.description) } : {}) } })
      .catch(nameTaken);
    if (input.name) await tx.employee.updateMany({ where: { companyId, designationId: id }, data: { title: input.name } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.designation.updated", resourceType: "hr_designation", resourceId: id, newValue: input });
    return d;
  });
}

export async function archiveDesignation(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const d = isUuid(id) ? await tx.hrDesignation.findFirst({ where: { id, organizationId, companyId, archivedAt: null } }) : null;
    if (!d) throw notFound("Designation");
    await tx.employee.updateMany({ where: { companyId, designationId: id }, data: { designationId: null } });
    await tx.hrDesignation.update({ where: { id }, data: { archivedAt: new Date(), name: `${d.name} (archived ${d.id.slice(0, 8)})` } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.designation.archived", resourceType: "hr_designation", resourceId: id });
    return { ok: true };
  });
}

// ─── Documents ──────────────────────────────────────────────────────────────────────────────────────────────────────

async function requireDocAccess(tx: Tx | ReturnType<typeof db>, ctx: RequestContext, organizationId: string, companyId: string, employeeId: string) {
  const me = await myEmployee(tx, ctx, organizationId, companyId);
  if (me?.id === employeeId) await authorize(ctx, organizationId, companyId, "hr.read");
  else await authorize(ctx, organizationId, companyId, "hr.manage");
}

export async function uploadDocument(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string, raw: z.input<typeof documentInput>) {
  const input = documentInput.parse(raw);
  const ext = input.filename.includes(".") ? input.filename.slice(input.filename.lastIndexOf(".")).toLowerCase() : "";
  const mimeType = DOC_TYPES[ext];
  if (!mimeType) throw invalid("Unsupported file type", { reason: "hr_file_type" });
  const bytes = Buffer.from(input.contentBase64, "base64");
  if (!bytes.length) throw invalid("The file is empty");
  if (bytes.length > MAX_DOCUMENT_BYTES) throw invalid("The file exceeds 5 MB", { reason: "hr_file_too_large" });
  return transaction(async (tx) => {
    await requireDocAccess(tx, ctx, organizationId, companyId, employeeId);
    const e = await requireEmployee(tx, organizationId, companyId, employeeId);
    const doc = await tx.hrDocument.create({
      data: { organizationId, companyId, employeeId: e.id, name: input.name, category: input.category, filename: input.filename, mimeType, sizeBytes: bytes.length, content: bytes, uploadedById: ctx.actor.id },
      select: { id: true, name: true },
    });
    await logEmployeeEvent(tx, ctx, e, "document", null, input.name);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.document.uploaded", resourceType: "hr_document", resourceId: doc.id, newValue: { employeeId, name: input.name, size: bytes.length } });
    return doc;
  });
}

/** The file of a document, for the RBAC-checked download route. */
export async function getDocumentFile(ctx: RequestContext, organizationId: string, companyId: string, documentId: string) {
  if (!isUuid(documentId)) throw notFound("Document");
  const doc = await db().hrDocument.findFirst({ where: { id: documentId, organizationId, companyId } });
  if (!doc) throw notFound("Document");
  await requireDocAccess(db(), ctx, organizationId, companyId, doc.employeeId);
  return doc;
}

export async function deleteDocument(ctx: RequestContext, organizationId: string, companyId: string, documentId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    if (!isUuid(documentId)) throw notFound("Document");
    const doc = await tx.hrDocument.findFirst({ where: { id: documentId, organizationId, companyId }, select: { id: true, name: true, employeeId: true } });
    if (!doc) throw notFound("Document");
    await tx.hrDocument.delete({ where: { id: documentId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.document.deleted", resourceType: "hr_document", resourceId: documentId, oldValue: doc });
    return { ok: true };
  });
}

// ─── CSV ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const CSV_HEADER = ["employee_number", "first_name", "last_name", "email", "phone", "title", "department", "team", "manager_email", "employment_type", "status", "start_date", "location", "skills"];

export async function exportEmployeesCsv(ctx: RequestContext, organizationId: string, companyId: string, f: Partial<EmployeeFilters> = {}) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  const rows = await db().employee.findMany({
    where: employeeWhere(organizationId, companyId, f),
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: 20_000,
    select: { ...directorySelect, manager: { select: { email: true } } },
  });
  return toCsv(
    CSV_HEADER,
    rows.map((e) => [
      e.employeeNumber,
      e.firstName,
      e.lastName,
      e.email,
      e.phone,
      e.title,
      e.department?.name,
      e.team?.name,
      e.manager?.email,
      e.employmentType,
      e.status,
      e.startDate ? e.startDate.toISOString().slice(0, 10) : "",
      e.location,
      e.skills.join("; "),
    ]),
  );
}

/**
 * Import employees from CSV (CSV_HEADER columns; first_name required). Rows whose email or employee number matches an
 * existing employee update that record; departments and teams are created by name when missing; managers are linked
 * by email after all rows are in.
 */
export async function importEmployeesCsv(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof importInput>) {
  const { csv } = importInput.parse(raw);
  const records = csvRecords(csv);
  if (!records.length) throw invalid("The file has no rows", { reason: "hr_csv_empty" });
  if (records.length > 2000) throw invalid("At most 2,000 rows per import", { reason: "hr_csv_too_many" });
  if (!("first_name" in records[0]!)) throw invalid("Missing first_name column", { reason: "hr_csv_columns" });
  return transaction(
    async (tx) => {
      await authorize(ctx, organizationId, companyId, "hr.manage", tx);
      const deptCache = new Map<string, string>();
      const teamCache = new Map<string, string>();
      const deptId = async (name: string) => {
        const key = name.toLowerCase();
        if (deptCache.has(key)) return deptCache.get(key)!;
        const d =
          (await tx.department.findFirst({ where: { companyId, organizationId, archivedAt: null, name: { equals: name, mode: "insensitive" } }, select: { id: true } })) ??
          (await tx.department.create({ data: { organizationId, companyId, name }, select: { id: true } }));
        deptCache.set(key, d.id);
        return d.id;
      };
      const teamId = async (name: string, departmentId: string | null) => {
        const key = name.toLowerCase();
        if (teamCache.has(key)) return teamCache.get(key)!;
        const t =
          (await tx.team.findFirst({ where: { companyId, organizationId, archivedAt: null, name: { equals: name, mode: "insensitive" } }, select: { id: true } })) ??
          (await tx.team.create({ data: { organizationId, companyId, name, departmentId }, select: { id: true } }));
        teamCache.set(key, t.id);
        return t.id;
      };
      let created = 0;
      let updated = 0;
      const errors: { row: number; message: string }[] = [];
      const managerLinks: { id: string; managerEmail: string }[] = [];
      for (const [i, r] of records.entries()) {
        const rowNo = i + 2;
        const firstName = r["first_name"]?.slice(0, 100);
        if (!firstName) {
          errors.push({ row: rowNo, message: "first_name is required" });
          continue;
        }
        const email = r["email"]?.toLowerCase().slice(0, 254) || null;
        if (email && !z.string().email().safeParse(email).success) {
          errors.push({ row: rowNo, message: "invalid email" });
          continue;
        }
        const type = (r["employment_type"] || "FULL_TIME").toUpperCase().replace(/[\s-]/g, "_");
        const status = (r["status"] || "ACTIVE").toUpperCase().replace(/[\s-]/g, "_");
        if (!(EMPLOYMENT_TYPES as readonly string[]).includes(type) || !(EMPLOYEE_STATUSES as readonly string[]).includes(status)) {
          errors.push({ row: rowNo, message: "invalid employment_type or status" });
          continue;
        }
        const start = r["start_date"];
        if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
          errors.push({ row: rowNo, message: "start_date must be YYYY-MM-DD" });
          continue;
        }
        const departmentId = r["department"] ? await deptId(r["department"].slice(0, 120)) : null;
        const data = {
          firstName,
          lastName: r["last_name"]?.slice(0, 100) || null,
          email,
          phone: r["phone"]?.slice(0, 40) || null,
          title: r["title"]?.slice(0, 120) || null,
          departmentId,
          teamId: r["team"] ? await teamId(r["team"].slice(0, 120), departmentId) : null,
          employmentType: type as EmploymentType,
          startDate: toDay(start || null),
          location: r["location"]?.slice(0, 120) || null,
          skills: (r["skills"] ?? "").split(/[;|]/).map((s) => s.trim()).filter(Boolean).slice(0, 50),
        };
        const number = r["employee_number"]?.slice(0, 40) || null;
        const existing =
          (number ? await tx.employee.findFirst({ where: { companyId, employeeNumber: number, archivedAt: null } }) : null) ??
          (email ? await tx.employee.findFirst({ where: { companyId, email: { equals: email, mode: "insensitive" }, archivedAt: null } }) : null);
        if (existing) {
          await tx.employee.update({ where: { id: existing.id }, data: { ...data, employeeNumber: number ?? existing.employeeNumber } });
          updated++;
          if (r["manager_email"]) managerLinks.push({ id: existing.id, managerEmail: r["manager_email"].toLowerCase() });
        } else {
          const e = await tx.employee.create({ data: { organizationId, companyId, ...data, employeeNumber: number, status: status as EmployeeStatus, createdById: actorId(ctx, organizationId) } });
          await logEmployeeEvent(tx, ctx, e, "created", null, e.status, "CSV import");
          if (e.status === "ACTIVE") await emitJoined(tx, ctx, e);
          created++;
          if (r["manager_email"]) managerLinks.push({ id: e.id, managerEmail: r["manager_email"].toLowerCase() });
        }
      }
      for (const link of managerLinks) {
        const m = await tx.employee.findFirst({ where: { companyId, archivedAt: null, email: { equals: link.managerEmail, mode: "insensitive" } }, select: { id: true } });
        if (m && m.id !== link.id && !(await isInReportingLine(tx, companyId, m.id, link.id))) await tx.employee.update({ where: { id: link.id }, data: { managerId: m.id } });
      }
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.employee.imported", resourceType: "employee", resourceId: null, newValue: { created, updated, errors: errors.length } });
      return { created, updated, errors: errors.slice(0, 100) };
    },
    { timeout: 120_000 },
  );
}

/** Day of employment status for headcount reports. */
export const isCurrent = (s: EmployeeStatus) => s !== "TERMINATED";
