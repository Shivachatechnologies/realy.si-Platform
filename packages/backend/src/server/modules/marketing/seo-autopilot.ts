import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { env } from "@/server/core/env";
import { AppError, conflict, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask, getTask } from "@/server/modules/agents/service";
import { actorId, authorize, isUuid, uuid } from "./common";
import { extractJson } from "./ai";
import { brandContextFor } from "./brand";
import { ARTICLE_TYPES, createContent, markContentPublished } from "./content";
import { connectionAccounts, getMarketingConnection, isUsable } from "./connections-bridge";
import { bodyToHtml, CMS_PROVIDERS, publishToCms, searchConsoleQuery, verifyUrl, type CmsProvider } from "./providers/cms";
import { ProviderError } from "./providers/http";
import { assetMedia } from "./assets";
import { upsertRecommendation } from "./recommendations";

export const PUBLISH_TARGETS = ["realy", ...CMS_PROVIDERS] as const;
export const seoActionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cluster") }),
  z.object({ action: z.literal("apply_clusters"), taskId: z.string().uuid() }),
  z.object({ action: z.literal("article"), clusterId: uuid.optional(), keyword: z.string().trim().min(2).max(200).optional() }),
  z.object({ action: z.literal("sync_search_console") }),
]);
export const articleApplyInput = z.object({ taskId: z.string().uuid() });
export const publishInput = z.object({ target: z.enum(PUBLISH_TARGETS), publishAt: z.string().datetime({ offset: true }).optional().or(z.literal("")) });

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "post";

async function project(organizationId: string, companyId: string, projectId: string) {
  if (!isUuid(projectId)) throw notFound("SEO project");
  const p = await db().seoProject.findFirst({ where: { id: projectId, organizationId, companyId, archivedAt: null }, include: { keywords: { select: { id: true, keyword: true, intent: true, clusterId: true, targetUrl: true, currentRank: true } } } });
  if (!p) throw notFound("SEO project");
  return p;
}

export async function seoAutopilotData(ctx: RequestContext, organizationId: string, companyId: string, projectId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const p = await project(organizationId, companyId, projectId);
  const since = new Date(Date.now() - 28 * 86_400_000);
  const prev = new Date(Date.now() - 56 * 86_400_000);
  const [clusters, articles, pages, queries, prevPages, gscConnected] = await Promise.all([
    db().seoTopicCluster.findMany({ where: { projectId }, orderBy: { name: "asc" } }),
    db().marketingContent.findMany({ where: { companyId, seoProjectId: projectId, archivedAt: null }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, title: true, status: true, clusterId: true, publishedUrl: true, publishedAt: true, keywords: true } }),
    db().seoSearchMetric.groupBy({ by: ["page"], where: { projectId, date: { gte: since } }, _sum: { clicks: true, impressions: true }, _avg: { position: true }, orderBy: { _sum: { clicks: "desc" } }, take: 25 }),
    db().seoSearchMetric.groupBy({ by: ["query"], where: { projectId, date: { gte: since } }, _sum: { clicks: true, impressions: true }, _avg: { position: true }, orderBy: { _sum: { impressions: "desc" } }, take: 50 }),
    db().seoSearchMetric.groupBy({ by: ["page"], where: { projectId, date: { gte: prev, lt: since } }, _sum: { clicks: true } }),
    getMarketingConnection(organizationId, companyId, "google_search_console").then(isUsable),
  ]);
  const prevBy = new Map(prevPages.map((r) => [r.page, r._sum.clicks ?? 0]));
  const covered = new Set(articles.flatMap((a) => a.keywords.map((k) => k.toLowerCase())));
  // Content gaps: keywords with no page and no article; queries with impressions but poor position.
  const gaps = [
    ...p.keywords.filter((k) => !k.targetUrl && !covered.has(k.keyword.toLowerCase())).map((k) => ({ kind: "keyword" as const, term: k.keyword, detail: k.intent ?? null })),
    ...queries.filter((q) => (q._avg.position ?? 0) > 10 && (q._sum.impressions ?? 0) >= 50 && !covered.has(q.query.toLowerCase())).map((q) => ({ kind: "query" as const, term: q.query, detail: `${q._sum.impressions} impressions, avg position ${(q._avg.position ?? 0).toFixed(1)}` })),
  ].slice(0, 40);
  const refresh = [
    ...pages.filter((pg) => (prevBy.get(pg.page) ?? 0) > 10 && (pg._sum.clicks ?? 0) < (prevBy.get(pg.page) ?? 0) * 0.7).map((pg) => ({ url: pg.page, reason: `Clicks fell from ${prevBy.get(pg.page)} to ${pg._sum.clicks ?? 0} (28 days)` })),
    ...articles.filter((a) => a.status === "PUBLISHED" && a.publishedAt && Date.now() - a.publishedAt.getTime() > 180 * 86_400_000).map((a) => ({ url: a.publishedUrl ?? a.title, reason: "Published more than 6 months ago" })),
  ].slice(0, 20);
  return { project: p, clusters, articles, pages, queries, gaps, refresh, gscConnected };
}

export async function seoAction(ctx: RequestContext, organizationId: string, companyId: string, projectId: string, raw: z.input<typeof seoActionInput>) {
  const input = seoActionInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const p = await project(organizationId, companyId, projectId);
  if (input.action === "cluster") {
    if (!p.keywords.length) throw invalid("Add keywords first", { reason: "marketing_seo_no_keywords" });
    return createTask(ctx, organizationId, companyId, {
      profile: "seo_specialist",
      title: `Keyword clusters: ${p.domain}`,
      instructions: `Group these keywords for ${p.domain} into topic clusters (a pillar page plus supporting articles). Each keyword belongs to exactly one cluster. Determine the dominant search intent per cluster. Do not add keywords that are not in the list.\nKeywords:\n${p.keywords.map((k) => k.keyword).join("\n").slice(0, 6000)}\n\nReturn ONLY a JSON object, no prose: {"clusters":[{"name": string, "pillarKeyword": string, "intent": "informational"|"navigational"|"commercial"|"transactional", "keywords": string[], "brief": string (2-3 sentences: pillar page angle)}]}`,
      subject: { type: "seo_project", id: p.id },
    });
  }
  if (input.action === "apply_clusters") {
    const task = await getTask(ctx, organizationId, companyId, input.taskId);
    if (task.subjectType !== "seo_project" || task.subjectId !== p.id || task.status !== "COMPLETED" || !task.output) throw conflict("The AI task has not completed", { reason: "marketing_ai_not_completed" });
    const parsed = z
      .object({ clusters: z.array(z.object({ name: z.string().trim().min(1).max(120), pillarKeyword: z.string().trim().min(1).max(200), intent: z.string().max(40).optional(), keywords: z.array(z.string()).max(500), brief: z.string().max(3000).optional() })).min(1).max(50) })
      .safeParse(extractJson(task.output));
    if (!parsed.success) throw invalid("The AI output could not be read", { reason: "marketing_ai_output_unparseable" });
    return transaction(async (tx) => {
      let assigned = 0;
      for (const c of parsed.data.clusters) {
        const cl = await tx.seoTopicCluster.upsert({
          where: { projectId_name: { projectId: p.id, name: c.name } },
          create: { organizationId, companyId, projectId: p.id, name: c.name, pillarKeyword: c.pillarKeyword, intent: c.intent ?? null, brief: c.brief ?? null },
          update: { pillarKeyword: c.pillarKeyword, intent: c.intent ?? null, brief: c.brief ?? null },
        });
        const ids = p.keywords.filter((k) => c.keywords.some((x) => x.trim().toLowerCase() === k.keyword.toLowerCase())).map((k) => k.id);
        if (ids.length) assigned += (await tx.seoKeyword.updateMany({ where: { id: { in: ids } }, data: { clusterId: cl.id, ...(c.intent ? { intent: c.intent } : {}) } })).count;
      }
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.seo.clusters_applied", resourceType: "seo_project", resourceId: p.id, newValue: { clusters: parsed.data.clusters.length, assigned } });
      return { clusters: parsed.data.clusters.length, assigned };
    });
  }
  if (input.action === "article") {
    const cluster = input.clusterId ? await db().seoTopicCluster.findFirst({ where: { id: input.clusterId, projectId: p.id } }) : null;
    if (input.clusterId && !cluster) throw notFound("Cluster");
    const keyword = input.keyword ?? cluster?.pillarKeyword;
    if (!keyword) throw invalid("Choose a cluster or keyword", { reason: "marketing_brief_topic_required" });
    const related = cluster ? p.keywords.filter((k) => k.clusterId === cluster.id).map((k) => k.keyword) : [];
    const content = await createContent(ctx, organizationId, companyId, { type: "SEO_ARTICLE", title: keyword.slice(0, 250), brief: cluster?.brief ?? `SEO article targeting "${keyword}"`, keywords: [keyword, ...related].slice(0, 30) });
    await db().marketingContent.update({ where: { id: content.id }, data: { seoProjectId: p.id, clusterId: cluster?.id ?? null } });
    const task = await createTask(ctx, organizationId, companyId, {
      profile: "seo_specialist",
      title: `SEO article: ${keyword}`.slice(0, 200),
      instructions: `Write a complete SEO article for ${p.domain} targeting "${keyword}"${related.length ? ` and related keywords: ${related.slice(0, 20).join(", ")}` : ""}. First outline the search intent${cluster?.intent ? ` (${cluster.intent})` : ""}, then write 1200-2000 words in Markdown with H2/H3 headings, an introduction answering the query, practical sections, and an FAQ of 3-5 questions. Ground product facts in the company's documents; never invent statistics.\n\nReturn ONLY a JSON object, no prose: {"title": string, "body": string (Markdown, without the FAQ), "metaTitle": string (30-60 chars), "metaDescription": string (70-160 chars), "slug": string, "faq": [{"q": string, "a": string}]}\n\n${await brandContextFor(companyId)}`.slice(0, 8000),
      subject: { type: "marketing_content", id: content.id },
    });
    return { contentId: content.id, taskId: task.id };
  }
  return { synced: await syncSearchConsole(p.id) };
}

/** Internal link suggestions from the company's published content (keyword / title overlap). */
async function internalLinks(companyId: string, contentId: string, text: string) {
  const published = await db().marketingContent.findMany({ where: { companyId, status: "PUBLISHED", id: { not: contentId }, publishedUrl: { not: null }, archivedAt: null }, select: { title: true, publishedUrl: true, keywords: true }, take: 300 });
  const lower = text.toLowerCase();
  return published
    .map((c) => {
      const terms = [...c.keywords, c.title].map((k) => k.toLowerCase()).filter((k) => k.length > 3);
      const hit = terms.find((k) => lower.includes(k));
      return hit ? { title: c.title, url: c.publishedUrl!, anchor: hit } : null;
    })
    .filter((x): x is { title: string; url: string; anchor: string } => !!x)
    .slice(0, 10);
}

/** Apply a completed SEO article task: body, meta, JSON-LD schema and internal link suggestions. */
export async function applyArticle(ctx: RequestContext, organizationId: string, companyId: string, contentId: string, raw: z.input<typeof articleApplyInput>) {
  const { taskId } = articleApplyInput.parse(raw);
  const task = await getTask(ctx, organizationId, companyId, taskId);
  if (task.subjectType !== "marketing_content" || task.subjectId !== contentId || task.status !== "COMPLETED" || !task.output) throw conflict("The AI task has not completed", { reason: "marketing_ai_not_completed" });
  const parsed = z
    .object({ title: z.string().min(1).max(250), body: z.string().min(50).max(100_000), metaTitle: z.string().max(120).optional(), metaDescription: z.string().max(320).optional(), slug: z.string().max(200).optional(), faq: z.array(z.object({ q: z.string().max(500), a: z.string().max(3000) })).max(10).default([]) })
    .safeParse(extractJson(task.output));
  if (!parsed.success) throw invalid("The AI output could not be read", { reason: "marketing_ai_output_unparseable" });
  const d = parsed.data;
  const company = await db().company.findUnique({ where: { id: companyId }, select: { name: true } });
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "BlogPosting", headline: d.title.slice(0, 110), description: d.metaDescription ?? undefined, author: { "@type": "Organization", name: company?.name ?? "" }, publisher: { "@type": "Organization", name: company?.name ?? "" } },
      ...(d.faq.length ? [{ "@type": "FAQPage", mainEntity: d.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }] : []),
    ],
  };
  const body = d.faq.length ? `${d.body.trim()}\n\n## FAQ\n\n${d.faq.map((f) => `### ${f.q}\n\n${f.a}`).join("\n\n")}` : d.body.trim();
  const links = await internalLinks(companyId, contentId, body);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const c = await tx.marketingContent.findFirst({ where: { id: contentId, organizationId, companyId, archivedAt: null } });
    if (!c) throw notFound("Content");
    if (c.status === "PUBLISHED") throw conflict("Published content cannot be edited", { reason: "marketing_content_published" });
    const version = c.version + 1;
    await tx.marketingContentVersion.create({ data: { organizationId, companyId, contentId: c.id, version, title: d.title, body, source: "ai_draft", createdById: actorId(ctx, organizationId) } });
    const updated = await tx.marketingContent.update({
      where: { id: c.id },
      data: { title: d.title, body, version, metaTitle: d.metaTitle ?? null, metaDescription: d.metaDescription ?? null, slug: slugify(d.slug || d.title), schemaMarkup: schema as Prisma.InputJsonValue, internalLinks: links, ...(c.status === "APPROVED" ? { status: "DRAFT", approvedAt: null, approvedById: null } : {}) },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.content.article_applied", resourceType: "marketing_content", resourceId: c.id, newValue: { taskId, links: links.length } });
    return updated;
  });
}

export const blogUrl = (companyId: string, slug: string) => `${env().APP_URL.replace(/\/$/, "")}/blog/${companyId}/${slug}`;

/**
 * Publish approved long-form content to a CMS (wordpress / webflow / shopify) or the Realy-hosted blog. Recorded as
 * published only with the provider's id; the public URL is verified. A future `publishAt` schedules it.
 */
export async function publishContent(ctx: RequestContext, organizationId: string, companyId: string, contentId: string, raw: z.input<typeof publishInput>) {
  const input = publishInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  if (!isUuid(contentId)) throw notFound("Content");
  const c = await db().marketingContent.findFirst({ where: { id: contentId, organizationId, companyId, archivedAt: null } });
  if (!c) throw notFound("Content");
  if (!ARTICLE_TYPES.has(c.type) && c.type !== "LANDING_PAGE" && c.type !== "WEBSITE_COPY") throw invalid("Only articles and pages can be published to a blog or CMS", { reason: "marketing_cms_type" });
  if (!["APPROVED", "SCHEDULED", "PUBLISHED"].includes(c.status)) throw conflict("Only approved content can be published", { reason: "marketing_content_not_approved" });
  const at = input.publishAt ? new Date(input.publishAt) : null;
  if (at && at.getTime() > Date.now() + 60_000 && input.target !== "wordpress" && input.target !== "shopify") {
    const pub = await db().marketingCmsPublication.create({ data: { organizationId, companyId, contentId, provider: input.target, status: "SCHEDULED", scheduledAt: at, createdById: actorId(ctx, organizationId) } });
    await db().marketingContent.update({ where: { id: contentId }, data: { status: "SCHEDULED", scheduledAt: at } });
    return pub;
  }
  return runPublication(ctx, c.id, input.target, at, actorId(ctx, organizationId));
}

async function runPublication(ctx: RequestContext, contentId: string, target: (typeof PUBLISH_TARGETS)[number], at: Date | null, by: string, existingId?: string) {
  const c = await db().marketingContent.findUniqueOrThrow({ where: { id: contentId } });
  const base = { organizationId: c.organizationId, companyId: c.companyId, contentId, provider: target, createdById: by };
  const save = (data: Partial<Prisma.MarketingCmsPublicationUncheckedCreateInput>) =>
    existingId ? db().marketingCmsPublication.update({ where: { id: existingId }, data }) : db().marketingCmsPublication.create({ data: { ...base, status: "FAILED", ...data } });
  if (target === "realy") {
    const slug = c.slug || slugify(c.title);
    const clash = await db().marketingContent.findFirst({ where: { companyId: c.companyId, slug, blogPublic: true, id: { not: c.id } }, select: { id: true } });
    const finalSlug = clash ? `${slug}-${c.id.slice(-6)}` : slug;
    const url = blogUrl(c.companyId, finalSlug);
    await transaction(async (tx) => {
      await tx.marketingContent.update({ where: { id: c.id }, data: { slug: finalSlug, blogPublic: true } });
      if (c.status !== "PUBLISHED") await markContentPublished(tx, ctx, c, url);
    });
    return save({ status: "PUBLISHED", externalId: c.id, url, publishedAt: new Date(), verifiedAt: new Date(), error: null });
  }
  const conn = await getMarketingConnection(c.organizationId, c.companyId, target);
  if (!isUsable(conn)) {
    if (!existingId) throw new AppError("not_configured", `${target} is not connected`, { reason: "marketing_cms_not_connected", provider: target });
    return save({ status: "FAILED", error: "not_connected" });
  }
  const featured = c.featuredAssetId ? await assetMedia(c.companyId, c.featuredAssetId).catch(() => null) : null;
  try {
    const r = await publishToCms(target as CmsProvider, conn, {
      title: c.title,
      html: bodyToHtml(c.body),
      excerpt: c.metaDescription,
      slug: c.slug,
      metaTitle: c.metaTitle,
      metaDescription: c.metaDescription,
      categories: c.categories,
      tags: c.tags.length ? c.tags : c.keywords.slice(0, 10),
      author: c.authorName,
      publishAt: at,
      featuredImage: featured,
    });
    const verified = r.scheduled ? false : await verifyUrl(r.url);
    const pub = await save({ status: r.scheduled ? "SCHEDULED" : "PUBLISHED", externalId: r.externalId, url: r.url, scheduledAt: r.scheduled ? at : null, publishedAt: r.scheduled ? null : new Date(), verifiedAt: verified ? new Date() : null, error: r.scheduled || verified || !r.url ? null : "url_not_reachable_yet" });
    await transaction(async (tx) => {
      if (r.scheduled) await tx.marketingContent.update({ where: { id: c.id }, data: { status: "SCHEDULED", scheduledAt: at } });
      else if (c.status !== "PUBLISHED") await markContentPublished(tx, ctx, c, r.url);
      await writeAudit(tx, ctx, { category: "TENANT", organizationId: c.organizationId, action: "marketing.content.cms_published", resourceType: "marketing_content", resourceId: c.id, newValue: { provider: target, externalId: r.externalId, url: r.url, scheduled: r.scheduled } });
    });
    return pub;
  } catch (err) {
    const error = err instanceof ProviderError ? `${err.reason}${err.message !== err.reason ? `: ${err.message.slice(0, 300)}` : ""}` : "provider_error";
    await save({ status: "FAILED", error });
    if (!existingId) throw conflict(`Publishing failed: ${error}`, { reason: "marketing_cms_failed", detail: error });
    return null;
  }
}

/** Worker: due scheduled publications (Realy blog, Webflow) and verification of CMS-scheduled ones. */
export async function processScheduledPublications(): Promise<number> {
  const due = await db().marketingCmsPublication.findMany({ where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } }, take: 20 });
  let n = 0;
  for (const p of due) {
    try {
      if (p.externalId && (p.provider === "wordpress" || p.provider === "shopify")) {
        // The CMS published it at the scheduled time; verify the URL and mark the content published.
        if (await verifyUrl(p.url)) {
          const c = await db().marketingContent.findUniqueOrThrow({ where: { id: p.contentId } });
          await db().marketingCmsPublication.update({ where: { id: p.id }, data: { status: "PUBLISHED", publishedAt: new Date(), verifiedAt: new Date() } });
          if (c.status !== "PUBLISHED") await transaction((tx) => markContentPublished(tx, systemContext(), c, p.url));
          n++;
        }
        continue;
      }
      await runPublication(systemContext(), p.contentId, p.provider as (typeof PUBLISH_TARGETS)[number], null, p.createdById, p.id);
      n++;
    } catch (err) {
      logger.warn({ publicationId: p.id, err: String(err) }, "scheduled publication failed");
    }
  }
  return n;
}

/** Search Console sync (clicks / impressions / position per page + query, last 28 days). */
export async function syncSearchConsole(projectId: string): Promise<number> {
  const p = await db().seoProject.findUniqueOrThrow({ where: { id: projectId } });
  const conn = await getMarketingConnection(p.organizationId, p.companyId, "google_search_console");
  if (!isUsable(conn)) throw new AppError("not_configured", "Google Search Console is not connected", { reason: "marketing_gsc_not_connected" });
  // The connection's verified property for this project's domain (Integrations lists them as sub-accounts), else the configured one.
  const host = p.domain.replace(/^www\./, "").toLowerCase();
  const property = connectionAccounts(conn).find((a) => a.id === `sc-domain:${host}` || a.id.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").toLowerCase() === host)?.id;
  const siteUrl = property ?? ((typeof conn.config.siteUrl === "string" && conn.config.siteUrl) || `sc-domain:${host}`);
  const end = new Date(Date.now() - 2 * 86_400_000);
  const start = new Date(end.getTime() - 28 * 86_400_000);
  const rows = await searchConsoleQuery(conn, siteUrl, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
  await db().$transaction([
    db().seoSearchMetric.deleteMany({ where: { projectId, date: { gte: new Date(`${start.toISOString().slice(0, 10)}T00:00:00Z`) } } }),
    db().seoSearchMetric.createMany({ data: rows.map((r) => ({ organizationId: p.organizationId, companyId: p.companyId, projectId, date: new Date(`${r.date}T00:00:00Z`), page: r.page, query: r.query, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })), skipDuplicates: true }),
  ]);
  // Rank tracking from real positions for tracked keywords.
  const keywords = await db().seoKeyword.findMany({ where: { projectId }, select: { id: true, keyword: true, currentRank: true } });
  for (const k of keywords) {
    const hits = rows.filter((r) => r.query.toLowerCase() === k.keyword.toLowerCase());
    if (!hits.length) continue;
    const best = hits.reduce((a, b) => (a.position < b.position ? a : b));
    const rank = Math.max(1, Math.round(best.position));
    await db().$transaction([
      db().seoKeyword.update({ where: { id: k.id }, data: { previousRank: k.currentRank, currentRank: rank, rankedAt: new Date() } }),
      db().seoRankSnapshot.create({ data: { organizationId: p.organizationId, companyId: p.companyId, keywordId: k.id, rank, url: best.page, source: "search_console" } }),
    ]);
  }
  return rows.length;
}

/** Worker: daily Search Console sync for projects whose company has the connection. */
export async function syncAllSearchConsole(): Promise<number> {
  const projects = await db().seoProject.findMany({ where: { archivedAt: null }, select: { id: true, organizationId: true, companyId: true } });
  let n = 0;
  for (const p of projects) {
    const last = await db().seoSearchMetric.findFirst({ where: { projectId: p.id }, orderBy: { date: "desc" }, select: { date: true } });
    if (last && Date.now() - last.date.getTime() < 3 * 86_400_000) continue;
    if (!isUsable(await getMarketingConnection(p.organizationId, p.companyId, "google_search_console"))) continue;
    try {
      n += await syncSearchConsole(p.id);
    } catch (err) {
      logger.warn({ projectId: p.id, err: String(err) }, "search console sync failed");
      await upsertRecommendation(p.organizationId, p.companyId, { dedupeKey: `gsc:${p.id}:error`, title: "Search Console sync failed", detail: err instanceof Error ? err.message.slice(0, 500) : undefined, priority: "medium", href: `/marketing/seo/${p.id}` });
    }
  }
  return n;
}
