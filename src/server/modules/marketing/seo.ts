import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { actorId, authorize, isUuid } from "./common";
import { analyzeHtml, AuditFetchError, fetchPage } from "./seo-audit";

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, ""))
  .pipe(z.string().min(3).max(253).regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/));

export const projectInput = z.object({ name: z.string().trim().min(1).max(120), domain, notes: z.string().trim().max(5000).optional() });
export const updateProjectInput = projectInput.partial();
export const keywordInput = z.object({
  keyword: z.string().trim().toLowerCase().min(1).max(200),
  searchVolume: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  difficulty: z.number().int().min(0).max(100).nullable().optional(),
  intent: z.enum(["informational", "navigational", "commercial", "transactional"]).nullable().optional(),
  targetUrl: z.string().trim().url().max(2000).optional().or(z.literal("")),
  tracked: z.boolean().default(false),
});
export const keywordsBody = z.union([z.object({ keywords: z.array(keywordInput).min(1).max(200) }), keywordInput]);
export const updateKeywordInput = keywordInput.omit({ keyword: true }).partial();
export const rankInput = z.object({ rank: z.number().int().min(1).max(1000).nullable(), url: z.string().trim().url().max(2000).optional().or(z.literal("")) });
export const competitorInput = z.object({ domain, notes: z.string().trim().max(5000).optional() });
export const updateCompetitorInput = z.object({ notes: z.string().trim().max(5000) });
export const auditInput = z.object({ url: z.string().trim().url().max(2000) });

export async function listProjects(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  return db().seoProject.findMany({
    where: { organizationId, companyId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { _count: { select: { keywords: true, competitors: true, audits: true } }, audits: { orderBy: { createdAt: "desc" }, take: 1, select: { score: true, createdAt: true } } },
  });
}

export async function getProject(ctx: RequestContext, organizationId: string, companyId: string, projectId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  if (!isUuid(projectId)) throw notFound("SEO project");
  const p = await db().seoProject.findFirst({
    where: { id: projectId, organizationId, companyId },
    include: {
      keywords: { orderBy: [{ tracked: "desc" }, { keyword: "asc" }], take: 500, include: { ranks: { orderBy: { capturedAt: "desc" }, take: 8 } } },
      competitors: { orderBy: { domain: "asc" } },
      audits: { orderBy: { createdAt: "desc" }, take: 30, select: { id: true, url: true, status: true, score: true, error: true, createdAt: true, httpStatus: true, issues: true } },
    },
  });
  if (!p) throw notFound("SEO project");
  return p;
}

/** SEO report figures for a project: rank distribution, movers, audit health. */
export function seoReport(p: Awaited<ReturnType<typeof getProject>>) {
  const tracked = p.keywords.filter((k) => k.tracked);
  const ranked = tracked.filter((k) => k.currentRank != null);
  const bucket = (lo: number, hi: number) => ranked.filter((k) => k.currentRank! >= lo && k.currentRank! <= hi).length;
  const movers = ranked
    .filter((k) => k.previousRank != null && k.previousRank !== k.currentRank)
    .map((k) => ({ keyword: k.keyword, from: k.previousRank!, to: k.currentRank!, delta: k.previousRank! - k.currentRank! }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 10);
  const completed = p.audits.filter((a) => a.status === "COMPLETED" && a.score != null);
  const avgRank = ranked.length ? Math.round((ranked.reduce((s, k) => s + k.currentRank!, 0) / ranked.length) * 10) / 10 : null;
  return {
    trackedCount: tracked.length,
    rankedCount: ranked.length,
    top3: bucket(1, 3),
    top10: bucket(1, 10),
    top100: bucket(1, 100),
    avgRank,
    movers,
    latestScore: completed[0]?.score ?? null,
    avgScore: completed.length ? Math.round(completed.reduce((s, a) => s + a.score!, 0) / completed.length) : null,
  };
}

export async function getAudit(ctx: RequestContext, organizationId: string, companyId: string, auditId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  if (!isUuid(auditId)) throw notFound("Audit");
  const a = await db().seoAudit.findFirst({ where: { id: auditId, organizationId, companyId }, include: { project: { select: { id: true, name: true, domain: true } } } });
  if (!a) throw notFound("Audit");
  return a;
}

async function loadProject(tx: Tx, organizationId: string, companyId: string, projectId: string) {
  if (!isUuid(projectId)) throw notFound("SEO project");
  const p = await tx.seoProject.findFirst({ where: { id: projectId, organizationId, companyId, archivedAt: null } });
  if (!p) throw notFound("SEO project");
  return p;
}

export async function createProject(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof projectInput>) {
  const input = projectInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const p = await tx.seoProject.create({ data: { organizationId, companyId, name: input.name, domain: input.domain, notes: input.notes || null, createdById: actorId(ctx, organizationId) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.seo_project.created", resourceType: "seo_project", resourceId: p.id, newValue: { name: p.name, domain: p.domain } });
    return p;
  });
}

export async function updateProject(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof updateProjectInput>) {
  const input = updateProjectInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    await loadProject(tx, organizationId, companyId, projectId);
    const p = await tx.seoProject.update({ where: { id: projectId }, data: { ...input, ...(input.notes !== undefined ? { notes: input.notes || null } : {}) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.seo_project.updated", resourceType: "seo_project", resourceId: p.id, newValue: input });
    return p;
  });
}

export async function archiveProject(ctx: RequestContext, organizationId: string, companyId: string, projectId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    await loadProject(tx, organizationId, companyId, projectId);
    await tx.seoProject.update({ where: { id: projectId }, data: { archivedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.seo_project.archived", resourceType: "seo_project", resourceId: projectId });
    return { ok: true };
  });
}

/** Add keywords (manual or AI suggestions); existing ones are skipped. */
export async function addKeywords(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof keywordInput>[], source: "manual" | "ai" = "manual") {
  const inputs = z.array(keywordInput).min(1).max(200).parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    await loadProject(tx, organizationId, companyId, projectId);
    const { count } = await tx.seoKeyword.createMany({
      data: inputs.map((k) => ({
        organizationId,
        companyId,
        projectId,
        keyword: k.keyword,
        searchVolume: k.searchVolume ?? null,
        difficulty: k.difficulty ?? null,
        intent: k.intent ?? null,
        targetUrl: k.targetUrl || null,
        tracked: k.tracked,
        source,
      })),
      skipDuplicates: true,
    });
    if (!count && inputs.length === 1) throw conflict("Keyword already exists", { reason: "marketing_keyword_exists" });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.seo_keyword.added", resourceType: "seo_project", resourceId: projectId, newValue: { count, source } });
    return { added: count };
  });
}

async function loadKeyword(tx: Tx, organizationId: string, companyId: string, keywordId: string) {
  if (!isUuid(keywordId)) throw notFound("Keyword");
  const k = await tx.seoKeyword.findFirst({ where: { id: keywordId, organizationId, companyId } });
  if (!k) throw notFound("Keyword");
  return k;
}

export async function updateKeyword(ctx: RequestContext, organizationId: string, companyId: string, keywordId: string, raw: z.input<typeof updateKeywordInput>) {
  const input = updateKeywordInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    await loadKeyword(tx, organizationId, companyId, keywordId);
    const data: Prisma.SeoKeywordUpdateInput = { ...input, ...(input.targetUrl !== undefined ? { targetUrl: input.targetUrl || null } : {}) };
    const k = await tx.seoKeyword.update({ where: { id: keywordId }, data });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.seo_keyword.updated", resourceType: "seo_keyword", resourceId: keywordId, newValue: input });
    return k;
  });
}

export async function deleteKeyword(ctx: RequestContext, organizationId: string, companyId: string, keywordId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const k = await loadKeyword(tx, organizationId, companyId, keywordId);
    await tx.seoKeyword.delete({ where: { id: k.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.seo_keyword.deleted", resourceType: "seo_keyword", resourceId: k.id, oldValue: { keyword: k.keyword } });
    return { ok: true };
  });
}

/** Record a rank check (manual entry or a provider bridge). */
export async function recordRank(ctx: RequestContext, organizationId: string, companyId: string, keywordId: string, raw: z.input<typeof rankInput>, source = "manual") {
  const input = rankInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const k = await loadKeyword(tx, organizationId, companyId, keywordId);
    const now = new Date();
    await tx.seoRankSnapshot.create({ data: { organizationId, companyId, keywordId, rank: input.rank, url: input.url || null, source, capturedAt: now } });
    await tx.seoKeyword.update({ where: { id: k.id }, data: { previousRank: k.currentRank, currentRank: input.rank, rankedAt: now, tracked: true } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.seo_rank.recorded", resourceType: "seo_keyword", resourceId: k.id, newValue: { rank: input.rank, source } });
    return { ok: true };
  });
}

export async function addCompetitor(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof competitorInput>) {
  const input = competitorInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    await loadProject(tx, organizationId, companyId, projectId);
    if (await tx.seoCompetitor.findFirst({ where: { projectId, domain: input.domain }, select: { id: true } })) throw conflict("Competitor already added", { reason: "marketing_competitor_exists" });
    const c = await tx.seoCompetitor.create({ data: { organizationId, companyId, projectId, domain: input.domain, notes: input.notes || null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.seo_competitor.added", resourceType: "seo_project", resourceId: projectId, newValue: { domain: c.domain } });
    return c;
  });
}

export async function updateCompetitor(ctx: RequestContext, organizationId: string, companyId: string, competitorId: string, raw: z.input<typeof updateCompetitorInput>) {
  const input = updateCompetitorInput.parse(raw);
  if (!isUuid(competitorId)) throw notFound("Competitor");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.seoCompetitor.updateMany({ where: { id: competitorId, organizationId, companyId }, data: { notes: input.notes || null } });
    if (!count) throw notFound("Competitor");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.seo_competitor.updated", resourceType: "seo_competitor", resourceId: competitorId });
    return { ok: true };
  });
}

export async function deleteCompetitor(ctx: RequestContext, organizationId: string, companyId: string, competitorId: string) {
  if (!isUuid(competitorId)) throw notFound("Competitor");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.seoCompetitor.deleteMany({ where: { id: competitorId, organizationId, companyId } });
    if (!count) throw notFound("Competitor");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.seo_competitor.deleted", resourceType: "seo_competitor", resourceId: competitorId });
    return { ok: true };
  });
}

/** Fetch the URL server-side (SSRF-guarded) and store the on-page analysis — or the failure reason. */
export async function runAudit(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof auditInput>) {
  const input = auditInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const project = await loadProject(db(), organizationId, companyId, projectId);
  let data: Omit<Prisma.SeoAuditUncheckedCreateInput, "organizationId" | "companyId" | "projectId" | "createdById" | "url">;
  try {
    const page = await fetchPage(input.url);
    const a = analyzeHtml(page.html, page.finalUrl, page.headers);
    const issues = page.status >= 400 ? [{ code: "http_error", severity: "error" as const, value: page.status }, ...a.issues] : a.issues;
    data = { status: "COMPLETED", httpStatus: page.status, ...a, issues: issues as unknown as Prisma.InputJsonValue };
  } catch (err) {
    data = { status: "FAILED", error: err instanceof AuditFetchError ? err.reason : "fetch_failed", issues: [] };
  }
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const audit = await tx.seoAudit.create({ data: { organizationId, companyId, projectId: project.id, url: input.url, createdById: actorId(ctx, organizationId), ...data } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.seo_audit.run", resourceType: "seo_audit", resourceId: audit.id, newValue: { url: input.url, status: audit.status, score: audit.score } });
    return audit;
  });
}
