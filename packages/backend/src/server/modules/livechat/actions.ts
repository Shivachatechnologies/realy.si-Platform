import { db, transaction, type Tx } from "@/server/core/db";
import { systemContext } from "@/server/core/context";
import { isAppError } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { addActivity, createLead } from "@/server/modules/crm/service";
import { createTicket } from "@/server/modules/support/tickets";
import type { LivechatSettings } from "@/generated/prisma/client";
import { addOutcome, conversationHref } from "./common";

/**
 * What the website chat AI may do besides answering. Everything runs as the SYSTEM actor scoped to the conversation's
 * company (anonymous visitors have no permissions of their own); the founder grants each capability in the live chat
 * settings (auto-create leads / tickets, meetings). Meetings send a calendar invitation, so each one is filed for
 * approval through the tool gateway (livechat_book_meeting) instead of being booked directly.
 */

export interface ChatActionResult {
  ok: boolean;
  /** Text returned to the model. */
  message: string;
  detail?: string;
}

type Conv = { id: string; organizationId: string; companyId: string; visitorId: string; leadId: string | null; ticketId: string | null };

const transcriptLink = (conversationId: string) => `Website chat transcript: ${conversationHref(conversationId)}`;

/** Insert a system notice in the conversation (the widget and inbox localize the event code). */
export async function addEvent(tx: Tx, conv: { id: string; organizationId: string; companyId: string }, code: string, meta: Record<string, string | number | boolean | null> = {}) {
  await tx.livechatMessage.create({ data: { organizationId: conv.organizationId, companyId: conv.companyId, conversationId: conv.id, author: "SYSTEM", kind: "event", body: code, meta } });
  await tx.livechatConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date(), messageCount: { increment: 1 } } });
}

async function consentedVisitor(conv: Conv) {
  const v = await db().livechatVisitor.findFirst({ where: { id: conv.visitorId, companyId: conv.companyId }, select: { id: true, name: true, email: true, consentAt: true, leadId: true } });
  return v?.email && v.consentAt ? v : null;
}

const NEED_CONTACT: ChatActionResult = {
  ok: false,
  message: "The visitor has not shared contact details with consent yet. Call request_contact_details and ask them to fill in the form; then try again.",
  detail: "contact_missing",
};

export async function requestContactDetails(conv: Conv, reason: string): Promise<ChatActionResult> {
  if (await consentedVisitor(conv)) return { ok: true, message: "The visitor already shared contact details with consent. Continue." };
  const pending = await db().livechatMessage.findFirst({ where: { conversationId: conv.id, companyId: conv.companyId, kind: "contact_request" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (!pending || pending.createdAt.getTime() < Date.now() - 10 * 60_000) {
    await db().livechatMessage.create({ data: { organizationId: conv.organizationId, companyId: conv.companyId, conversationId: conv.id, author: "SYSTEM", kind: "contact_request", body: reason.slice(0, 300) || "contact" } });
  }
  return { ok: true, message: "The contact form is now shown to the visitor. Briefly tell them why you need it; continue once they have shared it." };
}

export async function handOff(conv: Conv, settings: Pick<LivechatSettings, "companyId">, opts: { reason: string; knowledgeGap: boolean; silent?: boolean }): Promise<ChatActionResult> {
  const ctx = systemContext();
  const done = await transaction(async (tx) => {
    const c = await tx.livechatConversation.findFirst({ where: { id: conv.id, companyId: settings.companyId }, select: { status: true, outcomes: true, handoffAt: true } });
    if (!c || c.status === "CLOSED") return false;
    if (c.status === "WAITING_HUMAN" || c.status === "HUMAN_ACTIVE") return true;
    await tx.livechatConversation.update({
      where: { id: conv.id },
      data: { status: "WAITING_HUMAN", handoffReason: opts.reason.slice(0, 300), handoffAt: new Date(), outcomes: addOutcome(c.outcomes, "handoff", ...(opts.knowledgeGap ? ["knowledge_gap"] : [])) },
    });
    await addEvent(tx, conv, opts.silent ? "handoff_unavailable" : "handoff");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId: conv.organizationId, action: "livechat.handoff", resourceType: "livechat_conversation", resourceId: conv.id, newValue: { reason: opts.reason, knowledgeGap: opts.knowledgeGap } });
    const recipients = await usersWithPermission(tx, conv.organizationId, conv.companyId, "support.manage");
    await notifyUsers(tx, conv.organizationId, recipients, "livechat.handoff", { companyId: conv.companyId, title: opts.reason.slice(0, 120), href: conversationHref(conv.id) });
    return true;
  });
  return done
    ? { ok: true, message: "The team has been notified and can take over this chat. Tell the visitor a person will reply here as soon as possible (and by email if they shared it)." }
    : { ok: false, message: "This conversation is closed." };
}

export async function createLeadFromChat(conv: Conv, input: { interest: string; summary: string; organization: string }): Promise<ChatActionResult> {
  if (conv.leadId) return { ok: true, message: "A lead was already recorded for this conversation; the sales team will follow up.", detail: conv.leadId };
  const visitor = await consentedVisitor(conv);
  if (!visitor) return NEED_CONTACT;
  const ctx = systemContext();
  const notes = [`Interest: ${input.interest}`, input.summary, transcriptLink(conv.id)].filter(Boolean).join("\n\n").slice(0, 5000);
  let leadId: string;
  try {
    const lead = await createLead(ctx, conv.organizationId, conv.companyId, {
      name: visitor.name || visitor.email!.split("@")[0]!,
      email: visitor.email!,
      account: input.organization || undefined,
      source: "Website chat",
      notes,
      tags: ["livechat"],
    });
    leadId = lead.id;
  } catch (err) {
    const ids = isAppError(err) && err.details?.reason === "lead_duplicate" ? (err.details.leadIds as string[] | undefined) : undefined;
    if (!ids?.[0]) throw err;
    leadId = ids[0];
    await addActivity(ctx, conv.organizationId, conv.companyId, leadId, { type: "NOTE", summary: `New website chat: ${notes}`.slice(0, 5000) }).catch((e) => logger.info({ err: e instanceof Error ? e.message : e }, "lead note skipped"));
  }
  await transaction(async (tx) => {
    const c = await tx.livechatConversation.findUniqueOrThrow({ where: { id: conv.id }, select: { outcomes: true } });
    await tx.livechatConversation.update({ where: { id: conv.id }, data: { leadId, outcomes: addOutcome(c.outcomes, "lead") } });
    await tx.livechatVisitor.update({ where: { id: visitor.id }, data: { leadId } });
    await addEvent(tx, conv, "lead_created");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId: conv.organizationId, action: "livechat.lead_created", resourceType: "livechat_conversation", resourceId: conv.id, newValue: { leadId } });
  });
  conv.leadId = leadId;
  return { ok: true, message: "Lead recorded. Tell the visitor the team will follow up by email.", detail: leadId };
}

export async function createTicketFromChat(conv: Conv, input: { subject: string; description: string }): Promise<ChatActionResult> {
  if (conv.ticketId) return { ok: true, message: "A support ticket was already opened for this conversation.", detail: conv.ticketId };
  const visitor = await consentedVisitor(conv);
  if (!visitor) return NEED_CONTACT;
  if (!input.subject) return { ok: false, message: "A subject is required." };
  const ctx = systemContext();
  const ticket = await createTicket(ctx, conv.organizationId, conv.companyId, {
    subject: input.subject,
    description: `${input.description}\n\n${transcriptLink(conv.id)}`.slice(0, 20_000),
    requesterEmail: visitor.email!,
    requesterName: visitor.name ?? undefined,
    channel: "CHAT",
    tags: ["livechat"],
  });
  await transaction(async (tx) => {
    const c = await tx.livechatConversation.findUniqueOrThrow({ where: { id: conv.id }, select: { outcomes: true } });
    await tx.livechatConversation.update({ where: { id: conv.id }, data: { ticketId: ticket.id, outcomes: addOutcome(c.outcomes, "ticket") } });
    await addEvent(tx, conv, "ticket_created", { number: ticket.number });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId: conv.organizationId, action: "livechat.ticket_created", resourceType: "livechat_conversation", resourceId: conv.id, newValue: { ticketId: ticket.id } });
  });
  conv.ticketId = ticket.id;
  return { ok: true, message: `Support ticket #${ticket.number} opened. Tell the visitor the number and that the team will reply by email.`, detail: ticket.id };
}

export async function proposeMeeting(conv: Conv, input: { startsAt: string; topic: string }): Promise<ChatActionResult> {
  if (!conv.leadId) return { ok: false, message: "Record the visitor as a lead first (create_lead), then propose the meeting.", detail: "lead_missing" };
  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now() + 30 * 60_000) return { ok: false, message: "Ask the visitor for a future date and time (with their time zone)." };
  const { requestTool } = await import("@/server/modules/tools/gateway");
  try {
    const r = await requestTool(
      "livechat_book_meeting",
      { conversationId: conv.id, leadId: conv.leadId, title: (input.topic || "Meeting").slice(0, 200), startsAt: startsAt.toISOString(), durationMin: 30 },
      { ctx: systemContext(), organizationId: conv.organizationId, companyId: conv.companyId, allowedTools: ["livechat_book_meeting"], profileKey: "website_chat_agent", taskId: null },
    );
    const approvalId = r.status === "approval_requested" ? r.approvalId : null;
    await transaction(async (tx) => {
      const c = await tx.livechatConversation.findUniqueOrThrow({ where: { id: conv.id }, select: { outcomes: true } });
      await tx.livechatConversation.update({ where: { id: conv.id }, data: { meetingApprovalId: approvalId, outcomes: addOutcome(c.outcomes, "meeting") } });
      await addEvent(tx, conv, "meeting_proposed", { startsAt: startsAt.toISOString() });
    });
    return { ok: true, message: "The meeting request was sent to the team for confirmation. Tell the visitor it is NOT booked yet: they will receive a calendar invitation by email once the team confirms." };
  } catch (err) {
    logger.info({ err: err instanceof Error ? err.message : String(err) }, "livechat meeting request not filed");
    return { ok: false, message: "Meetings can't be requested right now. Offer to have the team follow up instead (create_lead or hand_off_to_human).", detail: "meeting_unavailable" };
  }
}
