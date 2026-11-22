import { z } from "zod";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { actorId, authorize, day, dayString, employeeName, isUuid, money, myEmployee, optText, requireEmployee, toDay, toMajor, toMinor, uuid } from "./access";
import { toCsv } from "./csv";

/**
 * Payroll (payroll.read / payroll.manage — the latter MFA-gated and never granted to agents): salary structures with
 * allowance/deduction components, employee compensation history, pay periods and payroll runs (draft → computed →
 * approved → paid) that generate payslips with line items. Employees see only their own approved/paid payslips.
 */

export const COMPONENT_KINDS = ["ALLOWANCE", "DEDUCTION"] as const;
export const COMPONENT_CALCS = ["FIXED", "PERCENT"] as const;
export const RUN_STATUSES = ["DRAFT", "COMPUTED", "APPROVED", "PAID"] as const;

const emptyU = z.literal("").transform(() => undefined);

export const structureInput = z.object({ name: z.string().trim().min(1).max(120), description: optText(1000) });
export const componentInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(COMPONENT_KINDS),
    calc: z.enum(COMPONENT_CALCS).default("FIXED"),
    /** FIXED: monthly amount in major units. */
    amount: money.optional().or(emptyU),
    /** PERCENT: percent of the monthly base, e.g. "12.5". */
    percent: z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/).optional().or(emptyU),
  })
  .refine((v) => (v.calc === "FIXED" ? !!v.amount : !!v.percent), { message: "Amount or percent is required", path: ["amount"] });
export const compensationInput = z.object({
  employeeId: uuid,
  structureId: uuid.optional().or(emptyU),
  /** Monthly base salary in major units. */
  baseMonthly: money,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional().or(emptyU),
  effectiveFrom: day,
  note: optText(500),
});
export const periodInput = z.object({ name: z.string().trim().min(1).max(80), startDate: day, endDate: day, payDate: day });
export const runInput = z.object({ periodId: uuid });
export const runActionInput = z.object({ action: z.enum(["compute", "approve", "pay", "reopen"]) });

const pct = (base: bigint, bp: number) => (base * BigInt(bp) + 5000n) / 10000n;
const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;

// ─── Structures ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function listStructures(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "payroll.read");
  return db().hrSalaryStructure.findMany({ take: 500,
    where: { organizationId, companyId, archivedAt: null },
    orderBy: { name: "asc" },
    include: { components: { orderBy: { position: "asc" } }, _count: { select: { compensations: true } } },
  });
}

export async function createStructure(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof structureInput>) {
  const input = structureInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "payroll.manage", tx);
    const s = await tx.hrSalaryStructure.create({ data: { organizationId, companyId, name: input.name, description: input.description || null } }).catch((e: { code?: string }) => {
      if (e?.code === "P2002") throw conflict("This name is already used", { reason: "hr_name_taken" });
      throw e;
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "payroll.structure.created", resourceType: "hr_salary_structure", resourceId: s.id, newValue: input });
    return s;
  });
}

export async function archiveStructure(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "payroll.manage", tx);
    const s = isUuid(id) ? await tx.hrSalaryStructure.findFirst({ where: { id, organizationId, companyId, archivedAt: null } }) : null;
    if (!s) throw notFound("Salary structure");
    await tx.hrSalaryStructure.update({ where: { id }, data: { archivedAt: new Date(), name: `${s.name} (archived ${s.id.slice(0, 8)})` } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "payroll.structure.archived", resourceType: "hr_salary_structure", resourceId: id });
    return { ok: true };
  });
}

export async function addComponent(ctx: RequestContext, organizationId: string, companyId: string, structureId: string, raw: z.input<typeof componentInput>) {
  const input = componentInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "payroll.manage", tx);
    if (!isUuid(structureId) || !(await tx.hrSalaryStructure.findFirst({ where: { id: structureId, organizationId, companyId, archivedAt: null } }))) throw notFound("Salary structure");
    const company = await tx.company.findFirstOrThrow({ where: { id: companyId }, select: { baseCurrency: true } });
    const position = await tx.hrSalaryComponent.count({ where: { structureId } });
    const c = await tx.hrSalaryComponent.create({
      data: {
        organizationId,
        companyId,
        structureId,
        name: input.name,
        kind: input.kind,
        calc: input.calc,
        amountMinor: input.calc === "FIXED" ? toMinor(input.amount, company.baseCurrency) : null,
        percentBp: input.calc === "PERCENT" ? Math.round(Number(input.percent) * 100) : null,
        position,
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "payroll.component.added", resourceType: "hr_salary_structure", resourceId: structureId, newValue: input });
    return c;
  });
}

export async function removeComponent(ctx: RequestContext, organizationId: string, companyId: string, componentId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "payroll.manage", tx);
    if (!isUuid(componentId)) throw notFound("Component");
    const { count } = await tx.hrSalaryComponent.deleteMany({ where: { id: componentId, organizationId, companyId } });
    if (!count) throw notFound("Component");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "payroll.component.removed", resourceType: "hr_salary_component", resourceId: componentId });
    return { ok: true };
  });
}

// ─── Compensation ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Current compensation (latest effective on `at`) per employee. */
async function currentCompensations(client: Tx | ReturnType<typeof db>, companyId: string, employeeIds: string[], at: Date) {
  const rows = await client.hrCompensation.findMany({
    where: { companyId, employeeId: { in: employeeIds }, effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    include: { structure: { include: { components: { orderBy: { position: "asc" } } } } },
  });
  const map = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!map.has(r.employeeId)) map.set(r.employeeId, r);
  return map;
}

export async function compensationOverview(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "payroll.read");
  const people = await db().employee.findMany({
    where: { organizationId, companyId, archivedAt: null, status: { not: "TERMINATED" } },
    select: { id: true, firstName: true, lastName: true, title: true, department: { select: { name: true } } },
    orderBy: { firstName: "asc" },
    take: 2000,
  });
  const comps = await currentCompensations(db(), companyId, people.map((p) => p.id), new Date());
  return people.map((p) => ({ employee: p, compensation: comps.get(p.id) ?? null }));
}

export async function employeeCompensation(ctx: RequestContext, organizationId: string, companyId: string, employeeId: string) {
  await authorize(ctx, organizationId, companyId, "payroll.read");
  await requireEmployee(db(), organizationId, companyId, employeeId, { includeArchived: true });
  return db().hrCompensation.findMany({ take: 500, where: { companyId, employeeId }, orderBy: { effectiveFrom: "desc" }, include: { structure: { select: { id: true, name: true } } } });
}

export async function addCompensation(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof compensationInput>) {
  const input = compensationInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "payroll.manage", tx);
    await requireEmployee(tx, organizationId, companyId, input.employeeId);
    if (input.structureId && !(await tx.hrSalaryStructure.findFirst({ where: { id: input.structureId, organizationId, companyId, archivedAt: null } }))) throw notFound("Salary structure");
    const company = await tx.company.findFirstOrThrow({ where: { id: companyId }, select: { baseCurrency: true } });
    const currency = input.currency || company.baseCurrency;
    const c = await tx.hrCompensation.create({
      data: { organizationId, companyId, employeeId: input.employeeId, structureId: input.structureId ?? null, baseMonthlyMinor: toMinor(input.baseMonthly, currency)!, currency, effectiveFrom: toDay(input.effectiveFrom)!, note: input.note || null, createdById: actorId(ctx, organizationId) },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "payroll.compensation.added", resourceType: "employee", resourceId: input.employeeId, newValue: { effectiveFrom: input.effectiveFrom, currency, structureId: input.structureId } });
    return c;
  });
}

// ─── Pay periods & runs ─────────────────────────────────────────────────────────────────────────────────────────────

export async function listPeriods(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "payroll.read");
  return db().hrPayPeriod.findMany({
    where: { organizationId, companyId },
    orderBy: { startDate: "desc" },
    take: 60,
    include: { runs: { select: { id: true, status: true, totalNetMinor: true, currency: true }, orderBy: { createdAt: "desc" } } },
  });
}

export async function createPeriod(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof periodInput>) {
  const input = periodInput.parse(raw);
  if (input.endDate < input.startDate) throw invalid("The end date is before the start date", { reason: "hr_date_range" });
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "payroll.manage", tx);
    const p = await tx.hrPayPeriod.create({ data: { organizationId, companyId, name: input.name, startDate: toDay(input.startDate)!, endDate: toDay(input.endDate)!, payDate: toDay(input.payDate)! } }).catch((e: { code?: string }) => {
      if (e?.code === "P2002") throw conflict("This name is already used", { reason: "hr_name_taken" });
      throw e;
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "payroll.period.created", resourceType: "hr_pay_period", resourceId: p.id, newValue: input });
    return p;
  });
}

export async function createRun(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof runInput>) {
  const input = runInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "payroll.manage", tx);
    const period = await tx.hrPayPeriod.findFirst({ where: { id: input.periodId, organizationId, companyId } });
    if (!period) throw notFound("Pay period");
    if (period.status === "CLOSED") throw invalid("This pay period is closed", { reason: "hr_payroll_period_closed" });
    const active = await tx.hrPayrollRun.findFirst({ where: { periodId: period.id, companyId, status: { not: "PAID" } }, select: { id: true } });
    if (active) throw conflict("This period already has a payroll run in progress", { reason: "hr_payroll_run_exists", runId: active.id });
    const company = await tx.company.findFirstOrThrow({ where: { id: companyId }, select: { baseCurrency: true } });
    const run = await tx.hrPayrollRun.create({ data: { organizationId, companyId, periodId: period.id, currency: company.baseCurrency, createdById: actorId(ctx, organizationId) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "payroll.run.created", resourceType: "hr_payroll_run", resourceId: run.id, newValue: { periodId: period.id } });
    return run;
  });
}

/** Weekdays (Mon–Fri) between two dates inclusive, used to value unpaid leave days. */
function weekdaysBetween(a: Date, b: Date) {
  let n = 0;
  for (let d = new Date(a); d <= b; d = new Date(d.getTime() + 86_400_000)) if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++;
  return n;
}

/** Compute payslips: prorated base, structure allowances and deductions, and unpaid leave in the period. */
async function computeRun(tx: Tx, run: { id: string; organizationId: string; companyId: string; currency: string; period: { startDate: Date; endDate: Date } }) {
  const { startDate, endDate } = run.period;
  await tx.hrPayslip.deleteMany({ where: { runId: run.id, companyId: run.companyId } });
  const people = await tx.employee.findMany({
    where: {
      organizationId: run.organizationId,
      companyId: run.companyId,
      archivedAt: null,
      AND: [{ OR: [{ startDate: null }, { startDate: { lte: endDate } }] }, { OR: [{ endDate: null }, { endDate: { gte: startDate } }] }],
    },
    select: { id: true, startDate: true, endDate: true },
  });
  const comps = await currentCompensations(tx, run.companyId, people.map((p) => p.id), endDate);
  const unpaid = await tx.hrLeaveRequest.findMany({
    where: { companyId: run.companyId, employeeId: { in: people.map((p) => p.id) }, status: "APPROVED", leaveType: { paid: false }, startDate: { lte: endDate }, endDate: { gte: startDate } },
    select: { employeeId: true, startDate: true, endDate: true, days: true },
  });
  const periodDays = days(startDate, endDate);
  const periodWeekdays = Math.max(1, weekdaysBetween(startDate, endDate));
  let gross = 0n;
  let deductions = 0n;
  let skipped = 0;
  for (const p of people) {
    const comp = comps.get(p.id);
    if (!comp) continue;
    if (comp.currency !== run.currency) {
      skipped++;
      continue;
    }
    const from = p.startDate && p.startDate > startDate ? p.startDate : startDate;
    const to = p.endDate && p.endDate < endDate ? p.endDate : endDate;
    const worked = Math.max(0, days(from, to));
    const base = worked >= periodDays ? comp.baseMonthlyMinor : (comp.baseMonthlyMinor * BigInt(worked)) / BigInt(periodDays);
    const lines: { label: string; kind: "EARNING" | "DEDUCTION"; amountMinor: bigint }[] = [{ label: worked >= periodDays ? "Base salary" : `Base salary (${worked}/${periodDays} days)`, kind: "EARNING", amountMinor: base }];
    for (const c of comp.structure?.components ?? []) {
      const amount = c.calc === "PERCENT" ? pct(base, c.percentBp ?? 0) : worked >= periodDays ? (c.amountMinor ?? 0n) : ((c.amountMinor ?? 0n) * BigInt(worked)) / BigInt(periodDays);
      if (amount) lines.push({ label: c.name, kind: c.kind === "ALLOWANCE" ? "EARNING" : "DEDUCTION", amountMinor: amount });
    }
    const unpaidDays = unpaid
      .filter((u) => u.employeeId === p.id)
      .reduce((n, u) => {
        const s = u.startDate > startDate ? u.startDate : startDate;
        const e = u.endDate < endDate ? u.endDate : endDate;
        return n + (u.days === 0.5 ? 0.5 : weekdaysBetween(s, e));
      }, 0);
    if (unpaidDays > 0) lines.push({ label: `Unpaid leave (${unpaidDays} d)`, kind: "DEDUCTION", amountMinor: (comp.baseMonthlyMinor * BigInt(Math.round(unpaidDays * 2))) / BigInt(periodWeekdays * 2) });
    const g = lines.filter((l) => l.kind === "EARNING").reduce((n, l) => n + l.amountMinor, 0n);
    const d = lines.filter((l) => l.kind === "DEDUCTION").reduce((n, l) => n + l.amountMinor, 0n);
    const slip = await tx.hrPayslip.create({
      data: { organizationId: run.organizationId, companyId: run.companyId, runId: run.id, employeeId: p.id, currency: run.currency, baseMinor: base, grossMinor: g, deductionsMinor: d, netMinor: g - d },
      select: { id: true },
    });
    await tx.hrPayslipLine.createMany({ data: lines.map((l, i) => ({ organizationId: run.organizationId, companyId: run.companyId, payslipId: slip.id, ...l, position: i })) });
    gross += g;
    deductions += d;
  }
  await tx.hrPayrollRun.update({ where: { id: run.id }, data: { status: "COMPUTED", computedAt: new Date(), totalGrossMinor: gross, totalDeductionsMinor: deductions, totalNetMinor: gross - deductions } });
  return { skipped };
}

export async function runAction(ctx: RequestContext, organizationId: string, companyId: string, runId: string, raw: z.input<typeof runActionInput>) {
  const { action } = runActionInput.parse(raw);
  return transaction(
    async (tx) => {
      await authorize(ctx, organizationId, companyId, "payroll.manage", tx);
      const run = isUuid(runId) ? await tx.hrPayrollRun.findFirst({ where: { id: runId, organizationId, companyId }, include: { period: true } }) : null;
      if (!run) throw notFound("Payroll run");
      let result: Record<string, unknown> = {};
      if (action === "compute") {
        if (run.status !== "DRAFT" && run.status !== "COMPUTED") throw invalid("Only draft or computed runs can be recomputed", { reason: "hr_payroll_run_locked" });
        result = await computeRun(tx, run);
      } else if (action === "reopen") {
        if (run.status !== "APPROVED") throw invalid("Only approved runs can be reopened", { reason: "hr_payroll_run_locked" });
        await tx.hrPayrollRun.update({ where: { id: runId }, data: { status: "COMPUTED", approvedAt: null, approvedById: null } });
      } else if (action === "approve") {
        if (run.status !== "COMPUTED") throw invalid("Compute the run before approving it", { reason: "hr_payroll_run_not_computed" });
        await tx.hrPayrollRun.update({ where: { id: runId }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: ctx.actor.id } });
      } else {
        if (run.status !== "APPROVED") throw invalid("Approve the run before marking it paid", { reason: "hr_payroll_run_not_approved" });
        await tx.hrPayrollRun.update({ where: { id: runId }, data: { status: "PAID", paidAt: new Date() } });
        await tx.hrPayPeriod.update({ where: { id: run.periodId }, data: { status: "CLOSED" } });
        const slips = await tx.hrPayslip.findMany({ where: { runId, companyId }, select: { employee: { select: { userId: true } } } });
        await notifyUsers(tx, organizationId, slips.map((s) => s.employee.userId), "hr.payslip_available", { companyId, title: run.period.name, href: "/hr/me" });
      }
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `payroll.run.${action}`, resourceType: "hr_payroll_run", resourceId: runId, oldValue: { status: run.status }, newValue: result });
      return { ok: true, ...result };
    },
    { timeout: 120_000 },
  );
}

export async function listRuns(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "payroll.read");
  return db().hrPayrollRun.findMany({ where: { organizationId, companyId }, orderBy: { createdAt: "desc" }, take: 60, include: { period: true, _count: { select: { payslips: true } } } });
}

export async function getRun(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  await authorize(ctx, organizationId, companyId, "payroll.read");
  if (!isUuid(runId)) throw notFound("Payroll run");
  const run = await db().hrPayrollRun.findFirst({
    where: { id: runId, organizationId, companyId },
    include: {
      period: true,
      payslips: { orderBy: { employee: { firstName: "asc" } }, include: { employee: { select: { id: true, firstName: true, lastName: true, title: true, department: { select: { name: true } } } } } },
    },
  });
  if (!run) throw notFound("Payroll run");
  return run;
}

/** A payslip: payroll.read, or the employee's own once the run is approved. */
export async function getPayslip(ctx: RequestContext, organizationId: string, companyId: string, payslipId: string) {
  if (!isUuid(payslipId)) throw notFound("Payslip");
  const slip = await db().hrPayslip.findFirst({
    where: { id: payslipId, organizationId, companyId },
    include: {
      lines: { orderBy: { position: "asc" } },
      run: { include: { period: true } },
      employee: { select: { id: true, firstName: true, lastName: true, title: true, employeeNumber: true, department: { select: { name: true } } } },
      company: { select: { name: true, legalName: true } },
    },
  });
  if (!slip) throw notFound("Payslip");
  const me = await myEmployee(db(), ctx, organizationId, companyId);
  if (me?.id === slip.employeeId && (slip.run.status === "APPROVED" || slip.run.status === "PAID")) {
    await authorize(ctx, organizationId, companyId, "hr.read");
    return slip;
  }
  await authorize(ctx, organizationId, companyId, "payroll.read");
  return slip;
}

export async function myPayslips(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  const me = await myEmployee(db(), ctx, organizationId, companyId);
  if (!me) return [];
  return db().hrPayslip.findMany({
    where: { companyId, employeeId: me.id, run: { status: { in: ["APPROVED", "PAID"] } } },
    orderBy: { createdAt: "desc" },
    take: 36,
    include: { run: { select: { status: true, period: { select: { name: true, payDate: true } } } } },
  });
}

/** Yearly payroll report: totals per run and cost per department (paid and approved runs). */
export async function payrollReport(ctx: RequestContext, organizationId: string, companyId: string, year: number) {
  await authorize(ctx, organizationId, companyId, "payroll.read");
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const runs = await db().hrPayrollRun.findMany({
    where: { organizationId, companyId, status: { in: ["APPROVED", "PAID"] }, period: { payDate: { gte: from, lt: to } } },
    orderBy: { period: { payDate: "asc" } },
    include: { period: { select: { name: true, payDate: true } }, _count: { select: { payslips: true } } },
  });
  const slips = await db().hrPayslip.findMany({ where: { runId: { in: runs.map((r) => r.id) }, companyId }, select: { grossMinor: true, netMinor: true, currency: true, employee: { select: { department: { select: { name: true } } } } } });
  const byDept = new Map<string, { gross: bigint; net: bigint; count: number }>();
  for (const s of slips) {
    const k = s.employee.department?.name ?? "—";
    const v = byDept.get(k) ?? { gross: 0n, net: 0n, count: 0 };
    byDept.set(k, { gross: v.gross + s.grossMinor, net: v.net + s.netMinor, count: v.count + 1 });
  }
  return {
    runs,
    totals: runs.reduce((t, r) => ({ gross: t.gross + r.totalGrossMinor, deductions: t.deductions + r.totalDeductionsMinor, net: t.net + r.totalNetMinor }), { gross: 0n, deductions: 0n, net: 0n }),
    departments: [...byDept.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => (b.gross > a.gross ? 1 : -1)),
  };
}

export async function exportRunCsv(ctx: RequestContext, organizationId: string, companyId: string, runId: string) {
  const run = await getRun(ctx, organizationId, companyId, runId);
  const major = (m: bigint) => toMajor(m, run.currency);
  const csv = toCsv(
    ["employee", "title", "department", "currency", "base", "gross", "deductions", "net", "period", "pay_date"],
    run.payslips.map((p) => [employeeName(p.employee), p.employee.title, p.employee.department?.name, p.currency, major(p.baseMinor), major(p.grossMinor), major(p.deductionsMinor), major(p.netMinor), run.period.name, dayString(run.period.payDate)]),
  );
  return { csv, filename: `payroll-${run.period.name}.csv` };
}
