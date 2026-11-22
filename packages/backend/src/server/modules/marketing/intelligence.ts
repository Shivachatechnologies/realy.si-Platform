import { z } from "zod";
import type { MarketingSocialProvider } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask } from "@/server/modules/agents/service";
import { actorId, authorize, day, isUuid, toDay } from "./common";
import { computeKpis, type Range } from "./analytics";

// ───────────── Unified analytics ─────────────

/** Cross-platform marketing analytics from real data in the range. */
export async function unifiedAnalytics(organizationId: string, companyId: string, range: Range) {
  const span = { gte: range.from, lt: range.to };
  const [kpis, social, byPlatform, email, ads, search, blog] = await Promise.all([
    computeKpis(organizationId, companyId, range),
    db().marketingSocialPostTarget.aggregate({ where: { organizationId, companyId, status: "PUBLISHED", publishedAt: span }, _sum: { impressions: true, reach: true, likes: true, comments: true, shares: true, clicks: true }, _count: { _all: true } }),
    db().marketingSocialPostTarget.findMany({ where: { organizationId, companyId, status: "PUBLISHED", publishedAt: span }, select: { impressions: true, likes: true, comments: true, shares: true, clicks: true, account: { select: { provider: true } } }, take: 5000 }),
    Promise.all([
      db().marketingEmailSend.count({ where: { organizationId, companyId, status: "SENT", createdAt: span } }),
      db().marketingEmailSend.count({ where: { organizationId, companyId, status: "SENT", createdAt: span, openedAt: { not: null } } }),
      db().marketingEmailSend.count({ where: { organizationId, companyId, status: "SENT", createdAt: span, clickedAt: { not: null } } }),
      db().marketingEmailSend.count({ where: { organizationId, companyId, createdAt: span, bouncedAt: { not: null } } }),
    ]),
    db().marketingAdMetric.aggregate({ where: { organizationId, companyId, date: span }, _sum: { spendMinor: true, impressions: true, clicks: true, conversions: true, revenueMinor: true } }),
    db().seoSearchMetric.aggregate({ where: { organizationId, companyId, date: span }, _sum: { clicks: true, impressions: true } }),
    db().marketingContent.aggregate({ where: { organizationId, companyId, blogPublic: true }, _sum: { views: true } }),
  ]);
  const platforms = new Map<MarketingSocialProvider, { posts: number; impressions: number; engagement: number }>();
  for (const t of byPlatform) {
    const p = platforms.get(t.account.provider) ?? { posts: 0, impressions: 0, engagement: 0 };
    p.posts++;
    p.impressions += t.impressions ?? 0;
    p.engagement += (t.likes ?? 0) + (t.comments ?? 0) + (t.shares ?? 0) + (t.clicks ?? 0);
    platforms.set(t.account.provider, p);
  }
  const s = social._sum;
  const engagement = (s.likes ?? 0) + (s.comments ?? 0) + (s.shares ?? 0) + (s.clicks ?? 0);
  const adSpend = ads._sum.spendMinor ?? 0n;
  const adRevenue = ads._sum.revenueMinor ?? 0n;
  const totalSpend = kpis.spendMinor + adSpend;
  return {
    kpis,
    social: { posts: social._count._all, impressions: s.impressions ?? 0, reach: s.reach ?? 0, engagement, clicks: s.clicks ?? 0, engagementRate: s.impressions ? engagement / s.impressions : null },
    platforms: [...platforms.entries()].map(([provider, v]) => ({ provider, ...v, engagementRate: v.impressions ? v.engagement / v.impressions : null })).sort((a, b) => b.engagement - a.engagement),
    email: { sent: email[0], opened: email[1], clicked: email[2], bounced: email[3], openRate: email[0] ? email[1] / email[0] : null, clickRate: email[0] ? email[2] / email[0] : null },
    ads: { spendMinor: adSpend, impressions: ads._sum.impressions ?? 0, clicks: ads._sum.clicks ?? 0, conversions: ads._sum.conversions ?? 0, revenueMinor: adRevenue, roas: adSpend > 0n ? Number(adRevenue) / Number(adSpend) : null },
    search: { clicks: search._sum.clicks ?? 0, impressions: search._sum.impressions ?? 0 },
    blogViews: blog._sum.views ?? 0,
    totalSpendMinor: totalSpend,
    cacMinor: kpis.newCustomers ? totalSpend / BigInt(kpis.newCustomers) : null,
    roi: totalSpend > 0n ? (Number(kpis.revenueMinor + adRevenue - totalSpend) / Number(totalSpend)) * 100 : null,
  };
}

export async function getUnifiedAnalytics(ctx: RequestContext, organizationId: string, companyId: string, range: Range) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  return unifiedAnalytics(organizationId, companyId, range);
}

export const askInput = z.object({ question: z.string().trim().min(3).max(2000) });

/** "Ask the Marketing Analyst": an agent task with the marketing read tools. */
export async function askAnalyst(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof askInput>) {
  const { question } = askInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.read");
  return createTask(ctx, organizationId, companyId, {
    profile: "marketing_analyst",
    title: `Analyst: ${question}`.slice(0, 200),
    instructions: `Answer this question about the company's marketing using only data from your tools (read_marketing_analytics, read_marketing_kpis, read_campaigns, read_campaign, read_ad_performance, read_autopilot, read_marketing_learnings, read_seo_project). Show the numbers you used and end with 1-3 concrete next steps.\n\nQuestion: ${question}`,
  });
}

// ───────────── Goals ─────────────

export const GOAL_METRICS = ["leads", "impressions", "engagement", "clicks", "posts", "emails_sent", "spend", "traffic", "customers"] as const;
export const goalInput = z.object({ name: z.string().trim().min(1).max(160), metric: z.enum(GOAL_METRICS), target: z.number().positive().max(1e12), startDate: day, endDate: day });

export async function listGoals(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const goals = await db().marketingGoal.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { endDate: "asc" }, take: 100 });
  return Promise.all(
    goals.map(async (g) => {
      const a = await unifiedAnalytics(organizationId, companyId, { from: g.startDate, to: new Date(g.endDate.getTime() + 86_400_000) });
      const current: Record<(typeof GOAL_METRICS)[number], number> = {
        leads: a.kpis.leadsCreated,
        impressions: a.social.impressions + a.ads.impressions,
        engagement: a.social.engagement,
        clicks: a.social.clicks + a.ads.clicks + a.email.clicked,
        posts: a.social.posts,
        emails_sent: a.email.sent,
        spend: Number(a.totalSpendMinor) / 100,
        traffic: a.search.clicks + a.blogViews,
        customers: a.kpis.newCustomers,
      };
      const value = current[g.metric as (typeof GOAL_METRICS)[number]] ?? 0;
      return { ...g, current: value, progress: g.target ? Math.min(999, (value / g.target) * 100) : 0 };
    }),
  );
}

export async function createGoal(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof goalInput>) {
  const input = goalInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const g = await tx.marketingGoal.create({ data: { organizationId, companyId, name: input.name, metric: input.metric, target: input.target, startDate: toDay(input.startDate)!, endDate: toDay(input.endDate)!, createdById: actorId(ctx, organizationId) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.goal.created", resourceType: "marketing_goal", resourceId: g.id, newValue: input });
    return g;
  });
}

export async function archiveGoal(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Goal");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingGoal.updateMany({ where: { id, organizationId, companyId, archivedAt: null }, data: { archivedAt: new Date() } });
    if (!count) throw notFound("Goal");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.goal.archived", resourceType: "marketing_goal", resourceId: id });
    return { ok: true };
  });
}

// ───────────── Hashtag sets ─────────────

export const hashtagSetInput = z.object({ name: z.string().trim().min(1).max(80), platform: z.string().max(20).optional().or(z.literal("")), tags: z.array(z.string().trim().regex(/^#?[\p{L}\p{N}_]{1,60}$/u)).min(1).max(40) });

export async function listHashtagSets(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  return db().marketingHashtagSet.findMany({ where: { organizationId, companyId }, orderBy: { name: "asc" }, take: 200 });
}

export async function saveHashtagSet(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof hashtagSetInput>) {
  const input = hashtagSetInput.parse(raw);
  const tags = [...new Set(input.tags.map((t) => (t.startsWith("#") ? t : `#${t}`)))];
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const s = await tx.marketingHashtagSet.upsert({
      where: { companyId_name: { companyId, name: input.name } },
      create: { organizationId, companyId, name: input.name, platform: input.platform || null, tags, createdById: actorId(ctx, organizationId) },
      update: { platform: input.platform || null, tags },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.hashtag_set.saved", resourceType: "marketing_hashtag_set", resourceId: s.id, newValue: { name: s.name, tags: tags.length } });
    return s;
  });
}

export async function deleteHashtagSet(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Hashtag set");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingHashtagSet.deleteMany({ where: { id, organizationId, companyId } });
    if (!count) throw notFound("Hashtag set");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.hashtag_set.deleted", resourceType: "marketing_hashtag_set", resourceId: id });
    return { ok: true };
  });
}

// ───────────── AI workforce activity ─────────────

const MARKETING_SUBJECTS = ["marketing_research_report", "marketing_plan", "marketing_optimization_review", "marketing_content", "marketing_campaign", "seo_project", "marketing_autopilot_item", "marketing_journey", "marketing_ad_campaign", "marketing_engagement", "marketing_influencer"];
export async function marketingAiActivity(organizationId: string, companyId: string, take = 10) {
  return db().agentTask.findMany({
    where: { organizationId, companyId, OR: [{ subjectType: { in: MARKETING_SUBJECTS } }, { profile: { in: ["cmo", "growth_manager", "content_writer", "seo_specialist", "social_media_manager", "campaign_strategist", "marketing_analyst", "creative_designer", "video_producer", "content_strategist", "paid_ads_specialist"] } }] },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, title: true, status: true, profile: true, createdAt: true },
  });
}

// ───────────── "Help me do this" ─────────────

export const HELP_PAGES = ["start", "overview", "intelligence", "strategy", "calendar", "optimize", "autopilot", "studio", "content", "social", "community", "seo", "blog", "email", "ads", "influencers", "analytics", "campaigns", "audience", "forms", "automation", "brand"] as const;
const HELP_PROFILE: Record<(typeof HELP_PAGES)[number], string> = {
  start: "cmo",
  overview: "cmo",
  intelligence: "marketing_analyst",
  strategy: "cmo",
  calendar: "social_media_manager",
  optimize: "marketing_analyst",
  autopilot: "content_strategist",
  studio: "creative_designer",
  content: "content_writer",
  social: "social_media_manager",
  community: "social_media_manager",
  seo: "seo_specialist",
  blog: "seo_specialist",
  email: "growth_manager",
  ads: "paid_ads_specialist",
  influencers: "growth_manager",
  analytics: "marketing_analyst",
  campaigns: "campaign_strategist",
  audience: "growth_manager",
  forms: "growth_manager",
  automation: "growth_manager",
  brand: "content_strategist",
};
export const helpInput = z.object({ page: z.enum(HELP_PAGES), question: z.string().trim().max(1000).optional(), context: z.string().trim().max(3000).optional() });

/** Creates an AI task with the page's context; its progress and result show on the page. */
export async function requestHelp(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof helpInput>) {
  const input = helpInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.read");
  return createTask(ctx, organizationId, companyId, {
    profile: HELP_PROFILE[input.page] as never,
    title: `Help · ${input.page}${input.question ? `: ${input.question}` : ""}`.slice(0, 200),
    instructions: `A person with no marketing background is on the "${input.page}" screen of the Marketing Studio and asked for help${input.question ? `: "${input.question}"` : " doing what this screen is for"}.
${input.context ? `What they see: ${input.context}\n` : ""}Use your read tools to look at their real data first. Then explain in plain words (no jargon, or explain it) what to do next, as 3-5 numbered steps that refer to the buttons on this screen, and recommend one concrete first action. If something needs a connection (social account, image provider, email provider), say exactly which one. Never claim you changed or published anything unless a tool did it.`,
  });
}

export async function listHelpTasks(organizationId: string, companyId: string, page: string, take = 3) {
  return db().agentTask.findMany({ where: { organizationId, companyId, title: { startsWith: `Help · ${page}` } }, orderBy: { createdAt: "desc" }, take, select: { id: true, title: true, status: true, output: true, createdAt: true, errorCode: true } });
}
