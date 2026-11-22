import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { db, Prisma } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { providerFetch } from "@/server/modules/integrations/client";
import type { Connection } from "@/server/modules/integrations/connections";
import { ensureOk, usableConnection } from "@/server/modules/integrations/services/common";
import { recordUsage } from "@/server/modules/integrations/usage";

/**
 * Semantic layer of the shared company memory. Optional by design:
 *  - an embedding provider must be connected by the company in Integrations (OpenAI, Gemini or Voyage — tried in that order);
 *  - the database must have the pgvector extension and the brain_embeddings.embedding column (docs/brain-memory.md).
 * When either is missing, `semanticStatus` says so and retrieval uses PostgreSQL full-text search only — nothing fails.
 */

const log = logger.child({ component: "brain-embeddings" });

export const EMBEDDING_PROVIDERS = ["openai", "gemini", "voyage"] as const;
export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];
export const VECTOR_DIMENSIONS = 1536;
const MODELS: Record<EmbeddingProvider, { model: string; dimensions: number; usdPerMTokens: number }> = {
  openai: { model: "text-embedding-3-small", dimensions: 1536, usdPerMTokens: 0.02 },
  gemini: { model: "gemini-embedding-001", dimensions: 1536, usdPerMTokens: 0.15 },
  voyage: { model: "voyage-3.5", dimensions: 1024, usdPerMTokens: 0.06 },
};
/** Characters of the previous passage prepended when a passage is embedded (chunk overlap for retrieval only). */
export const CHUNK_OVERLAP_CHARS = 300;
const MAX_INPUT_CHARS = 8000;
const BATCH = 64;

// ───────────── Capability ─────────────

let capability: { at: number; extension: boolean; column: boolean } | null = null;
const CAPABILITY_TTL_MS = 5 * 60_000;

/** Is pgvector installed and the vector column present? Cached for 5 minutes; any error means "no". */
export async function vectorStoreAvailable(): Promise<{ extension: boolean; column: boolean }> {
  if (capability && Date.now() - capability.at < CAPABILITY_TTL_MS) return capability;
  try {
    const [row] = await db().$queryRaw<{ extension: boolean; column: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS extension,
             EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = current_schema() AND table_name = 'brain_embeddings' AND column_name = 'embedding' AND udt_name = 'vector') AS column`;
    capability = { at: Date.now(), extension: !!row?.extension, column: !!row?.column };
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "vector capability check failed");
    capability = { at: Date.now(), extension: false, column: false };
  }
  return capability;
}

export interface EmbeddingConnection {
  provider: EmbeddingProvider;
  model: string;
  /** Stored model key, e.g. "openai:text-embedding-3-small" — only vectors of the same key are compared. */
  modelKey: string;
  dimensions: number;
  conn: Connection & { accessToken: string };
}

/** The company's first usable embedding provider, or null. */
export async function embeddingConnection(organizationId: string, companyId: string): Promise<EmbeddingConnection | null> {
  for (const provider of EMBEDDING_PROVIDERS) {
    try {
      const conn = await usableConnection(organizationId, companyId, provider);
      if (conn) {
        const m = MODELS[provider];
        return { provider, model: m.model, modelKey: `${provider}:${m.model}`, dimensions: m.dimensions, conn };
      }
    } catch {
      // try the next provider
    }
  }
  return null;
}

export type SemanticMode = "hybrid" | "fts";
export interface SemanticStatus {
  mode: SemanticMode;
  /** Why semantic search is off: no provider connected, or the database lacks pgvector. */
  reason: "ok" | "no_provider" | "no_pgvector";
  provider: EmbeddingProvider | null;
  model: string | null;
  vectorStore: { extension: boolean; column: boolean };
}

export async function semanticStatus(organizationId: string, companyId: string): Promise<SemanticStatus> {
  const [store, emb] = await Promise.all([vectorStoreAvailable(), embeddingConnection(organizationId, companyId)]);
  const reason = !emb ? "no_provider" : !(store.extension && store.column) ? "no_pgvector" : "ok";
  return { mode: reason === "ok" ? "hybrid" : "fts", reason, provider: emb?.provider ?? null, model: emb?.model ?? null, vectorStore: { extension: store.extension, column: store.column } };
}

/** Index coverage for the status panel: embedded vs total passages and memories for the current model. */
export async function embeddingCoverage(organizationId: string, companyId: string, modelKey: string | null) {
  const [chunks, memories] = await Promise.all([db().brainChunk.count({ where: { organizationId, companyId } }), db().companyMemory.count({ where: { organizationId, companyId } })]);
  if (!modelKey) return { chunks, memories, embeddedChunks: 0, embeddedMemories: 0 };
  const rows = await db().brainEmbedding.groupBy({ by: ["targetType"], where: { organizationId, companyId, model: modelKey }, _count: { _all: true } });
  const n = (t: string) => rows.find((r) => r.targetType === t)?._count._all ?? 0;
  return { chunks, memories, embeddedChunks: Math.min(n("CHUNK"), chunks), embeddedMemories: Math.min(n("MEMORY"), memories) };
}

// ───────────── Provider calls ─────────────

const clip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, MAX_INPUT_CHARS);

/** Embed texts with the company's provider (vectors zero-padded to 1536). Throws ProviderError on provider failure. */
export async function embedTexts(e: EmbeddingConnection, texts: string[], purpose: "document" | "query"): Promise<number[][]> {
  if (!texts.length) return [];
  const input = texts.map(clip);
  let vectors: number[][] = [];
  let tokens = 0;
  try {
    if (e.provider === "openai") {
      const res = await providerFetch<{ data?: { embedding: number[]; index: number }[]; usage?: { prompt_tokens?: number } }>(e.conn, "https://api.openai.com/v1/embeddings", {
        json: { model: e.model, input },
        timeoutMs: 30_000,
        retries: 2,
      });
      ensureOk(res, "OpenAI embeddings");
      vectors = [...(res.data?.data ?? [])].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      tokens = res.data?.usage?.prompt_tokens ?? 0;
    } else if (e.provider === "gemini") {
      const res = await providerFetch<{ embeddings?: { values: number[] }[] }>(e.conn, `https://generativelanguage.googleapis.com/v1beta/models/${e.model}:batchEmbedContents`, {
        json: {
          requests: input.map((text) => ({ model: `models/${e.model}`, content: { parts: [{ text }] }, taskType: purpose === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT", outputDimensionality: e.dimensions })),
        },
        timeoutMs: 30_000,
        retries: 2,
      });
      ensureOk(res, "Gemini embeddings");
      vectors = (res.data?.embeddings ?? []).map((d) => d.values);
      tokens = Math.ceil(input.reduce((s, t) => s + t.length, 0) / 4);
    } else {
      const res = await providerFetch<{ data?: { embedding: number[]; index: number }[]; usage?: { total_tokens?: number } }>(e.conn, "https://api.voyageai.com/v1/embeddings", {
        json: { model: e.model, input, input_type: purpose, output_dimension: e.dimensions },
        timeoutMs: 30_000,
        retries: 2,
      });
      ensureOk(res, "Voyage embeddings");
      vectors = [...(res.data?.data ?? [])].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      tokens = res.data?.usage?.total_tokens ?? 0;
    }
    if (vectors.length !== input.length || vectors.some((v) => !Array.isArray(v) || v.length === 0 || v.length > VECTOR_DIMENSIONS)) {
      throw new Error(`${e.provider} returned ${vectors.length} vectors for ${input.length} inputs`);
    }
    await recordUsage({
      organizationId: e.conn.organizationId!,
      companyId: e.conn.companyId!,
      connectionId: e.conn.id,
      provider: e.provider,
      operation: purpose === "query" ? "brain.embed_query" : "brain.embed",
      units: tokens,
      unit: "token",
      estimatedCostMicros: tokens * MODELS[e.provider].usdPerMTokens,
      status: "SUCCEEDED",
      meta: { model: e.model, inputs: input.length },
    });
    return vectors.map(pad);
  } catch (err) {
    await recordUsage({
      organizationId: e.conn.organizationId!,
      companyId: e.conn.companyId!,
      connectionId: e.conn.id,
      provider: e.provider,
      operation: purpose === "query" ? "brain.embed_query" : "brain.embed",
      status: "FAILED",
      error: err instanceof Error ? err.message : String(err),
      meta: { model: e.model, inputs: input.length },
    });
    throw err;
  }
}

function pad(v: number[]): number[] {
  if (v.length === VECTOR_DIMENSIONS) return v;
  return [...v, ...new Array<number>(VECTOR_DIMENSIONS - v.length).fill(0)];
}

/** pgvector text literal; values are finite numbers (non-finite → 0), so the literal is always well-formed. */
const literal = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(7) : "0")).join(",")}]`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// Query embeddings are reused for identical queries (per process, small LRU).
const queryCache = new Map<string, number[]>();

/** The query vector, or null when semantic search is unavailable or the provider failed (callers fall back to FTS). */
export async function queryVector(organizationId: string, companyId: string, query: string): Promise<{ vector: number[]; modelKey: string } | null> {
  const store = await vectorStoreAvailable();
  if (!store.extension || !store.column || !query.trim()) return null;
  const e = await embeddingConnection(organizationId, companyId);
  if (!e) return null;
  const key = `${companyId}:${e.modelKey}:${query.trim().toLowerCase()}`;
  const hit = queryCache.get(key);
  if (hit) return { vector: hit, modelKey: e.modelKey };
  try {
    const [vector] = await embedTexts(e, [query], "query");
    if (!vector) return null;
    queryCache.set(key, vector);
    if (queryCache.size > 500) queryCache.delete(queryCache.keys().next().value!);
    return { vector, modelKey: e.modelKey };
  } catch (err) {
    log.warn({ companyId, provider: e.provider, err: err instanceof Error ? err.message : String(err) }, "query embedding failed; full-text only");
    return null;
  }
}

/** Nearest stored vectors of one company and model (cosine similarity, best first). Never throws. */
export async function nearest(organizationId: string, companyId: string, q: { vector: number[]; modelKey: string }, k: number): Promise<{ targetType: "CHUNK" | "MEMORY"; targetId: string; similarity: number }[]> {
  try {
    const rows = await db().$queryRaw<{ target_type: "CHUNK" | "MEMORY"; target_id: string; similarity: number }[]>`
      SELECT e.target_type::text AS target_type, e.target_id, 1 - (e.embedding <=> ${literal(q.vector)}::vector) AS similarity
        FROM brain_embeddings e
       WHERE e.organization_id = ${organizationId}::uuid AND e.company_id = ${companyId}::uuid
         AND e.model = ${q.modelKey} AND e.embedding IS NOT NULL
       ORDER BY e.embedding <=> ${literal(q.vector)}::vector
       LIMIT ${k}`;
    return rows.map((r) => ({ targetType: r.target_type, targetId: r.target_id, similarity: Number(r.similarity) }));
  } catch (err) {
    log.warn({ companyId, err: err instanceof Error ? err.message : String(err) }, "vector search failed; full-text only");
    return [];
  }
}

async function store(e: EmbeddingConnection, organizationId: string, companyId: string, items: { targetType: "CHUNK" | "MEMORY"; targetId: string; text: string }[]) {
  const vectors = await embedTexts(e, items.map((i) => i.text), "document");
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    await db().$executeRaw`
      INSERT INTO brain_embeddings (id, organization_id, company_id, target_type, target_id, provider, model, dimensions, content_sha256, embedding, created_at)
      VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${companyId}::uuid, ${it.targetType}::"BrainEmbeddingTarget", ${it.targetId}::uuid,
              ${e.provider}, ${e.modelKey}, ${e.dimensions}, ${sha(it.text)}, ${literal(vectors[i]!)}::vector, now())
      ON CONFLICT (target_type, target_id, model) DO UPDATE
        SET embedding = EXCLUDED.embedding, content_sha256 = EXCLUDED.content_sha256, dimensions = EXCLUDED.dimensions, provider = EXCLUDED.provider, created_at = now()`;
  }
  return items.length;
}

/**
 * Incremental re-embedding of one company: passages without a vector for the current model (with the previous
 * passage's tail as overlap), and memories never embedded or edited since. At most `limit` items per call.
 */
export async function embedCompany(organizationId: string, companyId: string, limit = 256): Promise<number> {
  const e = await embeddingConnection(organizationId, companyId);
  if (!e) return 0;
  const chunks = await db().$queryRaw<{ id: string; text: string; prev_tail: string | null }[]>`
    SELECT c.id, c.text,
           (SELECT right(p.text, ${CHUNK_OVERLAP_CHARS}) FROM brain_chunks p WHERE p.document_id = c.document_id AND p.ordinal = c.ordinal - 1) AS prev_tail
      FROM brain_chunks c
      JOIN brain_documents d ON d.id = c.document_id AND d.company_id = c.company_id
      LEFT JOIN brain_embeddings e ON e.target_type = 'CHUNK' AND e.target_id = c.id AND e.model = ${e.modelKey}
     WHERE c.company_id = ${companyId}::uuid AND d.organization_id = ${organizationId}::uuid AND d.status = 'READY' AND e.id IS NULL
     ORDER BY c.document_id, c.ordinal
     LIMIT ${limit}`;
  const memories = await db().$queryRaw<{ id: string; title: string; fact: string }[]>`
    SELECT m.id, m.title, m.fact
      FROM company_memories m
      LEFT JOIN brain_embeddings e ON e.target_type = 'MEMORY' AND e.target_id = m.id AND e.model = ${e.modelKey}
     WHERE m.organization_id = ${organizationId}::uuid AND m.company_id = ${companyId}::uuid
       AND (e.id IS NULL OR e.created_at < m.updated_at)
     ORDER BY m.updated_at DESC
     LIMIT ${Math.max(0, limit - chunks.length)}`;
  const items = [
    ...chunks.map((c) => ({ targetType: "CHUNK" as const, targetId: c.id, text: `${c.prev_tail ? `${c.prev_tail} ` : ""}${c.text}` })),
    ...memories.map((m) => ({ targetType: "MEMORY" as const, targetId: m.id, text: `${m.title}\n${m.fact}` })),
  ];
  let done = 0;
  for (let i = 0; i < items.length; i += BATCH) done += await store(e, organizationId, companyId, items.slice(i, i + BATCH));
  // Once the current model covers everything, vectors of a previously used model are dropped.
  if (items.length < limit) await db().brainEmbedding.deleteMany({ where: { organizationId, companyId, model: { not: e.modelKey } } });
  return done;
}

/** Remove vectors of deleted passages and memories (targets are polymorphic, so there is no FK cascade). */
export async function sweepOrphanEmbeddings(): Promise<number> {
  return db().$executeRaw`
    DELETE FROM brain_embeddings WHERE id IN (
      SELECT e.id FROM brain_embeddings e
       WHERE (e.target_type = 'CHUNK' AND NOT EXISTS (SELECT 1 FROM brain_chunks c WHERE c.id = e.target_id AND c.company_id = e.company_id))
          OR (e.target_type = 'MEMORY' AND NOT EXISTS (SELECT 1 FROM company_memories m WHERE m.id = e.target_id AND m.company_id = e.company_id))
       LIMIT 5000)`;
}

/** Periodic job: embed new passages and memories for every company with an embedding provider (no-op without pgvector). */
export async function reindexEmbeddings(): Promise<number> {
  const swept = await sweepOrphanEmbeddings().catch(() => 0);
  const cap = await vectorStoreAvailable();
  if (!cap.extension || !cap.column) return swept;
  // OpenAI / Gemini embeddings run on the platform's keys (platform-managed providers): when one is available, every
  // company with documents or memories is a candidate. Voyage AI stays a company-connected provider.
  const { availablePlatformProviders } = await import("@/server/modules/integrations/platform-managed");
  const platformReady = (await availablePlatformProviders(["openai", "gemini"])).length > 0;
  const companies = platformReady
    ? await db().$queryRaw<{ organizationId: string; companyId: string }[]>`
        SELECT organization_id AS "organizationId", company_id AS "companyId" FROM brain_documents WHERE status = 'READY'
        UNION
        SELECT organization_id AS "organizationId", company_id AS "companyId" FROM company_memories
        LIMIT 500`
    : await db().integrationConnection.findMany({
        where: { provider: { in: EMBEDDING_PROVIDERS.filter((p) => p === "voyage") }, status: { not: "DISCONNECTED" } },
        distinct: ["companyId"],
        select: { organizationId: true, companyId: true },
        take: 500,
      });
  let n = swept;
  for (const c of companies) {
    try {
      n += await embedCompany(c.organizationId, c.companyId);
    } catch (err) {
      log.warn({ companyId: c.companyId, err: err instanceof Error ? err.message : String(err) }, "company embedding pass failed");
    }
  }
  return n;
}

/** Delete the vectors of these targets (used by forget/delete so no vector outlives its text). */
export async function deleteEmbeddings(tx: Pick<Prisma.TransactionClient, "brainEmbedding"> | ReturnType<typeof db>, companyId: string, targetType: "CHUNK" | "MEMORY", ids: string[]) {
  if (!ids.length) return 0;
  const r = await tx.brainEmbedding.deleteMany({ where: { companyId, targetType, targetId: { in: ids } } });
  return r.count;
}
