import "server-only";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { listChannels } from "./channels";
import { plainMentions, userNames } from "./common";

/**
 * Team side of the unified inbox: the viewer's direct conversations and channels they belong to, newest activity
 * first, with unread counts and the latest message (author + text). Only conversations the viewer can see.
 */
export async function teamConversations(ctx: RequestContext, organizationId: string, companyId: string, limit = 15) {
  const [direct, channels] = await Promise.all([listChannels(ctx, organizationId, companyId, { direct: true }), listChannels(ctx, organizationId, companyId)]);
  const mine = [...direct, ...channels.filter((c) => c.member)]
    .filter((c) => c.lastMessageAt)
    .sort((a, b) => b.lastMessageAt!.getTime() - a.lastMessageAt!.getTime())
    .slice(0, limit);
  const last = await Promise.all(
    mine.map((c) => db().commsMessage.findFirst({ where: { channelId: c.id, companyId, deletedAt: null, parentId: null }, orderBy: { createdAt: "desc" }, select: { authorId: true, body: true, createdAt: true } })),
  );
  const names = await userNames(db(), last.map((m) => m?.authorId));
  return mine.map((c, i) => {
    const m = last[i];
    return {
      id: c.id,
      name: c.name,
      isDirect: c.isDirect,
      unread: c.unread,
      lastMessageAt: c.lastMessageAt!,
      author: m ? (names.get(m.authorId) ?? null) : null,
      snippet: m ? plainMentions(m.body).replace(/\s+/g, " ").slice(0, 160) : "",
    };
  });
}
