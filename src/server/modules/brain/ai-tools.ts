import { z } from "zod";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { createMemory, searchMemories } from "./memory";

/** AI tools of the Company Brain module. Register BRAIN_TOOLS in src/server/modules/tools/modules.ts. */
export const BRAIN_TOOLS: Record<string, ToolDefinition> = {
  read_company_memory: def({
    name: "read_company_memory",
    version: 1,
    description:
      "Search the company memory: short durable facts the company recorded (decisions, conventions, key numbers), each with title, department and source. Pass keywords to get the most relevant facts, or no query for pinned and recent ones.",
    input: z.object({ query: z.string().trim().max(200).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Keywords, e.g. pricing discount policy" } },
      required: [],
      additionalProperties: false,
    },
    permissions: ["brain.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ query }) => (query ? `Search company memory for "${query}"` : "Read company memory"),
    async execute({ query }, { ctx, organizationId, companyId }) {
      const facts = await searchMemories(ctx, organizationId, companyId, query, 15);
      if (!facts.length) return { content: query ? `No company memory matches "${query}".` : "The company memory is empty.", count: 0 };
      const content = facts
        .map((m) => `- ${m.pinned ? "[pinned] " : ""}${m.title}: ${m.fact}${m.department ? ` (department: ${m.department})` : ""}${m.source ? ` (source: ${m.source})` : ""}`)
        .join("\n");
      return { content, count: facts.length, records: facts.map((m) => `company_memory:${m.id}`) };
    },
  }),

  remember_company_fact: def({
    name: "remember_company_fact",
    version: 1,
    description:
      "Propose saving a durable fact to the company memory (shown to every future AI task). Only facts stated in the company's documents or by a person in this task, with their source. A person must approve it before it is saved.",
    input: z
      .object({
        title: z.string().trim().min(1).max(160),
        fact: z.string().trim().min(1).max(2000),
        source: z.string().trim().max(300).optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title, e.g. Standard payment terms" },
        fact: { type: "string", description: "The fact in one or two sentences" },
        source: { type: "string", description: "Where it comes from, e.g. a document title and passage reference" },
      },
      required: ["title", "fact"],
      additionalProperties: false,
    },
    permissions: ["brain.manage"],
    risk: "LOW",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ title }) => `Save company fact "${title}"`,
    async execute(input, { ctx, organizationId, companyId }) {
      const m = await createMemory(ctx, organizationId, companyId, input, { ai: true });
      return { content: `Saved company fact "${m.title}".`, records: [`company_memory:${m.id}`] };
    },
  }),
};
