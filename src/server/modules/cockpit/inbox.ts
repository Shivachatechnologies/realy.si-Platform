import "server-only";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { forbidden } from "@/server/core/errors";

/** Notification types that ask the person to do something (decide, reply, review, act on something overdue). */
const ACTION = /(approval|requested|assigned|review|input_needed|overdue|due|failing|failed|mention|customer_reply|invite|action_item|escalated)/;
export const isActionable = (type: string) => ACTION.test(type);

/** The viewer's unread notifications that need an action, newest first (shown above the timeline). */
export async function actionableNotifications(ctx: RequestContext, organizationId: string, take = 12) {
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw forbidden("Notifications are for signed-in people");
  const rows = await db().notification.findMany({ where: { organizationId, userId: ctx.actor.id, readAt: null }, orderBy: { id: "desc" }, take: 200 });
  return rows.filter((n) => isActionable(n.type)).slice(0, take);
}
