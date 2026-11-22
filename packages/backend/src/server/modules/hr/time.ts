import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { HrLeaveStatus } from "@/generated/prisma/enums";
import { db, transaction, type Tx, type Db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, forbidden, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { can } from "@/server/modules/rbac/service";
import { actorId, authorize, day, employeeName, isInReportingLine, isUuid, myEmployee, optText, patchText, requireEmployee, toDay, uuid } from "./access";

/** Time & leave: attendance (clock in/out, timesheets), work schedules, leave types, allowances, balances, requests, holidays. */

export const LEAVE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
const emptyU = z.literal("").transform(() => undefined);
const nil = (v?: string | null) => (v ? v : null);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const clockInput = z.object({ action: z.enum(["in", "out"]), note: optText(500) });
export const manualAttendanceInput = z.object({ employeeId: uuid, date: day, clockIn: hhmm, clockOut: hhmm, note: optText(500) });
export const scheduleInput = z.object({
  name: z.string().trim().min(1).max(120),
  weekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7),
  startTime: hhmm,
  endTime: hhmm,
  breakMinutes: z.coerce.number().int().min(0).max(240).default(60),
  isDefault: z.boolean().default(false),
});
export const leaveTypeInput = z.object({
  name: z.string().trim().min(1).max(80),
  paid: z.boolean().default(true),
  yearlyAllowance: z.coerce.number().min(0).max(365).default(0),
  requiresApproval: z.boolean().default(true),
  color: optText(20),
});
export const leaveTypePatch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  paid: z.boolean().optional(),
  yearlyAllowance: z.coerce.number().min(0).max(365).optional(),
  requiresApproval: z.boolean().optional(),
  color: patchText(20),
});
export const allowanceInput = z.object({ employeeId: uuid, leaveTypeId: uuid, year: z.coerce.number().int().min(2000).max(2100), days: z.coerce.number().min(0).max(365) });
export const leaveRequestInput = z.object({
  /** HR may file for someone else; defaults to the signed-in employee. */
  employeeId: uuid.optional().or(emptyU),
  leaveTypeId: uuid,
  startDate: day,
  endDate: day,
  halfDay: z.boolean().default(false),
  reason: optText(1000),
});
export const leaveDecisionInput = z.object({ decision: z.enum(["APPROVED", "REJECTED", "CANCELLED"]), note: optText(1000) });
export const holidayInput = z.object({ name: z.string().trim().min(1).max(120), date: day });

/** Calendar date ("YYYY-MM-DD") of an instant in a timezone. */
export function localDay(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  return parts;
}

/** UTC instant of a wall-clock date and time in a timezone. */
export function zonedToUtc(date: string, time: string, timeZone: string) {
  const guess = new Date(`${date}T${time}:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(guess)
      .map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess.getTime() - (local - guess.getTime()));
}

async function companyTz(client: Tx | Db, companyId: string) {
  return (await client.company.findFirst({ where: { id: companyId }, select: { timezone: true } }))?.timezone ?? "UTC";
}

async function requireMe(client: Tx | Db, ctx: RequestContext, organizationId: string, companyId: string) {
  const me = await myEmployee(client, ctx, organizationId, companyId);
  if (!me) throw forbidden("Your account is not linked to an employee record", { reason: "hr_not_employee" });
  return me;
}

/** HR manager, the employee, or someone above them in the reporting line. */
async function canSee(client: Tx | Db, ctx: RequestContext, organizationId: string, companyId: string, employeeId: string) {
  const chain = await authorize(ctx, organizationId, companyId, "hr.read", client);
  if (await can(ctx, "hr.manage", chain, client)) return { manage: true, self: false, manager: false };
  const me = await myEmployee(client, ctx, organizationId, companyId);
  if (me?.id === employeeId) return { manage: false, self: true, manager: false };
  if (me && (await isInReportingLine(client, companyId, employeeId, me.id))) return { manage: false, self: false, manager: true };
  throw forbidden("Not visible", { reason: "hr_not_manager" });
}

// ─── Attendance ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function clock(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof clockInput>) {
  const input = clockInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.read", tx);
    const me = await requireMe(tx, ctx, organizationId, companyId);
    const open = await tx.hrAttendance.findFirst({ where: { companyId, employeeId: me.id, clockOut: null }, orderBy: { clockIn: "desc" } });
    const now = new Date();
    if (input.action === "in") {
      if (open) throw conflict("You are already clocked in", { reason: "hr_already_clocked_in" });
      const rec = await tx.hrAttendance.create({ data: { organizationId, companyId, employeeId: me.id, date: toDay(localDay(now, await companyTz(tx, companyId)))!, clockIn: now, note: nil(input.note) } });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.attendance.clock_in", resourceType: "hr_attendance", resourceId: rec.id });
      return rec;
    }
    if (!open) throw conflict("You are not clocked in", { reason: "hr_not_clocked_in" });
    const minutes = Math.max(0, Math.round((now.getTime() - open.clockIn.getTime()) / 60_000));
    const rec = await tx.hrAttendance.update({ where: { id: open.id }, data: { clockOut: now, minutes, note: input.note ? [open.note, input.note].filter(Boolean).join(" · ") : open.note } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.attendance.clock_out", resourceType: "hr_attendance", resourceId: rec.id, newValue: { minutes } });
    return rec;
  });
}

/** HR records or corrects a session (times are wall-clock times in the company timezone). */
export async function addManualAttendance(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof manualAttendanceInput>) {
  const input = manualAttendanceInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    await requireEmployee(tx, organizationId, companyId, input.employeeId);
    const tz = await companyTz(tx, companyId);
    const clockIn = zonedToUtc(input.date, input.clockIn, tz);
    const clockOut = zonedToUtc(input.date, input.clockOut, tz);
    if (clockOut <= clockIn) throw invalid("Clock-out must be after clock-in", { reason: "hr_date_range" });
    const rec = await tx.hrAttendance.create({
      data: { organizationId, companyId, employeeId: input.employeeId, date: toDay(input.date)!, clockIn, clockOut, minutes: Math.round((clockOut.getTime() - clockIn.getTime()) / 60_000), note: input.note ? `${input.note} (manual)` : "manual" },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.attendance.manual", resourceType: "hr_attendance", resourceId: rec.id, newValue: input });
    return rec;
  });
}

export async function deleteAttendance(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    if (!isUuid(id)) throw notFound("Attendance");
    const { count } = await tx.hrAttendance.deleteMany({ where: { id, organizationId, companyId } });
    if (!count) throw notFound("Attendance");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.attendance.deleted", resourceType: "hr_attendance", resourceId: id });
    return { ok: true };
  });
}

export async function myAttendance(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  const me = await myEmployee(db(), ctx, organizationId, companyId);
  if (!me) return { open: null, recent: [] };
  const [open, recent] = await Promise.all([
    db().hrAttendance.findFirst({ where: { companyId, employeeId: me.id, clockOut: null }, orderBy: { clockIn: "desc" } }),
    db().hrAttendance.findMany({ where: { companyId, employeeId: me.id }, orderBy: { clockIn: "desc" }, take: 14 }),
  ]);
  return { open, recent };
}

/** Week timesheet: minutes per employee per day (HR: everyone; managers: their reports; others: themselves). */
export async function timesheet(ctx: RequestContext, organizationId: string, companyId: string, weekStart: string) {
  const chain = await authorize(ctx, organizationId, companyId, "hr.read");
  const manage = await can(ctx, "hr.manage", chain);
  const start = toDay(weekStart)!;
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const me = await myEmployee(db(), ctx, organizationId, companyId);
  let employeeFilter: Prisma.EmployeeWhereInput = {};
  if (!manage) {
    if (!me) return { days: [], rows: [], sessions: [] };
    const reportIds = await allReports(db(), companyId, me.id);
    employeeFilter = { id: { in: [me.id, ...reportIds] } };
  }
  const people = await db().employee.findMany({
    where: { organizationId, companyId, archivedAt: null, status: { not: "TERMINATED" }, ...employeeFilter },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
    take: 1000,
  });
  const sessions = await db().hrAttendance.findMany({ where: { companyId, employeeId: { in: people.map((p) => p.id) }, date: { gte: start, lt: end } }, orderBy: { clockIn: "asc" } });
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
  const rows = people.map((p) => {
    const mine = sessions.filter((s) => s.employeeId === p.id);
    const perDay = days.map((d) => mine.filter((s) => s.date.toISOString().slice(0, 10) === d).reduce((n, s) => n + (s.minutes ?? Math.round((Date.now() - s.clockIn.getTime()) / 60_000)), 0));
    return { employee: p, perDay, total: perDay.reduce((a, b) => a + b, 0), open: mine.some((s) => !s.clockOut) };
  });
  return { days, rows, sessions };
}

/** Everyone below an employee in the reporting line. */
export async function allReports(client: Tx | Db, companyId: string, managerId: string) {
  const out: string[] = [];
  let frontier = [managerId];
  for (let depth = 0; frontier.length && depth < 20; depth++) {
    const next = await client.employee.findMany({ where: { companyId, managerId: { in: frontier }, archivedAt: null }, select: { id: true } });
    frontier = next.map((n) => n.id).filter((id) => !out.includes(id) && id !== managerId);
    out.push(...frontier);
  }
  return out;
}

// ─── Work schedules ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function listSchedules(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  return db().hrWorkSchedule.findMany({ take: 500,
    where: { organizationId, companyId, archivedAt: null },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    include: { _count: { select: { employees: { where: { archivedAt: null } } } } },
  });
}

export async function createSchedule(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof scheduleInput>) {
  const input = scheduleInput.parse(raw);
  if (input.endTime <= input.startTime) throw invalid("The end time must be after the start time", { reason: "hr_date_range" });
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    if (input.isDefault) await tx.hrWorkSchedule.updateMany({ where: { companyId }, data: { isDefault: false } });
    const s = await tx.hrWorkSchedule.create({ data: { organizationId, companyId, ...input, weekdays: [...new Set(input.weekdays)].sort() } }).catch((e: { code?: string }) => {
      if (e?.code === "P2002") throw conflict("This name is already used", { reason: "hr_name_taken" });
      throw e;
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.schedule.created", resourceType: "hr_work_schedule", resourceId: s.id, newValue: input });
    return s;
  });
}

export async function archiveSchedule(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const s = isUuid(id) ? await tx.hrWorkSchedule.findFirst({ where: { id, organizationId, companyId, archivedAt: null } }) : null;
    if (!s) throw notFound("Work schedule");
    await tx.employee.updateMany({ where: { companyId, workScheduleId: id }, data: { workScheduleId: null } });
    await tx.hrWorkSchedule.update({ where: { id }, data: { archivedAt: new Date(), isDefault: false, name: `${s.name} (archived ${s.id.slice(0, 8)})` } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.schedule.archived", resourceType: "hr_work_schedule", resourceId: id });
    return { ok: true };
  });
}

// ─── Leave types, holidays, allowances & balances ───────────────────────────────────────────────────────────────────

export async function listLeaveTypes(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  return db().hrLeaveType.findMany({ take: 500, where: { organizationId, companyId, archivedAt: null }, orderBy: { name: "asc" } });
}

const nameTaken = (e: { code?: string }) => {
  if (e?.code === "P2002") throw conflict("This name is already used", { reason: "hr_name_taken" });
  throw e;
};

export async function createLeaveType(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof leaveTypeInput>) {
  const input = leaveTypeInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const t = await tx.hrLeaveType.create({ data: { organizationId, companyId, ...input, color: nil(input.color) } }).catch(nameTaken);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.leave_type.created", resourceType: "hr_leave_type", resourceId: t.id, newValue: input });
    return t;
  });
}

export async function updateLeaveType(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof leaveTypePatch>) {
  const input = leaveTypePatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    if (!isUuid(id) || !(await tx.hrLeaveType.findFirst({ where: { id, organizationId, companyId, archivedAt: null } }))) throw notFound("Leave type");
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) if (v !== undefined) data[k] = v === "" ? null : v;
    const t = await tx.hrLeaveType.update({ where: { id }, data }).catch(nameTaken);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.leave_type.updated", resourceType: "hr_leave_type", resourceId: id, newValue: input });
    return t;
  });
}

export async function archiveLeaveType(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const t = isUuid(id) ? await tx.hrLeaveType.findFirst({ where: { id, organizationId, companyId, archivedAt: null } }) : null;
    if (!t) throw notFound("Leave type");
    await tx.hrLeaveType.update({ where: { id }, data: { archivedAt: new Date(), name: `${t.name} (archived ${t.id.slice(0, 8)})` } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.leave_type.archived", resourceType: "hr_leave_type", resourceId: id });
    return { ok: true };
  });
}

export async function listHolidays(ctx: RequestContext, organizationId: string, companyId: string, year: number) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  return db().hrHoliday.findMany({ take: 500, where: { organizationId, companyId, date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } }, orderBy: { date: "asc" } });
}

export async function createHoliday(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof holidayInput>) {
  const input = holidayInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const h = await tx.hrHoliday.create({ data: { organizationId, companyId, name: input.name, date: toDay(input.date)! } }).catch((e: { code?: string }) => {
      if (e?.code === "P2002") throw conflict("There is already a holiday on this date", { reason: "hr_holiday_exists" });
      throw e;
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.holiday.created", resourceType: "hr_holiday", resourceId: h.id, newValue: input });
    return h;
  });
}

export async function deleteHoliday(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    if (!isUuid(id)) throw notFound("Holiday");
    const { count } = await tx.hrHoliday.deleteMany({ where: { id, organizationId, companyId } });
    if (!count) throw notFound("Holiday");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.holiday.deleted", resourceType: "hr_holiday", resourceId: id });
    return { ok: true };
  });
}

export async function setAllowance(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof allowanceInput>) {
  const input = allowanceInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    await requireEmployee(tx, organizationId, companyId, input.employeeId);
    if (!(await tx.hrLeaveType.findFirst({ where: { id: input.leaveTypeId, organizationId, companyId } }))) throw notFound("Leave type");
    const a = await tx.hrLeaveAllowance.upsert({
      where: { employeeId_leaveTypeId_year: { employeeId: input.employeeId, leaveTypeId: input.leaveTypeId, year: input.year } },
      create: { organizationId, companyId, ...input },
      update: { days: input.days },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.leave_allowance.set", resourceType: "employee", resourceId: input.employeeId, newValue: input });
    return a;
  });
}

/** Per leave type: allowance (override or default), approved days taken, pending days and what remains, for a year. */
export async function computeBalances(client: Tx | Db, organizationId: string, companyId: string, employeeId: string, year: number) {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const [types, overrides, requests] = await Promise.all([
    client.hrLeaveType.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { name: "asc" } }),
    client.hrLeaveAllowance.findMany({ where: { companyId, employeeId, year } }),
    client.hrLeaveRequest.groupBy({ by: ["leaveTypeId", "status"], where: { companyId, employeeId, status: { in: ["APPROVED", "PENDING"] }, startDate: { gte: from, lt: to } }, _sum: { days: true } }),
  ]);
  return types.map((t) => {
    const allowance = overrides.find((o) => o.leaveTypeId === t.id)?.days ?? t.yearlyAllowance;
    const taken = requests.find((r) => r.leaveTypeId === t.id && r.status === "APPROVED")?._sum.days ?? 0;
    const pending = requests.find((r) => r.leaveTypeId === t.id && r.status === "PENDING")?._sum.days ?? 0;
    return { leaveType: t, allowance, taken, pending, remaining: allowance > 0 ? allowance - taken - pending : null };
  });
}

export async function leaveBalances(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string, year: number) {
  await requireEmployee(db(), organizationId, companyId, employeeId, { includeArchived: true });
  await canSee(db(), ctx, organizationId, companyId, employeeId);
  return computeBalances(db(), organizationId, companyId, employeeId, year);
}

/** Working days between two dates (inclusive), skipping non-working weekdays of the schedule and company holidays. */
export async function workingDays(client: Tx | Db, companyId: string, employee: { workScheduleId: string | null }, start: Date, end: Date) {
  const schedule =
    (employee.workScheduleId ? await client.hrWorkSchedule.findFirst({ where: { id: employee.workScheduleId, companyId } }) : null) ??
    (await client.hrWorkSchedule.findFirst({ where: { companyId, isDefault: true, archivedAt: null } }));
  const weekdays = new Set(schedule?.weekdays ?? [1, 2, 3, 4, 5]);
  const holidays = new Set((await client.hrHoliday.findMany({ where: { companyId, date: { gte: start, lte: end } }, select: { date: true } })).map((h) => h.date.toISOString().slice(0, 10)));
  let n = 0;
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86_400_000)) {
    const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (weekdays.has(iso) && !holidays.has(d.toISOString().slice(0, 10))) n++;
  }
  return n;
}

async function approversFor(tx: Tx, organizationId: string, companyId: string, employee: { managerId: string | null }) {
  if (employee.managerId) {
    const m = await tx.employee.findFirst({ where: { id: employee.managerId, companyId, archivedAt: null }, select: { userId: true } });
    if (m?.userId) return [m.userId];
  }
  return usersWithPermission(tx, organizationId, companyId, "hr.manage");
}

export async function requestLeave(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof leaveRequestInput>) {
  const input = leaveRequestInput.parse(raw);
  if (input.endDate < input.startDate) throw invalid("The end date is before the start date", { reason: "hr_date_range" });
  if (input.halfDay && input.startDate !== input.endDate) throw invalid("A half day must start and end on the same date", { reason: "hr_half_day" });
  if (input.startDate.slice(0, 4) !== input.endDate.slice(0, 4)) throw invalid("Split leave that spans two years into two requests", { reason: "hr_leave_years" });
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "hr.read", tx);
    const me = await myEmployee(tx, ctx, organizationId, companyId);
    let employee;
    if (input.employeeId && input.employeeId !== me?.id) {
      if (!(await can(ctx, "hr.manage", chain, tx))) throw forbidden("Only HR can request leave for someone else");
      employee = await requireEmployee(tx, organizationId, companyId, input.employeeId);
    } else {
      if (!me) throw forbidden("Your account is not linked to an employee record", { reason: "hr_not_employee" });
      employee = me;
    }
    const type = await tx.hrLeaveType.findFirst({ where: { id: input.leaveTypeId, organizationId, companyId, archivedAt: null } });
    if (!type) throw notFound("Leave type");
    const start = toDay(input.startDate)!;
    const end = toDay(input.endDate)!;
    const overlap = await tx.hrLeaveRequest.findFirst({ where: { companyId, employeeId: employee.id, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: end }, endDate: { gte: start } }, select: { id: true } });
    if (overlap) throw conflict("This overlaps another leave request", { reason: "hr_leave_overlap" });
    const days = input.halfDay ? 0.5 : await workingDays(tx, companyId, employee, start, end);
    if (days <= 0) throw invalid("No working days in this range", { reason: "hr_leave_no_days" });
    const balance = (await computeBalances(tx, organizationId, companyId, employee.id, start.getUTCFullYear())).find((b) => b.leaveType.id === type.id);
    if (balance?.remaining != null && balance.remaining < days) throw invalid("Not enough leave balance", { reason: "hr_leave_insufficient", remaining: balance.remaining });
    const autoApprove = !type.requiresApproval;
    const req = await tx.hrLeaveRequest.create({
      data: {
        organizationId,
        companyId,
        employeeId: employee.id,
        leaveTypeId: type.id,
        startDate: start,
        endDate: end,
        days,
        reason: nil(input.reason),
        status: autoApprove ? "APPROVED" : "PENDING",
        ...(autoApprove ? { decidedAt: new Date(), decisionNote: "auto-approved" } : {}),
        createdById: actorId(ctx, organizationId),
      },
    });
    await emitDomainEvent(tx, ctx, "leave.requested", {
      organizationId,
      companyId,
      entityType: "hr_leave_request",
      entityId: req.id,
      data: { employeeId: employee.id, employeeName: employeeName(employee), leaveType: type.name, startDate: start, endDate: end, days, status: req.status },
    });
    if (!autoApprove) {
      const approvers = (await approversFor(tx, organizationId, companyId, employee)).filter((u) => u !== employee.userId);
      await notifyUsers(tx, organizationId, approvers, "hr.leave_requested", { companyId, title: `${employeeName(employee)} · ${type.name} · ${days}`, href: "/hr/leave?view=approvals" });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.leave.requested", resourceType: "hr_leave_request", resourceId: req.id, newValue: { employeeId: employee.id, type: type.name, days, start: input.startDate, end: input.endDate } });
    return req;
  });
}

/** Approve or reject (HR or a manager above the employee), or cancel (the employee, HR or the manager). */
export async function decideLeave(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof leaveDecisionInput>) {
  const input = leaveDecisionInput.parse(raw);
  return transaction(async (tx) => {
    if (!isUuid(id)) throw notFound("Leave request");
    const req = await tx.hrLeaveRequest.findFirst({ where: { id, organizationId, companyId }, include: { employee: true, leaveType: { select: { name: true } } } });
    if (!req) throw notFound("Leave request");
    const rel = await canSee(tx, ctx, organizationId, companyId, req.employeeId);
    if (input.decision === "CANCELLED") {
      if (!["PENDING", "APPROVED"].includes(req.status)) throw invalid("This request can't be cancelled");
      if (rel.self && req.status === "APPROVED" && req.startDate <= toDay(new Date().toISOString().slice(0, 10))!) throw invalid("Leave that has started can only be cancelled by HR", { reason: "hr_leave_started" });
    } else {
      if (rel.self) throw forbidden("You can't approve your own leave", { reason: "hr_self_approval" });
      if (req.status !== "PENDING") throw invalid("This request was already decided", { reason: "hr_leave_decided" });
    }
    const status: HrLeaveStatus = input.decision;
    await tx.hrLeaveRequest.update({ where: { id }, data: { status, decidedById: ctx.actor.id, decidedAt: new Date(), decisionNote: nil(input.note) } });
    if (input.decision !== "CANCELLED" || !rel.self) {
      await notifyUsers(tx, organizationId, [req.employee.userId].filter((u) => u !== ctx.actor.id), "hr.leave_decided", { companyId, title: `${req.leaveType.name}: ${status.toLowerCase()}`, href: "/hr/me" });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `hr.leave.${status.toLowerCase()}`, resourceType: "hr_leave_request", resourceId: id, oldValue: { status: req.status }, newValue: { status, note: input.note } });
    return { ok: true };
  });
}

export async function listLeaveRequests(
  ctx: RequestContext,
  organizationId: string,
  companyId: string,
  filters: { view?: "approvals" | "all" | "mine"; status?: HrLeaveStatus; employeeId?: string } = {},
) {
  const chain = await authorize(ctx, organizationId, companyId, "hr.read");
  const manage = await can(ctx, "hr.manage", chain);
  const me = await myEmployee(db(), ctx, organizationId, companyId);
  const where: Prisma.HrLeaveRequestWhereInput = { organizationId, companyId };
  if (filters.status) where.status = filters.status;
  if (filters.view === "mine") {
    if (!me) return [];
    where.employeeId = me.id;
  } else if (!manage) {
    if (!me) return [];
    const reports = await allReports(db(), companyId, me.id);
    where.employeeId = filters.view === "approvals" ? { in: reports } : { in: [me.id, ...reports] };
  } else if (filters.view === "approvals" && me) {
    where.employeeId = { not: me.id };
  }
  if (filters.employeeId && isUuid(filters.employeeId)) where.AND = [{ employeeId: filters.employeeId }];
  if (filters.view === "approvals") where.status = "PENDING";
  return db().hrLeaveRequest.findMany({
    where,
    orderBy: [{ startDate: "desc" }],
    take: 300,
    include: { employee: { select: { id: true, firstName: true, lastName: true } }, leaveType: { select: { id: true, name: true, color: true, paid: true } } },
  });
}

/** Approved leave in the next `days` days (who's out). */
export async function whosOut(ctx: RequestContext, organizationId: string, companyId: string, days = 30) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  const today = toDay(new Date().toISOString().slice(0, 10))!;
  return db().hrLeaveRequest.findMany({
    where: { organizationId, companyId, status: "APPROVED", endDate: { gte: today }, startDate: { lte: new Date(today.getTime() + days * 86_400_000) } },
    orderBy: { startDate: "asc" },
    take: 100,
    select: { id: true, startDate: true, endDate: true, days: true, employee: { select: { id: true, firstName: true, lastName: true } }, leaveType: { select: { name: true, color: true } } },
  });
}

export async function listLeaveRequestsApi(ctx: RequestContext, organizationId: string, companyId: string, raw: Record<string, string>) {
  const view = raw.view === "approvals" || raw.view === "mine" || raw.view === "all" ? raw.view : undefined;
  const status = (LEAVE_STATUSES as readonly string[]).includes(raw.status ?? "") ? (raw.status as HrLeaveStatus) : undefined;
  return listLeaveRequests(ctx, organizationId, companyId, { view, status, employeeId: raw.employeeId });
}

/** Recent attendance sessions of one employee (HR, the employee or their managers). */
export async function attendanceOf(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string, take = 30) {
  await canSee(db(), ctx, organizationId, companyId, employeeId);
  return db().hrAttendance.findMany({ where: { companyId, employeeId }, orderBy: { clockIn: "desc" }, take });
}
