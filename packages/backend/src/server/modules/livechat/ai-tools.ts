import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import { notFound } from "@/server/core/errors";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { scheduleMeeting } from "@/server/modules/crm/meetings";
import { addEvent } from "./actions";
import { addOutcome, authorize } from "./common";
import { getConversation, listConversations, livechatAnalytics } from "./inbox";

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—");

/** AI tools of the live chat module, registered in src/server/modules/tools/modules.ts. */
export const LIVECHAT_TOOLS: Record<string, ToolDefinition> = {
  read_livechat_conversations: def({
    name: "read_livechat_conversations",
    version: 1,
    description:
      "Read the website live chat: analytics for the last 30 days (conversations, resolved by AI, leads, tickets, handoffs, knowledge gaps) and the most recent conversations with status, outcome tags and the last message.",
    input: z.object({ status: z.enum(["open", "waiting", "closed", "all"]).default("all") }).strict(),
    modelSchema: { type: "object", properties: { status: { type: "string", enum: ["open", "waiting", "closed", "all"], description: "Which conversations" } }, required: ["status"], additionalProperties: false },
    permissions: ["support.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ status }) => `Read website chats (${status})`,
    async execute({ status }, { ctx, organizationId, companyId }) {
      const [a, list] = await Promise.all([livechatAnalytics(ctx, organizationId, companyId, 30), listConversations(ctx, organizationId, companyId, { status })]);
      const head = `Last 30 days: ${a.total} conversations, ${a.aiResolved} resolved by AI (${a.resolutionRate ?? "—"}% of closed), ${a.leads} leads, ${a.tickets} tickets, ${a.handoffs} handoffs, ${a.knowledgeGaps} knowledge gaps, ${a.meetings} meeting requests.`;
      const rows = list.data.map((c) => `- ${c.id} · ${c.status} · ${c.visitor.name ?? "anonymous"} · ${iso(c.lastMessageAt)} · tags ${c.outcomes.join(", ") || "none"} · last: ${c.last ? `${c.last.author}: ${c.last.body.replace(/\s+/g, " ").slice(0, 140)}` : "—"}`);
      return { content: `${head}\n\nConversations (${list.total}):\n${rows.join("\n") || "none"}`, count: list.data.length, records: list.data.map((c) => `livechat_conversation:${c.id}`) };
    },
  }),

  read_livechat_transcript: def({
    name: "read_livechat_transcript",
    version: 1,
    description: "Read one website chat conversation: visitor (whether contact details were shared with consent), status, outcome tags, handoff reason, linked lead/ticket and the full transcript.",
    input: z.object({ conversationId: z.string().uuid() }).strict(),
    modelSchema: { type: "object", properties: { conversationId: { type: "string", description: "Conversation id" } }, required: ["conversationId"], additionalProperties: false },
    permissions: ["support.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ conversationId }) => `Read website chat ${conversationId}`,
    async execute({ conversationId }, { ctx, organizationId, companyId }) {
      const d = await getConversation(ctx, organizationId, companyId, conversationId);
      const lines = d.messages
        .filter((m) => m.kind !== "contact_request")
        .map((m) => `[${iso(m.createdAt)}] ${m.author === "AGENT" ? `Team (${d.names[m.authorUserId ?? ""] ?? ""})` : m.author}${m.kind === "event" ? " event" : ""}: ${m.body.slice(0, 2000)}`);
      const c = d.conversation;
      const content = [
        `Conversation ${c.id} · status ${c.status} · started ${iso(c.createdAt)} · locale ${c.locale}`,
        `Visitor: ${d.visitor.name ?? "anonymous"} · contact shared with consent: ${d.visitor.consentAt ? "yes" : "no"}`,
        `Tags: ${c.outcomes.join(", ") || "none"} · handoff: ${c.handoffReason ?? "none"} · lead: ${d.lead ? `${d.lead.name} (${d.lead.stage})` : "none"} · ticket: ${d.ticket ? `#${d.ticket.number} ${d.ticket.status}` : "none"}`,
        `Transcript:\n${lines.join("\n")}`,
      ].join("\n\n");
      return { content, records: [`livechat_conversation:${c.id}`] };
    },
  }),

  livechat_book_meeting: def({
    name: "livechat_book_meeting",
    version: 1,
    description:
      "Book a meeting a website visitor asked for in the live chat: saves it on the lead and, when a calendar is connected, adds it to the approver's calendar with the visitor invited (an email invitation is sent). Filed for approval.",
    input: z
      .object({
        conversationId: z.string().uuid(),
        leadId: z.string().uuid(),
        title: z.string().trim().min(1).max(200),
        startsAt: z.string().datetime({ offset: true }),
        durationMin: z.number().int().min(15).max(240).default(30),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string", description: "Live chat conversation id" },
        leadId: { type: "string", description: "Lead id recorded from the chat" },
        title: { type: "string", description: "Meeting title" },
        startsAt: { type: "string", description: "ISO 8601 start with offset" },
        durationMin: { type: "integer", description: "Duration in minutes" },
      },
      required: ["conversationId", "leadId", "title", "startsAt", "durationMin"],
      additionalProperties: false,
    },
    permissions: ["sales.manage", "support.manage"],
    risk: "HIGH",
    autonomy: "SUPERVISED",
    timeoutMs: 30_000,
    summarize: ({ title, startsAt, durationMin }) => `Book "${title}" with a website visitor on ${startsAt.replace("T", " ").slice(0, 16)} (${durationMin} min) and send them a calendar invitation`,
    async execute(input, { ctx, organizationId, companyId }) {
      await authorize(ctx, organizationId, companyId, "support.manage");
      const conv = await db().livechatConversation.findFirst({ where: { id: input.conversationId, organizationId, companyId }, select: { id: true, organizationId: true, companyId: true, leadId: true, outcomes: true } });
      if (!conv || conv.leadId !== input.leadId) throw notFound("Conversation");
      const m = await scheduleMeeting(ctx, organizationId, companyId, { leadId: input.leadId, title: input.title, startsAt: input.startsAt, durationMin: input.durationMin, agenda: `Requested in the website chat (/livechat/${conv.id}).`, addToCalendar: true });
      const invited = m.calendar === "added";
      await transaction(async (tx) => {
        await tx.livechatConversation.update({ where: { id: conv.id }, data: { outcomes: addOutcome(conv.outcomes, "meeting") } });
        await addEvent(tx, conv, invited ? "meeting_confirmed" : "meeting_saved", { startsAt: input.startsAt });
      });
      const calendar = { added: "added to the calendar; the visitor was invited", not_connected: "saved, but no calendar is connected: nobody was invited (connect Google or Outlook Calendar in Integrations)", failed: "saved, but the calendar rejected it: nobody was invited", skipped: "saved without calendar" }[m.calendar];
      return { content: `Meeting ${m.id} ${calendar}.`, records: [`crm_meeting:${m.id}`, `livechat_conversation:${conv.id}`] };
    },
  }),
};
