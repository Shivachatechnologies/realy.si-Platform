import "server-only";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";
import { keywords, searchMemories } from "./memory";
import { searchDocuments } from "./service";
import { sourceHref } from "./sources";

/**
 * Company knowledge retrieval: one query across the Brain's document passages, the company memory, the company graph
 * (entities with their typed relations) and core business records (customers, deals, leads, projects). Every hit is a
 * stored row with its in-app link — nothing is generated. Each source is included only when the viewer may read it.
 */

export type KnowledgeRecordType = "account" | "deal" | "lead" | "project";

export interface KnowledgePassage {
  documentId: string;
  title: string;
  passage: number;
  snippet: { text: string; match: boolean }[];
  href: string;
  sourceHref: string | null;
}
export interface KnowledgeMemory {
  id: string;
  title: string;
  fact: string;
  source: string | null;
  pinned: boolean;
}
export interface KnowledgeEntity {
  id: string;
  kind: string;
  name: string;
  description: string | null;
  href: string;
  relations: { relation: string; direction: "out" | "in"; id: string; name: string; kind: string }[];
}
export interface KnowledgeRecord {
  type: KnowledgeRecordType;
  id: string;
  label: string;
  status: string | null;
  href: string;
}
export interface KnowledgeResults {
  query: string;
  passages: KnowledgePassage[] | null;
  memories: KnowledgeMemory[] | null;
  entities: KnowledgeEntity[] | null;
  records: KnowledgeRecord[];
}

const RECORD_PERMISSION: Record<KnowledgeRecordType, string> = { account: "sales.read", deal: "sales.read", lead: "sales.read", project: "projects.read" };

async function allowed(ctx: RequestContext, permission: string, chain: ScopeChain) {
  try {
    return await can(ctx, permission, chain);
  } catch {
    return false;
  }
}

/** Search everything the company knows for `query` (at most `limit` hits per source). */
export async function searchKnowledge(ctx: RequestContext, organizationId: string, companyId: string, query: string, limit = 8): Promise<KnowledgeResults> {
  const q = query.trim().slice(0, 200);
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, "companies.read", chain);
  const words = keywords(q).slice(0, 8);
  const empty: KnowledgeResults = { query: q, passages: null, memories: null, entities: null, records: [] };
  if (!q) return empty;
  const [brain, graph, sales, projects] = await Promise.all([
    allowed(ctx, "brain.read", chain),
    allowed(ctx, "graph.read", chain),
    allowed(ctx, RECORD_PERMISSION.account, chain),
    allowed(ctx, RECORD_PERMISSION.project, chain),
  ]);
  const scope = { organizationId, companyId };
  const nameMatch = words.length ? { OR: words.map((w) => ({ name: { contains: w, mode: "insensitive" as const } })) } : { name: { contains: q, mode: "insensitive" as const } };

  const [passages, memories, entities, accounts, deals, leads, projectRows] = await Promise.all([
    brain
      ? searchDocuments(ctx, organizationId, companyId, { q: words.length > 1 ? words.join(" OR ") : q, limit: Math.min(limit, 25) }).then((r) =>
          r.results.map((p) => ({ documentId: p.citation.documentId, title: p.citation.title, passage: p.citation.passage, snippet: p.snippet, href: `/brain/${p.citation.documentId}`, sourceHref: null as string | null })),
        )
      : Promise.resolve(null),
    brain ? searchMemories(ctx, organizationId, companyId, q, Math.min(limit, 10)).then((m) => m.map((x) => ({ id: x.id, title: x.title, fact: x.fact, source: x.source, pinned: x.pinned }))) : Promise.resolve(null),
    graph
      ? db().graphEntity.findMany({
          where: { ...scope, ...(words.length ? { OR: [...words.map((w) => ({ name: { contains: w, mode: "insensitive" as const } })), ...words.map((w) => ({ description: { contains: w, mode: "insensitive" as const } }))] } : nameMatch) },
          orderBy: { name: "asc" },
          take: limit,
          select: {
            id: true,
            kind: true,
            name: true,
            description: true,
            outgoing: { take: 12, select: { relation: true, to: { select: { id: true, name: true, kind: true } } } },
            incoming: { take: 12, select: { relation: true, from: { select: { id: true, name: true, kind: true } } } },
          },
        })
      : Promise.resolve(null),
    sales ? db().account.findMany({ where: { ...scope, archivedAt: null, ...nameMatch }, take: limit, select: { id: true, name: true, type: true } }) : Promise.resolve([]),
    sales ? db().crmDeal.findMany({ where: { ...scope, archivedAt: null, ...nameMatch }, take: limit, select: { id: true, name: true, status: true } }) : Promise.resolve([]),
    sales ? db().lead.findMany({ where: { ...scope, archivedAt: null, ...nameMatch }, take: limit, select: { id: true, name: true, stage: true } }) : Promise.resolve([]),
    projects ? db().project.findMany({ where: { ...scope, archivedAt: null, ...nameMatch }, take: limit, select: { id: true, name: true, status: true } }) : Promise.resolve([]),
  ]);

  // Link indexed module documents (KB articles, policies, SOPs…) back to their source record.
  if (passages?.length) {
    const docs = await db().brainDocument.findMany({ where: { ...scope, id: { in: [...new Set(passages.map((p) => p.documentId))] } }, select: { id: true, sourceType: true, sourceId: true } });
    const src = new Map(docs.map((d) => [d.id, sourceHref(d.sourceType, d.sourceId)]));
    for (const p of passages) p.sourceHref = src.get(p.documentId) ?? null;
  }

  return {
    query: q,
    passages,
    memories,
    entities:
      entities?.map((e) => ({
        id: e.id,
        kind: e.kind,
        name: e.name,
        description: e.description,
        href: `/graph/${e.id}`,
        relations: [
          ...e.outgoing.map((r) => ({ relation: r.relation, direction: "out" as const, id: r.to.id, name: r.to.name, kind: r.to.kind })),
          ...e.incoming.map((r) => ({ relation: r.relation, direction: "in" as const, id: r.from.id, name: r.from.name, kind: r.from.kind })),
        ],
      })) ?? null,
    records: [
      ...accounts.map((a) => ({ type: "account" as const, id: a.id, label: a.name, status: a.type as string, href: `/crm/accounts/${a.id}` })),
      ...deals.map((d) => ({ type: "deal" as const, id: d.id, label: d.name, status: d.status as string, href: `/crm/deals/${d.id}` })),
      ...leads.map((l) => ({ type: "lead" as const, id: l.id, label: l.name, status: l.stage as string, href: `/crm/${l.id}` })),
      ...projectRows.map((p) => ({ type: "project" as const, id: p.id, label: p.name, status: p.status as string, href: `/projects/${p.id}` })),
    ],
  };
}

/** A compact, citable text block of knowledge hits for an AI prompt (references K1…Kn), plus the source list. */
export function knowledgeContext(r: KnowledgeResults, max = 6) {
  const sources: { ref: string; type: string; id: string; title: string; href: string; passage?: number }[] = [];
  const lines: string[] = [];
  for (const p of (r.passages ?? []).slice(0, max)) {
    const ref = `K${sources.length + 1}`;
    sources.push({ ref, type: "document", id: p.documentId, title: p.title, href: p.href, passage: p.passage });
    lines.push(`[${ref}] Document "${p.title}", passage ${p.passage}: ${p.snippet.map((s) => s.text).join("").replace(/\s+/g, " ").slice(0, 400)}`);
  }
  for (const e of (r.entities ?? []).slice(0, 4)) {
    const ref = `K${sources.length + 1}`;
    sources.push({ ref, type: "entity", id: e.id, title: e.name, href: e.href });
    const rel = e.relations.slice(0, 6).map((x) => (x.direction === "out" ? `${x.relation} ${x.name}` : `${x.name} ${x.relation} it`)).join("; ");
    lines.push(`[${ref}] ${e.kind.toLowerCase()} "${e.name}"${e.description ? `: ${e.description.slice(0, 200)}` : ""}${rel ? ` (relations: ${rel})` : ""}`);
  }
  for (const rec of r.records.slice(0, 6)) {
    const ref = `K${sources.length + 1}`;
    sources.push({ ref, type: rec.type, id: rec.id, title: rec.label, href: rec.href });
    lines.push(`[${ref}] ${rec.type} "${rec.label}"${rec.status ? ` (${rec.status.toLowerCase()})` : ""} — ${rec.href}`);
  }
  return { text: lines.join("\n"), sources };
}
