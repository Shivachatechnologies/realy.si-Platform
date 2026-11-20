import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { can } from "@/server/modules/rbac/service";
import { authorize, clip, plainMentions, requireUserId, userNames } from "./common";
import { listChannels } from "./channels";
import { viewerAudienceWhere } from "./announcements";

/** Conversations tab: channels the viewer belongs to and their direct messages, most recent first, with unread counts. */
export async function listConversations(ctx: RequestContext, organizationId: string, companyId: string, opts: { q?: string; unread?: boolean } = {}) {
  const [channels, direct] = await Promise.all([listChannels(ctx, organizationId, companyId, { q: opts.q }), listChannels(ctx, organizationId, companyId, { q: opts.q, direct: true })]);
  const rows = [...channels.filter((c) => c.member), ...direct]
    .filter((c) => !opts.unread || c.unread > 0)
    .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
  return { data: rows, unread: rows.reduce((s, c) => s + c.unread, 0), unreadConversations: rows.filter((c) => c.unread > 0).length };
}

export type MentionKind = "message" | "post" | "comment" | "task_comment";

export interface MentionItem {
  id: string;
  kind: MentionKind;
  authorId: string;
  authorName: string | null;
  excerpt: string;
  context: string | null;
  href: string;
  createdAt: Date;
}

const PAGE = 30;

/**
 * Everything that @mentions the viewer: channel / direct messages (in conversations they can see), feed posts, comments
 * on posts / announcements / meetings and project task comments (read-only from the work module; needs projects.read).
 * Merged newest first; `before` pages by timestamp.
 */
export async function listMentions(ctx: RequestContext, organizationId: string, companyId: string, opts: { before?: Date; kind?: MentionKind } = {}) {
  const chain = await authorize(ctx, organizationId, companyId, "communication.read");
  const me = requireUserId(ctx);
  const before = opts.before && !Number.isNaN(opts.before.getTime()) ? { lt: opts.before } : undefined;
  const want = (k: MentionKind) => !opts.kind || opts.kind === k;
  const projects = await can(ctx, "projects.read", chain);
  const [messages, posts, comments, taskComments] = await Promise.all([
    want("message")
      ? db().commsMessage.findMany({
          where: {
            companyId,
            mentions: { has: me },
            deletedAt: null,
            authorId: { not: me },
            ...(before ? { createdAt: before } : {}),
            channel: { organizationId, OR: [{ visibility: "PUBLIC", isDirect: false }, { members: { some: { userId: me } } }] },
          },
          orderBy: { createdAt: "desc" },
          take: PAGE + 1,
          select: { id: true, body: true, authorId: true, createdAt: true, parentId: true, channelId: true, channel: { select: { name: true, isDirect: true } } },
        })
      : [],
    want("post")
      ? db().commsPost.findMany({
          where: { organizationId, companyId, mentions: { has: me }, authorId: { not: me }, ...(before ? { createdAt: before } : {}) },
          orderBy: { createdAt: "desc" },
          take: PAGE + 1,
          select: { id: true, body: true, authorId: true, createdAt: true },
        })
      : [],
    want("comment")
      ? db().commsComment.findMany({
          where: { organizationId, companyId, mentions: { has: me }, authorId: { not: me }, ...(before ? { createdAt: before } : {}) },
          orderBy: { createdAt: "desc" },
          take: PAGE + 1,
          select: { id: true, body: true, authorId: true, createdAt: true, subjectType: true, subjectId: true },
        })
      : [],
    want("task_comment") && projects
      ? db().workTaskComment.findMany({
          where: { organizationId, companyId, mentionIds: { has: me }, authorId: { not: me }, ...(before ? { createdAt: before } : {}), task: { archivedAt: null } },
          orderBy: { createdAt: "desc" },
          take: PAGE + 1,
          select: { id: true, body: true, authorId: true, createdAt: true, taskId: true, task: { select: { title: true } } },
        })
      : [],
  ]);
  const commentHref = (type: string, id: string) => (type === "announcement" ? `/communication/announcements/${id}` : type === "meeting" ? `/communication/meetings/${id}` : `/communication#post-${id}`);
  const items: Omit<MentionItem, "authorName">[] = [
    ...messages.map((m) => ({
      id: m.id,
      kind: "message" as const,
      authorId: m.authorId,
      excerpt: clip(plainMentions(m.body), 240),
      context: m.channel.isDirect ? null : `#${m.channel.name}`,
      href: m.channel.isDirect ? `/communication/messages/${m.channelId}` : `/communication/channels/${m.channelId}${m.parentId ? `?thread=${m.parentId}` : ""}`,
      createdAt: m.createdAt,
    })),
    ...posts.map((p) => ({ id: p.id, kind: "post" as const, authorId: p.authorId, excerpt: clip(plainMentions(p.body), 240), context: null, href: `/communication#post-${p.id}`, createdAt: p.createdAt })),
    ...comments.map((c) => ({ id: c.id, kind: "comment" as const, authorId: c.authorId, excerpt: clip(plainMentions(c.body), 240), context: c.subjectType, href: commentHref(c.subjectType, c.subjectId), createdAt: c.createdAt })),
    ...taskComments.map((c) => ({ id: c.id, kind: "task_comment" as const, authorId: c.authorId, excerpt: clip(plainMentions(c.body), 240), context: c.task.title, href: `/projects/tasks/${c.taskId}`, createdAt: c.createdAt })),
  ].sort((a, b) => +b.createdAt - +a.createdAt);
  const page = items.slice(0, PAGE);
  const names = await userNames(db(), page.map((i) => i.authorId));
  return {
    data: page.map((i) => ({ ...i, authorName: names.get(i.authorId) ?? null })),
    nextBefore: items.length > PAGE ? page[page.length - 1]!.createdAt.toISOString() : null,
    includesTaskComments: projects,
  };
}

/** Badge counts for the hub tabs. */
export async function hubCounts(ctx: RequestContext, organizationId: string, companyId: string) {
  const me = requireUserId(ctx);
  const [conversations, unreadAnnouncements, pendingRsvps] = await Promise.all([
    listConversations(ctx, organizationId, companyId),
    viewerAudienceWhere(organizationId, companyId, me).then((audience) =>
      db().commsAnnouncement.count({ where: { organizationId, companyId, AND: [audience, { status: "PUBLISHED" }], reads: { none: { userId: me } } } }),
    ),
    db().commsMeetingAttendee.count({ where: { companyId, userId: me, rsvp: "PENDING", meeting: { organizationId, status: "SCHEDULED", startsAt: { gt: new Date() }, organizerId: { not: me } } } }),
  ]);
  return { conversations: conversations.unreadConversations, announcements: unreadAnnouncements, meetings: pendingRsvps };
}
