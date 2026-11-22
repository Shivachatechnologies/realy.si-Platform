import { db, transaction } from "@/server/core/db";
import { systemContext } from "@/server/core/context";
import { logger } from "@/server/core/logger";
import { isModuleEnabled, isOrganizationSuspended } from "@/server/core/platform-controls";
import type { OutboxEvent } from "@/server/modules/events/relay";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { activeConnection } from "@/server/modules/comms/connections-bridge";
import { usableConnection } from "@/server/modules/integrations/services/common";
import { normalizeEmail } from "./common";
import { appendInboundMessage, createInboundTicket } from "./tickets";

/**
 * Inbound support channels (worker event handlers, support/jobs.ts):
 *
 * - Email: mailbox sync (comms/email.ts) emits comms.email.received for each new inbound message. Mail addressed to
 *   the company's support address (or received by the mailbox that IS the support address) becomes a ticket, threaded
 *   by the mailbox conversation (Gmail thread / Outlook conversation, built from Message-ID / References), then by a
 *   "[#123]" ticket number in the subject from the same requester. Replies go back through that mailbox thread.
 *   Only mail sent after the channel was turned on is imported; bounces, auto-generated mail and mail from the
 *   company's own address are skipped.
 * - WhatsApp: the platform WhatsApp webhook (integrations/own-account-webhooks.ts) routes each message to the company
 *   that owns the number and emits integration.whatsapp.message_received. With the WhatsApp channel on, a message
 *   continues the sender's open WhatsApp ticket (activity in the last 7 days) or opens a new one. Briefing commands
 *   from the team's own verified numbers are left to the briefing module.
 *
 * Everything is deduped by the provider message id (SupportMessage.externalMessageId), so redeliveries are harmless.
 */

const DAY = 86_400_000;
const AUTO_FROM = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce[s]?|notifications?)@/i;
const AUTO_SUBJECT = /^(undeliverable|delivery status notification|mail delivery (failed|subsystem)|returned mail|auto(matic)?[\s-]?reply|out of (the )?office)\b/i;
const TICKET_REF = /\[#(\d{1,9})\]/;

const displayName = (from: string) => {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  return m?.[1]?.trim().slice(0, 200) || null;
};
const addressOf = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase();

async function moduleOpen(organizationId: string) {
  return (await isModuleEnabled(organizationId, "support")) && !(await isOrganizationSuspended(organizationId));
}

/** Text of an email without the quoted earlier messages, for appending to an existing ticket. */
export function newPartOf(body: string): string {
  const cut = body.search(/^(on .{0,200}wrote:|am .{0,200}schrieb .{0,80}:|-----\s*original message\s*-----)$/im);
  const head = cut > 0 ? body.slice(0, cut) : body;
  const lines = head.split(/\r?\n/).filter((l) => !l.trimStart().startsWith(">"));
  return lines.join("\n").trim() || body.trim();
}

export type InboundResult = "created" | "appended" | "duplicate" | "skipped";

/** comms.email.received → ticket (or a message on the ticket of the same thread). */
export async function ingestSupportEmail(event: Pick<OutboxEvent, "organizationId" | "companyId" | "aggregateId">): Promise<InboundResult> {
  const { organizationId, companyId } = event;
  if (!organizationId || !companyId) return "skipped";
  const settings = await db().supportSettings.findUnique({ where: { companyId } });
  if (!settings || settings.organizationId !== organizationId || !settings.emailChannelEnabled || !settings.supportEmail) return "skipped";
  const msg = await db().commsEmailMessage.findFirst({
    where: { id: event.aggregateId, companyId, direction: "INBOUND", thread: { organizationId } },
    include: { thread: { include: { account: { select: { id: true, address: true } } } } },
  });
  if (!msg) return "skipped";
  const support = settings.supportEmail.toLowerCase();
  const from = addressOf(msg.fromAddress);
  const recipients = [...msg.toAddresses, ...msg.ccAddresses].map(addressOf);
  const mailbox = msg.thread.account?.address.toLowerCase() ?? null;
  if (mailbox !== support && !recipients.includes(support)) return "skipped";
  if (!from || from === support || from === mailbox || AUTO_FROM.test(from) || AUTO_SUBJECT.test(msg.subject)) return "skipped";
  const since = settings.emailChannelEnabledAt ?? new Date(Date.now() - 7 * DAY);
  if (msg.sentAt < since) return "skipped";
  if (!(await moduleOpen(organizationId))) return "skipped";

  const externalMessageId = `email:${msg.providerMessageId ?? msg.id}`;
  if (await db().supportMessage.findFirst({ where: { companyId, externalMessageId }, select: { id: true } })) return "duplicate";
  const threadKey = `email:${msg.threadId}`;
  // 1) Same mailbox conversation. 2) "[#123]" in the subject, from the ticket's requester.
  let ticket = await db().supportTicket.findFirst({ where: { organizationId, companyId, externalThreadKey: threadKey, status: { not: "CLOSED" } }, orderBy: { createdAt: "desc" } });
  if (!ticket) {
    const ref = Number(msg.subject.match(TICKET_REF)?.[1] ?? 0);
    if (ref) {
      const t = await db().supportTicket.findFirst({ where: { organizationId, companyId, number: ref, status: { not: "CLOSED" } }, include: { requester: { select: { emailNormalized: true } } } });
      if (t && t.requester?.emailNormalized === normalizeEmail(from)) {
        ticket = t;
        if (!t.externalThreadKey) await db().supportTicket.update({ where: { id: t.id }, data: { externalThreadKey: threadKey } });
      }
    }
  }
  if (ticket) {
    const m = await appendInboundMessage(ticket, { body: newPartOf(msg.bodyText), authorName: displayName(msg.fromAddress), externalMessageId });
    return m ? "appended" : "duplicate";
  }
  const t = await createInboundTicket(organizationId, companyId, {
    channel: "EMAIL",
    subject: msg.subject.replace(/^\s*((re|fwd?|aw|wg):\s*)+/i, "").trim() || "(no subject)",
    description: msg.bodyText,
    requesterEmail: from,
    requesterName: displayName(msg.fromAddress) ?? undefined,
    externalThreadKey: threadKey,
    externalMessageId,
    note: `Created from an email to ${support} from ${from}.`,
  });
  return t ? "created" : "duplicate";
}

/** The requester contact of a WhatsApp number (matched on the normalized phone; created when unknown). */
async function whatsappRequester(organizationId: string, companyId: string, phone: string) {
  const digits = phone.replace(/\D/g, "");
  const phoneNormalized = digits.slice(-10);
  const existing = await db().contact.findFirst({ where: { organizationId, companyId, phoneNormalized, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (existing) return existing.id;
  const company = await db().company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { createdById: true } });
  return transaction(async (tx) => {
    const c = await tx.contact.create({ data: { organizationId, companyId, firstName: phone, phone, phoneNormalized, tags: ["support", "whatsapp"], createdById: company.createdById }, select: { id: true } });
    await emitDomainEvent(tx, systemContext(), "contact.created", { organizationId, companyId, entityType: "contact", entityId: c.id, data: { phone: phoneNormalized, source: "support_whatsapp" } });
    return c.id;
  });
}

/** integration.whatsapp.message_received → ticket (or a message on the sender's open WhatsApp ticket). */
export async function ingestSupportWhatsApp(event: Pick<OutboxEvent, "organizationId" | "companyId" | "aggregateId" | "payload">): Promise<InboundResult> {
  const { organizationId, companyId } = event;
  if (!organizationId || !companyId) return "skipped";
  const data = ((event.payload as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>;
  const from = typeof data.from === "string" && /^\+[1-9]\d{6,14}$/.test(data.from) ? data.from : null;
  const text = typeof data.text === "string" ? data.text.trim() : "";
  const messageId = event.aggregateId;
  if (!from || !text || !messageId) return "skipped";
  const settings = await db().supportSettings.findUnique({ where: { companyId }, select: { organizationId: true, whatsappChannelEnabled: true } });
  if (!settings || settings.organizationId !== organizationId || !settings.whatsappChannelEnabled) return "skipped";
  // The team's own verified numbers talk to the briefing module, not to support.
  if (/^realy ?\d{6}$/i.test(text)) return "skipped";
  if (await db().briefingSubscription.findFirst({ where: { organizationId, companyId, whatsappNumber: from, whatsappVerifiedAt: { not: null } }, select: { id: true } })) return "skipped";
  if (!(await moduleOpen(organizationId))) return "skipped";

  const externalMessageId = `whatsapp:${messageId}`;
  if (await db().supportMessage.findFirst({ where: { companyId, externalMessageId }, select: { id: true } })) return "duplicate";
  const threadKey = `whatsapp:${from}`;
  const open = await db().supportTicket.findFirst({
    where: { organizationId, companyId, externalThreadKey: threadKey, status: { not: "CLOSED" }, updatedAt: { gte: new Date(Date.now() - 7 * DAY) } },
    orderBy: { updatedAt: "desc" },
  });
  if (open) {
    const m = await appendInboundMessage(open, { body: text, authorName: null, externalMessageId });
    return m ? "appended" : "duplicate";
  }
  const requesterId = await whatsappRequester(organizationId, companyId, from);
  const firstLine = text.split(/\r?\n/)[0]!.trim();
  const t = await createInboundTicket(organizationId, companyId, {
    channel: "WHATSAPP",
    subject: firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine,
    description: text,
    requesterId,
    externalThreadKey: threadKey,
    externalMessageId,
    note: `Created from a WhatsApp message from ${from}.`,
  });
  return t ? "created" : "duplicate";
}

/** Event handler wrapper: log, never throw on a single bad message (the relay retries real failures). */
export async function handleInbound(kind: "email" | "whatsapp", event: OutboxEvent) {
  const r = kind === "email" ? await ingestSupportEmail(event) : await ingestSupportWhatsApp(event);
  if (r === "created" || r === "appended") logger.info({ eventId: event.id, companyId: event.companyId, result: r, channel: kind }, "support inbound message");
  return r;
}

export interface InboundChannelStatus {
  email:
    | { state: "no_address" }
    | { state: "ready"; mailbox: string; provider: string }
    | { state: "other_mailbox"; mailbox: string; provider: string }
    | { state: "no_mailbox" };
  whatsapp: { state: "ready" | "not_connected" };
}

/**
 * What the inbound channels can really do right now (settings and setup pages): is there a connected mailbox that
 * receives mail to the support address, and is a WhatsApp Business number connected to the platform webhook.
 */
export async function inboundChannelStatus(organizationId: string, companyId: string, supportEmail: string | null): Promise<InboundChannelStatus> {
  const accounts = await db().commsEmailAccount.findMany({ where: { organizationId, companyId, provider: { in: ["gmail", "outlook"] } }, orderBy: { createdAt: "asc" }, take: 20, select: { address: true, provider: true } });
  const connected: { address: string; provider: string }[] = [];
  for (const a of accounts) if (await activeConnection(organizationId, companyId, a.provider as "gmail" | "outlook")) connected.push(a);
  const support = supportEmail?.toLowerCase() ?? null;
  const same = support ? connected.find((a) => a.address.toLowerCase() === support) : undefined;
  const email: InboundChannelStatus["email"] = !support
    ? { state: "no_address" }
    : same
      ? { state: "ready", mailbox: same.address, provider: same.provider }
      : connected[0]
        ? { state: "other_mailbox", mailbox: connected[0].address, provider: connected[0].provider }
        : { state: "no_mailbox" };
  // Inbound WhatsApp reaches companies through Realy's Meta app (Connect → WhatsApp Business).
  const wa = await usableConnection(organizationId, companyId, "whatsapp");
  return { email, whatsapp: { state: wa && wa.config.phoneNumberId ? "ready" : "not_connected" } };
}
