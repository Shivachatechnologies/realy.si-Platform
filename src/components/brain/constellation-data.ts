import "server-only";
import { db } from "@/server/core/db";
import type { GraphLink, GraphNode } from "@/components/graphics/network-graph";

/**
 * The knowledge constellation from real Brain records: recent documents, the departments they belong to, their
 * knowledge links (graph entities, CRM accounts/contacts, projects) and shared tags. Caller authorizes brain.read.
 */
export async function knowledgeConstellation(organizationId: string, companyId: string, locale: string) {
  const scoped = { organizationId, companyId };
  const docs = await db().brainDocument.findMany({
    where: { ...scoped, status: "READY" },
    orderBy: { updatedAt: "desc" },
    take: 80,
    select: { id: true, title: true, departmentId: true, tags: true, sourceType: true, department: { select: { name: true } }, links: { select: { subjectType: true, subjectId: true } }, _count: { select: { chunks: true } } },
  });
  const ids = (type: string) => [...new Set(docs.flatMap((d) => d.links.filter((l) => l.subjectType === type).map((l) => l.subjectId)))];
  const [entities, accounts, contacts, projects] = await Promise.all([
    db().graphEntity.findMany({ where: { ...scoped, id: { in: ids("GRAPH_ENTITY") } }, select: { id: true, name: true } }),
    db().account.findMany({ where: { ...scoped, id: { in: ids("ACCOUNT") } }, select: { id: true, name: true } }),
    db().contact.findMany({ where: { ...scoped, id: { in: ids("CONTACT") } }, select: { id: true, firstName: true, lastName: true } }),
    db().project.findMany({ where: { ...scoped, id: { in: ids("PROJECT") } }, select: { id: true, name: true } }),
  ]);
  const names = new Map<string, { label: string; href: string }>([
    ...entities.map((e) => [`GRAPH_ENTITY:${e.id}`, { label: e.name, href: `/${locale}/graph/${e.id}` }] as const),
    ...accounts.map((a) => [`ACCOUNT:${a.id}`, { label: a.name, href: `/${locale}/crm/accounts/${a.id}` }] as const),
    ...contacts.map((c) => [`CONTACT:${c.id}`, { label: [c.firstName, c.lastName].filter(Boolean).join(" "), href: `/${locale}/crm/contacts/${c.id}` }] as const),
    ...projects.map((p) => [`PROJECT:${p.id}`, { label: p.name, href: `/${locale}/projects/${p.id}` }] as const),
  ]);
  const tagCount = new Map<string, number>();
  for (const d of docs) for (const tg of d.tags) tagCount.set(tg, (tagCount.get(tg) ?? 0) + 1);
  const sharedTags = new Set([...tagCount].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k]) => k));

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const seen = new Set<string>();
  const add = (n: GraphNode) => {
    if (!seen.has(n.id)) {
      seen.add(n.id);
      nodes.push(n);
    }
  };
  for (const d of docs) {
    const id = `doc:${d.id}`;
    add({ id, label: d.title, group: "document", weight: 0.8 + Math.min(1.6, d._count.chunks / 20), href: `/${locale}/brain/${d.id}`, meta: d.department?.name });
    if (d.departmentId && d.department) {
      add({ id: `dept:${d.departmentId}`, label: d.department.name, group: "department", weight: 2.2 });
      links.push({ source: `dept:${d.departmentId}`, target: id });
    }
    for (const l of d.links) {
      const key = `${l.subjectType}:${l.subjectId}`;
      const nm = names.get(key);
      if (!nm) continue;
      add({ id: `subj:${key}`, label: nm.label, group: "subject", weight: 1.5, href: nm.href });
      links.push({ source: id, target: `subj:${key}` });
    }
    for (const tg of d.tags) {
      if (!sharedTags.has(tg)) continue;
      add({ id: `tag:${tg}`, label: `#${tg}`, group: "tag", weight: 1.2, href: `/${locale}/documents?tag=${encodeURIComponent(tg)}` });
      links.push({ source: id, target: `tag:${tg}` });
    }
  }
  return { nodes, links, documents: docs.length };
}
