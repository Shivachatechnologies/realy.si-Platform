import { createHash } from "node:crypto";
import { z } from "zod";
import { db, Prisma, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { pageInput, prismaPage, toPage, type PageInput } from "@/server/core/pagination";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { chunkText, extractText, ExtractionError, MAX_DOCUMENT_BYTES, mimeTypeFor } from "./extract";

export const ingestDocumentInput = z.object({
  title: z.string().trim().max(200).optional(),
  // Display only: the server derives the type from it and never uses it as a path.
  filename: z.string().trim().min(1).max(255).optional(),
  content: z.string().max(MAX_DOCUMENT_BYTES),
});

export const searchInput = z.object({
  q: z.string().trim().max(200).default(""),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

/** Metadata returned for documents everywhere (never file paths; text only via passages). */
const documentFields = {
  id: true,
  companyId: true,
  title: true,
  filename: true,
  mimeType: true,
  sizeBytes: true,
  contentSha256: true,
  status: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { chunks: true } },
} satisfies Prisma.BrainDocumentSelect;

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "brain.read" | "brain.manage", tx?: Tx) {
  // Unknown, foreign or invisible companies resolve to not_found.
  await requirePermission(ctx, permission, await companyChain(tx ?? db(), organizationId, companyId), tx);
}

function titleFrom(input: z.infer<typeof ingestDocumentInput>, text: string) {
  if (input.title) return input.title;
  if (input.filename) return input.filename.replace(/\.[^.]+$/, "").slice(0, 200) || input.filename.slice(0, 200);
  return text.split("\n", 1)[0]!.replace(/^#+\s*/, "").trim().slice(0, 200) || "Untitled";
}

/**
 * Extract, chunk and index a document in one transaction: the document is READY exactly when its passages
 * are committed, so a failure leaves nothing behind. Identical content is stored once per company.
 */
export async function ingestDocument(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof ingestDocumentInput>) {
  const input = ingestDocumentInput.parse(raw);
  let mimeType, text;
  try {
    mimeType = mimeTypeFor(input.filename);
    text = extractText(input.content);
  } catch (err) {
    if (err instanceof ExtractionError) throw invalid(err.message, { reason: err.reason });
    throw err;
  }
  const sha = createHash("sha256").update(text).digest("hex");
  const chunks = chunkText(text);
  try {
    return await transaction(async (tx) => {
      await authorize(ctx, organizationId, companyId, "brain.manage", tx);
      const doc = await tx.brainDocument.create({
        data: {
          organizationId,
          companyId,
          title: titleFrom(input, text),
          filename: input.filename ?? null,
          mimeType,
          sizeBytes: Buffer.byteLength(text, "utf8"),
          contentSha256: sha,
          status: "READY",
          createdById: ctx.actor.id ?? organizationId,
        },
      });
      await tx.brainChunk.createMany({ data: chunks.map((c) => ({ organizationId, companyId, documentId: doc.id, ...c })) });
      const { _count, ...meta } = await tx.brainDocument.findUniqueOrThrow({ where: { id: doc.id }, select: documentFields });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "brain.document.created", resourceType: "brain_document", resourceId: doc.id, newValue: meta });
      return { ...meta, passages: _count.chunks };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await db().brainDocument.findUnique({ where: { companyId_contentSha256: { companyId, contentSha256: sha } }, select: { id: true, title: true } });
      throw conflict(`This content is already in Company Brain${existing ? ` as "${existing.title}"` : ""}`, { reason: "brain_duplicate", ...(existing ? { documentId: existing.id } : {}) });
    }
    throw err;
  }
}

export async function listDocuments(ctx: RequestContext, organizationId: string, companyId: string, rawPage: Partial<PageInput> = {}) {
  const page = pageInput.parse(rawPage);
  await authorize(ctx, organizationId, companyId, "brain.read");
  const rows = await db().brainDocument.findMany({ where: { organizationId, companyId }, orderBy: { id: "desc" }, select: documentFields, ...prismaPage(page) });
  return toPage(rows.map(({ _count, ...d }) => ({ ...d, passages: _count.chunks })), page);
}

/** A document with its passages, in order. Passage n (1-based) is the citation anchor. */
export async function getDocument(ctx: RequestContext, organizationId: string, companyId: string, documentId: string) {
  await authorize(ctx, organizationId, companyId, "brain.read");
  if (!isUuid(documentId)) throw notFound("Document");
  const doc = await db().brainDocument.findFirst({
    where: { id: documentId, organizationId, companyId },
    select: { ...documentFields, _count: false, chunks: { orderBy: { ordinal: "asc" }, select: { id: true, ordinal: true, startOffset: true, text: true } } },
  });
  if (!doc) throw notFound("Document");
  const { chunks, ...meta } = doc;
  return { ...meta, passages: chunks.map((c) => ({ id: c.id, number: c.ordinal + 1, startOffset: c.startOffset, text: c.text })) };
}

export async function deleteDocument(ctx: RequestContext, organizationId: string, companyId: string, documentId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "brain.manage", tx);
    if (!isUuid(documentId)) throw notFound("Document");
    const doc = await tx.brainDocument.findFirst({ where: { id: documentId, organizationId, companyId }, select: documentFields });
    if (!doc) throw notFound("Document");
    await tx.brainDocument.delete({ where: { id: documentId } });
    const { _count, ...meta } = doc;
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "brain.document.deleted", resourceType: "brain_document", resourceId: documentId, oldValue: { ...meta, passages: _count.chunks } });
    return { ok: true };
  });
}

// ts_headline markers: control characters never present in stored text (extractText refuses them).
const MARK_START = "\u0002";
const MARK_END = "\u0003";
const HEADLINE_OPTIONS = `StartSel=${MARK_START}, StopSel=${MARK_END}, MaxWords=45, MinWords=20, MaxFragments=2, FragmentDelimiter=" … "`;

export interface SnippetSegment {
  text: string;
  match: boolean;
}

function segments(headline: string): SnippetSegment[] {
  const out: SnippetSegment[] = [];
  for (const part of headline.split(MARK_START)) {
    const [hit, rest] = part.includes(MARK_END) ? part.split(MARK_END, 2) : [null, part];
    if (hit) out.push({ text: hit, match: true });
    if (rest) out.push({ text: rest, match: false });
  }
  return out;
}

/**
 * Full-text search over one company's passages (PostgreSQL `websearch_to_tsquery`: words, "phrases", -exclusions,
 * OR). Every result is a stored passage with its source document — citations are never generated.
 */
export async function searchDocuments(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof searchInput>) {
  const { q, limit } = searchInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "brain.read");
  if (!q) return { query: q, results: [] };
  // All values are bound parameters; the GIN index is on to_tsvector('english', text).
  const rows = await db().$queryRaw<
    { chunk_id: string; document_id: string; ordinal: number; title: string; filename: string | null; mime_type: string; rank: number; headline: string }[]
  >`
    SELECT c.id AS chunk_id, c.document_id, c.ordinal, d.title, d.filename, d.mime_type,
           ts_rank(to_tsvector('english', c.text), query) AS rank,
           ts_headline('english', c.text, query, ${HEADLINE_OPTIONS}) AS headline
      FROM brain_chunks c
      JOIN brain_documents d ON d.id = c.document_id AND d.company_id = c.company_id,
           websearch_to_tsquery('english', ${q}) AS query
     WHERE c.company_id = ${companyId}::uuid
       AND d.organization_id = ${organizationId}::uuid
       AND d.status = 'READY'
       AND to_tsvector('english', c.text) @@ query
     ORDER BY rank DESC, c.document_id DESC, c.ordinal ASC
     LIMIT ${limit}`;
  return {
    query: q,
    results: rows.map((r) => ({
      passageId: r.chunk_id,
      snippet: segments(r.headline),
      score: Number(r.rank),
      citation: { documentId: r.document_id, title: r.title, filename: r.filename, mimeType: r.mime_type, passage: r.ordinal + 1 },
    })),
  };
}
