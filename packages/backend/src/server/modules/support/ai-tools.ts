import { z } from "zod";
import { AppError, notFound } from "@/server/core/errors";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { contactName } from "./common";
import { listCategories } from "./config";
import { searchArticles } from "./kb";
import { addMessage, getTicket, listTickets, parseTicketFilters, storeDraftReply, updateTicket, VIEWS } from "./tickets";
import { PRIORITIES } from "./common";
import { supportAnalytics } from "./analytics";
import { ticketToProductFeedback } from "./product-loop";
import { db } from "@/server/core/db";

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
    description: "Propose sending a public reply to the ticket's requester (emailed — or sent on WhatsApp for WhatsApp tickets — and visible on their ticket page). A person must approve the exact text; the result states whether the email was actually delivered.",
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
      if (r.emailStatus === "WHATSAPP_SENT") return { content: "The reply was posted on the ticket and sent to the requester on WhatsApp (accepted by WhatsApp; delivery is reported by the provider).", records: [`ticket:${ticketId}`] };
      if (r.emailStatus === "NO_EMAIL") return { content: "The reply was posted on the customer's ticket page; the requester has no email address, so no email was sent.", records: [`ticket:${ticketId}`] };
      throw new AppError(r.emailStatus === "NOT_CONFIGURED" || r.emailStatus === "WHATSAPP_NOT_CONFIGURED" ? "not_configured" : "not_available", `The reply was posted on the ticket page, but it was not delivered (${r.emailStatus}).`);
    },
  }),

  read_support_analytics: def({
    name: "read_support_analytics",
    version: 1,
    description: "Support analytics for the last 7–90 days from real tickets: tickets opened vs solved, median and 90th-percentile first response and resolution hours (also by priority), SLA attainment and customer satisfaction (CSAT = share of 4–5 star ratings, with rating count). Null means no data.",
    input: z.object({ days: z.number().int().min(7).max(90).default(30) }).strict(),
    modelSchema: { type: "object", properties: { days: { type: "integer", minimum: 7, maximum: 90, description: "Period length in days (default 30)" } }, additionalProperties: false },
    permissions: ["support.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: ({ days }) => `Read support analytics (${days} days)`,
    async execute({ days }, { ctx, organizationId, companyId }) {
      const a = await supportAnalytics(ctx, organizationId, companyId, days);
      const h = (v: number | null) => (v == null ? "no data" : `${v} h`);
      const lines = [
        `Period: last ${days} days. Opened ${a.totals.opened}, solved ${a.totals.solved}.`,
        `First response: median ${h(a.firstResponse.median)}, p90 ${h(a.firstResponse.p90)} (${a.firstResponse.count} tickets).`,
        `Resolution: median ${h(a.resolution.median)}, p90 ${h(a.resolution.p90)} (${a.resolution.count} tickets).`,
        `SLA met: first response ${a.sla.firstResponse ?? "no data"}%, resolution ${a.sla.resolution ?? "no data"}%.`,
        a.csat.ratings ? `CSAT ${a.csat.score}% from ${a.csat.ratings} ratings (average ${a.csat.average}/5; ${a.csat.responseRate}% of solved tickets rated).` : "CSAT: no ratings in the period.",
        `By priority (median first response / resolution): ${a.byPriority.map((p) => `${p.priority} ${h(p.firstResponse)} / ${h(p.resolution)}`).join("; ")}.`,
      ];
      return { content: lines.join("\n") };
    },
  }),

  share_ticket_with_product: def({
    name: "share_ticket_with_product",
    version: 1,
    description: "Propose recording a support ticket as product feedback for one product (by id or exact name), so the product team's feedback synthesis sees it. Use for feature requests, recurring bugs and usability problems. A person approves it first.",
    input: z.object({ ticketId: z.string().uuid(), product: z.string().trim().min(1).max(200), summary: z.string().trim().min(1).max(5000), sentiment: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: {
        ticketId: { type: "string" },
        product: { type: "string", description: "Product id or exact product name" },
        summary: { type: "string", description: "What the product team should learn from this ticket, in one or two short paragraphs" },
        sentiment: { type: "string", enum: ["POSITIVE", "NEUTRAL", "NEGATIVE"] },
      },
      required: ["ticketId", "product", "summary"],
      additionalProperties: false,
    },
    permissions: ["support.read", "projects.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ product, summary }) => `Share with product "${product}": "${summary.slice(0, 120)}"`,
    async execute({ ticketId, product, summary, sentiment }, { ctx, organizationId, companyId }) {
      const isId = z.string().uuid().safeParse(product).success;
      const p = await db().product.findFirst({ where: { organizationId, companyId, archivedAt: null, ...(isId ? { id: product } : { name: { equals: product, mode: "insensitive" } }) }, select: { id: true, name: true } });
      if (!p) throw notFound("Product");
      const f = await ticketToProductFeedback(ctx, organizationId, companyId, ticketId, { productId: p.id, summary, sentiment });
      return { content: `Recorded the ticket as feedback for "${p.name}".`, records: [`ticket:${ticketId}`, `product_feedback:${f.id}`] };
    },
  }),
  triage_ticket: def({
    name: "triage_ticket",
    version: 1,
    description: "Propose triaging a ticket: set its category (by name, from read_ticket's category list), priority and add up to three tags. A person must approve it.",
    input: z
      .object({
        ticketId: z.string().uuid(),
        categoryName: z.string().trim().min(1).max(120).optional(),
        priority: z.enum(PRIORITIES).optional(),
        tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(3).optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        ticketId: { type: "string" },
        categoryName: { type: "string", description: "Exact category name" },
        priority: { type: "string", enum: [...PRIORITIES] },
        tags: { type: "array", items: { type: "string" }, description: "Up to three short lower-case tags" },
      },
      required: ["ticketId"],
      additionalProperties: false,
    },
    permissions: ["support.manage"],
    risk: "LOW",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ categoryName, priority, tags }) => `Triage ticket: ${[categoryName, priority, tags?.length ? `tags ${tags.join(", ")}` : null].filter(Boolean).join(" · ") || "no change"}`,
    async execute({ ticketId, categoryName, priority, tags }, { ctx, organizationId, companyId }) {
      const t = await getTicket(ctx, organizationId, companyId, ticketId);
      let categoryId: string | undefined;
      if (categoryName) {
        const cat = (await listCategories(ctx, organizationId, companyId)).find((c) => c.name.toLowerCase() === categoryName.toLowerCase());
        if (!cat) throw notFound("Category");
        categoryId = cat.id;
      }
      const merged = tags?.length ? [...new Set([...t.tags, ...tags])].slice(0, 20) : undefined;
      await updateTicket(ctx, organizationId, companyId, ticketId, { ...(categoryId ? { categoryId } : {}), ...(priority ? { priority } : {}), ...(merged ? { tags: merged } : {}) });
      return { content: "The ticket was triaged.", records: [`ticket:${ticketId}`] };
    },
  }),
};
