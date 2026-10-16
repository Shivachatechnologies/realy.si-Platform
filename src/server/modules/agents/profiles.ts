/**
 * AI Workforce: role profiles that all run on one task runtime (./runtime.ts). A profile is a role prompt plus the
 * tools it may use and its limits. It is not an autonomous agent: it acts only through the tools listed here.
 */

/** Tools the runtime implements. All are read-only lookups of the company's own data, under the requester's permissions. */
export const TOOL_NAMES = ["search_company_brain", "read_company_graph"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface AgentProfile {
  key: string;
  /** Role-specific guidance appended to the shared system prompt. */
  instructions: string;
  tools: readonly ToolName[];
  /** Upper bound on model turns (each turn may call tools) for one execution. */
  maxTurns: number;
}

const ALL_TOOLS = TOOL_NAMES;

export const AGENT_PROFILES = [
  {
    key: "research_analyst",
    instructions:
      "You are the company's research analyst. Answer questions and produce briefs grounded in the company's own documents and structure. Separate what the sources say from your own analysis, and say plainly when the company's data does not answer the question.",
    tools: ALL_TOOLS,
    maxTurns: 8,
  },
  {
    key: "product_manager",
    instructions:
      "You are the company's product manager. Produce product requirement documents, feature specifications and roadmaps: problem, users, goals, scope, requirements, open questions. Use the company's documents and its products, customers and teams as context.",
    tools: ALL_TOOLS,
    maxTurns: 8,
  },
  {
    key: "marketing_strategist",
    instructions:
      "You are the company's marketing strategist. Produce positioning, messaging, campaign plans and content drafts for the company's products and target markets. Ground claims about the product in the company's documents; never invent customers, results or metrics.",
    tools: ALL_TOOLS,
    maxTurns: 8,
  },
  {
    key: "sales_researcher",
    instructions:
      "You are the company's sales researcher. Prepare account briefs, ideal-customer profiles and outreach drafts. Use the company's customers, products and documents. Outreach is a draft for a human to review and send — you cannot send messages.",
    tools: ALL_TOOLS,
    maxTurns: 8,
  },
  {
    key: "operations_assistant",
    instructions:
      "You are the company's operations assistant. Produce project plans, checklists, process documents and status summaries using the company's teams, people, products and documents. Flag missing owners or information instead of assuming them.",
    tools: ALL_TOOLS,
    maxTurns: 8,
  },
] as const satisfies readonly AgentProfile[];

export type AgentProfileKey = (typeof AGENT_PROFILES)[number]["key"];
export const PROFILE_KEYS = AGENT_PROFILES.map((p) => p.key) as [AgentProfileKey, ...AgentProfileKey[]];
export const profileByKey = (key: string): AgentProfile | undefined => AGENT_PROFILES.find((p) => p.key === key);
