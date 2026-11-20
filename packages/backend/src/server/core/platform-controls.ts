/**
 * Platform controls (Super Admin Control Center): global kill switches, AI policy, per-organization restrictions and
 * platform settings, stored as PlatformSetting rows and read through a short in-process cache so every check on the
 * request path is cheap. Safe by construction: a missing table, an unreadable row or an invalid value falls back to
 * the default (everything enabled) — a failed read never locks the platform.
 *
 * Enforcement points (each calls into this file): src/server/core/http.ts route() (maintenance, read-only, suspended
 * organizations, disabled modules, API quota), src/server/workspace.ts requireOrgContext (pages), signUp,
 * createCompany, agents createTask / processAgentTask, tools gateway requestTool, and the worker loop.
 *
 * No "server-only" import: the worker process reads the same controls.
 */
import { z } from "zod";
import { db, type Db, type Tx } from "./db";
import { AppError } from "./errors";
import { logger } from "./logger";

export const CONTROLS_TTL_MS = 10_000;

// ───────────── Modules ─────────────

export const PLATFORM_MODULES = ["crm", "marketing", "finance", "hr", "work", "comms", "support", "automation", "integrations", "workforce", "bi", "marketplace", "enterprise"] as const;
export type PlatformModule = (typeof PLATFORM_MODULES)[number];

/** API path segment after /companies/:companyId/ (or /organizations/:orgId/) → module. */
const API_SEGMENT_MODULE: Record<string, PlatformModule> = {
  livechat: "support",
  crm: "crm",
  leads: "crm",
  "follow-ups": "crm",
  sales: "crm",
  marketing: "marketing",
  finance: "finance",
  hr: "hr",
  work: "work",
  comms: "comms",
  support: "support",
  workflows: "automation",
  "workflow-runs": "automation",
  "workflow-approvals": "automation",
  integrations: "integrations",
  "integration-hooks": "integrations",
  "integration-syncs": "integrations",
  "integration-webhook-deliveries": "integrations",
  "integration-webhooks": "integrations",
  workforce: "workforce",
  tasks: "workforce",
  analytics: "bi",
  intelligence: "bi",
  marketplace: "marketplace",
  enterprise: "enterprise",
};

/** First page path segment after the locale → module. */
const PAGE_SEGMENT_MODULE: Record<string, PlatformModule> = {
  voice: "comms",
  livechat: "support",
  crm: "crm",
  sales: "crm",
  customers: "crm",
  marketing: "marketing",
  finance: "finance",
  hr: "hr",
  people: "hr",
  projects: "work",
  product: "work",
  operations: "work",
  communication: "comms",
  support: "support",
  workflows: "automation",
  integrations: "integrations",
  workforce: "workforce",
  tasks: "workforce",
  analytics: "bi",
  intelligence: "bi",
  marketplace: "marketplace",
};

const ORG_API = /^\/api\/v1\/organizations\/([0-9a-f-]{36})(?:\/companies\/[0-9a-f-]{36})?\/([a-z-]+)/;

/** Module addressed by an org-scoped API path, if any. */
export function moduleForApiPath(pathname: string): PlatformModule | null {
  const m = ORG_API.exec(pathname);
  return m ? (API_SEGMENT_MODULE[m[2]!] ?? null) : null;
}

/** Module of an app page path ("/en-US/crm/deals" → crm). */
export function moduleForPagePath(pathname: string): PlatformModule | null {
  const seg = pathname.split("/").filter(Boolean)[1];
  return seg ? (PAGE_SEGMENT_MODULE[seg] ?? null) : null;
}

/** Periodic worker job name ("finance.recurring_invoices") → module. */
export function moduleForJobName(name: string): PlatformModule | null {
  const prefix = name.split(".")[0] ?? "";
  return (PLATFORM_MODULES as readonly string[]).includes(prefix) ? (prefix as PlatformModule) : null;
}

// ───────────── Control registry ─────────────

const stringList = z.array(z.string().trim().min(1).max(120)).max(500);

export const AUTONOMY_CEILINGS = ["full", "supervised", "read_only"] as const;

/** Every platform control with its schema and safe default. */
export const CONTROL_DEFS = {
  aiWorkforceEnabled: { schema: z.boolean(), default: true, group: "kill", critical: true },
  aiExecutionPaused: { schema: z.boolean(), default: false, group: "kill", critical: false },
  registrationsEnabled: { schema: z.boolean(), default: true, group: "kill", critical: false },
  companyCreationEnabled: { schema: z.boolean(), default: true, group: "kill", critical: false },
  automationsEnabled: { schema: z.boolean(), default: true, group: "kill", critical: false },
  backgroundJobsPaused: { schema: z.boolean(), default: false, group: "kill", critical: true },
  maintenanceMode: { schema: z.boolean(), default: false, group: "kill", critical: true },
  readOnlyMode: { schema: z.boolean(), default: false, group: "kill", critical: true },
  disabledModules: { schema: z.array(z.enum(PLATFORM_MODULES)), default: [] as PlatformModule[], group: "kill", critical: false },
  disabledIntegrations: { schema: stringList, default: [] as string[], group: "kill", critical: false },
  // AI policy (platform.ai.manage)
  aiDisabledModels: { schema: stringList, default: [] as string[], group: "ai", critical: false },
  aiAllowedModels: { schema: stringList, default: [] as string[], group: "ai", critical: false },
  aiDefaultModel: { schema: z.string().regex(/^[a-z0-9.@-]{3,64}$/).nullable(), default: null as string | null, group: "ai", critical: false },
  aiDisabledProfiles: { schema: stringList, default: [] as string[], group: "ai", critical: false },
  aiDailyTokenBudget: { schema: z.number().int().min(0).max(1e12).nullable(), default: null as number | null, group: "ai", critical: false },
  aiMonthlyTokenBudget: { schema: z.number().int().min(0).max(1e13).nullable(), default: null as number | null, group: "ai", critical: false },
  aiRequireApprovalForWrites: { schema: z.boolean(), default: false, group: "ai", critical: false },
  aiAutonomyCeiling: { schema: z.enum(AUTONOMY_CEILINGS), default: "full" as (typeof AUTONOMY_CEILINGS)[number], group: "ai", critical: false },
  // Platform settings
  platformName: { schema: z.string().trim().min(1).max(80), default: "Realy", group: "settings", critical: false },
  supportEmail: { schema: z.string().trim().email().max(254).or(z.literal("")), default: "", group: "settings", critical: false },
  defaultLocale: { schema: z.enum(["en-US", "hi-IN", "ar-AE", "de-DE", "zh-CN"]), default: "en-US" as string, group: "settings", critical: false },
  signupDomainAllowlist: { schema: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(200), default: [] as string[], group: "settings", critical: false },
  maintenanceMessage: { schema: z.string().trim().max(500), default: "", group: "settings", critical: false },
} as const;

export type ControlKey = keyof typeof CONTROL_DEFS;
export type PlatformControls = { -readonly [K in ControlKey]: z.infer<(typeof CONTROL_DEFS)[K]["schema"]> } & {
  lockdown: LockdownState | null;
};
export const CONTROL_KEYS = Object.keys(CONTROL_DEFS) as ControlKey[];
export const isControlKey = (k: string): k is ControlKey => Object.hasOwn(CONTROL_DEFS, k);

/** Switches emergency lockdown changes, and the values it sets. */
export const LOCKDOWN_SETS = { maintenanceMode: true, aiWorkforceEnabled: false, backgroundJobsPaused: true } as const;
export const lockdownSchema = z.object({
  startedAt: z.string(),
  startedById: z.string().nullable(),
  reason: z.string(),
  previous: z.object({ maintenanceMode: z.boolean(), aiWorkforceEnabled: z.boolean(), backgroundJobsPaused: z.boolean() }),
  revokedSessions: z.number().int(),
});
export type LockdownState = z.infer<typeof lockdownSchema>;
export const LOCKDOWN_KEY = "lockdown";

/** Per-organization restrictions set by platform admins (key "org:<id>"). */
export const orgOverrideSchema = z.object({
  disabledModules: z.array(z.enum(PLATFORM_MODULES)).default([]),
  aiDisabled: z.boolean().default(false),
  aiDailyTokenBudget: z.number().int().min(0).max(1e12).nullable().default(null),
  aiMonthlyTokenBudget: z.number().int().min(0).max(1e13).nullable().default(null),
});
export type OrgOverride = z.infer<typeof orgOverrideSchema>;
export const orgOverrideKey = (organizationId: string) => `org:${organizationId}`;
const EMPTY_OVERRIDE: OrgOverride = { disabledModules: [], aiDisabled: false, aiDailyTokenBudget: null, aiMonthlyTokenBudget: null };

export function defaultControls(): PlatformControls {
  const out: Record<string, unknown> = { lockdown: null };
  for (const k of CONTROL_KEYS) {
    const d = CONTROL_DEFS[k].default;
    out[k] = Array.isArray(d) ? [...d] : d;
  }
  return out as PlatformControls;
}

// ───────────── Cache ─────────────

interface Snapshot {
  at: number;
  controls: PlatformControls;
  orgs: Map<string, OrgOverride>;
  meta: Map<string, { updatedAt: Date; updatedById: string | null; reason: string | null }>;
}
let snapshot: Snapshot | null = null;
let loading: Promise<Snapshot> | null = null;

async function load(): Promise<Snapshot> {
  const controls = defaultControls();
  const orgs = new Map<string, OrgOverride>();
  const meta: Snapshot["meta"] = new Map();
  try {
    const rows = await db().platformSetting.findMany();
    for (const row of rows) {
      meta.set(row.key, { updatedAt: row.updatedAt, updatedById: row.updatedById, reason: row.reason });
      if (row.key.startsWith("org:")) {
        const parsed = orgOverrideSchema.safeParse(row.value);
        if (parsed.success) orgs.set(row.key.slice(4), parsed.data);
      } else if (row.key === LOCKDOWN_KEY) {
        const parsed = lockdownSchema.nullable().safeParse(row.value);
        if (parsed.success) controls.lockdown = parsed.data;
      } else if (isControlKey(row.key)) {
        const parsed = CONTROL_DEFS[row.key].schema.safeParse(row.value);
        if (parsed.success) (controls as Record<string, unknown>)[row.key] = parsed.data;
        else logger.warn({ key: row.key }, "invalid platform setting ignored");
      }
    }
  } catch (err) {
    // Table missing (not migrated) or database unreachable: run with defaults rather than lock the platform.
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "platform controls unavailable; using defaults");
  }
  return { at: Date.now(), controls, orgs, meta };
}

async function current(): Promise<Snapshot> {
  if (snapshot && Date.now() - snapshot.at < CONTROLS_TTL_MS) return snapshot;
  loading ??= load().finally(() => {
    loading = null;
  });
  snapshot = await loading;
  return snapshot;
}

/** Drop the cache (after a change in this process; other processes pick changes up within CONTROLS_TTL_MS). */
export function invalidateControls() {
  snapshot = null;
}

export async function getControls(): Promise<PlatformControls> {
  return (await current()).controls;
}

export async function getOrgOverride(organizationId: string): Promise<OrgOverride> {
  return (await current()).orgs.get(organizationId) ?? EMPTY_OVERRIDE;
}

export async function listOrgOverrides(): Promise<Map<string, OrgOverride>> {
  return (await current()).orgs;
}

export async function controlMeta() {
  return (await current()).meta;
}

/** Active emergency state for banners: which critical switches deviate from normal operation. */
export async function emergencyState() {
  const c = await getControls();
  const flags = [
    c.lockdown ? "lockdown" : null,
    c.maintenanceMode ? "maintenanceMode" : null,
    c.readOnlyMode ? "readOnlyMode" : null,
    !c.aiWorkforceEnabled ? "aiWorkforceEnabled" : null,
    c.aiExecutionPaused ? "aiExecutionPaused" : null,
    c.backgroundJobsPaused ? "backgroundJobsPaused" : null,
    !c.automationsEnabled ? "automationsEnabled" : null,
    !c.registrationsEnabled ? "registrationsEnabled" : null,
    !c.companyCreationEnabled ? "companyCreationEnabled" : null,
    c.disabledModules.length ? "disabledModules" : null,
  ].filter((x): x is string => !!x);
  return { active: flags.length > 0, flags };
}

// ───────────── Organization state (status + plan module access) ─────────────

interface OrgState {
  at: number;
  status: "ACTIVE" | "SUSPENDED" | "CLOSED" | null;
  planModules: Map<string, boolean>;
  apiCallsPerMonth: number | null;
}
const orgStates = new Map<string, OrgState>();
const ORG_CACHE_MAX = 5000;

async function orgState(organizationId: string): Promise<OrgState> {
  const hit = orgStates.get(organizationId);
  if (hit && Date.now() - hit.at < CONTROLS_TTL_MS) return hit;
  let state: OrgState = { at: Date.now(), status: null, planModules: new Map(), apiCallsPerMonth: null };
  try {
    const [org, limits] = await Promise.all([db().organization.findUnique({ where: { id: organizationId }, select: { status: true } }), getPlanLimits(organizationId)]);
    state = { at: Date.now(), status: org?.status ?? null, planModules: new Map(Object.entries(limits.modules)), apiCallsPerMonth: limits.apiCallsPerMonth };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "organization state unavailable");
  }
  if (orgStates.size >= ORG_CACHE_MAX) orgStates.clear();
  orgStates.set(organizationId, state);
  return state;
}

export function invalidateOrgState(organizationId?: string) {
  if (organizationId) orgStates.delete(organizationId);
  else orgStates.clear();
}

export async function isOrganizationSuspended(organizationId: string): Promise<boolean> {
  return (await orgState(organizationId)).status === "SUSPENDED";
}

export const organizationSuspendedError = () =>
  new AppError("forbidden", "This organization is suspended by the platform. Contact support.", { reason: "organization_suspended" });

/** Is `module` usable for an organization: not disabled globally, for the organization, or by its plan. */
export async function isModuleEnabled(organizationId: string | null, module: PlatformModule): Promise<boolean> {
  const c = await getControls();
  if (c.disabledModules.includes(module)) return false;
  if (!organizationId) return true;
  if ((await getOrgOverride(organizationId)).disabledModules.includes(module)) return false;
  return (await orgState(organizationId)).planModules.get(module) !== false;
}

export const moduleDisabledError = (module: PlatformModule) =>
  new AppError("forbidden", `The ${module} module is currently disabled`, { reason: "module_disabled", module });

export async function assertModuleEnabled(organizationId: string | null, module: PlatformModule) {
  if (!(await isModuleEnabled(organizationId, module))) throw moduleDisabledError(module);
}

/** Integration providers can be switched off platform-wide (Integrations wires this into connect/sync/use). */
export async function isIntegrationEnabled(provider: string): Promise<boolean> {
  return !(await getControls()).disabledIntegrations.includes(provider.toLowerCase());
}

// ───────────── Plan limits (plan_entitlements) ─────────────

/** Entitlement keys understood by the platform (pricing console → Plan limits). */
export const PLAN_LIMIT_KEYS = {
  seats: "seats.max",
  companies: "companies.max",
  aiTokensPerMonth: "ai.tokens.month",
  apiCallsPerMonth: "api.calls.month",
  storageMb: "storage.mb",
  agents: "agents.max",
} as const;
export const planModuleKey = (m: PlatformModule) => `module.${m}`;

export interface PlanLimits {
  planKey: string | null;
  planName: string | null;
  status: string | null;
  seats: number | null;
  companies: number | null;
  aiTokensPerMonth: number | null;
  apiCallsPerMonth: number | null;
  storageMb: number | null;
  agents: number | null;
  /** Explicit module entitlements: false = not included in the plan. Missing = included. */
  modules: Record<string, boolean>;
}

/** Limits of the organization's current subscription plan (null = unlimited / no subscription). */
export async function getPlanLimits(organizationId: string): Promise<PlanLimits> {
  const sub = await db().subscription.findFirst({
    where: { organizationId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
    orderBy: { createdAt: "desc" },
    select: { status: true, plan: { select: { key: true, name: true, entitlements: { select: { featureKey: true, enabled: true, limitValue: true } } } } },
  });
  const ents = sub?.plan.entitlements ?? [];
  const limit = (key: string) => {
    const e = ents.find((x) => x.featureKey === key);
    if (!e) return null;
    if (!e.enabled) return 0;
    return e.limitValue === null ? null : Number(e.limitValue);
  };
  const modules: Record<string, boolean> = {};
  for (const m of PLATFORM_MODULES) {
    const e = ents.find((x) => x.featureKey === planModuleKey(m));
    if (e) modules[m] = e.enabled;
  }
  return {
    planKey: sub?.plan.key ?? null,
    planName: sub?.plan.name ?? null,
    status: sub?.status ?? null,
    seats: limit(PLAN_LIMIT_KEYS.seats),
    companies: limit(PLAN_LIMIT_KEYS.companies),
    aiTokensPerMonth: limit(PLAN_LIMIT_KEYS.aiTokensPerMonth),
    apiCallsPerMonth: limit(PLAN_LIMIT_KEYS.apiCallsPerMonth),
    storageMb: limit(PLAN_LIMIT_KEYS.storageMb),
    agents: limit(PLAN_LIMIT_KEYS.agents),
    modules,
  };
}

const utcDay = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
const utcMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

async function tokensSince(since: Date, organizationId?: string) {
  const r = await db().agentTask.aggregate({ where: { ...(organizationId ? { organizationId } : {}), startedAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true } });
  return (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0);
}

/** Companies limit of the plan (createCompany; the organization's own limit is checked by enterprise policy). */
export async function assertPlanCompaniesAvailable(organizationId: string, client: Tx | Db = db()) {
  const { companies } = await getPlanLimits(organizationId);
  if (companies === null) return;
  const used = await client.company.count({ where: { organizationId, deletedAt: null } });
  if (used + 1 > companies) throw new AppError("not_available", `The plan allows ${companies} companies`, { reason: "plan_limit_reached", kind: "companies", limit: companies, used });
}

/** Seats limit of the plan (for invitations / membership creation). */
export async function assertPlanSeatsAvailable(organizationId: string, adding = 1) {
  const { seats } = await getPlanLimits(organizationId);
  if (seats === null) return;
  const used = await db().membership.count({ where: { organizationId, status: "ACTIVE" } });
  if (used + adding > seats) throw new AppError("not_available", `The plan allows ${seats} seats`, { reason: "plan_limit_reached", kind: "seats", limit: seats, used });
}

// ───────────── AI policy ─────────────

const AI_ERRORS = {
  platform_ai_disabled: "The AI workforce is turned off by the platform",
  platform_ai_org_disabled: "AI is disabled for this organization by the platform",
  platform_ai_profile_disabled: "This AI role is disabled by the platform",
  platform_ai_model_disabled: "The configured AI model is disabled by the platform",
  platform_ai_budget_exhausted: "The platform's AI token budget is used up",
  plan_ai_tokens_exhausted: "The plan's monthly AI token allowance is used up",
} as const;
export type AiRefusal = keyof typeof AI_ERRORS;

/** Model the agents runtime should use: the platform default override, else the environment's AGENT_MODEL. */
export async function agentModel(envModel: string): Promise<string> {
  return (await getControls()).aiDefaultModel ?? envModel;
}

export async function isModelAllowed(model: string): Promise<boolean> {
  const c = await getControls();
  if (c.aiDisabledModels.includes(model)) return false;
  return c.aiAllowedModels.length === 0 || c.aiAllowedModels.includes(model);
}

/**
 * Why AI work may not start/run for this organization right now, or null. Checked in createTask (refuses with
 * not_available) and processAgentTask (fails the task with the same code).
 */
export async function aiRefusal(organizationId: string, opts: { profile?: string | null; model: string }): Promise<AiRefusal | null> {
  const c = await getControls();
  if (!c.aiWorkforceEnabled) return "platform_ai_disabled";
  const o = await getOrgOverride(organizationId);
  if (o.aiDisabled) return "platform_ai_org_disabled";
  if (opts.profile && c.aiDisabledProfiles.includes(opts.profile)) return "platform_ai_profile_disabled";
  if (!(await isModelAllowed(opts.model))) return "platform_ai_model_disabled";
  try {
    if (c.aiDailyTokenBudget !== null || o.aiDailyTokenBudget !== null) {
      if (c.aiDailyTokenBudget !== null && (await tokensSince(utcDay())) >= c.aiDailyTokenBudget) return "platform_ai_budget_exhausted";
      if (o.aiDailyTokenBudget !== null && (await tokensSince(utcDay(), organizationId)) >= o.aiDailyTokenBudget) return "platform_ai_budget_exhausted";
    }
    if (c.aiMonthlyTokenBudget !== null && (await tokensSince(utcMonth())) >= c.aiMonthlyTokenBudget) return "platform_ai_budget_exhausted";
    const plan = await getPlanLimits(organizationId);
    const orgMonthly = o.aiMonthlyTokenBudget;
    if (orgMonthly !== null || plan.aiTokensPerMonth !== null) {
      const used = await tokensSince(utcMonth(), organizationId);
      if (orgMonthly !== null && used >= orgMonthly) return "platform_ai_budget_exhausted";
      if (plan.aiTokensPerMonth !== null && used >= plan.aiTokensPerMonth) return "plan_ai_tokens_exhausted";
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "AI budget check unavailable");
  }
  return null;
}

export async function assertProfileAllowed(profile: string) {
  if ((await getControls()).aiDisabledProfiles.includes(profile)) {
    throw new AppError("not_available", AI_ERRORS.platform_ai_profile_disabled, { reason: "platform_ai_profile_disabled" });
  }
}

export const aiRefusalMessage = (r: AiRefusal) => AI_ERRORS[r];

export async function assertAiAllowed(organizationId: string, opts: { profile?: string | null; model: string }) {
  const r = await aiRefusal(organizationId, opts);
  if (r) throw new AppError("not_available", AI_ERRORS[r], { reason: r });
}

/**
 * Tool autonomy under the platform AI policy: "read_only" refuses any non-read tool, "supervised" (or "require approval
 * for all writes") turns every non-read tool into an approval request.
 */
export async function toolPolicy(tool: { permissions: string[]; risk: string }): Promise<"as_defined" | "supervised" | "denied"> {
  const isRead = tool.permissions.length > 0 && tool.permissions.every((p) => p.endsWith(".read")) && tool.risk === "LOW";
  if (isRead) return "as_defined";
  const c = await getControls();
  if (c.aiAutonomyCeiling === "read_only") return "denied";
  if (c.aiAutonomyCeiling === "supervised" || c.aiRequireApprovalForWrites) return "supervised";
  return "as_defined";
}

// ───────────── Registrations / companies ─────────────

export async function assertRegistrationAllowed(email: string) {
  const c = await getControls();
  if (!c.registrationsEnabled || c.maintenanceMode || c.readOnlyMode) {
    throw new AppError("forbidden", "New registrations are closed", { reason: "registrations_closed" });
  }
  if (c.signupDomainAllowlist.length) {
    const domain = email.split("@")[1]?.toLowerCase() ?? "";
    if (!c.signupDomainAllowlist.some((d) => domain === d || domain.endsWith(`.${d}`))) {
      throw new AppError("forbidden", "Registrations are limited to approved email domains", { reason: "signup_domain_not_allowed" });
    }
  }
}

export async function assertCompanyCreationAllowed(organizationId: string) {
  if (!(await getControls()).companyCreationEnabled) throw new AppError("forbidden", "Creating companies is temporarily disabled", { reason: "company_creation_disabled" });
  if (await isOrganizationSuspended(organizationId)) throw organizationSuspendedError();
}

// ───────────── Request gate (http.ts route()) ─────────────

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Reachable during maintenance: admin API, health, sign-in/out and MFA (so administrators can still work). */
const MAINTENANCE_EXEMPT = [/^\/api\/v1\/admin(\/|$)/, /^\/api\/health/, /^\/api\/v1\/auth\/(sign-in|sign-out|mfa|oauth)/, /^\/api\/v1\/sso/, /^\/api\/v1\/me(\/|$)/, /^\/api\/v1\/webhooks\//];
/** Writable in read-only mode. */
const READ_ONLY_EXEMPT = [/^\/api\/v1\/admin(\/|$)/, /^\/api\/v1\/auth\/(sign-in|sign-out|mfa|oauth)/, /^\/api\/v1\/sso/, /^\/api\/v1\/webhooks\//];

/** Platform administrators (any PLATFORM / REGION / COUNTRY grant) keep working through maintenance. */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  try {
    const n = await db().roleAssignment.count({
      where: { principalType: "USER", principalId: userId, scopeType: { in: ["PLATFORM", "REGION", "COUNTRY"] }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    return n > 0;
  } catch {
    return false;
  }
}

const apiUsage = new Map<string, { at: number; used: number }>();

/**
 * Platform gate for every API request (called by route() once the principal is known): maintenance and read-only
 * modes, suspended organizations, disabled modules and the plan's monthly API-call quota for API keys.
 */
export async function requestGate(req: { pathname: string; method: string; userId: string | null; serviceAccountOrgId: string | null }) {
  const { pathname, method } = req;
  if (pathname.startsWith("/api/v1/admin/") || pathname === "/api/v1/admin") return;
  const c = await getControls();
  const mutating = MUTATING.has(method);
  const blockMaintenance = c.maintenanceMode && !MAINTENANCE_EXEMPT.some((r) => r.test(pathname));
  const blockReadOnly = c.readOnlyMode && mutating && !READ_ONLY_EXEMPT.some((r) => r.test(pathname));
  if ((blockMaintenance || blockReadOnly) && !(req.userId && (await isPlatformAdmin(req.userId)))) {
    if (blockMaintenance) throw new AppError("service_unavailable", c.maintenanceMessage || "The platform is under maintenance; please try again shortly", { reason: "maintenance" });
    throw new AppError("service_unavailable", "The platform is temporarily read-only", { reason: "read_only" });
  }
  const orgMatch = /^\/api\/v1\/organizations\/([0-9a-f-]{36})(?:\/|$)/.exec(pathname);
  if (!orgMatch) return;
  const organizationId = orgMatch[1]!;
  if (await isOrganizationSuspended(organizationId)) throw organizationSuspendedError();
  const mod = moduleForApiPath(pathname);
  if (mod && !(await isModuleEnabled(organizationId, mod))) throw moduleDisabledError(mod);
  if (req.serviceAccountOrgId) {
    const { apiCallsPerMonth } = await orgState(req.serviceAccountOrgId);
    if (apiCallsPerMonth !== null) {
      let hit = apiUsage.get(req.serviceAccountOrgId);
      if (!hit || Date.now() - hit.at > 60_000) {
        const r = await db().usageRecord.aggregate({ where: { organizationId: req.serviceAccountOrgId, meter: "api.request", occurredAt: { gte: utcMonth() } }, _sum: { quantity: true } });
        hit = { at: Date.now(), used: Number(r._sum.quantity ?? 0) };
        apiUsage.set(req.serviceAccountOrgId, hit);
      }
      if (hit.used > apiCallsPerMonth) throw new AppError("rate_limited", "The plan's monthly API quota is used up", { reason: "plan_api_quota_exhausted", limit: apiCallsPerMonth });
    }
  }
}
