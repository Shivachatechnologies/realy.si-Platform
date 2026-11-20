import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { requireUserId, isUuid } from "./common";

const PAGE = 30;

/** Notification center: the viewer's own notifications in the organization (all modules), newest first, paginated. */
export async function listNotificationCenter(ctx: RequestContext, organizationId: string, opts: { unread?: boolean; cursor?: string; kind?: string } = {}) {
  const userId = requireUserId(ctx);
  const kind = opts.kind && /^[a-z_]+$/.test(opts.kind) ? opts.kind : undefined;
  const rows = await db().notification.findMany({
    where: { organizationId, userId, ...(opts.unread ? { readAt: null } : {}), ...(kind ? { type: { startsWith: `${kind}.` } } : {}) },
    orderBy: { id: "desc" },
    take: PAGE + 1,
    ...(opts.cursor && isUuid(opts.cursor) ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const data = rows.slice(0, PAGE);
  const unreadCount = await db().notification.count({ where: { organizationId, userId, readAt: null } });
  return { data, nextCursor: rows.length > PAGE ? data[data.length - 1]!.id : null, unreadCount };
}
