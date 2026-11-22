import { z } from "zod";
import { db, transaction, Prisma } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { toJson } from "@/server/core/json";
import { getControls } from "@/server/core/platform-controls";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { setEmployeeStatus, updateEmployee, updateEmployeeInput } from "@/server/modules/workforce/service";
import { MODEL_PRICES } from "@/server/modules/workforce/pricing";
import { daysAgo, isUuid, reasonSchema, requireAnyPlatform } from "./access";

/**
 * AI operations extras (stream C; split out of ops.ts in Step 0):
 *  - AI routing: fallback chain + credit cost per model (platform settings);
 *  - AI error management;
 *  - AI employees: model / tools / budget / autonomy / pause through the workforce service (system principal).
 */

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
