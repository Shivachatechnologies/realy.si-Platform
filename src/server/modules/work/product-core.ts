import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { ProductLifecycleStatus, ProductStage } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, forbidden, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { createEntity } from "@/server/modules/graph/service";
import { createWorkProject } from "./projects";
import { PRODUCT_STAGES } from "./product-constants";
import { actorId, authorize, blank, isUuid, oneOf, optText, optUuid, PAGE_SIZE, pageParam, param, requireEligible, userNames } from "./shared";

export { PRODUCT_STAGES };
export const PRODUCT_STATUSES = ["ACTIVE", "ON_HOLD", "SUNSET"] as const satisfies readonly ProductLifecycleStatus[];

/** Built-in exit checklist per stage (labels: product.gate.items.<key>). */
export const STAGE_CHECKLIST: Record<ProductStage, string[]> = {
  IDEA: ["problem_defined", "target_users", "initial_value"],
  RESEARCH: ["competitors_reviewed", "personas_defined", "research_doc"],
  VALIDATION: ["hypotheses_tested", "evidence_recorded", "go_decision"],
  BUSINESS_REQUIREMENTS: ["brd_written", "business_case", "stakeholders_aligned"],
  PRODUCT_REQUIREMENTS: ["prd_written", "features_prioritized", "acceptance_defined"],
  ARCHITECTURE: ["architecture_doc", "tech_requirements", "risks_reviewed"],
  DESIGN: ["ux_spec", "design_brief", "design_review"],
  DEVELOPMENT: ["backlog_ready", "dev_project_linked", "features_built"],
  QA: ["qa_plan", "tests_passed", "bugs_triaged"],
  RELEASE: ["release_planned", "release_notes", "release_shipped"],
  LAUNCH: ["launch_campaign", "support_ready", "launch_announced"],
  FEEDBACK: ["feedback_collected", "feedback_analyzed"],
  OPTIMIZATION: ["improvements_planned", "kpis_reviewed"],
};

export interface GateItem {
  id: string;
  key?: string;
  label?: string;
  done: boolean;
  doneAt?: string | null;
  doneById?: string | null;
}

export const stageIndex = (s: ProductStage) => PRODUCT_STAGES.indexOf(s as (typeof PRODUCT_STAGES)[number]);

export const productInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: optText(5000),
  targetUsers: optText(2000),
  status: z.enum(PRODUCT_STATUSES).default("ACTIVE"),
  ownerId: optUuid,
  graphEntityId: optUuid,
  developmentProjectId: optUuid,
  /** Also create a PRODUCT entity in the Company Graph (needs graph.manage). */
  createGraphEntity: z.boolean().optional(),
  /** Also create a development project for the product's tasks and sprints. */
  createProject: z.boolean().optional(),
});
export const updateProductInput = productInput.omit({ createGraphEntity: true, createProject: true }).partial().extend({ archived: z.boolean().optional() });
export const gateItemInput = z.object({ label: z.string().trim().min(1).max(200) });
export const gateUpdateInput = z.object({
  /** Toggle one checklist item. */
  itemId: z.string().min(1).max(60).optional(),
  done: z.boolean().optional(),
  /** Remove a custom item. */
  removeItemId: z.string().min(1).max(60).optional(),
  notes: optText(5000),
});
export const moveStageInput = z.object({ toStage: z.enum(PRODUCT_STAGES).optional(), note: optText(1000) });

const audit = (tx: Tx, ctx: RequestContext, organizationId: string, action: string, resourceId: string, newValue?: unknown, oldValue?: unknown) =>
  writeAudit(tx, ctx, { category: "TENANT", organizationId, action, resourceType: "product", resourceId, newValue, oldValue });

export function defaultChecklist(stage: ProductStage): GateItem[] {
  return STAGE_CHECKLIST[stage].map((key) => ({ id: key, key, done: false }));
}

export function readChecklist(v: Prisma.JsonValue): GateItem[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) return [];
    const o = x as Record<string, unknown>;
    if (typeof o.id !== "string") return [];
    return [{ id: o.id, key: typeof o.key === "string" ? o.key : undefined, label: typeof o.label === "string" ? o.label : undefined, done: o.done === true, doneAt: typeof o.doneAt === "string" ? o.doneAt : null, doneById: typeof o.doneById === "string" ? o.doneById : null }];
  });
}

/** A product of the company (not found otherwise). */
export async function productOf(client: Tx | ReturnType<typeof db>, organizationId: string, companyId: string, productId: string) {
  if (!isUuid(productId)) throw notFound("Product");
  const p = await client.product.findFirst({ where: { id: productId, organizationId, companyId } });
  if (!p) throw notFound("Product");
  return p;
}

async function checkRefs(tx: Tx, organizationId: string, companyId: string, chain: Awaited<ReturnType<typeof authorize>>, refs: { ownerId?: string | null; graphEntityId?: string | null; developmentProjectId?: string | null }) {
  if (refs.ownerId) await requireEligible(tx, organizationId, chain, refs.ownerId, "projects.read");
  if (refs.graphEntityId && !(await tx.graphEntity.findFirst({ where: { id: refs.graphEntityId, organizationId, companyId, kind: "PRODUCT" }, select: { id: true } }))) throw notFound("Graph entity");
  if (refs.developmentProjectId && !(await tx.project.findFirst({ where: { id: refs.developmentProjectId, organizationId, companyId }, select: { id: true } }))) throw notFound("Project");
}

async function ensureGate(tx: Tx, organizationId: string, companyId: string, productId: string, stage: ProductStage) {
  const existing = await tx.productStageGate.findUnique({ where: { productId_stage: { productId, stage } } });
  if (existing) return existing;
  return tx.productStageGate.create({ data: { organizationId, companyId, productId, stage, checklist: defaultChecklist(stage) as unknown as Prisma.InputJsonValue } });
}

// ─── Products ───

export async function createProduct(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof productInput>) {
  const input = productInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "projects.manage");
  if (await db().product.findFirst({ where: { organizationId, companyId, name: input.name }, select: { id: true } })) throw conflict("A product with this name exists", { reason: "work_product_exists" });
  // Linked records in other areas are created first through their own services (their permissions apply).
  let graphEntityId = blank(input.graphEntityId) ?? null;
  if (!graphEntityId && input.createGraphEntity) {
    const existing = await db().graphEntity.findFirst({ where: { organizationId, companyId, kind: "PRODUCT", name: input.name }, select: { id: true } });
    graphEntityId = existing?.id ?? (await createEntity(ctx, organizationId, companyId, { kind: "PRODUCT", name: input.name, description: blank(input.description) ?? undefined })).id;
  }
  let developmentProjectId = blank(input.developmentProjectId) ?? null;
  if (!developmentProjectId && input.createProject) {
    developmentProjectId = (await createWorkProject(ctx, organizationId, companyId, { name: input.name.slice(0, 120), description: blank(input.description) ?? undefined, status: "ACTIVE", ownerId: blank(input.ownerId) ?? undefined })).id;
  }
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const ownerId = blank(input.ownerId) ?? ctx.actor.id ?? null;
    await checkRefs(tx, organizationId, companyId, chain, { ownerId: ownerId !== ctx.actor.id ? ownerId : null, graphEntityId, developmentProjectId });
    const p = await tx.product.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        description: blank(input.description) ?? null,
        targetUsers: blank(input.targetUsers) ?? null,
        status: input.status,
        ownerId,
        graphEntityId,
        developmentProjectId,
        createdById: actorId(ctx, organizationId),
      },
    });
    await tx.productStageChange.create({ data: { organizationId, companyId, productId: p.id, stage: "IDEA", changedById: actorId(ctx, organizationId) } });
    await ensureGate(tx, organizationId, companyId, p.id, "IDEA");
    await audit(tx, ctx, organizationId, "product.created", p.id, { name: p.name, graphEntityId, developmentProjectId });
    return p;
  });
}

export async function updateProduct(ctx: RequestContext, organizationId: string, companyId: string, productId: string, raw: z.input<typeof updateProductInput>) {
  const input = updateProductInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const before = await productOf(tx, organizationId, companyId, productId);
    if (input.name && input.name !== before.name && (await tx.product.findFirst({ where: { organizationId, companyId, name: input.name, id: { not: productId } }, select: { id: true } }))) {
      throw conflict("A product with this name exists", { reason: "work_product_exists" });
    }
    const refs = {
      ownerId: input.ownerId !== undefined ? (blank(input.ownerId) ?? null) : undefined,
      graphEntityId: input.graphEntityId !== undefined ? (blank(input.graphEntityId) ?? null) : undefined,
      developmentProjectId: input.developmentProjectId !== undefined ? (blank(input.developmentProjectId) ?? null) : undefined,
    };
    await checkRefs(tx, organizationId, companyId, chain, refs);
    const p = await tx.product.update({
      where: { id: productId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: blank(input.description) ?? null } : {}),
        ...(input.targetUsers !== undefined ? { targetUsers: blank(input.targetUsers) ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(refs.ownerId !== undefined ? { ownerId: refs.ownerId } : {}),
        ...(refs.graphEntityId !== undefined ? { graphEntityId: refs.graphEntityId } : {}),
        ...(refs.developmentProjectId !== undefined ? { developmentProjectId: refs.developmentProjectId } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? (before.archivedAt ?? new Date()) : null } : {}),
      },
    });
    await audit(tx, ctx, organizationId, "product.updated", productId, input, { name: before.name, status: before.status, ownerId: before.ownerId });
    if (refs.ownerId && refs.ownerId !== before.ownerId && refs.ownerId !== ctx.actor.id) {
      await notifyUsers(tx, organizationId, [refs.ownerId], "work.productOwner", { companyId, title: p.name, href: `/product/${p.id}` });
    }
    return p;
  });
}

/** Create the development project for a product that has none and link it. */
export async function createDevelopmentProject(ctx: RequestContext, organizationId: string, companyId: string, productId: string) {
  await authorize(ctx, organizationId, companyId, "projects.manage");
  const p = await productOf(db(), organizationId, companyId, productId);
  if (p.developmentProjectId) throw conflict("The product already has a development project", { reason: "work_product_has_project" });
  const project = await createWorkProject(ctx, organizationId, companyId, { name: p.name.slice(0, 120), description: p.description ?? undefined, status: "ACTIVE", ownerId: p.ownerId ?? undefined });
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const updated = await tx.product.update({ where: { id: productId }, data: { developmentProjectId: project.id } });
    await audit(tx, ctx, organizationId, "product.project_linked", productId, { projectId: project.id });
    return updated;
  });
}

export interface ProductFilters {
  q?: string;
  stage?: ProductStage;
  status?: ProductLifecycleStatus;
  archived: boolean;
  sort: "name" | "created" | "stage" | "updated";
  page: number;
}

export function parseProductFilters(raw: Record<string, string | string[] | undefined>): ProductFilters {
  return {
    q: param(raw, "q")?.slice(0, 200),
    stage: oneOf(PRODUCT_STAGES, param(raw, "stage")),
    status: oneOf(PRODUCT_STATUSES, param(raw, "status")),
    archived: param(raw, "archived") === "1",
    sort: oneOf(["name", "created", "stage", "updated"] as const, param(raw, "sort")) ?? "updated",
    page: pageParam(raw),
  };
}

export async function listProducts(ctx: RequestContext, organizationId: string, companyId: string, f: ProductFilters) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const where: Prisma.ProductWhereInput = { organizationId, companyId, archivedAt: f.archived ? { not: null } : null };
  if (f.stage) where.stage = f.stage;
  if (f.status) where.status = f.status;
  if (f.q) where.OR = [{ name: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }, { targetUsers: { contains: f.q, mode: "insensitive" } }];
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    f.sort === "name" ? [{ name: "asc" }] : f.sort === "created" ? [{ createdAt: "desc" }] : f.sort === "stage" ? [{ stage: "asc" }, { name: "asc" }] : [{ updatedAt: "desc" }];
  const [total, rows] = await Promise.all([
    db().product.count({ where }),
    db().product.findMany({
      where,
      orderBy,
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { developmentProject: { select: { id: true, name: true } }, _count: { select: { features: true, feedback: true, releases: true, docs: true } } },
    }),
  ]);
  const names = await userNames(db(), rows.map((r) => r.ownerId));
  return { data: rows.map((r) => ({ ...r, ownerName: r.ownerId ? (names.get(r.ownerId) ?? null) : null })), total, page: f.page, pageSize: PAGE_SIZE };
}

/** Current-stage board across the company's active products. */
export async function stageBoard(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const rows = await db().product.findMany({
    where: { organizationId, companyId, archivedAt: null },
    orderBy: { stageEnteredAt: "asc" },
    take: 500,
    select: { id: true, name: true, stage: true, status: true, stageEnteredAt: true, ownerId: true, gates: { select: { stage: true, approvedAt: true, checklist: true } } },
  });
  const names = await userNames(db(), rows.map((r) => r.ownerId));
  return PRODUCT_STAGES.map((stage) => ({
    stage,
    products: rows
      .filter((r) => r.stage === stage)
      .map(({ gates, ...r }) => {
        const gate = gates.find((g) => g.stage === stage);
        const items = gate ? readChecklist(gate.checklist) : defaultChecklist(stage);
        return { ...r, ownerName: r.ownerId ? (names.get(r.ownerId) ?? null) : null, gateDone: items.filter((i) => i.done).length, gateTotal: items.length, gateApproved: !!gate?.approvedAt };
      }),
  }));
}

/** Product header + overview data for the workspace. */
export async function getProduct(ctx: RequestContext, organizationId: string, companyId: string, productId: string) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const p = await productOf(db(), organizationId, companyId, productId);
  const [project, graphEntity, counts, history, gates, names] = await Promise.all([
    p.developmentProjectId ? db().project.findFirst({ where: { id: p.developmentProjectId, companyId }, select: { id: true, name: true, status: true, archivedAt: true } }) : null,
    p.graphEntityId ? db().graphEntity.findFirst({ where: { id: p.graphEntityId, companyId }, select: { id: true, name: true } }) : null,
    db().product.findUniqueOrThrow({ where: { id: productId }, select: { _count: { select: { features: true, feedback: true, releases: true, docs: true, competitors: true, validations: true, personas: true, initiatives: true, ideas: true } } } }),
    db().productStageChange.findMany({ where: { productId, companyId }, orderBy: { enteredAt: "desc" }, take: 100 }),
    db().productStageGate.findMany({ where: { productId, companyId } }),
    userNames(db(), [p.ownerId]),
  ]);
  const changers = await userNames(db(), [...history.map((h) => h.changedById), ...gates.map((g) => g.approvedById)]);
  const current = gates.find((g) => g.stage === p.stage);
  return {
    ...p,
    ownerName: p.ownerId ? (names.get(p.ownerId) ?? null) : null,
    project,
    graphEntity,
    counts: counts._count,
    history: history.map((h) => ({ ...h, changedByName: changers.get(h.changedById) ?? null })),
    gates: gates.map((g) => ({ stage: g.stage, approvedAt: g.approvedAt, approvedByName: g.approvedById ? (changers.get(g.approvedById) ?? null) : null, items: readChecklist(g.checklist), notes: g.notes })),
    gate: current
      ? { stage: current.stage, approvedAt: current.approvedAt, approvedById: current.approvedById, approvedByName: current.approvedById ? (changers.get(current.approvedById) ?? null) : null, items: readChecklist(current.checklist), notes: current.notes }
      : { stage: p.stage, approvedAt: null, approvedById: null, approvedByName: null, items: defaultChecklist(p.stage), notes: null },
  };
}

/** Light header for the product sub-pages. */
export async function productHeader(ctx: RequestContext, organizationId: string, companyId: string, productId: string) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const p = await productOf(db(), organizationId, companyId, productId);
  return { id: p.id, name: p.name, stage: p.stage, status: p.status, archivedAt: p.archivedAt, ownerId: p.ownerId, developmentProjectId: p.developmentProjectId, description: p.description, targetUsers: p.targetUsers };
}

/** Options for product pickers. */
export async function productOptions(organizationId: string, companyId: string) {
  const rows = await db().product.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } });
  return rows;
}

/** Graph PRODUCT entities and projects for the product form. */
export async function productFormPickers(organizationId: string, companyId: string) {
  const [entities, projects] = await Promise.all([
    db().graphEntity.findMany({ where: { organizationId, companyId, kind: "PRODUCT" }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } }),
    db().project.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } }),
  ]);
  return { entities, projects };
}

// ─── Stage gates ───

async function gateFor(tx: Tx, organizationId: string, companyId: string, productId: string, stage: ProductStage) {
  return ensureGate(tx, organizationId, companyId, productId, stage);
}

/** Toggle a checklist item, remove a custom item or edit notes on the current stage's gate. */
export async function updateGate(ctx: RequestContext, organizationId: string, companyId: string, productId: string, raw: z.input<typeof gateUpdateInput>) {
  const input = gateUpdateInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const p = await productOf(tx, organizationId, companyId, productId);
    const gate = await gateFor(tx, organizationId, companyId, productId, p.stage);
    let items = readChecklist(gate.checklist);
    if (input.itemId) {
      const item = items.find((i) => i.id === input.itemId);
      if (!item) throw notFound("Checklist item");
      const done = input.done ?? !item.done;
      items = items.map((i) => (i.id === item.id ? { ...i, done, doneAt: done ? new Date().toISOString() : null, doneById: done ? ctx.actor.id : null } : i));
    }
    if (input.removeItemId) {
      const item = items.find((i) => i.id === input.removeItemId);
      if (!item) throw notFound("Checklist item");
      if (item.key) throw invalid("Built-in checklist items can't be removed", { reason: "work_product_gate_builtin" });
      items = items.filter((i) => i.id !== item.id);
    }
    // Any checklist change after approval re-opens the gate.
    const reopened = !!gate.approvedAt && (!!input.itemId || !!input.removeItemId);
    const g = await tx.productStageGate.update({
      where: { id: gate.id },
      data: { checklist: items as unknown as Prisma.InputJsonValue, ...(input.notes !== undefined ? { notes: blank(input.notes) ?? null } : {}), ...(reopened ? { approvedAt: null, approvedById: null } : {}) },
    });
    await audit(tx, ctx, organizationId, "product.gate.updated", productId, { stage: p.stage, ...input, reopened });
    return g;
  });
}

export async function addGateItem(ctx: RequestContext, organizationId: string, companyId: string, productId: string, raw: z.input<typeof gateItemInput>) {
  const input = gateItemInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const p = await productOf(tx, organizationId, companyId, productId);
    const gate = await gateFor(tx, organizationId, companyId, productId, p.stage);
    const items = readChecklist(gate.checklist);
    if (items.length >= 30) throw invalid("A gate has at most 30 items", { reason: "work_product_gate_full" });
    items.push({ id: randomUUID().slice(0, 12), label: input.label, done: false });
    const g = await tx.productStageGate.update({ where: { id: gate.id }, data: { checklist: items as unknown as Prisma.InputJsonValue, approvedAt: null, approvedById: null } });
    await audit(tx, ctx, organizationId, "product.gate.item_added", productId, { stage: p.stage, label: input.label });
    return g;
  });
}

/** The product owner approves the current stage's gate (every checklist item must be done). Without an owner, any manager may. */
export async function approveGate(ctx: RequestContext, organizationId: string, companyId: string, productId: string, approve = true) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const p = await productOf(tx, organizationId, companyId, productId);
    if (p.ownerId && p.ownerId !== ctx.actor.id) throw forbidden("Only the product owner approves stage gates", { reason: "work_product_gate_owner_only" });
    const gate = await gateFor(tx, organizationId, companyId, productId, p.stage);
    const items = readChecklist(gate.checklist);
    if (approve && items.some((i) => !i.done)) throw conflict("Complete every checklist item first", { reason: "work_product_gate_incomplete" });
    const g = await tx.productStageGate.update({ where: { id: gate.id }, data: approve ? { approvedAt: new Date(), approvedById: ctx.actor.id } : { approvedAt: null, approvedById: null } });
    await audit(tx, ctx, organizationId, approve ? "product.gate.approved" : "product.gate.reopened", productId, { stage: p.stage });
    return g;
  });
}

/**
 * Move the product to the next stage (requires the current gate approved) or back to an earlier stage.
 * Records the stage history and opens the new stage's gate.
 */
export async function moveStage(ctx: RequestContext, organizationId: string, companyId: string, productId: string, raw: z.input<typeof moveStageInput>) {
  const input = moveStageInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const p = await productOf(tx, organizationId, companyId, productId);
    if (p.archivedAt) throw conflict("The product is archived", { reason: "work_product_archived" });
    const from = stageIndex(p.stage);
    const target = input.toStage ?? PRODUCT_STAGES[from + 1];
    if (!target) throw conflict("The product is in its last stage", { reason: "work_product_last_stage" });
    const to = stageIndex(target);
    if (to === from) throw conflict("The product is already in this stage", { reason: "work_product_same_stage" });
    if (to > from + 1) throw invalid("Stages advance one at a time", { reason: "work_product_stage_skip" });
    if (to === from + 1) {
      const gate = await tx.productStageGate.findUnique({ where: { productId_stage: { productId, stage: p.stage } } });
      if (!gate?.approvedAt) throw conflict("The current stage gate is not approved", { reason: "work_product_gate_not_approved" });
    }
    const now = new Date();
    await tx.productStageChange.updateMany({ where: { productId, companyId, exitedAt: null }, data: { exitedAt: now } });
    await tx.productStageChange.create({ data: { organizationId, companyId, productId, fromStage: p.stage, stage: target, enteredAt: now, note: blank(input.note) ?? null, changedById: actorId(ctx, organizationId) } });
    await ensureGate(tx, organizationId, companyId, productId, target);
    const updated = await tx.product.update({ where: { id: productId }, data: { stage: target, stageEnteredAt: now } });
    await audit(tx, ctx, organizationId, "product.stage_changed", productId, { stage: target, note: input.note }, { stage: p.stage });
    if (p.ownerId && p.ownerId !== ctx.actor.id) await notifyUsers(tx, organizationId, [p.ownerId], "work.productStage", { companyId, title: p.name, href: `/product/${p.id}` });
    return updated;
  });
}
