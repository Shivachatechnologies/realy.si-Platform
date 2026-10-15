import { z } from "zod";
import { db, Prisma, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { ENTITY_KINDS, RELATION_KEYS, relationAllowed } from "./relations";

/** Upper bound for one graph read; the UI and API return the whole company graph in one response. */
export const MAX_GRAPH_ENTITIES = 2000;

const name = z.string().trim().min(1).max(160);
const description = z.string().trim().max(2000);

export const createEntityInput = z.object({ kind: z.enum(ENTITY_KINDS), name, description: description.optional() });
export const updateEntityInput = z.object({ name: name.optional(), description: description.nullable().optional() });
export const createEdgeInput = z.object({ fromId: z.string().uuid(), relation: z.enum(RELATION_KEYS), toId: z.string().uuid() });

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "graph.read" | "graph.manage", tx?: Tx) {
  // A company of another organization (or one the actor cannot see) resolves to not_found.
  await requirePermission(ctx, permission, await companyChain(tx ?? db(), organizationId, companyId), tx);
}

async function findEntity(tx: Tx, organizationId: string, companyId: string, id: string) {
  const entity = await tx.graphEntity.findFirst({ where: { id, organizationId, companyId } });
  if (!entity) throw notFound("Entity");
  return entity;
}

/** The whole graph of one company: entities and the typed relations between them. */
export async function getGraph(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "graph.read");
  const [entities, edges] = await Promise.all([
    db().graphEntity.findMany({ where: { organizationId, companyId }, orderBy: [{ kind: "asc" }, { name: "asc" }], take: MAX_GRAPH_ENTITIES }),
    db().graphEdge.findMany({ where: { organizationId, companyId }, orderBy: { createdAt: "asc" } }),
  ]);
  return { entities, edges };
}

export async function createEntity(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof createEntityInput>) {
  const input = createEntityInput.parse(raw);
  try {
    return await transaction(async (tx) => {
      await authorize(ctx, organizationId, companyId, "graph.manage", tx);
      const entity = await tx.graphEntity.create({
        data: { organizationId, companyId, kind: input.kind, name: input.name, description: input.description || null, createdById: ctx.actor.id ?? organizationId },
      });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "graph.entity.created", resourceType: "graph_entity", resourceId: entity.id, newValue: entity });
      return entity;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(`A ${input.kind.toLowerCase()} named "${input.name}" already exists`);
    throw err;
  }
}

export async function updateEntity(ctx: RequestContext, organizationId: string, companyId: string, entityId: string, raw: z.input<typeof updateEntityInput>) {
  const input = updateEntityInput.parse(raw);
  try {
    return await transaction(async (tx) => {
      await authorize(ctx, organizationId, companyId, "graph.manage", tx);
      const before = await findEntity(tx, organizationId, companyId, entityId);
      const entity = await tx.graphEntity.update({
        where: { id: entityId },
        data: { name: input.name, description: input.description === undefined ? undefined : input.description || null },
      });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "graph.entity.updated", resourceType: "graph_entity", resourceId: entityId, oldValue: before, newValue: entity });
      return entity;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(`An entity of this kind named "${input.name}" already exists`);
    throw err;
  }
}

/** Deletes the entity and, by cascade, every relation that touches it. */
export async function deleteEntity(ctx: RequestContext, organizationId: string, companyId: string, entityId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "graph.manage", tx);
    const entity = await findEntity(tx, organizationId, companyId, entityId);
    const edges = await tx.graphEdge.count({ where: { OR: [{ fromId: entityId }, { toId: entityId }] } });
    await tx.graphEntity.delete({ where: { id: entityId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "graph.entity.deleted", resourceType: "graph_entity", resourceId: entityId, oldValue: { ...entity, removedEdges: edges } });
    return { ok: true };
  });
}

/** True if `target` is reachable from `start` by following REPORTS_TO edges. */
async function reportsUpTo(tx: Tx, start: string, target: string) {
  const rows = await tx.$queryRaw<unknown[]>`
    WITH RECURSIVE chain(id) AS (
      SELECT ${start}::uuid
      UNION
      SELECT e.to_id FROM graph_edges e JOIN chain c ON e.from_id = c.id WHERE e.relation = 'REPORTS_TO'
    )
    SELECT 1 FROM chain WHERE id = ${target}::uuid LIMIT 1`;
  return rows.length > 0;
}

export async function createEdge(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof createEdgeInput>) {
  const input = createEdgeInput.parse(raw);
  const { relation } = input;
  if (input.fromId === input.toId) throw invalid("An entity cannot relate to itself");
  try {
    return await transaction(async (tx) => {
      await authorize(ctx, organizationId, companyId, "graph.manage", tx);
      const [from, to] = await Promise.all([findEntity(tx, organizationId, companyId, input.fromId), findEntity(tx, organizationId, companyId, input.toId)]);
      if (!relationAllowed(relation, from.kind, to.kind)) {
        throw invalid(`${relation} cannot connect ${from.kind} to ${to.kind}`, { relation, fromKind: from.kind, toKind: to.kind });
      }
      if (relation === "REPORTS_TO") {
        // Serialize reporting-line changes per company so two concurrent edits cannot form a cycle.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`graph:reports_to:${companyId}`}))`;
        if (await tx.graphEdge.findFirst({ where: { fromId: from.id, relation: "REPORTS_TO" } })) throw conflict(`${from.name} already reports to someone`);
        if (await reportsUpTo(tx, to.id, from.id)) throw invalid("This reporting line would create a cycle");
      }
      const edge = await tx.graphEdge.create({ data: { organizationId, companyId, fromId: from.id, relation, toId: to.id, createdById: ctx.actor.id ?? organizationId } });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "graph.edge.created", resourceType: "graph_edge", resourceId: edge.id, newValue: edge });
      return edge;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("This relation already exists");
    throw err;
  }
}

export async function deleteEdge(ctx: RequestContext, organizationId: string, companyId: string, edgeId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "graph.manage", tx);
    const edge = await tx.graphEdge.findFirst({ where: { id: edgeId, organizationId, companyId } });
    if (!edge) throw notFound("Relation");
    await tx.graphEdge.delete({ where: { id: edgeId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "graph.edge.deleted", resourceType: "graph_edge", resourceId: edgeId, oldValue: edge });
    return { ok: true };
  });
}
