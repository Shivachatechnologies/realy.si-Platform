import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { env } from "@/server/core/env";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { toJson } from "@/server/core/json";
import { getControls, getOrgOverride, listOrgOverrides } from "@/server/core/platform-controls";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { AI_PROVIDER_KEYS, AI_PROVIDERS, providerKeyConfigured, providerOf } from "@/server/modules/agents/providers/catalog";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { MODEL_PRICES } from "@/server/modules/workforce/pricing";
import { isUuid, reasonSchema, requireAnyPlatform, utcMonthStart } from "./access";
import { aiCostUsage } from "./ai";
import { setControl, setOrgOverride } from "./controls";
import { aiUsageSince } from "./overview";
import type { BudgetScope } from "./ai-budgets";

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

/** Agent-runtime providers (agents/providers/catalog.ts): Anthropic, OpenAI and Gemini adapters, one platform key each. */
export { AI_PROVIDERS, providerOf };

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

let legacyCapCache: { at: number; refused: boolean } | null = null;

/**
 * Refusal code when a platform AI budget is reached, else null: the legacy platform-wide monthly USD cap (estimated
 * from task tokens), then the hard limits of the budgets center (Admin → AI → Budgets: global, organization,
 * department, AI employee, user, provider and model; daily or monthly) that apply to `scope`. Without a scope only
 * platform-wide limits apply. Fails open when the budget store is unavailable (logged by ai-budgets).
 */
export async function platformBudgetRefusal(scope: BudgetScope = {}): Promise<"platform_ai_budget_reached" | null> {
  if (!legacyCapCache || Date.now() - legacyCapCache.at > 30_000) {
    const cap = await readSetting(BUDGET_KEY, budgetSchema, null);
    legacyCapCache = { at: Date.now(), refused: cap !== null && (await aiUsageSince(utcMonthStart())).costMicros >= cap * 1_000_000 };
  }
  if (legacyCapCache.refused) return "platform_ai_budget_reached";
  const { budgetRefusal } = await import("./ai-budgets");
  return (await budgetRefusal(scope)) ? "platform_ai_budget_reached" : null;
}

/** Who / what a model call spends for (platform budgets). */
export type { BudgetScope };

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
  const providerCost = new Map<string, { tokens: number; costMicros: number; calls: number }>();
  for (const m of cost.byProvider) providerCost.set(m.provider, { tokens: m.tokens, costMicros: m.costMicros, calls: m.calls });
  const providers = AI_PROVIDERS.map((p) => {
    const own = models.filter((m) => p.match(m));
    return {
      key: p.key,
      label: p.label,
      configured: providerKeyConfigured(p.key),
      envKey: p.envKey,
      models: own.length,
      enabled: own.length > 0 ? own.some((m) => !controls.aiDisabledModels.includes(m)) : false,
      usage: providerCost.get(p.key) ?? { tokens: 0, costMicros: 0, calls: 0 },
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
  z.object({ action: z.literal("provider"), provider: z.enum(AI_PROVIDER_KEYS), enabled: z.boolean(), reason: reasonSchema }),
  z.object({ action: z.literal("profileModel"), profileClass: z.string().max(60), model: modelId.nullable(), reason: reasonSchema }),
  z.object({ action: z.literal("orgModel"), organizationId: z.string().uuid(), model: modelId.nullable(), reason: reasonSchema }),
  z.object({ action: z.literal("budget"), monthlyUsd: budgetSchema, reason: reasonSchema }),
]);

export async function updateAiModels(ctx: RequestContext, raw: z.input<typeof aiModelsInput>) {
  const input = aiModelsInput.parse(raw);
  const c = await getControls();
  const known = new Set([...Object.keys(MODEL_PRICES), env().AGENT_MODEL]);
  const usable = (m: string) => {
    if (!known.has(m)) throw invalid("Unknown model", { reason: "ai_unknown_model" });
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
      legacyCapCache = null;
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

// ───────────── Routing by task complexity (agents/router.ts) ─────────────

/**
 * Routing tiers (routing v2). Complexity tiers of an agent run (simple / standard / complex), work-type tiers chosen by
 * the per-task-type override map (coding / creative; unset → the run's complexity tier), the embedding tier (recorded
 * for the brain module; embeddings currently run on each company's own provider connection) and specialized media
 * tiers other modules resolve through the same table.
 */
export const ROUTING_TIERS = ["simple", "standard", "complex", "coding", "creative", "embedding", "voice", "image", "video"] as const;
export type RoutingTier = (typeof ROUTING_TIERS)[number];
/** Tiers whose value is a provider-specific id (not necessarily a priced chat model). */
const FREEFORM_TIERS = new Set<RoutingTier>(["embedding", "voice", "image", "video"]);
/** Tiers that fall back to the run's complexity tier when no model is set (null from resolveTierModel). */
export const WORK_TIERS = ["coding", "creative"] as const;
/** The directive's tier names → this table's tiers ("department" = per-class rows, "task" = per-task-type overrides). */
export const DIRECTIVE_TIERS = { default: "standard", fast: "simple", reasoning: "complex", coding: "coding", creative: "creative", embedding: "embedding", fallback: "fallback chain", department: "profile class row", task: "task-type override" } as const;
const TIER_MODELS_KEY = "ai:tierModels";
/** Media tiers hold provider model ids (e.g. a TTS voice model), not only Claude ids. */
const mediaModelId = z.string().regex(/^[A-Za-z0-9._:@/-]{2,80}$/);
const tierRow = z.object({
  simple: modelId.nullable().optional(),
  standard: modelId.nullable().optional(),
  complex: modelId.nullable().optional(),
  coding: modelId.nullable().optional(),
  creative: modelId.nullable().optional(),
  embedding: mediaModelId.nullable().optional(),
  voice: mediaModelId.nullable().optional(),
  image: mediaModelId.nullable().optional(),
  video: mediaModelId.nullable().optional(),
});
const tierTable = z.object({ enabled: z.boolean().default(true), byClass: z.record(z.string(), tierRow).default({}) });
export type TierTable = z.infer<typeof tierTable>;

/**
 * Built-in routing used until a platform admin edits the table: simple runs on the cheap tier, standard on the mid
 * tier, complex reasoning on the class / platform default (resolvePlatformModel). Disallowed models are skipped.
 */
export const DEFAULT_TIER_MODELS: Partial<Record<RoutingTier, string>> = { simple: "claude-haiku-5-5", standard: "claude-sonnet-5-5" };

let tierCache: { at: number; table: TierTable } | null = null;

/** The routing table: { enabled, byClass: { "*": {simple, standard, complex, voice, image, video}, "<class>": {...} } }. */
export async function readTierModels(): Promise<TierTable> {
  if (!tierCache || Date.now() - tierCache.at > 30_000) tierCache = { at: Date.now(), table: await readSetting(TIER_MODELS_KEY, tierTable, { enabled: true, byClass: {} }) };
  return tierCache.table;
}

/**
 * The model for a tier: an organization override always wins (pinned); else the class's tier model, the platform-wide
 * tier model, the built-in default; complex (or nothing usable) falls back to resolvePlatformModel. Returns null for a
 * media tier with no configured model (the module then uses its own default). Never returns a disabled model.
 */
export async function resolveTierModel(opts: { organizationId?: string | null; profile?: string | null; tier: RoutingTier }): Promise<string | null> {
  const [table, c] = await Promise.all([readTierModels(), getControls()]);
  const dept = opts.profile ? (AGENT_PROFILES.find((p) => p.key === opts.profile)?.department ?? "general") : null;
  if (FREEFORM_TIERS.has(opts.tier)) return (dept ? table.byClass[dept]?.[opts.tier] : null) ?? table.byClass["*"]?.[opts.tier] ?? null;
  if ((WORK_TIERS as readonly string[]).includes(opts.tier)) {
    // Work-type tier: only an explicitly configured, allowed model (else null → the caller uses the complexity tier).
    if (!table.enabled) return null;
    const ok = (m: string | null | undefined): m is string => !!m && !c.aiDisabledModels.includes(m) && (c.aiAllowedModels.length === 0 || c.aiAllowedModels.includes(m));
    await resolvePlatformModel(opts); // refreshes resolverCache (organization overrides)
    const orgPinned = opts.organizationId ? resolverCache?.org[opts.organizationId] : undefined;
    if (orgPinned && ok(orgPinned)) return null;
    return [dept ? table.byClass[dept]?.[opts.tier] : null, table.byClass["*"]?.[opts.tier]].find(ok) ?? null;
  }
  const platform = await resolvePlatformModel(opts);
  const orgPinned = opts.organizationId ? resolverCache?.org[opts.organizationId] : undefined;
  if (orgPinned && orgPinned === platform) return platform;
  if (!table.enabled) return platform;
  const allowed = (m: string | null | undefined): m is string => !!m && !c.aiDisabledModels.includes(m) && (c.aiAllowedModels.length === 0 || c.aiAllowedModels.includes(m));
  const candidates = [dept ? table.byClass[dept]?.[opts.tier] : null, table.byClass["*"]?.[opts.tier], opts.tier === "complex" ? null : DEFAULT_TIER_MODELS[opts.tier]];
  return candidates.find(allowed) ?? platform;
}

export const tierModelsInput = z.object({
  enabled: z.boolean().optional(),
  /** "*" or a profile class. */
  profileClass: z.string().max(60).optional(),
  tiers: tierRow.optional(),
  reason: reasonSchema,
});

/** Admin: edit the routing table (per class or platform-wide "*"), audited. */
export async function updateTierModels(ctx: RequestContext, raw: z.input<typeof tierModelsInput>) {
  await requirePermission(ctx, "platform.ai.manage", platformChain());
  const input = tierModelsInput.parse(raw);
  const cur = await readSetting(TIER_MODELS_KEY, tierTable, { enabled: true, byClass: {} });
  const next: TierTable = { enabled: input.enabled ?? cur.enabled, byClass: { ...cur.byClass } };
  if (input.tiers) {
    const cls = input.profileClass ?? "*";
    if (cls !== "*" && !PROFILE_CLASSES.includes(cls)) throw notFound("Profile class");
    const known = new Set([...Object.keys(MODEL_PRICES), env().AGENT_MODEL]);
    for (const t of ["simple", "standard", "complex", "coding", "creative"] as const) {
      const m = input.tiers[t];
      if (m && !known.has(m)) throw invalid("Unknown model", { reason: "ai_unknown_model" });
    }
    next.byClass[cls] = input.tiers;
  }
  await saveSetting(ctx, TIER_MODELS_KEY, next, input.reason, { action: "platform.ai.tier_models_changed", oldValue: cur, newValue: next });
  tierCache = null;
  return next;
}

/**
 * Admin → AI → Models (G1, B14): the routing table (per class and platform-wide), the model each agent tier resolves
 * to right now, and provider health — whether each provider's platform key is set, plus the shared circuit-breaker
 * state of every model that failed recently (agents/router.ts).
 */
export async function aiRoutingOverview(ctx: RequestContext) {
  await requireAnyPlatform(ctx, AI_READ);
  const { breakerSnapshot } = await import("@/server/modules/agents/router");
  const [table, breakers] = await Promise.all([readTierModels(), breakerSnapshot().catch(() => [])]);
  const effective: Record<string, Record<"simple" | "standard" | "complex", string | null>> = {};
  for (const cls of ["*", ...PROFILE_CLASSES]) {
    const profile = cls === "*" ? null : (AGENT_PROFILES.find((p) => (p.department ?? "general") === cls)?.key ?? null);
    effective[cls] = {
      simple: await resolveTierModel({ profile, tier: "simple" }),
      standard: await resolveTierModel({ profile, tier: "standard" }),
      complex: await resolveTierModel({ profile, tier: "complex" }),
    };
  }
  return {
    table,
    classes: ["*", ...PROFILE_CLASSES],
    effective,
    defaults: DEFAULT_TIER_MODELS,
    providers: AI_PROVIDERS.map((p) => ({ key: p.key, label: p.label, envKey: p.envKey, configured: providerKeyConfigured(p.key), fallbackModels: p.fallbackModels, openBreakers: breakers.filter((b) => b.provider === p.key && b.open).length })),
    breakers,
  };
}

// ───────────── Routing v2: per-task-type overrides and the effective-route simulator ─────────────

const TASK_TIERS_KEY = "ai:taskTiers";
export const OVERRIDE_TIERS = ["simple", "standard", "complex", "coding", "creative"] as const;
export type OverrideTier = (typeof OVERRIDE_TIERS)[number];
/** Task type = an agent profile key (e.g. "engineering_lead") or a quick-call operation (e.g. "voiceos.answer"). */
const taskTypeKey = z.string().regex(/^[a-z0-9_.:-]{2,80}$/);
const taskTierMap = z.record(z.string(), z.enum(OVERRIDE_TIERS));
let taskTierCache: { at: number; map: Record<string, OverrideTier> } | null = null;

/** The per-task-type routing overrides (cached 30 s). */
export async function readTaskTiers(): Promise<Record<string, OverrideTier>> {
  if (!taskTierCache || Date.now() - taskTierCache.at > 30_000) taskTierCache = { at: Date.now(), map: await readSetting(TASK_TIERS_KEY, taskTierMap, {}) };
  return taskTierCache.map;
}

/** Override tier for a task type (profile key, then quick-call operation), or null. */
export async function taskTierOverride(keys: (string | null | undefined)[]): Promise<OverrideTier | null> {
  const map = await readTaskTiers();
  for (const k of keys) if (k && map[k]) return map[k];
  return null;
}

export const taskTierInput = z.object({ taskType: taskTypeKey, tier: z.enum(OVERRIDE_TIERS).nullable(), reason: reasonSchema });

/** Admin: set or clear one task-type override, audited. */
export async function updateTaskTier(ctx: RequestContext, raw: z.input<typeof taskTierInput>) {
  const input = taskTierInput.parse(raw);
  await requirePermission(ctx, "platform.ai.manage", platformChain());
  const cur = await readSetting(TASK_TIERS_KEY, taskTierMap, {});
  const next = { ...cur };
  if (input.tier) next[input.taskType] = input.tier;
  else delete next[input.taskType];
  await saveSetting(ctx, TASK_TIERS_KEY, next, input.reason, { action: "platform.ai.task_tier_changed", oldValue: { [input.taskType]: cur[input.taskType] ?? null }, newValue: { [input.taskType]: input.tier } });
  taskTierCache = null;
  return next;
}

export const simulateRouteInput = z.object({
  organizationId: z.string().uuid().nullable().optional(),
  profile: z.string().regex(/^[a-z0-9_]{2,60}$/),
  title: z.string().trim().max(500).default(""),
  instructions: z.string().max(20_000).default(""),
  toolCount: z.coerce.number().int().min(0).max(100).optional(),
  operation: taskTypeKey.optional(),
});

/**
 * Effective-route simulator: "org X, profile Y, title Z → model". Runs the same deterministic classification and the
 * same resolution as the runtime (task-type override, organization pin, class row, platform row, built-in default),
 * then the fallback chain and the breaker state of each candidate. No model is called.
 */
export async function simulateRoute(ctx: RequestContext, raw: z.input<typeof simulateRouteInput>) {
  await requireAnyPlatform(ctx, AI_READ);
  const input = simulateRouteInput.parse(raw);
  const { classifyRun, fallbackChain, breakerSnapshot } = await import("@/server/modules/agents/router");
  const profile = AGENT_PROFILES.find((p) => p.key === input.profile);
  if (!profile) throw notFound("Profile");
  const organizationId = input.organizationId ?? null;
  const classification = classifyRun({ profile, title: input.title, instructions: input.instructions, toolCount: input.toolCount ?? profile.tools.length });
  const override = await taskTierOverride([profile.key, input.operation]);
  const complexity = override && !(WORK_TIERS as readonly string[]).includes(override) ? (override as "simple" | "standard" | "complex") : classification.tier;
  const work = override && (WORK_TIERS as readonly string[]).includes(override) ? override : null;
  const steps: { step: string; model: string | null; used: boolean }[] = [];
  const workModel = work ? await resolveTierModel({ organizationId, profile: profile.key, tier: work }) : null;
  if (work) steps.push({ step: `tier:${work}`, model: workModel, used: !!workModel });
  const tierModel = await resolveTierModel({ organizationId, profile: profile.key, tier: complexity });
  steps.push({ step: `tier:${complexity}`, model: tierModel, used: !workModel && !!tierModel });
  const platform = await resolvePlatformModel({ organizationId, profile: profile.key });
  const model = workModel ?? tierModel ?? platform;
  if (!workModel && !tierModel) steps.push({ step: "platform_default", model: platform, used: true });
  const orgPinned = organizationId ? (resolverCache?.org[organizationId] ?? null) : null;
  const [chain, breakers, c] = await Promise.all([fallbackChain(organizationId, profile.key, model, complexity).catch(() => [] as string[]), breakerSnapshot().catch(() => []), getControls()]);
  const allowed = (m: string) => !c.aiDisabledModels.includes(m) && (c.aiAllowedModels.length === 0 || c.aiAllowedModels.includes(m));
  return {
    classification,
    override,
    complexityTier: complexity,
    workTier: work,
    orgPinned,
    steps,
    model,
    provider: providerOf(model),
    providerConfigured: providerKeyConfigured(providerOf(model)),
    allowed: allowed(model),
    fallbackChain: chain.map((m) => ({ model: m, provider: providerOf(m), configured: providerKeyConfigured(providerOf(m)), breakerOpen: breakers.some((b) => b.model === m && b.open) })),
    breakerOpen: breakers.some((b) => b.model === model && b.open),
    killSwitch: !c.aiWorkforceEnabled || c.aiExecutionPaused,
  };
}
