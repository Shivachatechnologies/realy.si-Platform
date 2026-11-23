import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { isUuid, reasonSchema, requireAnyPlatform } from "./access";
import { revokePlatformRole } from "./users";

/**
 * Platform access reviews (Admin → Roles → Access reviews): a snapshot of every platform / region / country grant held
 * by a person, decided KEEP or REVOKE item by item. A REVOKE decision revokes the grant at once (revokePlatformRole:
 * platform.security.manage, last-super-admin guard, audited). Creating, deciding and completing need
 * platform.roles.manage (MFA-gated) or platform.security.manage; reading needs platform.security.read as well.
 */

const MANAGE = ["platform.roles.manage", "platform.security.manage"];
const READ = ["platform.security.read", ...MANAGE];

export const createReviewInput = z.object({ title: z.string().trim().min(3).max(120), dueAt: z.coerce.date().optional(), reason: reasonSchema });

export async function createAccessReview(ctx: RequestContext, raw: z.input<typeof createReviewInput>) {
  const input = createReviewInput.parse(raw);
  await requireAnyPlatform(ctx, MANAGE);
  if (input.dueAt && input.dueAt <= new Date()) throw invalid("The due date must be in the future", { field: "dueAt" });
  return transaction(async (tx) => {
    const grants = await tx.roleAssignment.findMany({
      where: { principalType: "USER", scopeType: { in: ["PLATFORM", "REGION", "COUNTRY"] } },
      take: 5000,
      select: { id: true, principalId: true, scopeType: true, scopeId: true, role: { select: { key: true } } },
    });
    if (!grants.length) throw conflict("There are no platform grants to review");
    const review = await tx.platformAccessReview.create({
      data: {
        title: input.title,
        createdById: ctx.actor.id!,
        dueAt: input.dueAt ?? null,
        items: { create: grants.map((g) => ({ assignmentId: g.id, principalId: g.principalId, roleKey: g.role.key, scope: g.scopeType === "PLATFORM" ? "PLATFORM" : `${g.scopeType}:${g.scopeId}` })) },
      },
    });
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.access_review.created", resourceType: "access_review", resourceId: review.id, newValue: { title: input.title, items: grants.length, dueAt: input.dueAt ?? null }, reason: input.reason });
    return { id: review.id, items: grants.length };
  });
}

export async function listAccessReviews(ctx: RequestContext) {
  await requireAnyPlatform(ctx, READ);
  const reviews = await db().platformAccessReview.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, title: true, status: true, dueAt: true, completedAt: true, createdAt: true, createdById: true } });
  const counts = reviews.length
    ? await db().platformAccessReviewItem.groupBy({ by: ["reviewId", "decision"], where: { reviewId: { in: reviews.map((r) => r.id) } }, _count: { _all: true } })
    : [];
  const creators = await db().user.findMany({ where: { id: { in: [...new Set(reviews.map((r) => r.createdById))] } }, select: { id: true, name: true } });
  return reviews.map((r) => {
    const mine = counts.filter((c) => c.reviewId === r.id);
    const n = (d: "KEEP" | "REVOKE" | null) => mine.filter((c) => c.decision === d).reduce((a, c) => a + c._count._all, 0);
    return { ...r, createdBy: creators.find((c) => c.id === r.createdById)?.name ?? null, total: mine.reduce((a, c) => a + c._count._all, 0), kept: n("KEEP"), revoked: n("REVOKE"), pending: n(null) };
  });
}

export async function getAccessReview(ctx: RequestContext, reviewId: string) {
  await requireAnyPlatform(ctx, READ);
  if (!isUuid(reviewId)) throw notFound("Access review");
  const review = await db().platformAccessReview.findUnique({ where: { id: reviewId }, include: { items: { orderBy: [{ roleKey: "asc" }, { id: "asc" }] } } });
  if (!review) throw notFound("Access review");
  const ids = [...new Set([review.createdById, ...review.items.flatMap((i) => [i.principalId, i.decidedById].filter((x): x is string => !!x))])];
  const [users, live, lastSeen] = await Promise.all([
    db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, status: true, mfaEnabled: true } }),
    db().roleAssignment.findMany({ where: { id: { in: review.items.map((i) => i.assignmentId) } }, select: { id: true, expiresAt: true, createdAt: true } }),
    db().session.groupBy({ by: ["userId"], where: { userId: { in: review.items.map((i) => i.principalId) } }, _max: { lastSeenAt: true } }),
  ]);
  const userOf = (id: string | null) => users.find((u) => u.id === id) ?? null;
  return {
    ...review,
    createdBy: userOf(review.createdById),
    items: review.items.map((i) => {
      const a = live.find((l) => l.id === i.assignmentId);
      return { ...i, user: userOf(i.principalId), decidedBy: userOf(i.decidedById), stillGranted: !!a, grantedAt: a?.createdAt ?? null, expiresAt: a?.expiresAt ?? null, lastSeenAt: lastSeen.find((s) => s.userId === i.principalId)?._max.lastSeenAt ?? null };
    }),
  };
}

export const decideInput = z.object({ decision: z.enum(["KEEP", "REVOKE"]), note: z.string().trim().max(500).optional(), reason: reasonSchema });

/** Decide one item. REVOKE removes the grant immediately (if it still exists); a decision cannot be changed later. */
export async function decideAccessReviewItem(ctx: RequestContext, reviewId: string, itemId: string, raw: z.input<typeof decideInput>) {
  const input = decideInput.parse(raw);
  if (!isUuid(reviewId) || !isUuid(itemId)) throw notFound("Access review item");
  await requireAnyPlatform(ctx, MANAGE);
  const item = await db().platformAccessReviewItem.findUnique({ where: { id: itemId }, include: { review: { select: { status: true } } } });
  if (!item || item.reviewId !== reviewId) throw notFound("Access review item");
  if (item.review.status !== "OPEN") throw conflict("This review is closed");
  if (item.decision) throw conflict("This item was already decided", { reason: "already_decided" });
  if (item.principalId === ctx.actor.id) throw invalid("Another reviewer must decide your own access", { reason: "self_review" });
  let revoked = false;
  if (input.decision === "REVOKE") {
    const exists = await db().roleAssignment.findUnique({ where: { id: item.assignmentId }, select: { id: true } });
    if (exists) {
      await requirePermission(ctx, "platform.security.manage", platformChain());
      await revokePlatformRole(ctx, item.principalId, item.assignmentId, { reason: `Access review: ${input.reason}` });
      revoked = true;
    }
  }
  await transaction(async (tx) => {
    const updated = await tx.platformAccessReviewItem.updateMany({ where: { id: itemId, decision: null }, data: { decision: input.decision, decidedById: ctx.actor.id, decidedAt: new Date(), note: input.note ?? null } });
    if (!updated.count) throw conflict("This item was already decided", { reason: "already_decided" });
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.access_review.decided", resourceType: "access_review", resourceId: reviewId, newValue: { itemId, assignmentId: item.assignmentId, principalId: item.principalId, roleKey: item.roleKey, decision: input.decision, revoked }, reason: input.reason });
  });
  return { id: itemId, decision: input.decision, revoked };
}

export const closeReviewInput = z.object({ action: z.enum(["complete", "cancel"]), reason: reasonSchema });

/** Complete (every item decided) or cancel a review. The completion report is the review page itself. */
export async function closeAccessReview(ctx: RequestContext, reviewId: string, raw: z.input<typeof closeReviewInput>) {
  const input = closeReviewInput.parse(raw);
  if (!isUuid(reviewId)) throw notFound("Access review");
  await requireAnyPlatform(ctx, MANAGE);
  return transaction(async (tx) => {
    const review = await tx.platformAccessReview.findUnique({ where: { id: reviewId }, select: { status: true } });
    if (!review) throw notFound("Access review");
    if (review.status !== "OPEN") throw conflict("This review is already closed");
    const pending = await tx.platformAccessReviewItem.count({ where: { reviewId, decision: null } });
    if (input.action === "complete" && pending) throw conflict(`Decide every item first (${pending} left)`, { reason: "items_pending", pending });
    const [kept, revoked] = await Promise.all([tx.platformAccessReviewItem.count({ where: { reviewId, decision: "KEEP" } }), tx.platformAccessReviewItem.count({ where: { reviewId, decision: "REVOKE" } })]);
    const status = input.action === "complete" ? "COMPLETED" : "CANCELED";
    await tx.platformAccessReview.update({ where: { id: reviewId }, data: { status, completedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "SECURITY", action: input.action === "complete" ? "platform.access_review.completed" : "platform.access_review.canceled", resourceType: "access_review", resourceId: reviewId, newValue: { status, kept, revoked, pending }, reason: input.reason });
    return { id: reviewId, status, kept, revoked, pending };
  });
}
