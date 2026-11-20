import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { ProductIdeaStatus, ProductItemStatus, ProductReleaseStatus } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { actorId, authorize, blank, isUuid, oneOf, optDay, optText, optUuid, PAGE_SIZE, pageParam, param, quarter, toDay, userNames } from "./shared";

export const ITEM_STATUSES = ["PROPOSED", "PLANNED", "IN_PROGRESS", "SHIPPED", "CANCELLED"] as const;
export const IDEA_STATUSES = ["NEW", "UNDER_REVIEW", "PLANNED", "DECLINED", "DONE"] as const;
export const RELEASE_STATUSES = ["PLANNED", "IN_PROGRESS", "RELEASED"] as const;
export const IMPACT_VALUES = [0.25, 0.5, 1, 2, 3] as const;
const optQuarter = quarter.or(z.literal("")).nullable().optional();

export const initiativeInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: optText(5000),
  quarter: optQuarter,
  status: z.enum(ITEM_STATUSES).default("PLANNED"),
});
export const updateInitiativeInput = initiativeInput.partial().extend({ archived: z.boolean().optional() });

const rice = {
  reach: z.number().int().min(0).max(100_000_000).nullable().optional(),
  impact: z
    .number()
    .refine((v) => (IMPACT_VALUES as readonly number[]).includes(v), "impact must be 0.25, 0.5, 1, 2 or 3")
    .nullable()
    .optional(),
  confidence: z.number().int().min(0).max(100).nullable().optional(),
  effort: z.number().positive().max(1000).nullable().optional(),
};

export const featureInput = z.object({
  title: z.string().trim().min(1).max(200),
  spec: optText(50_000),
  status: z.enum(ITEM_STATUSES).default("PROPOSED"),
  quarter: optQuarter,
  initiativeId: optUuid,
  projectId: optUuid,
  releaseId: optUuid,
  ...rice,
});
export const updateFeatureInput = featureInput.partial().extend({ archived: z.boolean().optional() });

export const ideaInput = z.object({ title: z.string().trim().min(1).max(200), description: optText(5000) });
export const updateIdeaInput = z.object({ title: z.string().trim().min(1).max(200).optional(), description: optText(5000), status: z.enum(IDEA_STATUSES).optional() });

export const feedbackInput = z.object({
  source: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1).max(10_000),
  accountId: optUuid,
  contactId: optUuid,
  featureId: optUuid,
});
export const updateFeedbackInput = z.object({ featureId: optUuid, archived: z.boolean().optional() });

export const releaseInput = z.object({
  version: z
    .string()
    .trim()
    .regex(/^v?\d+\.\d+(\.\d+)?([-+][0-9A-Za-z.-]+)?$/, "Use a version like 1.4.0"),
  name: optText(200),
  releaseDate: optDay,
  status: z.enum(RELEASE_STATUSES).default("PLANNED"),
  notes: optText(20_000),
  featureIds: z.array(z.string().uuid()).max(200).optional(),
});
export const updateReleaseInput = releaseInput.partial().extend({ published: z.boolean().optional() });

/** RICE = reach × impact × confidence% ÷ effort (null until every input is set). */
export function riceScore(f: { reach?: number | null; impact?: number | null; confidence?: number | null; effort?: number | null }) {
  if (f.reach == null || f.impact == null || f.confidence == null || !f.effort) return null;
  return Math.round(((f.reach * f.impact * (f.confidence / 100)) / f.effort) * 10) / 10;
}

const audit = (tx: Tx, ctx: RequestContext, organizationId: string, action: string, resourceType: string, resourceId: string, newValue?: unknown, oldValue?: unknown) =>
  writeAudit(tx, ctx, { category: "TENANT", organizationId, action, resourceType, resourceId, newValue, oldValue });

async function findIn<T>(fn: () => Promise<T | null>, what: string, id: string) {
  if (!isUuid(id)) throw notFound(what);
  const r = await fn();
  if (!r) throw notFound(what);
  return r;
}

async function checkFeatureRefs(tx: Tx, organizationId: string, companyId: string, refs: { initiativeId?: string | null; projectId?: string | null; releaseId?: string | null }) {
  if (refs.initiativeId && !(await tx.productInitiative.findFirst({ where: { id: refs.initiativeId, organizationId, companyId }, select: { id: true } }))) throw notFound("Initiative");
  if (refs.projectId && !(await tx.project.findFirst({ where: { id: refs.projectId, organizationId, companyId }, select: { id: true } }))) throw notFound("Project");
  if (refs.releaseId && !(await tx.productRelease.findFirst({ where: { id: refs.releaseId, organizationId, companyId }, select: { id: true } }))) throw notFound("Release");
}

// ─── Initiatives & roadmap ───

export async function createInitiative(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof initiativeInput>) {
  const input = initiativeInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const i = await tx.productInitiative.create({ data: { organizationId, companyId, title: input.title, description: blank(input.description) ?? null, quarter: blank(input.quarter) ?? null, status: input.status } });
    await audit(tx, ctx, organizationId, "product_initiative.created", "product_initiative", i.id, { title: i.title });
    return i;
  });
}

export async function updateInitiative(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateInitiativeInput>) {
  const input = updateInitiativeInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const before = await findIn(() => tx.productInitiative.findFirst({ where: { id, organizationId, companyId } }), "Initiative", id);
    const i = await tx.productInitiative.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: blank(input.description) ?? null } : {}),
        ...(input.quarter !== undefined ? { quarter: blank(input.quarter) ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? (before.archivedAt ?? new Date()) : null } : {}),
      },
    });
    await audit(tx, ctx, organizationId, "product_initiative.updated", "product_initiative", id, input);
    return i;
  });
}

/** Quarter key for a date ("2026-Q4"). */
export const quarterOf = (d: Date) => `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;

/** Roadmap: initiatives and features grouped by quarter (current quarter and the next `span - 1`, plus unscheduled). */
export async function getRoadmap(ctx: RequestContext, organizationId: string, companyId: string, opts: { start?: string; span?: number } = {}) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const span = Math.min(Math.max(opts.span ?? 4, 1), 8);
  const first = opts.start && /^\d{4}-Q[1-4]$/.test(opts.start) ? opts.start : quarterOf(new Date());
  const quarters: string[] = [];
  let [y, q] = [Number(first.slice(0, 4)), Number(first.slice(6))];
  for (let i = 0; i < span; i++) {
    quarters.push(`${y}-Q${q}`);
    q = q === 4 ? 1 : q + 1;
    if (q === 1) y++;
  }
  const [initiatives, features] = await Promise.all([
    db().productInitiative.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: [{ quarter: "asc" }, { title: "asc" }], take: 500 }),
    db().productFeature.findMany({
      where: { organizationId, companyId, archivedAt: null, status: { not: "CANCELLED" } },
      orderBy: [{ riceScore: { sort: "desc", nulls: "last" } }],
      take: 1000,
      select: { id: true, title: true, status: true, quarter: true, initiativeId: true, riceScore: true, release: { select: { id: true, version: true } } },
    }),
  ]);
  return { quarters, initiatives, features };
}

// ─── Features ───

export interface FeatureFilters {
  q?: string;
  status?: ProductItemStatus;
  initiativeId?: string;
  releaseId?: string;
  sort: "rice" | "created" | "title" | "status";
  page: number;
}

export function parseFeatureFilters(raw: Record<string, string | string[] | undefined>): FeatureFilters {
  const initiative = param(raw, "initiative");
  const release = param(raw, "release");
  return {
    q: param(raw, "q")?.slice(0, 200),
    status: oneOf(ITEM_STATUSES, param(raw, "status")),
    initiativeId: isUuid(initiative) ? initiative : undefined,
    releaseId: isUuid(release) ? release : undefined,
    sort: oneOf(["rice", "created", "title", "status"] as const, param(raw, "sort")) ?? "created",
    page: pageParam(raw),
  };
}

export async function listFeatures(ctx: RequestContext, organizationId: string, companyId: string, f: FeatureFilters) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const where: Prisma.ProductFeatureWhereInput = { organizationId, companyId, archivedAt: null };
  if (f.status) where.status = f.status;
  if (f.initiativeId) where.initiativeId = f.initiativeId;
  if (f.releaseId) where.releaseId = f.releaseId;
  if (f.q) where.OR = [{ title: { contains: f.q, mode: "insensitive" } }, { spec: { contains: f.q, mode: "insensitive" } }];
  const orderBy: Prisma.ProductFeatureOrderByWithRelationInput[] =
    f.sort === "rice" ? [{ riceScore: { sort: "desc", nulls: "last" } }] : f.sort === "title" ? [{ title: "asc" }] : f.sort === "status" ? [{ status: "asc" }, { title: "asc" }] : [{ createdAt: "desc" }];
  const [total, data] = await Promise.all([
    db().productFeature.count({ where }),
    db().productFeature.findMany({
      where,
      orderBy,
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        initiative: { select: { id: true, title: true } },
        release: { select: { id: true, version: true } },
        project: { select: { id: true, name: true } },
        _count: { select: { tasks: true, feedback: true, ideas: true } },
      },
    }),
  ]);
  return { data, total, page: f.page, pageSize: PAGE_SIZE };
}

export async function getFeature(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const f = await findIn(
    () =>
      db().productFeature.findFirst({
        where: { id, organizationId, companyId },
        include: {
          initiative: { select: { id: true, title: true } },
          release: { select: { id: true, version: true, status: true } },
          project: { select: { id: true, name: true } },
          tasks: { where: { archivedAt: null }, orderBy: { createdAt: "asc" }, take: 200, select: { id: true, title: true, status: true, dueDate: true, assignee: { select: { id: true, name: true } } } },
          feedback: { where: { archivedAt: null }, orderBy: { createdAt: "desc" }, take: 100 },
          ideas: { select: { id: true, title: true, voteCount: true, status: true } },
        },
      }),
    "Feature",
    id,
  );
  return f;
}

export async function createFeature(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof featureInput>) {
  const input = featureInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const refs = { initiativeId: blank(input.initiativeId) ?? null, projectId: blank(input.projectId) ?? null, releaseId: blank(input.releaseId) ?? null };
    await checkFeatureRefs(tx, organizationId, companyId, refs);
    const f = await tx.productFeature.create({
      data: {
        organizationId,
        companyId,
        ...refs,
        title: input.title,
        spec: blank(input.spec) ?? null,
        status: input.status,
        quarter: blank(input.quarter) ?? null,
        reach: input.reach ?? null,
        impact: input.impact ?? null,
        confidence: input.confidence ?? null,
        effort: input.effort ?? null,
        riceScore: riceScore(input),
        createdById: actorId(ctx, organizationId),
      },
    });
    await audit(tx, ctx, organizationId, "product_feature.created", "product_feature", f.id, { title: f.title, riceScore: f.riceScore });
    return f;
  });
}

export async function updateFeature(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateFeatureInput>) {
  const input = updateFeatureInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const before = await findIn(() => tx.productFeature.findFirst({ where: { id, organizationId, companyId } }), "Feature", id);
    const data: Prisma.ProductFeatureUncheckedUpdateInput = {};
    const refs: Parameters<typeof checkFeatureRefs>[3] = {};
    if (input.initiativeId !== undefined) refs.initiativeId = data.initiativeId = blank(input.initiativeId) ?? null;
    if (input.projectId !== undefined) refs.projectId = data.projectId = blank(input.projectId) ?? null;
    if (input.releaseId !== undefined) refs.releaseId = data.releaseId = blank(input.releaseId) ?? null;
    await checkFeatureRefs(tx, organizationId, companyId, refs);
    if (input.title !== undefined) data.title = input.title;
    if (input.spec !== undefined) data.spec = blank(input.spec) ?? null;
    if (input.status !== undefined) data.status = input.status;
    if (input.quarter !== undefined) data.quarter = blank(input.quarter) ?? null;
    for (const k of ["reach", "impact", "confidence", "effort"] as const) if (input[k] !== undefined) data[k] = input[k];
    const merged = {
      reach: input.reach !== undefined ? input.reach : before.reach,
      impact: input.impact !== undefined ? input.impact : before.impact,
      confidence: input.confidence !== undefined ? input.confidence : before.confidence,
      effort: input.effort !== undefined ? input.effort : before.effort,
    };
    data.riceScore = riceScore(merged);
    if (input.archived !== undefined) data.archivedAt = input.archived ? (before.archivedAt ?? new Date()) : null;
    const f = await tx.productFeature.update({ where: { id }, data });
    await audit(tx, ctx, organizationId, "product_feature.updated", "product_feature", id, input, { status: before.status });
    return f;
  });
}

// ─── Ideas ───

export interface IdeaFilters {
  q?: string;
  status?: ProductIdeaStatus;
  sort: "votes" | "created";
  page: number;
}

export function parseIdeaFilters(raw: Record<string, string | string[] | undefined>): IdeaFilters {
  return { q: param(raw, "q")?.slice(0, 200), status: oneOf(IDEA_STATUSES, param(raw, "status")), sort: param(raw, "sort") === "created" ? "created" : "votes", page: pageParam(raw) };
}

export async function listIdeas(ctx: RequestContext, organizationId: string, companyId: string, f: IdeaFilters) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const where: Prisma.ProductIdeaWhereInput = { organizationId, companyId };
  if (f.status) where.status = f.status;
  if (f.q) where.OR = [{ title: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }];
  const [total, rows] = await Promise.all([
    db().productIdea.count({ where }),
    db().productIdea.findMany({
      where,
      orderBy: f.sort === "created" ? [{ createdAt: "desc" }] : [{ voteCount: "desc" }, { createdAt: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { feature: { select: { id: true, title: true } }, votes: { where: { userId: ctx.actor.id ?? "00000000-0000-0000-0000-000000000000" }, select: { id: true } } },
    }),
  ]);
  const names = await userNames(db(), rows.map((r) => r.submittedById));
  return { data: rows.map(({ votes, ...r }) => ({ ...r, voted: votes.length > 0, submittedByName: names.get(r.submittedById) ?? null })), total, page: f.page, pageSize: PAGE_SIZE };
}

/** Anyone who can see projects may submit and vote on ideas. */
export async function submitIdea(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof ideaInput>) {
  const input = ideaInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.read", tx);
    const idea = await tx.productIdea.create({ data: { organizationId, companyId, title: input.title, description: blank(input.description) ?? null, submittedById: actorId(ctx, organizationId) } });
    await audit(tx, ctx, organizationId, "product_idea.submitted", "product_idea", idea.id, { title: idea.title });
    return idea;
  });
}

export async function updateIdea(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateIdeaInput>) {
  const input = updateIdeaInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const before = await findIn(() => tx.productIdea.findFirst({ where: { id, organizationId, companyId } }), "Idea", id);
    const idea = await tx.productIdea.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: blank(input.description) ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });
    await audit(tx, ctx, organizationId, "product_idea.updated", "product_idea", id, input, { status: before.status });
    if (input.status && input.status !== before.status && before.submittedById !== ctx.actor.id) {
      await notifyUsers(tx, organizationId, [before.submittedById], "work.ideaStatus", { companyId, title: idea.title, href: "/product/ideas" });
    }
    return idea;
  });
}

/** Toggle the viewer's vote. */
export async function toggleVote(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.read", tx);
    if (!ctx.actor.id) throw invalid("Sign in to vote");
    await findIn(() => tx.productIdea.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }), "Idea", id);
    const existing = await tx.productIdeaVote.findUnique({ where: { ideaId_userId: { ideaId: id, userId: ctx.actor.id } } });
    if (existing) await tx.productIdeaVote.delete({ where: { id: existing.id } });
    else await tx.productIdeaVote.create({ data: { organizationId, companyId, ideaId: id, userId: ctx.actor.id } });
    const voteCount = await tx.productIdeaVote.count({ where: { ideaId: id } });
    await tx.productIdea.update({ where: { id }, data: { voteCount } });
    return { voted: !existing, voteCount };
  });
}

/** Turn an idea into a proposed feature (linked, idea marked PLANNED). */
export async function ideaToFeature(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const idea = await findIn(() => tx.productIdea.findFirst({ where: { id, organizationId, companyId } }), "Idea", id);
    if (idea.featureId) throw conflict("The idea already has a feature", { reason: "work_idea_has_feature" });
    const f = await tx.productFeature.create({ data: { organizationId, companyId, title: idea.title, spec: idea.description, status: "PROPOSED", createdById: actorId(ctx, organizationId) } });
    await tx.productIdea.update({ where: { id }, data: { featureId: f.id, status: "PLANNED" } });
    await audit(tx, ctx, organizationId, "product_idea.converted", "product_idea", id, { featureId: f.id });
    return f;
  });
}

// ─── Feedback ───

export async function listFeedback(ctx: RequestContext, organizationId: string, companyId: string, raw: Record<string, string | string[] | undefined>) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const q = param(raw, "q")?.slice(0, 200);
  const source = param(raw, "source")?.slice(0, 60);
  const feature = param(raw, "feature");
  const page = pageParam(raw);
  const where: Prisma.ProductFeedbackWhereInput = { organizationId, companyId, archivedAt: null };
  if (q) where.body = { contains: q, mode: "insensitive" };
  if (source) where.source = source;
  if (feature === "none") where.featureId = null;
  else if (isUuid(feature)) where.featureId = feature;
  const [total, rows] = await Promise.all([
    db().productFeedback.count({ where }),
    db().productFeedback.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { feature: { select: { id: true, title: true } } } }),
  ]);
  const accountIds = [...new Set(rows.map((r) => r.accountId).filter((v): v is string => !!v))];
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter((v): v is string => !!v))];
  const [accounts, contacts] = await Promise.all([
    accountIds.length ? db().account.findMany({ where: { id: { in: accountIds }, companyId }, select: { id: true, name: true } }) : [],
    contactIds.length ? db().contact.findMany({ where: { id: { in: contactIds }, companyId }, select: { id: true, firstName: true, lastName: true } }) : [],
  ]);
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const con = new Map(contacts.map((c) => [c.id, [c.firstName, c.lastName].filter(Boolean).join(" ")]));
  const sources = await db().productFeedback.findMany({ where: { organizationId, companyId }, distinct: ["source"], select: { source: true }, take: 50 });
  return {
    data: rows.map((r) => ({ ...r, accountName: r.accountId ? (acc.get(r.accountId) ?? null) : null, contactName: r.contactId ? (con.get(r.contactId) ?? null) : null })),
    total,
    page,
    pageSize: PAGE_SIZE,
    sources: sources.map((s) => s.source),
  };
}

export async function createFeedback(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof feedbackInput>) {
  const input = feedbackInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const accountId = blank(input.accountId) ?? null;
    const contactId = blank(input.contactId) ?? null;
    const featureId = blank(input.featureId) ?? null;
    if (accountId && !(await tx.account.findFirst({ where: { id: accountId, organizationId, companyId }, select: { id: true } }))) throw notFound("Account");
    if (contactId) {
      const c = await tx.contact.findFirst({ where: { id: contactId, organizationId, companyId }, select: { accountId: true } });
      if (!c) throw notFound("Contact");
      if (accountId && c.accountId && c.accountId !== accountId) throw invalid("The contact belongs to another account", { reason: "work_contact_account" });
    }
    if (featureId && !(await tx.productFeature.findFirst({ where: { id: featureId, organizationId, companyId }, select: { id: true } }))) throw notFound("Feature");
    const f = await tx.productFeedback.create({ data: { organizationId, companyId, source: input.source, body: input.body, accountId, contactId, featureId, createdById: actorId(ctx, organizationId) } });
    await audit(tx, ctx, organizationId, "product_feedback.created", "product_feedback", f.id, { source: f.source, featureId });
    return f;
  });
}

export async function updateFeedback(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateFeedbackInput>) {
  const input = updateFeedbackInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    await findIn(() => tx.productFeedback.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }), "Feedback", id);
    const featureId = input.featureId === undefined ? undefined : (blank(input.featureId) ?? null);
    if (featureId && !(await tx.productFeature.findFirst({ where: { id: featureId, organizationId, companyId }, select: { id: true } }))) throw notFound("Feature");
    const f = await tx.productFeedback.update({
      where: { id },
      data: { ...(featureId !== undefined ? { featureId } : {}), ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}) },
    });
    await audit(tx, ctx, organizationId, "product_feedback.updated", "product_feedback", id, input);
    return f;
  });
}

/** CRM accounts and contacts for feedback pickers (read through projects.read — names only). */
export async function feedbackPickers(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const [accounts, contacts, features] = await Promise.all([
    db().account.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } }),
    db().contact.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { firstName: "asc" }, take: 500, select: { id: true, firstName: true, lastName: true, accountId: true } }),
    db().productFeature.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { title: "asc" }, take: 500, select: { id: true, title: true } }),
  ]);
  return { accounts, contacts: contacts.map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" "), accountId: c.accountId })), features };
}

// ─── Releases & changelog ───

const versionKey = (v: string) =>
  v
    .replace(/^v/, "")
    .split(/[-+]/)[0]!
    .split(".")
    .map((n) => n.padStart(6, "0"))
    .join(".");

export async function listReleases(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const rows = await db().productRelease.findMany({ where: { organizationId, companyId }, take: 500, include: { features: { select: { id: true, title: true, status: true } } } });
  return rows.sort((a, b) => versionKey(b.version).localeCompare(versionKey(a.version)));
}

async function setReleaseFeatures(tx: Tx, organizationId: string, companyId: string, releaseId: string, featureIds: string[]) {
  await tx.productFeature.updateMany({ where: { companyId, releaseId, id: { notIn: featureIds } }, data: { releaseId: null } });
  if (featureIds.length) await tx.productFeature.updateMany({ where: { organizationId, companyId, id: { in: featureIds } }, data: { releaseId } });
}

export async function createRelease(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof releaseInput>) {
  const input = releaseInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    if (await tx.productRelease.findFirst({ where: { companyId, version: input.version }, select: { id: true } })) throw conflict("This version exists", { reason: "work_release_exists" });
    const r = await tx.productRelease.create({
      data: { organizationId, companyId, version: input.version, name: blank(input.name) ?? null, releaseDate: toDay(blank(input.releaseDate)), status: input.status, notes: blank(input.notes) ?? null },
    });
    if (input.featureIds) await setReleaseFeatures(tx, organizationId, companyId, r.id, input.featureIds);
    await audit(tx, ctx, organizationId, "product_release.created", "product_release", r.id, { version: r.version });
    return r;
  });
}

export async function updateRelease(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateReleaseInput>) {
  const input = updateReleaseInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const before = await findIn(() => tx.productRelease.findFirst({ where: { id, organizationId, companyId } }), "Release", id);
    if (input.version && input.version !== before.version && (await tx.productRelease.findFirst({ where: { companyId, version: input.version }, select: { id: true } }))) {
      throw conflict("This version exists", { reason: "work_release_exists" });
    }
    const status = (input.status ?? before.status) as ProductReleaseStatus;
    if (input.published && status !== "RELEASED") throw conflict("Only released versions can be published", { reason: "work_release_not_released" });
    const r = await tx.productRelease.update({
      where: { id },
      data: {
        ...(input.version !== undefined ? { version: input.version } : {}),
        ...(input.name !== undefined ? { name: blank(input.name) ?? null } : {}),
        ...(input.releaseDate !== undefined ? { releaseDate: toDay(blank(input.releaseDate)) } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.notes !== undefined ? { notes: blank(input.notes) ?? null } : {}),
        ...(status === "RELEASED" && !before.releaseDate && input.releaseDate === undefined ? { releaseDate: new Date() } : {}),
        ...(input.published !== undefined ? { publishedAt: input.published ? (before.publishedAt ?? new Date()) : null } : {}),
        ...(status !== "RELEASED" ? { publishedAt: null } : {}),
      },
    });
    if (input.featureIds) await setReleaseFeatures(tx, organizationId, companyId, id, input.featureIds);
    if (input.status === "RELEASED" && before.status !== "RELEASED") {
      await tx.productFeature.updateMany({ where: { companyId, releaseId: id, status: { notIn: ["CANCELLED"] } }, data: { status: "SHIPPED" } });
    }
    await audit(tx, ctx, organizationId, input.published === true ? "product_release.published" : "product_release.updated", "product_release", id, input, { status: before.status });
    return r;
  });
}

export async function deleteRelease(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "projects.manage", tx);
    const r = await findIn(() => tx.productRelease.findFirst({ where: { id, organizationId, companyId } }), "Release", id);
    if (r.publishedAt) throw conflict("Unpublish the release first", { reason: "work_release_published" });
    await tx.productFeature.updateMany({ where: { companyId, releaseId: id }, data: { releaseId: null } });
    await tx.productRelease.delete({ where: { id } });
    await audit(tx, ctx, organizationId, "product_release.deleted", "product_release", id, undefined, { version: r.version });
    return { ok: true };
  });
}

/** Public changelog (no auth): published releases of a company, newest first. Only explicitly published content. */
export async function publicChangelog(companyId: string) {
  if (!isUuid(companyId)) return null;
  const company = await db().company.findFirst({ where: { id: companyId, deletedAt: null }, select: { id: true, name: true, timezone: true } });
  if (!company) return null;
  const releases = await db().productRelease.findMany({
    where: { companyId, publishedAt: { not: null }, status: "RELEASED" },
    take: 100,
    select: { id: true, version: true, name: true, releaseDate: true, publishedAt: true, notes: true, features: { where: { archivedAt: null, status: { not: "CANCELLED" } }, select: { id: true, title: true } } },
  });
  return { company, releases: releases.sort((a, b) => versionKey(b.version).localeCompare(versionKey(a.version))) };
}

/** Quarters for pickers: two past quarters through five ahead. */
export function quarterOptions(now = new Date()) {
  const out: string[] = [];
  let y = now.getUTCFullYear();
  let q = Math.floor(now.getUTCMonth() / 3) + 1 - 2;
  while (q < 1) {
    q += 4;
    y--;
  }
  for (let i = 0; i < 8; i++) {
    out.push(`${y}-Q${q}`);
    q = q === 4 ? 1 : q + 1;
    if (q === 1) y++;
  }
  return out;
}

/** Options for feature pickers (initiatives, projects, releases). */
export async function featurePickers(organizationId: string, companyId: string) {
  const [initiatives, projects, releases] = await Promise.all([
    db().productInitiative.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    db().project.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } }),
    db().productRelease.findMany({ where: { organizationId, companyId, status: { not: "RELEASED" } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, version: true } }),
  ]);
  return {
    initiatives: initiatives.map((i) => ({ id: i.id, name: i.title })),
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    releases: releases.map((r) => ({ id: r.id, name: r.version })),
  };
}
