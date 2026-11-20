import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask, getTask } from "@/server/modules/agents/service";
import { sendPlainEmail } from "@/server/modules/email/service";
import { actorId, authorize, enumParam, isUuid, PAGE_SIZE, pageParam, param, uuid } from "./common";
import { getMarketingConnection, isUsable, SOCIAL_PROVIDER_KEYS } from "./connections-bridge";
import { COMMENTS_SUPPORTED, fetchComments, ProviderError, replyToComment } from "./social-providers";
import { brandContextFor } from "./brand";

// ───────────── Community: comments & mentions ─────────────

export const ENGAGEMENT_STATUSES = ["NEW", "DRAFTED", "REPLIED", "IGNORED"] as const;
export const replyDraftInput = z.object({ text: z.string().trim().min(1).max(3000) });
export const engagementActionInput = z.discriminatedUnion("action", [z.object({ action: z.literal("ignore") }), z.object({ action: z.literal("reopen") }), z.object({ action: z.literal("ai_draft") })]);

const NEG = /\b(bad|terrible|awful|worst|scam|refund|broken|angry|disappointed|hate|useless|slow|never again|complaint|problem|issue|bug)\b/i;
const POS = /\b(great|love|amazing|awesome|thanks|thank you|excellent|helpful|fantastic|perfect|congrats|brilliant)\b/i;
export const sentimentOf = (t: string) => (NEG.test(t) ? "negative" : POS.test(t) ? "positive" : "neutral");

export function parseEngagementFilters(raw: Record<string, string | string[] | undefined>) {
  return { status: enumParam(raw, "status", ENGAGEMENT_STATUSES), sentiment: enumParam(raw, "sentiment", ["positive", "neutral", "negative"] as const), q: param(raw, "q"), page: pageParam(raw) };
}

export async function listEngagements(ctx: RequestContext, organizationId: string, companyId: string, f: ReturnType<typeof parseEngagementFilters>) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const where: Prisma.MarketingEngagementWhereInput = { organizationId, companyId, ...(f.status ? { status: f.status } : {}), ...(f.sentiment ? { sentiment: f.sentiment } : {}), ...(f.q ? { text: { contains: f.q, mode: "insensitive" } } : {}) };
  const [total, data, counts] = await Promise.all([
    db().marketingEngagement.count({ where }),
    db().marketingEngagement.findMany({ where, orderBy: { postedAt: { sort: "desc", nulls: "last" } }, skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db().marketingEngagement.groupBy({ by: ["sentiment"], where: { organizationId, companyId, status: "NEW" }, _count: { _all: true } }),
  ]);
  return { total, pageSize: PAGE_SIZE, data, newBySentiment: Object.fromEntries(counts.map((c) => [c.sentiment ?? "neutral", c._count._all])) as Record<string, number> };
}

/** Pull comments on recently published posts (where the platform API allows). */
export async function syncComments(organizationId?: string, companyId?: string): Promise<number> {
  const targets = await db().marketingSocialPostTarget.findMany({
    where: { status: "PUBLISHED", providerPostId: { not: null }, publishedAt: { gte: new Date(Date.now() - 14 * 86_400_000) }, ...(companyId ? { organizationId, companyId } : {}) },
    include: { account: true },
    take: 60,
    orderBy: { publishedAt: "desc" },
  });
  let n = 0;
  for (const t of targets) {
    if (!COMMENTS_SUPPORTED[t.account.provider]) continue;
    const conn = await getMarketingConnection(t.organizationId, t.companyId, SOCIAL_PROVIDER_KEYS[t.account.provider]);
    if (!isUsable(conn)) continue;
    try {
      const comments = await fetchComments(t.account.provider, conn, t.providerPostId!);
      for (const c of comments) {
        if (!c.text.trim()) continue;
        const r = await db().marketingEngagement.createMany({
          data: [{ organizationId: t.organizationId, companyId: t.companyId, accountId: t.accountId, targetId: t.id, provider: t.account.provider, externalId: c.externalId.slice(0, 300), authorName: c.authorName?.slice(0, 200) ?? null, text: c.text.slice(0, 5000), sentiment: sentimentOf(c.text), postedAt: c.postedAt }],
          skipDuplicates: true,
        });
        n += r.count;
      }
    } catch (err) {
      logger.warn({ targetId: t.id, reason: err instanceof ProviderError ? err.reason : "error" }, "comment sync failed");
    }
  }
  return n;
}

export async function syncCommentsNow(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  return { synced: await syncComments(organizationId, companyId) };
}

export async function engagementAction(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof engagementActionInput>) {
  const input = engagementActionInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  if (!isUuid(id)) throw notFound("Comment");
  const e = await db().marketingEngagement.findFirst({ where: { id, organizationId, companyId } });
  if (!e) throw notFound("Comment");
  if (input.action === "ai_draft") {
    return createTask(ctx, organizationId, companyId, {
      profile: "social_media_manager",
      title: `Reply draft: ${e.provider} comment`,
      instructions: `Draft a reply to this ${e.provider} comment${e.authorName ? ` from ${e.authorName}` : ""} (sentiment: ${e.sentiment ?? "unknown"}):\n"""\n${e.text.slice(0, 2000)}\n"""\nBe helpful, brief (≤ 280 characters for X), human and on-brand. If it is a complaint, acknowledge it and offer a next step without promising refunds or facts you cannot verify. Return ONLY the reply text.\n\n${await brandContextFor(companyId)}`.slice(0, 8000),
      subject: { type: "marketing_engagement", id: e.id },
    });
  }
  await db().marketingEngagement.update({ where: { id }, data: { status: input.action === "ignore" ? "IGNORED" : "NEW" } });
  return { ok: true };
}

/** Save a reply draft (from a person or a completed AI task). */
export async function saveReplyDraft(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof replyDraftInput> & { taskId?: string }) {
  let text = raw.text;
  if (raw.taskId) {
    const task = await getTask(ctx, organizationId, companyId, raw.taskId);
    if (task.subjectType !== "marketing_engagement" || task.subjectId !== id || task.status !== "COMPLETED" || !task.output) throw conflict("The AI task has not completed", { reason: "marketing_ai_not_completed" });
    text = task.output.trim().slice(0, 3000);
  }
  const input = replyDraftInput.parse({ text });
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingEngagement.updateMany({ where: { id, organizationId, companyId, status: { not: "REPLIED" } }, data: { replyDraft: input.text, status: "DRAFTED" } });
    if (!count) throw notFound("Comment");
    return { ok: true };
  });
}

/** Post the approved reply to the platform (called by the SUPERVISED HIGH tool after approval, or a manager directly). */
export async function sendReply(ctx: RequestContext, organizationId: string, companyId: string, id: string, text?: string) {
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const e = await db().marketingEngagement.findFirst({ where: { id, organizationId, companyId } });
  if (!e) throw notFound("Comment");
  if (e.status === "REPLIED") throw conflict("Already replied", { reason: "marketing_reply_done" });
  const body = (text ?? e.replyDraft ?? "").trim();
  if (!body) throw invalid("Write a reply first", { reason: "marketing_reply_empty" });
  const account = await db().marketingSocialAccount.findFirst({ where: { id: e.accountId } });
  const target = e.targetId ? await db().marketingSocialPostTarget.findFirst({ where: { id: e.targetId }, select: { providerPostId: true } }) : null;
  const conn = await getMarketingConnection(organizationId, companyId, SOCIAL_PROVIDER_KEYS[e.provider]);
  if (!isUsable(conn) || !account) throw conflict("The account is not connected", { reason: "marketing_reply_not_connected" });
  let externalId: string;
  try {
    externalId = await replyToComment(e.provider, conn, { postId: target?.providerPostId ?? "", commentId: e.externalId, text: body, externalId: account.externalId });
  } catch (err) {
    throw conflict(`The platform refused the reply (${err instanceof ProviderError ? err.message : "error"})`, { reason: "marketing_reply_failed" });
  }
  await transaction(async (tx) => {
    await tx.marketingEngagement.update({ where: { id }, data: { status: "REPLIED", replyText: body, replyExternalId: externalId, repliedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.engagement.replied", resourceType: "marketing_engagement", resourceId: id, newValue: { provider: e.provider, externalId } });
  });
  return { externalId };
}

// ───────────── Influencer CRM ─────────────

export const INFLUENCER_STATUSES = ["PROSPECT", "CONTACTED", "NEGOTIATING", "ACTIVE", "DECLINED"] as const;
export const influencerInput = z.object({
  name: z.string().trim().min(1).max(200),
  platform: z.string().trim().min(1).max(40),
  handle: z.string().trim().max(120).optional(),
  profileUrl: z.string().trim().url().max(2000).optional().or(z.literal("")),
  email: z.string().trim().email().max(320).optional().or(z.literal("")),
  followers: z.number().int().min(0).max(2_000_000_000).optional(),
  niche: z.string().trim().max(200).optional(),
  status: z.enum(INFLUENCER_STATUSES).optional(),
  notes: z.string().trim().max(5000).optional(),
  outreachSubject: z.string().trim().max(250).optional(),
  outreachDraft: z.string().trim().max(10_000).optional(),
});
export const updateInfluencerInput = influencerInput.partial();

export function parseInfluencerFilters(raw: Record<string, string | string[] | undefined>) {
  return { status: enumParam(raw, "status", INFLUENCER_STATUSES), q: param(raw, "q"), page: pageParam(raw) };
}

export async function listInfluencers(ctx: RequestContext, organizationId: string, companyId: string, f: ReturnType<typeof parseInfluencerFilters>) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const where: Prisma.MarketingInfluencerWhereInput = { organizationId, companyId, archivedAt: null, ...(f.status ? { status: f.status } : {}), ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { handle: { contains: f.q, mode: "insensitive" } }, { niche: { contains: f.q, mode: "insensitive" } }] } : {}) };
  const [total, data] = await Promise.all([db().marketingInfluencer.count({ where }), db().marketingInfluencer.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE })]);
  return { total, pageSize: PAGE_SIZE, data };
}

const clean = (i: Partial<z.infer<typeof influencerInput>>) => ({
  ...i,
  handle: i.handle === undefined ? undefined : i.handle || null,
  profileUrl: i.profileUrl === undefined ? undefined : i.profileUrl || null,
  email: i.email === undefined ? undefined : i.email || null,
});

export async function createInfluencer(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof influencerInput>) {
  const input = influencerInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const r = await tx.marketingInfluencer.create({ data: { ...clean(input), name: input.name, platform: input.platform, organizationId, companyId, createdById: actorId(ctx, organizationId) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.influencer.created", resourceType: "marketing_influencer", resourceId: r.id, newValue: { name: r.name } });
    return r;
  });
}

export async function updateInfluencer(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateInfluencerInput>) {
  const input = updateInfluencerInput.parse(raw);
  if (!isUuid(id)) throw notFound("Influencer");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingInfluencer.updateMany({ where: { id, organizationId, companyId, archivedAt: null }, data: { ...clean(input), ...(input.outreachDraft !== undefined ? { outreachStatus: "DRAFT" } : {}) } });
    if (!count) throw notFound("Influencer");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.influencer.updated", resourceType: "marketing_influencer", resourceId: id, newValue: { status: input.status } });
    return { ok: true };
  });
}

export async function archiveInfluencer(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Influencer");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingInfluencer.updateMany({ where: { id, organizationId, companyId, archivedAt: null }, data: { archivedAt: new Date() } });
    if (!count) throw notFound("Influencer");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.influencer.archived", resourceType: "marketing_influencer", resourceId: id });
    return { ok: true };
  });
}

export async function requestOutreachDraft(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const r = await db().marketingInfluencer.findFirst({ where: { id, organizationId, companyId, archivedAt: null } });
  if (!r) throw notFound("Influencer");
  return createTask(ctx, organizationId, companyId, {
    profile: "growth_manager",
    title: `Outreach draft: ${r.name}`,
    instructions: `Draft a short, personal outreach email to the creator ${r.name} (${r.platform}${r.handle ? ` ${r.handle}` : ""}${r.niche ? `, niche: ${r.niche}` : ""}${r.followers ? `, ${r.followers} followers` : ""}) proposing a collaboration that fits the company's products. Be specific, respectful, no exaggerated claims; propose a simple next step. Return ONLY a JSON object: {"subject": string, "body": string}\n\n${await brandContextFor(companyId)}`.slice(0, 8000),
    subject: { type: "marketing_influencer", id: r.id },
  });
}

/** Send the outreach email (SUPERVISED HIGH tool after approval). Recorded as sent only when the email provider accepted it. */
export async function sendOutreach(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const r = await db().marketingInfluencer.findFirst({ where: { id, organizationId, companyId, archivedAt: null } });
  if (!r) throw notFound("Influencer");
  if (!r.email || !r.outreachDraft || !r.outreachSubject) throw invalid("Add an email address, subject and message first", { reason: "marketing_outreach_incomplete" });
  const res = await sendPlainEmail({ to: r.email, subject: r.outreachSubject, text: r.outreachDraft, template: "marketing_outreach", organizationId, userId: ctx.actor.id, locale: "en-US" });
  const ok = res.status === "SENT";
  await transaction(async (tx) => {
    await tx.marketingInfluencer.update({ where: { id }, data: { outreachStatus: ok ? "SENT" : "FAILED", ...(ok ? { lastContactAt: new Date(), status: r.status === "PROSPECT" ? "CONTACTED" : r.status } : {}) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.influencer.outreach", resourceType: "marketing_influencer", resourceId: id, newValue: { status: res.status } });
  });
  if (!ok) throw conflict(`The email was not sent (${res.status})`, { reason: res.status === "NOT_CONFIGURED" ? "marketing_email_not_configured" : "marketing_outreach_failed" });
  return { ok: true };
}

/** UI entry: file an approval request to send the outreach (never sends directly). */
export async function requestOutreachSend(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const r = await db().marketingInfluencer.findFirst({ where: { id, organizationId, companyId, archivedAt: null }, select: { id: true, email: true, outreachDraft: true } });
  if (!r) throw notFound("Influencer");
  if (!r.email || !r.outreachDraft) throw invalid("Add an email address and message first", { reason: "marketing_outreach_incomplete" });
  const { requestTool } = await import("@/server/modules/tools/gateway");
  const res = await requestTool("send_influencer_outreach", { influencerId: id }, { ctx, organizationId, companyId, allowedTools: ["send_influencer_outreach"], profileKey: "growth_manager", taskId: null });
  if (res.status === "approval_requested") await db().marketingInfluencer.update({ where: { id }, data: { outreachStatus: "PENDING_APPROVAL" } });
  return res.status === "approval_requested" ? { approvalId: res.approvalId } : { done: true };
}

export async function applyOutreachDraft(ctx: RequestContext, organizationId: string, companyId: string, id: string, taskId: string) {
  const task = await getTask(ctx, organizationId, companyId, taskId);
  if (task.subjectType !== "marketing_influencer" || task.subjectId !== id || task.status !== "COMPLETED" || !task.output) throw conflict("The AI task has not completed", { reason: "marketing_ai_not_completed" });
  const { extractJson } = await import("./ai");
  const parsed = z.object({ subject: z.string().min(1).max(250), body: z.string().min(1).max(10_000) }).safeParse(extractJson(task.output));
  if (!parsed.success) throw invalid("The AI output could not be read", { reason: "marketing_ai_output_unparseable" });
  return updateInfluencer(ctx, organizationId, companyId, id, { outreachSubject: parsed.data.subject, outreachDraft: parsed.data.body });
}

export const idInput = z.object({ id: uuid });
