import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, forbidden, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { can } from "@/server/modules/rbac/service";
import type { ScopeChain } from "@/server/modules/rbac/scope";
import { authorize, clip, isUuid, membersWith, plainMentions, requireUserId, resolveMentions, userNames, uuid } from "./common";

export const channelInput = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .transform((s) => s.replace(/^#/, "")),
  description: z.string().trim().max(500).optional(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
  memberIds: z.array(uuid).max(200).default([]),
});
export const updateChannelInput = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .transform((s) => s.replace(/^#/, ""))
    .optional(),
  description: z.string().trim().max(500).optional(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),
  archived: z.boolean().optional(),
});
export const membersInput = z.object({ userIds: z.array(uuid).min(1).max(200) });
export const messageInput = z.object({ body: z.string().trim().min(1).max(5000), parentId: uuid.optional() });
export const editMessageInput = z.object({ body: z.string().trim().min(1).max(5000) });
export const directInput = z.object({ userId: uuid });

const NO_USER = "00000000-0000-0000-0000-000000000000";

/** Channels the viewer can see: public channels and private / direct ones they belong to. */
export async function listChannels(ctx: RequestContext, organizationId: string, companyId: string, opts: { q?: string; direct?: boolean; archived?: boolean } = {}) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const me = ctx.actor.id ?? NO_USER;
  const where: Prisma.CommsChannelWhereInput = {
    organizationId,
    companyId,
    isDirect: !!opts.direct,
    archivedAt: opts.archived ? { not: null } : null,
    ...(opts.direct ? { members: { some: { userId: me } } } : { OR: [{ visibility: "PUBLIC" }, { members: { some: { userId: me } } }] }),
    ...(opts.q ? { AND: [{ OR: [{ name: { contains: opts.q, mode: "insensitive" } }, { description: { contains: opts.q, mode: "insensitive" } }] }] } : {}),
  };
  const channels = await db().commsChannel.findMany({
    where,
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { name: "asc" }],
    take: 200,
    include: { members: { select: { userId: true, lastReadAt: true } } },
  });
  const names = await userNames(db(), channels.flatMap((c) => c.members.map((m) => m.userId)));
  const out = [];
  for (const c of channels) {
    const mine = c.members.find((m) => m.userId === me);
    const unread = mine
      ? await db().commsMessage.count({ where: { channelId: c.id, deletedAt: null, authorId: { not: me }, ...(mine.lastReadAt ? { createdAt: { gt: mine.lastReadAt } } : {}) } })
      : 0;
    const others = c.members.filter((m) => m.userId !== me).map((m) => names.get(m.userId) ?? "?");
    out.push({
      id: c.id,
      name: c.isDirect ? others.join(", ") || names.get(me) || c.name : c.name,
      description: c.description,
      visibility: c.visibility,
      isDirect: c.isDirect,
      memberCount: c.members.length,
      member: !!mine,
      unread,
      lastMessageAt: c.lastMessageAt,
      archivedAt: c.archivedAt,
    });
  }
  return out;
}

async function loadChannel(client: Tx | Db, ctx: RequestContext, organizationId: string, companyId: string, channelId: string) {
  if (!isUuid(channelId)) throw notFound("Channel");
  const c = await client.commsChannel.findFirst({ where: { id: channelId, organizationId, companyId }, include: { members: { select: { userId: true, lastReadAt: true, joinedAt: true } } } });
  if (!c) throw notFound("Channel");
  const member = c.members.some((m) => m.userId === ctx.actor.id);
  if ((c.visibility === "PRIVATE" || c.isDirect) && !member) throw notFound("Channel");
  return { channel: c, member };
}

async function canAdminister(client: Tx, ctx: RequestContext, chain: ScopeChain, c: { createdById: string; isDirect: boolean }) {
  if (c.isDirect) return false;
  return c.createdById === ctx.actor.id || (await can(ctx, "communication.manage", chain, client));
}

export async function getChannel(ctx: RequestContext, organizationId: string, companyId: string, channelId: string) {
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "communication.read", tx);
    const { channel, member } = await loadChannel(tx, ctx, organizationId, companyId, channelId);
    if (member && ctx.actor.id) await tx.commsChannelMember.update({ where: { channelId_userId: { channelId, userId: ctx.actor.id } }, data: { lastReadAt: new Date() } });
    const names = await userNames(tx, channel.members.map((m) => m.userId));
    const others = channel.members.filter((m) => m.userId !== ctx.actor.id).map((m) => names.get(m.userId) ?? "?");
    return {
      ...channel,
      displayName: channel.isDirect ? others.join(", ") || channel.name : channel.name,
      member,
      canAdminister: await canAdminister(tx, ctx, chain, channel),
      canPost: await can(ctx, "communication.post", chain, tx),
      members: channel.members.map((m) => ({ userId: m.userId, name: names.get(m.userId) ?? null, joinedAt: m.joinedAt })),
    };
  });
}

export async function createChannel(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof channelInput>) {
  const input = channelInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const me = requireUserId(ctx);
    if (await tx.commsChannel.findFirst({ where: { companyId, isDirect: false, name: { equals: input.name, mode: "insensitive" } }, select: { id: true } })) {
      throw conflict("A channel with this name exists", { reason: "comms_channel_exists" });
    }
    const memberIds = await membersWith(tx, organizationId, chain, "communication.read", [...new Set([...input.memberIds, me])]);
    const c = await tx.commsChannel.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        description: input.description || null,
        visibility: input.visibility,
        createdById: me,
        members: { create: [...new Set([me, ...memberIds])].map((userId) => ({ userId, companyId })) },
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.channel.created", resourceType: "comms_channel", resourceId: c.id, newValue: { name: c.name, visibility: c.visibility } });
    await notifyUsers(tx, organizationId, memberIds.filter((u) => u !== me), "comms.channel_added", { companyId, title: c.name, href: `/communication/channels/${c.id}` });
    return c;
  });
}

export async function updateChannel(ctx: RequestContext, organizationId: string, companyId: string, channelId: string, raw: z.input<typeof updateChannelInput>) {
  const input = updateChannelInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const { channel } = await loadChannel(tx, ctx, organizationId, companyId, channelId);
    if (!(await canAdminister(tx, ctx, chain, channel))) throw forbidden("Only the channel owner can change it", { permission: "communication.manage" });
    if (input.name && input.name.toLowerCase() !== channel.name.toLowerCase()) {
      if (await tx.commsChannel.findFirst({ where: { companyId, isDirect: false, name: { equals: input.name, mode: "insensitive" }, id: { not: channelId } }, select: { id: true } })) {
        throw conflict("A channel with this name exists", { reason: "comms_channel_exists" });
      }
    }
    const c = await tx.commsChannel.update({
      where: { id: channelId },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.visibility ? { visibility: input.visibility } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.channel.updated", resourceType: "comms_channel", resourceId: channelId, newValue: input });
    return c;
  });
}

export async function deleteChannel(ctx: RequestContext, organizationId: string, companyId: string, channelId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.manage", tx);
    const { channel } = await loadChannel(tx, ctx, organizationId, companyId, channelId);
    if (channel.isDirect) throw invalid("Direct conversations can't be deleted");
    await tx.commsChannel.delete({ where: { id: channelId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.channel.deleted", resourceType: "comms_channel", resourceId: channelId, oldValue: { name: channel.name } });
    return { ok: true };
  });
}

/** Add members (owner / manager), or join a public channel yourself. */
export async function addMembers(ctx: RequestContext, organizationId: string, companyId: string, channelId: string, raw: z.input<typeof membersInput>) {
  const input = membersInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "communication.read", tx);
    const { channel, member } = await loadChannel(tx, ctx, organizationId, companyId, channelId);
    if (channel.isDirect) throw invalid("Direct conversations have fixed participants");
    const selfJoin = input.userIds.length === 1 && input.userIds[0] === ctx.actor.id && channel.visibility === "PUBLIC";
    if (!selfJoin && !(member && (await canAdminister(tx, ctx, chain, channel))) && !(await can(ctx, "communication.manage", chain, tx))) {
      throw forbidden("Only the channel owner can add people", { permission: "communication.manage" });
    }
    const ok = await membersWith(tx, organizationId, chain, "communication.read", input.userIds);
    const existing = new Set(channel.members.map((m) => m.userId));
    const added = ok.filter((u) => !existing.has(u));
    if (added.length) await tx.commsChannelMember.createMany({ data: added.map((userId) => ({ channelId, companyId, userId })) });
    await notifyUsers(tx, organizationId, added.filter((u) => u !== ctx.actor.id), "comms.channel_added", { companyId, title: channel.name, href: `/communication/channels/${channelId}` });
    return { added: added.length };
  });
}

/** Remove a member (owner / manager) or leave yourself. */
export async function removeMember(ctx: RequestContext, organizationId: string, companyId: string, channelId: string, userId: string) {
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "communication.read", tx);
    const { channel } = await loadChannel(tx, ctx, organizationId, companyId, channelId);
    if (channel.isDirect) throw invalid("Direct conversations have fixed participants");
    if (userId !== ctx.actor.id && !(await canAdminister(tx, ctx, chain, channel))) throw forbidden("Only the channel owner can remove people", { permission: "communication.manage" });
    if (!isUuid(userId)) throw notFound("Member");
    await tx.commsChannelMember.deleteMany({ where: { channelId, userId } });
    return { ok: true };
  });
}

const MESSAGE_PAGE = 50;

/** Top-level messages (newest page, oldest first in the result) or one thread's replies. */
export async function listMessages(ctx: RequestContext, organizationId: string, companyId: string, channelId: string, opts: { parentId?: string; before?: string } = {}) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  await loadChannel(db(), ctx, organizationId, companyId, channelId);
  const parentId = opts.parentId && isUuid(opts.parentId) ? opts.parentId : null;
  const before = opts.before && isUuid(opts.before) ? await db().commsMessage.findFirst({ where: { id: opts.before, channelId }, select: { createdAt: true } }) : null;
  const rows = await db().commsMessage.findMany({
    where: { channelId, companyId, parentId, ...(before ? { createdAt: { lt: before.createdAt } } : {}) },
    orderBy: { createdAt: parentId ? "asc" : "desc" },
    take: parentId ? 500 : MESSAGE_PAGE + 1,
    include: { _count: { select: { replies: { where: { deletedAt: null } } } } },
  });
  const hasMore = !parentId && rows.length > MESSAGE_PAGE;
  const page = parentId ? rows : rows.slice(0, MESSAGE_PAGE).reverse();
  const parent = parentId
    ? await db().commsMessage.findFirst({ where: { id: parentId, channelId, companyId }, include: { _count: { select: { replies: { where: { deletedAt: null } } } } } })
    : null;
  const names = await userNames(db(), [...page.map((m) => m.authorId), parent?.authorId]);
  const shape = ({ _count, ...m }: (typeof rows)[number]) => ({ ...m, body: m.deletedAt ? "" : m.body, authorName: names.get(m.authorId) ?? null, replyCount: _count.replies });
  return { data: page.map(shape), parent: parent ? shape(parent) : null, olderCursor: hasMore ? page[0]!.id : null };
}

export async function postMessage(ctx: RequestContext, organizationId: string, companyId: string, channelId: string, raw: z.input<typeof messageInput>) {
  const input = messageInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const me = requireUserId(ctx);
    const { channel, member } = await loadChannel(tx, ctx, organizationId, companyId, channelId);
    if (channel.archivedAt) throw invalid("This channel is archived", { reason: "comms_channel_archived" });
    if (!member) await tx.commsChannelMember.create({ data: { channelId, companyId, userId: me } });
    let parentAuthor: string | null = null;
    if (input.parentId) {
      const parent = await tx.commsMessage.findFirst({ where: { id: input.parentId, channelId, parentId: null, deletedAt: null }, select: { authorId: true } });
      if (!parent) throw notFound("Message");
      parentAuthor = parent.authorId;
    }
    const mentions = await resolveMentions(tx, organizationId, chain, input.body);
    const now = new Date();
    const m = await tx.commsMessage.create({ data: { companyId, channelId, parentId: input.parentId ?? null, authorId: me, body: input.body, mentions, createdAt: now } });
    await tx.commsChannel.update({ where: { id: channelId }, data: { lastMessageAt: now } });
    await tx.commsChannelMember.update({ where: { channelId_userId: { channelId, userId: me } }, data: { lastReadAt: now } });
    const href = channel.isDirect ? `/communication/messages/${channelId}` : `/communication/channels/${channelId}${input.parentId ? `?thread=${input.parentId}` : ""}`;
    const title = clip(plainMentions(input.body), 80);
    const mentioned = mentions.filter((u) => u !== me && (channel.visibility === "PUBLIC" || channel.members.some((x) => x.userId === u)));
    await notifyUsers(tx, organizationId, mentioned, "comms.mention", { companyId, title, href });
    if (channel.isDirect) {
      await notifyUsers(tx, organizationId, channel.members.map((x) => x.userId).filter((u) => u !== me), "comms.direct_message", { companyId, title, href });
    } else if (parentAuthor && parentAuthor !== me && !mentioned.includes(parentAuthor)) {
      await notifyUsers(tx, organizationId, [parentAuthor], "comms.thread_reply", { companyId, title, href });
    }
    return m;
  });
}

async function ownMessage(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, messageId: string, allowManager: boolean) {
  if (!isUuid(messageId)) throw notFound("Message");
  const m = await tx.commsMessage.findFirst({ where: { id: messageId, companyId, deletedAt: null, channel: { organizationId } } });
  if (!m) throw notFound("Message");
  const chain = await authorize(ctx, organizationId, companyId, "communication.post", tx);
  await loadChannel(tx, ctx, organizationId, companyId, m.channelId);
  if (m.authorId !== ctx.actor.id && !(allowManager && (await can(ctx, "communication.manage", chain, tx)))) throw forbidden("Only the author can change this message");
  return { m, chain };
}

export async function editMessage(ctx: RequestContext, organizationId: string, companyId: string, messageId: string, raw: z.input<typeof editMessageInput>) {
  const input = editMessageInput.parse(raw);
  return transaction(async (tx) => {
    const { chain } = await ownMessage(tx, ctx, organizationId, companyId, messageId, false);
    const mentions = await resolveMentions(tx, organizationId, chain, input.body);
    return tx.commsMessage.update({ where: { id: messageId }, data: { body: input.body, mentions, editedAt: new Date() } });
  });
}

export async function deleteMessage(ctx: RequestContext, organizationId: string, companyId: string, messageId: string) {
  return transaction(async (tx) => {
    const { m } = await ownMessage(tx, ctx, organizationId, companyId, messageId, true);
    await tx.commsMessage.update({ where: { id: messageId }, data: { deletedAt: new Date(), body: "" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.message.deleted", resourceType: "comms_message", resourceId: messageId, oldValue: { channelId: m.channelId, authorId: m.authorId } });
    return { ok: true };
  });
}

/** Find or start the direct conversation between the viewer and another person. */
export async function openDirect(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof directInput>) {
  const { userId } = directInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const me = requireUserId(ctx);
    const [ok] = await membersWith(tx, organizationId, chain, "communication.read", [userId]);
    if (!ok) throw invalid("This person isn't part of this company's communication", { reason: "comms_person_ineligible" });
    const directKey = [...new Set([me, userId])].sort().join(":");
    const existing = await tx.commsChannel.findFirst({ where: { companyId, directKey }, select: { id: true } });
    if (existing) return existing;
    return tx.commsChannel.create({
      data: {
        organizationId,
        companyId,
        name: "direct",
        isDirect: true,
        directKey,
        visibility: "PRIVATE",
        createdById: me,
        members: { create: [...new Set([me, userId])].map((u) => ({ userId: u, companyId })) },
      },
      select: { id: true },
    });
  });
}
