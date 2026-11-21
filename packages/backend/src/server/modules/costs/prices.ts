import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { toJson } from "@/server/core/json";
import { writeAudit } from "@/server/modules/audit/service";
import { requireAnyPlatform, requirePlatform } from "@/server/modules/admin/access";
import { MODEL_PRICES, priceFor } from "@/server/modules/workforce/pricing";

/**
 * Model price table of the cost ledger (USD per 1M tokens = micro-USD per token). Built from the list prices in
 * workforce/pricing.ts, overlaid by the platform-admin table stored in PlatformSetting "costs:modelPrices"
 * (Admin → AI; set with setModelPrice). Cache reads default to 10 % and cache writes to 125 % of the input price.
 */

const PRICES_KEY = "costs:modelPrices";
const priceRow = z.object({
  input: z.number().min(0).max(1e6),
  output: z.number().min(0).max(1e6),
  cacheRead: z.number().min(0).max(1e6).nullable().optional(),
  cacheWrite: z.number().min(0).max(1e6).nullable().optional(),
});
const priceTable = z.record(z.string(), priceRow);
export type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number; source: "list" | "admin" };

let cache: { at: number; table: z.infer<typeof priceTable> } | null = null;

async function overrides() {
  if (!cache || Date.now() - cache.at > 60_000) {
    const row = await db().platformSetting.findUnique({ where: { key: PRICES_KEY } }).catch(() => null);
    const p = priceTable.safeParse(row?.value);
    cache = { at: Date.now(), table: p.success ? p.data : {} };
  }
  return cache.table;
}

const bare = (model: string) => model.replace(/^(?:[a-z]+\.)?anthropic\./, "").replace(/@.*$/, "");

/** The effective price of a model (admin override → list price → default tier). */
export async function modelPrice(model: string | null | undefined): Promise<ModelPrice> {
  const table = await overrides();
  const o = model ? (table[model] ?? table[bare(model)]) : undefined;
  if (o) return { input: o.input, output: o.output, cacheRead: o.cacheRead ?? o.input * 0.1, cacheWrite: o.cacheWrite ?? o.input * 1.25, source: "admin" };
  const p = priceFor(model);
  return { input: p.input, output: p.output, cacheRead: p.input * 0.1, cacheWrite: p.input * 1.25, source: "list" };
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Cost in micro-USD of one model call. */
export async function tokenCostMicros(model: string | null | undefined, u: TokenUsage): Promise<number> {
  const p = await modelPrice(model);
  return Math.round(u.inputTokens * p.input + u.outputTokens * p.output + (u.cacheReadTokens ?? 0) * p.cacheRead + (u.cacheWriteTokens ?? 0) * p.cacheWrite);
}

/** Admin: the full table (list prices + overrides). */
export async function listModelPrices(ctx: RequestContext) {
  await requireAnyPlatform(ctx, ["platform.ai.read", "platform.ai.manage"]);
  const table = await overrides();
  const ids = [...new Set([...Object.keys(MODEL_PRICES), ...Object.keys(table)])].sort();
  return Promise.all(ids.map(async (id) => ({ model: id, ...(await modelPrice(id)) })));
}

export const modelPriceInput = z.object({
  model: z.string().regex(/^[a-z0-9.@-]{3,64}$/),
  /** null removes the override (back to the list price). */
  price: priceRow.nullable(),
  reason: z.string().trim().min(3).max(500),
});

/** Admin: set or remove one model's price override (audited). */
export async function setModelPrice(ctx: RequestContext, raw: z.input<typeof modelPriceInput>) {
  const input = modelPriceInput.parse(raw);
  await transaction(async (tx) => {
    await requirePlatform(ctx, "platform.ai.manage");
    const row = await tx.platformSetting.findUnique({ where: { key: PRICES_KEY } });
    const cur = priceTable.safeParse(row?.value);
    const next = { ...(cur.success ? cur.data : {}) };
    const before = next[input.model] ?? null;
    if (input.price) next[input.model] = input.price;
    else delete next[input.model];
    const json = toJson(next) as Prisma.InputJsonValue;
    await tx.platformSetting.upsert({ where: { key: PRICES_KEY }, create: { key: PRICES_KEY, value: json, updatedById: ctx.actor.id, reason: input.reason }, update: { value: json, updatedById: ctx.actor.id, reason: input.reason } });
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.costs.model_price_changed", resourceType: "platform_control", resourceId: PRICES_KEY, oldValue: { [input.model]: before }, newValue: { [input.model]: input.price }, reason: input.reason });
  });
  cache = null;
  return { model: input.model, price: input.price };
}
