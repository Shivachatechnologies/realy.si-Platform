import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { MarketingResearchKind, MarketingResearchStatus } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask } from "@/server/modules/agents/service";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { can } from "@/server/modules/rbac/service";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { webSearch, type WebResult } from "@/server/modules/integrations/services/research";
import { actorId, authorize, isUuid, PAGE_SIZE } from "./common";
import { brandContextFor } from "./brand";
import { extractJson } from "./ai";

/**
 * Marketing Intelligence: research reports built from real web sources (Integrations research service: Tavily → Exa →
 * SerpApi) and synthesized by an AI task that may only use those sources. Nothing is invented: without a provider the
 * report is saved as CREDENTIAL_REQUIRED with no findings; without AI it keeps the sources only.
 */

export const RESEARCH_KINDS = ["MARKET", "COMPETITOR", "AUDIENCE", "TRENDS", "KEYWORDS", "BRAND"] as const satisfies readonly MarketingResearchKind[];
export const RESEARCH_STATUSES = ["RESEARCHING", "SYNTHESIZING", "READY", "SOURCES_ONLY", "CREDENTIAL_REQUIRED", "FAILED"] as const satisfies readonly MarketingResearchStatus[];
export const RESEARCH_SUBJECT = "marketing_research_report";

export const researchInput = z.object({
  kind: z.enum(RESEARCH_KINDS),
  subject: z.string().trim().min(2).max(200),
  region: z.string().trim().max(80).optional().or(z.literal("")),
  competitors: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

const PROFILE: Record<MarketingResearchKind, string> = {
  MARKET: "marketing_analyst",
  COMPETITOR: "marketing_analyst",
  AUDIENCE: "growth_manager",
  TRENDS: "content_strategist",
  KEYWORDS: "seo_specialist",
  BRAND: "content_strategist",
};

/** Search queries per research kind (sent to the company's research provider). */
export function researchQueries(kind: MarketingResearchKind, subject: string, region?: string | null, competitors: string[] = []): string[] {
  const where = region ? ` ${region}` : "";
  const year = new Date().getUTCFullYear();
  switch (kind) {
    case "MARKET":
      return [`${subject} market size growth${where} ${year}`, `${subject} industry trends challenges${where}`, `${subject} customer buying behaviour${where}`, `${subject} pricing benchmarks${where}`];
    case "COMPETITOR": {
      const names = competitors.length ? competitors : [subject];
      return [...names.slice(0, 4).map((n) => `${n} pricing positioning reviews`), `${subject} alternatives comparison${where}`].slice(0, 5);
    }
    case "AUDIENCE":
      return [`${subject} customer pain points`, `${subject} buyer persona needs${where}`, `what ${subject} customers complain about forum reviews`, `where ${subject} buyers research purchases`];
    case "TRENDS":
      return [`${subject} trends ${year}${where}`, `${subject} latest news this month`, `${subject} emerging topics social media`];
    case "KEYWORDS":
      return [`${subject}`, `best ${subject}${where}`, `${subject} vs`, `how to choose ${subject}`, `${subject} questions people ask`];
    case "BRAND":
      return [`"${subject}" reviews`, `"${subject}" news`, `"${subject}" vs competitors`];
  }
}

/** JSON the synthesis task must return, per kind. */
function outputSpec(kind: MarketingResearchKind): string {
  const base = `"summary": string (3-5 sentences), "insights": [{ "title": string, "detail": string, "sources": number[] }], "opportunities": [{ "title": string, "detail": string }], "risks": [{ "title": string, "detail": string }]`;
  const extra: Record<MarketingResearchKind, string> = {
    MARKET: `, "segments": [{ "name": string, "detail": string }]`,
    COMPETITOR: `, "competitors": [{ "name": string, "url": string | null, "positioning": string, "strengths": string[], "weaknesses": string[], "pricing": string | null, "sources": number[] }]`,
    AUDIENCE: `, "personas": [{ "name": string, "goals": string[], "pains": string[], "channels": string[], "objections": string[] }]`,
    TRENDS: `, "trends": [{ "topic": string, "why": string, "contentIdea": string, "sources": number[] }]`,
    KEYWORDS: `, "keywords": [{ "keyword": string, "intent": "informational" | "navigational" | "commercial" | "transactional", "rationale": string }]`,
    BRAND: `, "mentions": [{ "title": string, "sentiment": "positive" | "neutral" | "negative", "url": string, "sources": number[] }]`,
  };
  return `{ ${base}${extra[kind]} }`;
}

const findingsSchema = z
  .object({
    summary: z.string().max(4000).optional(),
    insights: z.array(z.object({ title: z.string().max(300), detail: z.string().max(2000).default(""), sources: z.array(z.number().int()).max(20).default([]) })).max(30).default([]),
    opportunities: z.array(z.object({ title: z.string().max(300), detail: z.string().max(2000).default("") })).max(20).default([]),
    risks: z.array(z.object({ title: z.string().max(300), detail: z.string().max(2000).default("") })).max(20).default([]),
    segments: z.array(z.object({ name: z.string().max(200), detail: z.string().max(1000).default("") })).max(20).optional(),
    competitors: z
      .array(z.object({ name: z.string().max(200), url: z.string().max(500).nullable().optional(), positioning: z.string().max(1000).default(""), strengths: z.array(z.string().max(300)).max(10).default([]), weaknesses: z.array(z.string().max(300)).max(10).default([]), pricing: z.string().max(300).nullable().optional(), sources: z.array(z.number().int()).max(20).default([]) }))
      .max(12)
      .optional(),
    personas: z.array(z.object({ name: z.string().max(200), goals: z.array(z.string().max(300)).max(10).default([]), pains: z.array(z.string().max(300)).max(10).default([]), channels: z.array(z.string().max(100)).max(10).default([]), objections: z.array(z.string().max(300)).max(10).default([]) })).max(8).optional(),
    trends: z.array(z.object({ topic: z.string().max(300), why: z.string().max(1000).default(""), contentIdea: z.string().max(1000).default(""), sources: z.array(z.number().int()).max(20).default([]) })).max(20).optional(),
    keywords: z.array(z.object({ keyword: z.string().trim().min(1).max(200), intent: z.string().max(20).optional(), rationale: z.string().max(500).default("") })).max(60).optional(),
    mentions: z.array(z.object({ title: z.string().max(300), sentiment: z.string().max(20).default("neutral"), url: z.string().max(500).default(""), sources: z.array(z.number().int()).max(20).default([]) })).max(30).optional(),
  })
  .passthrough();
export type ResearchFindings = z.infer<typeof findingsSchema>;

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
  query: string;
}

export const parseSources = (v: Prisma.JsonValue): ResearchSource[] => (Array.isArray(v) ? (v as unknown as ResearchSource[]).filter((s) => s && typeof s.url === "string") : []);
export const parseFindings = (v: Prisma.JsonValue | null): ResearchFindings | null => {
  if (!v) return null;
  const r = findingsSchema.safeParse(v);
  return r.success ? r.data : null;
};

export interface ResearchFilters {
  kind?: MarketingResearchKind;
  page: number;
}

export async function listResearchReports(ctx: RequestContext, organizationId: string, companyId: string, f: ResearchFilters = { page: 1 }) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const where = { organizationId, companyId, archivedAt: null, ...(f.kind ? { kind: f.kind } : {}) };
  const [rows, total, byKind] = await Promise.all([
    db().marketingResearchReport.findMany({ where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE, omit: { sources: true } }),
    db().marketingResearchReport.count({ where }),
    db().marketingResearchReport.groupBy({ by: ["kind"], where: { organizationId, companyId, archivedAt: null }, _count: { _all: true } }),
  ]);
  return { data: rows, total, byKind: Object.fromEntries(byKind.map((k) => [k.kind, k._count._all])) as Partial<Record<MarketingResearchKind, number>> };
}

export async function getResearchReport(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  if (!isUuid(id)) throw notFound("Research report");
  const r = await db().marketingResearchReport.findFirst({ where: { id, organizationId, companyId, archivedAt: null } });
  if (!r) throw notFound("Research report");
  return r;
}

/** Reports usable as grounding elsewhere (plans, AI tools): READY or SOURCES_ONLY. */
export async function usableResearch(organizationId: string, companyId: string, ids?: string[], take = 8) {
  return db().marketingResearchReport.findMany({
    where: { organizationId, companyId, archivedAt: null, status: { in: ["READY", "SOURCES_ONLY"] }, ...(ids ? { id: { in: ids.filter(isUuid) } } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, kind: true, title: true, subject: true, summary: true, findings: true, sources: true, status: true, createdAt: true },
  });
}

/** Compact text of a report for prompts: summary, insights and numbered source URLs. */
export function researchBrief(r: { kind: string; title: string; summary: string | null; findings: Prisma.JsonValue | null; sources: Prisma.JsonValue }, maxSources = 8): string {
  const f = parseFindings(r.findings);
  const src = parseSources(r.sources).slice(0, maxSources);
  return [
    `## ${r.kind} research: ${r.title}`,
    r.summary ? `Summary: ${r.summary}` : null,
    ...(f?.insights ?? []).slice(0, 6).map((i) => `- ${i.title}: ${i.detail}`),
    ...(f?.opportunities ?? []).slice(0, 4).map((o) => `- Opportunity: ${o.title}`),
    src.length ? `Sources: ${src.map((s, i) => `[${i + 1}] ${s.url}`).join(" ")}` : null,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 3000);
}

/**
 * Run a research report now: queries go to the connected research provider (in parallel), the sources are saved, and
 * — when AI is configured and the viewer may run agents — an AI task synthesizes findings from those sources only.
 */
export async function createResearchReport(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof researchInput>) {
  const input = researchInput.parse(raw);
  const chain = await authorize(ctx, organizationId, companyId, "marketing.manage");
  const queries = researchQueries(input.kind, input.subject, input.region || null, input.competitors);
  const title = `${input.subject}${input.region ? ` · ${input.region}` : ""}`.slice(0, 200);
  const report = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const r = await tx.marketingResearchReport.create({
      data: { organizationId, companyId, kind: input.kind, title, subject: input.subject, inputs: { region: input.region || null, competitors: input.competitors, notes: input.notes || null }, queries, createdById: actorId(ctx, organizationId) },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.research.started", resourceType: "marketing_research_report", resourceId: r.id, newValue: { kind: input.kind, subject: input.subject, queries: queries.length } });
    return r;
  });

  const results = await Promise.all(queries.map((q) => webSearch(organizationId, companyId, q, { maxResults: 6 }).then((res) => ({ q, res }))));
  const ok = results.filter((x) => x.res.ok);
  if (!ok.length) {
    const first = results[0]?.res;
    const notConnected = results.every((x) => !x.res.ok && x.res.code === "not_connected");
    const status: MarketingResearchStatus = notConnected ? "CREDENTIAL_REQUIRED" : "FAILED";
    const error = notConnected ? "not_connected" : first && !first.ok ? first.error.slice(0, 500) : "research_failed";
    return db().marketingResearchReport.update({ where: { id: report.id }, data: { status, error } });
  }
  const seen = new Set<string>();
  const sources: ResearchSource[] = [];
  let provider: string | null = null;
  for (const { q, res } of ok) {
    if (!res.ok) continue;
    provider ??= res.providerId;
    for (const s of res.data.results as WebResult[]) {
      const key = s.url.replace(/[#?].*$/, "").replace(/\/$/, "");
      if (seen.has(key) || sources.length >= 30) continue;
      seen.add(key);
      sources.push({ title: s.title, url: s.url, snippet: s.snippet, publishedAt: s.publishedAt, query: q });
    }
  }
  if (!sources.length) return db().marketingResearchReport.update({ where: { id: report.id }, data: { status: "FAILED", provider, error: "no_results" } });

  const mayRunAi = aiConfigured() && (await can(ctx, "agents.run", chain));
  if (!mayRunAi) return db().marketingResearchReport.update({ where: { id: report.id }, data: { status: "SOURCES_ONLY", provider, sources: sources as unknown as Prisma.InputJsonValue } });

  const digest = sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}${s.publishedAt ? ` (${s.publishedAt})` : ""}\n${s.snippet}`).join("\n\n").slice(0, 14_000);
  const brand = await brandContextFor(companyId);
  try {
    const task = await createTask(ctx, organizationId, companyId, {
      profile: PROFILE[input.kind] as never,
      title: `Research (${input.kind.toLowerCase()}): ${title}`.slice(0, 200),
      instructions: `Write a ${input.kind.toLowerCase()} research report about "${input.subject}"${input.region ? ` for ${input.region}` : ""}${input.competitors.length ? ` (competitors: ${input.competitors.join(", ")})` : ""}.
Use ONLY the numbered web sources below (and the company's own documents for context about the company). Every insight must cite the source numbers it is based on in "sources". Do not invent numbers, market sizes, prices, search volumes or quotes — if the sources do not say it, leave it out or say it is unknown.
${input.notes ? `Direction from the person: ${input.notes}\n` : ""}
Return ONLY valid JSON of this shape (no prose before or after):
${outputSpec(input.kind)}

Sources:
${digest}
${brand ? `\nCompany brand context:\n${brand}` : ""}`.slice(0, 20_000),
      subject: { type: RESEARCH_SUBJECT, id: report.id },
    });
    return db().marketingResearchReport.update({ where: { id: report.id }, data: { status: "SYNTHESIZING", provider, sources: sources as unknown as Prisma.InputJsonValue, taskId: task.id } });
  } catch (err) {
    logger.warn({ reportId: report.id, err: String(err) }, "marketing research synthesis not started");
    return db().marketingResearchReport.update({ where: { id: report.id }, data: { status: "SOURCES_ONLY", provider, sources: sources as unknown as Prisma.InputJsonValue, error: "ai_not_started" } });
  }
}

/** Re-run a report (same inputs) — e.g. after connecting a research provider. */
export async function rerunResearchReport(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  const r = await getResearchReport(ctx, organizationId, companyId, id);
  if (r.status === "RESEARCHING" || r.status === "SYNTHESIZING") throw conflict("The report is still running", { reason: "marketing_research_running" });
  const inputs = (r.inputs ?? {}) as { region?: string | null; competitors?: string[]; notes?: string | null };
  return createResearchReport(ctx, organizationId, companyId, { kind: r.kind, subject: r.subject, region: inputs.region ?? "", competitors: inputs.competitors ?? [], notes: inputs.notes ?? "" });
}

export async function archiveResearchReport(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Research report");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingResearchReport.updateMany({ where: { id, organizationId, companyId, archivedAt: null }, data: { archivedAt: new Date() } });
    if (!count) throw notFound("Research report");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.research.archived", resourceType: "marketing_research_report", resourceId: id });
    return { ok: true };
  });
}

/** Store the synthesis of a finished task on its report (worker: agent.task.completed / failed, and the sweep). */
export async function ingestResearchTask(reportId: string, companyId: string, taskId: string): Promise<void> {
  const report = await db().marketingResearchReport.findFirst({ where: { id: reportId, companyId, taskId, status: "SYNTHESIZING" } });
  if (!report) return;
  const task = await db().agentTask.findUnique({ where: { id: taskId }, select: { status: true, output: true, errorCode: true } });
  if (!task || task.status === "QUEUED" || task.status === "RUNNING") return;
  if (task.status !== "COMPLETED" || !task.output?.trim()) {
    await db().marketingResearchReport.update({ where: { id: report.id }, data: { status: "SOURCES_ONLY", error: `ai_${(task.errorCode ?? task.status).toLowerCase()}`.slice(0, 200) } });
    return;
  }
  const parsed = findingsSchema.safeParse(extractJson(task.output));
  const data: Prisma.MarketingResearchReportUpdateInput = parsed.success
    ? { status: "READY", summary: parsed.data.summary?.slice(0, 4000) ?? null, findings: parsed.data as Prisma.InputJsonValue, error: null }
    : // Unparseable: keep the AI's text as the summary (it is still the real output), with no structured findings.
      { status: "READY", summary: task.output.trim().slice(0, 4000), findings: undefined, error: "ai_output_unstructured" };
  await transaction(async (tx) => {
    await tx.marketingResearchReport.update({ where: { id: report.id }, data });
    const users = await usersWithPermission(tx, report.organizationId, report.companyId, "marketing.manage");
    const ids = [...new Set([report.createdById, ...users])].slice(0, 25);
    await notifyUsers(tx, report.organizationId, ids, "marketing.research_ready", { companyId: report.companyId, title: report.title, href: `/marketing/intelligence/${report.id}` });
  });
}

/** Sweep for reports whose task finished without an event reaching us. */
export async function sweepResearchReports(): Promise<number> {
  const stale = await db().marketingResearchReport.findMany({ where: { status: "SYNTHESIZING", updatedAt: { lt: new Date(Date.now() - 2 * 60_000) }, taskId: { not: null } }, select: { id: true, companyId: true, taskId: true }, take: 50 });
  for (const r of stale) await ingestResearchTask(r.id, r.companyId, r.taskId!);
  // Requests that died mid-research (process restart) are marked failed so the page never spins forever.
  const dead = await db().marketingResearchReport.updateMany({ where: { status: "RESEARCHING", updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } }, data: { status: "FAILED", error: "interrupted" } });
  return stale.length + dead.count;
}

/** The first connected research provider (for the "credential required" state on the page), or null. */
export async function researchConnection(organizationId: string, companyId: string): Promise<string | null> {
  const { usableConnection } = await import("@/server/modules/integrations/services/common");
  const { RESEARCH_PROVIDERS } = await import("@/server/modules/integrations/services/research");
  for (const p of RESEARCH_PROVIDERS) if (await usableConnection(organizationId, companyId, p)) return p;
  return null;
}

export const researchToSeoInput = z.object({ projectId: z.string().uuid() });
const INTENTS = ["informational", "navigational", "commercial", "transactional"] as const;

/** KEYWORDS report → keywords on an SEO project (no volumes or difficulty are invented: those stay empty). */
export async function researchKeywordsToSeo(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof researchToSeoInput>) {
  const { projectId } = researchToSeoInput.parse(raw);
  const r = await getResearchReport(ctx, organizationId, companyId, id);
  const keywords = parseFindings(r.findings)?.keywords ?? [];
  if (!keywords.length) throw conflict("This report has no keywords", { reason: "marketing_research_no_keywords" });
  const { addKeywords } = await import("./seo");
  return addKeywords(
    ctx,
    organizationId,
    companyId,
    projectId,
    keywords.slice(0, 200).map((k) => ({ keyword: k.keyword, intent: (INTENTS as readonly string[]).includes(k.intent ?? "") ? (k.intent as (typeof INTENTS)[number]) : null, tracked: false })),
    "ai",
  );
}

export const researchToContentInput = z.object({
  section: z.enum(["insights", "opportunities", "trends"]),
  index: z.number().int().min(0).max(60),
  type: z.enum(["BLOG", "SEO_ARTICLE", "LINKEDIN", "X", "INSTAGRAM", "NEWSLETTER", "VIDEO_SCRIPT", "THOUGHT_LEADERSHIP"]).default("BLOG"),
});

/** A finding → a content draft whose brief carries the finding and its source URLs (goes through editorial review). */
export async function researchToContent(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof researchToContentInput>) {
  const input = researchToContentInput.parse(raw);
  const r = await getResearchReport(ctx, organizationId, companyId, id);
  const f = parseFindings(r.findings);
  const sources = parseSources(r.sources);
  const item =
    input.section === "trends"
      ? (() => {
          const x = f?.trends?.[input.index];
          return x ? { title: x.topic, detail: `${x.why}\n\nContent idea: ${x.contentIdea}`, refs: x.sources } : null;
        })()
      : input.section === "insights"
        ? (() => {
            const x = f?.insights[input.index];
            return x ? { title: x.title, detail: x.detail, refs: x.sources } : null;
          })()
        : (() => {
            const x = f?.opportunities[input.index];
            return x ? { title: x.title, detail: x.detail, refs: [] as number[] } : null;
          })();
  if (!item) throw notFound("Finding");
  const refs = item.refs.map((n) => sources[n - 1]).filter((s): s is ResearchSource => !!s);
  const { createContent } = await import("./content");
  return createContent(ctx, organizationId, companyId, {
    type: input.type,
    title: item.title.slice(0, 250),
    brief: `From research "${r.title}" (${r.kind.toLowerCase()}):\n${item.detail}${refs.length ? `\n\nSources:\n${refs.map((s) => `- ${s.title}: ${s.url}`).join("\n")}` : ""}`.slice(0, 5000),
  });
}
