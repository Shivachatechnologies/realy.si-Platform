import { createHash } from "node:crypto";
import { db, Prisma, transaction } from "@/server/core/db";
import { systemContext } from "@/server/core/context";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { chunkText, extractText, ExtractionError } from "./extract";
import { normalizeTags, type BrainSourceType } from "./service";

/**
 * Module knowledge ingestion: published records of other modules are indexed as Company Brain documents
 * (sourceType + sourceId), re-indexed when the source's updatedAt moves, and removed when the source is
 * unpublished, archived or deleted. Sources are only read here — their modules are never written to.
 */

export interface SourceDoc {
  organizationId: string;
  companyId: string;
  sourceType: BrainSourceType;
  sourceId: string;
  sourceUpdatedAt: Date;
  title: string;
  text: string;
  tags: string[];
  createdById: string | null;
}

/** Where a source record lives in the app (relative to the locale). */
export function sourceHref(sourceType: string | null, sourceId: string | null): string | null {
  if (!sourceType || !sourceId) return null;
  switch (sourceType) {
    case "support_kb_article":
      return `/support/knowledge/${sourceId}`;
    case "hr_policy":
      return `/hr/policies/${sourceId}`;
    case "ops_process":
      return `/operations/processes/${sourceId}`;
    case "product_release":
      return `/product/releases`;
    case "product_feature":
      return `/product/features/${sourceId}`;
    case "product_doc":
      return `/product/docs/${sourceId}`;
    default:
      return null;
  }
}

/** Per run and source type: at most this many documents are (re)indexed; the rest follow on the next run. */
const BATCH = 200;
const SCAN = 5000;

interface Stamp {
  id: string;
  organizationId: string;
  companyId: string;
  updatedAt: Date;
}

interface SourceAdapter {
  type: BrainSourceType;
  /** Every record that should be in Company Brain (id + updatedAt only). */
  published(): Promise<Stamp[]>;
  /** Full documents for the given ids (same publish filter). */
  load(ids: string[]): Promise<SourceDoc[]>;
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const lines = (...parts: (string | null | undefined | false)[]) => parts.filter((p): p is string => Boolean(p && p.trim())).join("\n\n");

const kbWhere = { status: "PUBLISHED" } as const;
const hrWhere = { publishedAt: { not: null }, archivedAt: null } as const;
const opsWhere = { archivedAt: null } as const;
const releaseWhere = { OR: [{ status: "RELEASED" as const }, { publishedAt: { not: null } }] };
const featureWhere = { archivedAt: null, status: { in: ["PLANNED" as const, "IN_PROGRESS" as const, "SHIPPED" as const] } };
const stamp = { id: true, organizationId: true, companyId: true, updatedAt: true } as const;

const ADAPTERS: SourceAdapter[] = [
  {
    type: "support_kb_article",
    published: () => db().supportKbArticle.findMany({ where: kbWhere, select: stamp, orderBy: { id: "asc" }, take: SCAN }),
    async load(ids) {
      const rows = await db().supportKbArticle.findMany({ where: { id: { in: ids }, ...kbWhere }, include: { category: { select: { name: true } } } });
      return rows.map((a) => ({
        organizationId: a.organizationId,
        companyId: a.companyId,
        sourceType: "support_kb_article",
        sourceId: a.id,
        sourceUpdatedAt: a.updatedAt,
        title: a.title,
        text: lines(`# ${a.title}`, `Support knowledge base article${a.category ? ` · ${a.category.name}` : ""}${a.publishedAt ? ` · published ${day(a.publishedAt)}` : ""}`, a.body),
        tags: normalizeTags(["support", "knowledge-base", ...a.tags]),
        createdById: a.authorId,
      }));
    },
  },
  {
    type: "hr_policy",
    published: () => db().hrPolicy.findMany({ where: hrWhere, select: stamp, orderBy: { id: "asc" }, take: SCAN }),
    async load(ids) {
      const rows = await db().hrPolicy.findMany({ where: { id: { in: ids }, ...hrWhere } });
      return rows.map((p) => ({
        organizationId: p.organizationId,
        companyId: p.companyId,
        sourceType: "hr_policy",
        sourceId: p.id,
        sourceUpdatedAt: p.updatedAt,
        title: p.title,
        text: lines(`# ${p.title}`, `HR policy · ${p.category} · version ${p.version}${p.publishedAt ? ` · published ${day(p.publishedAt)}` : ""}`, p.body),
        tags: normalizeTags(["hr", "policy", p.category]),
        createdById: p.createdById,
      }));
    },
  },
  {
    type: "ops_process",
    published: () => db().opsProcess.findMany({ where: opsWhere, select: stamp, orderBy: { id: "asc" }, take: SCAN }),
    async load(ids) {
      const rows = await db().opsProcess.findMany({ where: { id: { in: ids }, ...opsWhere }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
      return rows.flatMap((p) => {
        const v = p.versions.find((x) => x.version === p.currentVersion) ?? p.versions[0];
        const steps = Array.isArray(v?.steps) ? (v.steps as { title?: unknown; detail?: unknown }[]) : [];
        const stepText = steps
          .map((s, i) => `${i + 1}. ${typeof s?.title === "string" ? s.title : ""}${typeof s?.detail === "string" && s.detail.trim() ? `\n   ${s.detail.trim()}` : ""}`)
          .join("\n");
        return [
          {
            organizationId: p.organizationId,
            companyId: p.companyId,
            sourceType: "ops_process" as const,
            sourceId: p.id,
            sourceUpdatedAt: p.updatedAt,
            title: p.title,
            text: lines(`# ${p.title}`, `Standard operating procedure${p.category ? ` · ${p.category}` : ""} · version ${v?.version ?? p.currentVersion}`, p.description, stepText ? `## Steps\n${stepText}` : null),
            tags: normalizeTags(["operations", "sop", ...(p.category ? [p.category] : [])]),
            createdById: p.createdById,
          },
        ];
      });
    },
  },
  {
    type: "product_release",
    published: () => db().productRelease.findMany({ where: releaseWhere, select: stamp, orderBy: { id: "asc" }, take: SCAN }),
    async load(ids) {
      const rows = await db().productRelease.findMany({
        where: { id: { in: ids }, ...releaseWhere },
        include: { features: { where: { archivedAt: null }, select: { title: true, spec: true }, orderBy: { title: "asc" }, take: 100 } },
      });
      return rows.map((r) => {
        const title = r.name ? `${r.name} (${r.version})` : `Release ${r.version}`;
        const features = r.features.map((f) => `- ${f.title}${f.spec ? `: ${f.spec.split("\n", 1)[0]!.slice(0, 300)}` : ""}`).join("\n");
        return {
          organizationId: r.organizationId,
          companyId: r.companyId,
          sourceType: "product_release" as const,
          sourceId: r.id,
          sourceUpdatedAt: r.updatedAt,
          title,
          text: lines(`# ${title}`, `Product release · version ${r.version} · ${r.status}${r.releaseDate ? ` · ${day(r.releaseDate)}` : ""}`, r.notes, features ? `## Features\n${features}` : null),
          tags: normalizeTags(["product", "release"]),
          createdById: null,
        };
      });
    },
  },
  {
    type: "product_feature",
    published: () => db().productFeature.findMany({ where: featureWhere, select: stamp, orderBy: { id: "asc" }, take: SCAN }),
    async load(ids) {
      const rows = await db().productFeature.findMany({
        where: { id: { in: ids }, ...featureWhere },
        include: { initiative: { select: { title: true } }, release: { select: { version: true } } },
      });
      return rows.map((f) => ({
        organizationId: f.organizationId,
        companyId: f.companyId,
        sourceType: "product_feature" as const,
        sourceId: f.id,
        sourceUpdatedAt: f.updatedAt,
        title: f.title,
        text: lines(
          `# ${f.title}`,
          [`Product feature · ${f.status}`, f.quarter ? `quarter ${f.quarter}` : null, f.initiative ? `initiative ${f.initiative.title}` : null, f.release ? `release ${f.release.version}` : null].filter(Boolean).join(" · "),
          f.spec,
        ),
        tags: normalizeTags(["product", "feature"]),
        createdById: f.createdById,
      }));
    },
  },
];

const log = logger.child({ component: "brain-sources" });

/** Create or refresh one source document in place (links to it survive re-indexing). Returns false when skipped. */
async function upsertSourceDocument(doc: SourceDoc, existingId: string | null): Promise<boolean> {
  let text: string;
  try {
    text = extractText(doc.text);
  } catch (err) {
    if (err instanceof ExtractionError) {
      log.warn({ sourceType: doc.sourceType, sourceId: doc.sourceId, reason: err.reason }, "source not indexable");
      if (existingId) await removeSourceDocument(existingId, doc.organizationId, "unindexable");
      return false;
    }
    throw err;
  }
  const sha = createHash("sha256").update(text).digest("hex");
  const chunks = chunkText(text);
  const ctx = systemContext(`brain_index_${doc.sourceId}`);
  try {
    await transaction(async (tx) => {
      const data = {
        title: doc.title.slice(0, 200) || "Untitled",
        mimeType: "text/markdown",
        sizeBytes: Buffer.byteLength(text, "utf8"),
        contentSha256: sha,
        status: "READY" as const,
        tags: doc.tags,
        sourceUpdatedAt: doc.sourceUpdatedAt,
      };
      let id = existingId;
      if (id) {
        // Tags added by people are kept next to the source's own tags; department stays as people set it.
        const current = await tx.brainDocument.findUniqueOrThrow({ where: { id }, select: { tags: true } });
        await tx.brainChunk.deleteMany({ where: { documentId: id, companyId: doc.companyId } });
        await tx.brainDocument.update({ where: { id }, data: { ...data, tags: normalizeTags([...doc.tags, ...current.tags]) } });
      } else {
        const created = await tx.brainDocument.create({
          data: {
            ...data,
            organizationId: doc.organizationId,
            companyId: doc.companyId,
            sourceType: doc.sourceType,
            sourceId: doc.sourceId,
            createdById: doc.createdById ?? doc.organizationId,
          },
        });
        id = created.id;
      }
      await tx.brainChunk.createMany({ data: chunks.map((c) => ({ organizationId: doc.organizationId, companyId: doc.companyId, documentId: id!, ...c })) });
      await writeAudit(tx, ctx, {
        category: "TENANT",
        organizationId: doc.organizationId,
        action: existingId ? "brain.document.reindexed" : "brain.document.indexed",
        resourceType: "brain_document",
        resourceId: id!,
        newValue: { companyId: doc.companyId, sourceType: doc.sourceType, sourceId: doc.sourceId, title: data.title, passages: chunks.length },
      });
    });
    return true;
  } catch (err) {
    // Same content already in this company's Brain (e.g. uploaded by hand): keep the existing document.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      log.info({ sourceType: doc.sourceType, sourceId: doc.sourceId }, "source content already indexed; skipped");
      return false;
    }
    throw err;
  }
}

async function removeSourceDocument(documentId: string, organizationId: string, reason: string) {
  await transaction(async (tx) => {
    const doc = await tx.brainDocument.findFirst({ where: { id: documentId, organizationId }, select: { id: true, companyId: true, title: true, sourceType: true, sourceId: true } });
    if (!doc) return;
    await tx.brainDocument.delete({ where: { id: documentId } });
    await writeAudit(tx, systemContext(`brain_unindex_${documentId}`), {
      category: "TENANT",
      organizationId,
      action: "brain.document.unindexed",
      resourceType: "brain_document",
      resourceId: documentId,
      oldValue: { ...doc, reason },
    });
  });
}

/** One pass over every source type. Idempotent; returns the number of documents indexed or removed. */
export async function indexModuleSources(): Promise<number> {
  let changed = 0;
  for (const adapter of ADAPTERS) {
    try {
      const [published, docs] = await Promise.all([
        adapter.published(),
        db().brainDocument.findMany({ where: { sourceType: adapter.type }, select: { id: true, organizationId: true, companyId: true, sourceId: true, sourceUpdatedAt: true } }),
      ]);
      const live = new Map(published.map((p) => [`${p.companyId}:${p.id}`, p]));
      const indexed = new Map(docs.map((d) => [`${d.companyId}:${d.sourceId}`, d]));
      // Unpublished, archived or deleted sources leave Company Brain (only when the scan saw every published row).
      if (published.length < SCAN) {
        for (const [key, d] of indexed) {
          if (!live.has(key)) {
            await removeSourceDocument(d.id, d.organizationId, "source_unpublished");
            changed++;
          }
        }
      }
      const stale = published.filter((p) => {
        const d = indexed.get(`${p.companyId}:${p.id}`);
        return !d || !d.sourceUpdatedAt || d.sourceUpdatedAt.getTime() < p.updatedAt.getTime();
      });
      for (let i = 0; i < Math.min(stale.length, BATCH); i += 50) {
        const ids = stale.slice(i, Math.min(i + 50, BATCH)).map((p) => p.id);
        for (const doc of await adapter.load(ids)) {
          const existing = indexed.get(`${doc.companyId}:${doc.sourceId}`);
          try {
            if (await upsertSourceDocument(doc, existing?.id ?? null)) changed++;
          } catch (err) {
            log.error({ sourceType: doc.sourceType, sourceId: doc.sourceId, err: err instanceof Error ? err.message : String(err) }, "source document indexing failed");
          }
        }
      }
    } catch (err) {
      log.error({ sourceType: adapter.type, err: err instanceof Error ? err.message : String(err) }, "source indexing failed");
    }
  }
  return changed;
}
