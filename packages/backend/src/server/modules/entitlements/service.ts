/**
 * Entitlements: what an organization's plan allows, how much it has used, and the checks every module calls
 * (docs/entitlements.md). Resolution: live subscription → its plan (DB entitlements over catalog defaults);
 * no subscription → 7-day no-card trial at Growth, starting when the organization creates its first company (existing
 *   organizations: on their first visit after plans launched), then Starter read-only (no new usage) until a plan is chosen.
 * Per-organization admin overrides and paid add-on packs apply on top.
 *
 * No "server-only" import: the worker (agent runtime metering) uses the same functions.
 */
import { randomUUID } from "node:crypto";
import { db, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import {
  ADDONS,
  CHANNEL_CATEGORIES,
  EXPIRED_PLAN,
  FEATURES,
  FEATURE_KEYS,
  LIMITS,
  LIMIT_KEYS,
  METER_LIMIT,
  PLAN_KEYS,
  PLAN_META,
  TRIAL_DAYS,
  TRIAL_PLAN,
  addonsForLimit,
  catalogPlanOf,
  featureDefault,
  isFeatureKey,
  isLimitKey,
  limitDefault,
  planRank,
  type AddonKey,
  type FeatureKey,
  type LimitKey,
  type MeterKey,
  type PlanKey,
} from "./catalog";

export * from "./catalog";

export type EntitlementState = "subscribed" | "past_due" | "trial" | "trial_expired";

export interface Entitlements {
  organizationId: string;
  state: EntitlementState;
  /** Catalog plan whose values apply (legacy plans map to the nearest one). */
  plan: PlanKey;
  planName: string;
  subscription: {
    id: string;
    planKey: string;
    planName: string;
    status: string;
    interval: "MONTH" | "YEAR";
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  trialEndsAt: Date | null;
  /** Monthly usage window for metered limits (anchored on the subscription period; calendar month otherwise). */
  window: { start: Date; end: Date };
  features: Record<FeatureKey, boolean>;
  /** Plan + overrides, before add-ons. null = unlimited. */
  limits: Record<LimitKey, number | null>;
  /** Add-on quantity active in the current window, per limit. */
  addons: Partial<Record<LimitKey, number>>;
  overrides: { id: string; key: string; enabled: boolean; limitValue: number | null; reason: string; expiresAt: Date | null }[];
  /** false when ENTITLEMENTS_ENFORCEMENT=off (e2e / self-hosted): checks report but never block. */
  enforced: boolean;
}

const ENT_TTL_MS = 30_000;
const PLANS_TTL_MS = 60_000;
const LIVE = ["ACTIVE", "TRIALING", "PAST_DUE"] as const;

export const enforcementEnabled = () => (process.env.ENTITLEMENTS_ENFORCEMENT ?? "enforce").toLowerCase() !== "off";

// ───────────── Windows ─────────────

function addMonthsUtc(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
}

/** The monthly window containing `now`, anchored on `anchor` (subscription period start) or the calendar month. */
export function monthlyWindow(anchor: Date | null, now = new Date()): { start: Date; end: Date } {
  if (!anchor || anchor > now) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { start, end: addMonthsUtc(start, 1) };
  }
  let n = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  if (addMonthsUtc(anchor, n) > now) n -= 1;
  return { start: addMonthsUtc(anchor, n), end: addMonthsUtc(anchor, n + 1) };
}

// ───────────── Plan table (DB over catalog) ─────────────

export interface PlanValues {
  key: PlanKey;
  name: string;
  description: string;
  planId: string | null;
  status: string | null;
  features: Record<FeatureKey, boolean>;
  limits: Record<LimitKey, number | null>;
}

type EntRow = { featureKey: string; enabled: boolean; limitValue: bigint | null };

function applyRows(base: PlanKey, rows: EntRow[]) {
  const features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, featureDefault(base, k)])) as Record<FeatureKey, boolean>;
  const limits = Object.fromEntries(LIMIT_KEYS.map((k) => [k, limitDefault(base, k)])) as Record<LimitKey, number | null>;
  for (const r of rows) {
    if (isFeatureKey(r.featureKey)) features[r.featureKey] = r.enabled;
    else if (isLimitKey(r.featureKey)) limits[r.featureKey] = !r.enabled ? 0 : r.limitValue === null ? null : Number(r.limitValue);
  }
  // High-cost usage is never unlimited: a null there falls back to the catalog quota.
  for (const k of LIMIT_KEYS) if (limits[k] === null && "highCost" in LIMITS[k]) limits[k] = LIMITS[k].values[base] ?? 0;
  return { features, limits };
}

let planCache: { at: number; plans: PlanValues[] } | null = null;

/** The three catalog plans with their effective (database-edited) values, cached briefly. */
export async function planTable(client: Db | Tx = db()): Promise<PlanValues[]> {
  if (planCache && Date.now() - planCache.at < PLANS_TTL_MS) return planCache.plans;
  let rows: { id: string; key: string; name: string; description: string; status: string; entitlements: EntRow[] }[] = [];
  try {
    rows = await client.plan.findMany({
      where: { key: { in: [...PLAN_KEYS] } },
      select: { id: true, key: true, name: true, description: true, status: true, entitlements: { select: { featureKey: true, enabled: true, limitValue: true } } },
    });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "plan table unavailable; using catalog defaults");
  }
  const plans = PLAN_KEYS.map((key): PlanValues => {
    const row = rows.find((r) => r.key === key);
    return {
      key,
      name: row?.name ?? PLAN_META[key].name,
      description: row?.description || PLAN_META[key].description,
      planId: row?.id ?? null,
      status: row?.status ?? null,
      ...applyRows(key, row?.entitlements ?? []),
    };
  });
  planCache = { at: Date.now(), plans };
  return plans;
}

// ───────────── Resolution ─────────────

const entCache = new Map<string, { at: number; value: Entitlements }>();

/** Drop cached entitlements (subscription change, override, add-on purchase). No id = everything, incl. plans. */
export function invalidateEntitlements(organizationId?: string) {
  if (organizationId) entCache.delete(organizationId);
  else {
    entCache.clear();
    planCache = null;
  }
}

async function resolve(organizationId: string): Promise<Entitlements> {
  const now = new Date();
  const client = db();
  const [sub] = await Promise.all([
    client.subscription.findFirst({
      where: { organizationId, status: { in: [...LIVE] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        interval: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        plan: { select: { key: true, name: true, entitlements: { select: { featureKey: true, enabled: true, limitValue: true } } } },
      },
    }),
  ]);
  const plans = await planTable(client);

  let state: EntitlementState;
  let plan: PlanKey;
  let features: Record<FeatureKey, boolean>;
  let limits: Record<LimitKey, number | null>;
  let planName: string;
  let trialEndsAt: Date | null = null;
  if (sub) {
    state = sub.status === "PAST_DUE" ? "past_due" : "subscribed";
    plan = catalogPlanOf(sub.plan.key);
    ({ features, limits } = applyRows(plan, sub.plan.entitlements));
    planName = sub.plan.name;
  } else {
    // The trial clock starts when the organization starts using Realy, not at sign-up (see trialFor).
    trialEndsAt = await trialFor(client, organizationId, now);
    state = trialEndsAt === null || trialEndsAt > now ? "trial" : "trial_expired";
    plan = state === "trial" ? TRIAL_PLAN : EXPIRED_PLAN;
    const pv = plans.find((p) => p.key === plan)!;
    features = { ...pv.features };
    limits = { ...pv.limits };
    planName = pv.name;
  }

  const window = monthlyWindow(sub?.currentPeriodStart ?? null, now);
  const [overrideRows, addonRows] = await Promise.all([
    client.entitlementOverride
      .findMany({ where: { organizationId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, orderBy: { createdAt: "asc" } })
      .catch(() => []),
    client.entitlementAddonPurchase
      .groupBy({ by: ["limitKey"], where: { organizationId, status: "PAID", windowStart: { lte: now }, windowEnd: { gt: now } }, _sum: { quantity: true } })
      .catch(() => []),
  ]);
  for (const o of overrideRows) {
    if (isFeatureKey(o.key)) features[o.key] = o.enabled;
    else if (isLimitKey(o.key)) {
      const v = !o.enabled ? 0 : o.limitValue === null ? null : Number(o.limitValue);
      limits[o.key] = v === null && "highCost" in LIMITS[o.key] ? limits[o.key] : v;
    }
  }
  const addons: Partial<Record<LimitKey, number>> = {};
  for (const a of addonRows) if (isLimitKey(a.limitKey)) addons[a.limitKey] = Number(a._sum.quantity ?? 0);

  return {
    organizationId,
    state,
    plan,
    planName,
    subscription: sub
      ? {
          id: sub.id,
          planKey: sub.plan.key,
          planName: sub.plan.name,
          status: sub.status,
          interval: sub.interval,
          currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        }
      : null,
    trialEndsAt,
    window,
    features,
    limits,
    addons,
    overrides: overrideRows.map((o) => ({ id: o.id, key: o.key, enabled: o.enabled, limitValue: o.limitValue === null ? null : Number(o.limitValue), reason: o.reason, expiresAt: o.expiresAt })),
    enforced: enforcementEnabled(),
  };
}

/** Effective entitlements of an organization (cached 30 s; invalidated on subscription, override and add-on changes). */
export async function getEntitlements(organizationId: string): Promise<Entitlements> {
  const hit = entCache.get(organizationId);
  if (hit && Date.now() - hit.at < ENT_TTL_MS) return hit.value;
  const value = await resolve(organizationId);
  entCache.set(organizationId, { at: Date.now(), value });
  return value;
}

/** Limit including active add-on packs (null = unlimited). */
export const effectiveLimit = (ent: Entitlements, key: LimitKey): number | null => {
  const base = ent.limits[key];
  return base === null ? null : base + (ent.addons[key] ?? 0);
};

// ───────────── Usage ─────────────

const MIB = 1024 * 1024;

async function storageBytes(organizationId: string): Promise<number> {
  const c = db();
  const where = { organizationId };
  const sums = await Promise.all([
    c.brainDocument.aggregate({ where, _sum: { sizeBytes: true } }).then((r) => r._sum.sizeBytes ?? 0),
    c.visualAsset.aggregate({ where, _sum: { sizeBytes: true } }).then((r) => r._sum.sizeBytes ?? 0),
    c.hrDocument.aggregate({ where, _sum: { sizeBytes: true } }).then((r) => r._sum.sizeBytes ?? 0),
    c.workTaskAttachment.aggregate({ where, _sum: { sizeBytes: true } }).then((r) => r._sum.sizeBytes ?? 0),
    c.financeTxnAttachment.aggregate({ where, _sum: { sizeBytes: true } }).then((r) => r._sum.sizeBytes ?? 0),
    c.financeDocAttachment.aggregate({ where, _sum: { sizeBytes: true } }).then((r) => r._sum.sizeBytes ?? 0),
    c.crmAttachment.aggregate({ where, _sum: { size: true } }).then((r) => r._sum.size ?? 0),
    c.supportAttachment.aggregate({ where: { ticket: { organizationId } }, _sum: { size: true } }).then((r) => r._sum?.size ?? 0),
    c.integrationStoredObject.aggregate({ where, _sum: { size: true } }).then((r) => r._sum.size ?? 0),
    c.marketingAsset.aggregate({ where, _sum: { sizeBytes: true } }).then((r) => r._sum.sizeBytes ?? 0),
  ].map((p) => p.catch(() => 0)));
  return sums.reduce((a, b) => a + b, 0);
}

let channelProviders: string[] | null = null;
async function channelProviderKeys(): Promise<string[]> {
  if (!channelProviders) {
    const { PROVIDERS } = await import("@/server/modules/integrations/catalog");
    channelProviders = PROVIDERS.filter((p) => (CHANNEL_CATEGORIES as readonly string[]).includes(p.category)).map((p) => p.key);
  }
  return channelProviders;
}

async function meteredUsage(organizationId: string, meter: string, since: Date): Promise<number> {
  const r = await db().usageRecord.aggregate({ where: { organizationId, meter, occurredAt: { gte: since } }, _sum: { quantity: true } });
  return Number(r._sum.quantity ?? 0);
}

/** Current usage of one limit: live counts from real tables, or the metered sum in the current monthly window. */
export async function usageOf(organizationId: string, key: LimitKey, ent?: Entitlements): Promise<number> {
  const c = db();
  const def = LIMITS[key];
  if (def.meter) return meteredUsage(organizationId, def.meter, (ent ?? (await getEntitlements(organizationId))).window.start);
  switch (key) {
    case "companies.max":
      return c.company.count({ where: { organizationId, deletedAt: null } });
    case "agents.max":
      return c.aiEmployee.count({ where: { organizationId, archivedAt: null } });
    case "seats.max": {
      const [members, pending] = await Promise.all([
        c.membership.count({ where: { organizationId, status: "ACTIVE" } }),
        c.invitation.count({ where: { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
      ]);
      return members + pending;
    }
    case "crm.contacts.max":
      return c.contact.count({ where: { organizationId, archivedAt: null, mergedIntoId: null } });
    case "channels.max":
      return c.integrationConnection.count({ where: { organizationId, status: { in: ["CONNECTED", "ERROR"] }, provider: { in: await channelProviderKeys() } } });
    case "automations.active.max":
      return c.workflow.count({ where: { organizationId, status: "ACTIVE" } });
    case "storage.mb":
      return Math.round(((await storageBytes(organizationId)) / MIB) * 10) / 10;
    default:
      return 0;
  }
}

/**
 * Record metered usage (AI credits, content generations, voice minutes, email sends, API cost, ad spend). Never
 * blocks: call checkLimit/assertLimit before the work, recordUsage after it. Idempotent with `idempotencyKey`.
 */
export async function recordUsage(
  organizationId: string,
  meterKey: MeterKey,
  amount: number,
  opts: { companyId?: string | null; idempotencyKey?: string; occurredAt?: Date; client?: Db | Tx } = {},
): Promise<void> {
  const quantity = Math.max(0, Math.ceil(amount));
  if (quantity === 0) return;
  try {
    await (opts.client ?? db()).usageRecord.create({
      data: {
        organizationId,
        companyId: opts.companyId ?? null,
        meter: meterKey,
        quantity: BigInt(quantity),
        occurredAt: opts.occurredAt ?? new Date(),
        idempotencyKey: opts.idempotencyKey ? `${meterKey}:${opts.idempotencyKey}` : `${meterKey}:${randomUUID()}`,
      },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") return; // already recorded (idempotent replay)
    throw err;
  }
}

// ───────────── Checks ─────────────

/** Cheapest catalog plan that includes `feature`, from the (DB-edited) plan table. */
export async function requiredPlanForFeature(feature: FeatureKey): Promise<PlanKey | null> {
  const plans = await planTable();
  return plans.find((p) => p.features[feature])?.key ?? null;
}

/** Cheapest catalog plan whose limit fits `needed`. */
export async function requiredPlanForLimit(key: LimitKey, needed: number): Promise<PlanKey | null> {
  const plans = await planTable();
  return plans.find((p) => p.limits[key] === null || (p.limits[key] as number) >= needed)?.key ?? null;
}

export async function hasFeature(organizationId: string, key: FeatureKey): Promise<boolean> {
  const ent = await getEntitlements(organizationId);
  return !ent.enforced || ent.features[key] === true;
}

/**
 * The organization's trial end, starting the clock when needed. The trial starts when the organization starts using
 * Realy: once its first company exists (new founders during onboarding; organizations that existed before plans
 * launched start on their first visit after launch). Before that the trial has not started (null): the founder can
 * finish onboarding at trial level without the clock running. One trial per organization, never reset.
 */
async function trialFor(client: Db | Tx, organizationId: string, now: Date): Promise<Date | null> {
  const existing = await client.entitlementTrial.findUnique({ where: { organizationId }, select: { endsAt: true } }).catch(() => null);
  if (existing) return existing.endsAt;
  const companies = await client.company.count({ where: { organizationId, deletedAt: null } }).catch(() => 0);
  if (companies === 0) return null;
  const endsAt = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
  // createMany + skipDuplicates: concurrent first requests cannot start two different clocks.
  await client.entitlementTrial
    .createMany({ data: [{ organizationId, startedAt: now, endsAt, source: "first_company" }], skipDuplicates: true })
    .catch(() => undefined);
  const row = await client.entitlementTrial.findUnique({ where: { organizationId }, select: { endsAt: true } }).catch(() => null);
  return row?.endsAt ?? endsAt;
}

export function featureLockedError(ent: Entitlements, feature: FeatureKey, requiredPlan: PlanKey | null, reason: "plan_feature_locked" | "plan_trial_expired" = "plan_feature_locked") {
  return new AppError("not_available", `${feature} is not included in the ${ent.planName} plan`, {
    reason,
    feature,
    currentPlan: ent.plan,
    requiredPlan,
    state: ent.state,
    organizationId: ent.organizationId,
  });
}

/** Throw plan_feature_locked (details: feature, currentPlan, requiredPlan) unless the organization's plan includes it. */
export async function assertFeature(ctx: RequestContext | null, organizationId: string, key: FeatureKey): Promise<void> {
  const ent = await getEntitlements(organizationId);
  if (!ent.enforced || ent.features[key]) return;
  logger.info({ organizationId, feature: key, requestId: ctx?.requestId }, "plan feature locked");
  throw featureLockedError(ent, key, await requiredPlanForFeature(key));
}

export interface LimitCheck {
  allowed: boolean;
  limitKey: LimitKey;
  used: number;
  /** Effective limit incl. add-ons; null = unlimited. */
  limit: number | null;
  currentPlan: PlanKey;
  requiredPlan: PlanKey | null;
  state: EntitlementState;
  /** Add-ons that raise this limit (offered next to the upgrade when the limit is reached). */
  addons: AddonKey[];
}

/**
 * Would `increment` more fit the organization's limit? Read-only. After a trial ends without a plan, nothing new
 * fits (requiredPlan = the cheapest plan that would allow it).
 */
export async function checkLimit(organizationId: string, limitKey: LimitKey, increment = 1): Promise<LimitCheck> {
  const ent = await getEntitlements(organizationId);
  const used = await usageOf(organizationId, limitKey, ent);
  const limit = effectiveLimit(ent, limitKey);
  const fits = limit === null || used + increment <= limit;
  const expired = ent.state === "trial_expired" && increment > 0;
  const allowed = !ent.enforced || (fits && !expired);
  const addons = addonsForLimit(limitKey).filter((a) => {
    const req = (ADDONS[a] as { requires?: FeatureKey }).requires;
    return !req || ent.features[req];
  });
  return {
    allowed,
    limitKey,
    used,
    limit,
    currentPlan: ent.plan,
    requiredPlan: allowed ? null : expired && fits ? EXPIRED_PLAN : await requiredPlanForLimit(limitKey, used + increment),
    state: ent.state,
    addons: ent.state === "trial_expired" ? [] : addons,
  };
}

export function limitReachedError(c: LimitCheck, organizationId: string) {
  const reason = c.state === "trial_expired" ? "plan_trial_expired" : "plan_limit_reached";
  return new AppError("not_available", `The plan allows ${c.limit ?? "unlimited"} for ${c.limitKey} (used ${c.used})`, {
    reason,
    limitKey: c.limitKey,
    kind: c.limitKey,
    used: c.used,
    limit: c.limit,
    currentPlan: c.currentPlan,
    requiredPlan: c.requiredPlan,
    addons: c.addons,
    state: c.state,
    organizationId,
  });
}

/** Throw plan_limit_reached (or plan_trial_expired) when `increment` more would exceed the limit. */
export async function assertLimit(ctx: RequestContext | null, organizationId: string, limitKey: LimitKey, increment = 1): Promise<LimitCheck> {
  const c = await checkLimit(organizationId, limitKey, increment);
  if (!c.allowed) {
    logger.info({ organizationId, limitKey, used: c.used, limit: c.limit, requestId: ctx?.requestId }, "plan limit reached");
    throw limitReachedError(c, organizationId);
  }
  return c;
}

/** Metered convenience: assert the allowance, then record. For work whose cost is known up front. */
export async function consumeUsage(ctx: RequestContext | null, organizationId: string, meterKey: MeterKey, amount: number, opts: { companyId?: string | null; idempotencyKey?: string } = {}) {
  await assertLimit(ctx, organizationId, METER_LIMIT[meterKey], amount);
  await recordUsage(organizationId, meterKey, amount, opts);
}

export interface UsageRow {
  key: LimitKey;
  unit: (typeof LIMITS)[LimitKey]["unit"];
  metered: boolean;
  used: number;
  /** Plan limit (with overrides), before add-ons. */
  planLimit: number | null;
  addon: number;
  limit: number | null;
  /** 0–1 (null when unlimited). */
  ratio: number | null;
  addons: AddonKey[];
}

/** Every limit with its usage for the billing page and the admin console. */
export async function usageSummary(organizationId: string) {
  const ent = await getEntitlements(organizationId);
  const used = await Promise.all(LIMIT_KEYS.map((k) => usageOf(organizationId, k, ent).catch(() => 0)));
  const rows: UsageRow[] = LIMIT_KEYS.map((key, i) => {
    const limit = effectiveLimit(ent, key);
    return {
      key,
      unit: LIMITS[key].unit,
      metered: LIMITS[key].meter !== null,
      used: used[i]!,
      planLimit: ent.limits[key],
      addon: ent.addons[key] ?? 0,
      limit,
      ratio: limit === null ? null : limit === 0 ? (used[i]! > 0 ? 1 : 0) : Math.min(1, used[i]! / limit),
      addons: addonsForLimit(key).filter((a) => {
        const req = (ADDONS[a] as { requires?: FeatureKey }).requires;
        return !req || ent.features[req];
      }),
    };
  });
  return { entitlements: ent, rows };
}

/** Features the organization's plan does not include (nav lock badges, comparison highlights). */
export async function lockedFeatures(organizationId: string): Promise<FeatureKey[]> {
  const ent = await getEntitlements(organizationId);
  if (!ent.enforced) return [];
  return FEATURE_KEYS.filter((k) => !ent.features[k]);
}

/** Nav hrefs (path after /:locale) whose page needs a feature the plan lacks — for the shell's lock badge. */
export async function lockedNavHrefs(organizationId: string, hrefs: string[]): Promise<string[]> {
  const { featureForPagePath } = await import("./routes-map");
  const ent = await getEntitlements(organizationId);
  if (!ent.enforced) return [];
  return hrefs.filter((h) => {
    const f = featureForPagePath(`/x${h}`);
    return f !== null && !ent.features[f];
  });
}

export const rankOf = planRank;
export const featureGroupOf = (k: FeatureKey) => FEATURES[k].group;
