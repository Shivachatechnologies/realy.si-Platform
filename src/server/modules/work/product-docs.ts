import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProductDocKind, ProductDocStatus } from "@/generated/prisma/enums";
import { db, Prisma, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask as createAgentTask } from "@/server/modules/agents/service";
import { chunkText, extractText, ExtractionError } from "@/server/modules/brain/extract";
import { normalizeTags } from "@/server/modules/brain/service";
import { productOf } from "./product-core";
import { DOC_KINDS } from "./product-constants";
import { actorId, authorize, blank, dayString, isUuid, optText, today } from "./shared";

/** Versioned product documents (BRD, PRD, architecture …), AI drafts and Company Brain indexing. */

export { DOC_KINDS };
export const DOC_STATUSES = ["DRAFT", "IN_REVIEW", "APPROVED"] as const satisfies readonly ProductDocStatus[];

/** English names (Brain titles, AI prompts); the UI uses product.docKinds.<KIND>. */
export const DOC_NAMES: Record<ProductDocKind, string> = {
  RESEARCH: "Market research",
  BRD: "Business requirements document (BRD)",
  PRD: "Product requirements document (PRD)",
  TECH_REQUIREMENTS: "Technical requirements",
  ARCHITECTURE: "Architecture",
  UX_SPEC: "UX specification",
  DESIGN_BRIEF: "Design brief",
  QA_PLAN: "QA and test plan",
  RELEASE_PLAN: "Release and launch plan",
};

/** Which AI role drafts which document. */
export const DOC_PROFILE: Record<ProductDocKind, string> = {
  RESEARCH: "product_researcher",
  BRD: "business_analyst",
  PRD: "product_manager",
  TECH_REQUIREMENTS: "software_architect",
  ARCHITECTURE: "software_architect",
  UX_SPEC: "ux_designer",
  DESIGN_BRIEF: "ui_designer",
  QA_PLAN: "qa_agent",
  RELEASE_PLAN: "release_manager",
};

/** Expected sections per document (given to the AI as the outline). */
export const DOC_OUTLINE: Record<ProductDocKind, string> = {
  RESEARCH: "Market overview and size; target segments; competitor landscape (strengths, weaknesses, positioning); customer needs and pain points; validation evidence so far; opportunities and risks; open questions and next research steps.",
  BRD: "Business problem; objectives and success metrics (KPIs); stakeholders; scope (in/out); business requirements (numbered BR-1…); assumptions and constraints; business case (costs, revenue, ROI where data exists); risks; approval criteria.",
  PRD: "Problem and context; goals and non-goals; target users and personas; user stories; functional requirements (numbered FR-1…); non-functional requirements; features with priority (must/should/could) and acceptance criteria; UX notes; analytics/metrics; release scope (MVP vs later); open questions.",
  TECH_REQUIREMENTS: "Functional technical requirements; non-functional requirements (performance, security, privacy, availability, scalability); integrations and APIs; data requirements; environments and tooling; constraints; acceptance tests per requirement.",
  ARCHITECTURE: "System context; components and responsibilities; data model; APIs and integrations; technology choices with rationale; security and privacy; scalability and reliability; deployment; risks and trade-offs; implementation phases.",
  UX_SPEC: "Users and jobs-to-be-done; key user journeys; information architecture; screen/flow list with purpose; interaction patterns; accessibility requirements; usability risks; research/test plan.",
  DESIGN_BRIEF: "Design goals; brand and visual direction; design principles; screen inventory with layout notes; component list; states (empty, loading, error); responsive and RTL considerations; accessibility (contrast, focus); deliverables and review criteria.",
  QA_PLAN: "Scope and quality goals; test strategy (unit, integration, end-to-end, exploratory); test cases per feature/acceptance criterion; non-functional testing; environments and data; entry/exit criteria; defect triage; release blockers.",
  RELEASE_PLAN: "Release scope and version; milestones and dates; readiness checklist (QA, docs, support, marketing); rollout strategy and rollback; launch communications (customers, sales, support); changelog draft; post-launch metrics and feedback loop.",
};

export const docKind = z.enum(DOC_KINDS);
export const docVersionInput = z.object({ content: z.string().trim().min(1).max(200_000), changeNote: optText(300) });
export const docStatusInput = z.object({ status: z.enum(DOC_STATUSES) });
export const docAiInput = z.object({ guidance: optText(2000) });
export const useDraftInput = z.object({ taskId: z.string().uuid() });

/** Subject type of AI drafts for one document kind (subjectId = product id). */
export const docSubject = (kind: ProductDocKind) => `product_doc_${kind.toLowerCase()}`;

const log = logger.child({ component: "product-docs" });
const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : "");

/** Text of the product's context for AI prompts and tools (bounded by `max` characters). */
export async function productContextText(organizationId: string, companyId: string, productId: string, max = 6000) {
  const p = await productOf(db(), organizationId, companyId, productId);
  const [personas, competitors, validations, features, docs] = await Promise.all([
    db().productPersona.findMany({ where: { productId, companyId }, take: 10, orderBy: { name: "asc" } }),
    db().productCompetitor.findMany({ where: { productId, companyId }, take: 15, orderBy: { name: "asc" } }),
    db().productValidation.findMany({ where: { productId, companyId }, take: 20, orderBy: { createdAt: "desc" } }),
    db().productFeature.findMany({ where: { productId, companyId, archivedAt: null }, take: 40, orderBy: [{ riceScore: { sort: "desc", nulls: "last" } }], select: { id: true, title: true, status: true, riceScore: true } }),
    db().productDoc.findMany({ where: { productId, companyId }, select: { kind: true, status: true, currentVersion: true } }),
  ]);
  const lines = [
    `Product ${p.id} "${p.name}" — stage ${p.stage}, status ${p.status}`,
    p.description ? `Description: ${clip(p.description, 1200)}` : null,
    p.targetUsers ? `Target users: ${clip(p.targetUsers, 600)}` : null,
    personas.length ? `Personas:\n${personas.map((x) => `- ${x.name}${x.role ? ` (${x.role})` : ""}: ${clip([x.description, x.goals && `goals: ${x.goals}`, x.painPoints && `pains: ${x.painPoints}`].filter(Boolean).join("; "), 300)}`).join("\n")}` : null,
    competitors.length ? `Competitors:\n${competitors.map((c) => `- ${c.name}${c.website ? ` <${c.website}>` : ""}: ${clip([c.strengths && `strengths: ${c.strengths}`, c.weaknesses && `weaknesses: ${c.weaknesses}`, c.notes].filter(Boolean).join("; "), 300)}`).join("\n")}` : null,
    validations.length ? `Market validation:\n${validations.map((v) => `- [${v.result}] ${v.kind}: ${clip(v.hypothesis, 200)}${v.evidence ? ` — evidence: ${clip(v.evidence, 200)}` : ""}${v.sampleSize != null ? ` (n=${v.sampleSize})` : ""}`).join("\n")}` : null,
    features.length ? `Features:\n${features.map((f) => `- Feature ${f.id} [${f.status}] ${f.title}${f.riceScore != null ? ` RICE ${f.riceScore}` : ""}`).join("\n")}` : null,
    docs.length ? `Documents: ${docs.map((d) => `${d.kind} v${d.currentVersion} (${d.status})`).join(", ")}` : null,
  ].filter(Boolean) as string[];
  return clip(lines.join("\n"), max);
}

// ─── Brain indexing ───

/** Index (or re-index) a document's current version in Company Brain as sourceType "product_doc". Never throws. */
export async function syncDocToBrain(docId: string) {
  try {
    const doc = await db().productDoc.findUnique({ where: { id: docId }, include: { product: { select: { name: true } }, versions: { orderBy: { version: "desc" }, take: 1 } } });
    const v = doc?.versions[0];
    if (!doc || !v) return;
    let text: string;
    try {
      text = extractText(`# ${doc.title}\n\n${doc.product.name} · ${DOC_NAMES[doc.kind]} · version ${v.version} · ${doc.status}\n\n${v.content}`);
    } catch (err) {
      if (err instanceof ExtractionError) return;
      throw err;
    }
    const sha = createHash("sha256").update(text).digest("hex");
    const chunks = chunkText(text);
    const ctx = systemContext(`product_doc_index_${doc.id}`);
    await transaction(async (tx) => {
      const existing = await tx.brainDocument.findFirst({ where: { companyId: doc.companyId, sourceType: "product_doc", sourceId: doc.id }, select: { id: true, tags: true } });
      const data = { title: doc.title.slice(0, 200), mimeType: "text/markdown", sizeBytes: Buffer.byteLength(text, "utf8"), contentSha256: sha, status: "READY" as const, sourceUpdatedAt: doc.updatedAt };
      const tags = normalizeTags(["product", doc.kind.toLowerCase().replace(/_/g, "-"), ...(existing?.tags ?? [])]);
      let id = existing?.id;
      if (id) {
        await tx.brainChunk.deleteMany({ where: { documentId: id, companyId: doc.companyId } });
        await tx.brainDocument.update({ where: { id }, data: { ...data, tags } });
      } else {
        id = (await tx.brainDocument.create({ data: { ...data, tags, organizationId: doc.organizationId, companyId: doc.companyId, sourceType: "product_doc", sourceId: doc.id, createdById: v.createdById } })).id;
      }
      await tx.brainChunk.createMany({ data: chunks.map((c) => ({ organizationId: doc.organizationId, companyId: doc.companyId, documentId: id!, ...c })) });
      await tx.productDoc.update({ where: { id: doc.id }, data: { brainDocumentId: id } });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId: doc.organizationId, action: existing ? "brain.document.reindexed" : "brain.document.indexed", resourceType: "brain_document", resourceId: id!, newValue: { companyId: doc.companyId, sourceType: "product_doc", sourceId: doc.id, passages: chunks.length } });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      log.info({ docId }, "identical content already in Company Brain; skipped");
      return;
    }
    log.error({ docId, err: err instanceof Error ? err.message : String(err) }, "product doc brain sync failed");
  }
}

// ─── Documents ───

export async function listDocs(ctx: RequestContext, organizationId: string, companyId: string, productId: string) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  await productOf(db(), organizationId, companyId, productId);
  const docs = await db().productDoc.findMany({
    where: { productId, companyId },
    include: { versions: { orderBy: { version: "desc" }, take: 1, select: { createdAt: true, createdById: true, agentTaskId: true } } },
  });
  return DOC_KINDS.map((kind) => {
    const d = docs.find((x) => x.kind === kind);
    return { kind, doc: d ? { id: d.id, title: d.title, status: d.status, currentVersion: d.currentVersion, updatedAt: d.versions[0]?.createdAt ?? d.updatedAt, aiDraft: !!d.versions[0]?.agentTaskId, brainDocumentId: d.brainDocumentId } : null };
  });
}

/** One document with its version list and the content of `version` (default current). */
export async function getDoc(ctx: RequestContext, organizationId: string, companyId: string, productId: string, kind: ProductDocKind, version?: number) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  await productOf(db(), organizationId, companyId, productId);
  const doc = await db().productDoc.findUnique({ where: { productId_kind: { productId, kind } } });
  if (!doc || doc.companyId !== companyId) return null;
  const versions = await db().productDocVersion.findMany({ where: { docId: doc.id, companyId }, orderBy: { version: "desc" }, take: 100, select: { id: true, version: true, changeNote: true, agentTaskId: true, createdById: true, createdAt: true } });
  const v = version ?? doc.currentVersion;
  const shown = await db().productDocVersion.findUnique({ where: { docId_version: { docId: doc.id, version: v } } });
  const ids = [...new Set(versions.map((x) => x.createdById))];
  const users = ids.length ? await db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return { ...doc, versions: versions.map((x) => ({ ...x, createdByName: names.get(x.createdById) ?? null })), shown: shown ? { version: shown.version, content: shown.content, createdAt: shown.createdAt, agentTaskId: shown.agentTaskId } : null };
}

/** Save a new version of a document (creating the document on first save), then index it in Company Brain. */
export async function saveDocVersion(ctx: RequestContext, organizationId: string, companyId: string, productId: string, kind: ProductDocKind, raw: z.input<typeof docVersionInput>, opts: { agentTaskId?: string } = {}) {
  const input = docVersionInput.parse(raw);
  const saved = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const p = await productOf(tx, organizationId, companyId, productId);
    let doc = await tx.productDoc.findUnique({ where: { productId_kind: { productId, kind } } });
    let version = 1;
    if (!doc) {
      doc = await tx.productDoc.create({ data: { organizationId, companyId, productId, kind, title: `${p.name} — ${DOC_NAMES[kind]}`.slice(0, 200), currentVersion: 1, createdById: actorId(ctx, organizationId) } });
    } else {
      const last = await tx.productDocVersion.findFirst({ where: { docId: doc.id }, orderBy: { version: "desc" }, select: { version: true, content: true } });
      if (last && last.content === input.content) throw conflict("No changes to save", { reason: "work_product_doc_unchanged" });
      version = (last?.version ?? 0) + 1;
      // A new version goes back to draft for review.
      doc = await tx.productDoc.update({ where: { id: doc.id }, data: { currentVersion: version, status: "DRAFT" } });
    }
    await tx.productDocVersion.create({ data: { organizationId, companyId, docId: doc.id, version, content: input.content, changeNote: blank(input.changeNote) ?? null, agentTaskId: opts.agentTaskId ?? null, createdById: actorId(ctx, organizationId) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "product_doc.version_saved", resourceType: "product_doc", resourceId: doc.id, newValue: { productId, kind, version, fromAi: !!opts.agentTaskId } });
    return { ...doc, version };
  });
  await syncDocToBrain(saved.id);
  return saved;
}

export async function setDocStatus(ctx: RequestContext, organizationId: string, companyId: string, productId: string, kind: ProductDocKind, raw: z.input<typeof docStatusInput>) {
  const input = docStatusInput.parse(raw);
  const doc = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    await productOf(tx, organizationId, companyId, productId);
    const d = await tx.productDoc.findUnique({ where: { productId_kind: { productId, kind } } });
    if (!d || d.companyId !== companyId) throw notFound("Document");
    const u = await tx.productDoc.update({ where: { id: d.id }, data: { status: input.status } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "product_doc.status_changed", resourceType: "product_doc", resourceId: d.id, newValue: { status: input.status }, oldValue: { status: d.status } });
    return u;
  });
  await syncDocToBrain(doc.id);
  return doc;
}

/** Restore an earlier version as a new current version. */
export async function restoreDocVersion(ctx: RequestContext, organizationId: string, companyId: string, productId: string, kind: ProductDocKind, version: number) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const doc = await db().productDoc.findUnique({ where: { productId_kind: { productId, kind } } });
  if (!doc || doc.companyId !== companyId) throw notFound("Document");
  const v = await db().productDocVersion.findUnique({ where: { docId_version: { docId: doc.id, version } } });
  if (!v) throw notFound("Version");
  return saveDocVersion(ctx, organizationId, companyId, productId, kind, { content: v.content, changeNote: `Restored version ${version}` });
}

/** Instructions for an AI draft of one document, with the product context and earlier documents. */
export async function docInstructions(organizationId: string, companyId: string, productId: string, kind: ProductDocKind, extra: { guidance?: string | null; previous?: string } = {}) {
  const context = await productContextText(organizationId, companyId, productId, 3500);
  const current = await db().productDoc.findUnique({ where: { productId_kind: { productId, kind } }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  const parts = [
    `Write the ${DOC_NAMES[kind]} for this product, in Markdown, ready to save as the document. Output only the document (headings, lists, tables) — no preamble.`,
    `Sections: ${DOC_OUTLINE[kind]}`,
    "Ground every statement in the product data below, the company's documents (search_company_brain) and its graph. Mark assumptions clearly as assumptions and list open questions instead of inventing facts, numbers, customers or competitors.",
    `Product context:\n${context}`,
    extra.previous ? `Outputs of earlier steps (the full documents are in Company Brain, tag "product"):\n${clip(extra.previous, 2500)}` : null,
    current?.versions[0] ? `Current version ${current.versions[0].version} to improve on (excerpt):\n${clip(current.versions[0].content, 1200)}` : null,
    extra.guidance ? `Guidance from the requester: ${extra.guidance}` : null,
    `Today: ${dayString(today())}`,
  ];
  return clip(parts.filter(Boolean).join("\n\n"), 7900);
}

/** "Generate with AI": an AI task attached to the product for one document kind. */
export async function generateDocAi(ctx: RequestContext, organizationId: string, companyId: string, productId: string, kind: ProductDocKind, raw: z.input<typeof docAiInput>) {
  const input = docAiInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "projects.read");
  const p = await productOf(db(), organizationId, companyId, productId);
  return createAgentTask(ctx, organizationId, companyId, {
    profile: DOC_PROFILE[kind],
    title: `${DOC_NAMES[kind]}: ${p.name}`.slice(0, 200),
    instructions: await docInstructions(organizationId, companyId, productId, kind, { guidance: blank(input.guidance) }),
    subject: { type: docSubject(kind), id: productId },
  });
}

/** Strip a leading fenced block wrapper the model may add around the document. */
export function cleanAiDoc(output: string) {
  const t = output.trim();
  const m = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/i.exec(t);
  return (m ? m[1]! : t).trim();
}

/** "Use AI draft": save a completed AI task's output (about this product and document) as a new version. */
export async function useAiDraft(ctx: RequestContext, organizationId: string, companyId: string, productId: string, kind: ProductDocKind, raw: z.input<typeof useDraftInput>) {
  const input = useDraftInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "projects.manage");
  if (!isUuid(productId)) throw notFound("Product");
  const task = await db().agentTask.findFirst({ where: { id: input.taskId, organizationId, companyId }, select: { id: true, status: true, output: true, subjectType: true, subjectId: true } });
  if (!task) throw notFound("Task");
  const planStep = task.subjectType === "product_plan" && !!task.subjectId && (await db().productPlanRun.findFirst({ where: { id: task.subjectId, productId, companyId }, select: { id: true } }));
  if (!planStep && (task.subjectType !== docSubject(kind) || task.subjectId !== productId)) throw invalid("This AI task is not a draft of this document", { reason: "work_product_draft_mismatch" });
  if (task.status !== "COMPLETED" || !task.output?.trim()) throw conflict("The AI task has no completed output", { reason: "work_product_draft_not_ready" });
  return saveDocVersion(ctx, organizationId, companyId, productId, kind, { content: cleanAiDoc(task.output).slice(0, 200_000), changeNote: "AI draft" }, { agentTaskId: task.id });
}

/** Documents of a product, for the AI tool read_product_docs (current versions, bounded). */
export async function docsText(organizationId: string, companyId: string, productId: string, kinds?: ProductDocKind[], max = 20_000) {
  const docs = await db().productDoc.findMany({
    where: { productId, companyId, ...(kinds?.length ? { kind: { in: kinds } } : {}) },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!docs.length) return "";
  const per = Math.floor(max / docs.length);
  return docs.map((d) => `## ${DOC_NAMES[d.kind]} (v${d.currentVersion}, ${d.status})\n${clip(d.versions[0]?.content, per)}`).join("\n\n");
}

/** URL segment ("prd", "tech_requirements") → document kind (not found otherwise). */
export function kindParam(v: string): ProductDocKind {
  const k = v.toUpperCase();
  if (!(DOC_KINDS as readonly string[]).includes(k)) throw notFound("Document");
  return k as ProductDocKind;
}
