import type { ProductDocKind, ProductStage } from "@/generated/prisma/enums";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { can } from "@/server/modules/rbac/service";
import { productOf, stageIndex } from "./product-core";
import { docSubject } from "./product-docs";
import { authorize } from "./shared";

/**
 * Product Studio: the plain-language journey Idea → Research → Plan → Design → Build → Launch over the 13 lifecycle
 * stages, with progress computed from the product's real records, and launch readiness.
 */

export const JOURNEY = [
  { key: "idea", stages: ["IDEA"], ai: { kind: "plan" as const } },
  { key: "research", stages: ["RESEARCH", "VALIDATION"], ai: { kind: "doc" as const, doc: "RESEARCH" as ProductDocKind } },
  { key: "plan", stages: ["BUSINESS_REQUIREMENTS", "PRODUCT_REQUIREMENTS"], ai: { kind: "doc" as const, doc: "PRD" as ProductDocKind } },
  { key: "design", stages: ["ARCHITECTURE", "DESIGN"], ai: { kind: "doc" as const, doc: "DESIGN_BRIEF" as ProductDocKind } },
  { key: "build", stages: ["DEVELOPMENT", "QA"], ai: { kind: "apply" as const } },
  { key: "launch", stages: ["RELEASE", "LAUNCH", "FEEDBACK", "OPTIMIZATION"], ai: { kind: "doc" as const, doc: "RELEASE_PLAN" as ProductDocKind } },
] as const satisfies readonly { key: string; stages: readonly ProductStage[]; ai: unknown }[];

export type JourneyKey = (typeof JOURNEY)[number]["key"];

export interface JourneyCheck {
  key: string;
  done: boolean;
}

export async function productJourney(ctx: RequestContext, organizationId: string, companyId: string, productId: string) {
  const chain = await authorize(ctx, organizationId, companyId, "projects.read");
  const p = await productOf(db(), organizationId, companyId, productId);
  const canAgents = await can(ctx, "agents.read", chain);
  const [competitors, validations, validated, personas, docs, features, specified, tasks, done, releases, released, plan, aiTasks] = await Promise.all([
    db().productCompetitor.count({ where: { productId, companyId } }),
    db().productValidation.count({ where: { productId, companyId } }),
    db().productValidation.count({ where: { productId, companyId, result: "VALIDATED" } }),
    db().productPersona.count({ where: { productId, companyId } }),
    db().productDoc.findMany({ where: { productId, companyId }, select: { kind: true, status: true } }),
    db().productFeature.count({ where: { productId, companyId, archivedAt: null, status: { not: "CANCELLED" } } }),
    db().productFeature.count({ where: { productId, companyId, archivedAt: null, acceptanceCriteria: { not: null } } }),
    p.developmentProjectId ? db().workTask.count({ where: { companyId, projectId: p.developmentProjectId, archivedAt: null } }) : 0,
    p.developmentProjectId ? db().workTask.count({ where: { companyId, projectId: p.developmentProjectId, archivedAt: null, status: "DONE" } }) : 0,
    db().productRelease.count({ where: { productId, companyId } }),
    db().productRelease.count({ where: { productId, companyId, status: "RELEASED" } }),
    db().productPlanRun.findFirst({ where: { productId, companyId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, currentStep: true } }),
    canAgents
      ? db().agentTask.findMany({
          where: { organizationId, companyId, subjectId: productId },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, status: true, subjectType: true, createdAt: true },
        })
      : [],
  ]);
  const has = (k: ProductDocKind) => docs.some((d) => d.kind === k);
  const approved = (k: ProductDocKind) => docs.some((d) => d.kind === k && d.status === "APPROVED");
  const checks: Record<JourneyKey, JourneyCheck[]> = {
    idea: [
      { key: "described", done: !!p.description },
      { key: "audience", done: !!p.targetUsers },
      { key: "owner", done: !!p.ownerId },
    ],
    research: [
      { key: "competitors", done: competitors > 0 },
      { key: "personas", done: personas > 0 },
      { key: "validated", done: validated > 0 },
      { key: "researchDoc", done: has("RESEARCH") },
    ],
    plan: [
      { key: "brd", done: has("BRD") },
      { key: "prd", done: has("PRD") },
      { key: "prdApproved", done: approved("PRD") },
      { key: "features", done: features > 0 },
    ],
    design: [
      { key: "architecture", done: has("ARCHITECTURE") },
      { key: "ux", done: has("UX_SPEC") },
      { key: "designBrief", done: has("DESIGN_BRIEF") },
    ],
    build: [
      { key: "project", done: !!p.developmentProjectId },
      { key: "backlog", done: tasks > 0 },
      { key: "criteria", done: specified > 0 },
      { key: "qaPlan", done: has("QA_PLAN") },
    ],
    launch: [
      { key: "releasePlan", done: has("RELEASE_PLAN") },
      { key: "release", done: releases > 0 },
      { key: "shipped", done: released > 0 },
      { key: "campaign", done: !!p.launchCampaignId },
    ],
  };
  const current = stageIndex(p.stage);
  const latestTask = (subjectType: string) => aiTasks.find((t) => t.subjectType === subjectType) ?? null;
  const steps = JOURNEY.map((s) => {
    const idx = s.stages.map((x) => stageIndex(x));
    const status = current > Math.max(...idx) ? "done" : current >= Math.min(...idx) ? "current" : "upcoming";
    const c = checks[s.key];
    const ai = s.ai.kind === "doc" ? latestTask(docSubject(s.ai.doc)) : s.ai.kind === "apply" ? latestTask("product") : null;
    return { key: s.key, stages: [...s.stages], status, checks: c, progress: Math.round((c.filter((x) => x.done).length / c.length) * 100), ai: s.ai, aiTask: ai };
  });
  return {
    steps,
    overall: Math.round((steps.reduce((sum, s) => sum + (s.status === "done" ? 100 : s.progress), 0) / (steps.length * 100)) * 100),
    plan,
    stats: { competitors, validations, personas, docs: docs.length, features, tasks, done, releases, released },
  };
}

/** Launch readiness from real records: what must be true before launching, each item done or not. */
export async function launchReadiness(ctx: RequestContext, organizationId: string, companyId: string, productId: string) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const p = await productOf(db(), organizationId, companyId, productId);
  const [docs, featureStatus, openTasks, release, kb, gate] = await Promise.all([
    db().productDoc.findMany({ where: { productId, companyId, kind: { in: ["PRD", "QA_PLAN", "RELEASE_PLAN"] } }, select: { kind: true, status: true } }),
    db().productFeature.groupBy({ by: ["status"], where: { productId, companyId, archivedAt: null, status: { not: "CANCELLED" } }, _count: { _all: true } }),
    p.developmentProjectId ? db().workTask.count({ where: { companyId, projectId: p.developmentProjectId, archivedAt: null, status: { notIn: ["DONE", "CANCELLED"] } } }) : Promise.resolve(null),
    db().productRelease.findFirst({ where: { productId, companyId }, orderBy: { createdAt: "desc" }, select: { version: true, status: true, notes: true, releaseDate: true } }),
    db().supportKbArticle.count({ where: { companyId, tags: { has: p.name.toLowerCase().slice(0, 40) } } }),
    db().productStageGate.findUnique({ where: { productId_stage: { productId, stage: "QA" } }, select: { approvedAt: true } }),
  ]);
  const total = featureStatus.reduce((s, x) => s + x._count._all, 0);
  const shipped = featureStatus.find((x) => x.status === "SHIPPED")?._count._all ?? 0;
  const approved = (k: ProductDocKind) => docs.some((d) => d.kind === k && d.status === "APPROVED");
  const items = [
    { key: "prdApproved", done: approved("PRD") },
    { key: "qaPlanApproved", done: approved("QA_PLAN") },
    { key: "qaGate", done: !!gate?.approvedAt },
    { key: "featuresShipped", done: total > 0 && shipped === total },
    { key: "noOpenTasks", done: openTasks === 0 },
    { key: "releaseNotes", done: !!release?.notes },
    { key: "releaseDated", done: !!release?.releaseDate },
    { key: "releasePlan", done: approved("RELEASE_PLAN") },
    { key: "supportArticle", done: kb > 0 },
    { key: "campaign", done: !!p.launchCampaignId },
  ];
  return { items, score: Math.round((items.filter((i) => i.done).length / items.length) * 100), features: { total, shipped }, openTasks, release };
}

const DAY_MS = 86_400_000;

/** Component names from the architecture document's "Components" section (bullets or sub-headings), if it is structured. */
export function parseComponents(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^#{1,4}\s.*(component|komponent|组件|مكون|कंपोनेंट)/i.test(l));
  if (start < 0) return [];
  const level = (lines[start]!.match(/^#+/) ?? ["#"])[0].length;
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    const h = l.match(/^(#+)\s+(.*)$/);
    if (h && h[1]!.length <= level) break;
    const name = h ? h[2] : (l.match(/^\s{0,2}[-*]\s+(?:\*\*)?([^*:—–(]+)/) ?? [])[1];
    const clean = name?.replace(/[`*_]/g, "").trim();
    if (clean && clean.length <= 60) out.push(clean);
    if (out.length >= 14) break;
  }
  return [...new Set(out)];
}

/** Data for the Product Studio visualizations (all from real rows). */
export async function productVisuals(ctx: RequestContext, organizationId: string, companyId: string, productId: string, now = new Date()) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const p = await productOf(db(), organizationId, companyId, productId);
  const since = new Date(now.getTime() - 12 * 7 * DAY_MS);
  const [arch, initiatives, features, ideas, releases, done, created] = await Promise.all([
    db().productDoc.findUnique({ where: { productId_kind: { productId, kind: "ARCHITECTURE" } }, select: { companyId: true, versions: { orderBy: { version: "desc" }, take: 1, select: { content: true } } } }),
    db().productInitiative.findMany({ where: { productId, companyId, archivedAt: null }, select: { id: true, title: true }, take: 12 }),
    db().productFeature.findMany({ where: { productId, companyId, archivedAt: null, status: { not: "CANCELLED" } }, select: { id: true, title: true, status: true, initiativeId: true }, take: 40, orderBy: [{ riceScore: { sort: "desc", nulls: "last" } }] }),
    db().productIdea.count({ where: { productId, companyId } }),
    db().productRelease.findMany({ where: { productId, companyId }, select: { id: true, version: true, status: true, publishedAt: true }, take: 30, orderBy: { createdAt: "asc" } }),
    p.developmentProjectId ? db().workTask.findMany({ where: { companyId, projectId: p.developmentProjectId, completedAt: { gte: since } }, select: { completedAt: true }, take: 5000 }) : [],
    p.developmentProjectId ? db().workTask.findMany({ where: { companyId, projectId: p.developmentProjectId, createdAt: { gte: since } }, select: { createdAt: true }, take: 5000 }) : [],
  ]);
  const components = arch && arch.companyId === companyId && arch.versions[0] ? parseComponents(arch.versions[0].content) : [];
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const from = new Date(since.getTime() + i * 7 * DAY_MS);
    const to = new Date(from.getTime() + 7 * DAY_MS);
    const inW = (d: Date | null) => !!d && d >= from && d < to;
    return { start: from.toISOString().slice(0, 10), done: done.filter((t) => inW(t.completedAt)).length, created: created.filter((t) => inW(t.createdAt)).length };
  });
  const count = (s: string) => features.filter((f) => f.status === s).length;
  return {
    name: p.name,
    components,
    initiatives,
    features,
    funnel: [
      { key: "ideas", value: ideas },
      { key: "features", value: features.length },
      { key: "planned", value: count("PLANNED") + count("IN_PROGRESS") + count("SHIPPED") },
      { key: "building", value: count("IN_PROGRESS") + count("SHIPPED") },
      { key: "shipped", value: count("SHIPPED") },
    ],
    weeks,
    hasProject: !!p.developmentProjectId,
    releases: releases.map((r) => ({ id: r.id, version: r.version, step: r.publishedAt ? 3 : r.status === "RELEASED" ? 2 : r.status === "IN_PROGRESS" ? 1 : 0 })),
  };
}
