import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { capabilitiesFor, daysAgo, isUuid, reasonSchema, requireAnyPlatform, requireConfirmation, requirePlatform } from "./access";

/**
 * Knowledge & memory admin (stream C): the Company Brain across organizations — documents, passages, embeddings and
 * index coverage, company memory, AI employee memory, ingestion and indexing jobs, retrieval activity, retention.
 *
 * Tenant isolation: every query and action is scoped to one organization / company id from the URL and checked in
 * code; actions go through the brain module's own functions (system principal) where they exist, so their rules
 * apply (module-indexed documents are removed at their source, vectors never outlive their text). Content (titles,
 * facts) is shown only with `platform.data.read`; everyone with AI read access sees counts and sizes.
 */

const READ = ["platform.ai.read", "platform.ai.manage"];

interface OrgRow {
  organization_id: string;
  n: bigint;
  bytes?: bigint | null;
  failed?: bigint;
}

let overviewCache: { at: number; value: Awaited<ReturnType<typeof computeOverview>> } | null = null;

async function computeOverview() {
  const [docs, chunks, embeddings, memories, employeeMemories, jobs, retrieval7d, vector] = await Promise.all([
    db().$queryRaw<OrgRow[]>`SELECT organization_id, COUNT(*)::bigint AS n, SUM(size_bytes)::bigint AS bytes, COUNT(*) FILTER (WHERE status = 'FAILED')::bigint AS failed FROM brain_documents GROUP BY 1 ORDER BY bytes DESC NULLS LAST LIMIT 200`,
    db().$queryRaw<OrgRow[]>`SELECT organization_id, COUNT(*)::bigint AS n, SUM(length(text))::bigint AS bytes FROM brain_chunks GROUP BY 1`,
    db().$queryRaw<OrgRow[]>`SELECT organization_id, COUNT(*)::bigint AS n FROM brain_embeddings GROUP BY 1`,
    db().$queryRaw<OrgRow[]>`SELECT organization_id, COUNT(*)::bigint AS n, SUM(length(fact))::bigint AS bytes FROM company_memories GROUP BY 1`,
    db().$queryRaw<OrgRow[]>`SELECT organization_id, COUNT(*)::bigint AS n, SUM(length(content))::bigint AS bytes FROM ai_employee_memories GROUP BY 1`,
    db().workerJobRun.findMany({ where: { jobName: { startsWith: "brain." }, createdAt: { gte: daysAgo(7) } }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, jobName: true, status: true, attempts: true, lastError: true, result: true, durationMs: true, startedAt: true, finishedAt: true, organizationId: true } }),
    db().$queryRaw<OrgRow[]>`SELECT organization_id, COUNT(*)::bigint AS n FROM company_memories WHERE last_used_at >= ${daysAgo(7)} GROUP BY 1`,
    db().$queryRaw<{ ext: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS ext`,
  ]);
  const ids = [...new Set([...docs, ...memories, ...employeeMemories].map((r) => r.organization_id))];
  const orgs = await db().organization.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const get = (rows: OrgRow[], id: string) => rows.find((r) => r.organization_id === id);
  const perOrg = ids
    .map((id) => {
      const d = get(docs, id);
      const c = get(chunks, id);
      return {
        organizationId: id,
        name: orgs.find((o) => o.id === id)?.name ?? id.slice(0, 8),
        documents: Number(d?.n ?? 0),
        documentBytes: Number(d?.bytes ?? 0),
        failedDocuments: Number(d?.failed ?? 0),
        chunks: Number(c?.n ?? 0),
        textBytes: Number(c?.bytes ?? 0) + Number(get(memories, id)?.bytes ?? 0) + Number(get(employeeMemories, id)?.bytes ?? 0),
        embeddings: Number(get(embeddings, id)?.n ?? 0),
        memories: Number(get(memories, id)?.n ?? 0),
        employeeMemories: Number(get(employeeMemories, id)?.n ?? 0),
        retrieved7d: Number(get(retrieval7d, id)?.n ?? 0),
      };
    })
    .sort((a, b) => b.documentBytes + b.textBytes - (a.documentBytes + a.textBytes));
  const sum = (k: keyof (typeof perOrg)[number]) => perOrg.reduce((a, o) => a + (o[k] as number), 0);
  return {
    computedAt: new Date().toISOString(),
    vectorExtension: !!vector[0]?.ext,
    totals: { documents: sum("documents"), documentBytes: sum("documentBytes"), failedDocuments: sum("failedDocuments"), chunks: sum("chunks"), embeddings: sum("embeddings"), memories: sum("memories"), employeeMemories: sum("employeeMemories"), retrieved7d: sum("retrieved7d") },
    perOrg: perOrg.slice(0, 100),
    jobs,
  };
}

/** Platform overview (cached 5 minutes: full-table aggregates). */
export async function knowledgeOverview(ctx: RequestContext, opts: { fresh?: boolean } = {}) {
  await requireAnyPlatform(ctx, READ);
  if (opts.fresh || !overviewCache || Date.now() - overviewCache.at > 5 * 60_000) overviewCache = { at: Date.now(), value: await computeOverview() };
  return overviewCache.value;
}

/** One organization's knowledge, per company: documents (paged), index coverage, memory by layer, retention, failures. */
export async function knowledgeForOrganization(ctx: RequestContext, organizationId: string, raw: { company?: string; cursor?: string; status?: string } = {}) {
  await requireAnyPlatform(ctx, READ);
  if (!isUuid(organizationId)) throw notFound("Organization");
  const org = await db().organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } });
  if (!org) throw notFound("Organization");
  const caps = await capabilitiesFor(ctx, ["platform.data.read", "platform.ai.manage", "platform.data.export"]);
  const sensitive = caps["platform.data.read"];
  const companies = await db().company.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, take: 100, select: { id: true, name: true } });
  const companyId = raw.company && companies.some((c) => c.id === raw.company) ? raw.company : (companies[0]?.id ?? null);
  if (!companyId) return { organization: org, companies, companyId: null, sensitive, caps, documents: [], nextCursor: null, coverage: null, memoryByLayer: [], retention: [], employeeMemory: 0, failures: [] };
  const status = raw.status === "FAILED" || raw.status === "PROCESSING" || raw.status === "READY" ? raw.status : undefined;
  const [docs, chunkCount, embedded, memoryByLayer, retention, employeeMemory, failures, models] = await Promise.all([
    db().brainDocument.findMany({ where: { organizationId, companyId, ...(status ? { status } : {}) }, orderBy: { id: "desc" }, take: 51, ...(raw.cursor && isUuid(raw.cursor) ? { cursor: { id: raw.cursor }, skip: 1 } : {}), select: { id: true, title: true, filename: true, mimeType: true, sizeBytes: true, status: true, sourceType: true, tags: true, createdAt: true, updatedAt: true, _count: { select: { chunks: true } } } }),
    db().brainChunk.count({ where: { companyId } }),
    db().brainEmbedding.groupBy({ by: ["model", "targetType"], where: { organizationId, companyId }, _count: { _all: true } }),
    db().companyMemory.groupBy({ by: ["layer"], where: { organizationId, companyId }, _count: { _all: true } }),
    db().brainRetentionPolicy.findMany({ where: { organizationId, companyId }, select: { layer: true, retentionDays: true, updatedAt: true } }),
    db().aiEmployeeMemory.count({ where: { organizationId, companyId } }),
    db().brainDocument.findMany({ where: { organizationId, companyId, status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 20, select: { id: true, title: true, mimeType: true, sizeBytes: true, updatedAt: true } }),
    db().brainEmbedding.findFirst({ where: { companyId }, orderBy: { createdAt: "desc" }, select: { model: true, createdAt: true } }),
  ]);
  const memories = await db().companyMemory.count({ where: { organizationId, companyId } });
  const page = docs.slice(0, 50);
  const chunkEmbedded = embedded.filter((e) => e.targetType === "CHUNK" && (!models || e.model === models.model)).reduce((a, e) => a + e._count._all, 0);
  const memoryEmbedded = embedded.filter((e) => e.targetType === "MEMORY" && (!models || e.model === models.model)).reduce((a, e) => a + e._count._all, 0);
  const { MEMORY_LAYERS_LIST } = await layers();
  return {
    organization: org,
    companies,
    companyId,
    sensitive,
    caps,
    documents: page.map((d) => ({ ...d, title: sensitive ? d.title : null, filename: sensitive ? d.filename : null, chunks: d._count.chunks })),
    nextCursor: docs.length > 50 ? page[49]!.id : null,
    coverage: { model: models?.model ?? null, lastEmbeddedAt: models?.createdAt ?? null, chunks: chunkCount, chunkEmbedded, memories, memoryEmbedded, byModel: embedded.map((e) => ({ model: e.model, targetType: e.targetType, count: e._count._all })) },
    memoryByLayer: memoryByLayer.map((m) => ({ layer: m.layer, count: m._count._all })),
    retention: MEMORY_LAYERS_LIST.map((layer) => ({ layer, retentionDays: retention.find((r) => r.layer === layer)?.retentionDays ?? null, custom: retention.some((r) => r.layer === layer), updatedAt: retention.find((r) => r.layer === layer)?.updatedAt ?? null })),
    employeeMemory,
    failures: failures.map((f) => ({ ...f, title: sensitive ? f.title : null })),
  };
}

async function layers() {
  const { MemoryLayer } = await import("@/generated/prisma/enums");
  return { MEMORY_LAYERS_LIST: Object.values(MemoryLayer) as string[] };
}

export const knowledgeActionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reindex"), companyId: z.string().uuid(), reason: reasonSchema }),
  z.object({ action: z.literal("deleteDocument"), companyId: z.string().uuid(), documentId: z.string().uuid(), reason: reasonSchema }),
  z.object({ action: z.literal("retention"), companyId: z.string().uuid(), layer: z.string().regex(/^[A-Z_]{3,20}$/), retentionDays: z.number().int().min(1).max(3650).nullable(), reason: reasonSchema }),
  z.object({ action: z.literal("purge"), companyId: z.string().uuid(), scope: z.enum(["documents", "memories", "employeeMemories", "all"]), reason: reasonSchema, confirm: z.string().optional() }),
]);

/**
 * Authorized knowledge actions for one company of one organization (platform.ai.manage), audited as ADMIN with a
 * reason. Reindex runs the brain module's bounded embedding pass for that company now (needs an embedding provider);
 * delete and retention go through the brain module; purge (typed confirmation: the organization name) removes the
 * chosen kind of knowledge and its vectors for that company only.
 */
export async function knowledgeAction(ctx: RequestContext, organizationId: string, raw: z.input<typeof knowledgeActionInput>) {
  const input = knowledgeActionInput.parse(raw);
  await requirePlatform(ctx, "platform.ai.manage");
  if (!isUuid(organizationId)) throw notFound("Organization");
  const company = await db().company.findFirst({ where: { id: input.companyId, organizationId }, select: { id: true, organizationId: true, name: true, organization: { select: { name: true } } } });
  if (!company) throw notFound("Company");
  const sys = systemContext(ctx.requestId);
  let result: Record<string, unknown>;
  switch (input.action) {
    case "reindex": {
      const { embedCompany, vectorStoreAvailable } = await import("@/server/modules/brain/embeddings");
      const cap = await vectorStoreAvailable();
      if (!cap.extension || !cap.column) throw conflict("The vector store is not available (pgvector extension or column missing)", { reason: "vector_store_unavailable" });
      result = { embedded: await embedCompany(organizationId, company.id) };
      break;
    }
    case "deleteDocument": {
      const { deleteDocument } = await import("@/server/modules/brain/service");
      await deleteDocument(sys, organizationId, company.id, input.documentId);
      result = { documentId: input.documentId };
      break;
    }
    case "retention": {
      const { setRetention } = await import("@/server/modules/brain/memory-store");
      result = await setRetention(sys, organizationId, company.id, { layer: input.layer as never, retentionDays: input.retentionDays });
      break;
    }
    case "purge": {
      requireConfirmation(input.confirm, company.organization.name);
      result = await transaction(async (tx) => {
        const out: Record<string, number> = {};
        if (input.scope === "documents" || input.scope === "all") {
          // Module-indexed documents are re-created by their source; uploads are removed for good.
          const chunkIds = (await tx.brainChunk.findMany({ where: { companyId: company.id, document: { sourceType: null } }, select: { id: true } })).map((c) => c.id);
          for (let i = 0; i < chunkIds.length; i += 5_000) await tx.brainEmbedding.deleteMany({ where: { companyId: company.id, targetType: "CHUNK", targetId: { in: chunkIds.slice(i, i + 5_000) } } });
          out.documents = (await tx.brainDocument.deleteMany({ where: { organizationId, companyId: company.id, sourceType: null } })).count;
        }
        if (input.scope === "memories" || input.scope === "all") {
          out.memoryVectors = (await tx.brainEmbedding.deleteMany({ where: { companyId: company.id, targetType: "MEMORY" } })).count;
          out.memories = (await tx.companyMemory.deleteMany({ where: { organizationId, companyId: company.id } })).count;
        }
        if (input.scope === "employeeMemories" || input.scope === "all") out.employeeMemories = (await tx.aiEmployeeMemory.deleteMany({ where: { organizationId, companyId: company.id } })).count;
        return out;
      }, { timeout: 60_000 });
      break;
    }
  }
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", organizationId, action: `platform.knowledge.${input.action === "deleteDocument" ? "document_deleted" : input.action}`, resourceType: "company", resourceId: company.id, newValue: { ...("scope" in input ? { scope: input.scope } : {}), ...("layer" in input ? { layer: input.layer, retentionDays: input.retentionDays } : {}), result }, reason: input.reason }));
  overviewCache = null;
  return { ok: true, ...result };
}

/** Export one company's knowledge inventory (document metadata, memory facts, retention) through the brain module. */
export async function exportKnowledge(ctx: RequestContext, organizationId: string, companyId: string, reason: string) {
  await requirePlatform(ctx, "platform.data.export");
  reasonSchema.parse(reason);
  if (!isUuid(organizationId) || !isUuid(companyId)) throw notFound("Company");
  const company = await db().company.findFirst({ where: { id: companyId, organizationId }, select: { id: true } });
  if (!company) throw notFound("Company");
  const { exportMemory } = await import("@/server/modules/brain/memory-store");
  const data = await exportMemory(systemContext(ctx.requestId), organizationId, companyId);
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", organizationId, action: "platform.knowledge.exported", resourceType: "company", resourceId: companyId, newValue: { memories: data.memories.length, documents: data.documents.length }, reason }));
  return { filename: `knowledge-${companyId}-${new Date().toISOString().slice(0, 10)}.json`, json: JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) };
}

export const knowledgeExportInput = z.object({ companyId: z.string().uuid(), reason: reasonSchema });
