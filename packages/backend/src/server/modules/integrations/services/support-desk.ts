import "server-only";
import { providerFetch } from "../client";
import { zendeskBase } from "../providers";
import { recordUsage } from "../usage";
import { ensureOk, withFallback, type ServiceResult } from "./common";

/**
 * Support-platform adapters (API key): Zendesk tickets and Intercom conversations. Replies are external messages:
 * callers gate them (SUPERVISED tools / explicit user action) and disclose AI authorship where it applies.
 */

export interface SupportTicket {
  id: string;
  subject: string;
  status: string | null;
  requester: string | null;
  updatedAt: string | null;
  url: string | null;
}

export async function listZendeskTickets(organizationId: string, companyId: string, opts: { status?: "new" | "open" | "pending" } = {}): Promise<ServiceResult<SupportTicket[]>> {
  return withFallback(organizationId, companyId, ["zendesk"], async (conn) => {
    const base = zendeskBase(conn.config);
    if (!base) throw new Error("Zendesk subdomain missing");
    const q = `type:ticket${opts.status ? ` status:${opts.status}` : " status<solved"}`;
    const res = await providerFetch<{ results?: { id: number; subject?: string; status?: string; requester_id?: number; updated_at?: string }[] }>(conn, `${base}/search.json?${new URLSearchParams({ query: q, sort_by: "updated_at", sort_order: "desc", per_page: "50" })}`, { retries: 2 });
    ensureOk(res, "Zendesk tickets");
    const host = base.replace("/api/v2", "");
    return (res.data?.results ?? []).map((t) => ({ id: String(t.id), subject: t.subject ?? "", status: t.status ?? null, requester: t.requester_id ? String(t.requester_id) : null, updatedAt: t.updated_at ?? null, url: `${host}/agent/tickets/${t.id}` }));
  });
}

export async function createZendeskTicket(organizationId: string, companyId: string, input: { subject: string; body: string; requesterEmail: string; requesterName?: string; priority?: "low" | "normal" | "high" | "urgent" }): Promise<ServiceResult<{ id: string; url: string }>> {
  if (!input.subject.trim() || !input.body.trim()) return { ok: false, code: "invalid_input", error: "Subject and description are required", providerId: null, attempts: [] };
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(input.requesterEmail)) return { ok: false, code: "invalid_input", error: "Invalid requester email", providerId: null, attempts: [] };
  return withFallback(organizationId, companyId, ["zendesk"], async (conn) => {
    const base = zendeskBase(conn.config);
    if (!base) throw new Error("Zendesk subdomain missing");
    const res = await providerFetch<{ ticket?: { id?: number } }>(conn, `${base}/tickets.json`, {
      json: { ticket: { subject: input.subject.slice(0, 250), comment: { body: input.body.slice(0, 20_000) }, requester: { email: input.requesterEmail, ...(input.requesterName ? { name: input.requesterName.slice(0, 120) } : {}) }, ...(input.priority ? { priority: input.priority } : {}) } },
      retries: 1,
    });
    ensureOk(res, "Zendesk ticket");
    const id = res.data?.ticket?.id;
    if (!id) throw new Error("Zendesk returned no ticket id");
    await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "zendesk", operation: "support.ticket_create", status: "SUCCEEDED", meta: { ticketId: id } });
    return { id: String(id), url: `${base.replace("/api/v2", "")}/agent/tickets/${id}` };
  });
}

const INTERCOM = "https://api.intercom.io";

export async function listIntercomConversations(organizationId: string, companyId: string): Promise<ServiceResult<SupportTicket[]>> {
  return withFallback(organizationId, companyId, ["intercom"], async (conn) => {
    const res = await providerFetch<{ conversations?: { id: string; title?: string | null; state?: string; updated_at?: number; source?: { subject?: string; author?: { email?: string; name?: string } } }[] }>(conn, `${INTERCOM}/conversations?per_page=50`, { retries: 2 });
    ensureOk(res, "Intercom conversations");
    const appId = typeof conn.config.appId === "string" ? conn.config.appId : null;
    return (res.data?.conversations ?? []).map((c) => ({
      id: c.id,
      subject: c.title ?? c.source?.subject ?? "",
      status: c.state ?? null,
      requester: c.source?.author?.email ?? c.source?.author?.name ?? null,
      updatedAt: c.updated_at ? new Date(c.updated_at * 1000).toISOString() : null,
      url: appId ? `https://app.intercom.com/a/inbox/${appId}/inbox/conversation/${c.id}` : null,
    }));
  });
}

/** Reply to an Intercom conversation as an admin (or add an internal note). */
export async function replyIntercomConversation(organizationId: string, companyId: string, input: { conversationId: string; adminId: string; body: string; note?: boolean }): Promise<ServiceResult<{ id: string }>> {
  if (!/^\d{1,30}$/.test(input.conversationId) || !/^\d{1,30}$/.test(input.adminId)) return { ok: false, code: "invalid_input", error: "Invalid conversation or admin id", providerId: null, attempts: [] };
  if (!input.body.trim()) return { ok: false, code: "invalid_input", error: "Reply is empty", providerId: null, attempts: [] };
  return withFallback(organizationId, companyId, ["intercom"], async (conn) => {
    const res = await providerFetch<{ id?: string }>(conn, `${INTERCOM}/conversations/${input.conversationId}/reply`, { json: { message_type: input.note ? "note" : "comment", type: "admin", admin_id: input.adminId, body: input.body.slice(0, 10_000) }, retries: 1 });
    ensureOk(res, "Intercom reply");
    await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "intercom", operation: input.note ? "support.note" : "support.reply", status: "SUCCEEDED", meta: { conversationId: input.conversationId } });
    return { id: res.data?.id ?? input.conversationId };
  });
}
