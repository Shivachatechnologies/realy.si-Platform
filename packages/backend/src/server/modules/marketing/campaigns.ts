import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { MarketingCampaignStatus } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { actorId, authorize, blank, CHANNELS, day, enumParam, isUuid, money, PAGE_SIZE, pageParam, param, requireOwned, toDay, toMinor, uuid } from "./common";

export const CAMPAIGN_STATUSES = ["DRAFT", "PLANNED", "ACTIVE", "PAUSED", "COMPLETED"] as const;
export const CAMPAIGN_TRANSITIONS: Record<MarketingCampaignStatus, MarketingCampaignStatus[]> = {
  DRAFT: ["PLANNED", "ACTIVE"],
  PLANNED: ["DRAFT", "ACTIVE"],
  ACTIVE: ["PAUSED", "COMPLETED"],
  PAUSED: ["ACTIVE", "COMPLETED"],
  COMPLETED: [],
};

const code = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/)
  .transform((v) => v.toUpperCase());

const campaignFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  objective: z.string().trim().max(500).optional(),
  channels: z.array(z.enum(CHANNELS)).max(CHANNELS.length).optional(),
  targetLeads: z.number().int().min(0).max(10_000_000).nullable().optional(),
  /** Major units. */
  targetRevenue: money.or(z.literal("")).nullable().optional(),
  budget: money.or(z.literal("")).optional(),
  startDate: day.or(z.literal("")).nullable().optional(),
  endDate: day.or(z.literal("")).nullable().optional(),
  segmentId: uuid.or(z.literal("")).nullable().optional(),
};
export const createCampaignInput = z.object({ ...campaignFields, code: code.optional().or(blank) });
export const updateCampaignInput = z.object({ ...campaignFields, name: campaignFields.name.optional(), code: code.optional() });
export const statusInput = z.object({ status: z.enum(CAMPAIGN_STATUSES) });
export const spendInput = z.object({
  amount: money,
  channel: z.enum(CHANNELS),
  spentOn: day,
  note: z.string().trim().max(500).optional(),
});

export interface CampaignFilters {
  q?: string;
  status?: MarketingCampaignStatus;
  sort?: "newest" | "name" | "start" | "budget";
  page: number;
}
export function parseCampaignFilters(raw: Record<string, string | string[] | undefined>): CampaignFilters {
  return {
    q: param(raw, "q"),
    status: enumParam(raw, "status", CAMPAIGN_STATUSES),
    sort: enumParam(raw, "sort", ["newest", "name", "start", "budget"] as const),
    page: pageParam(raw),
  };
}

/** Suggest a code from the name: letters/digits, upper-case, plus a short random suffix. */
function suggestCode(name: string) {
  const stem = name.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12) || "CMP";
  return `${stem}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export async function listCampaigns(ctx: RequestContext, organizationId: string, companyId: string, f: CampaignFilters = { page: 1 }) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const where: Prisma.MarketingCampaignWhereInput = { organizationId, companyId, archivedAt: null };
  if (f.status) where.status = f.status;
  if (f.q) where.OR = [{ name: { contains: f.q, mode: "insensitive" } }, { code: { contains: f.q, mode: "insensitive" } }];
  const orderBy: Prisma.MarketingCampaignOrderByWithRelationInput =
    f.sort === "name" ? { name: "asc" } : f.sort === "start" ? { startDate: { sort: "desc", nulls: "last" } } : f.sort === "budget" ? { budgetMinor: "desc" } : { createdAt: "desc" };
  const [total, rows] = await Promise.all([
    db().marketingCampaign.count({ where }),
    db().marketingCampaign.findMany({ where, orderBy, skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  const spend = rows.length
    ? await db().marketingSpend.groupBy({ by: ["campaignId"], where: { companyId, campaignId: { in: rows.map((r) => r.id) } }, _sum: { amountMinor: true } })
    : [];
  const spent = new Map(spend.map((s) => [s.campaignId, s._sum.amountMinor ?? 0n]));
  return { total, pageSize: PAGE_SIZE, data: rows.map((r) => ({ ...r, spentMinor: spent.get(r.id) ?? 0n })) };
}

/** id/name/code of live campaigns for pickers. */
export async function campaignOptions(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  return db().marketingCampaign.findMany({
    where: { organizationId, companyId, archivedAt: null },
    select: { id: true, name: true, code: true, status: true },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

export async function getCampaign(ctx: RequestContext, organizationId: string, companyId: string, campaignId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  if (!isUuid(campaignId)) throw notFound("Campaign");
  const c = await db().marketingCampaign.findFirst({
    where: { id: campaignId, organizationId, companyId },
    include: {
      segment: { select: { id: true, name: true } },
      spend: { orderBy: { spentOn: "desc" }, take: 200 },
      _count: { select: { content: true, socialPosts: true, emailCampaigns: true, forms: true } },
    },
  });
  if (!c) throw notFound("Campaign");
  return c;
}

async function uniqueCode(companyId: string, wanted: string | undefined, name: string, excludeId?: string) {
  const client = db();
  if (wanted) {
    const taken = await client.marketingCampaign.findFirst({ where: { companyId, code: wanted, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } });
    if (taken) throw conflict("Campaign code already in use", { reason: "marketing_code_taken" });
    return wanted;
  }
  for (let i = 0; i < 5; i++) {
    const c = suggestCode(name);
    if (!(await client.marketingCampaign.findFirst({ where: { companyId, code: c }, select: { id: true } }))) return c;
  }
  throw conflict("Could not generate a campaign code", { reason: "marketing_code_taken" });
}

function checkDates(start: Date | null | undefined, end: Date | null | undefined) {
  if (start && end && end < start) throw invalid("End date is before start date", { reason: "marketing_dates_invalid" });
}

export async function createCampaign(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof createCampaignInput>) {
  const input = createCampaignInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const finalCode = await uniqueCode(companyId, input.code, input.name);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const company = await tx.company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { baseCurrency: true } });
    const segmentId = await requireOwned(tx, "marketingSegment", companyId, input.segmentId || null, "Segment");
    const startDate = toDay(input.startDate);
    const endDate = toDay(input.endDate);
    checkDates(startDate, endDate);
    const c = await tx.marketingCampaign.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        code: finalCode,
        description: input.description || null,
        objective: input.objective || null,
        channels: input.channels ?? [],
        targetLeads: input.targetLeads ?? null,
        targetRevenueMinor: toMinor(input.targetRevenue),
        budgetMinor: toMinor(input.budget) ?? 0n,
        currency: company.baseCurrency,
        startDate,
        endDate,
        segmentId,
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.campaign.created", resourceType: "marketing_campaign", resourceId: c.id, newValue: { name: c.name, code: c.code } });
    return c;
  });
}

export async function updateCampaign(ctx: RequestContext, organizationId: string, companyId: string, campaignId: string, raw: z.input<typeof updateCampaignInput>) {
  const input = updateCampaignInput.parse(raw);
  if (!isUuid(campaignId)) throw notFound("Campaign");
  const existing = await db().marketingCampaign.findFirst({ where: { id: campaignId, organizationId, companyId }, select: { name: true } });
  if (!existing) throw notFound("Campaign");
  if (input.code) await uniqueCode(companyId, input.code, existing.name, campaignId);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const before = await tx.marketingCampaign.findFirst({ where: { id: campaignId, organizationId, companyId } });
    if (!before) throw notFound("Campaign");
    const data: Prisma.MarketingCampaignUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.code !== undefined) data.code = input.code;
    if (input.description !== undefined) data.description = input.description || null;
    if (input.objective !== undefined) data.objective = input.objective || null;
    if (input.channels !== undefined) data.channels = input.channels;
    if (input.targetLeads !== undefined) data.targetLeads = input.targetLeads;
    if (input.targetRevenue !== undefined) data.targetRevenueMinor = toMinor(input.targetRevenue);
    if (input.budget !== undefined) data.budgetMinor = toMinor(input.budget) ?? 0n;
    if (input.startDate !== undefined) data.startDate = toDay(input.startDate);
    if (input.endDate !== undefined) data.endDate = toDay(input.endDate);
    if (input.segmentId !== undefined) data.segmentId = await requireOwned(tx, "marketingSegment", companyId, input.segmentId || null, "Segment");
    checkDates(
      data.startDate !== undefined ? (data.startDate as Date | null) : before.startDate,
      data.endDate !== undefined ? (data.endDate as Date | null) : before.endDate,
    );
    const c = await tx.marketingCampaign.update({ where: { id: campaignId }, data });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.campaign.updated", resourceType: "marketing_campaign", resourceId: c.id, newValue: input });
    return c;
  });
}

/** Lifecycle move; the first move to ACTIVE launches the campaign (campaign.launched). */
export async function setCampaignStatus(ctx: RequestContext, organizationId: string, companyId: string, campaignId: string, raw: z.input<typeof statusInput>) {
  const { status } = statusInput.parse(raw);
  if (!isUuid(campaignId)) throw notFound("Campaign");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const c = await tx.marketingCampaign.findFirst({ where: { id: campaignId, organizationId, companyId, archivedAt: null } });
    if (!c) throw notFound("Campaign");
    if (!CAMPAIGN_TRANSITIONS[c.status].includes(status)) throw conflict(`Cannot move from ${c.status} to ${status}`, { reason: "marketing_invalid_transition" });
    const launching = status === "ACTIVE" && !c.launchedAt;
    const updated = await tx.marketingCampaign.update({
      where: { id: c.id },
      data: { status, ...(launching ? { launchedAt: new Date() } : {}), ...(status === "COMPLETED" ? { completedAt: new Date() } : {}) },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.campaign.status_changed", resourceType: "marketing_campaign", resourceId: c.id, oldValue: { status: c.status }, newValue: { status } });
    if (launching) {
      await emitDomainEvent(tx, ctx, "campaign.launched", {
        organizationId,
        companyId,
        entityType: "marketing_campaign",
        entityId: c.id,
        data: { name: c.name, code: c.code, budgetMinor: c.budgetMinor, currency: c.currency, channels: c.channels.join(","), startDate: c.startDate, endDate: c.endDate },
      });
      const recipients = (await usersWithPermission(tx, organizationId, companyId, "marketing.read")).filter((u) => u !== ctx.actor.id);
      await notifyUsers(tx, organizationId, recipients, "marketing.campaign_launched", { companyId, title: c.name, href: `/marketing/campaigns/${c.id}` });
    }
    return updated;
  });
}

export async function archiveCampaign(ctx: RequestContext, organizationId: string, companyId: string, campaignId: string) {
  if (!isUuid(campaignId)) throw notFound("Campaign");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingCampaign.updateMany({ where: { id: campaignId, organizationId, companyId, archivedAt: null }, data: { archivedAt: new Date() } });
    if (!count) throw notFound("Campaign");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.campaign.archived", resourceType: "marketing_campaign", resourceId: campaignId });
    return { ok: true };
  });
}

export async function addSpend(ctx: RequestContext, organizationId: string, companyId: string, campaignId: string, raw: z.input<typeof spendInput>) {
  const input = spendInput.parse(raw);
  if (!isUuid(campaignId)) throw notFound("Campaign");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const c = await tx.marketingCampaign.findFirst({ where: { id: campaignId, organizationId, companyId }, select: { id: true, currency: true } });
    if (!c) throw notFound("Campaign");
    const s = await tx.marketingSpend.create({
      data: {
        organizationId,
        companyId,
        campaignId,
        amountMinor: toMinor(input.amount) ?? 0n,
        currency: c.currency,
        channel: input.channel,
        spentOn: toDay(input.spentOn)!,
        note: input.note || null,
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.spend.recorded", resourceType: "marketing_spend", resourceId: s.id, newValue: { campaignId, amountMinor: s.amountMinor, channel: s.channel } });
    return s;
  });
}

export async function deleteSpend(ctx: RequestContext, organizationId: string, companyId: string, campaignId: string, spendId: string) {
  if (!isUuid(campaignId) || !isUuid(spendId)) throw notFound("Spend");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const s = await tx.marketingSpend.findFirst({ where: { id: spendId, campaignId, organizationId, companyId } });
    if (!s) throw notFound("Spend");
    await tx.marketingSpend.delete({ where: { id: s.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.spend.deleted", resourceType: "marketing_spend", resourceId: s.id, oldValue: { amountMinor: s.amountMinor, channel: s.channel } });
    return { ok: true };
  });
}
