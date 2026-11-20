import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask } from "@/server/modules/agents/service";
import { actorId, authorize, day, isUuid, money, requireOwned, toDay, toMinor, uuid } from "./common";
import { getMarketingConnection, isUsable } from "./connections-bridge";
import { AD_PROVIDERS, createRemoteCampaign, fetchDailyMetrics, listAdAccounts, listRemoteCampaigns, setRemoteStatus, updateRemoteBudget, type AdProvider } from "./providers/ads";
import { ProviderError } from "./providers/http";
import { brandContextFor } from "./brand";
import { assertFeature, assertLimit, recordUsage } from "@/server/modules/entitlements/service";

export { AD_PROVIDERS } from "./providers/ads";

export const capsInput = z.object({ dailyCap: money, monthlyCap: money });
export const adCampaignInput = z.object({
  adAccountId: uuid,
  name: z.string().trim().min(1).max(200),
  objective: z.string().trim().max(60).optional(),
  dailyBudget: money,
  startDate: day.optional().or(z.literal("")),
  endDate: day.optional().or(z.literal("")),
  marketingCampaignId: uuid.or(z.literal("")).nullable().optional(),
  audience: z.string().trim().max(2000).optional(),
  ads: z.array(z.object({ headline: z.string().trim().min(1).max(150), body: z.string().trim().min(1).max(2000), cta: z.string().trim().max(40).optional(), url: z.string().trim().url().max(2000).optional().or(z.literal("")), assetId: uuid.optional() })).max(10).default([]),
});
export const adAiInput = z.object({ kind: z.enum(["plan", "copy", "optimize"]), note: z.string().trim().max(2000).optional() });

type Conn = NonNullable<Awaited<ReturnType<typeof getMarketingConnection>>> & { accessToken: string };
async function adConn(organizationId: string, companyId: string, provider: string): Promise<Conn> {
  if (!(AD_PROVIDERS as readonly string[]).includes(provider)) throw notFound("Provider");
  const c = await getMarketingConnection(organizationId, companyId, provider);
  if (!isUsable(c)) throw new AppError("not_configured", `${provider} is not connected`, { reason: "marketing_ads_not_connected", provider });
  return c;
}

export async function adsOverview(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [accounts, campaigns, metrics, connected] = await Promise.all([
    db().marketingAdAccount.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { name: "asc" } }),
    db().marketingAdCampaign.findMany({ where: { organizationId, companyId }, orderBy: { updatedAt: "desc" }, take: 200, include: { adAccount: { select: { provider: true, name: true, currency: true } } } }),
    db().marketingAdMetric.aggregate({ where: { organizationId, companyId, date: { gte: since } }, _sum: { spendMinor: true, impressions: true, clicks: true, conversions: true, revenueMinor: true } }),
    Promise.all(AD_PROVIDERS.map(async (p) => [p, isUsable(await getMarketingConnection(organizationId, companyId, p))] as const)),
  ]);
  const s = metrics._sum;
  const spend = Number(s.spendMinor ?? 0n);
  const imp = s.impressions ?? 0;
  const clicks = s.clicks ?? 0;
  const conv = s.conversions ?? 0;
  const rev = Number(s.revenueMinor ?? 0n);
  return {
    accounts,
    campaigns,
    connected: Object.fromEntries(connected) as Record<AdProvider, boolean>,
    totals: { spendMinor: spend, impressions: imp, clicks, conversions: conv, revenueMinor: rev, ctr: imp ? clicks / imp : null, cpcMinor: clicks ? spend / clicks : null, cpmMinor: imp ? (spend / imp) * 1000 : null, cpaMinor: conv ? spend / conv : null, roas: spend ? rev / spend : null },
  };
}

export async function getAdCampaign(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  if (!isUuid(id)) throw notFound("Ad campaign");
  const c = await db().marketingAdCampaign.findFirst({ where: { id, organizationId, companyId }, include: { adAccount: true, groups: { include: { ads: true } }, metrics: { orderBy: { date: "desc" }, take: 60 } } });
  if (!c) throw notFound("Ad campaign");
  return c;
}

/** Import the provider's ad accounts. Caps start at 0: nothing can be spent until a person sets them. */
export async function importAdAccounts(ctx: RequestContext, organizationId: string, companyId: string, provider: string) {
  const conn = await adConn(organizationId, companyId, provider);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  let remote;
  try {
    remote = await listAdAccounts(provider as AdProvider, conn);
  } catch (err) {
    throw conflict(`The provider refused: ${err instanceof ProviderError ? err.message : "error"}`, { reason: "marketing_ads_provider_error" });
  }
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    for (const a of remote.slice(0, 50)) {
      await tx.marketingAdAccount.upsert({
        where: { companyId_provider_externalId: { companyId, provider, externalId: a.externalId } },
        create: { organizationId, companyId, provider, externalId: a.externalId, name: a.name, currency: a.currency.slice(0, 3).toUpperCase(), createdById: actorId(ctx, organizationId) },
        update: { name: a.name, archivedAt: null },
      });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.ads.accounts_imported", resourceType: "marketing_ad_account", resourceId: companyId, newValue: { provider, count: remote.length } });
    return { imported: remote.length };
  });
}

export async function setAdCaps(ctx: RequestContext, organizationId: string, companyId: string, accountId: string, raw: z.input<typeof capsInput>) {
  const input = capsInput.parse(raw);
  if (!isUuid(accountId)) throw notFound("Ad account");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingAdAccount.updateMany({ where: { id: accountId, organizationId, companyId }, data: { dailyCapMinor: toMinor(input.dailyCap) ?? 0n, monthlyCapMinor: toMinor(input.monthlyCap) ?? 0n } });
    if (!count) throw notFound("Ad account");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.ads.caps_set", resourceType: "marketing_ad_account", resourceId: accountId, newValue: input });
    return { ok: true };
  });
}

/** Pull campaigns and the last 30 days of daily metrics from the provider. */
export async function syncAdAccount(accountId: string): Promise<number> {
  const a = await db().marketingAdAccount.findUniqueOrThrow({ where: { id: accountId } });
  const conn = await getMarketingConnection(a.organizationId, a.companyId, a.provider);
  if (!isUsable(conn)) {
    await db().marketingAdAccount.update({ where: { id: a.id }, data: { lastSyncError: "not_connected" } });
    return 0;
  }
  try {
    const provider = a.provider as AdProvider;
    const remote = await listRemoteCampaigns(provider, conn, a.externalId);
    for (const r of remote) {
      await db().marketingAdCampaign.upsert({
        where: { adAccountId_externalId: { adAccountId: a.id, externalId: r.externalId } },
        create: { organizationId: a.organizationId, companyId: a.companyId, adAccountId: a.id, externalId: r.externalId, name: r.name.slice(0, 200), status: r.status, objective: r.objective, dailyBudgetMinor: r.dailyBudgetMinor, createdById: a.createdById, syncedAt: new Date() },
        update: { name: r.name.slice(0, 200), status: r.status, objective: r.objective, dailyBudgetMinor: r.dailyBudgetMinor, syncedAt: new Date() },
      });
    }
    const campaigns = await db().marketingAdCampaign.findMany({ where: { adAccountId: a.id, externalId: { not: null } }, select: { id: true, externalId: true } });
    const byExt = new Map(campaigns.map((c) => [c.externalId!, c.id]));
    const rows = await fetchDailyMetrics(provider, conn, a.externalId, new Date(Date.now() - 30 * 86_400_000));
    for (const m of rows) {
      const cid = byExt.get(m.campaignExternalId);
      if (!cid) continue;
      const date = new Date(`${m.date}T00:00:00Z`);
      const data = { spendMinor: m.spendMinor, impressions: m.impressions, clicks: m.clicks, conversions: m.conversions, revenueMinor: m.revenueMinor };
      await db().marketingAdMetric.upsert({ where: { adCampaignId_date: { adCampaignId: cid, date } }, create: { organizationId: a.organizationId, companyId: a.companyId, adCampaignId: cid, date, ...data }, update: data });
    }
    for (const c of campaigns) {
      const s = await db().marketingAdMetric.aggregate({ where: { adCampaignId: c.id }, _sum: { spendMinor: true, impressions: true, clicks: true, conversions: true, revenueMinor: true } });
      await db().marketingAdCampaign.update({ where: { id: c.id }, data: { spendMinor: s._sum.spendMinor ?? 0n, impressions: s._sum.impressions ?? 0, clicks: s._sum.clicks ?? 0, conversions: s._sum.conversions ?? 0, revenueMinor: s._sum.revenueMinor ?? 0n } });
    }
    await db().marketingAdAccount.update({ where: { id: a.id }, data: { lastSyncedAt: new Date(), lastSyncError: null } });
    return rows.length;
  } catch (err) {
    const error = err instanceof ProviderError ? `${err.reason}: ${err.message}`.slice(0, 500) : "sync_failed";
    await db().marketingAdAccount.update({ where: { id: a.id }, data: { lastSyncError: error } });
    logger.warn({ accountId, error }, "ads sync failed");
    return 0;
  }
}

export async function syncAdAccountNow(ctx: RequestContext, organizationId: string, companyId: string, accountId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  if (!isUuid(accountId) || !(await db().marketingAdAccount.findFirst({ where: { id: accountId, organizationId, companyId }, select: { id: true } }))) throw notFound("Ad account");
  return { rows: await syncAdAccount(accountId) };
}

export async function syncAllAdAccounts(): Promise<number> {
  const stale = new Date(Date.now() - 6 * 3_600_000);
  const accounts = await db().marketingAdAccount.findMany({ where: { archivedAt: null, OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: stale } }] }, select: { id: true }, take: 20 });
  let n = 0;
  for (const a of accounts) n += await syncAdAccount(a.id);
  return n;
}

/** Local campaign draft (nothing is sent to the provider). */
export async function createAdCampaignDraft(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof adCampaignInput>) {
  const input = adCampaignInput.parse(raw);
  await assertFeature(ctx, organizationId, "feature.ai_campaigns");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const acc = await tx.marketingAdAccount.findFirst({ where: { id: input.adAccountId, organizationId, companyId, archivedAt: null } });
    if (!acc) throw notFound("Ad account");
    const c = await tx.marketingAdCampaign.create({
      data: {
        organizationId,
        companyId,
        adAccountId: acc.id,
        name: input.name,
        objective: input.objective || null,
        dailyBudgetMinor: toMinor(input.dailyBudget),
        startDate: toDay(input.startDate || null),
        endDate: toDay(input.endDate || null),
        marketingCampaignId: await requireOwned(tx, "marketingCampaign", companyId, input.marketingCampaignId || null, "Campaign"),
        createdById: actorId(ctx, organizationId),
        groups: {
          create: [
            {
              organizationId,
              name: `${input.name} — audience`,
              targeting: { description: input.audience ?? "" },
              ads: { create: input.ads.map((a) => ({ organizationId, headline: a.headline, body: a.body, cta: a.cta ?? null, url: a.url || null, assetId: a.assetId ?? null })) },
            },
          ],
        },
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.ads.campaign_drafted", resourceType: "marketing_ad_campaign", resourceId: c.id, newValue: { name: c.name, dailyBudget: input.dailyBudget } });
    return c;
  });
}

/** Hard spending cap check (before any provider call). Throws when the budget would exceed the account's caps. */
async function checkCaps(accountId: string, dailyBudgetMinor: bigint) {
  const a = await db().marketingAdAccount.findUniqueOrThrow({ where: { id: accountId } });
  if (a.dailyCapMinor <= 0n || a.monthlyCapMinor <= 0n) throw conflict("Set spending caps for this ad account first", { reason: "marketing_ads_no_caps" });
  if (dailyBudgetMinor > a.dailyCapMinor) throw conflict("Daily budget exceeds the account's daily cap", { reason: "marketing_ads_over_cap", cap: a.dailyCapMinor.toString() });
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const spent = (await db().marketingAdMetric.aggregate({ where: { campaign: { adAccountId: accountId }, date: { gte: monthStart } }, _sum: { spendMinor: true } }))._sum.spendMinor ?? 0n;
  if (spent + dailyBudgetMinor > a.monthlyCapMinor) throw conflict("This month's spend would exceed the account's monthly cap", { reason: "marketing_ads_over_cap", cap: a.monthlyCapMinor.toString(), spent: spent.toString() });
  return a;
}

/** SUPERVISED HIGH (via approval): create the local draft at the provider, PAUSED. */
export async function launchAdCampaign(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const c = await db().marketingAdCampaign.findFirst({ where: { id, organizationId, companyId } });
  if (!c) throw notFound("Ad campaign");
  if (c.externalId) throw conflict("Already created at the provider", { reason: "marketing_ads_already_pushed" });
  if (!c.dailyBudgetMinor) throw invalid("Set a daily budget", { reason: "marketing_ads_no_budget" });
  const acc = await checkCaps(c.adAccountId, c.dailyBudgetMinor);
  // Plan ad-spend cap (minor units of the account currency, counted as cents).
  const budgetCents = Number(c.dailyBudgetMinor);
  await assertLimit(ctx, organizationId, "ads.spend.month", budgetCents);
  const conn = await adConn(organizationId, companyId, acc.provider);
  const externalId = await createRemoteCampaign(acc.provider as AdProvider, conn, acc.externalId, { name: c.name, objective: c.objective ?? "", dailyBudgetMinor: c.dailyBudgetMinor, currency: acc.currency });
  await transaction(async (tx) => {
    await tx.marketingAdCampaign.update({ where: { id }, data: { externalId, status: "PAUSED", syncedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.ads.campaign_created", resourceType: "marketing_ad_campaign", resourceId: id, newValue: { provider: acc.provider, externalId, dailyBudgetMinor: c.dailyBudgetMinor } });
  });
  await recordUsage(organizationId, "ads.spend_cents", budgetCents, { companyId, idempotencyKey: id });
  return { externalId, provider: acc.provider };
}

/** SUPERVISED HIGH (via approval): change the daily budget at the provider, within caps. */
export async function changeAdBudget(ctx: RequestContext, organizationId: string, companyId: string, id: string, dailyBudget: string) {
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const c = await db().marketingAdCampaign.findFirst({ where: { id, organizationId, companyId } });
  if (!c?.externalId) throw notFound("Ad campaign");
  const minor = toMinor(dailyBudget) ?? 0n;
  const acc = await checkCaps(c.adAccountId, minor);
  // Plan ad-spend cap: only a raise commits more budget.
  const raiseCents = Math.max(0, Number(minor - (c.dailyBudgetMinor ?? 0n)));
  if (raiseCents > 0) await assertLimit(ctx, organizationId, "ads.spend.month", raiseCents);
  const conn = await adConn(organizationId, companyId, acc.provider);
  await updateRemoteBudget(acc.provider as AdProvider, conn, acc.externalId, c.externalId, minor, acc.currency);
  if (raiseCents > 0) await recordUsage(organizationId, "ads.spend_cents", raiseCents, { companyId });
  await transaction(async (tx) => {
    await tx.marketingAdCampaign.update({ where: { id }, data: { dailyBudgetMinor: minor } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.ads.budget_changed", resourceType: "marketing_ad_campaign", resourceId: id, oldValue: { dailyBudgetMinor: c.dailyBudgetMinor }, newValue: { dailyBudgetMinor: minor } });
  });
  return { ok: true };
}

/** SUPERVISED HIGH (via approval): activate or pause at the provider. Activation re-checks caps. */
export async function changeAdStatus(ctx: RequestContext, organizationId: string, companyId: string, id: string, active: boolean) {
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const c = await db().marketingAdCampaign.findFirst({ where: { id, organizationId, companyId }, include: { adAccount: true } });
  if (!c?.externalId) throw notFound("Ad campaign");
  if (active) await checkCaps(c.adAccountId, c.dailyBudgetMinor ?? 0n);
  const conn = await adConn(organizationId, companyId, c.adAccount.provider);
  await setRemoteStatus(c.adAccount.provider as AdProvider, conn, c.adAccount.externalId, c.externalId, active);
  await transaction(async (tx) => {
    await tx.marketingAdCampaign.update({ where: { id }, data: { status: active ? "ACTIVE" : "PAUSED" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.ads.status_changed", resourceType: "marketing_ad_campaign", resourceId: id, newValue: { active } });
  });
  return { ok: true };
}

/** UI entry for provider writes: files an approval request for the SUPERVISED HIGH tool (never calls the provider directly). */
export async function requestAdChange(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: { action: "launch" | "budget" | "activate" | "pause"; dailyBudget?: string }) {
  const input = z.object({ action: z.enum(["launch", "budget", "activate", "pause"]), dailyBudget: money.optional() }).parse(raw);
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  if (!isUuid(id) || !(await db().marketingAdCampaign.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }))) throw notFound("Ad campaign");
  const { requestTool } = await import("@/server/modules/tools/gateway");
  const [tool, toolInput] =
    input.action === "launch"
      ? ["launch_ad_campaign", { adCampaignId: id }]
      : input.action === "budget"
        ? ["set_ad_budget", { adCampaignId: id, dailyBudget: input.dailyBudget ?? "" }]
        : ["set_ad_campaign_status", { adCampaignId: id, active: input.action === "activate" }];
  const r = await requestTool(tool, toolInput, { ctx, organizationId, companyId, allowedTools: [tool], profileKey: "paid_ads_specialist", taskId: null });
  return r.status === "approval_requested" ? { approvalId: r.approvalId } : { done: true };
}

export async function requestAdAi(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof adAiInput>) {
  const input = adAiInput.parse(raw);
  const c = await getAdCampaign(ctx, organizationId, companyId, id);
  const context = `Ad campaign ${c.id} "${c.name}" on ${c.adAccount.provider} (status ${c.status}, objective ${c.objective ?? "n/a"}, daily budget ${c.dailyBudgetMinor != null ? (Number(c.dailyBudgetMinor) / 100).toFixed(2) : "n/a"} ${c.adAccount.currency}, caps: daily ${(Number(c.adAccount.dailyCapMinor) / 100).toFixed(2)}, monthly ${(Number(c.adAccount.monthlyCapMinor) / 100).toFixed(2)}). Totals: spend ${(Number(c.spendMinor) / 100).toFixed(2)}, ${c.impressions} impressions, ${c.clicks} clicks, ${c.conversions} conversions, revenue ${(Number(c.revenueMinor) / 100).toFixed(2)}.`;
  const what =
    input.kind === "plan"
      ? "Write a campaign plan: audience and targeting, offer and message, structure (ad groups), creative ideas, budget split within the caps, KPIs (CPC, CTR, CPA, ROAS) and a test plan."
      : input.kind === "copy"
        ? "Write 5 ad variations for this campaign (headline ≤ 40 chars, primary text ≤ 125 chars, description, CTA), each testing a different angle."
        : "Use read_ad_performance to load real daily metrics, then recommend concrete optimizations (budget shifts within caps, pause/scale, creative and targeting changes) with the numbers that justify them. Changes to the live campaign need approval — propose, do not assume.";
  return createTask(ctx, organizationId, companyId, {
    profile: "paid_ads_specialist",
    title: `Ads ${input.kind}: ${c.name}`.slice(0, 200),
    instructions: `${what}\n\n${context}${input.note ? `\n\nDirection: ${input.note}` : ""}\n\n${await brandContextFor(companyId)}`.slice(0, 8000),
    subject: { type: "marketing_ad_campaign", id: c.id },
  });
}

export async function adPerformanceText(organizationId: string, companyId: string, id?: string) {
  const where: Prisma.MarketingAdCampaignWhereInput = { organizationId, companyId, ...(id ? { id } : {}) };
  const rows = await db().marketingAdCampaign.findMany({ where, include: { adAccount: { select: { provider: true, currency: true, dailyCapMinor: true, monthlyCapMinor: true } }, metrics: { orderBy: { date: "desc" }, take: id ? 30 : 0 } }, take: 50 });
  if (!rows.length) return "No ad campaigns.";
  return rows
    .map((c) => {
      const s = Number(c.spendMinor) / 100;
      const ctr = c.impressions ? ((c.clicks / c.impressions) * 100).toFixed(2) : "n/a";
      const cpa = c.conversions ? (s / c.conversions).toFixed(2) : "n/a";
      const roas = c.spendMinor ? (Number(c.revenueMinor) / Number(c.spendMinor)).toFixed(2) : "n/a";
      const daily = c.metrics.map((m) => `  ${m.date.toISOString().slice(0, 10)}: spend ${(Number(m.spendMinor) / 100).toFixed(2)}, ${m.impressions} imp, ${m.clicks} clicks, ${m.conversions} conv`).join("\n");
      return `- ${c.name} (id ${c.id}) [${c.adAccount.provider}, ${c.status}] daily budget ${c.dailyBudgetMinor != null ? (Number(c.dailyBudgetMinor) / 100).toFixed(2) : "n/a"} ${c.adAccount.currency}; spend ${s.toFixed(2)}, ${c.impressions} imp, ${c.clicks} clicks (CTR ${ctr}%), ${c.conversions} conv (CPA ${cpa}), ROAS ${roas}${daily ? `\n${daily}` : ""}`;
    })
    .join("\n");
}

export const systemAdsCtx = () => systemContext();
