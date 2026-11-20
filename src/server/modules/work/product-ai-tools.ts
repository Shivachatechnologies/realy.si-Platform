import { z } from "zod";
import { db } from "@/server/core/db";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { createFeature, IMPACT_VALUES } from "./product";
import { DOC_KINDS, PRODUCT_STAGES } from "./product-constants";
import { getProduct, listProducts, moveStage, parseProductFilters } from "./product-core";
import { docsText, productContextText, saveDocVersion } from "./product-docs";
import { createBacklogTasks, getBacklog } from "./product-delivery";
import { PRIORITIES } from "./tasks";

/** AI tools of the product workspace (spread into WORK_TOOLS). Every execute goes through the services with the task's ctx. */

const uuid = z.string().uuid();
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");
const productIdSchema = { productId: { type: "string", description: "Product id" } };

export const PRODUCT_TOOLS: Record<string, ToolDefinition> = {
  read_product: def({
    name: "read_product",
    version: 1,
    description:
      "Reads all context of one product: description, target users, lifecycle stage and gate checklist, stage history, personas, competitors, market validation, features, documents, releases and recent feedback. Without productId, lists the company's products with their ids.",
    input: z.object({ productId: uuid.optional() }).strict(),
    modelSchema: { type: "object", properties: productIdSchema, required: [], additionalProperties: false },
    permissions: ["projects.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: () => "Read a product",
    async execute({ productId }, { ctx, organizationId, companyId }) {
      if (!productId) {
        const { data } = await listProducts(ctx, organizationId, companyId, parseProductFilters({}));
        if (!data.length) return { content: "The company has no products yet.", count: 0 };
        return { content: data.map((p) => `- Product ${p.id} "${p.name}" [${p.stage}/${p.status}] owner ${p.ownerName ?? "none"}, ${p._count.features} features`).join("\n"), count: data.length, records: data.map((p) => `product:${p.id}`) };
      }
      const p = await getProduct(ctx, organizationId, companyId, productId);
      const [context, releases, feedback] = await Promise.all([
        productContextText(organizationId, companyId, productId, 9000),
        db().productRelease.findMany({ where: { productId, companyId }, orderBy: { createdAt: "desc" }, take: 10, select: { version: true, status: true, releaseDate: true } }),
        db().productFeedback.findMany({ where: { productId, companyId, archivedAt: null }, orderBy: { createdAt: "desc" }, take: 15, select: { source: true, body: true, sentiment: true } }),
      ]);
      const lines = [
        context,
        `Owner: ${p.ownerName ?? "none"}; development project: ${p.project ? `${p.project.name} (${p.project.id})` : "none"}`,
        `Current stage ${p.stage} since ${day(p.stageEnteredAt)}; gate ${p.gate.approvedAt ? "approved" : "open"}: ${p.gate.items.map((i) => `${i.done ? "[x]" : "[ ]"} ${i.key ?? i.label}`).join(", ")}`,
        `Stage history: ${p.history.map((h) => `${h.stage} ${day(h.enteredAt)}→${h.exitedAt ? day(h.exitedAt) : "now"}`).join("; ")}`,
        releases.length ? `Releases:\n${releases.map((r) => `- ${r.version} [${r.status}] ${day(r.releaseDate)}`).join("\n")}` : "No releases.",
        feedback.length ? `Recent feedback:\n${feedback.map((f) => `- (${f.source}${f.sentiment ? `, ${f.sentiment}` : ""}) ${f.body.slice(0, 200)}`).join("\n")}` : "No feedback.",
      ];
      return { content: lines.join("\n"), count: 1, records: [`product:${productId}`] };
    },
  }),

  read_product_docs: def({
    name: "read_product_docs",
    version: 1,
    description: "Reads the current versions of a product's documents (research, BRD, PRD, technical requirements, architecture, UX spec, design brief, QA plan, release plan). Optionally only some kinds.",
    input: z.object({ productId: uuid, kinds: z.array(z.enum(DOC_KINDS)).max(DOC_KINDS.length).optional() }).strict(),
    modelSchema: { type: "object", properties: { ...productIdSchema, kinds: { type: "array", items: { type: "string", enum: [...DOC_KINDS] } } }, required: ["productId"], additionalProperties: false },
    permissions: ["projects.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: () => "Read product documents",
    async execute({ productId, kinds }, { ctx, organizationId, companyId }) {
      await getProduct(ctx, organizationId, companyId, productId);
      const text = await docsText(organizationId, companyId, productId, kinds, 24_000);
      return { content: text || "The product has no documents yet.", count: text ? 1 : 0, records: [`product:${productId}`] };
    },
  }),

  read_backlog: def({
    name: "read_backlog",
    version: 1,
    description: "Reads a product's backlog: its features (status, RICE) with their tasks, unplanned tasks and open sprints of its development project.",
    input: z.object({ productId: uuid }).strict(),
    modelSchema: { type: "object", properties: productIdSchema, required: ["productId"], additionalProperties: false },
    permissions: ["projects.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: () => "Read a product backlog",
    async execute({ productId }, { ctx, organizationId, companyId }) {
      const b = await getBacklog(ctx, organizationId, companyId, productId);
      const lines = [
        b.projectId ? `Development project ${b.projectId}` : "No development project linked (backlog tasks cannot be created yet).",
        `Features (${b.features.length}):`,
        ...b.features.map((f) => `- Feature ${f.id} [${f.status}] ${f.title}${f.riceScore != null ? ` RICE ${f.riceScore}` : ""}\n${f.tasks.map((t) => `  - Task ${t.id} [${t.status}] ${t.title}${t.estimatePoints != null ? ` ${t.estimatePoints} pts` : ""}${t.sprintId ? " (in sprint)" : ""}`).join("\n")}`),
        b.unlinked.length ? `Tasks without a feature:\n${b.unlinked.map((t) => `- Task ${t.id} [${t.status}] ${t.title}`).join("\n")}` : null,
        b.sprints.length ? `Open sprints:\n${b.sprints.map((s) => `- Sprint ${s.id} "${s.name}" [${s.status}] ${day(s.startDate)}–${day(s.endDate)}`).join("\n")}` : "No open sprints.",
      ];
      return { content: lines.filter(Boolean).join("\n"), count: b.features.length, records: [`product:${productId}`] };
    },
  }),

  create_product_doc_draft: def({
    name: "create_product_doc_draft",
    version: 1,
    description: "Saves a new draft version of one of the product's documents (Markdown). Applied after a person approves.",
    input: z.object({ productId: uuid, kind: z.enum(DOC_KINDS), content: z.string().trim().min(1).max(100_000), changeNote: z.string().trim().max(300).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { ...productIdSchema, kind: { type: "string", enum: [...DOC_KINDS] }, content: { type: "string", description: "Full document in Markdown" }, changeNote: { type: "string" } },
      required: ["productId", "kind", "content"],
      additionalProperties: false,
    },
    permissions: ["projects.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 30_000,
    summarize: ({ kind }) => `Save a draft ${kind} document`,
    async execute({ productId, kind, content, changeNote }, { ctx, organizationId, companyId }) {
      const d = await saveDocVersion(ctx, organizationId, companyId, productId, kind, { content, changeNote: changeNote ?? "AI draft" });
      return { content: `Saved ${kind} version ${d.version} (draft).`, records: [`product_doc:${d.id}`] };
    },
  }),

  create_feature: def({
    name: "create_feature",
    version: 1,
    description: "Creates a proposed feature of a product with spec, requirements, acceptance criteria and optional RICE inputs. Applied after a person approves.",
    input: z
      .object({
        productId: uuid,
        title: z.string().trim().min(1).max(200),
        spec: z.string().trim().max(20_000).optional(),
        requirements: z.string().trim().max(20_000).optional(),
        acceptanceCriteria: z.string().trim().max(10_000).optional(),
        reach: z.number().int().min(0).max(100_000_000).optional(),
        impact: z.number().refine((v) => (IMPACT_VALUES as readonly number[]).includes(v)).optional(),
        confidence: z.number().int().min(0).max(100).optional(),
        effort: z.number().positive().max(1000).optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        ...productIdSchema,
        title: { type: "string" },
        spec: { type: "string", description: "Short specification" },
        requirements: { type: "string", description: "Functional requirements, Markdown" },
        acceptanceCriteria: { type: "string", description: "One criterion per line" },
        reach: { type: "number", description: "People per quarter" },
        impact: { type: "number", enum: [...IMPACT_VALUES] },
        confidence: { type: "number", description: "0-100 %" },
        effort: { type: "number", description: "Person-months" },
      },
      required: ["productId", "title"],
      additionalProperties: false,
    },
    permissions: ["projects.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ title }) => `Create feature "${title}"`,
    async execute(i, { ctx, organizationId, companyId }) {
      const f = await createFeature(ctx, organizationId, companyId, { ...i, status: "PROPOSED" });
      return { content: `Created feature ${f.id} "${f.title}"${f.riceScore != null ? ` (RICE ${f.riceScore})` : ""}.`, records: [`product_feature:${f.id}`] };
    },
  }),

  create_backlog_tasks: def({
    name: "create_backlog_tasks",
    version: 1,
    description: "Creates backlog tasks (up to 30) in the product's development project, optionally linked to one of its features. Applied after a person approves.",
    input: z
      .object({
        productId: uuid,
        featureId: uuid.optional(),
        tasks: z.array(z.object({ title: z.string().trim().min(1).max(300), description: z.string().trim().max(5000).optional(), priority: z.enum(PRIORITIES).optional(), estimatePoints: z.number().int().min(0).max(100).optional() }).strict()).min(1).max(30),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        ...productIdSchema,
        featureId: { type: "string", description: "Feature id (optional)" },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" }, description: { type: "string" }, priority: { type: "string", enum: [...PRIORITIES] }, estimatePoints: { type: "number", description: "Story points 0-100" } },
            required: ["title"],
            additionalProperties: false,
          },
        },
      },
      required: ["productId", "tasks"],
      additionalProperties: false,
    },
    permissions: ["projects.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 60_000,
    summarize: ({ tasks }) => `Create ${tasks.length} backlog task(s)`,
    async execute({ productId, featureId, tasks }, { ctx, organizationId, companyId }) {
      const r = await createBacklogTasks(ctx, organizationId, companyId, productId, { featureId, tasks: tasks.map((t) => ({ ...t, priority: t.priority ?? "MEDIUM" })) });
      return { content: `Created ${r.created.length} task(s):\n${r.created.map((t) => `- ${t.id} ${t.title}`).join("\n")}`, records: r.created.map((t) => `work_task:${t.id}`) };
    },
  }),

  advance_product_stage: def({
    name: "advance_product_stage",
    version: 1,
    description: `Moves a product to its next lifecycle stage (${PRODUCT_STAGES.join(" → ")}). Only possible when the current stage gate is approved by the product owner. Applied after a person approves.`,
    input: z.object({ productId: uuid, note: z.string().trim().max(1000).optional() }).strict(),
    modelSchema: { type: "object", properties: { ...productIdSchema, note: { type: "string", description: "Why the product is ready" } }, required: ["productId"], additionalProperties: false },
    permissions: ["projects.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: () => "Move a product to its next stage",
    async execute({ productId, note }, { ctx, organizationId, companyId }) {
      const p = await moveStage(ctx, organizationId, companyId, productId, { note });
      return { content: `Product "${p.name}" is now in stage ${p.stage}.`, records: [`product:${productId}`] };
    },
  }),
};
