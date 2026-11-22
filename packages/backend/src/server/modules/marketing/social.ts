import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { MarketingSocialPostStatus, MarketingSocialProvider } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { actorId, authorize, enumParam, instant, isUuid, PAGE_SIZE, pageParam, param, requireOwned, toInstant, uuid } from "./common";
import { sha256 } from "@/server/core/crypto";
import { connectionAccounts, getMarketingConnection, isUsable, SOCIAL_PROVIDER_KEYS } from "./connections-bridge";
import { checkPending, fetchMetrics, MEDIA_REQUIRED, ProviderError, publishTo, TEXT_LIMITS, type PublishResult } from "./social-providers";
import { isTransient } from "./providers/http";
import { assetMedia, assetPublicUrl } from "./assets";
import { markContentPublished } from "./content";
import { assertLimit } from "@/server/modules/entitlements/service";

export const SOCIAL_PROVIDERS = ["LINKEDIN", "X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK", "THREADS", "PINTEREST"] as const;
export const MAX_PUBLISH_ATTEMPTS = 5;
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
  mediaAssetId: uuid.or(z.literal("")).nullable().optional(),
  hashtags: z.array(z.string().trim().regex(/^#?[\p{L}\p{N}_]{1,60}$/u)).max(30).optional(),
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
  mediaAssetId: uuid.or(z.literal("")).nullable().optional(),
  hashtags: z.array(z.string().trim().regex(/^#?[\p{L}\p{N}_]{1,60}$/u)).max(30).optional(),
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

/** Sub-accounts (pages, boards, channels, organizations) each connected provider exposes in connection.config.accounts. */
export async function accountChoices(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const entries = await Promise.all(SOCIAL_PROVIDERS.map(async (p) => [p, connectionAccounts(await getMarketingConnection(organizationId, companyId, SOCIAL_PROVIDER_KEYS[p]))] as const));
  return Object.fromEntries(entries) as Record<MarketingSocialProvider, { id: string; name: string }[]>;
}

export async function createAccount(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof accountInput>) {
  const input = accountInput.parse(raw);
  await assertLimit(ctx, organizationId, "channels.max", 1);
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
      mediaAsset: { select: { id: true, name: true, kind: true, url: true, mimeType: true, sizeBytes: true, status: true } },
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
export function withHashtags(text: string, hashtags: string[]) {
  const tags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).filter((h) => !text.includes(h));
  return tags.length ? `${text.trimEnd()}\n\n${tags.join(" ")}` : text;
}

function checkPublishable(
  post: { text: string; mediaUrl: string | null; mediaAssetId?: string | null; hashtags?: string[] },
  targets: { text: string | null; account: { provider: MarketingSocialProvider; name: string } }[],
  mediaKind?: "IMAGE" | "VIDEO" | "LOGO" | "DOCUMENT" | null,
) {
  const hasMedia = !!post.mediaUrl || !!post.mediaAssetId;
  for (const t of targets) {
    const text = withHashtags(t.text ?? post.text, post.hashtags ?? []);
    if (!text.trim() && !hasMedia) throw invalid("Post text is empty", { reason: "marketing_post_empty", account: t.account.name });
    if (text.length > TEXT_LIMITS[t.account.provider]) throw invalid("Text too long for this platform", { reason: "marketing_post_too_long", account: t.account.name, limit: TEXT_LIMITS[t.account.provider] });
    const need = MEDIA_REQUIRED[t.account.provider];
    if (need && !hasMedia) throw invalid("This platform needs media", { reason: "marketing_post_media_required", account: t.account.name });
    if (need === "video" && mediaKind && mediaKind !== "VIDEO") throw invalid("This platform needs a video", { reason: "marketing_post_video_required", account: t.account.name });
    if (need === "video" && !post.mediaAssetId) throw invalid("Upload the video to the media library first", { reason: "marketing_post_video_required", account: t.account.name });
  }
}

async function mediaKindOf(tx: Tx, companyId: string, id: string | null | undefined) {
  if (!id) return null;
  const a = await tx.marketingAsset.findFirst({ where: { id, companyId, archivedAt: null }, select: { kind: true, status: true } });
  if (!a) throw notFound("Asset");
  if (a.status !== "READY") throw conflict("The media is not ready yet", { reason: "marketing_asset_not_ready" });
  return a.kind;
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
    const mediaKind = await mediaKindOf(tx, companyId, input.mediaAssetId || null);
    if (scheduledAt) checkPublishable({ text: input.text, mediaUrl: input.mediaUrl || null, mediaAssetId: input.mediaAssetId || null, hashtags: input.hashtags }, targets, mediaKind);
    const p = await tx.marketingSocialPost.create({
      data: {
        organizationId,
        companyId,
        title: input.title,
        text: input.text,
        mediaUrl: input.mediaUrl || null,
        mediaAssetId: input.mediaAssetId || null,
        hashtags: (input.hashtags ?? []).map((h) => (h.startsWith("#") ? h : `#${h}`)),
        campaignId: await requireOwned(tx, "marketingCampaign", companyId, input.campaignId || null, "Campaign"),
        contentId: await requireOwned(tx, "marketingContent", companyId, input.contentId || null, "Content"),
        status: scheduledAt ? "SCHEDULED" : "DRAFT",
        scheduledAt,
        createdById: actorId(ctx, organizationId),
        // companyId comes from the post (composite relation [postId, companyId]); passing it here is rejected by Prisma.
        targets: { create: targets.map((t) => ({ organizationId, accountId: t.accountId, text: t.text })) },
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
    if (input.mediaAssetId !== undefined) {
      await mediaKindOf(tx, companyId, input.mediaAssetId || null);
      data.mediaAssetId = input.mediaAssetId || null;
    }
    if (input.hashtags !== undefined) data.hashtags = input.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`));
    if (input.campaignId !== undefined) data.campaignId = await requireOwned(tx, "marketingCampaign", companyId, input.campaignId || null, "Campaign");
    let targets = p.targets.map((t) => ({ accountId: t.accountId, text: t.text, account: t.account }));
    if (input.targets) {
      const accounts = await validTargets(tx, companyId, input.targets);
      const byId = new Map(accounts.map((a) => [a.id, a]));
      targets = input.targets.map((t) => ({ accountId: t.accountId, text: t.text?.trim() ? t.text : null, account: byId.get(t.accountId)! }));
      await tx.marketingSocialPostTarget.deleteMany({ where: { postId, companyId } });
      await tx.marketingSocialPostTarget.createMany({ data: targets.map((t) => ({ organizationId, companyId, postId, accountId: t.accountId, text: t.text })) });
    }
    if (p.status === "SCHEDULED") {
      const mediaAssetId = data.mediaAssetId !== undefined ? (data.mediaAssetId as string | null) : p.mediaAssetId;
      checkPublishable(
        { text: (data.text as string | undefined) ?? p.text, mediaUrl: data.mediaUrl !== undefined ? (data.mediaUrl as string | null) : p.mediaUrl, mediaAssetId, hashtags: (data.hashtags as string[] | undefined) ?? p.hashtags },
        targets,
        await mediaKindOf(tx, companyId, mediaAssetId),
      );
    }
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
        checkPublishable(p, p.targets, await mediaKindOf(tx, companyId, p.mediaAssetId));
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
        await tx.marketingSocialPostTarget.updateMany({ where: { postId, status: "FAILED" }, data: { status: "PENDING", error: null, attempts: 0, nextAttemptAt: null, providerPostId: null } });
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

export const contentHashOf = (text: string, media: string | null) => sha256(`${text.replace(/\s+/g, " ").trim().toLowerCase()}|${media ?? ""}`);
const backoffMs = (attempts: number, retryAfter?: number) => (retryAfter ? retryAfter * 1000 : Math.min(6 * 3_600_000, 2 ** attempts * 60_000));

/**
 * Publish a due post through each target's provider. A target is PUBLISHED only with a provider post id (asynchronous
 * publishes are verified first). Missing connections fail with `not_connected`; the same text+media already published
 * on the account fails with `duplicate_content`; rate limits and transient errors retry with exponential backoff up to
 * MAX_PUBLISH_ATTEMPTS. The post ends PUBLISHED, PARTIAL or FAILED, or goes back to SCHEDULED while retries are pending.
 */
export async function processPost(postId: string): Promise<number> {
  const now = new Date();
  const claimed = await db().marketingSocialPost.updateMany({ where: { id: postId, status: "SCHEDULED", scheduledAt: { lte: now } }, data: { status: "PUBLISHING" } });
  if (!claimed.count) return 0;
  const post = await db().marketingSocialPost.findUniqueOrThrow({ where: { id: postId }, include: { targets: { include: { account: true } }, mediaAsset: { select: { id: true, kind: true, url: true, mimeType: true, sizeBytes: true, status: true } } } });
  const connections = new Map<MarketingSocialProvider, Awaited<ReturnType<typeof getMarketingConnection>>>();
  const mediaUrl = post.mediaAsset && post.mediaAsset.status === "READY" ? assetPublicUrl(post.mediaAsset) : post.mediaUrl;
  const mediaType = post.mediaAsset ? (post.mediaAsset.kind === "VIDEO" ? "video" : "image") : null;
  let mediaBytes: Awaited<ReturnType<typeof assetMedia>> | undefined;
  let published = 0;
  for (const t of post.targets) {
    if (t.status === "PUBLISHED" || t.status === "FAILED") continue;
    if (t.nextAttemptAt && t.nextAttemptAt > now) continue;
    const provider = t.account.provider;
    if (!connections.has(provider)) connections.set(provider, await getMarketingConnection(post.organizationId, post.companyId, SOCIAL_PROVIDER_KEYS[provider]));
    const conn = connections.get(provider) ?? null;
    if (t.account.archivedAt || !isUsable(conn)) {
      await db().marketingSocialPostTarget.update({ where: { id: t.id }, data: { status: "FAILED", error: t.account.archivedAt ? "account_archived" : "not_connected", attempts: { increment: 1 }, nextAttemptAt: null } });
      continue;
    }
    const text = withHashtags(t.text ?? post.text, post.hashtags);
    const hash = contentHashOf(text, post.mediaAssetId ?? post.mediaUrl);
    try {
      let r: PublishResult | null;
      if (t.providerPostId) {
        // An asynchronous publish was accepted earlier: verify it.
        r = await checkPending(provider, conn, t.providerPostId, t.account.externalId);
        if (!r) {
          await db().marketingSocialPostTarget.update({ where: { id: t.id }, data: { nextAttemptAt: new Date(Date.now() + 60_000), attempts: { increment: 1 } } });
          if (t.attempts > 120) throw new ProviderError("provider_timeout", "The platform did not confirm the post");
          continue;
        }
      } else {
        const dup = await db().marketingSocialPostTarget.findFirst({ where: { accountId: t.accountId, contentHash: hash, status: "PUBLISHED", id: { not: t.id } }, select: { id: true } });
        if (dup) throw new ProviderError("duplicate_content", "The same post was already published on this account");
        if (provider === "YOUTUBE" && mediaBytes === undefined) mediaBytes = post.mediaAssetId ? await assetMedia(post.companyId, post.mediaAssetId) : null;
        r = await publishTo(provider, conn, { text, mediaUrl, mediaType, media: provider === "YOUTUBE" ? (mediaBytes ?? null) : null, title: post.title, externalId: t.account.externalId });
        if (r.pending) {
          await db().marketingSocialPostTarget.update({ where: { id: t.id }, data: { providerPostId: r.providerPostId, contentHash: hash, error: null, nextAttemptAt: new Date(Date.now() + 30_000), attempts: { increment: 1 } } });
          continue;
        }
      }
      await db().marketingSocialPostTarget.update({ where: { id: t.id }, data: { status: "PUBLISHED", providerPostId: r.providerPostId, providerUrl: r.url, contentHash: hash, error: null, nextAttemptAt: null, publishedAt: new Date(), attempts: { increment: 1 } } });
      published++;
    } catch (err) {
      const reason = err instanceof ProviderError ? err.reason : "provider_error";
      const detail = err instanceof Error ? err.message.slice(0, 300) : "";
      const error = detail && detail !== reason ? `${reason}: ${detail}` : reason;
      const attempts = t.attempts + 1;
      const retry = isTransient(err) && attempts < MAX_PUBLISH_ATTEMPTS;
      logger.warn({ postId, targetId: t.id, provider, reason, retry }, "social publish failed");
      await db().marketingSocialPostTarget.update({
        where: { id: t.id },
        data: retry ? { error, attempts, nextAttemptAt: new Date(Date.now() + backoffMs(attempts, err instanceof ProviderError ? err.retryAfter : undefined)) } : { status: "FAILED", error, attempts, nextAttemptAt: null },
      });
    }
  }
  const targets = await db().marketingSocialPostTarget.findMany({ where: { postId }, select: { status: true, nextAttemptAt: true, error: true, providerUrl: true } });
  const waiting = targets.filter((t) => t.status === "PENDING");
  if (waiting.length) {
    const next = waiting.reduce((m, t) => Math.min(m, t.nextAttemptAt?.getTime() ?? Date.now()), Infinity);
    await db().marketingSocialPost.update({ where: { id: postId }, data: { status: "SCHEDULED", scheduledAt: new Date(Number.isFinite(next) ? next : Date.now() + 60_000), ...(published ? { publishedAt: post.publishedAt ?? new Date() } : {}) } });
    return published;
  }
  const ok = targets.filter((t) => t.status === "PUBLISHED").length;
  const status: MarketingSocialPostStatus = ok === targets.length ? "PUBLISHED" : ok > 0 ? "PARTIAL" : "FAILED";
  const failures = [...new Set(targets.filter((t) => t.status === "FAILED").map((t) => t.error ?? "provider_error"))].join("; ").slice(0, 500);
  const ctx = systemContext();
  const items = await db().marketingAutopilotItem.findMany({ where: { postId }, select: { id: true, autopilot: { select: { ownerId: true, createdById: true } } } });
  await transaction(async (tx) => {
    await tx.marketingSocialPost.update({ where: { id: postId }, data: { status, ...(ok ? { publishedAt: post.publishedAt ?? new Date() } : {}) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId: post.organizationId, action: "marketing.social_post.processed", resourceType: "marketing_social_post", resourceId: postId, newValue: { status, published: ok, total: targets.length, failures: failures || undefined } });
    if (ok) {
      await emitDomainEvent(tx, ctx, "content.published", {
        organizationId: post.organizationId,
        companyId: post.companyId,
        entityType: "marketing_social_post",
        entityId: postId,
        data: { title: post.title, channel: "social", publishedUrl: targets.find((t) => t.providerUrl)?.providerUrl ?? null, published: ok, total: targets.length },
      });
    }
    if (ok && post.contentId) {
      const content = await tx.marketingContent.findFirst({ where: { id: post.contentId, companyId: post.companyId } });
      if (content && content.status !== "PUBLISHED") await markContentPublished(tx, ctx, content, targets.find((t) => t.providerUrl)?.providerUrl ?? null);
    }
    if (items.length) {
      await tx.marketingAutopilotItem.updateMany({ where: { postId }, data: ok ? { stage: "PUBLISHED", error: status === "PARTIAL" ? failures : null } : { stage: "FAILED", error: failures || "publish_failed" } });
    }
    const recipients = [post.createdById, ...items.flatMap((i) => [i.autopilot.ownerId, i.autopilot.createdById])];
    const users = await tx.user.findMany({ where: { id: { in: recipients.filter((u): u is string => !!u) } }, select: { id: true } });
    await notifyUsers(tx, post.organizationId, users.map((u) => u.id), status === "PUBLISHED" ? "marketing.post_published" : "marketing.post_failed", { companyId: post.companyId, title: failures && status !== "PUBLISHED" ? `${post.title} — ${failures.slice(0, 120)}` : post.title, href: `/marketing/social/${postId}` });
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
      const values = { reach: m.reach ?? null, impressions: m.impressions ?? null, likes: m.likes ?? null, comments: m.comments ?? null, shares: m.shares ?? null, clicks: m.clicks ?? null };
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
