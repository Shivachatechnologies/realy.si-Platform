import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { CommsEmailStatus } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { sendPlainEmail } from "@/server/modules/email/service";
import { createTask } from "@/server/modules/agents/service";
import { can } from "@/server/modules/rbac/service";
import { actorId, authorize, isUuid, uuid } from "./common";
import { contextText, customerContext } from "./customer-context";
import { activeConnection, getConnection } from "./connections-bridge";
import { gmailFetchRecent, gmailSend, outlookFetchRecent, outlookSend, ProviderError, type FetchedEmail } from "./providers";

export const MAIL_PROVIDERS = ["gmail", "outlook"] as const;
type MailProvider = (typeof MAIL_PROVIDERS)[number];

const email = z.string().trim().toLowerCase().email().max(254);
const emailList = z.array(email).max(50);
export const accountInput = z.object({ provider: z.enum(MAIL_PROVIDERS), address: email });
export const composeInput = z.object({
  accountId: uuid.optional().or(z.literal("").transform(() => undefined)),
  to: emailList.min(1),
  cc: emailList.default([]),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(50_000),
  contactId: uuid.optional().or(z.literal("").transform(() => undefined)),
});
export const replyInput = z.object({ body: z.string().trim().min(1).max(50_000), to: emailList.optional(), cc: emailList.optional() });
export const threadUpdateInput = z.object({ unread: z.boolean().optional(), contactId: uuid.nullable().optional() });
export const templateInput = z.object({ name: z.string().trim().min(1).max(120), subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(20_000) });
export const emailAiInput = z.object({ mode: z.enum(["draft", "summarize"]), guidance: z.string().trim().max(1000).optional() });

const addressOf = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase();

// ─── Accounts ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function listEmailAccounts(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const accounts = await db().commsEmailAccount.findMany({ where: { organizationId, companyId }, orderBy: { createdAt: "asc" }, take: 50 });
  const status = new Map<string, string>();
  for (const p of MAIL_PROVIDERS) {
    const c = await getConnection(organizationId, companyId, p);
    status.set(p, c ? (c.status === "CONNECTED" && c.accessToken ? "CONNECTED" : "ERROR") : "DISCONNECTED");
  }
  return accounts.map((a) => ({ ...a, connection: status.get(a.provider) ?? "DISCONNECTED" }));
}

export async function addEmailAccount(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof accountInput>) {
  const input = accountInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.manage", tx);
    if (await tx.commsEmailAccount.findFirst({ where: { companyId, provider: input.provider, address: input.address }, select: { id: true } })) {
      throw conflict("This mailbox is already added", { reason: "comms_mailbox_exists" });
    }
    const a = await tx.commsEmailAccount.create({ data: { organizationId, companyId, provider: input.provider, address: input.address, addedById: actorId(ctx, organizationId) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.mailbox.added", resourceType: "comms_email_account", resourceId: a.id, newValue: { provider: a.provider, address: a.address } });
    return a;
  });
}

export async function removeEmailAccount(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.manage", tx);
    if (!isUuid(id)) throw notFound("Mailbox");
    const a = await tx.commsEmailAccount.findFirst({ where: { id, organizationId, companyId } });
    if (!a) throw notFound("Mailbox");
    await tx.commsEmailAccount.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.mailbox.removed", resourceType: "comms_email_account", resourceId: id, oldValue: { provider: a.provider, address: a.address } });
    return { ok: true };
  });
}

async function storeFetched(account: { id: string; organizationId: string; companyId: string; address: string }, messages: FetchedEmail[]) {
  let stored = 0;
  for (const m of messages) {
    const outbound = addressOf(m.from) === account.address;
    const participants = [...new Set([m.from, ...m.to, ...m.cc].map(addressOf).filter((a) => a && a !== account.address))];
    let thread = await db().commsEmailThread.findFirst({ where: { accountId: account.id, providerThreadId: m.providerThreadId } });
    if (!thread) {
      const contact = participants.length
        ? await db().contact.findFirst({ where: { companyId: account.companyId, organizationId: account.organizationId, emailNormalized: { in: participants }, archivedAt: null }, select: { id: true } })
        : null;
      thread = await db().commsEmailThread.create({
        data: {
          organizationId: account.organizationId,
          companyId: account.companyId,
          accountId: account.id,
          providerThreadId: m.providerThreadId,
          subject: (m.subject || "(no subject)").slice(0, 300),
          snippet: m.bodyText.slice(0, 200),
          participants,
          contactId: contact?.id ?? null,
          unread: !outbound,
          lastMessageAt: m.sentAt,
        },
      });
    }
    const exists = await db().commsEmailMessage.findFirst({ where: { threadId: thread.id, providerMessageId: m.providerMessageId }, select: { id: true } });
    if (exists) continue;
    const threadId = thread.id;
    await transaction(async (tx) => {
      const row = await tx.commsEmailMessage.create({
        data: {
          companyId: account.companyId,
          threadId,
          providerMessageId: m.providerMessageId,
          direction: outbound ? "OUTBOUND" : "INBOUND",
          status: outbound ? "SENT" : "RECEIVED",
          fromAddress: m.from.slice(0, 300),
          toAddresses: m.to.slice(0, 50),
          ccAddresses: m.cc.slice(0, 50),
          subject: (m.subject || "(no subject)").slice(0, 300),
          bodyText: m.bodyText,
          attachments: m.attachments as unknown as Prisma.InputJsonValue,
          sentAt: m.sentAt,
        },
      });
      // Inbound mail is announced to the other modules (support turns mail to the support address into tickets).
      if (!outbound) {
        await emitDomainEvent(tx, systemContext(), "comms.email.received", {
          organizationId: account.organizationId,
          companyId: account.companyId,
          entityType: "comms_email_message",
          entityId: row.id,
          data: { accountId: account.id, threadId, from: addressOf(m.from), to: [...m.to, ...m.cc].map(addressOf).join(",").slice(0, 2000), subject: (m.subject || "").slice(0, 300), sentAt: m.sentAt },
        });
      }
    });
    if (m.sentAt >= thread.lastMessageAt) {
      await db().commsEmailThread.update({
        where: { id: thread.id },
        data: { lastMessageAt: m.sentAt, snippet: m.bodyText.slice(0, 200), participants: [...new Set([...thread.participants, ...participants])], ...(outbound ? {} : { unread: true }) },
      });
    }
    stored++;
  }
  return stored;
}

/** Pull recent mail of one mailbox through its provider. Returns stored message count, or null when not connected. */
export async function syncMailbox(accountId: string): Promise<number | null> {
  const account = await db().commsEmailAccount.findUnique({ where: { id: accountId } });
  if (!account) return null;
  const conn = await activeConnection(account.organizationId, account.companyId, account.provider as MailProvider);
  if (!conn) return null;
  try {
    const fetched = account.provider === "gmail" ? await gmailFetchRecent(conn) : await outlookFetchRecent(conn);
    const n = await storeFetched(account, fetched);
    await db().commsEmailAccount.update({ where: { id: account.id }, data: { lastSyncedAt: new Date(), syncError: null } });
    return n;
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : "sync failed";
    await db().commsEmailAccount.update({ where: { id: account.id }, data: { syncError: message } });
    logger.warn({ accountId, provider: account.provider, error: message }, "mailbox sync failed");
    return 0;
  }
}

export async function syncMailboxNow(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "communication.manage");
  if (!isUuid(id) || !(await db().commsEmailAccount.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }))) throw notFound("Mailbox");
  const n = await syncMailbox(id);
  if (n === null) throw invalid("This mailbox's provider isn't connected", { reason: "comms_not_connected" });
  return { stored: n };
}

/** Worker: sync every mailbox (those without a connection are skipped). */
export async function syncAllMailboxes(): Promise<number> {
  const accounts = await db().commsEmailAccount.findMany({ select: { id: true }, orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } }, take: 200 });
  let n = 0;
  for (const a of accounts) n += (await syncMailbox(a.id)) ?? 0;
  return n;
}

// ─── Threads ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ThreadFilters {
  q?: string;
  accountId?: string;
  unread?: boolean;
  contactId?: string;
  cursor?: string;
}

export function parseThreadFilters(raw: Record<string, string | string[] | undefined>): ThreadFilters {
  const one = (k: string) => (Array.isArray(raw[k]) ? raw[k][0] : raw[k])?.trim() || undefined;
  const accountId = one("account");
  const contactId = one("contact");
  const cursor = one("cursor");
  return {
    q: one("q")?.slice(0, 200),
    accountId: isUuid(accountId) ? accountId : accountId === "none" ? "none" : undefined,
    unread: one("unread") === "1" || undefined,
    contactId: isUuid(contactId) ? contactId : undefined,
    cursor: isUuid(cursor) ? cursor : undefined,
  };
}

const PAGE = 30;

export async function listThreads(ctx: RequestContext, organizationId: string, companyId: string, f: ThreadFilters = {}) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const where: Prisma.CommsEmailThreadWhereInput = {
    organizationId,
    companyId,
    ...(f.accountId === "none" ? { accountId: null } : f.accountId ? { accountId: f.accountId } : {}),
    ...(f.unread ? { unread: true } : {}),
    ...(f.contactId ? { contactId: f.contactId } : {}),
    ...(f.q
      ? { OR: [{ subject: { contains: f.q, mode: "insensitive" } }, { snippet: { contains: f.q, mode: "insensitive" } }, { participants: { has: f.q.toLowerCase() } }] }
      : {}),
  };
  const rows = await db().commsEmailThread.findMany({
    where,
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    include: { account: { select: { address: true, provider: true } }, _count: { select: { messages: true } } },
  });
  const page = rows.slice(0, PAGE);
  return { data: page, nextCursor: rows.length > PAGE ? page[page.length - 1]!.id : null };
}

export async function getThread(ctx: RequestContext, organizationId: string, companyId: string, id: string, opts: { markRead?: boolean } = {}) {
  const chain = await authorize(ctx, organizationId, companyId, "communication.read");
  if (!isUuid(id)) throw notFound("Thread");
  const t = await db().commsEmailThread.findFirst({
    where: { id, organizationId, companyId },
    include: { account: { select: { id: true, address: true, provider: true } }, messages: { orderBy: { sentAt: "asc" }, take: 200 } },
  });
  if (!t) throw notFound("Thread");
  if (opts.markRead && t.unread) await db().commsEmailThread.update({ where: { id }, data: { unread: false } });
  const contact = t.contactId ? await db().contact.findFirst({ where: { id: t.contactId, companyId }, select: { id: true, firstName: true, lastName: true, email: true } }) : null;
  const connection = t.account ? (await activeConnection(organizationId, companyId, t.account.provider as MailProvider)) !== null : false;
  return { ...t, contact, connection, canPost: await can(ctx, "communication.post", chain) };
}

export async function updateThread(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof threadUpdateInput>) {
  const input = threadUpdateInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.post", tx);
    if (!isUuid(id) || !(await tx.commsEmailThread.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }))) throw notFound("Thread");
    if (input.contactId && !(await tx.contact.findFirst({ where: { id: input.contactId, organizationId, companyId }, select: { id: true } }))) throw notFound("Contact");
    return tx.commsEmailThread.update({
      where: { id },
      data: { ...(input.unread !== undefined ? { unread: input.unread } : {}), ...(input.contactId !== undefined ? { contactId: input.contactId } : {}) },
    });
  });
}

/** Contacts (shared CRM rows) for the link picker. */
export async function searchContacts(ctx: RequestContext, organizationId: string, companyId: string, q: string) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const contains = { contains: q.slice(0, 100), mode: "insensitive" as const };
  return db().contact.findMany({
    where: { organizationId, companyId, archivedAt: null, ...(q ? { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }] } : {}) },
    select: { id: true, firstName: true, lastName: true, email: true },
    orderBy: { firstName: "asc" },
    take: 20,
  });
}

interface Outgoing {
  account: { id: string; provider: string; address: string } | null;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  providerThreadId?: string | null;
  replyTo?: { providerMessageId: string | null } | null;
}

/**
 * Send through the mailbox's provider when connected; otherwise through the platform mailer (sendPlainEmail).
 * The status is what actually happened — NOT_CONFIGURED / FAILED are never shown as sent.
 */
async function send(ctx: RequestContext, organizationId: string, companyId: string, o: Outgoing, providerOnly = false) {
  const conn = o.account ? await activeConnection(organizationId, companyId, o.account.provider as MailProvider) : null;
  if (providerOnly && !(o.account && conn)) throw new AppError("not_configured", "The thread's mailbox isn't connected; nothing was sent.", { reason: "comms_not_connected" });
  if (o.account && conn) {
    try {
      const r =
        o.account.provider === "gmail"
          ? await gmailSend(conn, { from: o.account.address, to: o.to, cc: o.cc, subject: o.subject, text: o.body, threadId: o.providerThreadId, inReplyTo: null })
          : await outlookSend(conn, { to: o.to, cc: o.cc, subject: o.subject, text: o.body, replyToMessageId: o.replyTo?.providerMessageId ?? null });
      return { status: "SENT" as CommsEmailStatus, providerMessageId: r.providerMessageId, providerThreadId: r.providerThreadId, from: o.account.address, error: null };
    } catch (err) {
      return { status: "FAILED" as CommsEmailStatus, providerMessageId: null, providerThreadId: null, from: o.account.address, error: err instanceof ProviderError ? err.message.slice(0, 300) : "send failed" };
    }
  }
  // Fallback: the platform mailer, one message per recipient (cc'd addresses receive their own copy).
  let status: CommsEmailStatus = "SENT";
  let error: string | null = null;
  for (const to of [...o.to, ...o.cc]) {
    const r = await sendPlainEmail({ to, subject: o.subject, text: o.body, template: "comms.email", organizationId, userId: ctx.actor.id });
    if (r.status !== "SENT") {
      status = r.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED";
      error = r.status;
    }
  }
  return { status, providerMessageId: null, providerThreadId: null, from: "platform", error };
}

export async function composeEmail(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof composeInput>) {
  const input = composeInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "communication.post");
  const account = input.accountId ? await db().commsEmailAccount.findFirst({ where: { id: input.accountId, organizationId, companyId } }) : null;
  if (input.accountId && !account) throw notFound("Mailbox");
  if (input.contactId && !(await db().contact.findFirst({ where: { id: input.contactId, organizationId, companyId }, select: { id: true } }))) throw notFound("Contact");
  const r = await send(ctx, organizationId, companyId, { account, to: input.to, cc: input.cc, subject: input.subject, body: input.body });
  return transaction(async (tx) => {
    const thread = await tx.commsEmailThread.create({
      data: {
        organizationId,
        companyId,
        accountId: account?.id ?? null,
        providerThreadId: r.providerThreadId,
        subject: input.subject,
        snippet: input.body.slice(0, 200),
        participants: [...input.to, ...input.cc],
        contactId: input.contactId ?? null,
        unread: false,
      },
    });
    await tx.commsEmailMessage.create({
      data: { companyId, threadId: thread.id, providerMessageId: r.providerMessageId, direction: "OUTBOUND", status: r.status, fromAddress: r.from, toAddresses: input.to, ccAddresses: input.cc, subject: input.subject, bodyText: input.body, error: r.error, sentById: ctx.actor.id },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.email.sent", resourceType: "comms_email_thread", resourceId: thread.id, newValue: { to: input.to.length, status: r.status, via: account?.provider ?? "platform" } });
    return { thread, status: r.status };
  });
}

export async function replyToThread(ctx: RequestContext, organizationId: string, companyId: string, threadId: string, raw: z.input<typeof replyInput>, opts: { providerOnly?: boolean } = {}) {
  const input = replyInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "communication.post");
  if (!isUuid(threadId)) throw notFound("Thread");
  const thread = await db().commsEmailThread.findFirst({ where: { id: threadId, organizationId, companyId }, include: { account: true, messages: { orderBy: { sentAt: "desc" }, take: 20 } } });
  if (!thread) throw notFound("Thread");
  const lastInbound = thread.messages.find((m) => m.direction === "INBOUND") ?? null;
  const to = input.to?.length ? input.to : lastInbound ? [addressOf(lastInbound.fromAddress)] : thread.participants.slice(0, 1);
  if (!to.length) throw invalid("No recipient", { reason: "comms_no_recipient" });
  const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
  const r = await send(ctx, organizationId, companyId, { account: thread.account, to, cc: input.cc ?? [], subject, body: input.body, providerThreadId: thread.providerThreadId, replyTo: lastInbound }, opts.providerOnly);
  return transaction(async (tx) => {
    const message = await tx.commsEmailMessage.create({
      data: { companyId, threadId, providerMessageId: r.providerMessageId, direction: "OUTBOUND", status: r.status, fromAddress: r.from, toAddresses: to, ccAddresses: input.cc ?? [], subject, bodyText: input.body, error: r.error, sentById: ctx.actor.id },
    });
    await tx.commsEmailThread.update({ where: { id: threadId }, data: { lastMessageAt: new Date(), snippet: input.body.slice(0, 200), unread: false } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.email.replied", resourceType: "comms_email_thread", resourceId: threadId, newValue: { status: r.status, via: thread.account?.provider ?? "platform" } });
    return { message, status: r.status };
  });
}

/**
 * Reply in a synced mailbox thread for another module that already authorized its caller (support tickets that came
 * in by email). Sent only through the thread's own connected mailbox, so the customer sees it in the same conversation;
 * NOT_CONFIGURED (nothing sent) when that mailbox isn't connected. The message is stored on the thread either way.
 */
export async function replyInThreadAs(organizationId: string, companyId: string, threadId: string, input: { to: string; body: string; sentById: string | null }) {
  const thread = await db().commsEmailThread.findFirst({ where: { id: threadId, organizationId, companyId }, include: { account: true, messages: { orderBy: { sentAt: "desc" }, take: 20 } } });
  if (!thread?.account) return { status: "NOT_CONFIGURED" as CommsEmailStatus, providerMessageId: null as string | null };
  const conn = await activeConnection(organizationId, companyId, thread.account.provider as MailProvider);
  if (!conn) return { status: "NOT_CONFIGURED" as CommsEmailStatus, providerMessageId: null as string | null };
  const lastInbound = thread.messages.find((m) => m.direction === "INBOUND") ?? null;
  const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
  const r = await send(systemContext(), organizationId, companyId, { account: thread.account, to: [input.to], cc: [], subject, body: input.body, providerThreadId: thread.providerThreadId, replyTo: lastInbound }, true);
  await transaction(async (tx) => {
    await tx.commsEmailMessage.create({
      data: { companyId, threadId, providerMessageId: r.providerMessageId, direction: "OUTBOUND", status: r.status, fromAddress: r.from, toAddresses: [input.to], ccAddresses: [], subject, bodyText: input.body, error: r.error, sentById: input.sentById },
    });
    await tx.commsEmailThread.update({ where: { id: threadId }, data: { lastMessageAt: new Date(), snippet: input.body.slice(0, 200), unread: false } });
  });
  return { status: r.status, providerMessageId: r.providerMessageId };
}

// ─── Templates ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function listTemplates(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  return db().commsEmailTemplate.findMany({ where: { organizationId, companyId }, orderBy: { name: "asc" }, take: 200 });
}

export async function saveTemplate(ctx: RequestContext, organizationId: string, companyId: string, id: string | null, raw: z.input<typeof templateInput>) {
  const input = templateInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.manage", tx);
    const clash = await tx.commsEmailTemplate.findFirst({ where: { companyId, name: input.name, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
    if (clash) throw conflict("A template with this name exists", { reason: "comms_template_exists" });
    if (id) {
      if (!isUuid(id) || !(await tx.commsEmailTemplate.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }))) throw notFound("Template");
      return tx.commsEmailTemplate.update({ where: { id }, data: input });
    }
    const t = await tx.commsEmailTemplate.create({ data: { ...input, organizationId, companyId, createdById: actorId(ctx, organizationId) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.template.created", resourceType: "comms_email_template", resourceId: t.id });
    return t;
  });
}

export async function deleteTemplate(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.manage", tx);
    if (!isUuid(id) || !(await tx.commsEmailTemplate.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }))) throw notFound("Template");
    await tx.commsEmailTemplate.delete({ where: { id } });
    return { ok: true };
  });
}

// ─── AI ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const AI: Record<"draft" | "summarize", { title: string; instructions: (id: string) => string }> = {
  draft: {
    title: "Email reply draft",
    instructions: (id) =>
      `Call read_inbox_thread with threadId ${id}. Draft a reply to the latest message: a concise, specific plain-text body that answers every question asked, in the language of the thread. This is a draft for a person to review — do not call send_email_reply and never say it was sent.`,
  },
  summarize: {
    title: "Email thread summary",
    instructions: (id) =>
      `Call read_inbox_thread with threadId ${id}. Summarize the thread: who is involved, what is being asked or agreed, open questions, and the next step with an owner. Use only the thread's content.`,
  },
};

export async function emailAi(ctx: RequestContext, organizationId: string, companyId: string, threadId: string, raw: z.input<typeof emailAiInput>) {
  const input = emailAiInput.parse(raw);
  const t = await getThread(ctx, organizationId, companyId, threadId);
  const spec = AI[input.mode];
  // Ground drafts in the relationship: CRM contact/account, deals and open tickets the requester may see.
  const crm = input.mode === "draft" ? contextText(await customerContext(ctx, organizationId, companyId, t.contactId, { excludeThreadId: t.id })) : "";
  return createTask(ctx, organizationId, companyId, {
    profile: "chief_of_staff",
    title: `${spec.title}: ${t.subject}`.slice(0, 200),
    instructions: [
      spec.instructions(t.id),
      crm ? `Customer context from the CRM and support desk (use only where relevant; search the company brain for policies or product facts you need):\n${crm}` : null,
      input.guidance ? `Additional direction from the requester: ${input.guidance}` : null,
    ]
      .filter(Boolean)
      .join("\n\n"),
    subject: { type: "email_thread", id: t.id },
  });
}
