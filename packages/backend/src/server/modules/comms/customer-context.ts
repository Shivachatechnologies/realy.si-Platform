import "server-only";
import { z } from "zod";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { getControls } from "@/server/core/platform-controls";
import { generateText } from "@/server/modules/integrations/services/ai-text";
import { can } from "@/server/modules/rbac/service";
import { authorize, isUuid } from "./common";

/**
 * Customer context for communication: the CRM contact, account, open deals and open support tickets behind an email
 * thread (each part only when the viewer may read that area). Feeds the thread's side panel and AI drafts so replies
 * are grounded in the real relationship, and gives CRM pages the conversations linked to a contact or account.
 */

export interface CustomerContext {
  contact: { id: string; name: string; email: string | null; title: string | null } | null;
  account: { id: string; name: string; type: string } | null;
  deals: { id: string; name: string; stage: string; status: string; amountMinor: bigint; currency: string }[] | null;
  tickets: { id: string; number: number; subject: string; status: string; priority: string }[] | null;
  threads: { id: string; subject: string; lastMessageAt: Date; unread: boolean }[];
}

export async function customerContext(ctx: RequestContext, organizationId: string, companyId: string, contactId: string | null, opts: { excludeThreadId?: string } = {}): Promise<CustomerContext> {
  const chain = await authorize(ctx, organizationId, companyId, "communication.read");
  const empty: CustomerContext = { contact: null, account: null, deals: null, tickets: null, threads: [] };
  if (!contactId || !isUuid(contactId)) return empty;
  const contact = await db().contact.findFirst({
    where: { id: contactId, organizationId, companyId },
    select: { id: true, firstName: true, lastName: true, email: true, title: true, account: { select: { id: true, name: true, type: true } } },
  });
  if (!contact) return empty;
  const [salesRead, supportRead] = await Promise.all([can(ctx, "sales.read", chain), can(ctx, "support.read", chain)]);
  const accountId = contact.account?.id ?? null;
  const [deals, tickets, threads] = await Promise.all([
    salesRead
      ? db().crmDeal.findMany({
          where: { organizationId, companyId, archivedAt: null, OR: [{ contactId }, ...(accountId ? [{ accountId }] : [])] },
          select: { id: true, name: true, status: true, amountMinor: true, currency: true, stage: { select: { name: true } } },
          orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
          take: 5,
        })
      : null,
    supportRead
      ? db().supportTicket.findMany({
          where: { organizationId, companyId, status: { in: ["NEW", "OPEN", "PENDING", "ON_HOLD"] }, OR: [{ requesterId: contactId }, ...(accountId ? [{ accountId }] : [])] },
          select: { id: true, number: true, subject: true, status: true, priority: true },
          orderBy: { updatedAt: "desc" },
          take: 5,
        })
      : null,
    db().commsEmailThread.findMany({
      where: { organizationId, companyId, contactId, ...(opts.excludeThreadId ? { id: { not: opts.excludeThreadId } } : {}) },
      select: { id: true, subject: true, lastMessageAt: true, unread: true },
      orderBy: { lastMessageAt: "desc" },
      take: 5,
    }),
  ]);
  return {
    contact: { id: contact.id, name: `${contact.firstName} ${contact.lastName ?? ""}`.trim(), email: contact.email, title: contact.title },
    account: contact.account ? { id: contact.account.id, name: contact.account.name, type: String(contact.account.type) } : null,
    deals: deals ? deals.map((d) => ({ id: d.id, name: d.name, stage: d.stage.name, status: d.status, amountMinor: d.amountMinor, currency: d.currency })) : null,
    tickets: tickets ? tickets.map((x) => ({ ...x, status: String(x.status), priority: String(x.priority) })) : null,
    threads,
  };
}

export function contextText(c: CustomerContext): string {
  const lines: string[] = [];
  if (c.contact) lines.push(`Contact: ${c.contact.name}${c.contact.title ? `, ${c.contact.title}` : ""}`);
  if (c.account) lines.push(`Company: ${c.account.name} (${c.account.type.toLowerCase()})`);
  if (c.deals?.length) lines.push(`Deals: ${c.deals.map((d) => `${d.name} — ${d.status === "OPEN" ? d.stage : d.status.toLowerCase()}`).join("; ")}`);
  if (c.tickets?.length) lines.push(`Open support tickets: ${c.tickets.map((x) => `#${x.number} ${x.subject} (${x.status.toLowerCase()})`).join("; ")}`);
  return lines.join("\n");
}

export const quickDraftInput = z.object({
  guidance: z.string().trim().max(1000).optional(),
  tone: z.enum(["friendly", "formal", "short"]).default("friendly"),
});

export type QuickDraft = { status: "ok"; body: string; model: string; usedContext: string[] } | { status: "not_connected" } | { status: "paused" } | { status: "failed"; error: string };

/**
 * Instant AI reply draft for a thread through the company's connected AI text provider (OpenAI / Gemini in
 * Integrations), grounded in the thread and its CRM/support context. Returns the text for the person to edit — it is
 * never sent from here. Without a provider it says so honestly (the AI employee draft remains available).
 */
export async function quickReplyDraft(ctx: RequestContext, organizationId: string, companyId: string, threadId: string, raw: z.input<typeof quickDraftInput>): Promise<QuickDraft> {
  const input = quickDraftInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "communication.post");
  if (!isUuid(threadId)) throw notFound("Thread");
  const thread = await db().commsEmailThread.findFirst({
    where: { id: threadId, organizationId, companyId },
    select: { id: true, subject: true, contactId: true, account: { select: { address: true } }, messages: { orderBy: { sentAt: "desc" }, take: 8, select: { direction: true, fromAddress: true, bodyText: true, sentAt: true } } },
  });
  if (!thread) throw notFound("Thread");
  const controls = await getControls().catch(() => null);
  if (controls && (!controls.aiWorkforceEnabled || controls.aiExecutionPaused)) return { status: "paused" };
  const company = await db().company.findFirst({ where: { id: companyId, organizationId }, select: { name: true } });
  const cc = await customerContext(ctx, organizationId, companyId, thread.contactId, { excludeThreadId: thread.id });
  const crm = contextText(cc);
  const history = [...thread.messages]
    .reverse()
    .map((m) => `--- ${m.direction === "INBOUND" ? `From ${m.fromAddress}` : `From us`} (${m.sentAt.toISOString().slice(0, 10)}):\n${m.bodyText.slice(0, 3000)}`)
    .join("\n\n");
  const tone = { friendly: "warm, clear and helpful", formal: "polite and formal", short: "very brief — three sentences at most" }[input.tone];
  const r = await generateText(organizationId, companyId, {
    system: [
      `You write email replies on behalf of ${company?.name ?? "the company"}. Write only the reply body as plain text, in the language of the latest incoming message, ${tone}.`,
      "Answer every question asked. Use the customer context only where relevant. Never invent facts, prices, dates, commitments or attachments — if something is unknown, say a colleague will confirm it. No subject line, no placeholders like [Name] unless the name is unknown.",
    ].join(" "),
    prompt: [`Subject: ${thread.subject}`, crm ? `Customer context (from our CRM and support desk):\n${crm}` : "", `Conversation (oldest first):\n${history}`, input.guidance ? `What the reply should do: ${input.guidance}` : ""].filter(Boolean).join("\n\n"),
    maxOutputTokens: 900,
    temperature: 0.4,
  }).catch((err: unknown) => ({ ok: false as const, code: "provider_error" as const, error: err instanceof Error ? err.message : "failed" }));
  if (!r.ok) return r.code === "not_connected" ? { status: "not_connected" } : { status: "failed", error: r.error.slice(0, 300) };
  const used = [cc.contact ? "contact" : null, cc.account ? "account" : null, cc.deals?.length ? "deals" : null, cc.tickets?.length ? "tickets" : null].filter((x): x is string => Boolean(x));
  return { status: "ok", body: r.data.text.trim().slice(0, 20_000), model: r.data.model, usedContext: used };
}

/** Conversations linked to a CRM contact or account (for CRM record pages). */
export async function customerConversations(ctx: RequestContext, organizationId: string, companyId: string, ref: { contactId?: string; accountId?: string }) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  let contactIds: string[] = [];
  if (ref.contactId && isUuid(ref.contactId)) contactIds = [ref.contactId];
  else if (ref.accountId && isUuid(ref.accountId)) contactIds = (await db().contact.findMany({ where: { organizationId, companyId, accountId: ref.accountId }, select: { id: true }, take: 200 })).map((c) => c.id);
  if (!contactIds.length) return [];
  return db().commsEmailThread.findMany({
    where: { organizationId, companyId, contactId: { in: contactIds } },
    select: { id: true, subject: true, snippet: true, lastMessageAt: true, unread: true, participants: true },
    orderBy: { lastMessageAt: "desc" },
    take: 20,
  });
}
