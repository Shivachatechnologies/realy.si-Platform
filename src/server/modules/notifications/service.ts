import { z } from "zod";
import { db, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError } from "@/server/core/errors";

/** In-app notifications. Payloads carry ids and labels only — never document content or secrets. */

export interface ApprovalRequestedPayload {
  approvalId: string;
  companyId: string;
  summary: string;
}

/**
 * Notify everyone who could decide an approval: users holding a role with `approvals.decide` at the organization or
 * at the request's company (the requester included, so their own AI's requests reach them).
 */
export async function notifyApprovers(tx: Prisma.TransactionClient, organizationId: string, payload: ApprovalRequestedPayload) {
  const assignments = await tx.roleAssignment.findMany({
    where: {
      organizationId,
      principalType: "USER",
      OR: [
        { scopeType: "ORGANIZATION", scopeId: organizationId },
        { scopeType: "COMPANY", scopeId: payload.companyId },
      ],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
      role: { permissions: { some: { permission: { key: "approvals.decide" } } } },
    },
    select: { principalId: true },
  });
  const userIds = [...new Set(assignments.map((a) => a.principalId))];
  if (!userIds.length) return 0;
  await tx.notification.createMany({
    data: userIds.map((userId) => ({ organizationId, userId, type: "approval.requested", payload: payload as unknown as Prisma.InputJsonValue })),
  });
  return userIds.length;
}

function requireUser(ctx: RequestContext): string {
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw new AppError("unauthenticated", "Sign in required");
  return ctx.actor.id;
}

/** The viewer's own notifications in one organization, newest first. */
export async function listMyNotifications(ctx: RequestContext, organizationId: string, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  const userId = requireUser(ctx);
  return db().notification.findMany({
    where: { organizationId, userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 20, 100),
  });
}

export const markReadInput = z.object({ organizationId: z.string().uuid(), ids: z.array(z.string().uuid()).max(100).optional() });

/** Mark the viewer's notifications read (given ids, or all in the organization). Only ever touches the viewer's own rows. */
export async function markNotificationsRead(ctx: RequestContext, raw: z.input<typeof markReadInput>) {
  const userId = requireUser(ctx);
  const { organizationId, ids } = markReadInput.parse(raw);
  const { count } = await db().notification.updateMany({
    where: { organizationId, userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return { marked: count };
}
