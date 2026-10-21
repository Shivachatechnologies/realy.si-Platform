import { z } from "zod";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import type { ToolAutonomy, ToolRisk } from "@/generated/prisma/enums";
import { searchDocuments } from "@/server/modules/brain/service";
import { createEntity, getGraph } from "@/server/modules/graph/service";
import { createProject, listWorkspaces } from "@/server/modules/companies/service";
import { createMilestone, listObjectives } from "@/server/modules/objectives/service";
import { ENTITY_KINDS } from "@/server/modules/graph/relations";
import type { ToolName } from "@/server/modules/agents/profiles";

/**
 * Tool registry (docs/tool-system.md §1): the only way agents act. Every tool here is internal and scoped to the
 * calling task's company (resourceScope = that company); the gateway (./gateway.ts) enforces allow-list, input
 * schema, the principal's permissions and the autonomy policy before `execute` runs.
 */

export interface Citable {
  passageId: string;
  documentId: string;
  title: string;
  passage: number;
}

export interface ToolExecutionContext {
  /** The principal the tool acts for: the task's requester, or — for an approved action — the approver. */
  ctx: RequestContext;
  organizationId: string;
  companyId: string;
  /** Registers a retrieved passage as citable and returns its reference (e.g. "S1"). */
  cite?: (source: Citable) => string;
}

export interface ToolOutput {
  /** Text returned to the model. */
  content: string;
  /** Records read or changed, as "type:id" (audit trail). */
  records?: string[];
  /** Number of items returned (reads) for the task trace. */
  count?: number;
}

export interface ToolDefinition<I = unknown> {
  name: ToolName;
  version: number;
  description: string;
  input: z.ZodType<I>;
  /** JSON Schema sent to the model (strict: only type/properties/required/enum/description/additionalProperties). */
  modelSchema: Record<string, unknown>;
  permissions: string[];
  risk: ToolRisk;
  autonomy: ToolAutonomy;
  timeoutMs: number;
  /** One line describing the effect, shown on approval requests. */
  summarize(input: I): string;
  execute(input: I, x: ToolExecutionContext): Promise<ToolOutput>;
}

const def = <I>(t: ToolDefinition<I>) => t as unknown as ToolDefinition;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const SEARCH_LIMIT = 8;
const GRAPH_ENTITY_LIMIT = 300;

export const TOOLS: Record<ToolName, ToolDefinition> = {
  search_company_brain: def({
    name: "search_company_brain",
    version: 1,
    description:
      "Full-text search over the company's documents (Company Brain). Returns up to 8 matching passages, each with a reference like S1 to cite. Use specific keywords; run several searches for different aspects of the task.",
    input: z.object({ query: z.string().trim().min(1).max(200) }).strict(),
    modelSchema: {
      type: "object",
      properties: { query: { type: "string", description: 'Keywords or a quoted phrase, e.g. refund policy or "launch plan"' } },
      required: ["query"],
      additionalProperties: false,
    },
    permissions: ["brain.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ query }) => `Search Company Brain for "${query}"`,
    async execute({ query }, { ctx, organizationId, companyId, cite }) {
      const { results } = await searchDocuments(ctx, organizationId, companyId, { q: query, limit: SEARCH_LIMIT });
      // Full passage text, read with the same company filter the search used.
      const chunks = await db().brainChunk.findMany({ where: { id: { in: results.map((r) => r.passageId) }, companyId, organizationId }, select: { id: true, text: true } });
      const text = new Map(chunks.map((c) => [c.id, c.text]));
      if (!results.length) return { content: `No passages match "${query}".`, count: 0 };
      const content = results
        .map((r) => {
          const source = { passageId: r.passageId, documentId: r.citation.documentId, title: r.citation.title, passage: r.citation.passage };
          const ref = cite ? cite(source) : `${r.citation.title} §${r.citation.passage}`;
          return `[${ref}] ${source.title} — passage ${source.passage}\n${text.get(r.passageId) ?? r.snippet.map((s) => s.text).join("")}`;
        })
        .join("\n\n---\n\n");
      return { content, count: results.length, records: results.map((r) => `brain_chunk:${r.passageId}`) };
    },
  }),

  read_company_graph: def({
    name: "read_company_graph",
    version: 1,
    description: "Returns the company's structured context: people, teams, products, customers, vendors and partners, and the relations between them.",
    input: z.object({}).strict(),
    modelSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    permissions: ["graph.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read the Company Graph",
    async execute(_input, { ctx, organizationId, companyId }) {
      const graph = await getGraph(ctx, organizationId, companyId);
      const entities = graph.entities.slice(0, GRAPH_ENTITY_LIMIT);
      const names = new Map(entities.map((e) => [e.id, e.name]));
      if (!entities.length) return { content: "The company graph is empty.", count: 0 };
      const lines = entities.map((e) => `- ${e.kind} ${e.name}${e.description ? `: ${e.description}` : ""}`);
      const relations = graph.edges.filter((e) => names.has(e.fromId) && names.has(e.toId)).map((e) => `- ${names.get(e.fromId)} ${e.relation} ${names.get(e.toId)}`);
      return { content: `Entities:\n${lines.join("\n")}\n\nRelations:\n${relations.length ? relations.join("\n") : "(none)"}`, count: entities.length };
    },
  }),

  read_objectives: def({
    name: "read_objectives",
    version: 1,
    description: "Returns the company's objectives with their milestones (id, title, due date, done or open, linked project). Use the ids when proposing milestones.",
    input: z.object({}).strict(),
    modelSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    permissions: ["objectives.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read objectives and milestones",
    async execute(_input, { ctx, organizationId, companyId }) {
      const objectives = await listObjectives(ctx, organizationId, companyId);
      if (!objectives.length) return { content: "The company has no objectives yet.", count: 0 };
      const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "no date");
      const content = objectives
        .map((o) =>
          [
            `Objective ${o.id} [${o.status}] ${o.title} (target ${day(o.targetDate)})${o.description ? `\n  ${o.description}` : ""}`,
            ...o.milestones.map((m) => `  - Milestone ${m.id} [${m.completedAt ? "done" : "open"}] ${m.title} (due ${day(m.dueDate)})${m.project ? `, project ${m.project.name}` : ""}`),
          ].join("\n"),
        )
        .join("\n\n");
      return { content, count: objectives.length };
    },
  }),

  create_graph_entity: def({
    name: "create_graph_entity",
    version: 1,
    description: "Propose adding a person, team, product, customer, vendor or partner to the Company Graph. A human must approve it before it is added.",
    input: z.object({ kind: z.enum(ENTITY_KINDS), name: z.string().trim().min(1).max(160), description: z.string().trim().max(2000).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: [...ENTITY_KINDS] },
        name: { type: "string" },
        description: { type: "string" },
      },
      required: ["kind", "name"],
      additionalProperties: false,
    },
    permissions: ["graph.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ kind, name }) => `Add ${kind.toLowerCase()} "${name}" to the Company Graph`,
    async execute(input, { ctx, organizationId, companyId }) {
      const e = await createEntity(ctx, organizationId, companyId, input);
      return { content: `Added ${e.kind.toLowerCase()} "${e.name}" to the Company Graph.`, records: [`graph_entity:${e.id}`] };
    },
  }),

  create_project: def({
    name: "create_project",
    version: 1,
    description: "Propose creating a project in the company's General workspace. A human must approve it before it is created.",
    input: z.object({ name: z.string().trim().min(1).max(120) }).strict(),
    modelSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
    permissions: ["projects.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ name }) => `Create project "${name}"`,
    async execute({ name }, { ctx, organizationId, companyId }) {
      const [workspace] = await listWorkspaces(ctx, organizationId, companyId);
      if (!workspace) throw new Error("The company has no workspace");
      const p = await createProject(ctx, organizationId, workspace.id, { name });
      return { content: `Created project "${p.name}" in ${workspace.name}.`, records: [`project:${p.id}`] };
    },
  }),

  create_milestone: def({
    name: "create_milestone",
    version: 1,
    description: "Propose adding a milestone to one of the company's active objectives (use read_objectives for ids). A human must approve it before it is added.",
    input: z.object({ objectiveId: z.string().uuid(), title: z.string().trim().min(1).max(200), dueDate: date.optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: {
        objectiveId: { type: "string", description: "Objective id from read_objectives" },
        title: { type: "string" },
        dueDate: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["objectiveId", "title"],
      additionalProperties: false,
    },
    permissions: ["objectives.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ title, dueDate }) => `Add milestone "${title}"${dueDate ? ` due ${dueDate}` : ""}`,
    async execute(input, { ctx, organizationId, companyId }) {
      const m = await createMilestone(ctx, organizationId, companyId, input);
      return { content: `Added milestone "${m.title}".`, records: [`milestone:${m.id}`] };
    },
  }),
};

export const getTool = (name: string): ToolDefinition | undefined => (Object.hasOwn(TOOLS, name) ? TOOLS[name as ToolName] : undefined);
