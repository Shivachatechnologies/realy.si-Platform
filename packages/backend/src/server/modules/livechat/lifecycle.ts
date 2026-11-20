import { db, transaction, type Tx } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { addEvent } from "./actions";
import { addOutcome, IDLE_CLOSE_MS } from "./common";

/**
 * Close a conversation. It counts as resolved by the AI when the AI answered and nobody had to take over (no handoff).
 */
export async function closeConversationTx(tx: Tx, ctx: RequestContext, conversationId: string, companyId: string, by: "visitor" | "agent" | "idle") {
  const c = await tx.livechatConversation.findFirst({ where: { id: conversationId, companyId }, select: { id: true, organizationId: true, companyId: true, status: true, outcomes: true, handoffAt: true } });
  if (!c || c.status === "CLOSED") return false;
  const aiAnswered = (await tx.livechatMessage.count({ where: { conversationId, companyId, author: "AI" } })) > 0;
  const aiResolved = aiAnswered && !c.handoffAt;
  await tx.livechatConversation.update({
    where: { id: c.id },
    data: { status: "CLOSED", closedAt: new Date(), aiResolved, aiBusyUntil: null, agentTypingAt: null, outcomes: aiResolved ? addOutcome(c.outcomes, "resolved") : undefined },
  });
  await addEvent(tx, c, "closed");
  await writeAudit(tx, ctx, { category: "TENANT", organizationId: c.organizationId, action: "livechat.conversation.closed", resourceType: "livechat_conversation", resourceId: c.id, newValue: { by, aiResolved } });
  return true;
}

/** Worker: AI-handled conversations idle for 30 minutes are closed (handed-off ones stay open for the team). */
export async function closeIdleConversations(): Promise<number> {
  const stale = await db().livechatConversation.findMany({ where: { status: "AI_ACTIVE", lastMessageAt: { lt: new Date(Date.now() - IDLE_CLOSE_MS) } }, select: { id: true, companyId: true }, take: 500 });
  let n = 0;
  for (const c of stale) {
    try {
      if (await transaction((tx) => closeConversationTx(tx, systemContext(), c.id, c.companyId, "idle"))) n++;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), conversationId: c.id }, "livechat idle close failed");
    }
  }
  return n;
}

/**
 * Worker (GDPR retention): per company, closed conversations older than its retention period are deleted with their
 * messages, then visitors with no conversations left who were not seen within the period. Leads and tickets created
 * from chats live in CRM / Support and follow their own retention.
 */
export async function applyRetention(): Promise<number> {
  const all = await db().livechatSettings.findMany({ select: { companyId: true, organizationId: true, retentionDays: true } });
  let removed = 0;
  for (const s of all) {
    const cutoff = new Date(Date.now() - s.retentionDays * 86_400_000);
    const convs = await db().livechatConversation.deleteMany({ where: { companyId: s.companyId, organizationId: s.organizationId, status: "CLOSED", lastMessageAt: { lt: cutoff } } });
    const visitors = await db().livechatVisitor.deleteMany({ where: { companyId: s.companyId, organizationId: s.organizationId, lastSeenAt: { lt: cutoff }, conversations: { none: {} } } });
    removed += convs.count + visitors.count;
    if (convs.count || visitors.count) {
      await transaction((tx) =>
        writeAudit(tx, systemContext(), { category: "TENANT", organizationId: s.organizationId, action: "livechat.retention.applied", resourceType: "livechat_settings", resourceId: s.companyId, newValue: { conversations: convs.count, visitors: visitors.count, retentionDays: s.retentionDays } }),
      );
    }
  }
  return removed;
}
