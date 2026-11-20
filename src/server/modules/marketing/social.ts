import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { MarketingSocialPostStatus, MarketingSocialProvider } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { actorId, authorize, enumParam, instant, isUuid, PAGE_SIZE, pageParam, param, requireOwned, toInstant, uuid } from "./common";
import { getMarketingConnection, isUsable, SOCIAL_PROVIDER_KEYS } from "./connections-bridge";
import { fetchMetrics, ProviderError, publishTo, TEXT_LIMITS } from "./social-providers";
import { markContentPublished } from "./content";

export const SOCIAL_PROVIDERS = ["LINKEDIN", "X", "INSTAGRAM", "FACEBOOK"] as const;
export const POST_STATUSES = ["DRAFT", "SCHEDULED", "PUBLISHING", "PUBLISHED", "PARTIAL", "FAILED", "CANCELLED"] as const;

export const accountInput = z.object({
  provider: z.enum(SOCIAL_PROVIDERS),
  name: z.string().trim().min(1).max(120),
  handle: z.string().trim().max(120).optional(),
  externalId: z.string().trim().max(200).optional(),
});
export const updateAccountInput = accountInput.omit({ provider: true }).partial();

const target = z.object({ accountId: uuid, text: z.string().max(70_000).nullable().optional() });
const mediaUrl = z.string().trim().url().max(2000).refine((u) => /^https:\/\//i.test(u), "https only").optional().or(z.literal(""));
export const postInput = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().max(70_000).default(""),
  mediaUrl,
  campaignId: uuid.or(z.literal("")).nullable().optional(),
  contentId: uuid.or(z.literal("")).nullable().optional(),
  targets: z.array(target).min(1).max(20),
  /** Set to schedule right away; omit to save a draft. */
  scheduledAt: instant.optional().or(z.literal("")),
});
export const updatePostInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  text: z.string().max(70_000).optional(),
  mediaUrl,
  campaignId: uuid.or(z.literal("")).nullable().optional(),
  targets: z.array(target).min(1).max(20).optional(),
});
export const postActionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("schedule"), scheduledAt: instant }),
  z.object({ action: z.literal("publish_now") }),
  z.object({ action: z.literal("unschedule") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("retry") }),
  z.object({ action: z.literal("refresh_metrics") }),
]);
export const distributeInput = z.object({ accountIds: z.array(uuid).min(1).max(20), scheduledAt: instant.optional().or(z.literal("")) });

export interface PostFilters {
  q?: string;
  status?: MarketingSocialPostStatus;
  page: number;
}
export function parsePostFilters(raw: Record<string, string | string[] | undefined>): PostFilters {
  return { q: param(raw, "q"), status: enumParam(raw, "status", POST_STATUSES), page: pageParam(raw) };
}

/** Connection state per provider (via the Integrations bridge). Never exposes tokens. */
export async function connectionStatus(organizationId: string, companyId: string) {
  const entries = await Promise.all(
    SOCIAL_PROVIDERS.map(async (p) => [p, isUsable(await getMarketingConnection(organizationId, companyId, SOCIAL_PROVIDER_KEYS[p]))] as const),
  );
  return Object.fromEntries(entries) as Record<MarketingSocialProvider, boolean>;
}

export async function listAccounts(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const [accounts, connected] = await Promise.all([
    db().marketingSocialAccount.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: [{ provider: "asc" }, { name: "asc" }] }),
    connectionStatus(organizationId, companyId),
  ]);
  return { accounts: accounts.map((a) => ({ ...a, connected: connected[a.provider] })), connected };
}

export async function createAccount(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof accountInput>) {
  const input = accountInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const a = await tx.marketingSocialAccount.create({ data: { organizationId, companyId, provider: input.provider, name: input.name, handle: input.handle || null, externalId: input.externalId || null, createdById: actorId(ctx, organizationId) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.social_account.created", resourceType: "marketing_social_account", resourceId: a.id, newValue: { provider: a.provider, name: a.name } });
    return a;
  });
}

export async function updateAccount(ctx: RequestContext, organizationId: string, companyId: string, accountId: string, raw: z.input<typeof updateAccountInput>) {
  const input = updateAccountInput.parse(raw);
  if (!isUuid(accountId)) throw notFound("Account");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const data: Prisma.MarketingSocialAccountUpdateManyMutationInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.handle !== undefined) data.handle = input.handle || null;
    if (input.externalId !== undefined) data.externalId = input.externalId || null;
    const { count } = await tx.marketingSocialAccount.updateMany({ where: { id: accountId, organizationId, companyId, archivedAt: null }, data });
    if (!count) throw notFound("Account");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.social_account.updated", resourceType: "marketing_social_account", resourceId: accountId, newValue: input });
    return { ok: true };
  });
}

export async function archiveAccount(ctx: RequestContext, organizationId: string, companyId: string, accountId: string) {
  if (!isUuid(accountId)) throw notFound("Account");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingSocialAccount.updateMany({ where: { id: accountId, organizationId, companyId, archivedAt: null }, data: { archivedAt: new Date() } });
    if (!count) throw notFound("Account");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.social_account.archived", resourceType: "marketing_social_account", resourceId: accountId });
    return { ok: true };
  });
}

export async function listPosts(ctx: RequestContext, organizationId: string, companyId: string, f: PostFilters = { page: 1 }) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const where: Prisma.MarketingSocialPostWhereInput = { organizationId, companyId };
  if (f.status) where.status = f.status;
  if (f.q) where.OR = [{ title: { contains: f.q, mode: "insensitive" } }, { text: { contains: f.q, mode: "insensitive" } }];
  const [total, data] = await Promise.all([
    db().marketingSocialPost.count({ where }),
    db().marketingSocialPost.findMany({
      where,
      orderBy: [{ scheduledAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { targets: { select: { id: true, status: true, likes: true, comments: true, shares: true, impressions: true, account: { select: { provider: true, name: true } } } } },
    }),
  ]);
  return { total, pageSize: PAGE_SIZE, data };
}

export async function getPost(ctx: RequestContext, organizationId: string, companyId: string, postId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  if (!isUuid(postId)) throw notFound("Post");
  const p = await db().marketingSocialPost.findFirst({
    where: { id: postId, organizationId, companyId },
    include: {
      campaign: { select: { id: true, name: true, code: true } },
      content: { select: { id: true, title: true } },
      targets: { include: { account: true, snapshots: { orderBy: { capturedAt: "desc" }, take: 10 } } },
    },
  });
  if (!p) throw notFound("Post");
  return { post: p, connected: await connectionStatus(organizationId, companyId) };
}

type TargetIn = { accountId: string; text?: string | null };

async function validTargets(tx: Tx, companyId: string, targets: TargetIn[]) {
  const ids = [...new Set(targets.map((t) => t.accountId))];
  const accounts = await tx.marketingSocialAccount.findMany({ where: { companyId, id: { in: ids }, archivedAt: null } });
  if (accounts.length !== ids.length) throw notFound("Account");
  return accounts;
}

/** Text and media rules per platform; checked before anything is queued. */
function checkPublishable(post: { text: string; mediaUrl: string | null }, targets: { text: string | null; account: { provider: MarketingSocialProvider; name: string } }[]) {
  for (const t of targets) {
    const text = t.text ?? post.text;
    if (!text.trim() && !post.mediaUrl) throw invalid("Post text is empty", { reason: "marketing_post_empty", account: t.account.name });
    if (text.length > TEXT_LIMITS[t.account.provider]) throw invalid("Text too long for this platform", { reason: "marketing_post_too_long", account: t.account.name, limit: TEXT_LIMITS[t.account.provider] });
    if (t.account.provider === "INSTAGRAM" && !post.mediaUrl) throw invalid("Instagram needs an image", { reason: "marketing_post_media_required" });
  }
}

/** Create a post (draft, or scheduled when `scheduledAt` is given). Also used by content distribution and the AI tool. */
export async function createPost(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof postInput>) {
  const input = postInput.parse(raw);
  const scheduledAt = toInstant(input.scheduledAt || null);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const accounts = await validTargets(tx, companyId, input.targets);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const targets = input.targets.map((t) => ({ accountId: t.accountId, text: t.text?.trim() ? t.text : null, account: byId.get(t.accountId)! }));
    if (scheduledAt) checkPublishable({ text: input.text, mediaUrl: input.mediaUrl || null }, targets);
    const p = await tx.marketingSocialPost.create({
      data: {
        organizationId,
        companyId,
        title: input.title,
        text: input.text,
        mediaUrl: input.mediaUrl || null,
        campaignId: await requireOwned(tx, "marketingCampaign", companyId, input.campaignId || null, "Campaign"),
        contentId: await requireOwned(tx, "marketingContent", companyId, input.contentId || null, "Content"),
        status: scheduledAt ? "SCHEDULED" : "DRAFT",
        scheduledAt,
        createdById: actorId(ctx, organizationId),
        targets: { create: targets.map((t) => ({ organizationId, companyId, accountId: t.accountId, text: t.text })) },
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.social_post.created", resourceType: "marketing_social_post", resourceId: p.id, newValue: { title: p.title, status: p.status, scheduledAt, targets: targets.length } });
    return p;
  });
}

export async function updatePost(ctx: RequestContext, organizationId: string, companyId: string, postId: string, raw: z.input<typeof updatePostInput>) {
  const input = updatePostInput.parse(raw);
  if (!isUuid(postId)) throw notFound("Post");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const p = await tx.marketingSocialPost.findFirst({ where: { id: postId, organizationId, companyId }, include: { targets: { include: { account: true } } } });
    if (!p) throw notFound("Post");
    if (!["DRAFT", "SCHEDULED", "FAILED"].includes(p.status)) throw conflict("This post can no longer be edited", { reason: "marketing_post_locked" });
    const data: Prisma.MarketingSocialPostUncheckedUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.text !== undefined) data.text = input.text;
    if (input.mediaUrl !== undefined) data.mediaUrl = input.mediaUrl || null;
    if (input.campaignId !== undefined) data.campaignId = await requireOwned(tx, "marketingCampaign", companyId, input.campaignId || null, "Campaign");
    let targets = p.targets.map((t) => ({ accountId: t.accountId, text: t.text, account: t.account }));
    if (input.targets) {
      const accounts = await validTargets(tx, companyId, input.targets);
      const byId = new Map(accounts.map((a) => [a.id, a]));
      targets = input.targets.map((t) => ({ accountId: t.accountId, text: t.text?.trim() ? t.text : null, account: byId.get(t.accountId)! }));
      await tx.marketingSocialPostTarget.deleteMany({ where: { postId, companyId } });
      await tx.marketingSocialPostTarget.createMany({ data: targets.map((t) => ({ organizationId, companyId, postId, accountId: t.accountId, text: t.text })) });
    }
    if (p.status === "SCHEDULED") checkPublishable({ text: (data.text as string | undefined) ?? p.text, mediaUrl: data.mediaUrl !== undefined ? (data.mediaUrl as string | null) : p.mediaUrl }, targets);
    if (p.status === "FAILED") data.status = "DRAFT";
    const updated = await tx.marketingSocialPost.update({ where: { id: postId }, data });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.social_post.updated", resourceType: "marketing_social_post", resourceId: postId, newValue: { title: input.title, targets: input.targets?.length } });
    return updated;
  });
}

export async function deletePost(ctx: RequestContext, organizationId: string, companyId: string, postId: string) {
  if (!isUuid(postId)) throw notFound("Post");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const p = await tx.marketingSocialPost.findFirst({ where: { id: postId, organizationId, companyId }, select: { status: true, title: true } });
    if (!p) throw notFound("Post");
    if (!["DRAFT", "CANCELLED", "FAILED"].includes(p.status)) throw conflict("Only drafts, cancelled or failed posts can be deleted", { reason: "marketing_post_locked" });
    await tx.marketingSocialPost.delete({ where: { id: postId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.social_post.deleted", resourceType: "marketing_social_post", resourceId: postId, oldValue: { title: p.title } });
    return { ok: true };
  });
}

export async function postAction(ctx: RequestContext, organizationId: string, companyId: string, postId: string, raw: z.input<typeof postActionInput>) {
  const input = postActionInput.parse(raw);
  if (!isUuid(postId)) throw notFound("Post");
  if (input.action === "refresh_metrics") {
    await authorize(ctx, organizationId, companyId, "marketing.manage");
    const p = await db().marketingSocialPost.findFirst({ where: { id: postId, organizationId, companyId }, select: { id: true } });
    if (!p) throw notFound("Post");
    return { refreshed: await refreshPostMetrics(postId) };
  }
  const result = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const p = await tx.marketingSocialPost.findFirst({ where: { id: postId, organizationId, companyId }, include: { targets: { include: { account: true } } } });
    if (!p) throw notFound("Post");
    const bad = () => conflict(`Cannot ${input.action} a ${p.status} post`, { reason: "marketing_invalid_transition" });
    let data: Prisma.MarketingSocialPostUncheckedUpdateInput;
    switch (input.action) {
      case "schedule":
      case "publish_now": {
        if (p.status !== "DRAFT" && p.status !== "SCHEDULED") throw bad();
        checkPublishable(p, p.targets);
        const at = input.action === "schedule" ? toInstant(input.scheduledAt) : new Date();
        if (!at) throw invalid("Invalid date");
        data = { status: "SCHEDULED", scheduledAt: at };
        break;
      }
      case "unschedule":
        if (p.status !== "SCHEDULED") throw bad();
        data = { status: "DRAFT", scheduledAt: null };
        break;
      case "cancel":
        if (p.status !== "DRAFT" && p.status !== "SCHEDULED") throw bad();
        data = { status: "CANCELLED" };
        break;
      case "retry":
        if (p.status !== "FAILED" && p.status !== "PARTIAL") throw bad();
        await tx.marketingSocialPostTarget.updateMany({ where: { postId, status: "FAILED" }, data: { status: "PENDING", error: null } });
        data = { status: "SCHEDULED", scheduledAt: new Date() };
        break;
    }
    const updated = await tx.marketingSocialPost.update({ where: { id: postId }, data });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `marketing.social_post.${input.action}`, resourceType: "marketing_social_post", resourceId: postId, oldValue: { status: p.status }, newValue: { status: updated.status, scheduledAt: updated.scheduledAt } });
    return updated;
  });
  if ((input.action === "publish_now" || input.action === "retry") && result.status === "SCHEDULED") await processPost(postId);
  return db().marketingSocialPost.findUniqueOrThrow({ where: { id: postId } });
}

/** Create a post from approved content for the selected accounts (content distribution). */
export async function distributeContent(ctx: RequestContext, organizationId: string, companyId: string, contentId: string, raw: z.input<typeof distributeInput>) {
  const input = distributeInput.parse(raw);
  if (!isUuid(contentId)) throw notFound("Content");
  const c = await db().marketingContent.findFirst({ where: { id: contentId, organizationId, companyId, archivedAt: null } });
  if (!c) throw notFound("Content");
  if (!["APPROVED", "SCHEDULED", "PUBLISHED"].includes(c.status)) throw conflict("Only approved content can be distributed", { reason: "marketing_content_not_approved" });
  return createPost(ctx, organizationId, companyId, {
    title: c.title,
    text: c.body,
    contentId: c.id,
    campaignId: c.campaignId,
    targets: input.accountIds.map((accountId) => ({ accountId })),
    scheduledAt: input.scheduledAt || (c.status === "SCHEDULED" && c.scheduledAt ? c.scheduledAt.toISOString() : undefined),
  });
}

/**
 * Publish a due post through each target's provider. A target is PUBLISHED only with a provider post id; a missing
 * connection fails it with `not_connected`. The post ends PUBLISHED, PARTIAL or FAILED.
 */
export async function processPost(postId: string): Promise<number> {
  const claimed = await db().marketingSocialPost.updateMany({ where: { id: postId, status: "SCHEDULED", scheduledAt: { lte: new Date() } }, data: { status: "PUBLISHING" } });
  if (!claimed.count) return 0;
  const post = await db().marketingSocialPost.findUniqueOrThrow({ where: { id: postId }, include: { targets: { include: { account: true } } } });
  const connections = new Map<MarketingSocialProvider, Awaited<ReturnType<typeof getMarketingConnection>>>();
  let published = 0;
  for (const t of post.targets) {
    if (t.status === "PUBLISHED") continue;
    const provider = t.account.provider;
    if (!connections.has(provider)) connections.set(provider, await getMarketingConnection(post.organizationId, post.companyId, SOCIAL_PROVIDER_KEYS[provider]));
    const conn = connections.get(provider) ?? null;
    if (t.account.archivedAt || !isUsable(conn)) {
      await db().marketingSocialPostTarget.update({ where: { id: t.id }, data: { status: "FAILED", error: t.account.archivedAt ? "account_archived" : "not_connected", attempts: { increment: 1 } } });
      continue;
    }
    try {
      const r = await publishTo(provider, conn, { text: t.text ?? post.text, mediaUrl: post.mediaUrl, externalId: t.account.externalId });
      await db().marketingSocialPostTarget.update({ where: { id: t.id }, data: { status: "PUBLISHED", providerPostId: r.providerPostId, providerUrl: r.url, error: null, publishedAt: new Date(), attempts: { increment: 1 } } });
      published++;
    } catch (err) {
      const reason = err instanceof ProviderError ? err.reason : "provider_error";
      const detail = err instanceof Error ? err.message.slice(0, 300) : "";
      logger.warn({ postId, targetId: t.id, provider, reason }, "social publish failed");
      await db().marketingSocialPostTarget.update({ where: { id: t.id }, data: { status: "FAILED", error: detail && detail !== reason ? `${reason}: ${detail}` : reason, attempts: { increment: 1 } } });
    }
  }
  const targets = await db().marketingSocialPostTarget.findMany({ where: { postId }, select: { status: true } });
  const ok = targets.filter((t) => t.status === "PUBLISHED").length;
  const status: MarketingSocialPostStatus = ok === targets.length ? "PUBLISHED" : ok > 0 ? "PARTIAL" : "FAILED";
  const ctx = systemContext();
  await transaction(async (tx) => {
    await tx.marketingSocialPost.update({ where: { id: postId }, data: { status, ...(ok ? { publishedAt: post.publishedAt ?? new Date() } : {}) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId: post.organizationId, action: "marketing.social_post.processed", resourceType: "marketing_social_post", resourceId: postId, newValue: { status, published: ok, total: targets.length } });
    if (ok && post.contentId) {
      const content = await tx.marketingContent.findFirst({ where: { id: post.contentId, companyId: post.companyId } });
      if (content && content.status !== "PUBLISHED") {
        const url = (await tx.marketingSocialPostTarget.findFirst({ where: { postId, status: "PUBLISHED", providerUrl: { not: null } }, select: { providerUrl: true } }))?.providerUrl ?? null;
        await markContentPublished(tx, ctx, content, url);
      }
    }
    await notifyUsers(tx, post.organizationId, [post.createdById], status === "PUBLISHED" ? "marketing.post_published" : "marketing.post_failed", { companyId: post.companyId, title: post.title, href: `/marketing/social/${postId}` });
  });
  return published;
}

export async function processDuePosts(): Promise<number> {
  const due = await db().marketingSocialPost.findMany({ where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } }, select: { id: true }, orderBy: { scheduledAt: "asc" }, take: 25 });
  let n = 0;
  for (const p of due) n += await processPost(p.id);
  return n;
}

/** Fetch metrics for a post's published targets and store snapshots (where the provider API allows). */
export async function refreshPostMetrics(postId: string): Promise<number> {
  const targets = await db().marketingSocialPostTarget.findMany({ where: { postId, status: "PUBLISHED", providerPostId: { not: null } }, include: { account: true } });
  let n = 0;
  for (const t of targets) {
    const conn = await getMarketingConnection(t.organizationId, t.companyId, SOCIAL_PROVIDER_KEYS[t.account.provider]);
    if (!isUsable(conn)) continue;
    try {
      const m = await fetchMetrics(t.account.provider, conn, t.providerPostId!);
      const values = { impressions: m.impressions ?? null, likes: m.likes ?? null, comments: m.comments ?? null, shares: m.shares ?? null, clicks: m.clicks ?? null };
      await db().$transaction([
        db().marketingSocialPostTarget.update({ where: { id: t.id }, data: { ...values, metricsAt: new Date() } }),
        db().marketingSocialMetricSnapshot.create({ data: { organizationId: t.organizationId, companyId: t.companyId, targetId: t.id, ...values } }),
      ]);
      n++;
    } catch (err) {
      logger.warn({ targetId: t.id, reason: err instanceof ProviderError ? err.reason : "provider_error" }, "social metrics fetch failed");
    }
  }
  return n;
}

/** Worker: refresh metrics of posts published in the last 30 days, at most every 6 hours each. */
export async function refreshDueMetrics(): Promise<number> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const stale = new Date(Date.now() - 6 * 3_600_000);
  const posts = await db().marketingSocialPost.findMany({
    where: { publishedAt: { gte: since }, targets: { some: { status: "PUBLISHED", OR: [{ metricsAt: null }, { metricsAt: { lt: stale } }] } } },
    select: { id: true },
    take: 20,
  });
  let n = 0;
  for (const p of posts) n += await refreshPostMetrics(p.id);
  return n;
}
