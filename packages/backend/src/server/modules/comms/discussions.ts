import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { forbidden, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { authorize, clip, isUuid, membersWith, requireUserId, uuid } from "./common";

export const discussTaskInput = z.object({ channelId: uuid, note: z.string().trim().max(2000).optional() });

/** Task-linked discussion of a WorkTask (null when none) and whether the viewer may start one. */
export async function getTaskDiscussion(ctx: RequestContext, organizationId: string, companyId: string, taskId: string) {
  const chain = await authorize(ctx, organizationId, companyId, "communication.read");
  if (!isUuid(taskId)) throw notFound("Task");
  const d = await db().commsTaskDiscussion.findFirst({
    where: { organizationId, companyId, taskId },
    include: { channel: { select: { id: true, name: true, visibility: true, archivedAt: true, members: { select: { userId: true } } } } },
  });
  const canPost = (await can(ctx, "communication.post", chain)) && (await can(ctx, "projects.read", chain));
  if (!d) return { canPost, discussion: null };
  const member = d.channel.members.some((m) => m.userId === ctx.actor.id);
  const visible = d.channel.visibility === "PUBLIC" || member;
  const replies = visible ? await db().commsMessage.count({ where: { parentId: d.messageId, deletedAt: null } }) : 0;
  return {
    canPost,
    discussion: {
      id: d.id,
      channelId: d.channel.id,
      channelName: visible ? d.channel.name : null,
      visible,
      archived: !!d.channel.archivedAt,
      messageId: d.messageId,
      replies,
      href: `/communication/channels/${d.channel.id}?thread=${d.messageId}`,
    },
  };
}

/** Channels the viewer may start a discussion in (public or joined, not archived, not DMs). */
export async function discussionChannels(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const me = ctx.actor.id ?? "00000000-0000-0000-0000-000000000000";
  return db().commsChannel.findMany({
    where: { organizationId, companyId, isDirect: false, archivedAt: null, OR: [{ visibility: "PUBLIC" }, { members: { some: { userId: me } } }] },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { name: "asc" }],
    take: 200,
    select: { id: true, name: true, visibility: true },
  });
}

/**
 * "Discuss in channel": opens the task's discussion thread, or starts one in the chosen channel with a root message
 * linked to the task. The task's assignee and creator are notified when they can see the channel.
 */
export async function discussTask(ctx: RequestContext, organizationId: string, companyId: string, taskId: string, raw: z.input<typeof discussTaskInput>) {
  const input = discussTaskInput.parse(raw);
  if (!isUuid(taskId)) throw notFound("Task");
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "communication.post", tx);
    await requirePermission(ctx, "projects.read", chain, tx);
    const me = requireUserId(ctx);
    const task = await tx.workTask.findFirst({ where: { id: taskId, organizationId, companyId, archivedAt: null }, select: { id: true, title: true, assigneeId: true, createdById: true } });
    if (!task) throw notFound("Task");
    const existing = await tx.commsTaskDiscussion.findFirst({ where: { companyId, taskId }, include: { channel: { select: { visibility: true, members: { select: { userId: true } } } } } });
    if (existing) {
      const visible = existing.channel.visibility === "PUBLIC" || existing.channel.members.some((m) => m.userId === me);
      if (!visible) throw forbidden("This task is discussed in a private channel you are not a member of", { reason: "comms_discussion_private" });
      return { channelId: existing.channelId, messageId: existing.messageId, created: false };
    }
    const channel = await tx.commsChannel.findFirst({
      where: { id: input.channelId, organizationId, companyId, isDirect: false },
      select: { id: true, name: true, visibility: true, archivedAt: true, members: { select: { userId: true } } },
    });
    const member = !!channel?.members.some((m) => m.userId === me);
    if (!channel || (channel.visibility === "PRIVATE" && !member)) throw notFound("Channel");
    if (channel.archivedAt) throw invalid("This channel is archived", { reason: "comms_channel_archived" });
    if (!member) await tx.commsChannelMember.create({ data: { channelId: channel.id, companyId, userId: me } });
    const now = new Date();
    const body = `**${clip(task.title, 200)}**${input.note ? `\n\n${input.note}` : ""}`;
    const message = await tx.commsMessage.create({ data: { companyId, channelId: channel.id, authorId: me, body, taskIds: [task.id], createdAt: now } });
    await tx.commsChannel.update({ where: { id: channel.id }, data: { lastMessageAt: now } });
    await tx.commsChannelMember.update({ where: { channelId_userId: { channelId: channel.id, userId: me } }, data: { lastReadAt: now } });
    const d = await tx.commsTaskDiscussion.create({ data: { organizationId, companyId, taskId: task.id, channelId: channel.id, messageId: message.id, createdById: me } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.task_discussion.created", resourceType: "work_task", resourceId: task.id, newValue: { channelId: channel.id, messageId: message.id } });
    const watchers = [task.assigneeId, task.createdById].filter((u): u is string => !!u && u !== me);
    const canSee = channel.visibility === "PUBLIC" ? await membersWith(tx, organizationId, chain, "communication.read", watchers) : watchers.filter((u) => channel.members.some((m) => m.userId === u));
    await notifyUsers(tx, organizationId, canSee, "comms.task_discussion", { companyId, title: clip(task.title, 80), href: `/communication/channels/${channel.id}?thread=${message.id}` });
    return { channelId: channel.id, messageId: message.id, created: true, id: d.id };
  });
}
