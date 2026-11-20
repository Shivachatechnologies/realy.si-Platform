import { z } from "zod";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { forbidden, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { can } from "@/server/modules/rbac/service";
import { actorId, authorize, clip, isUuid, plainMentions, requireUserId, resolveMentions, userNames } from "./common";

export const REACTIONS = ["👍", "🎉", "❤️", "😂", "👀", "🙏"] as const;
export const COMMENT_SUBJECTS = ["post", "announcement", "meeting"] as const;
export type CommentSubject = (typeof COMMENT_SUBJECTS)[number];

export const postInput = z.object({ body: z.string().trim().min(1).max(5000) });
export const reactionInput = z.object({ emoji: z.enum(REACTIONS) });
export const commentInput = z.object({ subjectType: z.enum(COMMENT_SUBJECTS), subjectId: z.string().uuid(), body: z.string().trim().min(1).max(5000) });
export const editCommentInput = z.object({ body: z.string().trim().min(1).max(5000) });

const PAGE = 20;

export async function listPosts(ctx: RequestContext, organizationId: string, companyId: string, opts: { q?: string; cursor?: string } = {}) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const rows = await db().commsPost.findMany({
    where: { organizationId, companyId, ...(opts.q ? { body: { contains: opts.q, mode: "insensitive" } } : {}) },
    orderBy: { id: "desc" },
    take: PAGE + 1,
    ...(opts.cursor && isUuid(opts.cursor) ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: { reactions: { select: { emoji: true, userId: true } } },
  });
  const page = rows.slice(0, PAGE);
  const counts = await db().commsComment.groupBy({ by: ["subjectId"], where: { companyId, subjectType: "post", subjectId: { in: page.map((p) => p.id) } }, _count: { _all: true } });
  const commentCount = new Map(counts.map((c) => [c.subjectId, c._count._all]));
  const names = await userNames(db(), page.map((p) => p.authorId));
  const me = ctx.actor.id;
  return {
    data: page.map(({ reactions, ...p }) => ({
      ...p,
      authorName: names.get(p.authorId) ?? null,
      commentCount: commentCount.get(p.id) ?? 0,
      reactions: REACTIONS.map((emoji) => ({ emoji, count: reactions.filter((r) => r.emoji === emoji).length, mine: reactions.some((r) => r.emoji === emoji && r.userId === me) })).filter((r) => r.count > 0),
    })),
    nextCursor: rows.length > PAGE ? page[page.length - 1]!.id : null,
  };
}

export async function createPost(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof postInput>) {
  const input = postInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const authorId = actorId(ctx, organizationId);
    const mentions = await resolveMentions(tx, organizationId, chain, input.body);
    const post = await tx.commsPost.create({ data: { organizationId, companyId, authorId, body: input.body, mentions } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.post.created", resourceType: "comms_post", resourceId: post.id });
    await notifyUsers(tx, organizationId, mentions.filter((m) => m !== authorId), "comms.mention", { companyId, title: clip(plainMentions(input.body)), href: `/communication#post-${post.id}` });
    return post;
  });
}

async function ownOrManage(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, authorId: string) {
  const chain = await authorize(ctx, organizationId, companyId, "communication.post", tx);
  if (authorId !== ctx.actor.id && !(await can(ctx, "communication.manage", chain, tx))) throw forbidden("Only the author can change this", { permission: "communication.manage" });
  return chain;
}

export async function updatePost(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof postInput>) {
  const input = postInput.parse(raw);
  return transaction(async (tx) => {
    if (!isUuid(id)) throw notFound("Post");
    const post = await tx.commsPost.findFirst({ where: { id, organizationId, companyId } });
    if (!post) throw notFound("Post");
    const chain = await ownOrManage(tx, ctx, organizationId, companyId, post.authorId);
    const mentions = await resolveMentions(tx, organizationId, chain, input.body);
    const updated = await tx.commsPost.update({ where: { id }, data: { body: input.body, mentions, editedAt: new Date() } });
    const added = mentions.filter((m) => !post.mentions.includes(m) && m !== post.authorId);
    await notifyUsers(tx, organizationId, added, "comms.mention", { companyId, title: clip(plainMentions(input.body)), href: `/communication#post-${id}` });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.post.updated", resourceType: "comms_post", resourceId: id });
    return updated;
  });
}

export async function deletePost(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    if (!isUuid(id)) throw notFound("Post");
    const post = await tx.commsPost.findFirst({ where: { id, organizationId, companyId } });
    if (!post) throw notFound("Post");
    await ownOrManage(tx, ctx, organizationId, companyId, post.authorId);
    await tx.commsComment.deleteMany({ where: { companyId, subjectType: "post", subjectId: id } });
    await tx.commsPost.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.post.deleted", resourceType: "comms_post", resourceId: id });
    return { ok: true };
  });
}

/** Toggle the viewer's reaction on a post. */
export async function toggleReaction(ctx: RequestContext, organizationId: string, companyId: string, postId: string, raw: z.input<typeof reactionInput>) {
  const { emoji } = reactionInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.read", tx);
    const userId = requireUserId(ctx);
    if (!isUuid(postId) || !(await tx.commsPost.findFirst({ where: { id: postId, organizationId, companyId }, select: { id: true } }))) throw notFound("Post");
    const existing = await tx.commsReaction.findUnique({ where: { postId_userId_emoji: { postId, userId, emoji } } });
    if (existing) await tx.commsReaction.delete({ where: { id: existing.id } });
    else await tx.commsReaction.create({ data: { postId, companyId, userId, emoji } });
    return { reacted: !existing };
  });
}

/** Record behind a comment thread (company-scoped), with its owner and link. */
async function subjectInfo(tx: Tx, organizationId: string, companyId: string, type: CommentSubject, id: string) {
  if (type === "post") {
    const p = await tx.commsPost.findFirst({ where: { id, organizationId, companyId }, select: { authorId: true, body: true } });
    return p ? { ownerIds: [p.authorId], title: clip(plainMentions(p.body), 80), href: `/communication#post-${id}` } : null;
  }
  if (type === "announcement") {
    const a = await tx.commsAnnouncement.findFirst({ where: { id, organizationId, companyId, status: "PUBLISHED" }, select: { authorId: true, title: true } });
    return a ? { ownerIds: [a.authorId], title: a.title, href: `/communication/announcements/${id}` } : null;
  }
  const m = await tx.commsMeeting.findFirst({ where: { id, organizationId, companyId }, select: { organizerId: true, title: true, attendees: { select: { userId: true } } } });
  return m ? { ownerIds: [m.organizerId, ...m.attendees.map((a) => a.userId)], title: m.title, href: `/communication/meetings/${id}` } : null;
}

export async function listComments(ctx: RequestContext, organizationId: string, companyId: string, subjectType: CommentSubject, subjectId: string) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  if (!isUuid(subjectId)) return [];
  const rows = await db().commsComment.findMany({ where: { organizationId, companyId, subjectType, subjectId }, orderBy: { createdAt: "asc" }, take: 500 });
  const names = await userNames(db(), rows.map((r) => r.authorId));
  return rows.map((r) => ({ ...r, authorName: names.get(r.authorId) ?? null }));
}

/** Comment on a record; @mentioned people and the record's owners are notified. */
export async function createComment(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof commentInput>) {
  const input = commentInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const subject = await subjectInfo(tx, organizationId, companyId, input.subjectType, input.subjectId);
    if (!subject) throw notFound("Record");
    const authorId = actorId(ctx, organizationId);
    const mentions = await resolveMentions(tx, organizationId, chain, input.body);
    const comment = await tx.commsComment.create({ data: { organizationId, companyId, subjectType: input.subjectType, subjectId: input.subjectId, authorId, body: input.body, mentions } });
    await notifyUsers(tx, organizationId, mentions.filter((m) => m !== authorId), "comms.mention", { companyId, title: subject.title, href: subject.href });
    const owners = subject.ownerIds.filter((o) => o !== authorId && !mentions.includes(o));
    await notifyUsers(tx, organizationId, owners, "comms.comment", { companyId, title: subject.title, href: subject.href });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.comment.created", resourceType: "comms_comment", resourceId: comment.id, newValue: { subjectType: input.subjectType, subjectId: input.subjectId } });
    return comment;
  });
}

export async function updateComment(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof editCommentInput>) {
  const input = editCommentInput.parse(raw);
  return transaction(async (tx) => {
    if (!isUuid(id)) throw notFound("Comment");
    const c = await tx.commsComment.findFirst({ where: { id, organizationId, companyId } });
    if (!c) throw notFound("Comment");
    const chain = await ownOrManage(tx, ctx, organizationId, companyId, c.authorId);
    const mentions = await resolveMentions(tx, organizationId, chain, input.body);
    return tx.commsComment.update({ where: { id }, data: { body: input.body, mentions, editedAt: new Date() } });
  });
}

export async function deleteComment(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    if (!isUuid(id)) throw notFound("Comment");
    const c = await tx.commsComment.findFirst({ where: { id, organizationId, companyId } });
    if (!c) throw notFound("Comment");
    await ownOrManage(tx, ctx, organizationId, companyId, c.authorId);
    await tx.commsComment.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.comment.deleted", resourceType: "comms_comment", resourceId: id });
    return { ok: true };
  });
}
