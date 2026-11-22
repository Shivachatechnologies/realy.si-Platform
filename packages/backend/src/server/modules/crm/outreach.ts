import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { sendPlainEmail } from "@/server/modules/email/service";
import { gmailSend, outlookSend } from "@/server/modules/comms/providers";
import { ProviderError } from "@/server/modules/integrations/providers";
import { authorize, isUuid } from "./common";
import { assertAiAllowed, connectedMailbox } from "./channels";
import { crmModelText } from "./ai-text";
import { contactName } from "./contacts";

/**
 * Personal outreach: emails drafted by a person or by AI (connected OpenAI / Gemini), approved by a person, then sent
 * through the company's own connected mailbox (Gmail / Outlook via Integrations) or its SendGrid account. Never through
 * a shared platform mailer, never marked SENT unless the provider accepted it. A sent email is logged on the record's
 * timeline. Messages created by cadences (sequences) wait here for approval unless the cadence was approved for
 * automatic sending.
 */

export const OUTREACH_GOALS = ["first_touch", "follow_up", "book_meeting", "proposal_follow_up", "re_engage", "thank_you"] as const;
export type OutreachGoal = (typeof OUTREACH_GOALS)[number];

const subjectRef = z.object({ leadId: z.string().uuid().optional(), contactId: z.string().uuid().optional(), dealId: z.string().uuid().optional() });
const hasOne = (v: { leadId?: string; contactId?: string; dealId?: string }) => [v.leadId, v.contactId, v.dealId].filter(Boolean).length === 1;

export const outreachDraftInput = subjectRef
  .extend({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(10_000), submit: z.boolean().default(false) })
  .refine(hasOne, { message: "Pick exactly one lead, contact or deal" });
export const outreachAiInput = subjectRef
  .extend({ goal: z.enum(OUTREACH_GOALS).default("follow_up"), guidance: z.string().trim().max(1000).optional(), tone: z.enum(["friendly", "formal", "short"]).default("friendly") })
  .refine(hasOne, { message: "Pick exactly one lead, contact or deal" });
export const outreachPatch = z.object({ subject: z.string().trim().min(1).max(200).optional(), body: z.string().trim().min(1).max(10_000).optional() });
export const OUTREACH_STATUSES = ["DRAFT", "PENDING_APPROVAL", "SENT", "FAILED", "CANCELLED"] as const;

export interface Recipient {
  leadId: string | null;
  contactId: string | null;
  dealId: string | null;
  email: string;
  name: string;
  firstName: string;
  organisation: string | null;
  context: string;
}

/** Who the email goes to, from a lead, contact or deal (the deal's contact). */
export async function resolveRecipient(organizationId: string, companyId: string, ref: { leadId?: string | null; contactId?: string | null; dealId?: string | null }): Promise<Recipient> {
  const base = { organizationId, companyId };
  if (ref.leadId) {
    const l = await db().lead.findFirst({
      where: { ...base, id: ref.leadId, archivedAt: null },
      include: { activities: { orderBy: { occurredAt: "desc" }, take: 6, select: { type: true, summary: true, occurredAt: true } } },
    });
    if (!l) throw notFound("Lead");
    if (!l.email) throw invalid("This lead has no email address yet. Add one first.", { reason: "crm_no_email" });
    const ctxLines = [`Stage: ${l.stage}`, l.need ? `Need: ${l.need}` : "", l.notes ? `Notes: ${l.notes.slice(0, 800)}` : "", ...l.activities.map((a) => `${a.occurredAt.toISOString().slice(0, 10)} ${a.type}: ${a.summary.slice(0, 200)}`)];
    return { leadId: l.id, contactId: null, dealId: null, email: l.email, name: l.name, firstName: l.name.split(/\s+/)[0] ?? l.name, organisation: l.account, context: ctxLines.filter(Boolean).join("\n") };
  }
  if (ref.contactId) {
    const c = await db().contact.findFirst({ where: { ...base, id: ref.contactId, archivedAt: null }, include: { account: { select: { name: true } } } });
    if (!c) throw notFound("Contact");
    if (!c.email) throw invalid("This contact has no email address yet. Add one first.", { reason: "crm_no_email" });
    return { leadId: null, contactId: c.id, dealId: null, email: c.email, name: contactName(c), firstName: c.firstName, organisation: c.account?.name ?? null, context: c.title ? `Job title: ${c.title}` : "" };
  }
  const d = await db().crmDeal.findFirst({
    where: { ...base, id: ref.dealId ?? "", archivedAt: null },
    include: { contact: true, account: { select: { name: true } }, stage: { select: { name: true } }, proposals: { where: { archivedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { number: true, status: true, sentAt: true, viewedAt: true } } },
  });
  if (!d) throw notFound("Deal");
  if (!d.contact?.email) throw invalid("This deal has no contact with an email address. Link a contact first.", { reason: "crm_no_email" });
  const p = d.proposals[0];
  return {
    leadId: null,
    contactId: d.contact.id,
    dealId: d.id,
    email: d.contact.email,
    name: contactName(d.contact),
    firstName: d.contact.firstName,
    organisation: d.account?.name ?? null,
    context: [`Deal: ${d.name}`, `Stage: ${d.stage.name}`, d.description ? `About: ${d.description.slice(0, 600)}` : "", p ? `Latest proposal ${p.number}: ${p.status}${p.viewedAt ? " (viewed)" : ""}` : ""].filter(Boolean).join("\n"),
  };
}

/** "Jane Doe <jane@acme.com>" → "jane@acme.com". */
export const addressIn = (from: string) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();

/** Whether `email` wrote to the company's connected inbox after `since` (mailbox sync stores inbound mail). */
export async function hasRepliedSince(organizationId: string, companyId: string, email: string, since: Date) {
  const m = await db().commsEmailMessage.findFirst({
    where: { companyId, direction: "INBOUND", sentAt: { gt: since }, thread: { organizationId }, fromAddress: { contains: email, mode: "insensitive" } },
    select: { fromAddress: true },
  });
  return !!m && addressIn(m.fromAddress) === email.toLowerCase();
}

// ─── Delivery ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Delivery {
  channel: string;
  providerMessageId: string | null;
}

/** Send through the company's own provider. Throws not_configured (nothing sent) or not_available (provider refused). */
export async function deliver(organizationId: string, companyId: string, msg: { to: string; subject: string; body: string; userId?: string | null }): Promise<Delivery> {
  const mailbox = await connectedMailbox(organizationId, companyId);
  if (mailbox) {
    try {
      const r =
        mailbox.provider === "gmail"
          ? await gmailSend(mailbox.conn, { from: mailbox.address, to: [msg.to], subject: msg.subject, text: msg.body })
          : await outlookSend(mailbox.conn, { to: [msg.to], subject: msg.subject, text: msg.body });
      return { channel: `mailbox:${mailbox.provider}`, providerMessageId: r.providerMessageId ?? null };
    } catch (err) {
      throw new AppError("not_available", `Your mailbox refused the email: ${err instanceof ProviderError ? err.message.slice(0, 200) : "send failed"}. Nothing was sent.`, { reason: "crm_send_failed" });
    }
  }
  const r = await sendPlainEmail({ to: msg.to, subject: msg.subject, text: msg.body, template: "crm.outreach", organizationId, companyId, companyOnly: true, userId: msg.userId ?? null });
  if (r.status === "SENT") return { channel: "sendgrid", providerMessageId: r.messageId };
  if (r.status === "NOT_CONFIGURED") throw new AppError("not_configured", "No email provider is connected (Gmail, Outlook or SendGrid). Nothing was sent.", { reason: "crm_email_not_connected" });
  throw new AppError("not_available", "The email provider refused the message. Nothing was sent.", { reason: "crm_send_failed" });
}

/** Log a sent email on the record's timeline (lead activity, or CRM activity on the contact/deal). */
export async function logSentEmail(tx: Tx, organizationId: string, companyId: string, by: string, m: { leadId: string | null; contactId: string | null; dealId: string | null; subject: string; body: string }) {
  const summary = `Sent: ${m.subject}\n\n${m.body}`.slice(0, 5000);
  const now = new Date();
  if (m.leadId) {
    await tx.leadActivity.create({ data: { organizationId, companyId, leadId: m.leadId, type: "EMAIL", summary, occurredAt: now, createdById: by } });
    await tx.lead.updateMany({ where: { id: m.leadId, companyId }, data: { lastContactedAt: now } });
    await tx.lead.updateMany({ where: { id: m.leadId, companyId, stage: "NEW" }, data: { stage: "CONTACTED" } });
  } else {
    await tx.crmActivity.create({ data: { organizationId, companyId, type: "EMAIL", subject: m.subject.slice(0, 200), summary: m.body.slice(0, 5000), occurredAt: now, contactId: m.contactId, dealId: m.dealId, createdById: by } });
  }
}

// ─── Drafts ───────────────────────────────────────────────────────────────────────────────────────────────────────

async function notifyApprovers(tx: Tx, organizationId: string, companyId: string, exclude: string | null, title: string) {
  const ids = (await usersWithPermission(tx, organizationId, companyId, "sales.manage")).filter((u) => u !== exclude).slice(0, 20);
  if (ids.length) await notifyUsers(tx, organizationId, ids, "crm.outreach_pending", { companyId, title, href: "/crm/outreach" });
}

export async function createOutreachDraft(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof outreachDraftInput>, extra: { aiProvider?: string | null } = {}) {
  const input = outreachDraftInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "sales.manage");
  const r = await resolveRecipient(organizationId, companyId, input);
  return transaction(async (tx) => {
    const m = await tx.crmOutreachMessage.create({
      data: {
        organizationId,
        companyId,
        leadId: r.leadId,
        contactId: r.contactId,
        dealId: r.dealId,
        toEmail: r.email,
        toName: r.name,
        subject: input.subject,
        body: input.body,
        status: input.submit ? "PENDING_APPROVAL" : "DRAFT",
        aiProvider: extra.aiProvider ?? null,
        createdById: ctx.actor.id ?? null,
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.outreach.drafted", resourceType: "crm_outreach_message", resourceId: m.id, newValue: { to: r.email, ai: !!extra.aiProvider, status: m.status } });
    if (input.submit) await notifyApprovers(tx, organizationId, companyId, ctx.actor.id ?? null, r.name);
    return m;
  });
}

const GOAL_TEXT: Record<OutreachGoal, string> = {
  first_touch: "a first, personal introduction email that explains in one sentence how we can help and ends with one easy question",
  follow_up: "a short follow-up that fits the history and moves the conversation one step forward",
  book_meeting: "an email that proposes a short call or meeting and offers two concrete time options in general terms (e.g. 'Tuesday morning or Thursday afternoon')",
  proposal_follow_up: "a friendly follow-up on the proposal we sent, offering to answer questions",
  re_engage: "a light check-in to re-start a conversation that went quiet, without pressure",
  thank_you: "a warm thank-you note after a conversation, summarising the agreed next step",
};

/** AI draft (connected OpenAI / Gemini) saved as a DRAFT for a person to edit and approve. Nothing is sent. */
export async function aiOutreachDraft(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof outreachAiInput>) {
  const input = outreachAiInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "sales.manage");
  await assertAiAllowed(organizationId, companyId);
  const r = await resolveRecipient(organizationId, companyId, input);
  const [company, me] = await Promise.all([
    db().company.findFirst({ where: { id: companyId, organizationId }, select: { name: true } }),
    ctx.actor.id ? db().user.findFirst({ where: { id: ctx.actor.id }, select: { name: true } }) : Promise.resolve(null),
  ]);
  const ai = await crmModelText(organizationId, companyId, {
    profileKey: "sdr",
    operation: "crm.outreach_draft",
    sourceType: r.leadId ? "lead" : r.dealId ? "crm_deal" : "contact",
    sourceId: `${r.leadId ?? r.dealId ?? r.contactId}:${Date.now()}`,
    jsonSchema: { type: "object", properties: { subject: { type: "string" }, body: { type: "string" } }, required: ["subject", "body"], additionalProperties: false },
    system:
      "You write short, honest sales emails for a small business. Use only facts from the record; never invent prices, results, customers or meetings. Plain text, no markdown, no placeholders in brackets. Reply with JSON only.",
    prompt: `We are ${company?.name ?? "our company"}; the sender is ${me?.name ?? "the owner"}.\nWrite ${GOAL_TEXT[input.goal]}.\nTone: ${input.tone}.\nRecipient: ${r.name}${r.organisation ? ` at ${r.organisation}` : ""}.\nWhat we know:\n${r.context || "(little is known yet)"}${input.guidance ? `\nExtra direction: ${input.guidance}` : ""}\n\nReturn JSON: {"subject": "<subject line>", "body": "<plain-text email body, greeting with first name ${r.firstName}, signed by ${me?.name ?? "the sender"}>"}`,
    maxTokens: 700,
    temperature: 0.6,
  });
  if (!ai.ok) {
    if (ai.code === "not_configured") throw new AppError("not_configured", "No AI model is configured on the platform. Write the email yourself.", { reason: "crm_ai_not_connected" });
    if (ai.code === "paused") throw new AppError("not_available", "AI is paused for this company. Nothing was generated.", { reason: "company_ai_paused" });
    if (ai.code === "budget") throw new AppError("not_available", `${ai.error} Nothing was generated.`, { reason: "cost_budget_reached" });
    throw new AppError("not_available", `The AI provider could not answer: ${ai.error}`, { reason: "crm_ai_failed" });
  }
  const text = ai.text;
  let subject = "";
  let body = "";
  try {
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { subject?: unknown; body?: unknown };
    subject = typeof j.subject === "string" ? j.subject.trim() : "";
    body = typeof j.body === "string" ? j.body.trim() : "";
  } catch {
    /* unreadable */
  }
  if (!subject || !body) throw new AppError("not_available", "The AI answer could not be read; nothing was saved. Please try again.", { reason: "crm_ai_unreadable" });
  return createOutreachDraft(ctx, organizationId, companyId, { leadId: input.leadId, contactId: input.contactId, dealId: input.dealId, subject: subject.slice(0, 200), body: body.slice(0, 10_000) }, { aiProvider: ai.via });
}

async function loadMessage(tx: Tx, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Email");
  const m = await tx.crmOutreachMessage.findFirst({ where: { id, organizationId, companyId } });
  if (!m) throw notFound("Email");
  return m;
}

export async function updateOutreach(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof outreachPatch>) {
  const input = outreachPatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const m = await loadMessage(tx, organizationId, companyId, id);
    if (m.status === "SENT" || m.status === "CANCELLED") throw conflict("This email can no longer be edited", { reason: "crm_outreach_locked" });
    const u = await tx.crmOutreachMessage.update({ where: { id }, data: { ...input, ...(m.status === "FAILED" ? { status: "DRAFT" as const, error: null } : {}) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.outreach.edited", resourceType: "crm_outreach_message", resourceId: id });
    return u;
  });
}

export async function submitOutreach(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const m = await loadMessage(tx, organizationId, companyId, id);
    if (m.status !== "DRAFT" && m.status !== "FAILED") throw conflict("Only drafts can be sent for approval", { reason: "crm_outreach_state" });
    const u = await tx.crmOutreachMessage.update({ where: { id }, data: { status: "PENDING_APPROVAL", error: null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.outreach.submitted", resourceType: "crm_outreach_message", resourceId: id });
    await notifyApprovers(tx, organizationId, companyId, ctx.actor.id ?? null, m.toName ?? m.toEmail);
    return u;
  });
}

export async function cancelOutreach(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const m = await loadMessage(tx, organizationId, companyId, id);
    if (m.status === "SENT") throw conflict("A sent email cannot be cancelled", { reason: "crm_outreach_locked" });
    const u = await tx.crmOutreachMessage.update({ where: { id }, data: { status: "CANCELLED" } });
    // A skipped sequence email moves that person on to the next step.
    if (m.enrollmentId && m.status !== "CANCELLED") {
      const { advanceAfterSend } = await import("./cadences");
      await advanceAfterSend(tx, m.enrollmentId);
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.outreach.cancelled", resourceType: "crm_outreach_message", resourceId: id });
    return u;
  });
}

/**
 * A person approves and sends. The row is claimed first (so a double click cannot send twice), then the provider is
 * called; the outcome (SENT / FAILED) is stored truthfully. Sequence messages advance their enrollment.
 */
export async function approveAndSend(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "sales.manage");
  if (!isUuid(id)) throw notFound("Email");
  const claim = await db().crmOutreachMessage.updateMany({
    where: { id, organizationId, companyId, status: { in: ["DRAFT", "PENDING_APPROVAL", "FAILED"] }, approvedAt: null },
    data: { approvedById: ctx.actor.id ?? null, approvedAt: new Date() },
  });
  if (!claim.count) throw conflict("This email was already handled", { reason: "crm_outreach_state" });
  const m = (await db().crmOutreachMessage.findUnique({ where: { id } }))!;
  return sendClaimed(ctx, organizationId, companyId, m, ctx.actor.id ?? null);
}

/** Deliver a claimed message and record the truth. Used by approveAndSend and by auto-send cadences. */
export async function sendClaimed(ctx: RequestContext, organizationId: string, companyId: string, m: Prisma.CrmOutreachMessageGetPayload<object>, by: string | null) {
  // Do-not-contact: the CRM suppression list (address or domain) and marketing unsubscribes block every sales email.
  const { suppressionFor } = await import("./suppression");
  const hit = await suppressionFor(db(), companyId, m.toEmail);
  if (hit) {
    await transaction(async (tx) => {
      await tx.crmOutreachMessage.update({ where: { id: m.id }, data: { status: "CANCELLED", error: `Do not contact (${hit.reason})`.slice(0, 300), approvedAt: null } });
      if (m.enrollmentId) await tx.crmCadenceEnrollment.updateMany({ where: { id: m.enrollmentId, status: { in: ["ACTIVE", "PAUSED"] } }, data: { status: "STOPPED", stoppedReason: "do_not_contact", nextRunAt: null } });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.outreach.suppressed", resourceType: "crm_outreach_message", resourceId: m.id, newValue: { reason: hit.reason, list: hit.kind } });
    });
    throw conflict("This address is on the do-not-contact list (unsubscribed, bounced or blocked). Nothing was sent.", { reason: "crm_do_not_contact" });
  }
  // Prospecting emails always carry the one-click unsubscribe link (re-added if it was edited out).
  let body = m.body;
  if (m.autopilotId) {
    const a = await db().crmProspectingAutopilot.findFirst({ where: { id: m.autopilotId, companyId }, select: { organizationId: true, companyId: true, unsubscribeLine: true } });
    if (a) {
      const { withUnsubscribe } = await import("./prospecting");
      body = withUnsubscribe(body, a, m.toEmail);
    }
  }
  let delivery: Delivery;
  try {
    delivery = await deliver(organizationId, companyId, { to: m.toEmail, subject: m.subject, body, userId: by });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : "send failed";
    await transaction(async (tx) => {
      await tx.crmOutreachMessage.update({ where: { id: m.id }, data: { status: "FAILED", error: message, approvedAt: null } });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.outreach.failed", resourceType: "crm_outreach_message", resourceId: m.id, newValue: { error: message } });
    });
    throw err;
  }
  return transaction(async (tx) => {
    const sent = await tx.crmOutreachMessage.update({ where: { id: m.id }, data: { status: "SENT", sentAt: new Date(), channel: delivery.channel, providerMessageId: delivery.providerMessageId, error: null, body } });
    await logSentEmail(tx, organizationId, companyId, by ?? organizationId, { ...m, body });
    if (m.autopilotId) {
      const { afterAutopilotSend } = await import("./prospecting");
      await afterAutopilotSend(tx, m);
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.outreach.sent", resourceType: "crm_outreach_message", resourceId: m.id, newValue: { to: m.toEmail, channel: delivery.channel, sequence: !!m.enrollmentId } });
    await emitDomainEvent(tx, ctx, "crm.outreach_sent", {
      organizationId,
      companyId,
      entityType: "crm_outreach_message",
      entityId: m.id,
      data: { channel: delivery.channel, leadId: m.leadId, contactId: m.contactId, dealId: m.dealId, sequence: !!m.enrollmentId, autopilot: !!m.autopilotId },
    });
    if (m.enrollmentId) {
      const { advanceAfterSend } = await import("./cadences");
      await advanceAfterSend(tx, m.enrollmentId);
    }
    return sent;
  });
}

export async function listOutreach(ctx: RequestContext, organizationId: string, companyId: string, f: { status?: (typeof OUTREACH_STATUSES)[number]; leadId?: string; contactId?: string; dealId?: string; take?: number } = {}) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  return db().crmOutreachMessage.findMany({
    where: {
      organizationId,
      companyId,
      ...(f.status ? { status: f.status } : {}),
      ...(f.leadId ? { leadId: f.leadId } : {}),
      ...(f.contactId ? { contactId: f.contactId } : {}),
      ...(f.dealId ? { dealId: f.dealId } : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
    take: Math.min(f.take ?? 50, 200),
    include: { enrollment: { select: { cadence: { select: { id: true, name: true } } } } },
  });
}

/** Real outreach numbers for the last `days`: sent, distinct people reached, replies seen in a connected inbox. */
export async function outreachStats(ctx: RequestContext, organizationId: string, companyId: string, days = 30) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const since = new Date(Date.now() - days * 86_400_000);
  const [sent, pending, failed] = await Promise.all([
    db().crmOutreachMessage.findMany({ where: { organizationId, companyId, status: "SENT", sentAt: { gte: since } }, select: { toEmail: true, sentAt: true }, take: 5000 }),
    db().crmOutreachMessage.count({ where: { organizationId, companyId, status: "PENDING_APPROVAL" } }),
    db().crmOutreachMessage.count({ where: { organizationId, companyId, status: "FAILED" } }),
  ]);
  const firstSent = new Map<string, Date>();
  for (const s of sent) {
    const k = s.toEmail.toLowerCase();
    const prev = firstSent.get(k);
    if (!prev || (s.sentAt && s.sentAt < prev)) firstSent.set(k, s.sentAt ?? since);
  }
  const addresses = [...firstSent.keys()];
  const inbound = addresses.length
    ? await db().commsEmailMessage.findMany({
        where: { companyId, direction: "INBOUND", sentAt: { gte: since }, thread: { organizationId }, OR: addresses.slice(0, 500).map((a) => ({ fromAddress: { contains: a, mode: "insensitive" as const } })) },
        select: { fromAddress: true, sentAt: true },
        take: 5000,
      })
    : [];
  const replied = new Set<string>();
  for (const i of inbound) {
    const k = addressIn(i.fromAddress);
    const first = firstSent.get(k);
    if (first && i.sentAt >= first) replied.add(k);
  }
  return { sent: sent.length, people: addresses.length, replied: replied.size, replyRate: addresses.length ? replied.size / addresses.length : null, pending, failed };
}
