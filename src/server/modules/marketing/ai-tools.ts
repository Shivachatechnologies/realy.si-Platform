import { z } from "zod";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { db } from "@/server/core/db";
import { attribution, campaignAnalytics, computeKpis } from "./analytics";
import { CAMPAIGN_STATUSES, createCampaign, listCampaigns } from "./campaigns";
import { CONTENT_STATUSES, CONTENT_TYPES, createContent, listContent } from "./content";
import { createPost, listAccounts } from "./social";
import { getProject, seoReport } from "./seo";
import { authorize, CHANNELS } from "./common";

const money = (m: bigint | null, currency: string) => (m == null ? "n/a" : `${(Number(m) / 100).toFixed(2)} ${currency}`);
const pct = (v: number | null) => (v == null ? "n/a" : `${v.toFixed(1)}%`);
const companyCurrency = async (companyId: string) => (await db().company.findUnique({ where: { id: companyId }, select: { baseCurrency: true } }))?.baseCurrency ?? "USD";

/** AI tools of the marketing module, registered in src/server/modules/tools/modules.ts. Use `def` from tools/define. */
export const MARKETING_TOOLS: Record<string, ToolDefinition> = {
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
};
