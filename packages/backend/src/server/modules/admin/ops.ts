import { z } from "zod";
import { db, transaction, Prisma } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { toJson } from "@/server/core/json";
import { getControls } from "@/server/core/platform-controls";
import { redis } from "@/server/core/rate-limit";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { writeAudit } from "@/server/modules/audit/service";
import { emailConfigured } from "@/server/modules/email/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { setEmployeeStatus, updateEmployee, updateEmployeeInput } from "@/server/modules/workforce/service";
import { MODEL_PRICES } from "@/server/modules/workforce/pricing";
import { daysAgo, isUuid, reasonSchema, requireAnyPlatform } from "./access";
import { setControl } from "./controls";

/**
 * Platform ops, security history, AI routing extras and per-employee administration:
 *  - security: login history (sessions + auth audit), permission-change history, session management;
 *  - ops: maintenance toggle (existing control), email delivery log, cache/storage status, failed-payment recovery;
 *  - AI: fallback chain + credit cost per model (platform settings), error management;
 *  - AI employees: model / tools / budget / autonomy / pause through the workforce service (system principal).
 */

// ───────────── Security history & sessions ─────────────

const PERMISSION_ACTIONS = ["role.assigned", "role.revoked", "platform.role_granted", "platform.role_revoked", "platform.organization.member_added", "platform.organization.member_role_changed", "platform.organization.member_removed", "role.created", "role.updated", "role.deleted"];

export async function securityHistory(ctx: RequestContext, raw: { user?: string } = {}) {
  await requireAnyPlatform(ctx, ["platform.security.read", "platform.security.manage", "platform.audit.read"]);
  const userId = raw.user && isUuid(raw.user) ? raw.user : undefined;
  const [sessions, authEvents, permissionChanges, activeCount] = await Promise.all([
    db().session.findMany({ where: { ...(userId ? { userId } : {}) }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, userId: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true, mfaVerifiedAt: true, user: { select: { name: true, email: true } } } }),
    db().auditLog.findMany({ where: { action: { startsWith: "auth." }, ...(userId ? { actorId: userId } : {}) }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, action: true, actorId: true, newValue: true, createdAt: true } }),
    db().auditLog.findMany({ where: { action: { in: PERMISSION_ACTIONS }, ...(userId ? { OR: [{ actorId: userId }, { resourceId: userId }] } : {}) }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, action: true, actorId: true, organizationId: true, resourceId: true, newValue: true, oldValue: true, reason: true, createdAt: true } }),
    db().session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  const adminIds = new Set((await db().roleAssignment.findMany({ where: { principalType: "USER", scopeType: { in: ["PLATFORM", "REGION", "COUNTRY"] } }, select: { principalId: true } })).map((a) => a.principalId));
  const ids = [...new Set([...authEvents.map((a) => a.actorId), ...permissionChanges.flatMap((p) => [p.actorId, p.resourceId])].filter((x): x is string => !!x && isUuid(x)))];
  const people = await db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const name = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? id.slice(0, 8)) : "system");
  const now = new Date();
  return {
    activeCount,
    sessions: sessions.map((s) => ({ ...s, admin: adminIds.has(s.userId), state: s.revokedAt ? "revoked" : s.expiresAt <= now ? "expired" : "active" })),
    authEvents: authEvents.map((a) => ({ ...a, who: name(a.actorId) })),
    permissionChanges: permissionChanges.map((p) => ({ ...p, who: name(p.actorId), target: name(p.resourceId) })),
  };
}

export const revokeSessionInput = z.object({ reason: reasonSchema });

/** Revoke one session (any user). Revoking your own current session is refused (sign out instead). */
export async function revokeSession(ctx: RequestContext, sessionId: string, raw: z.input<typeof revokeSessionInput>) {
  const { reason } = revokeSessionInput.parse(raw);
  if (!isUuid(sessionId)) throw notFound("Session");
  if (sessionId === ctx.sessionId) throw conflict("This is your current session — sign out instead");
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.security.manage", platformChain(), tx);
    const s = await tx.session.findUnique({ where: { id: sessionId }, select: { userId: true, revokedAt: true } });
    if (!s) throw notFound("Session");
    if (s.revokedAt) throw conflict("The session is already revoked");
    await tx.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.session_revoked", resourceType: "session", resourceId: sessionId, newValue: { userId: s.userId }, reason });
    return { ok: true };
  });
}

// ───────────── Platform ops ─────────────

export async function opsOverview(ctx: RequestContext, raw: { emailStatus?: string } = {}) {
  await requireAnyPlatform(ctx, ["platform.controls.manage", "platform.security.read", "platform.subscriptions.read", "platform.audit.read"]);
  const status = ["SENT", "FAILED", "NOT_CONFIGURED"].includes(raw.emailStatus ?? "") ? (raw.emailStatus as "SENT" | "FAILED" | "NOT_CONFIGURED") : undefined;
  const t0 = Date.now();
  const [controls, emails, emailStats, redisInfo, dbSize, storage, storageObjects, failed] = await Promise.all([
    getControls(),
    db().emailMessage.findMany({ where: { ...(status ? { status } : {}) }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, organizationId: true, toEmail: true, template: true, locale: true, status: true, provider: true, error: true, createdAt: true } }),
    db().emailMessage.groupBy({ by: ["status"], where: { createdAt: { gte: daysAgo(7) } }, _count: { _all: true } }),
    (async () => {
      try {
        const r = redis();
        const start = Date.now();
        const pong = await r.ping();
        const latencyMs = Date.now() - start;
        const info = await r.info("memory").catch(() => "");
        const keys = await r.dbsize().catch(() => null);
        const used = /used_memory_human:(\S+)/.exec(info)?.[1] ?? null;
        return { ok: pong === "PONG", latencyMs, usedMemory: used, keys };
      } catch {
        return { ok: false, latencyMs: null, usedMemory: null, keys: null };
      }
    })(),
    db().$queryRaw<{ size: bigint }[]>(Prisma.sql`SELECT pg_database_size(current_database())::bigint AS size`).then((r) => Number(r[0]?.size ?? 0), () => null),
    db().integrationConnection.groupBy({ by: ["status"], where: { provider: "s3" }, _count: { _all: true } }).catch(() => [] as { status: string; _count: { _all: number } }[]),
    db().$queryRaw<{ n: bigint; bytes: bigint | null }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS n, SUM(size)::bigint AS bytes FROM integration_stored_objects`).then((r) => ({ count: Number(r[0]?.n ?? 0), bytes: Number(r[0]?.bytes ?? 0) }), () => null),
    db().subscription.findMany({
      where: { status: { in: ["PAST_DUE", "UNPAID", "INCOMPLETE"] } },
      orderBy: { lastPaymentFailedAt: "desc" },
      take: 100,
      select: { id: true, organizationId: true, status: true, currency: true, lastPaymentFailedAt: true, currentPeriodEnd: true, stripeSubscriptionId: true, plan: { select: { name: true } }, organization: { select: { name: true, billingProfile: { select: { stripeCustomerId: true } } } }, items: { select: { quantity: true, unitAmountMinor: true } } },
    }),
  ]);
  return {
    maintenance: { on: controls.maintenanceMode, readOnly: controls.readOnlyMode, message: controls.maintenanceMessage },
    email: { configured: emailConfigured(), log: emails, last7d: Object.fromEntries(emailStats.map((s) => [s.status, s._count._all])) as Record<string, number> },
    cache: redisInfo,
    database: { ok: true, sizeBytes: dbSize, checkMs: Date.now() - t0 },
    storage: { s3: Object.fromEntries(storage.map((s) => [s.status, s._count._all])) as Record<string, number>, dbFallback: storageObjects },
    failedPayments: failed.map((s) => ({
      id: s.id,
      organizationId: s.organizationId,
      organizationName: s.organization.name,
      status: s.status,
      plan: s.plan.name,
      amountMinor: s.items.reduce((a, i) => a + i.unitAmountMinor * BigInt(i.quantity), 0n),
      currency: s.currency,
      lastPaymentFailedAt: s.lastPaymentFailedAt,
      currentPeriodEnd: s.currentPeriodEnd,
      stripeUrl: s.stripeSubscriptionId ? `https://dashboard.stripe.com/subscriptions/${s.stripeSubscriptionId}` : s.organization.billingProfile?.stripeCustomerId ? `https://dashboard.stripe.com/customers/${s.organization.billingProfile.stripeCustomerId}` : null,
    })),
  };
}

export const maintenanceInput = z.object({ on: z.boolean(), reason: reasonSchema, confirm: z.string().max(100).optional() });

/** Maintenance mode toggle (the existing critical control; typed confirmation "maintenanceMode" to turn it on). */
export async function setMaintenance(ctx: RequestContext, raw: z.input<typeof maintenanceInput>) {
  const input = maintenanceInput.parse(raw);
  return setControl(ctx, { key: "maintenanceMode", value: input.on, reason: input.reason, confirm: input.confirm });
}

// ───────────── AI routing: fallback chain & credits ─────────────

const FALLBACK_KEY = "ai:fallbackChain";
const CREDITS_KEY = "ai:modelCredits";
const modelId = z.string().regex(/^[a-z0-9.@-]{3,64}$/);
const creditSchema = z.record(z.string(), z.object({ input: z.number().min(0).max(1e6), output: z.number().min(0).max(1e6) }));

async function setting<T>(key: string, schema: z.ZodType<T>, fallback: T) {
  const row = await db().platformSetting.findUnique({ where: { key } }).catch(() => null);
  const p = schema.safeParse(row?.value);
  return p.success ? p.data : fallback;
}

/** Ordered fallback models (used when the primary model is unavailable) and credits per 1M tokens per model. */
export async function aiRouting(ctx: RequestContext) {
  await requireAnyPlatform(ctx, ["platform.ai.read", "platform.ai.manage"]);
  const [chain, credits] = await Promise.all([setting(FALLBACK_KEY, z.array(modelId).max(5), [] as string[]), setting(CREDITS_KEY, creditSchema, {})]);
  return { fallbackChain: chain, credits };
}

/** The fallback chain for runtime use (agents hook): models after the primary, skipping disabled ones. */
export async function fallbackModels(primary: string): Promise<string[]> {
  const [chain, c] = await Promise.all([setting(FALLBACK_KEY, z.array(modelId).max(5), [] as string[]), getControls()]);
  return chain.filter((m) => m !== primary && !c.aiDisabledModels.includes(m) && (c.aiAllowedModels.length === 0 || c.aiAllowedModels.includes(m)));
}

export const aiRoutingInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("fallback"), chain: z.array(modelId).max(5), reason: reasonSchema }),
  z.object({ action: z.literal("credits"), model: modelId, input: z.number().min(0).max(1e6).nullable(), output: z.number().min(0).max(1e6).nullable(), reason: reasonSchema }),
]);

export async function updateAiRouting(ctx: RequestContext, raw: z.input<typeof aiRoutingInput>) {
  const input = aiRoutingInput.parse(raw);
  const known = new Set(Object.keys(MODEL_PRICES));
  return transaction(async (tx) => {
    await requirePermission(ctx, "platform.ai.manage", platformChain(), tx);
    let key: string;
    let value: unknown;
    let before: unknown;
    if (input.action === "fallback") {
      const unknown = input.chain.filter((m) => !known.has(m) && !/^[a-z]+\.anthropic\./.test(m));
      if (unknown.length) throw conflict(`Unknown model: ${unknown.join(", ")}`);
      key = FALLBACK_KEY;
      before = await setting(FALLBACK_KEY, z.array(modelId), []);
      value = [...new Set(input.chain)];
    } else {
      key = CREDITS_KEY;
      const cur = await setting(CREDITS_KEY, creditSchema, {});
      before = cur[input.model] ?? null;
      const next = { ...cur };
      if (input.input === null || input.output === null) delete next[input.model];
      else next[input.model] = { input: input.input, output: input.output };
      value = next;
    }
    const json = toJson(value) as Prisma.InputJsonValue;
    await tx.platformSetting.upsert({ where: { key }, create: { key, value: json, updatedById: ctx.actor.id, reason: input.reason }, update: { value: json, updatedById: ctx.actor.id, reason: input.reason } });
    await writeAudit(tx, ctx, { category: "SECURITY", action: input.action === "fallback" ? "platform.ai.fallback_changed" : "platform.ai.credits_changed", resourceType: "platform_control", resourceId: key, oldValue: before, newValue: input.action === "fallback" ? value : { [input.model]: input.input === null ? null : { input: input.input, output: input.output } }, reason: input.reason });
    return { ok: true };
  });
}

/** AI error management: failures by code, role and organization (7 days) and the latest failed tasks. */
export async function aiErrors(ctx: RequestContext) {
  await requireAnyPlatform(ctx, ["platform.ai.read", "platform.ai.manage"]);
  const since = daysAgo(7);
  const where = { status: "FAILED" as const, completedAt: { gte: since } };
  const [byCode, byProfile, byOrg, latest, total, completed] = await Promise.all([
    db().agentTask.groupBy({ by: ["errorCode"], where, _count: { _all: true } }),
    db().agentTask.groupBy({ by: ["profile"], where, _count: { _all: true } }),
    db().agentTask.groupBy({ by: ["organizationId"], where, _count: { _all: true }, orderBy: { _count: { organizationId: "desc" } }, take: 15 }),
    db().agentTask.findMany({ where, orderBy: { completedAt: "desc" }, take: 30, select: { id: true, organizationId: true, title: true, profile: true, errorCode: true, errorMessage: true, attempts: true, completedAt: true } }),
    db().agentTask.count({ where }),
    db().agentTask.count({ where: { completedAt: { gte: since } } }),
  ]);
  const orgs = await db().organization.findMany({ where: { id: { in: [...new Set([...byOrg.map((o) => o.organizationId), ...latest.map((l) => l.organizationId)])] } }, select: { id: true, name: true } });
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? id.slice(0, 8);
  return {
    total,
    rate: completed ? total / completed : null,
    byCode: byCode.map((r) => ({ code: r.errorCode ?? "unknown", count: r._count._all })).sort((a, b) => b.count - a.count),
    byProfile: byProfile.map((r) => ({ profile: r.profile, count: r._count._all })).sort((a, b) => b.count - a.count),
    byOrg: byOrg.map((r) => ({ id: r.organizationId, name: orgName(r.organizationId), count: r._count._all })),
    latest: latest.map((l) => ({ ...l, organizationName: orgName(l.organizationId) })),
  };
}

// ───────────── AI employee administration ─────────────

export const employeeAdminInput = z.object({
  model: z.string().regex(/^[a-z0-9.-]{3,64}$/).nullable().optional(),
  autonomy: updateEmployeeInput.shape.autonomy,
  monthlyTokenBudget: updateEmployeeInput.shape.monthlyTokenBudget,
  monthlyCostBudgetCents: updateEmployeeInput.shape.monthlyCostBudgetCents,
  allowedTools: updateEmployeeInput.shape.allowedTools,
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
  reason: reasonSchema,
});

export async function getEmployeeAdmin(ctx: RequestContext, employeeId: string) {
  await requireAnyPlatform(ctx, ["platform.ai.read", "platform.ai.manage"]);
  if (!isUuid(employeeId)) throw notFound("AI employee");
  const e = await db().aiEmployee.findUnique({
    where: { id: employeeId },
    select: { id: true, organizationId: true, companyId: true, name: true, profileKey: true, department: true, status: true, autonomy: true, level: true, jobTitle: true, model: true, allowedTools: true, monthlyTokenBudget: true, monthlyCostBudgetCents: true, archivedAt: true, createdAt: true },
  });
  if (!e) throw notFound("AI employee");
  const profile = AGENT_PROFILES.find((p) => p.key === e.profileKey);
  const [org, company] = await Promise.all([db().organization.findUnique({ where: { id: e.organizationId }, select: { name: true } }), db().company.findUnique({ where: { id: e.companyId }, select: { name: true } })]);
  return { ...e, organizationName: org?.name ?? "", companyName: company?.name ?? "", profileTools: profile ? [...profile.tools] : [] };
}

/** Change model / tools / budgets / autonomy / status of any AI employee via the workforce service, audited as the admin. */
export async function updateEmployeeAdmin(ctx: RequestContext, employeeId: string, raw: z.input<typeof employeeAdminInput>) {
  const { reason, status, ...changes } = employeeAdminInput.parse(raw);
  await requirePermission(ctx, "platform.ai.manage", platformChain());
  if (!isUuid(employeeId)) throw notFound("AI employee");
  const e = await db().aiEmployee.findUnique({ where: { id: employeeId }, select: { organizationId: true, companyId: true, model: true, autonomy: true, monthlyTokenBudget: true, monthlyCostBudgetCents: true, allowedTools: true, status: true } });
  if (!e) throw notFound("AI employee");
  const sys = systemContext(ctx.requestId);
  const fields = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
  if (Object.keys(fields).length) await updateEmployee(sys, e.organizationId, e.companyId, employeeId, fields);
  if (status && status !== e.status) await setEmployeeStatus(sys, e.organizationId, e.companyId, employeeId, { status });
  await transaction((tx) =>
    writeAudit(tx, ctx, {
      category: "ADMIN",
      organizationId: e.organizationId,
      action: "platform.ai.employee_updated",
      resourceType: "ai_employee",
      resourceId: employeeId,
      oldValue: { model: e.model, autonomy: e.autonomy, monthlyTokenBudget: e.monthlyTokenBudget, monthlyCostBudgetCents: e.monthlyCostBudgetCents?.toString() ?? null, allowedTools: e.allowedTools, status: e.status },
      newValue: { ...fields, ...(status ? { status } : {}) },
      reason,
    }),
  );
  return { ok: true };
}
