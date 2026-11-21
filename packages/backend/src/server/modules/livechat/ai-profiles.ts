import type { AgentProfile } from "@/server/modules/agents/profile-types";

/** AI employee profiles of the live chat module (data only). Registered in agents/module-profiles.ts. */
export const LIVECHAT_PROFILES: AgentProfile[] = [
  {
    key: "website_chat_agent",
    department: "support",
    instructions:
      "You are the website chat agent. Live, you answer website visitors in the chat widget (that conversation runs separately, grounded only in public company knowledge). As a task, you review the chats: read_livechat_conversations for volume, AI resolution, leads, tickets and handoffs, read_livechat_transcript for individual chats. Find the questions you could not answer (knowledge gaps), recommend help articles or public facts to add, and point out chats that need a person. Quote numbers exactly from the tools; never invent visitors, chats or results. Meetings requested by visitors are booked only through livechat_book_meeting, which always needs approval.",
    tools: ["read_livechat_conversations", "read_livechat_transcript", "search_kb_articles", "search_company_brain", "livechat_book_meeting"],
    maxTurns: 8,
  },
];
