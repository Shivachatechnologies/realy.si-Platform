import { z } from "zod";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid } from "@/server/core/errors";
import { getControls } from "@/server/core/platform-controls";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { AUTONOMY_DEPARTMENTS } from "@/server/modules/workforce/autonomy-classes";
import { companyClock } from "@/server/modules/workforce/autonomy-policy";
import { AUTOPILOT_MODES, COMPANY_SCOPE, effectiveMode, insideWindow, invalidateAutopilotCache, toolCeiling } from "./gate";

/**
 * Company Autopilot control room: the company mode and each department's mode (with schedule windows), mapped onto
 * the autonomy policy engine and the department autopilots (marketing autopilot, prospecting autopilot, AI CEO loop,
 * support automation, finance alerts, AI schedules, workflows). Every number is read from real rows: queued and
 * running tasks, recent completions, active autopilots and their last runs, and the persistent Autopilot run log.
 */

type Scope = { organizationId: string; companyId: string };

async function authorize(ctx: RequestContext, s: Scope, permission: "agents.read" | "agents.manage", tx?: Tx) {
  await requirePermission(ctx, permission, await companyChain(tx ?? db(), s.organizationId, s.companyId), tx);
}

const profileDept = new Map(AGENT_PROFILES.map((p) => [p.key, p.department ?? "operations"]));

export interface DepartmentAutopilot {
  key: "marketing_autopilot" | "prospecting" | "ceo_loop" | "support_automation" | "finance_alerts" | "ai_schedules" | "workflows";
  active: number;
  total: number;
  lastRunAt: string | null;
  /** Short machine state for the UI: "running", "idle", "off", "skipped", "failed". */
  state: string;
  detail: string | null;
}

export async function getAutopilotRoom(ctx: RequestContext, organizationId: string, companyId: string) {
  const s = { organizationId, companyId };
  await authorize(ctx, s, "agents.read");
  const since24h = new Date(Date.now() - 86_400_000);
  const since30d = new Date(Date.now() - 30 * 86_400_000);
  const [company, settings, controls, rows, liveTasks, recentTasks, employees, schedules, marketing, prospecting, ceo, ceoEmployee, support, financeAlerts, workflows, log, runCounts, autoActions] = await Promise.all([
    effectiveMode(s, COMPANY_SCOPE),
    db().autonomySettings.findUnique({ where: { companyId } }).catch(() => null),
    getControls(),
    db().autopilotSetting.findMany({ where: s }),
    db().agentTask.findMany({ where: { ...s, status: { in: ["QUEUED", "RUNNING"] } }, select: { profile: true, status: true, aiEmployee: { select: { department: true } } }, take: 2000 }),
    db().agentTask.findMany({ where: { ...s, completedAt: { gte: since24h } }, select: { profile: true, status: true, completedAt: true, aiEmployee: { select: { department: true } } }, take: 5000 }),
    db().aiEmployee.groupBy({ by: ["department", "status"], where: { ...s, archivedAt: null }, _count: { _all: true } }),
    db().aiSchedule.findMany({ where: { ...s }, select: { enabled: true, lastRunAt: true, aiEmployee: { select: { department: true } } }, take: 1000 }),
    db().marketingAutopilot.findMany({ where: { ...s, archivedAt: null }, select: { status: true, lastPlannedAt: true } }),
    db().crmProspectingAutopilot.findMany({ where: { ...s, status: { not: "ARCHIVED" } }, select: { status: true, lastRunAt: true } }),
    db().ceoCycle.findFirst({ where: s, orderBy: { startedAt: "desc" }, select: { status: true, startedAt: true, skippedReason: true, delegated: true } }),
    db().aiEmployee.findFirst({ where: { ...s, profileKey: "ai_ceo", archivedAt: null }, select: { status: true } }),
    db().supportSettings.findUnique({ where: { companyId }, select: { organizationId: true, aiTriageEnabled: true, aiFirstResponseEnabled: true, aiSlaEscalationEnabled: true } }),
    db().financeAlertLog.findMany({ where: { ...s, sentAt: { gte: since30d } }, select: { sentAt: true }, orderBy: { sentAt: "desc" }, take: 50 }),
    db().workflow.groupBy({ by: ["status"], where: { ...s, status: { not: "ARCHIVED" } }, _count: { _all: true } }),
    db().autopilotRun.findMany({ where: s, orderBy: { createdAt: "desc" }, take: 40 }),
    db().autopilotRun.groupBy({ by: ["status"], where: { ...s, createdAt: { gte: since24h } }, _count: { _all: true } }),
    db().autonomousAction.count({ where: { ...s, createdAt: { gte: since24h } } }),
  ]);
  const deptOf = (t: { profile: string; aiEmployee: { department: string } | null }) => t.aiEmployee?.department ?? profileDept.get(t.profile) ?? "operations";
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  const latest = (ds: (Date | null | undefined)[]) => ds.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);

  const autopilotsFor = (dept: string): DepartmentAutopilot[] => {
    const out: DepartmentAutopilot[] = [];
    const sch = schedules.filter((x) => x.aiEmployee.department === dept);
    if (sch.length) {
      const on = sch.filter((x) => x.enabled).length;
      out.push({ key: "ai_schedules", active: on, total: sch.length, lastRunAt: iso(latest(sch.map((x) => x.lastRunAt))), state: on ? "running" : "off", detail: null });
    }
    if (dept === "marketing" && marketing.length) {
      const on = marketing.filter((m) => m.status === "ACTIVE").length;
      out.push({ key: "marketing_autopilot", active: on, total: marketing.length, lastRunAt: iso(latest(marketing.map((m) => m.lastPlannedAt))), state: on ? "running" : "off", detail: null });
    }
    if (dept === "sales" && prospecting.length) {
      const on = prospecting.filter((p) => p.status === "ACTIVE").length;
      out.push({ key: "prospecting", active: on, total: prospecting.length, lastRunAt: iso(latest(prospecting.map((p) => p.lastRunAt))), state: on ? "running" : "off", detail: null });
    }
    if (dept === "executive" && (ceoEmployee || ceo)) {
      const on = ceoEmployee?.status === "ACTIVE";
      out.push({ key: "ceo_loop", active: on ? 1 : 0, total: 1, lastRunAt: iso(ceo?.startedAt), state: !on ? "off" : ceo?.status === "SKIPPED" ? "skipped" : ceo?.status === "FAILED" ? "failed" : "running", detail: ceo?.status === "SKIPPED" ? (ceo.skippedReason ?? null) : null });
    }
    if (dept === "support" && support && support.organizationId === organizationId) {
      const flags = [support.aiTriageEnabled, support.aiFirstResponseEnabled, support.aiSlaEscalationEnabled];
      const on = flags.filter(Boolean).length;
      out.push({ key: "support_automation", active: on, total: flags.length, lastRunAt: null, state: on ? "running" : "off", detail: null });
    }
    if (dept === "finance" && financeAlerts.length) {
      out.push({ key: "finance_alerts", active: financeAlerts.length, total: financeAlerts.length, lastRunAt: iso(financeAlerts[0]?.sentAt), state: "running", detail: null });
    }
    if (dept === "operations") {
      const active = workflows.find((w) => w.status === "ACTIVE")?._count._all ?? 0;
      const total = workflows.reduce((a, w) => a + w._count._all, 0);
      if (total) out.push({ key: "workflows", active, total, lastRunAt: null, state: active ? "running" : "off", detail: null });
    }
    return out;
  };

  const departments = await Promise.all(
    AUTONOMY_DEPARTMENTS.map(async (key) => {
      const m = await effectiveMode(s, key);
      const own = rows.find((r) => r.department === key);
      const live = liveTasks.filter((t) => deptOf(t) === key);
      const recent = recentTasks.filter((t) => deptOf(t) === key);
      const staff = employees.filter((e) => e.department === key);
      return {
        key,
        mode: m.mode,
        source: m.source,
        own: own ? { mode: own.mode, windowDays: own.windowDays, windowFrom: own.windowFrom, windowTo: own.windowTo } : null,
        window: m.window,
        inWindow: insideWindow(m),
        ceiling: toolCeiling(m.mode),
        employees: staff.reduce((a, e) => a + e._count._all, 0),
        activeEmployees: staff.filter((e) => e.status === "ACTIVE").reduce((a, e) => a + e._count._all, 0),
        queued: live.filter((t) => t.status === "QUEUED").length,
        running: live.filter((t) => t.status === "RUNNING").length,
        done24h: recent.filter((t) => t.status === "COMPLETED").length,
        failed24h: recent.filter((t) => t.status === "FAILED").length,
        lastActivityAt: iso(latest(recent.map((t) => t.completedAt))),
        autopilots: autopilotsFor(key),
      };
    }),
  );
  const companyRow = rows.find((r) => r.department === COMPANY_SCOPE);
  return {
    company: { mode: company.mode, source: company.source, window: company.window, own: companyRow ? { mode: companyRow.mode, windowDays: companyRow.windowDays, windowFrom: companyRow.windowFrom, windowTo: companyRow.windowTo } : null, inWindow: insideWindow(company) },
    timezone: company.timezone ?? "UTC",
    clock: companyClock(company.timezone),
    paused: !!settings?.paused,
    pausedAt: iso(settings?.pausedAt),
    pauseReason: settings?.pauseReason ?? null,
    autoModeEnabled: !!settings?.autoModeEnabled,
    platform: { aiEnabled: controls.aiWorkforceEnabled, executionPaused: controls.aiExecutionPaused, backgroundPaused: controls.backgroundJobsPaused },
    departments,
    stats: {
      running: liveTasks.filter((t) => t.status === "RUNNING").length,
      queued: liveTasks.filter((t) => t.status === "QUEUED").length,
      started24h: runCounts.find((r) => r.status === "STARTED")?._count._all ?? 0,
      blocked24h: runCounts.find((r) => r.status === "BLOCKED")?._count._all ?? 0,
      autoActions24h: autoActions,
    },
    log: log.map((r) => ({ id: r.id, department: r.department, trigger: r.trigger, source: r.source, mode: r.mode, status: r.status, reason: r.reason, title: r.title, taskId: r.taskId, createdAt: r.createdAt.toISOString() })),
  };
}

export type AutopilotRoom = Awaited<ReturnType<typeof getAutopilotRoom>>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const autopilotModeInput = z
  .object({
    /** "*" for the company, else a department key. */
    department: z.union([z.literal(COMPANY_SCOPE), z.enum(AUTONOMY_DEPARTMENTS)]),
    /** null on a department = inherit the company mode (removes the department row). */
    mode: z.enum(AUTOPILOT_MODES).nullable(),
    windowDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    windowFrom: hhmm.nullable().optional(),
    windowTo: hhmm.nullable().optional(),
  })
  .refine((v) => !v.windowFrom === !v.windowTo, { path: ["windowTo"], message: "Set both a start and an end time, or neither" });

/** Set the company's or a department's Autopilot mode and schedule window (audited; managers are notified). */
export async function setAutopilotMode(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof autopilotModeInput>) {
  const parsed = autopilotModeInput.safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid input", { reason: "autopilot_window" });
  const input = parsed.data;
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw invalid("Only a person can change Autopilot");
  if (input.department === COMPANY_SCOPE && input.mode === null) throw invalid("The company needs a mode", { reason: "autopilot_company_mode_required" });
  const actorId = ctx.actor.id;
  const s = { organizationId, companyId };
  const result = await transaction(async (tx) => {
    await authorize(ctx, s, "agents.manage", tx);
    const before = await tx.autopilotSetting.findUnique({ where: { companyId_department: { companyId, department: input.department } } });
    const oldValue = before ? { mode: before.mode, windowDays: before.windowDays, windowFrom: before.windowFrom, windowTo: before.windowTo } : null;
    if (input.mode === null) {
      if (before) await tx.autopilotSetting.delete({ where: { id: before.id } });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "autopilot.mode_inherited", resourceType: "autopilot_setting", resourceId: before?.id ?? input.department, oldValue, newValue: { companyId, department: input.department } });
      return { department: input.department, mode: null };
    }
    const data = { mode: input.mode, windowDays: input.windowDays ?? before?.windowDays ?? [], windowFrom: input.windowFrom !== undefined ? input.windowFrom : (before?.windowFrom ?? null), windowTo: input.windowTo !== undefined ? input.windowTo : (before?.windowTo ?? null), updatedById: actorId };
    const row = await tx.autopilotSetting.upsert({ where: { companyId_department: { companyId, department: input.department } }, create: { ...s, department: input.department, ...data }, update: data });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "autopilot.mode_changed", resourceType: "autopilot_setting", resourceId: row.id, oldValue, newValue: { companyId, department: input.department, mode: row.mode, windowDays: row.windowDays, windowFrom: row.windowFrom, windowTo: row.windowTo } });
    if (!before || before.mode !== row.mode) {
      const recipients = (await usersWithPermission(tx, organizationId, companyId, "agents.manage")).filter((u) => u !== actorId);
      await notifyUsers(tx, organizationId, recipients, "autopilot.modeChanged", { companyId, title: `${input.department === COMPANY_SCOPE ? "Company" : input.department}: ${row.mode}`, href: "/autopilot" });
    }
    return { department: input.department, mode: row.mode };
  });
  invalidateAutopilotCache(companyId);
  return result;
}
