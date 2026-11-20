import { z } from "zod";
import type { MarketingAutopilotItem, Prisma } from "@/generated/prisma/client";
import type { MarketingPipelineStage, MarketingSocialProvider } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, invalid, isAppError, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { createTask } from "@/server/modules/agents/service";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { actorId, authorize, enumParam, isUuid, money, PAGE_SIZE, pageParam, param, requireOwned, toMinor, uuid } from "./common";
import { extractJson } from "./ai";
import { brandContextFor, loadBrandKit } from "./brand";
import { contentHashOf, createPost, SOCIAL_PROVIDERS, withHashtags } from "./social";
import { MEDIA_REQUIRED, TEXT_LIMITS } from "./social-providers";
import { researchDigest, webSearch } from "./providers/research";
import { ESTIMATED_COST_CENTS, generateImage, imageConnection, startVideoJob, videoConnection } from "./providers/generation";
import { ProviderError } from "./providers/http";
import { assetPublicUrl, creativePrompt, presetFor, PRESETS } from "./assets";
import { learningsContext } from "./learning";
import { upsertRecommendation } from "./recommendations";

type Item = MarketingAutopilotItem;
export const AUTONOMY_LEVELS = ["DRAFT_ONLY", "REVIEW_REQUIRED", "AUTO_PUBLISH"] as const;
export const PIPELINE_STAGES = ["IDEA", "RESEARCH", "DRAFT", "AI_REVIEW", "READY", "SCHEDULED", "PUBLISHED", "ANALYZED", "REJECTED", "FAILED"] as const satisfies readonly MarketingPipelineStage[];
export const FORMATS = ["post", "reel", "short", "carousel", "thread", "video"] as const;
const VIDEO_FORMATS = new Set(["reel", "short", "video"]);

/** Default local posting times per platform (used when no windows are configured and nothing was learned yet). */
export const DEFAULT_WINDOWS: Record<MarketingSocialProvider, string[]> = {
  LINKEDIN: ["08:30", "12:00", "17:30", "10:00", "15:00"],
  X: ["08:00", "10:00", "12:00", "15:00", "18:00", "21:00"],
  INSTAGRAM: ["11:00", "14:00", "19:00", "09:00"],
  FACEBOOK: ["09:00", "13:00", "16:00"],
  THREADS: ["09:00", "12:00", "19:00"],
  TIKTOK: ["12:00", "19:00", "21:00"],
  YOUTUBE: ["15:00", "18:00"],
  PINTEREST: ["20:00", "14:00"],
};

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const platformKey = z.enum(SOCIAL_PROVIDERS);
const tz = z.string().trim().max(64).refine((v) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}, "Unknown time zone");
/** Cadence keys: "LINKEDIN" (posts) or "INSTAGRAM:reel" (format). */
const cadenceKey = z.string().regex(new RegExp(`^(${SOCIAL_PROVIDERS.join("|")})(:(${FORMATS.join("|")}))?$`));

export const autopilotInput = z.object({
  name: z.string().trim().min(1).max(120),
  brandName: z.string().trim().max(120).optional(),
  objective: z.string().trim().min(3).max(1000),
  audience: z.string().trim().max(2000).optional(),
  regions: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  pillars: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  cadence: z.record(cadenceKey, z.number().int().min(0).max(20)).default({}),
  accountIds: z.array(uuid).max(30).default([]),
  timezone: tz.default("UTC"),
  postingWindows: z.partialRecord(platformKey, z.array(hhmm).max(12)).default({}),
  autonomy: z.enum(AUTONOMY_LEVELS).default("REVIEW_REQUIRED"),
  approvalRules: z.record(z.string().regex(/^[A-Za-z_:]{1,40}$/), z.enum(["auto", "review"])).default({}),
  complianceRules: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  horizonDays: z.number().int().min(1).max(14).default(3),
  minReviewScore: z.number().int().min(0).max(100).default(70),
  monthlyBudget: money.optional().or(z.literal("")),
  currency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
  useResearch: z.boolean().default(true),
  generateImages: z.boolean().default(true),
  campaignId: uuid.or(z.literal("")).nullable().optional(),
  aiEmployeeId: uuid.or(z.literal("")).nullable().optional(),
  ownerId: uuid.or(z.literal("")).nullable().optional(),
});
export const updateAutopilotInput = autopilotInput.partial();
export const autopilotActionInput = z.discriminatedUnion("action", [z.object({ action: z.literal("activate") }), z.object({ action: z.literal("pause") }), z.object({ action: z.literal("plan_now") })]);
export const itemActionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("retry") }),
  z.object({ action: z.literal("regenerate") }),
  z.object({
    action: z.literal("edit"),
    copy: z.string().trim().min(1).max(70_000),
    hashtags: z.array(z.string().trim().max(60)).max(30).optional(),
    cta: z.string().trim().max(300).optional(),
    assetId: uuid.or(z.literal("")).nullable().optional(),
  }),
]);

// ── CRUD ──

async function checkRefs(tx: Prisma.TransactionClient, organizationId: string, companyId: string, input: Partial<z.infer<typeof autopilotInput>>) {
  if (input.accountIds?.length) {
    const n = await tx.marketingSocialAccount.count({ where: { companyId, id: { in: input.accountIds }, archivedAt: null } });
    if (n !== new Set(input.accountIds).size) throw notFound("Account");
  }
  if (input.aiEmployeeId) {
    if (!(await tx.aiEmployee.findFirst({ where: { id: input.aiEmployeeId, organizationId, companyId, archivedAt: null }, select: { id: true } }))) throw notFound("AI employee");
  }
  if (input.ownerId) {
    if (!(await tx.membership.findFirst({ where: { organizationId, userId: input.ownerId }, select: { id: true } }))) throw notFound("User");
  }
}

function dataOf(input: Partial<z.infer<typeof autopilotInput>>): Prisma.MarketingAutopilotUncheckedUpdateInput {
  const d: Prisma.MarketingAutopilotUncheckedUpdateInput = {};
  const copy = ["name", "objective", "regions", "pillars", "accountIds", "timezone", "autonomy", "complianceRules", "horizonDays", "minReviewScore", "currency", "useResearch", "generateImages"] as const;
  for (const k of copy) if (input[k] !== undefined) (d as Record<string, unknown>)[k] = input[k];
  if (input.brandName !== undefined) d.brandName = input.brandName || null;
  if (input.audience !== undefined) d.audience = input.audience || null;
  if (input.cadence !== undefined) d.cadence = input.cadence;
  if (input.postingWindows !== undefined) d.postingWindows = input.postingWindows;
  if (input.approvalRules !== undefined) d.approvalRules = input.approvalRules;
  if (input.monthlyBudget !== undefined) d.monthlyBudgetMinor = toMinor(input.monthlyBudget || null);
  if (input.aiEmployeeId !== undefined) d.aiEmployeeId = input.aiEmployeeId || null;
  if (input.ownerId !== undefined) d.ownerId = input.ownerId || null;
  return d;
}

export async function listAutopilots(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const rows = await db().marketingAutopilot.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { createdAt: "desc" } });
  const counts = await db().marketingAutopilotItem.groupBy({ by: ["autopilotId", "stage"], where: { companyId, autopilotId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
  return rows.map((r) => ({ ...r, stages: Object.fromEntries(counts.filter((c) => c.autopilotId === r.id).map((c) => [c.stage, c._count._all])) as Partial<Record<MarketingPipelineStage, number>> }));
}

export async function getAutopilot(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  if (!isUuid(id)) throw notFound("Autopilot");
  const a = await db().marketingAutopilot.findFirst({ where: { id, organizationId, companyId } });
  if (!a) throw notFound("Autopilot");
  const counts = await db().marketingAutopilotItem.groupBy({ by: ["stage"], where: { autopilotId: id }, _count: { _all: true } });
  return { ...a, stages: Object.fromEntries(counts.map((c) => [c.stage, c._count._all])) as Partial<Record<MarketingPipelineStage, number>> };
}

export interface ItemFilters {
  stage?: MarketingPipelineStage;
  platform?: MarketingSocialProvider;
  q?: string;
  page: number;
}
export function parseItemFilters(raw: Record<string, string | string[] | undefined>): ItemFilters {
  return { stage: enumParam(raw, "stage", PIPELINE_STAGES), platform: enumParam(raw, "platform", SOCIAL_PROVIDERS), q: param(raw, "q"), page: pageParam(raw) };
}

export async function listItems(ctx: RequestContext, organizationId: string, companyId: string, autopilotId: string | null, f: ItemFilters = { page: 1 }) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const where: Prisma.MarketingAutopilotItemWhereInput = { organizationId, companyId, ...(autopilotId ? { autopilotId } : {}) };
  if (f.stage) where.stage = f.stage;
  if (f.platform) where.platform = f.platform;
  if (f.q) where.OR = [{ topic: { contains: f.q, mode: "insensitive" } }, { copy: { contains: f.q, mode: "insensitive" } }];
  const [total, data] = await Promise.all([
    db().marketingAutopilotItem.count({ where }),
    db().marketingAutopilotItem.findMany({ where, orderBy: { slotAt: "asc" }, skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  const assetIds = data.map((i) => i.assetId).filter((x): x is string => !!x);
  const assets = assetIds.length ? await db().marketingAsset.findMany({ where: { id: { in: assetIds } }, select: { id: true, kind: true, status: true, url: true, mimeType: true, sizeBytes: true, name: true } }) : [];
  const byId = new Map(assets.map((a) => [a.id, { ...a, publicUrl: a.status === "READY" ? assetPublicUrl(a) : null }]));
  return { total, pageSize: PAGE_SIZE, data: data.map((i) => ({ ...i, asset: i.assetId ? (byId.get(i.assetId) ?? null) : null })) };
}

export async function createAutopilot(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof autopilotInput>) {
  const input = autopilotInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    await checkRefs(tx, organizationId, companyId, input);
    const a = await tx.marketingAutopilot.create({
      data: {
        ...(dataOf(input) as Prisma.MarketingAutopilotUncheckedCreateInput),
        organizationId,
        companyId,
        name: input.name,
        objective: input.objective,
        campaignId: await requireOwned(tx, "marketingCampaign", companyId, input.campaignId || null, "Campaign"),
        ownerId: input.ownerId || ctx.actor.id || null,
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.autopilot.created", resourceType: "marketing_autopilot", resourceId: a.id, newValue: { name: a.name, autonomy: a.autonomy, cadence: input.cadence } });
    return a;
  });
}

export async function updateAutopilot(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateAutopilotInput>) {
  const input = updateAutopilotInput.parse(raw);
  if (!isUuid(id)) throw notFound("Autopilot");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    await checkRefs(tx, organizationId, companyId, input);
    const data = dataOf(input);
    if (input.campaignId !== undefined) data.campaignId = await requireOwned(tx, "marketingCampaign", companyId, input.campaignId || null, "Campaign");
    const { count } = await tx.marketingAutopilot.updateMany({ where: { id, organizationId, companyId, archivedAt: null }, data: data as Prisma.MarketingAutopilotUncheckedUpdateManyInput });
    if (!count) throw notFound("Autopilot");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.autopilot.updated", resourceType: "marketing_autopilot", resourceId: id, newValue: { ...input, monthlyBudget: input.monthlyBudget } });
    return { ok: true };
  });
}

export async function archiveAutopilot(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Autopilot");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingAutopilot.updateMany({ where: { id, organizationId, companyId, archivedAt: null }, data: { archivedAt: new Date(), status: "PAUSED" } });
    if (!count) throw notFound("Autopilot");
    // Unpublished pipeline items stop; scheduled posts stay in the queue (cancel them there if needed).
    await tx.marketingAutopilotItem.updateMany({ where: { autopilotId: id, stage: { in: ["IDEA", "RESEARCH", "DRAFT", "AI_REVIEW", "READY"] } }, data: { stage: "REJECTED", error: "autopilot_archived" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.autopilot.archived", resourceType: "marketing_autopilot", resourceId: id });
    return { ok: true };
  });
}

export async function autopilotAction(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof autopilotActionInput>) {
  const input = autopilotActionInput.parse(raw);
  if (!isUuid(id)) throw notFound("Autopilot");
  const a = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const row = await tx.marketingAutopilot.findFirst({ where: { id, organizationId, companyId, archivedAt: null } });
    if (!row) throw notFound("Autopilot");
    if (input.action === "activate" || input.action === "plan_now") {
      if (!row.accountIds.length) throw invalid("Choose at least one social account", { reason: "marketing_autopilot_no_accounts" });
      if (!Object.values(row.cadence as Record<string, number>).some((n) => n > 0)) throw invalid("Set a posting cadence", { reason: "marketing_autopilot_no_cadence" });
    }
    if (input.action !== "plan_now") {
      await tx.marketingAutopilot.update({ where: { id }, data: { status: input.action === "activate" ? "ACTIVE" : "PAUSED" } });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `marketing.autopilot.${input.action}`, resourceType: "marketing_autopilot", resourceId: id });
    }
    return row;
  });
  if (input.action === "plan_now" || input.action === "activate") return { planned: await planSlots(a.id) };
  return { planned: 0 };
}

// ── Item actions ──

export async function itemAction(ctx: RequestContext, organizationId: string, companyId: string, itemId: string, raw: z.input<typeof itemActionInput>) {
  const input = itemActionInput.parse(raw);
  if (!isUuid(itemId)) throw notFound("Item");
  const item = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const it = await tx.marketingAutopilotItem.findFirst({ where: { id: itemId, organizationId, companyId } });
    if (!it) throw notFound("Item");
    const bad = () => conflict(`Cannot ${input.action} an item in ${it.stage}`, { reason: "marketing_invalid_transition" });
    let data: Prisma.MarketingAutopilotItemUncheckedUpdateInput;
    switch (input.action) {
      case "approve":
        if (it.stage !== "READY") throw bad();
        if (!it.copy) throw bad();
        data = { needsApproval: false, approvedById: ctx.actor.id, approvedAt: new Date(), error: null };
        break;
      case "reject":
        if (["SCHEDULED", "PUBLISHED", "ANALYZED"].includes(it.stage)) throw bad();
        data = { stage: "REJECTED", error: input.reason || "rejected_by_reviewer", pendingTaskId: null, pendingStep: null };
        break;
      case "retry":
        if (it.stage !== "FAILED" && it.stage !== "REJECTED") throw bad();
        data = { stage: it.copy ? "AI_REVIEW" : it.topic ? "RESEARCH" : "IDEA", error: null, attempts: 0, pendingTaskId: null, pendingStep: null, postId: null, review: undefined };
        break;
      case "regenerate":
        if (["SCHEDULED", "PUBLISHED", "ANALYZED"].includes(it.stage)) throw bad();
        data = { stage: "DRAFT", copy: null, review: undefined, reviewScore: null, error: null, attempts: 0, pendingTaskId: null, pendingStep: null, needsApproval: false };
        break;
      case "edit":
        if (["SCHEDULED", "PUBLISHED", "ANALYZED"].includes(it.stage)) throw bad();
        if (input.assetId) {
          const a = await tx.marketingAsset.findFirst({ where: { id: input.assetId, companyId, archivedAt: null }, select: { id: true } });
          if (!a) throw notFound("Asset");
        }
        data = {
          copy: input.copy,
          ...(input.hashtags ? { hashtags: input.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)) } : {}),
          ...(input.cta !== undefined ? { cta: input.cta || null } : {}),
          ...(input.assetId !== undefined ? { assetId: input.assetId || null } : {}),
          stage: "AI_REVIEW",
          review: undefined,
          reviewScore: null,
          error: null,
          pendingTaskId: null,
          pendingStep: null,
        };
        break;
    }
    const updated = await tx.marketingAutopilotItem.update({ where: { id: itemId }, data });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `marketing.autopilot_item.${input.action}`, resourceType: "marketing_autopilot_item", resourceId: itemId, oldValue: { stage: it.stage }, newValue: { stage: updated.stage } });
    return updated;
  });
  if (input.action === "approve") await advanceItem(item.id);
  return db().marketingAutopilotItem.findUniqueOrThrow({ where: { id: itemId } });
}

// ── Time slots ──

function tzOffsetMs(at: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - at;
}
/** Local wall time (YYYY-MM-DD + HH:MM) in `timeZone` → UTC instant. */
export function zonedToUtc(day: string, time: string, timeZone: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - tzOffsetMs(guess, timeZone);
  t = guess - tzOffsetMs(t, timeZone);
  return new Date(t);
}
function localDay(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Evenly spread n times across 08:00–20:00 local. */
function spread(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const minutes = 8 * 60 + Math.round(((i + 0.5) * 12 * 60) / n);
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  });
}

async function windowsFor(companyId: string, platform: MarketingSocialProvider, configured: string[] | undefined, n: number): Promise<string[]> {
  let base = configured?.length ? configured : null;
  if (!base) {
    const learned = await db().marketingLearning.findMany({ where: { companyId, kind: "time", platform, active: true }, orderBy: { score: "desc" }, take: 8, select: { key: true } });
    base = learned.map((l) => l.key).filter((k) => /^\d{2}:\d{2}$/.test(k));
    if (!base.length) base = DEFAULT_WINDOWS[platform];
  }
  const sorted = [...base];
  return n <= sorted.length ? sorted.slice(0, n).sort() : spread(n);
}

/** Fill the next `horizonDays` of slots (idempotent: one item per autopilot/platform/format/slot). */
export async function planSlots(autopilotId: string): Promise<number> {
  const a = await db().marketingAutopilot.findUnique({ where: { id: autopilotId } });
  if (!a || a.archivedAt) return 0;
  const accounts = await db().marketingSocialAccount.findMany({ where: { companyId: a.companyId, id: { in: a.accountIds }, archivedAt: null } });
  const cadence = a.cadence as Record<string, number>;
  const windows = a.postingWindows as Partial<Record<MarketingSocialProvider, string[]>>;
  const now = Date.now();
  const rows: Prisma.MarketingAutopilotItemCreateManyInput[] = [];
  const missing = new Set<string>();
  for (const [key, perDay] of Object.entries(cadence)) {
    if (!perDay) continue;
    const [platform, format = "post"] = key.split(":") as [MarketingSocialProvider, string];
    const account = accounts.find((x) => x.provider === platform);
    if (!account) {
      missing.add(platform);
      continue;
    }
    const times = await windowsFor(a.companyId, platform, windows[platform], perDay);
    for (let d = 0; d < a.horizonDays; d++) {
      const day = localDay(new Date(now + d * 86_400_000), a.timezone);
      for (const time of times) {
        // Formats share windows with posts of the same platform; offset by 7 minutes to keep slots distinct.
        const slot = zonedToUtc(day, time, a.timezone);
        if (format !== "post") slot.setUTCMinutes(slot.getUTCMinutes() + 7);
        if (slot.getTime() < now + 30 * 60_000) continue;
        rows.push({ organizationId: a.organizationId, companyId: a.companyId, autopilotId: a.id, platform, format, accountId: account.id, slotAt: slot, pillar: a.pillars.length ? a.pillars[rows.length % a.pillars.length] : null });
      }
    }
  }
  const { count } = rows.length ? await db().marketingAutopilotItem.createMany({ data: rows.slice(0, 300), skipDuplicates: true }) : { count: 0 };
  await db().marketingAutopilot.update({ where: { id: a.id }, data: { lastPlannedAt: new Date() } });
  for (const p of missing) {
    await upsertRecommendation(a.organizationId, a.companyId, {
      dedupeKey: `autopilot:${a.id}:account:${p}`,
      title: `Add a ${p} account to "${a.name}"`,
      detail: `The autopilot has a ${p} cadence but no ${p} account is selected, so no ${p} slots were planned.`,
      priority: "high",
      href: `/marketing/autopilot/${a.id}`,
    });
  }
  return count;
}

// ── Pipeline ──

const ideaSchema = z.object({ ideas: z.array(z.object({ slot: z.number().int(), topic: z.string().min(3).max(300), angle: z.string().max(600).optional(), pillar: z.string().max(200).optional() })).min(1) });
const draftSchema = z.object({
  copy: z.string().min(1).max(70_000),
  hashtags: z.array(z.string().max(60)).max(30).default([]),
  cta: z.string().max(300).optional().nullable(),
  creativeBrief: z.string().max(3000).optional().nullable(),
  videoScript: z.string().max(10_000).optional().nullable(),
  assumptions: z.string().max(3000).optional().nullable(),
});
const reviewSchema = z.object({
  score: z.number().min(0).max(100),
  checks: z.record(z.string(), z.object({ pass: z.boolean(), note: z.string().max(1000).optional() })).default({}),
  issues: z.array(z.string().max(500)).max(20).default([]),
});

const STEP_PROFILE = { ideate: "content_strategist", draft: "social_media_manager", review: "cmo" } as const;
type Step = keyof typeof STEP_PROFILE;

function shingles(text: string) {
  const words = text.toLowerCase().replace(/https?:\/\/\S+/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];
  const set = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) set.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  if (!set.size) words.forEach((w) => set.add(w));
  return set;
}
/** Jaccard similarity of word 3-gram shingles (0–1). */
export function similarity(a: string, b: string) {
  const x = shingles(a);
  const y = shingles(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const s of x) if (y.has(s)) inter++;
  return inter / (x.size + y.size - inter);
}

async function startTask(item: Item, ap: { aiEmployeeId: string | null }, step: Step, title: string, instructions: string) {
  const brand = await brandContextFor(item.companyId);
  const learned = await learningsContext(item.companyId);
  const full = [instructions, brand, learned].filter(Boolean).join("\n\n").slice(0, 8000);
  const task = await createTask(systemContext(), item.organizationId, item.companyId, {
    ...(step === "draft" && ap.aiEmployeeId ? { aiEmployeeId: ap.aiEmployeeId } : { profile: STEP_PROFILE[step] }),
    title: title.slice(0, 200),
    instructions: full,
    subject: { type: "marketing_autopilot_item", id: item.id },
  });
  return task.id;
}

async function fail(item: Item, error: string, ap: { id: string; name: string; organizationId: string; companyId: string; ownerId: string | null; createdById: string; aiEmployeeId: string | null }) {
  await db().marketingAutopilotItem.update({ where: { id: item.id }, data: { stage: "FAILED", error: error.slice(0, 500), pendingTaskId: null, pendingStep: null } });
  const reason = error.split(":")[0]!;
  const created = await upsertRecommendation(ap.organizationId, ap.companyId, {
    dedupeKey: `autopilot:${ap.id}:fail:${reason}:${new Date().toISOString().slice(0, 10)}`,
    title: `Autopilot "${ap.name}": items failing (${reason})`,
    detail: error.slice(0, 1000),
    priority: "high",
    href: `/marketing/autopilot/${ap.id}?stage=FAILED`,
  });
  if (!created) return;
  await transaction(async (tx) => {
    const users = await tx.user.findMany({ where: { id: { in: [ap.ownerId, ap.createdById].filter((x): x is string => !!x) } }, select: { id: true } });
    await notifyUsers(tx, ap.organizationId, users.map((u) => u.id), "marketing.autopilot_failed", { companyId: ap.companyId, title: `${ap.name}: ${reason}`, href: `/marketing/autopilot/${ap.id}?stage=FAILED` });
  });
  if (ap.aiEmployeeId && aiConfigured()) {
    await createTask(systemContext(), ap.organizationId, ap.companyId, {
      aiEmployeeId: ap.aiEmployeeId,
      title: `Investigate autopilot failure: ${ap.name}`.slice(0, 200),
      instructions: `An item of the marketing autopilot "${ap.name}" failed with: ${error.slice(0, 1500)}\nPlatform: ${item.platform}, slot ${item.slotAt.toISOString()}.\nExplain the likely cause and the concrete fix (connection, account settings, media, content rules). Do not claim anything was published.`,
      subject: { type: "marketing_autopilot_item", id: item.id },
    }).catch(() => undefined);
  }
}

/** Charge an estimated generation cost against the autopilot's monthly cap; false when it would exceed the cap. */
async function chargeBudget(apId: string, cents: number): Promise<boolean> {
  const a = await db().marketingAutopilot.findUniqueOrThrow({ where: { id: apId }, select: { monthlyBudgetMinor: true, spentMinor: true, spentMonth: true } });
  if (a.monthlyBudgetMinor == null) return false;
  const month = new Date().toISOString().slice(0, 7);
  const spent = a.spentMonth === month ? a.spentMinor : 0n;
  if (spent + BigInt(cents) > a.monthlyBudgetMinor) return false;
  await db().marketingAutopilot.update({ where: { id: apId }, data: { spentMinor: spent + BigInt(cents), spentMonth: month } });
  return true;
}

async function ideate(ap: NonNullable<Awaited<ReturnType<typeof loadAp>>>, items: Item[]) {
  const recent = await db().marketingAutopilotItem.findMany({ where: { autopilotId: ap.id, topic: { not: null }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, select: { topic: true }, orderBy: { createdAt: "desc" }, take: 60 });
  const lines = items.map((it, i) => `${i}: ${it.platform} ${it.format} at ${it.slotAt.toISOString()}${it.pillar ? ` (pillar: ${it.pillar})` : ""}`);
  const instructions = `You plan social content for the marketing autopilot "${ap.name}".
Objective: ${ap.objective}
${ap.audience ? `Audience: ${ap.audience}\n` : ""}${ap.regions.length ? `Regions: ${ap.regions.join(", ")}\n` : ""}${ap.pillars.length ? `Content pillars: ${ap.pillars.join("; ")}\n` : ""}${recent.length ? `Recent topics (do not repeat): ${recent.map((r) => r.topic).join(" | ").slice(0, 2500)}\n` : ""}
Propose one distinct, specific topic and angle for each slot below, suited to the platform and format and grounded in the company's documents (search_company_brain). Vary pillars and angles.
Slots:
${lines.join("\n")}

Return ONLY a JSON object, no prose: {"ideas":[{"slot": number (the slot index), "topic": string, "angle": string, "pillar": string}]}`;
  const taskId = await startTask(items[0]!, ap, "ideate", `Autopilot ideas: ${ap.name}`, instructions);
  await db().marketingAutopilotItem.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { pendingTaskId: taskId, pendingStep: "ideate" } });
}

function draftInstructions(ap: NonNullable<Awaited<ReturnType<typeof loadAp>>>, it: Item, feedback?: string) {
  const limit = TEXT_LIMITS[it.platform];
  return `Write the ${it.platform} ${it.format} for the marketing autopilot "${ap.name}".
Objective: ${ap.objective}
${ap.audience ? `Audience: ${ap.audience}\n` : ""}Topic: ${it.topic}
${it.angle ? `Angle: ${it.angle}\n` : ""}${it.pillar ? `Pillar: ${it.pillar}\n` : ""}
${it.research ? `Research (cite only these facts; do not invent numbers):\n${it.research}\n` : "No web research is available: rely on the company's documents (search_company_brain) and state any assumption you make in \"assumptions\".\n"}
Rules: the copy (without hashtags) must be at most ${Math.min(limit, it.platform === "X" ? 250 : limit)} characters and follow ${it.platform} conventions; end with one clear call to action; at most ${it.platform === "LINKEDIN" ? 5 : it.platform === "INSTAGRAM" ? 15 : 4} relevant hashtags; never invent customers, results or statistics.${ap.complianceRules.length ? `\nCompliance rules: ${ap.complianceRules.join("; ")}` : ""}${VIDEO_FORMATS.has(it.format) || it.platform === "TIKTOK" || it.platform === "YOUTUBE" ? "\nAlso write a short video script (hook in the first 2 seconds, 3-5 scenes with on-screen text and voice-over, 15-45 seconds) in \"videoScript\"." : ""}${feedback ? `\nThe previous draft failed review: ${feedback}\nFix every issue.` : ""}

Return ONLY a JSON object, no prose: {"copy": string, "hashtags": string[], "cta": string, "creativeBrief": string (one-paragraph visual description for the image/video), "videoScript": string|null, "assumptions": string|null}`;
}

async function review(ap: NonNullable<Awaited<ReturnType<typeof loadAp>>>, it: Item) {
  const kit = await loadBrandKit(db(), it.companyId);
  const text = withHashtags(it.copy ?? "", it.hashtags);
  const issues: { check: string; severity: "error" | "warning"; message: string }[] = [];
  if (text.length > TEXT_LIMITS[it.platform]) issues.push({ check: "length", severity: "error", message: `Text is ${text.length} characters; ${it.platform} allows ${TEXT_LIMITS[it.platform]}` });
  if (!it.cta && !/\b(learn more|sign up|book|try|get|download|join|visit|contact|register|start|shop|read)\b/i.test(text)) issues.push({ check: "cta", severity: "warning", message: "No clear call to action" });
  for (const url of text.match(/https?:\/\/[^\s)]+/g) ?? []) {
    if (!/^https:\/\//.test(url)) issues.push({ check: "links", severity: "warning", message: `Insecure link ${url}` });
    else {
      const ok = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(6000) }).then((r) => r.status < 400).catch(() => false);
      if (!ok) issues.push({ check: "links", severity: "error", message: `Link does not resolve: ${url}` });
    }
  }
  const banned = [...(kit?.dontWords ?? [])].filter((w) => w && text.toLowerCase().includes(w.toLowerCase()));
  if (banned.length) issues.push({ check: "brand_words", severity: "error", message: `Uses banned words: ${banned.join(", ")}` });
  const recent = await db().marketingSocialPostTarget.findMany({
    where: { companyId: it.companyId, accountId: it.accountId ?? undefined, status: "PUBLISHED", publishedAt: { gte: new Date(Date.now() - 90 * 86_400_000) } },
    select: { text: true, post: { select: { text: true } } },
    take: 200,
    orderBy: { publishedAt: "desc" },
  });
  const siblings = await db().marketingAutopilotItem.findMany({ where: { autopilotId: it.autopilotId, id: { not: it.id }, copy: { not: null }, stage: { notIn: ["REJECTED", "FAILED"] }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, select: { copy: true }, take: 200 });
  const maxSim = Math.max(0, ...recent.map((r) => similarity(it.copy ?? "", r.text ?? r.post.text)), ...siblings.map((s) => similarity(it.copy ?? "", s.copy!)));
  if (maxSim > 0.6) issues.push({ check: "duplication", severity: "error", message: `Too similar to a recent post (${Math.round(maxSim * 100)}% overlap)` });
  else if (maxSim > 0.4) issues.push({ check: "duplication", severity: "warning", message: `Similar to a recent post (${Math.round(maxSim * 100)}% overlap)` });
  const instructions = `You are the brand and quality reviewer. Review this ${it.platform} ${it.format} before it is published.
Copy:
"""
${text}
"""
Objective: ${ap.objective}
${ap.complianceRules.length ? `Compliance rules (each must hold): ${ap.complianceRules.join("; ")}\n` : ""}Automatic checks already found: ${issues.length ? issues.map((i) => `${i.check}: ${i.message}`).join("; ") : "none"}.
Score 0-100 for publish-readiness. Check: brandVoice (follows the brand guidelines), grammar (spelling, punctuation), format (fits ${it.platform} style and length), cta (clear and relevant), compliance (rules above, no unverifiable claims, no invented statistics), factual (claims supported by the company's documents or the research). Be strict.

Return ONLY a JSON object, no prose: {"score": number, "checks": {"brandVoice": {"pass": boolean, "note": string}, "grammar": {...}, "format": {...}, "cta": {...}, "compliance": {...}, "factual": {...}}, "issues": string[]}`;
  const taskId = await startTask(it, ap, "review", `Autopilot review: ${it.topic ?? it.platform}`, instructions);
  await db().marketingAutopilotItem.update({ where: { id: it.id }, data: { pendingTaskId: taskId, pendingStep: "review", review: { auto: issues, similarity: Number(maxSim.toFixed(3)) } } });
}

async function loadAp(id: string) {
  return db().marketingAutopilot.findUnique({ where: { id } });
}

/** Creative for an item: video job for video formats, image otherwise. Records "requires credentials" instead of faking. */
async function makeCreative(ap: NonNullable<Awaited<ReturnType<typeof loadAp>>>, it: Item, brief: string): Promise<{ assetId: string | null; note: string | null }> {
  const needsVideo = VIDEO_FORMATS.has(it.format) || it.platform === "YOUTUBE" || (it.platform === "TIKTOK" && it.format !== "carousel");
  const preset = presetFor(it.platform, it.format);
  const prompt = await creativePrompt(it.companyId, brief || it.topic || ap.objective);
  if (needsVideo) {
    const conn = await videoConnection(it.organizationId, it.companyId);
    if (!conn) return { assetId: null, note: "video_requires_credentials" };
    if (!(await chargeBudget(ap.id, ESTIMATED_COST_CENTS[conn.provider]))) return { assetId: null, note: "budget_cap_reached" };
    const job = await startVideoJob(it.organizationId, it.companyId, { prompt, vertical: preset === "story_reel" });
    if (!job) return { assetId: null, note: "video_requires_credentials" };
    const a = await db().marketingAsset.create({
      data: { organizationId: it.organizationId, companyId: it.companyId, kind: "VIDEO", status: "PROCESSING", name: `${it.platform} ${it.format}: ${(it.topic ?? "").slice(0, 60)}`, provider: job.provider, providerJobId: job.jobId, prompt: brief, preset, campaignId: ap.campaignId, createdById: ap.createdById },
    });
    return { assetId: a.id, note: null };
  }
  const required = MEDIA_REQUIRED[it.platform];
  if (!ap.generateImages && !required) return { assetId: null, note: null };
  const conn = await imageConnection(it.organizationId, it.companyId);
  if (!conn) return { assetId: null, note: required ? "image_requires_credentials" : null };
  if (!(await chargeBudget(ap.id, ESTIMATED_COST_CENTS[conn.provider]))) return { assetId: null, note: required ? "budget_cap_reached" : null };
  const img = await generateImage(it.organizationId, it.companyId, prompt, PRESETS[preset]);
  if (!img) return { assetId: null, note: required ? "image_requires_credentials" : null };
  const a = await db().marketingAsset.create({
    data: {
      organizationId: it.organizationId,
      companyId: it.companyId,
      kind: "IMAGE",
      name: `${it.platform}: ${(it.topic ?? "").slice(0, 70)}`,
      mimeType: img.mimeType,
      data: new Uint8Array(img.bytes),
      sizeBytes: img.bytes.length,
      width: PRESETS[preset].width,
      height: PRESETS[preset].height,
      preset,
      provider: img.provider,
      prompt: brief,
      campaignId: ap.campaignId,
      createdById: ap.createdById,
    },
  });
  return { assetId: a.id, note: null };
}

function needsApproval(ap: { autonomy: string; approvalRules: Prisma.JsonValue }, it: Item) {
  if (ap.autonomy !== "AUTO_PUBLISH") return true;
  const rules = (ap.approvalRules ?? {}) as Record<string, string>;
  const rule = rules[`${it.platform}:${it.format}`] ?? rules[it.format] ?? rules[it.platform] ?? rules[VIDEO_FORMATS.has(it.format) ? "video" : "post"];
  return rule === "review";
}

async function schedule(ap: NonNullable<Awaited<ReturnType<typeof loadAp>>>, it: Item) {
  if (!it.accountId) throw new ProviderError("no_account");
  const asset = it.assetId ? await db().marketingAsset.findFirst({ where: { id: it.assetId }, select: { status: true } }) : null;
  if (asset && asset.status === "PROCESSING") return; // wait for the video job
  if (asset && asset.status === "FAILED") throw new ProviderError("creative_failed");
  const text = withHashtags(it.copy!, it.hashtags);
  const hash = contentHashOf(text, it.assetId);
  const dup = await db().marketingSocialPostTarget.findFirst({ where: { accountId: it.accountId, contentHash: hash, status: "PUBLISHED" }, select: { id: true } });
  if (dup) throw new ProviderError("duplicate_content");
  const at = it.slotAt.getTime() < Date.now() + 60_000 ? new Date(Date.now() + 60_000) : it.slotAt;
  const post = await createPost(systemContext(), it.organizationId, it.companyId, {
    title: `${ap.name} · ${it.platform} · ${(it.topic ?? "").slice(0, 80)}`.slice(0, 200),
    text: it.copy!,
    hashtags: it.hashtags.map((h) => h.replace(/^#/, "")).filter((h) => /^[\p{L}\p{N}_]{1,60}$/u.test(h)),
    mediaAssetId: it.assetId,
    campaignId: ap.campaignId,
    contentId: it.contentId,
    targets: [{ accountId: it.accountId }],
    scheduledAt: at.toISOString(),
  });
  await db().$transaction([
    db().marketingSocialPost.update({ where: { id: post.id }, data: { createdById: ap.createdById } }),
    db().marketingSocialPostTarget.updateMany({ where: { postId: post.id }, data: { contentHash: hash } }),
    db().marketingAutopilotItem.update({ where: { id: it.id }, data: { stage: "SCHEDULED", postId: post.id, contentHash: hash, error: null } }),
  ]);
}

/** Advance one item by one step (idempotent; safe to call repeatedly). */
export async function advanceItem(itemId: string): Promise<void> {
  const it = await db().marketingAutopilotItem.findUnique({ where: { id: itemId } });
  if (!it) return;
  const ap = await loadAp(it.autopilotId);
  if (!ap || ap.archivedAt) return;
  try {
    // A step is running as an agent task: collect it.
    if (it.pendingTaskId) {
      const task = await db().agentTask.findUnique({ where: { id: it.pendingTaskId }, select: { status: true, output: true, errorMessage: true, errorCode: true, createdAt: true } });
      if (!task) return void (await db().marketingAutopilotItem.update({ where: { id: it.id }, data: { pendingTaskId: null, pendingStep: null } }));
      if (task.status === "QUEUED" || task.status === "RUNNING") {
        if (Date.now() - task.createdAt.getTime() > 3 * 3_600_000) await fail(it, "ai_task_timeout", ap);
        return;
      }
      if (task.status !== "COMPLETED" || !task.output) {
        if (it.attempts < 2) await db().marketingAutopilotItem.update({ where: { id: it.id }, data: { pendingTaskId: null, pendingStep: null, attempts: { increment: 1 } } });
        else await fail(it, `ai_task_failed: ${task.errorCode ?? task.status} ${task.errorMessage ?? ""}`.trim(), ap);
        return;
      }
      const json = extractJson(task.output);
      if (it.pendingStep === "ideate") {
        const parsed = ideaSchema.safeParse(json);
        const siblings = await db().marketingAutopilotItem.findMany({ where: { pendingTaskId: it.pendingTaskId }, orderBy: { slotAt: "asc" } });
        if (!parsed.success) {
          await db().marketingAutopilotItem.updateMany({ where: { pendingTaskId: it.pendingTaskId }, data: { pendingTaskId: null, pendingStep: null, attempts: { increment: 1 } } });
          if (it.attempts >= 2) for (const s of siblings) await fail(s, "ai_output_unparseable", ap);
          return;
        }
        // The ideation task covered siblings in slotAt order (same order as when it was started).
        for (const [i, s] of siblings.entries()) {
          const idea = parsed.data.ideas.find((x) => x.slot === i);
          await db().marketingAutopilotItem.update({
            where: { id: s.id },
            data: idea ? { topic: idea.topic, angle: idea.angle ?? null, pillar: idea.pillar ?? s.pillar, stage: "RESEARCH", pendingTaskId: null, pendingStep: null } : { pendingTaskId: null, pendingStep: null },
          });
        }
        return;
      }
      if (it.pendingStep === "draft") {
        const parsed = draftSchema.safeParse(json);
        if (!parsed.success) {
          if (it.attempts >= 2) await fail(it, "ai_output_unparseable", ap);
          else await db().marketingAutopilotItem.update({ where: { id: it.id }, data: { pendingTaskId: null, pendingStep: null, attempts: { increment: 1 } } });
          return;
        }
        const d = parsed.data;
        const hashtags = [...new Set(d.hashtags.map((h) => `#${h.replace(/^#+/, "").replace(/\s+/g, "")}`).filter((h) => /^#[\p{L}\p{N}_]{1,60}$/u.test(h)))].slice(0, 15);
        await db().marketingAutopilotItem.update({
          where: { id: it.id },
          data: { copy: d.copy.trim(), hashtags, cta: d.cta ?? null, creativeBrief: d.creativeBrief ?? null, videoScript: d.videoScript ?? null, assumptions: d.assumptions ?? it.assumptions, pendingTaskId: null, pendingStep: null },
        });
        if (!it.assetId) {
          const c = await makeCreative(ap, it, d.creativeBrief ?? "").catch((err) => ({ assetId: null, note: err instanceof ProviderError ? `creative_${err.reason}` : "creative_error" }));
          await db().marketingAutopilotItem.update({ where: { id: it.id }, data: { assetId: c.assetId, error: c.note } });
        }
        await db().marketingAutopilotItem.update({ where: { id: it.id }, data: { stage: "AI_REVIEW" } });
        return;
      }
      if (it.pendingStep === "review") {
        const parsed = reviewSchema.safeParse(json);
        if (!parsed.success) {
          if (it.attempts >= 2) await fail(it, "ai_output_unparseable", ap);
          else await db().marketingAutopilotItem.update({ where: { id: it.id }, data: { pendingTaskId: null, pendingStep: null, attempts: { increment: 1 } } });
          return;
        }
        const prev = (it.review ?? {}) as { auto?: { check: string; severity: string; message: string }[]; similarity?: number };
        const auto = prev.auto ?? [];
        const failedChecks = Object.entries(parsed.data.checks).filter(([, v]) => !v.pass);
        const blocking = auto.filter((i) => i.severity === "error").length + failedChecks.filter(([k]) => k === "compliance" || k === "factual").length;
        const score = Math.max(0, Math.round(parsed.data.score - auto.filter((i) => i.severity === "error").length * 20 - auto.filter((i) => i.severity === "warning").length * 5));
        const passed = blocking === 0 && score >= ap.minReviewScore;
        const reviewJson = { score, passed, auto, similarity: prev.similarity ?? 0, checks: parsed.data.checks, issues: parsed.data.issues };
        if (passed) {
          const credsNote = it.error && /requires_credentials|budget_cap/.test(it.error);
          await db().marketingAutopilotItem.update({ where: { id: it.id }, data: { review: reviewJson, reviewScore: score, stage: "READY", needsApproval: needsApproval(ap, it) || !!credsNote, pendingTaskId: null, pendingStep: null } });
        } else if (it.attempts < 2) {
          const feedback = [...auto.map((i) => i.message), ...failedChecks.map(([k, v]) => `${k}: ${v.note ?? "failed"}`), ...parsed.data.issues].join("; ").slice(0, 1500);
          await db().marketingAutopilotItem.update({ where: { id: it.id }, data: { review: { ...reviewJson, feedback }, reviewScore: score, stage: "DRAFT", attempts: { increment: 1 }, pendingTaskId: null, pendingStep: null } });
        } else {
          await db().marketingAutopilotItem.update({ where: { id: it.id }, data: { review: reviewJson, reviewScore: score, stage: "REJECTED", error: `review_failed: score ${score}`, pendingTaskId: null, pendingStep: null } });
        }
        return;
      }
      await db().marketingAutopilotItem.update({ where: { id: it.id }, data: { pendingTaskId: null, pendingStep: null } });
      return;
    }

    switch (it.stage) {
      case "IDEA": {
        // One ideation task covers all of the autopilot's open ideas (up to 15).
        const batch = await db().marketingAutopilotItem.findMany({ where: { autopilotId: ap.id, stage: "IDEA", pendingTaskId: null }, orderBy: { slotAt: "asc" }, take: 15 });
        if (batch.length) await ideate(ap, batch);
        return;
      }
      case "RESEARCH": {
        let research: string | null = null;
        let sources: { title: string; url: string }[] = [];
        if (ap.useResearch && it.topic) {
          const r = await webSearch(it.organizationId, it.companyId, `${it.topic}${ap.regions.length ? ` ${ap.regions[0]}` : ""}`).catch(() => null);
          if (r) {
            research = researchDigest(r);
            sources = r.sources.map((s) => ({ title: s.title, url: s.url }));
          }
        }
        await db().marketingAutopilotItem.update({ where: { id: it.id }, data: { research, sources, assumptions: research ? null : "No research provider connected: the draft relies on company documents and states its assumptions.", stage: "DRAFT" } });
        return;
      }
      case "DRAFT": {
        const feedback = (it.review as { feedback?: string } | null)?.feedback;
        const taskId = await startTask(it, ap, "draft", `Autopilot draft: ${it.platform} — ${it.topic ?? ""}`, draftInstructions(ap, it, feedback));
        await db().marketingAutopilotItem.update({ where: { id: it.id }, data: { pendingTaskId: taskId, pendingStep: "draft" } });
        return;
      }
      case "AI_REVIEW":
        if (!it.copy) return void (await db().marketingAutopilotItem.update({ where: { id: it.id }, data: { stage: "DRAFT" } }));
        await review(ap, it);
        return;
      case "READY":
        if (ap.autonomy === "DRAFT_ONLY" && !it.approvedAt) return;
        if (it.needsApproval) return;
        if (ap.status !== "ACTIVE" && !it.approvedAt) return;
        await schedule(ap, it);
        return;
      default:
        return;
    }
  } catch (err) {
    const reason = err instanceof ProviderError ? err.reason : isAppError(err) ? ((err.details?.reason as string | undefined) ?? err.code) : "error";
    logger.warn({ itemId: it.id, stage: it.stage, reason, err: err instanceof Error ? err.message : String(err) }, "autopilot step failed");
    // AI not configured / daily allowance used up: leave the item where it is and retry on the next tick.
    if (reason === "ai_not_configured" || reason === "ai_budget_exhausted" || reason === "workforce_employee_over_budget") {
      await upsertRecommendation(ap.organizationId, ap.companyId, { dedupeKey: `autopilot:${ap.id}:${reason}`, title: `Autopilot "${ap.name}" is waiting: ${reason}`, priority: "high", href: `/marketing/autopilot/${ap.id}` });
      return;
    }
    await fail(it, `${reason}${err instanceof Error && err.message !== reason ? `: ${err.message.slice(0, 300)}` : ""}`, ap);
  }
}

/** Worker: plan slots for active autopilots (hourly per plan) and advance pipeline items. */
export async function runAutopilots(): Promise<number> {
  const active = await db().marketingAutopilot.findMany({ where: { status: "ACTIVE", archivedAt: null }, select: { id: true, lastPlannedAt: true } });
  for (const a of active) {
    if (!a.lastPlannedAt || Date.now() - a.lastPlannedAt.getTime() > 3_600_000) await planSlots(a.id).catch((err) => logger.warn({ autopilotId: a.id, err: String(err) }, "autopilot planning failed"));
  }
  if (!active.length) return 0;
  const items = await db().marketingAutopilotItem.findMany({
    where: { autopilotId: { in: active.map((a) => a.id) }, stage: { in: ["IDEA", "RESEARCH", "DRAFT", "AI_REVIEW", "READY"] }, slotAt: { lte: new Date(Date.now() + 15 * 86_400_000) } },
    orderBy: [{ slotAt: "asc" }],
    take: 40,
    select: { id: true, stage: true, pendingTaskId: true, autopilotId: true },
  });
  const seenIdea = new Set<string>();
  let n = 0;
  for (const i of items) {
    // IDEA items are batched per autopilot; start ideation once per tick.
    if (i.stage === "IDEA" && !i.pendingTaskId) {
      if (seenIdea.has(i.autopilotId)) continue;
      seenIdea.add(i.autopilotId);
    }
    if (!aiConfigured() && ["IDEA", "DRAFT", "AI_REVIEW"].includes(i.stage) && !i.pendingTaskId) continue;
    await advanceItem(i.id);
    n++;
  }
  return n;
}

/** Worker: PUBLISHED items 48h after publishing get a performance snapshot (ANALYZED). */
export async function analyzePublishedItems(): Promise<number> {
  const items = await db().marketingAutopilotItem.findMany({ where: { stage: "PUBLISHED", postId: { not: null }, updatedAt: { lte: new Date(Date.now() - 48 * 3_600_000) } }, take: 50 });
  let n = 0;
  for (const it of items) {
    const targets = await db().marketingSocialPostTarget.findMany({ where: { postId: it.postId!, status: "PUBLISHED" }, select: { impressions: true, reach: true, likes: true, comments: true, shares: true, clicks: true, metricsAt: true } });
    if (!targets.some((t) => t.metricsAt)) continue;
    const sum = (k: "impressions" | "reach" | "likes" | "comments" | "shares" | "clicks") => targets.reduce((s, t) => s + (t[k] ?? 0), 0);
    const engagement = sum("likes") + sum("comments") + sum("shares") + sum("clicks");
    const impressions = sum("impressions");
    await db().marketingAutopilotItem.update({
      where: { id: it.id },
      data: { stage: "ANALYZED", performance: { impressions, reach: sum("reach"), likes: sum("likes"), comments: sum("comments"), shares: sum("shares"), clicks: sum("clicks"), engagement, engagementRate: impressions ? Number((engagement / impressions).toFixed(4)) : null } },
    });
    n++;
  }
  return n;
}

export async function pipelineSummary(organizationId: string, companyId: string) {
  const rows = await db().marketingAutopilotItem.groupBy({ by: ["stage"], where: { organizationId, companyId }, _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.stage, r._count._all])) as Partial<Record<MarketingPipelineStage, number>>;
}
