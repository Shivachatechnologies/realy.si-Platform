import { z } from "zod";
import { db, Prisma, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import type { BrainLinkSubject } from "@/generated/prisma/enums";
import { writeAudit } from "@/server/modules/audit/service";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { searchDocuments } from "./service";

/**
 * Knowledge relationships: documents ↔ Company Graph entities, CRM accounts/contacts and projects. Subjects are
 * looked up inside the document's company before a link is made, so a link never points across companies.
 */

/** Subject types as used in URLs, props and the API. */
export const LINK_SUBJECTS = ["graph_entity", "account", "contact", "project"] as const;
export type LinkSubjectType = (typeof LINK_SUBJECTS)[number];

const TO_ENUM = { graph_entity: "GRAPH_ENTITY", account: "ACCOUNT", contact: "CONTACT", project: "PROJECT" } as const satisfies Record<LinkSubjectType, BrainLinkSubject>;
const FROM_ENUM = Object.fromEntries(Object.entries(TO_ENUM).map(([k, v]) => [v, k])) as Record<BrainLinkSubject, LinkSubjectType>;
/** Reading a subject's label needs the subject area's read permission. */
const SUBJECT_PERMISSION = { graph_entity: "graph.read", account: "sales.read", contact: "sales.read", project: "projects.read" } as const satisfies Record<LinkSubjectType, string>;

export const linkInput = z.object({ subjectType: z.enum(LINK_SUBJECTS), subjectId: z.string().uuid() });
export const targetQuery = z.object({ type: z.enum(LINK_SUBJECTS), q: z.string().trim().max(100).default("") });

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

/** Where a subject lives in the app (relative to the locale). */
export function subjectHref(type: LinkSubjectType, id: string) {
  return { graph_entity: `/graph/${id}`, account: `/crm/accounts/${id}`, contact: `/crm/contacts/${id}`, project: `/projects/${id}` }[type];
}

const contactLabel = (c: { firstName: string; lastName: string | null; email: string | null }) => [c.firstName, c.lastName].filter(Boolean).join(" ") + (c.email ? ` · ${c.email}` : "");

/** Labels of subjects inside one company (unknown ids are left out). */
async function labels(client: Tx | ReturnType<typeof db>, organizationId: string, companyId: string, type: LinkSubjectType, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const where = { id: { in: ids }, organizationId, companyId };
  switch (type) {
    case "graph_entity":
      return new Map((await client.graphEntity.findMany({ where, select: { id: true, name: true, kind: true } })).map((e) => [e.id, e.name]));
    case "account":
      return new Map((await client.account.findMany({ where, select: { id: true, name: true } })).map((a) => [a.id, a.name]));
    case "contact":
      return new Map((await client.contact.findMany({ where, select: { id: true, firstName: true, lastName: true, email: true } })).map((c) => [c.id, contactLabel(c)]));
    case "project":
      return new Map((await client.project.findMany({ where, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  }
}

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "brain.read" | "brain.manage", tx?: Tx) {
  const chain = await companyChain(tx ?? db(), organizationId, companyId);
  await requirePermission(ctx, permission, chain, tx);
  return chain;
}

/** The links of one document, with labels the viewer may see (others are shown as restricted). */
export async function listDocumentLinks(ctx: RequestContext, organizationId: string, companyId: string, documentId: string) {
  const chain = await authorize(ctx, organizationId, companyId, "brain.read");
  if (!isUuid(documentId)) throw notFound("Document");
  const rows = await db().brainLink.findMany({ where: { organizationId, companyId, documentId }, orderBy: { createdAt: "asc" } });
  const out: { id: string; subjectType: LinkSubjectType; subjectId: string; label: string | null; href: string; createdAt: Date }[] = [];
  for (const type of LINK_SUBJECTS) {
    const ofType = rows.filter((r) => FROM_ENUM[r.subjectType] === type);
    if (!ofType.length) continue;
    const visible = await can(ctx, SUBJECT_PERMISSION[type], chain);
    const names = visible ? await labels(db(), organizationId, companyId, type, ofType.map((r) => r.subjectId)) : new Map<string, string>();
    for (const r of ofType) out.push({ id: r.id, subjectType: type, subjectId: r.subjectId, label: names.get(r.subjectId) ?? null, href: subjectHref(type, r.subjectId), createdAt: r.createdAt });
  }
  return out;
}

export async function linkDocument(ctx: RequestContext, organizationId: string, companyId: string, documentId: string, raw: z.input<typeof linkInput>) {
  const input = linkInput.parse(raw);
  try {
    return await transaction(async (tx) => {
      const chain = await authorize(ctx, organizationId, companyId, "brain.manage", tx);
      await requirePermission(ctx, SUBJECT_PERMISSION[input.subjectType], chain, tx);
      if (!isUuid(documentId) || !(await tx.brainDocument.findFirst({ where: { id: documentId, organizationId, companyId }, select: { id: true } }))) throw notFound("Document");
      const label = (await labels(tx, organizationId, companyId, input.subjectType, [input.subjectId])).get(input.subjectId);
      if (label === undefined) throw notFound("Linked record");
      const link = await tx.brainLink.create({
        data: { organizationId, companyId, documentId, subjectType: TO_ENUM[input.subjectType], subjectId: input.subjectId, createdById: ctx.actor.id ?? organizationId },
      });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "brain.link.created", resourceType: "brain_link", resourceId: link.id, newValue: { ...link, label } });
      return { id: link.id, subjectType: input.subjectType, subjectId: link.subjectId, label, href: subjectHref(input.subjectType, link.subjectId) };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw conflict("This document is already linked to that record", { reason: "brain_link_exists" });
    throw err;
  }
}

export async function unlinkDocument(ctx: RequestContext, organizationId: string, companyId: string, linkId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "brain.manage", tx);
    if (!isUuid(linkId)) throw notFound("Link");
    const link = await tx.brainLink.findFirst({ where: { id: linkId, organizationId, companyId } });
    if (!link) throw notFound("Link");
    await tx.brainLink.delete({ where: { id: linkId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "brain.link.deleted", resourceType: "brain_link", resourceId: linkId, oldValue: link });
    return { ok: true };
  });
}

/** Records a document can be linked to, matching `q` (for the link picker). Needs the subject area's read permission. */
export async function searchLinkTargets(ctx: RequestContext, organizationId: string, companyId: string, raw: Record<string, unknown>) {
  const { type, q } = targetQuery.parse(raw);
  const chain = await authorize(ctx, organizationId, companyId, "brain.manage");
  await requirePermission(ctx, SUBJECT_PERMISSION[type], chain);
  const base = { organizationId, companyId };
  const has = (field: string) => (q ? { [field]: { contains: q, mode: "insensitive" as const } } : {});
  const take = 20;
  switch (type) {
    case "graph_entity":
      return (await db().graphEntity.findMany({ where: { ...base, ...has("name") }, orderBy: { name: "asc" }, take, select: { id: true, name: true, kind: true } })).map((e) => ({ id: e.id, label: e.name, detail: e.kind }));
    case "account":
      return (await db().account.findMany({ where: { ...base, archivedAt: null, ...has("name") }, orderBy: { name: "asc" }, take, select: { id: true, name: true, domain: true } })).map((a) => ({ id: a.id, label: a.name, detail: a.domain }));
    case "contact":
      return (
        await db().contact.findMany({
          where: { ...base, archivedAt: null, ...(q ? { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}) },
          orderBy: { firstName: "asc" },
          take,
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      ).map((c) => ({ id: c.id, label: [c.firstName, c.lastName].filter(Boolean).join(" "), detail: c.email }));
    case "project":
      return (await db().project.findMany({ where: { ...base, archivedAt: null, ...has("name") }, orderBy: { name: "asc" }, take, select: { id: true, name: true, status: true } })).map((p) => ({ id: p.id, label: p.name, detail: p.status }));
  }
}

/**
 * Related knowledge of a record: documents explicitly linked to it, plus passages that mention its name
 * (full-text search, same company). Requires brain.read; the subject must exist in the company.
 */
export async function relatedKnowledge(ctx: RequestContext, organizationId: string, companyId: string, subjectType: LinkSubjectType, subjectId: string) {
  await authorize(ctx, organizationId, companyId, "brain.read");
  if (!isUuid(subjectId)) throw notFound("Record");
  const label = (await labels(db(), organizationId, companyId, subjectType, [subjectId])).get(subjectId);
  if (label === undefined) throw notFound("Record");
  const links = await db().brainLink.findMany({
    where: { organizationId, companyId, subjectType: TO_ENUM[subjectType], subjectId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, document: { select: { id: true, title: true, tags: true, sourceType: true, department: { select: { name: true } }, updatedAt: true } } },
  });
  // The name as a quoted phrase (contacts: the person's name without the email).
  const name = subjectType === "contact" ? label.split(" · ", 1)[0]! : label;
  const phrase = name.replace(/["\\]/g, " ").trim();
  const linkedIds = new Set(links.map((l) => l.document.id));
  const mentions = phrase.length >= 3 ? (await searchDocuments(ctx, organizationId, companyId, { q: `"${phrase}"`, limit: 8 })).results.filter((r) => !linkedIds.has(r.citation.documentId)).slice(0, 5) : [];
  return {
    label,
    linked: links.map((l) => ({ linkId: l.id, ...l.document, department: l.document.department?.name ?? null })),
    mentions,
  };
}
