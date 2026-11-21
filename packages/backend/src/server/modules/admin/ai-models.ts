import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { env } from "@/server/core/env";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { toJson } from "@/server/core/json";
import { getControls, getOrgOverride, listOrgOverrides } from "@/server/core/platform-controls";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { MODEL_PRICES } from "@/server/modules/workforce/pricing";
import { isUuid, reasonSchema, requireAnyPlatform, utcMonthStart } from "./access";
import { aiCostUsage } from "./ai";
import { setControl, setOrgOverride } from "./controls";
import { aiUsageSince } from "./overview";

/**
 * AI Control → Models & providers and AI workforce browser.
 *  - Providers: the providers the agent runtime can call, whether their credentials are configured, and an on/off
 *    switch (off = every model of that provider goes on the existing `aiDisabledModels` kill list, so it is enforced
 *    by aiRefusal/isModelAllowed everywhere).
 *  - Default model per profile class (department) and per-organization model overrides, resolved by
 *    resolvePlatformModel() (org override → class default → platform default → AGENT_MODEL).
 *  - Platform monthly AI spend cap in USD (estimated cost), checked by platformBudgetRefusal().
 *  - Cost by provider / model / organization; AI employees across tenants with per-organization pause/resume
 *    (the existing organization AI restriction).
 */

const AI_READ = ["platform.ai.read", "platform.ai.manage"];
const PROFILE_MODELS_KEY = "ai:profileModels";
const ORG_MODELS_KEY = "ai:orgModels";
const BUDGET_KEY = "ai:monthlyBudgetUsd";
const modelId = z.string().regex(/^[a-z0-9.@-]{3,64}$/);

export const AI_PROVIDERS = [
  { key: "anthropic", label: "Anthropic API", env: "ANTHROPIC_API_KEY", match: (m: string) => !/^[a-z]+\.anthropic\./.test(m) },
  { key: "aws-bedrock", label: "Amazon Bedrock", env: null, match: (m: string) => /^[a-z]+\.anthropic\./.test(m) },
] as const;
export const providerOf = (model: string | null | undefined) => (model ? (AI_PROVIDERS.find((p) => p.match(model))?.key ?? "anthropic") : "anthropic");

export const PROFILE_CLASSES = [...new Set(AGENT_PROFILES.map((p) => p.department ?? "general"))].sort();

async function readSetting<T>(key: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  const row = await db().platformSetting.findUnique({ where: { key } }).catch(() => null);
  const parsed = schema.safeParse(row?.value);
  return parsed.success ? parsed.data : fallback;
}
const modelMap = z.record(z.string(), modelId);
const budgetSchema = z.number().min(0).max(10_000_000).nullable();

let resolverCache: { at: number; profile: Record<string, string>; org: Record<string, string> } | null = null;

/**
 * The model an AI run should use when neither the task nor its AI employee pins one: the organization's override,
 * else the default for the profile's class (department), else the platform default (Admin → AI), else AGENT_MODEL.
 * Disallowed models are skipped. Agents runtime hook: call this in place of agentModel(env().AGENT_MODEL).
 */
export async function resolvePlatformModel(opts: { organizationId?: string | null; profile?: string | null }): Promise<string> {
  if (!resolverCache || Date.now() - resolverCache.at > 30_000) {
    resolverCache = { at: Date.now(), profile: await readSetting(PROFILE_MODELS_KEY, modelMap, {}), org: await readSetting(ORG_MODELS_KEY, modelMap, {}) };
  }
  const c = await getControls();
  const allowed = (m: string | undefined): m is string => !!m && !c.aiDisabledModels.includes(m) && (c.aiAllowedModels.length === 0 || c.aiAllowedModels.includes(m));
  const dept = opts.profile ? (AGENT_PROFILES.find((p) => p.key === opts.profile)?.department ?? "general") : null;
  const candidates = [opts.organizationId ? resolverCache.org[opts.organizationId] : undefined, dept ? resolverCache.profile[dept] : undefined, c.aiDefaultModel ?? undefined];
  return candidates.find(allowed) ?? env().AGENT_MODEL;
}

/** Refusal code when the platform-wide monthly AI spend cap (USD, estimated) is reached, else null. */
export async function platformBudgetRefusal(): Promise<"platform_ai_budget_reached" | null> {
  const cap = await readSetting(BUDGET_KEY, budgetSchema, null);
  if (cap === null) return null;
  const usage = await aiUsageSince(utcMonthStart());
  return usage.costMicros >= cap * 1_000_000 ? "platform_ai_budget_reached" : null;
}

export async function aiModelsOverview(ctx: RequestContext, raw: { days?: unknown } = {}) {
  await requireAnyPlatform(ctx, AI_READ);
  const [controls, profileModels, orgModels, budgetUsd, month, cost] = await Promise.all([
    getControls(),
    readSetting(PROFILE_MODELS_KEY, modelMap, {}),
    readSetting(ORG_MODELS_KEY, modelMap, {}),
    readSetting(BUDGET_KEY, budgetSchema, null),
    aiUsageSince(utcMonthStart()),
    aiCostUsage(ctx, { days: Number(raw.days) || 30 }),
  ]);
  const models = [...new Set([...Object.keys(MODEL_PRICES), ...cost.byModel.map((m) => m.model).filter((m) => m !== "unknown"), env().AGENT_MODEL])].sort();
  const providerCost = new Map<string, { tokens: number; costMicros: number; tasks: number }>();
  for (const m of cost.byModel) {
    const p = providerOf(m.model);
    const cur = providerCost.get(p) ?? { tokens: 0, costMicros: 0, tasks: 0 };
    providerCost.set(p, { tokens: cur.tokens + m.tokens, costMicros: cur.costMicros + m.costMicros, tasks: cur.tasks + m.tasks });
  }
  const providers = AI_PROVIDERS.map((p) => {
    const own = models.filter((m) => p.match(m));
    return {
      key: p.key,
      label: p.label,
      configured: p.key === "anthropic" ? aiConfigured() : false,
      models: own.length,
      enabled: own.length > 0 ? own.some((m) => !controls.aiDisabledModels.includes(m)) : false,
      usage: providerCost.get(p.key) ?? { tokens: 0, costMicros: 0, tasks: 0 },
    };
  });
  const orgIds = Object.keys(orgModels);
  const orgs = orgIds.length ? await db().organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [];
  return {
    providers,
    models: models.map((m) => ({ id: m, provider: providerOf(m), price: MODEL_PRICES[m] ?? null, disabled: controls.aiDisabledModels.includes(m), allowed: controls.aiAllowedModels.length === 0 || controls.aiAllowedModels.includes(m), usage: cost.byModel.find((b) => b.model === m) ?? null })),
    platformDefault: controls.aiDefaultModel ?? env().AGENT_MODEL,
    profileClasses: PROFILE_CLASSES.map((c) => ({ key: c, profiles: AGENT_PROFILES.filter((p) => (p.department ?? "general") === c).length, model: profileModels[c] ?? null })),
    orgOverrides: orgIds.map((id) => ({ organizationId: id, name: orgs.find((o) => o.id === id)?.name ?? id.slice(0, 8), model: orgModels[id]! })),
    budget: { monthlyUsd: budgetUsd, spentMicros: month.costMicros, tokenDaily: controls.aiDailyTokenBudget, tokenMonthly: controls.aiMonthlyTokenBudget, tokensMonth: month.tokens },
    cost,
  };
}

async function saveSetting(ctx: RequestContext, key: string, value: unknown, reason: string, audit: { action: string; organizationId?: string; oldValue?: unknown; newValue?: unknown }) {
  await transaction(async (tx) => {
    await requirePermission(ctx, "platform.ai.manage", platformChain(), tx);
    const json = toJson(value) as Prisma.InputJsonValue;
    await tx.platformSetting.upsert({ where: { key }, create: { key, value: json, updatedById: ctx.actor.id, reason }, update: { value: json, updatedById: ctx.actor.id, reason } });
    await writeAudit(tx, ctx, { category: "SECURITY", organizationId: audit.organizationId, action: audit.action, resourceType: "platform_control", resourceId: key, oldValue: audit.oldValue, newValue: audit.newValue, reason });
  });
  resolverCache = null;
}

export const aiModelsInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("provider"), provider: z.enum(["anthropic", "aws-bedrock"]), enabled: z.boolean(), reason: reasonSchema }),
  z.object({ action: z.literal("profileModel"), profileClass: z.string().max(60), model: modelId.nullable(), reason: reasonSchema }),
  z.object({ action: z.literal("orgModel"), organizationId: z.string().uuid(), model: modelId.nullable(), reason: reasonSchema }),
  z.object({ action: z.literal("budget"), monthlyUsd: budgetSchema, reason: reasonSchema }),
]);

export async function updateAiModels(ctx: RequestContext, raw: z.input<typeof aiModelsInput>) {
  const input = aiModelsInput.parse(raw);
  const c = await getControls();
  const known = new Set([...Object.keys(MODEL_PRICES), env().AGENT_MODEL]);
  const usable = (m: string) => {
    if (!known.has(m) && !/^[a-z]+\.anthropic\./.test(m)) throw invalid("Unknown model", { reason: "ai_unknown_model" });
    if (c.aiDisabledModels.includes(m) || (c.aiAllowedModels.length && !c.aiAllowedModels.includes(m))) throw conflict("That model is disabled platform-wide. Enable it first.", { reason: "ai_model_disabled" });
  };
  switch (input.action) {
    case "provider": {
      const p = AI_PROVIDERS.find((x) => x.key === input.provider)!;
      const own = [...known].filter((m) => p.match(m));
      const next = input.enabled ? c.aiDisabledModels.filter((m) => !own.includes(m)) : [...new Set([...c.aiDisabledModels, ...own])];
      await setControl(ctx, { key: "aiDisabledModels", value: next, reason: `${input.enabled ? "Enable" : "Disable"} provider ${p.label}: ${input.reason}` });
      return { provider: input.provider, enabled: input.enabled };
    }
    case "profileModel": {
      if (!PROFILE_CLASSES.includes(input.profileClass)) throw notFound("Profile class");
      if (input.model) usable(input.model);
      const cur = await readSetting(PROFILE_MODELS_KEY, modelMap, {});
      const next = { ...cur };
      if (input.model) next[input.profileClass] = input.model;
      else delete next[input.profileClass];
      await saveSetting(ctx, PROFILE_MODELS_KEY, next, input.reason, { action: "platform.ai.profile_model_changed", oldValue: { [input.profileClass]: cur[input.profileClass] ?? null }, newValue: { [input.profileClass]: input.model } });
      return next;
    }
    case "orgModel": {
      if (input.model) usable(input.model);
      if (!(await db().organization.findUnique({ where: { id: input.organizationId }, select: { id: true } }))) throw notFound("Organization");
      const cur = await readSetting(ORG_MODELS_KEY, modelMap, {});
      const next = { ...cur };
      if (input.model) next[input.organizationId] = input.model;
      else delete next[input.organizationId];
      await saveSetting(ctx, ORG_MODELS_KEY, next, input.reason, { action: "platform.ai.org_model_changed", organizationId: input.organizationId, oldValue: { model: cur[input.organizationId] ?? null }, newValue: { model: input.model } });
      return next;
    }
    case "budget": {
      const cur = await readSetting(BUDGET_KEY, budgetSchema, null);
      await saveSetting(ctx, BUDGET_KEY, input.monthlyUsd, input.reason, { action: "platform.ai.budget_changed", oldValue: { monthlyUsd: cur }, newValue: { monthlyUsd: input.monthlyUsd } });
      return { monthlyUsd: input.monthlyUsd };
    }
  }
}

// ───────────── AI workforce across tenants ─────────────

const employeeFilters = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  org: z.string().uuid().optional().catch(undefined),
  status: z.enum(["ACTIVE", "PAUSED"]).optional().catch(undefined),
  department: z.string().regex(/^[a-z_]{2,40}$/).optional().catch(undefined),
});

export async function aiWorkforceBrowser(ctx: RequestContext, raw: Partial<Record<keyof z.input<typeof employeeFilters>, unknown>> = {}) {
  await requireAnyPlatform(ctx, AI_READ);
  const f = employeeFilters.parse(raw);
  const where: Prisma.AiEmployeeWhereInput = {
    archivedAt: null,
    ...(f.org ? { organizationId: f.org } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.department ? { department: f.department } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { jobTitle: { contains: f.q, mode: "insensitive" } }, { profileKey: { contains: f.q.toLowerCase() } }] } : {}),
  };
  const [rows, byOrg, byDept, overrides] = await Promise.all([
    db().aiEmployee.findMany({
      where,
      orderBy: [{ organizationId: "asc" }, { createdAt: "asc" }],
      take: 300,
      select: { id: true, organizationId: true, companyId: true, name: true, initials: true, profileKey: true, department: true, status: true, autonomy: true, level: true, jobTitle: true, model: true, monthlyTokenBudget: true, createdAt: true },
    }),
    db().aiEmployee.groupBy({ by: ["organizationId", "status"], where: { archivedAt: null }, _count: { _all: true } }),
    db().aiEmployee.groupBy({ by: ["department"], where: { archivedAt: null }, _count: { _all: true } }),
    listOrgOverrides(),
  ]);
  const orgIds = [...new Set([...rows.map((r) => r.organizationId), ...byOrg.map((b) => b.organizationId)])];
  const companyIds = [...new Set(rows.map((r) => r.companyId))];
  const [orgs, companies, tasks] = await Promise.all([
    db().organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true, status: true } }),
    db().company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }),
    rows.length ? db().agentTask.groupBy({ by: ["aiEmployeeId"], where: { aiEmployeeId: { in: rows.map((r) => r.id) }, createdAt: { gte: utcMonthStart() } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } }) : Promise.resolve([]),
  ]);
  const orgSummary = orgIds
    .map((id) => ({
      id,
      name: orgs.find((o) => o.id === id)?.name ?? id.slice(0, 8),
      active: byOrg.find((b) => b.organizationId === id && b.status === "ACTIVE")?._count._all ?? 0,
      paused: byOrg.find((b) => b.organizationId === id && b.status === "PAUSED")?._count._all ?? 0,
      aiDisabled: overrides.get(id)?.aiDisabled ?? false,
    }))
    .sort((a, b) => b.active + b.paused - (a.active + a.paused));
  return {
    employees: rows.map((r) => {
      const t = tasks.find((x) => x.aiEmployeeId === r.id);
      return {
        ...r,
        organizationName: orgs.find((o) => o.id === r.organizationId)?.name ?? "",
        companyName: companies.find((c) => c.id === r.companyId)?.name ?? "",
        orgAiDisabled: overrides.get(r.organizationId)?.aiDisabled ?? false,
        tasksMonth: t?._count._all ?? 0,
        tokensMonth: (t?._sum.inputTokens ?? 0) + (t?._sum.outputTokens ?? 0),
      };
    }),
    organizations: orgSummary,
    departments: byDept.map((d) => ({ department: d.department, count: d._count._all })).sort((a, b) => b.count - a.count),
  };
}

export const orgAiPauseInput = z.object({ paused: z.boolean(), reason: reasonSchema });

/** Pause or resume all AI work of one organization (the existing organization AI restriction, audited). */
export async function setOrgAiPaused(ctx: RequestContext, organizationId: string, raw: z.input<typeof orgAiPauseInput>) {
  if (!isUuid(organizationId)) throw notFound("Organization");
  const input = orgAiPauseInput.parse(raw);
  const cur = await getOrgOverride(organizationId);
  return setOrgOverride(ctx, organizationId, { ...cur, aiDisabled: input.paused, reason: input.reason });
}
