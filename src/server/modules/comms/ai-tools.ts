import { z } from "zod";
import { AppError } from "@/server/core/errors";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { listAnnouncements } from "./announcements";
import { plainMentions } from "./common";
import { getThread, replyToThread } from "./email";
import { createActionItems, getMeeting } from "./meetings";

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—");

/** AI tools of the comms module, registered in src/server/modules/tools/modules.ts. */
export const COMMS_TOOLS: Record<string, ToolDefinition> = {
  read_meeting: def({
    name: "read_meeting",
    version: 1,
    description: "Read one meeting: title, time, organizer, attendees (with user ids), agenda, notes, decisions and existing action items.",
    input: z.object({ meetingId: z.string().uuid() }).strict(),
    modelSchema: { type: "object", properties: { meetingId: { type: "string", description: "Meeting id" } }, required: ["meetingId"], additionalProperties: false },
    permissions: ["communication.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ meetingId }) => `Read meeting ${meetingId}`,
    async execute({ meetingId }, { ctx, organizationId, companyId }) {
      const m = await getMeeting(ctx, organizationId, companyId, meetingId);
      const content = [
        `Meeting: ${m.title} (${m.status})`,
        `When: ${iso(m.startsAt)} – ${iso(m.endsAt)}${m.location ? ` · ${m.location}` : ""}`,
        `Organizer: ${m.organizerName ?? "?"}`,
        `Attendees: ${m.attendees.map((a) => `${a.name ?? "?"} (userId ${a.userId})`).join("; ") || "none"}`,
        `Agenda:\n${m.agenda ?? "(none)"}`,
        `Notes:\n${m.notes ?? "(none)"}`,
        `Decisions:\n${m.decisions.map((d) => `- ${d}`).join("\n") || "(none)"}`,
        `Existing action items:\n${m.actionItems.map((a) => `- ${a.title} [${a.status}]${a.assigneeName ? ` → ${a.assigneeName}` : ""}`).join("\n") || "(none)"}`,
      ].join("\n\n");
      return { content, records: [`meeting:${m.id}`] };
    },
  }),

  read_announcements: def({
    name: "read_announcements",
    version: 1,
    description: "Read recent company announcements visible to the requester (title, date, audience, text), optionally filtered by a keyword.",
    input: z.object({ query: z.string().trim().max(200).optional() }).strict(),
    modelSchema: { type: "object", properties: { query: { type: "string", description: "Optional keyword" } }, required: [], additionalProperties: false },
    permissions: ["communication.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ query }) => (query ? `Read announcements about "${query}"` : "Read recent announcements"),
    async execute({ query }, { ctx, organizationId, companyId }) {
      const { data } = await listAnnouncements(ctx, organizationId, companyId, { q: query });
      if (!data.length) return { content: "No announcements found.", count: 0 };
      const content = data
        .map((a) => `## ${a.title}\n${a.status} ${iso(a.publishedAt ?? a.publishAt)} · audience ${a.audience}${a.pinned ? " · pinned" : ""} · ${a.readCount} read\n${plainMentions(a.body).slice(0, 1500)}`)
        .join("\n\n");
      return { content, count: data.length, records: data.map((a) => `announcement:${a.id}`) };
    },
  }),

  read_inbox_thread: def({
    name: "read_inbox_thread",
    version: 1,
    description: "Read one email thread of the company inbox: subject, participants, linked contact and the messages (newest last).",
    input: z.object({ threadId: z.string().uuid() }).strict(),
    modelSchema: { type: "object", properties: { threadId: { type: "string", description: "Email thread id" } }, required: ["threadId"], additionalProperties: false },
    permissions: ["communication.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ threadId }) => `Read email thread ${threadId}`,
    async execute({ threadId }, { ctx, organizationId, companyId }) {
      const t = await getThread(ctx, organizationId, companyId, threadId);
      const messages = t.messages
        .slice(-30)
        .map((m) => `--- ${m.direction === "INBOUND" ? "From" : "Sent by us as"} ${m.fromAddress} to ${m.toAddresses.join(", ")} · ${iso(m.sentAt)} · ${m.status}\n${m.bodyText.slice(0, 4000)}`)
        .join("\n\n");
      const contact = t.contact ? `${t.contact.firstName} ${t.contact.lastName ?? ""} <${t.contact.email ?? ""}>` : "none";
      return { content: `Subject: ${t.subject}\nParticipants: ${t.participants.join(", ")}\nLinked contact: ${contact}\nMailbox connected: ${t.connection ? "yes" : "no"}\n\n${messages}`, records: [`email_thread:${t.id}`] };
    },
  }),

  create_meeting_action_items: def({
    name: "create_meeting_action_items",
    version: 1,
    description: "Create action items (tasks for people) from a meeting, each optionally assigned to an attendee (userId from read_meeting) with a due date. Needs a person's approval.",
    input: z
      .object({
        meetingId: z.string().uuid(),
        items: z.array(z.object({ title: z.string().trim().min(1).max(300), assigneeId: z.string().uuid().optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict()).min(1).max(20),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        meetingId: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" }, assigneeId: { type: "string", description: "Attendee user id" }, dueDate: { type: "string", description: "YYYY-MM-DD" } },
            required: ["title"],
            additionalProperties: false,
          },
        },
      },
      required: ["meetingId", "items"],
      additionalProperties: false,
    },
    permissions: ["communication.post"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 20_000,
    summarize: ({ items }) => `Create ${items.length} meeting action item(s): ${items.map((i) => i.title).join("; ").slice(0, 200)}`,
    async execute({ meetingId, items }, { ctx, organizationId, companyId }) {
      const { data } = await createActionItems(ctx, organizationId, companyId, meetingId, { items });
      return { content: `Created ${data.length} action item(s).`, records: data.map((t) => `work_task:${t.id}`), count: data.length };
    },
  }),

  send_email_reply: def({
    name: "send_email_reply",
    version: 1,
    description:
      "Propose sending a reply in an inbox email thread through the thread's connected mailbox (Gmail / Outlook). A person must approve the exact text; the result says whether the provider accepted it. Never claim it was sent before that.",
    input: z.object({ threadId: z.string().uuid(), body: z.string().trim().min(1).max(20_000) }).strict(),
    modelSchema: {
      type: "object",
      properties: { threadId: { type: "string" }, body: { type: "string", description: "Plain-text reply" } },
      required: ["threadId", "body"],
      additionalProperties: false,
    },
    permissions: ["communication.post"],
    risk: "HIGH",
    autonomy: "SUPERVISED",
    timeoutMs: 30_000,
    summarize: ({ body }) => `Send an email reply: "${body.slice(0, 120)}"`,
    async execute({ threadId, body }, { ctx, organizationId, companyId }) {
      const r = await replyToThread(ctx, organizationId, companyId, threadId, { body }, { providerOnly: true });
      if (r.status !== "SENT") throw new AppError("not_available", "The email provider rejected the reply; nothing was sent.");
      return { content: "The reply was sent through the connected mailbox.", records: [`email_thread:${threadId}`] };
    },
  }),
};
