import { z } from "zod";
import { AppError } from "@/server/core/errors";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { contactName } from "./common";
import { listCategories } from "./config";
import { searchArticles } from "./kb";
import { addMessage, getTicket, listTickets, parseTicketFilters, storeDraftReply, VIEWS } from "./tickets";

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—");

/** AI tools of the support module, registered in src/server/modules/tools/modules.ts. */
export const SUPPORT_TOOLS: Record<string, ToolDefinition> = {
  read_ticket: def({
    name: "read_ticket",
    version: 1,
    description: "Read one support ticket: subject, requester, account, status, priority, category, SLA due times and breaches, rule-based classification, the full conversation (public replies and internal notes) and the categories available.",
    input: z.object({ ticketId: z.string().uuid() }).strict(),
    modelSchema: { type: "object", properties: { ticketId: { type: "string", description: "Ticket id" } }, required: ["ticketId"], additionalProperties: false },
    permissions: ["support.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ ticketId }) => `Read ticket ${ticketId}`,
    async execute({ ticketId }, { ctx, organizationId, companyId }) {
      const t = await getTicket(ctx, organizationId, companyId, ticketId);
      const categories = await listCategories(ctx, organizationId, companyId);
      const conversation = t.messages
        .filter((m) => m.authorType !== "SYSTEM")
        .map((m) => `--- ${m.kind === "INTERNAL_NOTE" ? (m.isDraft ? "AI draft (internal)" : "Internal note") : m.authorType === "CUSTOMER" ? "Customer" : "Agent reply"} · ${m.authorName ?? ""} · ${iso(m.createdAt)}\n${m.body.slice(0, 4000)}`)
        .join("\n\n");
      const content = [
        `Ticket #${t.number}: ${t.subject}`,
        `Status ${t.status} · priority ${t.priority} · channel ${t.channel} · category ${t.category?.name ?? "none"} · tags ${t.tags.join(", ") || "none"}`,
        `Requester: ${t.requester ? `${contactName(t.requester)} <${t.requester.email ?? ""}>` : "unknown"} · account ${t.account?.name ?? "none"}`,
        `Assignee: ${t.assigneeName ?? "unassigned"} · created ${iso(t.createdAt)}`,
        `SLA: first response due ${iso(t.firstResponseDueAt)}${t.firstResponseBreachedAt ? " (BREACHED)" : ""}, responded ${iso(t.firstRespondedAt)}; resolution due ${iso(t.resolutionDueAt)}${t.resolutionBreachedAt ? " (BREACHED)" : ""}`,
        `Rule-based classification: ${JSON.stringify(t.classification ?? {})}`,
        `Categories available: ${categories.map((c) => c.name).join(", ") || "none"}`,
        `Other tickets from this requester: ${t.otherTickets.map((o) => `#${o.number} ${o.subject} (${o.status})`).join("; ") || "none"}`,
        `Original request:\n${t.description ?? "(none)"}`,
        `Conversation:\n${conversation || "(no messages yet)"}`,
      ].join("\n\n");
      return { content, records: [`ticket:${t.id}`] };
    },
  }),

  search_kb_articles: def({
    name: "search_kb_articles",
    version: 1,
    description: "Search the support knowledge base (help articles). Returns up to 6 matching articles with title, status and text. Prefer published articles when answering customers.",
    input: z.object({ query: z.string().trim().min(1).max(200) }).strict(),
    modelSchema: { type: "object", properties: { query: { type: "string", description: "Keywords, e.g. reset password" } }, required: ["query"], additionalProperties: false },
    permissions: ["support.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ query }) => `Search help articles for "${query}"`,
    async execute({ query }, { ctx, organizationId, companyId }) {
      const rows = await searchArticles(ctx, organizationId, companyId, query, { limit: 6 });
      if (!rows.length) return { content: `No help articles match "${query}".`, count: 0 };
      return { content: rows.map((r) => `## ${r.title} (${r.status})\n${r.body.slice(0, 2500)}`).join("\n\n---\n\n"), count: rows.length, records: rows.map((r) => `kb_article:${r.id}`) };
    },
  }),

  read_support_queue: def({
    name: "read_support_queue",
    version: 1,
    description: "List tickets in a support queue view (mine, unassigned, open, pending, solved, breached, all), optionally filtered by a keyword; up to 25 tickets with status, priority, SLA state and assignee.",
    input: z.object({ view: z.enum(VIEWS).default("open"), query: z.string().trim().max(200).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { view: { type: "string", enum: [...VIEWS] }, query: { type: "string", description: "Optional keyword, requester email or ticket number" } },
      required: [],
      additionalProperties: false,
    },
    permissions: ["support.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ view }) => `Read the ${view} support queue`,
    async execute({ view, query }, { ctx, organizationId, companyId }) {
      const { data, total } = await listTickets(ctx, organizationId, companyId, { ...parseTicketFilters({}), view, q: query, sort: "due" });
      if (!data.length) return { content: `No tickets in the ${view} view.`, count: 0 };
      const lines = data.map(
        (t) =>
          `- #${t.number} ${t.subject} · ${t.status} · ${t.priority} · ${t.assigneeName ?? "unassigned"} · due ${iso(t.resolutionDueAt)}${t.firstResponseBreachedAt || t.resolutionBreachedAt ? " · SLA BREACHED" : ""} · id ${t.id}`,
      );
      return { content: `${total} ticket(s) in ${view}:\n${lines.join("\n")}`, count: data.length, records: data.map((t) => `ticket:${t.id}`) };
    },
  }),

  draft_ticket_reply: def({
    name: "draft_ticket_reply",
    version: 1,
    description: "Store a suggested reply on a ticket as an internal draft note for an agent to review, edit and send. Nothing is sent to the customer.",
    input: z.object({ ticketId: z.string().uuid(), body: z.string().trim().min(1).max(20_000) }).strict(),
    modelSchema: { type: "object", properties: { ticketId: { type: "string" }, body: { type: "string", description: "Suggested reply text" } }, required: ["ticketId", "body"], additionalProperties: false },
    permissions: ["support.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ body }) => `Save a draft reply: "${body.slice(0, 120)}"`,
    async execute({ ticketId, body }, { ctx, organizationId, companyId }) {
      const m = await storeDraftReply(ctx, organizationId, companyId, ticketId, body);
      return { content: "The draft was saved on the ticket as an internal note. It has not been sent.", records: [`ticket:${ticketId}`, `support_message:${m.id}`] };
    },
  }),

  send_ticket_reply: def({
    name: "send_ticket_reply",
    version: 1,
    description: "Propose sending a public reply to the ticket's requester (emailed, and visible on their ticket page). A person must approve the exact text; the result states whether the email was actually delivered.",
    input: z.object({ ticketId: z.string().uuid(), body: z.string().trim().min(1).max(20_000) }).strict(),
    modelSchema: { type: "object", properties: { ticketId: { type: "string" }, body: { type: "string", description: "Reply to the customer" } }, required: ["ticketId", "body"], additionalProperties: false },
    permissions: ["support.manage"],
    risk: "HIGH",
    autonomy: "SUPERVISED",
    timeoutMs: 30_000,
    summarize: ({ body }) => `Reply to the customer: "${body.slice(0, 120)}"`,
    async execute({ ticketId, body }, { ctx, organizationId, companyId }) {
      const r = await addMessage(ctx, organizationId, companyId, ticketId, { kind: "PUBLIC_REPLY", body });
      if (r.emailStatus === "SENT") return { content: "The reply was posted on the ticket and emailed to the requester.", records: [`ticket:${ticketId}`] };
      if (r.emailStatus === "NO_EMAIL") return { content: "The reply was posted on the customer's ticket page; the requester has no email address, so no email was sent.", records: [`ticket:${ticketId}`] };
      throw new AppError(r.emailStatus === "NOT_CONFIGURED" ? "not_configured" : "not_available", `The reply was posted on the ticket page, but the email was not delivered (${r.emailStatus}).`);
    },
  }),
};
