import type { AgentProfile } from "@/server/modules/agents/profile-types";

/** Read tool every profile should get (add to agents/profiles.ts READ_TOOLS when registering the brain module). */
export const BRAIN_READ_TOOLS = ["read_company_memory"] as const;

/** Ask the Brain: answers questions from documents and company memory only (used by brain/ask.ts once registered). */
export const ASK_BRAIN_PROFILE = {
  key: "brain_answerer",
  department: "research",
  instructions:
    "You answer questions from the company's own knowledge: its documents (search_company_brain) and its company memory (read_company_memory). Run several focused searches, cite every statement from a passage with its reference such as [S1], give the direct answer first and say plainly when the company's knowledge does not answer the question. Never guess or add outside facts.",
  tools: ["search_company_brain", "read_company_memory"],
  maxTurns: 8,
} satisfies AgentProfile;

/** AI employee profiles of the Company Brain module (data only). Register in agents/module-profiles.ts. */
export const BRAIN_PROFILES: AgentProfile[] = [
  ASK_BRAIN_PROFILE,
  {
    key: "knowledge_manager",
    department: "operations",
    instructions:
      "You are the company's knowledge manager. Keep Company Brain useful: find gaps and contradictions between documents (search_company_brain), summarize what the company knows about a topic with citations, and propose durable facts for company memory with remember_company_fact — only facts stated in the company's own documents or by a person in the task, each with its source. A proposed fact is saved only after a person approves it. Never present a proposal as saved.",
    tools: ["search_company_brain", "read_company_memory", "read_company_graph", "read_objectives", "remember_company_fact"],
    maxTurns: 8,
  },
];
