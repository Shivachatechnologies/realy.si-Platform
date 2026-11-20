import { z } from "zod";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { db } from "@/server/core/db";
import { attribution, campaignAnalytics, computeKpis, parseRange } from "./analytics";
import { CAMPAIGN_STATUSES, createCampaign, listCampaigns } from "./campaigns";
import { CONTENT_STATUSES, CONTENT_TYPES, createContent, listContent } from "./content";
import { createPost, listAccounts } from "./social";
import { getProject, seoReport } from "./seo";
import { authorize, CHANNELS } from "./common";
import { brandContext, getBrandKit } from "./brand";
import { getUnifiedAnalytics } from "./intelligence";
import { listAutopilots, listItems } from "./autopilot";
import { listLearnings } from "./learning";
import { adPerformanceText, changeAdBudget, changeAdStatus, createAdCampaignDraft, launchAdCampaign } from "./ads";
import { generateCreative, PRESET_KEYS } from "./assets";
import { sendOutreach, sendReply } from "./community";
import { createResearchReport, listResearchReports, parseFindings, parseSources, RESEARCH_KINDS } from "./research-reports";
import { listPlans, planChannels, planObjectives } from "./plans";

const money = (m: bigint | null, currency: string) => (m == null ? "n/a" : `${(Number(m) / 100).toFixed(2)} ${currency}`);
const pct = (v: number | null) => (v == null ? "n/a" : `${v.toFixed(1)}%`);
const companyCurrency = async (companyId: string) => (await db().company.findUnique({ where: { id: companyId }, select: { baseCurrency: true } }))?.baseCurrency ?? "USD";

/** AI tools of the marketing module, registered in src/server/modules/tools/modules.ts. Use `def` from tools/define. */
export const MARKETING_TOOLS: Record<string, ToolDefinition> = {
  read_brand_kit: def({
    name: "read_brand_kit",
    version: 1,
    description: "Returns the company's brand kit: brand name, tagline, voice & tone, messaging pillars, preferred and banned words, audience personas, colors, logos and fonts. Read it before writing any marketing content.",
    input: z.object({}).strict(),
    modelSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    permissions: ["marketing.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 10_000,
    summarize: () => "Read the brand kit",
    async execute(_input, { ctx, organizationId, companyId }) {
      const kit = await getBrandKit(ctx, organizationId, companyId);
      if (!kit) return { content: "The company has no brand kit yet. Use a neutral, professional voice and the company's documents." };
      const visual = [
        kit.colors.length ? `Colors: ${kit.colors.map((c) => `${c.name} ${c.hex}`).join(", ")}` : null,
        kit.headingFont || kit.bodyFont ? `Fonts: headings ${kit.headingFont ?? "n/a"}, body ${kit.bodyFont ?? "n/a"}` : null,
        kit.logoUrl ? `Logo: ${kit.logoUrl}` : null,
      ].filter(Boolean);
      return { content: [brandContext(kit), ...visual].join("\n"), records: [`marketing_brand_kit:${kit.id}`] };
    },
  }),

  read_campaigns: def({
    name: "read_campaigns",
    version: 1,
    description: "Lists the company's marketing campaigns (name, UTM code, status, channels, budget, spend, dates), newest first. Optional status filter.",
    input: z.object({ status: z.enum(CAMPAIGN_STATUSES).optional() }).strict(),
    modelSchema: { type: "object", properties: { status: { type: "string", enum: [...CAMPAIGN_STATUSES] } }, required: [], additionalProperties: false },
    permissions: ["marketing.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read marketing campaigns",
    async execute(input, { ctx, organizationId, companyId }) {
      const { data } = await listCampaigns(ctx, organizationId, companyId, { status: input.status, page: 1 });
      if (!data.length) return { content: "No marketing campaigns.", count: 0 };
      const content = data
        .map(
          (c) =>
            `- ${c.name} [${c.status}] code ${c.code} (id ${c.id}); channels: ${c.channels.join(", ") || "none"}; budget ${money(c.budgetMinor, c.currency)}, spent ${money(c.spentMinor, c.currency)}${c.startDate ? `; ${c.startDate.toISOString().slice(0, 10)} → ${c.endDate?.toISOString().slice(0, 10) ?? "open"}` : ""}${c.objective ? `; objective: ${c.objective}` : ""}`,
        )
        .join("\n");
      return { content, count: data.length, records: data.map((c) => `marketing_campaign:${c.id}`) };
    },
  }),

  read_campaign: def({
    name: "read_campaign",
    version: 1,
    description: "Returns one campaign's details and real performance: goals, spend by channel, attributed leads and won deals (by UTM code), revenue, ROI, CAC, conversion, emails, social engagement and content status.",
    input: z.object({ campaignId: z.string().uuid() }).strict(),
    modelSchema: { type: "object", properties: { campaignId: { type: "string", description: "Campaign id (uuid)" } }, required: ["campaignId"], additionalProperties: false },
    permissions: ["marketing.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read campaign performance",
    async execute({ campaignId }, { ctx, organizationId, companyId }) {
      const a = await campaignAnalytics(ctx, organizationId, companyId, campaignId);
      const c = a.campaign;
      const cur = c.currency;
      const lines = [
        `Campaign ${c.name} (code ${c.code}) [${c.status}]`,
        c.objective ? `Objective: ${c.objective}` : null,
        c.description ? `Description: ${c.description}` : null,
        `Channels: ${c.channels.join(", ") || "none"}; dates: ${c.startDate?.toISOString().slice(0, 10) ?? "?"} → ${c.endDate?.toISOString().slice(0, 10) ?? "?"}`,
        `Goals: ${c.targetLeads ?? "no"} leads, revenue ${c.targetRevenueMinor != null ? money(c.targetRevenueMinor, cur) : "no target"}`,
        `Budget ${money(c.budgetMinor, cur)}, spent ${money(a.spentMinor, cur)} (${pct(a.budgetUsed)}); by channel: ${a.spendByChannel.map((s) => `${s.channel} ${money(s.amountMinor, cur)}`).join(", ") || "none"}`,
        `Attributed leads ${a.leads} (form submissions ${a.submissions}), won ${a.won}, revenue ${money(a.revenueMinor, cur)}, conversion ${pct(a.conversionRate)}, CPL ${money(a.cplMinor, cur)}, CAC ${money(a.cacMinor, cur)}, ROI ${pct(a.roi)}`,
        `Emails: ${Object.entries(a.emails).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`,
        `Social: ${a.social.published} published deliveries, engagement ${a.social.engagement}, impressions ${a.social.impressions}`,
        `Content: ${Object.entries(a.content).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`,
      ].filter(Boolean);
      return { content: lines.join("\n"), records: [`marketing_campaign:${c.id}`] };
    },
  }),

  read_content_library: def({
    name: "read_content_library",
    version: 1,
    description: "Lists content items in the marketing content library (type, title, status, schedule). Optional filters: type, status, search text.",
    input: z.object({ type: z.enum(CONTENT_TYPES).optional(), status: z.enum(CONTENT_STATUSES).optional(), q: z.string().trim().max(200).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { type: { type: "string", enum: [...CONTENT_TYPES] }, status: { type: "string", enum: [...CONTENT_STATUSES] }, q: { type: "string" } },
      required: [],
      additionalProperties: false,
    },
    permissions: ["marketing.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read content library",
    async execute(input, { ctx, organizationId, companyId }) {
      const { data } = await listContent(ctx, organizationId, companyId, { ...input, page: 1 });
      if (!data.length) return { content: "No content items match.", count: 0 };
      const content = data
        .map((c) => `- ${c.title} [${c.type}, ${c.status}] (id ${c.id})${c.campaign ? ` campaign ${c.campaign.name}` : ""}${c.scheduledAt ? `, scheduled ${c.scheduledAt.toISOString()}` : ""}${c.publishedAt ? `, published ${c.publishedAt.toISOString().slice(0, 10)}` : ""}`)
        .join("\n");
      return { content, count: data.length, records: data.map((c) => `marketing_content:${c.id}`) };
    },
  }),

  read_seo_project: def({
    name: "read_seo_project",
    version: 1,
    description: "Returns an SEO project: domain, keywords with current/previous rank, competitors with notes, recent on-page audits with scores and issues, and a summary report.",
    input: z.object({ projectId: z.string().uuid() }).strict(),
    modelSchema: { type: "object", properties: { projectId: { type: "string", description: "SEO project id (uuid)" } }, required: ["projectId"], additionalProperties: false },
    permissions: ["marketing.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read SEO project",
    async execute({ projectId }, { ctx, organizationId, companyId }) {
      const p = await getProject(ctx, organizationId, companyId, projectId);
      const r = seoReport(p);
      const lines = [
        `SEO project ${p.name} for ${p.domain}${p.notes ? ` — notes: ${p.notes}` : ""}`,
        `Tracked ${r.trackedCount}, ranking ${r.rankedCount}; top 3: ${r.top3}, top 10: ${r.top10}; average rank ${r.avgRank ?? "n/a"}; latest audit score ${r.latestScore ?? "n/a"}`,
        "Keywords:",
        ...p.keywords
          .slice(0, 150)
          .map((k) => `- ${k.keyword}${k.intent ? ` (${k.intent})` : ""}: rank ${k.currentRank ?? "—"}${k.previousRank != null ? ` (was ${k.previousRank})` : ""}${k.searchVolume != null ? `, volume ${k.searchVolume}` : ""}${k.difficulty != null ? `, difficulty ${k.difficulty}` : ""}`),
        "Competitors:",
        ...p.competitors.map((c) => `- ${c.domain}${c.notes ? `: ${c.notes}` : ""}`),
        "Audits:",
        ...p.audits
          .slice(0, 10)
          .map((a) => `- ${a.createdAt.toISOString().slice(0, 10)} ${a.url}: ${a.status === "COMPLETED" ? `score ${a.score}, issues ${((a.issues ?? []) as { code: string }[]).map((i) => i.code).join(", ") || "none"}` : `failed (${a.error})`}`),
      ];
      return { content: lines.join("\n"), records: [`seo_project:${p.id}`] };
    },
  }),

  read_marketing_kpis: def({
    name: "read_marketing_kpis",
    version: 1,
    description: "Returns marketing KPIs for the last N days (default 30): spend, leads generated, new customers, CAC, conversion rate, ROI, emails sent, social posts published, form submissions, plus per-campaign attribution.",
    input: z.object({ days: z.number().int().min(1).max(365).optional() }).strict(),
    modelSchema: { type: "object", properties: { days: { type: "integer", description: "Look-back window in days (1-365)" } }, required: [], additionalProperties: false },
    permissions: ["marketing.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: ({ days }) => `Read marketing KPIs (${days ?? 30} days)`,
    async execute({ days = 30 }, { ctx, organizationId, companyId }) {
      await authorize(ctx, organizationId, companyId, "marketing.read");
      const to = new Date();
      const range = { from: new Date(to.getTime() - days * 86_400_000), to };
      const [k, rows, cur, social] = await Promise.all([
        computeKpis(organizationId, companyId, range),
        attribution(organizationId, companyId, range),
        companyCurrency(companyId),
        listAccounts(ctx, organizationId, companyId),
      ]);
      const lines = [
        `Last ${days} days: spend ${money(k.spendMinor, cur)}, leads ${k.leadsCreated}, new customers ${k.newCustomers}, revenue won ${money(k.revenueMinor, cur)}, CAC ${money(k.cacMinor, cur)}, conversion ${pct(k.conversionRate)}, ROI ${pct(k.roi)}, emails sent ${k.emailsSent}, social posts published ${k.postsPublished}, form submissions ${k.submissions}, active campaigns ${k.campaignsActive}.`,
        "By campaign:",
        ...rows.filter((c) => c.leads || c.spendMinor || c.won).map((c) => `- ${c.name} (${c.code}): spend ${money(c.spendMinor, cur)}, leads ${c.leads}, won ${c.won}, revenue ${money(c.revenueMinor, cur)}, ROI ${pct(c.roi)}`),
        "Social accounts:",
        ...social.accounts.map((a) => `- ${a.name} [${a.provider}] id ${a.id}, ${a.connected ? "connected" : "not connected"}`),
      ];
      return { content: lines.join("\n") };
    },
  }),

  create_content_draft: def({
    name: "create_content_draft",
    version: 1,
    description: "Propose adding a content draft (blog, social post, ad, landing page or email) to the content library. A person must approve before it is added; it then goes through editorial review.",
    input: z
      .object({
        type: z.enum(CONTENT_TYPES),
        title: z.string().trim().min(1).max(250),
        body: z.string().trim().min(1).max(50_000),
        brief: z.string().trim().max(5000).optional(),
        campaignId: z.string().uuid().optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...CONTENT_TYPES] },
        title: { type: "string" },
        body: { type: "string", description: "The full draft text" },
        brief: { type: "string" },
        campaignId: { type: "string", description: "Optional campaign id (uuid)" },
      },
      required: ["type", "title", "body"],
      additionalProperties: false,
    },
    permissions: ["marketing.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ type, title }) => `Add ${type.toLowerCase()} draft "${title}" to the content library`,
    async execute(input, { ctx, organizationId, companyId }) {
      const c = await createContent(ctx, organizationId, companyId, input);
      return { content: `Added draft "${c.title}" (id ${c.id}) to the content library.`, records: [`marketing_content:${c.id}`] };
    },
  }),

  create_campaign: def({
    name: "create_campaign",
    version: 1,
    description: "Propose creating a marketing campaign (as a draft) with objective, channels, budget, goals and dates. A person must approve before it is created.",
    input: z
      .object({
        name: z.string().trim().min(1).max(200),
        objective: z.string().trim().max(500).optional(),
        description: z.string().trim().max(5000).optional(),
        channels: z.array(z.enum(CHANNELS)).max(CHANNELS.length).optional(),
        budget: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).optional(),
        targetLeads: z.number().int().min(0).max(10_000_000).optional(),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        objective: { type: "string" },
        description: { type: "string" },
        channels: { type: "array", items: { type: "string", enum: [...CHANNELS] } },
        budget: { type: "string", description: 'Budget in major units, e.g. "5000"' },
        targetLeads: { type: "integer" },
        startDate: { type: "string", description: "YYYY-MM-DD" },
        endDate: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    permissions: ["marketing.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ name, budget }) => `Create draft campaign "${name}"${budget ? ` (budget ${budget})` : ""}`,
    async execute(input, { ctx, organizationId, companyId }) {
      const c = await createCampaign(ctx, organizationId, companyId, input);
      return { content: `Created draft campaign "${c.name}" with UTM code ${c.code} (id ${c.id}).`, records: [`marketing_campaign:${c.id}`] };
    },
  }),

  schedule_social_post: def({
    name: "schedule_social_post",
    version: 1,
    description:
      "Propose scheduling a social media post to one or more of the company's social accounts. Requires human approval; once approved it is queued and published by the publishing queue at the scheduled time, and only if the account's provider is connected and accepts it. Account ids are listed by read_marketing_kpis.",
    input: z
      .object({
        title: z.string().trim().min(1).max(200),
        text: z.string().trim().min(1).max(3000),
        accountIds: z.array(z.string().uuid()).min(1).max(10),
        scheduledAt: z.string().datetime({ offset: true }),
        campaignId: z.string().uuid().optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Internal title" },
        text: { type: "string", description: "Post text (X allows at most 280 characters)" },
        accountIds: { type: "array", items: { type: "string" }, description: "Social account ids (uuid)" },
        scheduledAt: { type: "string", description: "ISO 8601 date-time with offset" },
        campaignId: { type: "string" },
      },
      required: ["title", "text", "accountIds", "scheduledAt"],
      additionalProperties: false,
    },
    permissions: ["marketing.manage"],
    risk: "HIGH",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ title, accountIds, scheduledAt }) => `Schedule social post "${title}" to ${accountIds.length} account(s) at ${scheduledAt}`,
    async execute(input, { ctx, organizationId, companyId }) {
      const { accounts } = await listAccounts(ctx, organizationId, companyId);
      const known = new Set(accounts.map((a) => a.id));
      const missing = input.accountIds.filter((id) => !known.has(id));
      if (missing.length) {
        return { content: `Unknown social account ids: ${missing.join(", ")}. Available: ${accounts.map((a) => `${a.name} [${a.provider}] ${a.id}`).join("; ") || "none"}.` };
      }
      const p = await createPost(ctx, organizationId, companyId, { title: input.title, text: input.text, campaignId: input.campaignId, targets: input.accountIds.map((accountId) => ({ accountId })), scheduledAt: input.scheduledAt });
      const notConnected = accounts.filter((a) => input.accountIds.includes(a.id) && !a.connected).map((a) => a.name);
      return {
        content: `Queued post "${p.title}" (id ${p.id}) for ${p.scheduledAt?.toISOString()}. It is not published yet; the publishing queue sends it at that time.${notConnected.length ? ` Warning: not connected, it will fail unless connected first: ${notConnected.join(", ")}.` : ""}`,
        records: [`marketing_social_post:${p.id}`],
      };
    },
  }),

  read_marketing_analytics: def({
    name: "read_marketing_analytics",
    version: 1,
    description: "Returns unified marketing analytics for the last N days (default 30): social impressions/reach/engagement per platform, email sent/open/click/bounce rates, ads spend/clicks/conversions/ROAS, search clicks/impressions, blog views, leads, customers, total spend, CAC and ROI.",
    input: z.object({ days: z.number().int().min(1).max(365).optional() }).strict(),
    modelSchema: { type: "object", properties: { days: { type: "integer", description: "Look-back window in days (default 30)" } }, required: [], additionalProperties: false },
    permissions: ["marketing.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    summarize: () => "Read unified marketing analytics",
    async execute({ days }, { ctx, organizationId, companyId }) {
      const to = new Date();
      const from = new Date(to.getTime() - (days ?? 30) * 86_400_000);
      const r = parseRange({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
      const a = await getUnifiedAnalytics(ctx, organizationId, companyId, r);
      const cur = await companyCurrency(companyId);
      const lines = [
        `Period ${r.fromStr} → ${r.toStr}.`,
        `Social: ${a.social.posts} deliveries, ${a.social.impressions} impressions, reach ${a.social.reach}, engagement ${a.social.engagement} (rate ${a.social.engagementRate == null ? "n/a" : pct(a.social.engagementRate * 100)}), clicks ${a.social.clicks}.`,
        ...a.platforms.map((p) => `- ${p.provider}: ${p.posts} posts, ${p.impressions} impressions, engagement ${p.engagement} (rate ${p.engagementRate == null ? "n/a" : pct(p.engagementRate * 100)})`),
        `Email: ${a.email.sent} sent, open rate ${a.email.openRate == null ? "n/a" : pct(a.email.openRate * 100)}, click rate ${a.email.clickRate == null ? "n/a" : pct(a.email.clickRate * 100)}, ${a.email.bounced} bounced.`,
        `Ads: spend ${money(a.ads.spendMinor, cur)}, ${a.ads.impressions} impressions, ${a.ads.clicks} clicks, ${a.ads.conversions} conversions, ROAS ${a.ads.roas == null ? "n/a" : a.ads.roas.toFixed(2)}.`,
        `Search (Search Console): ${a.search.clicks} clicks, ${a.search.impressions} impressions. Blog views (lifetime): ${a.blogViews}.`,
        `Leads ${a.kpis.leadsCreated}, new customers ${a.kpis.newCustomers}, total spend ${money(a.totalSpendMinor, cur)}, CAC ${money(a.cacMinor, cur)}, ROI ${pct(a.roi)}.`,
      ];
      return { content: lines.join("\n") };
    },
  }),

  read_autopilot: def({
    name: "read_autopilot",
    version: 1,
    description: "Lists the company's marketing autopilot plans (objective, cadence, autonomy, status, pipeline counts by stage) and the next pipeline items with their stage, platform, slot, topic, review score and errors.",
    input: z.object({}).strict(),
    modelSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    permissions: ["marketing.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read marketing autopilot plans",
    async execute(_i, { ctx, organizationId, companyId }) {
      const plans = await listAutopilots(ctx, organizationId, companyId);
      if (!plans.length) return { content: "No autopilot plans." };
      const items = await listItems(ctx, organizationId, companyId, null, { page: 1 });
      const lines = [
        ...plans.map((p) => `- ${p.name} [${p.status}, ${p.autonomy}] (id ${p.id}): objective "${p.objective}"; cadence ${JSON.stringify(p.cadence)}; stages ${JSON.stringify(p.stages)}`),
        "Next items:",
        ...items.data.slice(0, 20).map((i) => `- ${i.slotAt.toISOString()} ${i.platform}/${i.format} [${i.stage}] ${i.topic ?? "(no topic yet)"}${i.reviewScore != null ? ` score ${i.reviewScore}` : ""}${i.error ? ` error: ${i.error}` : ""}`),
      ];
      return { content: lines.join("\n"), count: plans.length };
    },
  }),

  read_marketing_learnings: def({
    name: "read_marketing_learnings",
    version: 1,
    description: "Returns what the self-optimizing loop learned from real performance: best platforms, posting times, topics/pillars, formats, CTAs and hashtags, with engagement rates and sample sizes.",
    input: z.object({}).strict(),
    modelSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    permissions: ["marketing.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 10_000,
    summarize: () => "Read marketing learnings",
    async execute(_i, { ctx, organizationId, companyId }) {
      const rows = await listLearnings(ctx, organizationId, companyId);
      if (!rows.length) return { content: "No learnings yet: there is not enough published content with metrics." };
      return { content: rows.map((r) => `- [${r.kind}${r.platform ? `/${r.platform}` : ""}] ${r.insight}`).join("\n"), count: rows.length };
    },
  }),

  read_ad_performance: def({
    name: "read_ad_performance",
    version: 1,
    description: "Returns paid ads campaigns mirrored from Meta/Google/LinkedIn/TikTok with status, daily budget, spend, impressions, clicks, CTR, conversions, CPA and ROAS; with adCampaignId also the last 30 days.",
    input: z.object({ adCampaignId: z.string().uuid().optional() }).strict(),
    modelSchema: { type: "object", properties: { adCampaignId: { type: "string" } }, required: [], additionalProperties: false },
    permissions: ["marketing.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read ad performance",
    async execute({ adCampaignId }, { ctx, organizationId, companyId }) {
      await authorize(ctx, organizationId, companyId, "marketing.read");
      return { content: await adPerformanceText(organizationId, companyId, adCampaignId) };
    },
  }),

  repurpose_content: def({
    name: "repurpose_content",
    version: 1,
    description: "Propose adding a repurposed bundle (social posts, video scripts, carousel, blog, newsletter, quotes, graphic briefs...) as draft child items of a source content item. A person approves before they are added.",
    input: z.object({ contentId: z.string().uuid(), items: z.array(z.object({ type: z.enum(CONTENT_TYPES), title: z.string().trim().min(1).max(250), body: z.string().trim().min(1).max(50_000) }).strict()).min(1).max(20) }).strict(),
    modelSchema: {
      type: "object",
      properties: {
        contentId: { type: "string", description: "Source content id (uuid)" },
        items: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: [...CONTENT_TYPES] }, title: { type: "string" }, body: { type: "string" } }, required: ["type", "title", "body"], additionalProperties: false } },
      },
      required: ["contentId", "items"],
      additionalProperties: false,
    },
    permissions: ["marketing.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 20_000,
    summarize: ({ items }) => `Add ${items.length} repurposed draft(s) to the content library`,
    async execute({ contentId, items }, { ctx, organizationId, companyId }) {
      const ids: string[] = [];
      for (const it of items) ids.push((await createContent(ctx, organizationId, companyId, { ...it, parentId: contentId })).id);
      return { content: `Added ${ids.length} draft(s) linked to the source.`, records: ids.map((id) => `marketing_content:${id}`) };
    },
  }),

  generate_creative: def({
    name: "generate_creative",
    version: 1,
    description: "Propose generating on-brand images with the company's connected image provider (OpenAI images or Stability) for a platform preset. Needs approval; fails if no provider is connected. Returns the new media library asset ids.",
    input: z.object({ prompt: z.string().trim().min(3).max(3000), preset: z.enum(PRESET_KEYS as [string, ...string[]]), variations: z.number().int().min(1).max(4).optional(), campaignId: z.string().uuid().optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { prompt: { type: "string" }, preset: { type: "string", enum: [...PRESET_KEYS] }, variations: { type: "integer" }, campaignId: { type: "string" } },
      required: ["prompt", "preset"],
      additionalProperties: false,
    },
    permissions: ["marketing.manage"],
    risk: "LOW",
    autonomy: "SUPERVISED",
    timeoutMs: 180_000,
    summarize: ({ prompt, variations }) => `Generate ${variations ?? 1} image(s): "${prompt.slice(0, 120)}"`,
    async execute(input, { ctx, organizationId, companyId }) {
      const r = await generateCreative(ctx, organizationId, companyId, { ...input, preset: input.preset as never });
      return { content: `Generated ${r.created.length} image(s) with ${r.provider}: ${r.created.join(", ")}${r.errors.length ? `; errors: ${r.errors.join("; ")}` : ""}.`, records: r.created.map((id) => `marketing_asset:${id}`) };
    },
  }),

  create_ad_campaign_draft: def({
    name: "create_ad_campaign_draft",
    version: 1,
    description: "Propose a paid ads campaign draft (local, with ads) for an imported ad account. Needs approval. It is NOT created at the provider until launch_ad_campaign is approved, and budgets must fit the account's spending caps.",
    input: z
      .object({
        adAccountId: z.string().uuid(),
        name: z.string().trim().min(1).max(200),
        objective: z.string().trim().max(60).optional(),
        dailyBudget: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
        audience: z.string().trim().max(2000).optional(),
        ads: z.array(z.object({ headline: z.string().trim().min(1).max(150), body: z.string().trim().min(1).max(2000), cta: z.string().trim().max(40).optional() }).strict()).max(10).optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        adAccountId: { type: "string" },
        name: { type: "string" },
        objective: { type: "string" },
        dailyBudget: { type: "string", description: 'Daily budget in major units, e.g. "50"' },
        audience: { type: "string" },
        ads: { type: "array", items: { type: "object", properties: { headline: { type: "string" }, body: { type: "string" }, cta: { type: "string" } }, required: ["headline", "body"], additionalProperties: false } },
      },
      required: ["adAccountId", "name", "dailyBudget"],
      additionalProperties: false,
    },
    permissions: ["marketing.manage"],
    risk: "HIGH",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ name, dailyBudget }) => `Create ad campaign draft "${name}" (daily budget ${dailyBudget})`,
    async execute(input, { ctx, organizationId, companyId }) {
      const c = await createAdCampaignDraft(ctx, organizationId, companyId, { ...input, ads: input.ads ?? [] });
      return { content: `Created local ad campaign draft "${c.name}" (id ${c.id}). Not live at the provider.`, records: [`marketing_ad_campaign:${c.id}`] };
    },
  }),

  launch_ad_campaign: def({
    name: "launch_ad_campaign",
    version: 1,
    description: "Propose creating a local ad campaign draft at the ad provider (created PAUSED). Needs approval; refused if the daily budget exceeds the account's caps.",
    input: z.object({ adCampaignId: z.string().uuid() }).strict(),
    modelSchema: { type: "object", properties: { adCampaignId: { type: "string" } }, required: ["adCampaignId"], additionalProperties: false },
    permissions: ["marketing.manage"],
    risk: "HIGH",
    autonomy: "SUPERVISED",
    timeoutMs: 60_000,
    summarize: ({ adCampaignId }) => `Create ad campaign ${adCampaignId} at the provider (paused)`,
    async execute({ adCampaignId }, { ctx, organizationId, companyId }) {
      const r = await launchAdCampaign(ctx, organizationId, companyId, adCampaignId);
      return { content: `Created at ${r.provider} with id ${r.externalId} (paused).`, records: [`marketing_ad_campaign:${adCampaignId}`] };
    },
  }),

  set_ad_budget: def({
    name: "set_ad_budget",
    version: 1,
    description: "Propose changing a live ad campaign's daily budget at the provider. Needs approval; refused above the account's daily/monthly caps.",
    input: z.object({ adCampaignId: z.string().uuid(), dailyBudget: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/) }).strict(),
    modelSchema: { type: "object", properties: { adCampaignId: { type: "string" }, dailyBudget: { type: "string", description: "Major units" } }, required: ["adCampaignId", "dailyBudget"], additionalProperties: false },
    permissions: ["marketing.manage"],
    risk: "HIGH",
    autonomy: "SUPERVISED",
    timeoutMs: 60_000,
    summarize: ({ adCampaignId, dailyBudget }) => `Set daily budget of ad campaign ${adCampaignId} to ${dailyBudget}`,
    async execute({ adCampaignId, dailyBudget }, { ctx, organizationId, companyId }) {
      await changeAdBudget(ctx, organizationId, companyId, adCampaignId, dailyBudget);
      return { content: `Daily budget set to ${dailyBudget} at the provider.`, records: [`marketing_ad_campaign:${adCampaignId}`] };
    },
  }),

  set_ad_campaign_status: def({
    name: "set_ad_campaign_status",
    version: 1,
    description: "Propose activating or pausing an ad campaign at the provider. Needs approval; activation re-checks the spending caps.",
    input: z.object({ adCampaignId: z.string().uuid(), active: z.boolean() }).strict(),
    modelSchema: { type: "object", properties: { adCampaignId: { type: "string" }, active: { type: "boolean" } }, required: ["adCampaignId", "active"], additionalProperties: false },
    permissions: ["marketing.manage"],
    risk: "HIGH",
    autonomy: "SUPERVISED",
    timeoutMs: 60_000,
    summarize: ({ adCampaignId, active }) => `${active ? "Activate" : "Pause"} ad campaign ${adCampaignId}`,
    async execute({ adCampaignId, active }, { ctx, organizationId, companyId }) {
      await changeAdStatus(ctx, organizationId, companyId, adCampaignId, active);
      return { content: `Campaign ${active ? "activated" : "paused"} at the provider.`, records: [`marketing_ad_campaign:${adCampaignId}`] };
    },
  }),

  reply_to_comment: def({
    name: "reply_to_comment",
    version: 1,
    description: "Propose posting a reply to a synced social comment. Needs approval; counts as replied only when the platform accepted it.",
    input: z.object({ engagementId: z.string().uuid(), text: z.string().trim().min(1).max(3000) }).strict(),
    modelSchema: { type: "object", properties: { engagementId: { type: "string" }, text: { type: "string" } }, required: ["engagementId", "text"], additionalProperties: false },
    permissions: ["marketing.manage"],
    risk: "HIGH",
    autonomy: "SUPERVISED",
    timeoutMs: 30_000,
    summarize: ({ text }) => `Reply to a social comment: "${text.slice(0, 120)}"`,
    async execute({ engagementId, text }, { ctx, organizationId, companyId }) {
      const r = await sendReply(ctx, organizationId, companyId, engagementId, text);
      return { content: `Reply posted (platform id ${r.externalId}).`, records: [`marketing_engagement:${engagementId}`] };
    },
  }),

  send_influencer_outreach: def({
    name: "send_influencer_outreach",
    version: 1,
    description: "Propose sending the saved outreach email to an influencer. Needs approval; recorded as sent only when the email provider accepted it.",
    input: z.object({ influencerId: z.string().uuid() }).strict(),
    modelSchema: { type: "object", properties: { influencerId: { type: "string" } }, required: ["influencerId"], additionalProperties: false },
    permissions: ["marketing.manage"],
    risk: "HIGH",
    autonomy: "SUPERVISED",
    timeoutMs: 30_000,
    summarize: ({ influencerId }) => `Send outreach email to influencer ${influencerId}`,
    async execute({ influencerId }, { ctx, organizationId, companyId }) {
      await sendOutreach(ctx, organizationId, companyId, influencerId);
      return { content: "Outreach email sent.", records: [`marketing_influencer:${influencerId}`] };
    },
  }),

  read_market_research: def({
    name: "read_market_research",
    version: 1,
    description: "Returns the company's saved marketing research reports (market, competitor, audience, trends, keywords, brand): status, summary, key insights, opportunities and source URLs. Optional kind filter. Use before planning or writing to ground claims in real research.",
    input: z.object({ kind: z.enum(RESEARCH_KINDS).optional() }).strict(),
    modelSchema: { type: "object", properties: { kind: { type: "string", enum: [...RESEARCH_KINDS] } }, required: [], additionalProperties: false },
    permissions: ["marketing.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read marketing research reports",
    async execute(input, { ctx, organizationId, companyId }) {
      const { data } = await listResearchReports(ctx, organizationId, companyId, { kind: input.kind, page: 1 });
      if (!data.length) return { content: "No research reports yet.", count: 0 };
      const full = await db().marketingResearchReport.findMany({ where: { id: { in: data.slice(0, 8).map((r) => r.id) }, companyId }, select: { id: true, sources: true } });
      const sources = new Map(full.map((r) => [r.id, parseSources(r.sources)]));
      const lines = data.slice(0, 8).map((r) => {
        const f = parseFindings(r.findings);
        const src = (sources.get(r.id) ?? []).slice(0, 6).map((s, i) => `[${i + 1}] ${s.url}`).join(" ");
        return [`- ${r.id} ${r.kind} "${r.title}" [${r.status}] ${r.createdAt.toISOString().slice(0, 10)}`, r.summary ? `  Summary: ${r.summary.slice(0, 600)}` : null, ...(f?.insights ?? []).slice(0, 5).map((i) => `  • ${i.title}: ${i.detail.slice(0, 200)}`), src ? `  Sources: ${src}` : null].filter(Boolean).join("\n");
      });
      return { content: lines.join("\n"), count: data.length, records: data.map((r) => `marketing_research_report:${r.id}`) };
    },
  }),

  read_marketing_plans: def({
    name: "read_marketing_plans",
    version: 1,
    description: "Returns the company's marketing plans: status, period, positioning, objectives (metric and target), channels with funnel role, budget split and cadence.",
    input: z.object({}).strict(),
    modelSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    permissions: ["marketing.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read marketing plans",
    async execute(_input, { ctx, organizationId, companyId }) {
      const plans = await listPlans(ctx, organizationId, companyId);
      if (!plans.length) return { content: "No marketing plans yet.", count: 0 };
      const lines = plans.slice(0, 10).map((p) =>
        [
          `- ${p.id} "${p.name}" [${p.status}] ${p.periodStart.toISOString().slice(0, 10)} → ${p.periodEnd.toISOString().slice(0, 10)}, budget ${money(p.budgetMinor, p.currency)}`,
          p.positioning ? `  Positioning: ${p.positioning.slice(0, 400)}` : null,
          ...planObjectives(p.objectives).map((o) => `  Objective: ${o.metric} ≥ ${o.target}${o.label ? ` (${o.label})` : ""}`),
          ...planChannels(p.channels).map((c) => `  Channel: ${c.channel} [${c.role}] ${money(BigInt(c.budgetMinor), p.currency)}${c.cadence ? `, ${c.cadence}` : ""}`),
        ]
          .filter(Boolean)
          .join("\n"),
      );
      return { content: lines.join("\n"), count: plans.length, records: plans.map((p) => `marketing_plan:${p.id}`) };
    },
  }),

  start_market_research: def({
    name: "start_market_research",
    version: 1,
    description: "Propose running a new research report (MARKET, COMPETITOR, AUDIENCE, TRENDS, KEYWORDS or BRAND) through the company's connected research provider. Needs approval (it calls a paid external provider). The report is saved with its sources; findings are synthesized afterwards.",
    input: z.object({ kind: z.enum(RESEARCH_KINDS), subject: z.string().trim().min(2).max(200), region: z.string().trim().max(80).optional(), competitors: z.array(z.string().trim().min(1).max(120)).max(8).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { kind: { type: "string", enum: [...RESEARCH_KINDS] }, subject: { type: "string" }, region: { type: "string" }, competitors: { type: "array", items: { type: "string" } } },
      required: ["kind", "subject"],
      additionalProperties: false,
    },
    permissions: ["marketing.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 90_000,
    summarize: ({ kind, subject }) => `Run ${kind.toLowerCase()} research: ${subject}`,
    async execute(input, { ctx, organizationId, companyId }) {
      const r = await createResearchReport(ctx, organizationId, companyId, { kind: input.kind, subject: input.subject, region: input.region ?? "", competitors: input.competitors ?? [] });
      const what =
        r.status === "CREDENTIAL_REQUIRED"
          ? "No research provider is connected (Tavily, Exa or SerpApi) — nothing was researched. Ask the person to connect one under Integrations."
          : r.status === "FAILED"
            ? `Research failed: ${r.error ?? "unknown error"}.`
            : `Research report saved with ${parseSources(r.sources).length} sources (status ${r.status}).`;
      return { content: what, records: [`marketing_research_report:${r.id}`] };
    },
  }),
};
