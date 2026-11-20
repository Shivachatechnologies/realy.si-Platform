import { z } from "zod";
import type { FlagTargetType } from "@/generated/prisma/enums";
import { db, transaction, type Tx, type Db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
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

export function evaluateRules(defaultEnabled: boolean, rules: RuleLike[], ctx: FlagContext): boolean {
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
  return defaultEnabled;
}

export async function isEnabled(key: string, ctx: FlagContext, client: Tx | Db = db()): Promise<boolean> {
  const flag = await client.featureFlag.findUnique({ where: { key }, include: { rules: true } });
  if (!flag || flag.status !== "ACTIVE") return false;
  return evaluateRules(flag.defaultEnabled, flag.rules, ctx);
}

export async function listFlags(ctx: RequestContext) {
  await requirePermission(ctx, "flags.read", platformChain());
  return db().featureFlag.findMany({ orderBy: { key: "asc" }, include: { rules: { orderBy: [{ targetType: "asc" }, { priority: "desc" }] } } });
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
    await writeAudit(tx, ctx, { category: "ADMIN", action: "feature_flag.default_set", resourceType: "feature_flag", resourceId: flagId, oldValue: { defaultEnabled: before.defaultEnabled }, newValue: { defaultEnabled }, reason });
    await emitEvent(tx, ctx, "feature_flag.updated", { flagId, key: after.key }, { aggregateType: "feature_flag", aggregateId: flagId });
    return after;
  });
}
