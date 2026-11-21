import { z } from "zod";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { selectContext } from "./context";
import { searchKnowledge } from "./knowledge";
import { MEMORY_LAYERS } from "./memory-policy";
import { createMemory, searchMemories } from "./memory";

/** AI tools of the Company Brain module. Register BRAIN_TOOLS in src/server/modules/tools/modules.ts. */
export const BRAIN_TOOLS: Record<string, ToolDefinition> = {
  search_company_knowledge: def({
    name: "search_company_knowledge",
    version: 1,
    description:
      "Search everything the company knows in one go: Company Brain document passages, company memory, the company graph (people, teams, products, customers, vendors, partners with their relations) and core records (customers, deals, leads, projects). Each hit has a reference (K1, K2…) and an in-app path — cite the references you use. Only sources the requester may read are searched.",
    input: z.object({ query: z.string().trim().min(2).max(200) }).strict(),
    modelSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Keywords or a short question, e.g. Acme renewal pricing" } },
      required: ["query"],
      additionalProperties: false,
    },
    permissions: ["companies.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: ({ query }) => `Search company knowledge for "${query}"`,
    async execute({ query }, { ctx, organizationId, companyId }) {
      const r = await searchKnowledge(ctx, organizationId, companyId, query, 6);
      const lines: string[] = [];
      const records: string[] = [];
      let n = 0;
      for (const p of r.passages ?? []) {
        lines.push(`[K${++n}] Document "${p.title}" passage ${p.passage} (${p.href}): ${p.snippet.map((s) => s.text).join("").replace(/\s+/g, " ").slice(0, 500)}`);
        records.push(`brain_document:${p.documentId}`);
      }
      for (const m of r.memories ?? []) {
        lines.push(`[K${++n}] Company memory "${m.title}": ${m.fact.replace(/\s+/g, " ").slice(0, 400)}${m.source ? ` (source: ${m.source})` : ""}`);
        records.push(`company_memory:${m.id}`);
      }
      for (const e of r.entities ?? []) {
        const rel = e.relations.slice(0, 8).map((x) => (x.direction === "out" ? `${x.relation} → ${x.name} (${x.kind.toLowerCase()})` : `${x.name} (${x.kind.toLowerCase()}) ${x.relation} →`)).join("; ");
        lines.push(`[K${++n}] ${e.kind.toLowerCase()} "${e.name}" (${e.href})${e.description ? `: ${e.description.slice(0, 300)}` : ""}${rel ? ` — relations: ${rel}` : ""}`);
        records.push(`graph_entity:${e.id}`);
      }
      for (const rec of r.records) {
        lines.push(`[K${++n}] ${rec.type} "${rec.label}"${rec.status ? ` (${rec.status.toLowerCase()})` : ""} — ${rec.href}`);
        records.push(`${rec.type}:${rec.id}`);
      }
      if (!lines.length) return { content: `Nothing in the company's knowledge matches "${query}".`, count: 0 };
      return { content: lines.join("\n"), count: lines.length, records };
    },
  }),

  recall_company_context: def({
    name: "recall_company_context",
    version: 1,
    description:
      "Recall the most relevant shared company memory for a question: company, product, brand, customer and department facts, conversation summaries and document passages — ranked (full-text plus semantic search when the company configured embeddings), filtered to what the requester may read, compressed to the relevant sentences. Each snippet has a reference to cite.",
    input: z.object({ query: z.string().trim().min(2).max(300), layers: z.array(z.enum(MEMORY_LAYERS)).max(10).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you need to know, e.g. brand tone of voice or Acme contract terms" },
        layers: { type: "array", items: { type: "string", enum: [...MEMORY_LAYERS] }, description: "Optional: only these memory layers (DOCUMENT = document passages)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    permissions: ["brain.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: ({ query }) => `Recall company memory for "${query}"`,
    async execute({ query, layers }, { ctx, organizationId, companyId, cite }) {
      const r = await selectContext(ctx, organizationId, companyId, { query, layers, tokenBudget: 2500, maxSnippets: 14 });
      if (!r.snippets.length) return { content: `Nothing in the company memory matches "${query}".`, count: 0 };
      const lines = r.snippets.map((x) => {
        const ref = x.kind === "passage" && cite && x.citation.documentId ? cite({ passageId: x.citation.id, documentId: x.citation.documentId, title: x.title, passage: x.citation.passage ?? 1 }) : x.ref;
        const head = x.kind === "passage" ? `Document "${x.title}", passage ${x.citation.passage}` : `${x.layer.toLowerCase()} memory "${x.title}"`;
        return `[${ref}] ${head}: ${x.text.replace(/\s+/g, " ")}${x.citation.source ? ` (source: ${x.citation.source})` : ""}`;
      });
      return {
        content: `${lines.join("\n")}\n(search mode: ${r.mode === "hybrid" ? "full-text + semantic" : "full-text"})`,
        count: lines.length,
        records: r.snippets.map((x) => (x.kind === "passage" ? `brain_document:${x.citation.documentId}` : x.kind === "employee_note" ? `ai_employee_memory:${x.citation.id}` : `company_memory:${x.citation.id}`)),
      };
    },
  }),

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
