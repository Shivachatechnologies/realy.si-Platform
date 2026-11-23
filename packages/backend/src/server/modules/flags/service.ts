import { createHash } from "node:crypto";
import { z } from "zod";
import type { FlagTargetType } from "@/generated/prisma/enums";
import { db, transaction, type Tx, type Db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { toJson } from "@/server/core/json";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";

/** Most specific target wins (docs/database.md — feature_flag_rules). */
const SPECIFICITY: FlagTargetType[] = ["USER", "COMPANY", "ORGANIZATION", "PLAN", "COUNTRY", "REGION", "GLOBAL"];

export interface FlagContext {
  userId?: string | null;
  companyId?: string | null;
  organizationId?: string | null;
  planKey?: string | null;
  countryCode?: string | null;
  regionCode?: string | null;
}

interface RuleLike {
  targetType: FlagTargetType;
  targetValue: string;
  enabled: boolean;
  priority: number;
}

/** The decision of the most specific matching targeting rule, or null when no rule matches. */
export function matchRule(rules: RuleLike[], ctx: FlagContext): boolean | null {
  const valueFor: Record<FlagTargetType, string | null | undefined> = {
    USER: ctx.userId,
    COMPANY: ctx.companyId,
    ORGANIZATION: ctx.organizationId,
    PLAN: ctx.planKey,
    COUNTRY: ctx.countryCode,
    REGION: ctx.regionCode,
    GLOBAL: "*",
  };
  for (const type of SPECIFICITY) {
    const matches = rules
      .filter((r) => r.targetType === type && valueFor[type] != null && r.targetValue === valueFor[type])
      .sort((a, b) => b.priority - a.priority);
    if (matches[0]) return matches[0].enabled;
  }
  return null;
}

export function evaluateRules(defaultEnabled: boolean, rules: RuleLike[], ctx: FlagContext): boolean {
  return matchRule(rules, ctx) ?? defaultEnabled;
}

// ───────────── v2: rollout, environment targeting, kill switch (feature_flag_rollouts, stream F) ─────────────

export type FlagEnvironment = "production" | "preview" | "development";
export const FLAG_ENVIRONMENTS: FlagEnvironment[] = ["production", "preview", "development"];

/** This process's deployment environment: VERCEL_ENV when set, else NODE_ENV (anything but production = development). */
export function currentEnvironment(): FlagEnvironment {
  const v = process.env.VERCEL_ENV;
  return v === "production" || v === "preview" || v === "development" ? v : process.env.NODE_ENV === "production" ? "production" : "development";
}

export interface RolloutLike {
  percentage: number | null;
  environments: string[];
  startsAt: Date | null;
  endsAt: Date | null;
  killedAt: Date | null;
}

/** Stable 0–99 bucket of a subject for a flag (sha256 of "<key>:<subject>"), so a rollout only ever grows its audience. */
export function rolloutBucket(flagKey: string, subject: string): number {
  return createHash("sha256").update(`${flagKey}:${subject}`).digest().readUInt32BE(0) % 100;
}

/**
 * Full evaluation, in order: kill switch → off; environment list (when set) must include this environment → else off;
 * explicit targeting rules (most specific wins); an active percentage rollout (schedule window) by user, else
 * organization bucket; the default.
 */
export function evaluateFlag(flag: { key: string; defaultEnabled: boolean }, rules: RuleLike[], rollout: RolloutLike | null, ctx: FlagContext, env: FlagEnvironment = currentEnvironment(), now = new Date()): boolean {
  if (rollout?.killedAt) return false;
  if (rollout && rollout.environments.length && !rollout.environments.includes(env)) return false;
  const ruled = matchRule(rules, ctx);
  if (ruled !== null) return ruled;
  const active = rollout && rollout.percentage !== null && (!rollout.startsAt || rollout.startsAt <= now) && (!rollout.endsAt || rollout.endsAt > now);
  if (active) {
    const subject = ctx.userId ?? ctx.organizationId ?? ctx.companyId;
    if (subject) return rolloutBucket(flag.key, subject) < rollout.percentage!;
  }
  return flag.defaultEnabled;
}

export async function isEnabled(key: string, ctx: FlagContext, client: Tx | Db = db()): Promise<boolean> {
  const flag = await client.featureFlag.findUnique({ where: { key }, include: { rules: true } });
  if (!flag || flag.status !== "ACTIVE") return false;
  const rollout = await client.featureFlagRollout.findUnique({ where: { flagId: flag.id } }).catch(() => null);
  return evaluateFlag(flag, flag.rules, rollout, ctx);
}

export async function listFlags(ctx: RequestContext) {
  await requirePermission(ctx, "flags.read", platformChain());
  const [flags, rollouts, versions] = await Promise.all([
    db().featureFlag.findMany({ orderBy: { key: "asc" }, include: { rules: { orderBy: [{ targetType: "asc" }, { priority: "desc" }] } } }),
    db().featureFlagRollout.findMany(),
    db().featureFlagVersion.groupBy({ by: ["flagId"], _max: { version: true, createdAt: true } }),
  ]);
  return flags.map((f) => {
    const v = versions.find((x) => x.flagId === f.id);
    return { ...f, rollout: rollouts.find((r) => r.flagId === f.id) ?? null, version: v?._max.version ?? 0, lastChangedAt: v?._max.createdAt ?? f.updatedAt };
  });
}

/** Snapshot of a flag after a change (history + rollback source). Runs inside the change's transaction. */
async function snapshot(tx: Tx, ctx: RequestContext, flagId: string, action: string, reason: string | null) {
  const flag = await tx.featureFlag.findUnique({ where: { id: flagId }, include: { rules: true } });
  if (!flag) return;
  const rollout = await tx.featureFlagRollout.findUnique({ where: { flagId } });
  const last = await tx.featureFlagVersion.findFirst({ where: { flagId }, orderBy: { version: "desc" }, select: { version: true } });
  const data = {
    defaultEnabled: flag.defaultEnabled,
    status: flag.status,
    description: flag.description,
    rules: flag.rules.map((r) => ({ targetType: r.targetType, targetValue: r.targetValue, enabled: r.enabled, priority: r.priority })),
    rollout: rollout ? { percentage: rollout.percentage, environments: rollout.environments, startsAt: rollout.startsAt, endsAt: rollout.endsAt, killedAt: rollout.killedAt } : null,
  };
  await tx.featureFlagVersion.create({ data: { flagId, version: (last?.version ?? 0) + 1, snapshot: toJson(data), action, actorId: ctx.actor.id, reason } });
}

export const createFlagInput = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,79}$/, "lowercase letters, digits, . _ - (3–80)"),
  description: z.string().trim().max(500).default(""),
  defaultEnabled: z.boolean().default(false),
  reason: z.string().trim().min(3).max(500),
});

export async function createFlag(ctx: RequestContext, raw: z.input<typeof createFlagInput>) {
  const input = createFlagInput.parse(raw);
  return transaction(async (tx) => {
    await requirePermission(ctx, "flags.manage", platformChain(), tx);
    if (await tx.featureFlag.findUnique({ where: { key: input.key }, select: { id: true } })) throw conflict("A flag with this key already exists");
    const flag = await tx.featureFlag.create({ data: { key: input.key, description: input.description, defaultEnabled: input.defaultEnabled } });
    await snapshot(tx, ctx, flag.id, "created", input.reason);
    await writeAudit(tx, ctx, { category: "ADMIN", action: "feature_flag.created", resourceType: "feature_flag", resourceId: flag.id, newValue: { key: flag.key, defaultEnabled: flag.defaultEnabled }, reason: input.reason });
    await emitEvent(tx, ctx, "feature_flag.updated", { flagId: flag.id, key: flag.key }, { aggregateType: "feature_flag", aggregateId: flag.id });
    return flag;
  });
}

export const deleteFlagInput = z.object({ reason: z.string().trim().min(3).max(500), confirm: z.string().max(100) });

/** Delete a flag (typed key confirmation). Its versions stay as history; evaluation then answers "off". */
export async function deleteFlag(ctx: RequestContext, flagId: string, raw: z.input<typeof deleteFlagInput>) {
  const input = deleteFlagInput.parse(raw);
  return transaction(async (tx) => {
    await requirePermission(ctx, "flags.manage", platformChain(), tx);
    const flag = await tx.featureFlag.findUnique({ where: { id: flagId }, include: { rules: true } });
    if (!flag) throw notFound("Feature flag");
    if (input.confirm.trim() !== flag.key) throw invalid("Type the flag key exactly to delete it", { reason: "confirmation_mismatch" });
    await snapshot(tx, ctx, flag.id, "deleted", input.reason);
    await tx.featureFlagRollout.deleteMany({ where: { flagId } });
    await tx.featureFlag.delete({ where: { id: flagId } });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "feature_flag.deleted", resourceType: "feature_flag", resourceId: flagId, oldValue: { key: flag.key, defaultEnabled: flag.defaultEnabled, rules: flag.rules.length }, reason: input.reason });
    await emitEvent(tx, ctx, "feature_flag.updated", { flagId, key: flag.key }, { aggregateType: "feature_flag", aggregateId: flagId });
    return { ok: true };
  });
}

export const rolloutInput = z
  .object({
    percentage: z.number().int().min(0).max(100).nullable(),
    environments: z.array(z.enum(["production", "preview", "development"])).max(3).default([]),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.startsAt < v.endsAt, { message: "The end must be after the start", path: ["endsAt"] });

/** Set the percentage rollout, environment targeting and schedule window (null percentage = no rollout). */
export async function setFlagRollout(ctx: RequestContext, flagId: string, raw: z.input<typeof rolloutInput>) {
  const input = rolloutInput.parse(raw);
  return transaction(async (tx) => {
    await requirePermission(ctx, "flags.manage", platformChain(), tx);
    const flag = await tx.featureFlag.findUnique({ where: { id: flagId }, select: { id: true, key: true } });
    if (!flag) throw notFound("Feature flag");
    const before = await tx.featureFlagRollout.findUnique({ where: { flagId } });
    const data = { percentage: input.percentage, environments: [...new Set(input.environments)], startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, updatedById: ctx.actor.id };
    const after = await tx.featureFlagRollout.upsert({ where: { flagId }, update: data, create: { flagId, ...data } });
    await snapshot(tx, ctx, flagId, "rollout_set", input.reason);
    await writeAudit(tx, ctx, { category: "ADMIN", action: "feature_flag.rollout_set", resourceType: "feature_flag", resourceId: flagId, oldValue: before, newValue: after, reason: input.reason });
    await emitEvent(tx, ctx, "feature_flag.updated", { flagId, key: flag.key }, { aggregateType: "feature_flag", aggregateId: flagId });
    return after;
  });
}

export const killInput = z.object({ killed: z.boolean(), reason: z.string().trim().min(3).max(500) });

/** Kill switch: while killed the flag is off for everyone, whatever its rules (restore = un-kill). */
export async function setFlagKilled(ctx: RequestContext, flagId: string, raw: z.input<typeof killInput>) {
  const input = killInput.parse(raw);
  return transaction(async (tx) => {
    await requirePermission(ctx, "flags.manage", platformChain(), tx);
    const flag = await tx.featureFlag.findUnique({ where: { id: flagId }, select: { id: true, key: true } });
    if (!flag) throw notFound("Feature flag");
    const before = await tx.featureFlagRollout.findUnique({ where: { flagId } });
    if (!!before?.killedAt === input.killed) throw conflict(input.killed ? "The flag is already killed" : "The flag is not killed");
    const data = { killedAt: input.killed ? new Date() : null, killedById: input.killed ? ctx.actor.id : null, updatedById: ctx.actor.id };
    await tx.featureFlagRollout.upsert({ where: { flagId }, update: data, create: { flagId, ...data } });
    await snapshot(tx, ctx, flagId, input.killed ? "killed" : "restored", input.reason);
    await writeAudit(tx, ctx, { category: "SECURITY", action: input.killed ? "feature_flag.killed" : "feature_flag.restored", resourceType: "feature_flag", resourceId: flagId, oldValue: { killedAt: before?.killedAt ?? null }, newValue: { killed: input.killed }, reason: input.reason });
    await emitEvent(tx, ctx, "feature_flag.updated", { flagId, key: flag.key }, { aggregateType: "feature_flag", aggregateId: flagId });
    return { killed: input.killed };
  });
}

interface Snapshot {
  defaultEnabled: boolean;
  status: "ACTIVE" | "INACTIVE";
  rules: { targetType: FlagTargetType; targetValue: string; enabled: boolean; priority: number }[];
  rollout: { percentage: number | null; environments: string[]; startsAt: string | null; endsAt: string | null; killedAt: string | null } | null;
}

export const rollbackInput = z.object({ version: z.number().int().min(1), reason: z.string().trim().min(3).max(500) });

/** Restore the default, rules and rollout of an earlier version (recorded as a new version). */
export async function rollbackFlag(ctx: RequestContext, flagId: string, raw: z.input<typeof rollbackInput>) {
  const input = rollbackInput.parse(raw);
  return transaction(async (tx) => {
    await requirePermission(ctx, "flags.manage", platformChain(), tx);
    const flag = await tx.featureFlag.findUnique({ where: { id: flagId }, include: { rules: true } });
    if (!flag) throw notFound("Feature flag");
    const v = await tx.featureFlagVersion.findUnique({ where: { flagId_version: { flagId, version: input.version } } });
    if (!v) throw notFound("Flag version");
    const snap = v.snapshot as unknown as Snapshot;
    await tx.featureFlag.update({ where: { id: flagId }, data: { defaultEnabled: snap.defaultEnabled, status: snap.status ?? flag.status } });
    await tx.featureFlagRule.deleteMany({ where: { flagId } });
    if (snap.rules?.length) await tx.featureFlagRule.createMany({ data: snap.rules.map((r) => ({ flagId, ...r })) });
    const r = snap.rollout;
    const data = { percentage: r?.percentage ?? null, environments: r?.environments ?? [], startsAt: r?.startsAt ? new Date(r.startsAt) : null, endsAt: r?.endsAt ? new Date(r.endsAt) : null, killedAt: r?.killedAt ? new Date(r.killedAt) : null, updatedById: ctx.actor.id };
    await tx.featureFlagRollout.upsert({ where: { flagId }, update: data, create: { flagId, ...data } });
    await snapshot(tx, ctx, flagId, `rolled_back_to_v${input.version}`, input.reason);
    await writeAudit(tx, ctx, { category: "ADMIN", action: "feature_flag.rolled_back", resourceType: "feature_flag", resourceId: flagId, oldValue: { defaultEnabled: flag.defaultEnabled, rules: flag.rules.length }, newValue: { version: input.version }, reason: input.reason });
    await emitEvent(tx, ctx, "feature_flag.updated", { flagId, key: flag.key }, { aggregateType: "feature_flag", aggregateId: flagId });
    return { version: input.version };
  });
}

/** Version history of one flag (newest first) plus its audit records. */
export async function flagHistory(ctx: RequestContext, flagId: string) {
  await requirePermission(ctx, "flags.read", platformChain());
  const [versions, audit] = await Promise.all([
    db().featureFlagVersion.findMany({ where: { flagId }, orderBy: { version: "desc" }, take: 50 }),
    db().auditLog.findMany({ where: { resourceType: "feature_flag", resourceId: flagId }, orderBy: { id: "desc" }, take: 50, select: { id: true, action: true, actorId: true, reason: true, createdAt: true } }),
  ]);
  const ids = [...new Set([...versions.map((v) => v.actorId), ...audit.map((a) => a.actorId)].filter((x): x is string => !!x))];
  const users = ids.length ? await db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const who = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? id.slice(0, 8)) : "system");
  return { versions: versions.map((v) => ({ ...v, who: who(v.actorId) })), audit: audit.map((a) => ({ ...a, who: who(a.actorId) })) };
}

/** Stale flags: unchanged for `days` days and fully decided (no rules, no rollout, or a 0 % / 100 % rollout). */
export function isStaleFlag(f: { rules: unknown[]; rollout: { percentage: number | null; killedAt: Date | null } | null; lastChangedAt: Date }, days = 90, now = new Date()) {
  const old = now.getTime() - f.lastChangedAt.getTime() > days * 86_400_000;
  const decided = !f.rollout || f.rollout.percentage === null || f.rollout.percentage === 0 || f.rollout.percentage === 100;
  return old && decided && !f.rollout?.killedAt;
}

export const flagRuleInput = z.object({
  targetType: z.enum(["GLOBAL", "REGION", "COUNTRY", "PLAN", "ORGANIZATION", "COMPANY", "USER"]),
  targetValue: z.string().min(1).max(64),
  enabled: z.boolean(),
  priority: z.number().int().min(-1000).max(1000).default(0),
  reason: z.string().trim().min(3).max(500),
});

export async function upsertFlagRule(ctx: RequestContext, flagId: string, raw: z.input<typeof flagRuleInput>) {
  const { reason, ...input } = flagRuleInput.parse(raw);
  const targetValue = input.targetType === "GLOBAL" ? "*" : input.targetValue;
  return transaction(async (tx) => {
    await requirePermission(ctx, "flags.manage", platformChain(), tx);
    const flag = await tx.featureFlag.findUnique({ where: { id: flagId } });
    if (!flag) throw notFound("Feature flag");
    const key = { flagId_targetType_targetValue: { flagId, targetType: input.targetType, targetValue } };
    const before = await tx.featureFlagRule.findUnique({ where: key });
    const after = await tx.featureFlagRule.upsert({
      where: key,
      update: { enabled: input.enabled, priority: input.priority },
      create: { flagId, targetType: input.targetType, targetValue, enabled: input.enabled, priority: input.priority },
    });
    await snapshot(tx, ctx, flagId, "rule_set", reason);
    await writeAudit(tx, ctx, { category: "ADMIN", action: "feature_flag.rule_set", resourceType: "feature_flag", resourceId: flagId, oldValue: before, newValue: after, reason });
    await emitEvent(tx, ctx, "feature_flag.updated", { flagId, key: flag.key }, { aggregateType: "feature_flag", aggregateId: flagId });
    return after;
  });
}

export async function deleteFlagRule(ctx: RequestContext, ruleId: string, reason: string) {
  return transaction(async (tx) => {
    await requirePermission(ctx, "flags.manage", platformChain(), tx);
    const rule = await tx.featureFlagRule.findUnique({ where: { id: ruleId }, include: { flag: true } });
    if (!rule) throw notFound("Rule");
    await tx.featureFlagRule.delete({ where: { id: ruleId } });
    await snapshot(tx, ctx, rule.flagId, "rule_deleted", reason);
    await writeAudit(tx, ctx, { category: "ADMIN", action: "feature_flag.rule_deleted", resourceType: "feature_flag", resourceId: rule.flagId, oldValue: rule, reason });
    await emitEvent(tx, ctx, "feature_flag.updated", { flagId: rule.flagId, key: rule.flag.key }, { aggregateType: "feature_flag", aggregateId: rule.flagId });
  });
}

export async function setFlagDefault(ctx: RequestContext, flagId: string, defaultEnabled: boolean, reason: string) {
  return transaction(async (tx) => {
    await requirePermission(ctx, "flags.manage", platformChain(), tx);
    const before = await tx.featureFlag.findUnique({ where: { id: flagId } });
    if (!before) throw notFound("Feature flag");
    const after = await tx.featureFlag.update({ where: { id: flagId }, data: { defaultEnabled } });
    await snapshot(tx, ctx, flagId, "default_set", reason);
    await writeAudit(tx, ctx, { category: "ADMIN", action: "feature_flag.default_set", resourceType: "feature_flag", resourceId: flagId, oldValue: { defaultEnabled: before.defaultEnabled }, newValue: { defaultEnabled }, reason });
    await emitEvent(tx, ctx, "feature_flag.updated", { flagId, key: after.key }, { aggregateType: "feature_flag", aggregateId: flagId });
    return after;
  });
}
