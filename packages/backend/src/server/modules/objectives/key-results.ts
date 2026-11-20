import { z } from "zod";
import type { KeyResultDirection, KeyResultSource } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import type { MetricDefinition, MetricRange, MetricUnit } from "@/server/core/metrics";
import { invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { metricByKey } from "@/server/modules/bi/registry";
import { computeMetric, visibleMetrics } from "@/server/modules/bi/service";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";

/**
 * Key results: a metric from the registry (computed for the objective period) or a manually updated value.
 * API values are in display units (money in major units); they are stored in the metric's native unit (minor units).
 */

const DAY = 86_400_000;
const num = z.coerce.number().finite().min(-1e15).max(1e15);
const uuid = z.string().uuid();

export const keyResultInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    source: z.enum(["METRIC", "MANUAL"]).default("MANUAL"),
    metricKey: z.string().trim().max(100).nullable().optional(),
    unit: z.string().trim().max(30).nullable().optional(),
    baseline: num.default(0),
    target: num,
    current: num.nullable().optional(),
    direction: z.enum(["INCREASE", "DECREASE"]).default("INCREASE"),
  })
  .refine((v) => v.source === "MANUAL" || !!v.metricKey, { path: ["metricKey"], message: "Choose a metric" })
  .refine((v) => (v.direction === "INCREASE" ? v.target > v.baseline : v.target < v.baseline), { path: ["target"], message: "The target must move away from the baseline in the chosen direction" });
export const updateKeyResultInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  unit: z.string().trim().max(30).nullable().optional(),
  baseline: num.optional(),
  target: num.optional(),
  current: num.nullable().optional(),
  direction: z.enum(["INCREASE", "DECREASE"]).optional(),
});

export interface KeyResultData {
  title: string;
  source: KeyResultSource;
  metricKey: string | null;
  unit: string | null;
  baseline: number;
  target: number;
  current: number | null;
  direction: KeyResultDirection;
}

/** Display units → stored units for a metric (money: major → minor). */
export const toNative = (unit: MetricUnit | null, v: number) => (unit === "money" ? Math.round(v * 100) : v);
export const toDisplay = (unit: MetricUnit | null, v: number) => (unit === "money" ? v / 100 : v);

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "objectives.read" | "objectives.manage", tx?: Tx) {
  const chain = await companyChain(tx ?? db(), organizationId, companyId);
  await requirePermission(ctx, permission, chain, tx);
  return chain;
}

/** Validate and normalize a key result: the metric must exist and the author must be allowed to read it. */
export async function validateKeyResult(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof keyResultInput>): Promise<KeyResultData> {
  const kr = keyResultInput.parse(raw);
  let unit: MetricUnit | null = null;
  if (kr.source === "METRIC") {
    const m = metricByKey(kr.metricKey ?? "");
    if (!m) throw invalid("Unknown metric", { reason: "objectives_unknown_metric" });
    if (!(await can(ctx, m.permission, await companyChain(db(), organizationId, companyId)))) throw invalid("You cannot read this metric", { reason: "objectives_metric_forbidden" });
    unit = m.unit;
  }
  return {
    title: kr.title,
    source: kr.source,
    metricKey: kr.source === "METRIC" ? kr.metricKey! : null,
    unit: kr.source === "MANUAL" ? kr.unit || null : null,
    baseline: toNative(unit, kr.baseline),
    target: toNative(unit, kr.target),
    current: kr.source === "MANUAL" && kr.current !== undefined && kr.current !== null ? kr.current : null,
    direction: kr.direction,
  };
}

export async function createKeyResult(ctx: RequestContext, organizationId: string, companyId: string, objectiveId: string, raw: z.input<typeof keyResultInput>) {
  const data = await validateKeyResult(ctx, organizationId, companyId, raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "objectives.manage", tx);
    if (!uuid.safeParse(objectiveId).success) throw notFound("Objective");
    const o = await tx.objective.findFirst({ where: { id: objectiveId, organizationId, companyId }, select: { id: true } });
    if (!o) throw notFound("Objective");
    const position = await tx.objectiveKeyResult.count({ where: { objectiveId } });
    const kr = await tx.objectiveKeyResult.create({ data: { ...data, organizationId, companyId, objectiveId, position } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "objective.key_result.created", resourceType: "objective_key_result", resourceId: kr.id, newValue: kr });
    return kr;
  });
}

export async function updateKeyResult(ctx: RequestContext, organizationId: string, companyId: string, keyResultId: string, raw: z.input<typeof updateKeyResultInput>) {
  const input = updateKeyResultInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "objectives.manage", tx);
    if (!uuid.safeParse(keyResultId).success) throw notFound("Key result");
    const before = await tx.objectiveKeyResult.findFirst({ where: { id: keyResultId, organizationId, companyId } });
    if (!before) throw notFound("Key result");
    const unit = before.metricKey ? (metricByKey(before.metricKey)?.unit ?? null) : null;
    const next = {
      title: input.title ?? before.title,
      unit: before.source === "MANUAL" ? (input.unit !== undefined ? input.unit || null : before.unit) : null,
      baseline: input.baseline !== undefined ? toNative(unit, input.baseline) : before.baseline,
      target: input.target !== undefined ? toNative(unit, input.target) : before.target,
      current: before.source === "MANUAL" ? (input.current !== undefined ? input.current : before.current) : null,
      direction: input.direction ?? before.direction,
    };
    if (next.direction === "INCREASE" ? next.target <= next.baseline : next.target >= next.baseline) {
      throw invalid("The target must move away from the baseline in the chosen direction", { reason: "objectives_target_direction" });
    }
    const kr = await tx.objectiveKeyResult.update({ where: { id: keyResultId }, data: next });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "objective.key_result.updated", resourceType: "objective_key_result", resourceId: kr.id, oldValue: before, newValue: kr });
    return kr;
  });
}

export async function deleteKeyResult(ctx: RequestContext, organizationId: string, companyId: string, keyResultId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "objectives.manage", tx);
    const { count } = uuid.safeParse(keyResultId).success ? await tx.objectiveKeyResult.deleteMany({ where: { id: keyResultId, organizationId, companyId } }) : { count: 0 };
    if (!count) throw notFound("Key result");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "objective.key_result.deleted", resourceType: "objective_key_result", resourceId: keyResultId });
    return { ok: true };
  });
}

// ───────────── Progress ─────────────

export type KrStatus = "ACHIEVED" | "ON_TRACK" | "AT_RISK" | "OFF_TRACK" | "NO_DATA";

export interface KrProgress {
  /** Current value (native units); null when unavailable or not visible to the viewer. */
  value: number | null;
  /** 0..1, null without data. */
  progress: number | null;
  status: KrStatus;
  /** Whether the viewer may see the metric's numbers (progress is always shown). */
  visible: boolean;
  unit: MetricUnit | null;
}

const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** The objective period: start (or creation day) → target date (inclusive), capped at today; `to` is exclusive. */
export function objectivePeriod(o: { startDate: Date | null; createdAt: Date; targetDate: Date | null }, now = new Date()): { range: MetricRange; elapsed: number | null } {
  const from = o.startDate ?? utcDay(o.createdAt);
  const tomorrow = new Date(utcDay(now).getTime() + DAY);
  const end = o.targetDate ? new Date(o.targetDate.getTime() + DAY) : null;
  let to = end && end < tomorrow ? end : tomorrow;
  if (to <= from) to = new Date(from.getTime() + DAY);
  const elapsed = end && end > from ? Math.min(1, Math.max(0, (Math.min(now.getTime(), end.getTime()) - from.getTime()) / (end.getTime() - from.getTime()))) : null;
  return { range: { from, to }, elapsed };
}

export function progressOf(kr: { baseline: number; target: number }, value: number | null) {
  if (value === null || kr.target === kr.baseline) return null;
  return Math.min(1, Math.max(0, (value - kr.baseline) / (kr.target - kr.baseline)));
}

export function statusOf(progress: number | null, elapsed: number | null): KrStatus {
  if (progress === null) return "NO_DATA";
  if (progress >= 1) return "ACHIEVED";
  const gap = (elapsed ?? 0.7) - progress;
  return gap <= 0.1 ? "ON_TRACK" : gap <= 0.3 ? "AT_RISK" : "OFF_TRACK";
}

type KrRow = { id: string; source: KeyResultSource; metricKey: string | null; baseline: number; target: number; current: number | null };
type ObjectiveRow = { startDate: Date | null; createdAt: Date; targetDate: Date | null; keyResults: KrRow[]; milestones: { completedAt: Date | null }[] };

/**
 * Evaluate key results of objectives for the viewer: metric key results are computed with the registry for each
 * objective's period. Values of metrics the viewer may not read are hidden (progress is still shown).
 */
export async function evaluateObjectives(ctx: RequestContext, organizationId: string, companyId: string, objectives: ObjectiveRow[], chain?: ScopeChain) {
  const company = await db().company.findFirst({ where: { id: companyId, organizationId }, select: { baseCurrency: true } });
  const scope = { organizationId, companyId, currency: company?.baseCurrency ?? "USD" };
  const needsMetrics = objectives.some((o) => o.keyResults.some((k) => k.source === "METRIC"));
  const visible = needsMetrics ? new Set((await visibleMetrics(ctx, chain ?? (await companyChain(db(), organizationId, companyId)))).map((m) => m.key)) : new Set<string>();
  const krs = new Map<string, KrProgress>();
  const objectiveProgress: (number | null)[] = [];
  await Promise.all(
    objectives.map(async (o, i) => {
      const { range, elapsed } = objectivePeriod(o);
      const values = await Promise.all(
        o.keyResults.map(async (kr) => {
          let value: number | null = kr.current;
          let unit: MetricUnit | null = null;
          if (kr.source === "METRIC") {
            const m: MetricDefinition | undefined = kr.metricKey ? metricByKey(kr.metricKey) : undefined;
            unit = m?.unit ?? null;
            value = m ? await computeMetric(m, scope, range) : null;
          }
          const progress = progressOf(kr, value);
          const isVisible = kr.source === "MANUAL" || (!!kr.metricKey && visible.has(kr.metricKey));
          krs.set(kr.id, { value: isVisible ? value : null, progress, status: statusOf(progress, elapsed), visible: isVisible, unit });
          return progress;
        }),
      );
      const known = values.filter((v): v is number => v !== null);
      objectiveProgress[i] = known.length
        ? known.reduce((s, v) => s + v, 0) / known.length
        : o.milestones.length
          ? o.milestones.filter((m) => m.completedAt).length / o.milestones.length
          : null;
    }),
  );
  return { keyResults: krs, objectives: objectiveProgress, currency: scope.currency };
}

export const average = (values: (number | null)[]) => {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((s, v) => s + v, 0) / known.length : null;
};
