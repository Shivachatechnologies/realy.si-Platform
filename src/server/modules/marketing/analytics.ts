import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { authorize, CHANNELS, isUuid, PAGE_SIZE } from "./common";

/**
 * Marketing analytics from real rows. Attribution: a lead belongs to a campaign when Lead.source equals the campaign's
 * code (forms set it from utm_campaign / the form's campaign). New customers = leads that reached WON in the range
 * (their last update is the win). CAC = spend / new customers.
 */
export interface Range {
  from: Date;
  to: Date;
}

const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export function parseRange(raw: Record<string, string | string[] | undefined>, now = new Date()): Range & { fromStr: string; toStr: string } {
  const one = (k: string) => {
    const v = raw[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) ? new Date(`${s}T00:00:00Z`) : null);
  const preset = Number(one("days"));
  let to = valid(one("to"));
  let from = valid(one("from"));
  if (!to) to = dayOf(now);
  if (!from) from = new Date(to.getTime() - ((Number.isInteger(preset) && preset > 0 && preset <= 730 ? preset : 30) - 1) * 86_400_000);
  if (from > to) [from, to] = [to, from];
  // `to` is inclusive in the UI, exclusive internally.
  const end = new Date(to.getTime() + 86_400_000);
  return { from, to: end, fromStr: from.toISOString().slice(0, 10), toStr: to.toISOString().slice(0, 10) };
}

const upper = (s: string | null) => (s ?? "").trim().toUpperCase();

export async function computeKpis(organizationId: string, companyId: string, range: Range) {
  const client = db();
  const span = { gte: range.from, lt: range.to };
  const [spend, leadsCreated, wonInRange, convertedFromRange, emailsSent, postsPublished, submissions, campaignsActive] = await Promise.all([
    client.marketingSpend.aggregate({ where: { organizationId, companyId, spentOn: span }, _sum: { amountMinor: true } }),
    client.lead.count({ where: { organizationId, companyId, createdAt: span, mergedIntoId: null } }),
    client.lead.findMany({ where: { organizationId, companyId, stage: "WON", updatedAt: span }, select: { source: true, valueMinor: true } }),
    client.lead.count({ where: { organizationId, companyId, createdAt: span, stage: "WON" } }),
    client.marketingEmailSend.count({ where: { organizationId, companyId, status: "SENT", createdAt: span } }),
    client.marketingSocialPostTarget.count({ where: { organizationId, companyId, status: "PUBLISHED", publishedAt: span } }),
    client.marketingFormSubmission.count({ where: { organizationId, companyId, createdAt: span } }),
    client.marketingCampaign.count({ where: { organizationId, companyId, status: "ACTIVE", archivedAt: null } }),
  ]);
  const spendMinor = spend._sum.amountMinor ?? 0n;
  const newCustomers = wonInRange.length;
  const revenueMinor = wonInRange.reduce((s, l) => s + (l.valueMinor ?? 0n), 0n);
  return {
    spendMinor,
    leadsCreated,
    newCustomers,
    revenueMinor,
    cacMinor: newCustomers ? spendMinor / BigInt(newCustomers) : null,
    conversionRate: leadsCreated ? (convertedFromRange / leadsCreated) * 100 : null,
    roi: spendMinor > 0n ? (Number(revenueMinor - spendMinor) / Number(spendMinor)) * 100 : null,
    emailsSent,
    postsPublished,
    submissions,
    campaignsActive,
  };
}

/** Per-campaign attribution in the range (leads / won / revenue by Lead.source = code, spend by entries). */
export async function attribution(organizationId: string, companyId: string, range: Range) {
  const client = db();
  const span = { gte: range.from, lt: range.to };
  const campaigns = await client.marketingCampaign.findMany({
    where: { organizationId, companyId, archivedAt: null },
    select: { id: true, name: true, code: true, status: true, budgetMinor: true, currency: true, targetLeads: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const [spend, leads, won] = await Promise.all([
    client.marketingSpend.groupBy({ by: ["campaignId"], where: { organizationId, companyId, spentOn: span }, _sum: { amountMinor: true } }),
    client.lead.groupBy({ by: ["source"], where: { organizationId, companyId, createdAt: span, source: { not: null } }, _count: { _all: true } }),
    client.lead.groupBy({ by: ["source"], where: { organizationId, companyId, stage: "WON", updatedAt: span, source: { not: null } }, _count: { _all: true }, _sum: { valueMinor: true } }),
  ]);
  const leadsBy = new Map<string, number>();
  for (const l of leads) leadsBy.set(upper(l.source), (leadsBy.get(upper(l.source)) ?? 0) + l._count._all);
  const wonBy = new Map<string, { n: number; v: bigint }>();
  for (const w of won) {
    const k = upper(w.source);
    const prev = wonBy.get(k) ?? { n: 0, v: 0n };
    wonBy.set(k, { n: prev.n + w._count._all, v: prev.v + (w._sum.valueMinor ?? 0n) });
  }
  const spendBy = new Map(spend.map((s) => [s.campaignId, s._sum.amountMinor ?? 0n]));
  return campaigns.map((c) => {
    const spent = spendBy.get(c.id) ?? 0n;
    const l = leadsBy.get(c.code) ?? 0;
    const w = wonBy.get(c.code) ?? { n: 0, v: 0n };
    return {
      ...c,
      spendMinor: spent,
      leads: l,
      won: w.n,
      revenueMinor: w.v,
      cplMinor: l ? spent / BigInt(l) : null,
      cacMinor: w.n ? spent / BigInt(w.n) : null,
      roi: spent > 0n ? (Number(w.v - spent) / Number(spent)) * 100 : null,
    };
  });
}

/** Channel performance: spend by channel, form leads by utm source/medium, email and social activity. */
export async function channelPerformance(organizationId: string, companyId: string, range: Range) {
  const client = db();
  const span = { gte: range.from, lt: range.to };
  const [spend, subs, social, emailOpen, emailClick, emailSent] = await Promise.all([
    client.marketingSpend.groupBy({ by: ["channel"], where: { organizationId, companyId, spentOn: span }, _sum: { amountMinor: true } }),
    client.marketingFormSubmission.findMany({ where: { organizationId, companyId, createdAt: span }, select: { utmSource: true, utmMedium: true } }),
    client.marketingSocialPostTarget.findMany({
      where: { organizationId, companyId, status: "PUBLISHED", publishedAt: span },
      select: { likes: true, comments: true, shares: true, impressions: true, account: { select: { provider: true } } },
    }),
    client.marketingEmailSend.count({ where: { organizationId, companyId, createdAt: span, openedAt: { not: null } } }),
    client.marketingEmailSend.count({ where: { organizationId, companyId, createdAt: span, clickedAt: { not: null } } }),
    client.marketingEmailSend.count({ where: { organizationId, companyId, createdAt: span, status: "SENT" } }),
  ]);
  const channelOf = (src: string | null, medium: string | null): string => {
    const s = (src ?? "").toLowerCase();
    const m = (medium ?? "").toLowerCase();
    if (m === "email" || s === "email" || s === "newsletter") return "email";
    if (s.includes("linkedin")) return "linkedin";
    if (s === "x" || s.includes("twitter")) return "x";
    if (s.includes("instagram")) return "instagram";
    if (s.includes("facebook") || s === "fb") return "facebook";
    if (s.includes("google") && (m === "cpc" || m === "ppc" || m === "paid")) return "google_ads";
    if ((s.includes("meta") || s.includes("facebook")) && (m === "cpc" || m === "paid")) return "meta_ads";
    if (m === "organic" || s === "google" || s === "bing") return "seo";
    if (m === "referral") return "referral";
    return src || medium ? "other" : "";
  };
  const rows = new Map<string, { channel: string; spendMinor: bigint; leads: number; posts: number; engagement: number; impressions: number; sent: number; opened: number; clicked: number }>();
  const row = (ch: string) => {
    if (!rows.has(ch)) rows.set(ch, { channel: ch, spendMinor: 0n, leads: 0, posts: 0, engagement: 0, impressions: 0, sent: 0, opened: 0, clicked: 0 });
    return rows.get(ch)!;
  };
  for (const s of spend) row(s.channel).spendMinor += s._sum.amountMinor ?? 0n;
  for (const s of subs) {
    const ch = channelOf(s.utmSource, s.utmMedium);
    if (ch) row(ch).leads++;
  }
  for (const t of social) {
    const r = row(t.account.provider.toLowerCase());
    r.posts++;
    r.engagement += (t.likes ?? 0) + (t.comments ?? 0) + (t.shares ?? 0);
    r.impressions += t.impressions ?? 0;
  }
  if (emailSent || emailOpen || emailClick) Object.assign(row("email"), { sent: emailSent, opened: emailOpen, clicked: emailClick });
  const order = CHANNELS as readonly string[];
  return [...rows.values()].sort((a, b) => order.indexOf(a.channel) - order.indexOf(b.channel));
}

export async function commandCenter(ctx: RequestContext, organizationId: string, companyId: string, range: Range) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const [kpis, campaigns, channels, statusCounts, budget, upcoming] = await Promise.all([
    computeKpis(organizationId, companyId, range),
    attribution(organizationId, companyId, range),
    channelPerformance(organizationId, companyId, range),
    db().marketingCampaign.groupBy({ by: ["status"], where: { organizationId, companyId, archivedAt: null }, _count: { _all: true } }),
    db().marketingCampaign.aggregate({
      where: {
        organizationId,
        companyId,
        archivedAt: null,
        status: { in: ["PLANNED", "ACTIVE", "PAUSED", "COMPLETED"] },
        AND: [{ OR: [{ startDate: null }, { startDate: { lt: range.to } }] }, { OR: [{ endDate: null }, { endDate: { gte: range.from } }] }],
      },
      _sum: { budgetMinor: true },
    }),
    db().marketingSocialPost.findMany({
      where: { organizationId, companyId, status: "SCHEDULED" },
      orderBy: { scheduledAt: "asc" },
      take: 5,
      select: { id: true, title: true, scheduledAt: true },
    }),
  ]);
  return {
    kpis,
    campaigns,
    channels,
    statusCounts: Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all])) as Partial<Record<string, number>>,
    budgetMinor: budget._sum.budgetMinor ?? 0n,
    upcoming,
  };
}

/** One campaign's performance: lifetime and by day (leads by code, spend entries), plus attached activity. */
export async function campaignAnalytics(ctx: RequestContext, organizationId: string, companyId: string, campaignId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  if (!isUuid(campaignId)) throw notFound("Campaign");
  const c = await db().marketingCampaign.findFirst({ where: { id: campaignId, organizationId, companyId } });
  if (!c) throw notFound("Campaign");
  const client = db();
  const codeMatch = leadCodeMatch(c.code);
  const [spend, spendByChannel, leads, won, leadRows, submissions, emailStats, posts, content, emailOpened, emailClicked] = await Promise.all([
    client.marketingSpend.aggregate({ where: { companyId, campaignId }, _sum: { amountMinor: true } }),
    client.marketingSpend.groupBy({ by: ["channel"], where: { companyId, campaignId }, _sum: { amountMinor: true } }),
    client.lead.count({ where: { organizationId, companyId, ...codeMatch } }),
    client.lead.aggregate({ where: { organizationId, companyId, stage: "WON", ...codeMatch }, _count: { _all: true }, _sum: { valueMinor: true } }),
    client.lead.findMany({ where: { organizationId, companyId, ...codeMatch }, select: { id: true, name: true, stage: true, createdAt: true, valueMinor: true, currency: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    client.marketingFormSubmission.count({ where: { companyId, campaignCode: c.code } }),
    client.marketingEmailSend.groupBy({ by: ["status"], where: { companyId, emailCampaign: { campaignId } }, _count: { _all: true } }),
    client.marketingSocialPostTarget.findMany({ where: { companyId, post: { campaignId }, status: "PUBLISHED" }, select: { likes: true, comments: true, shares: true, impressions: true } }),
    client.marketingContent.groupBy({ by: ["status"], where: { companyId, campaignId, archivedAt: null }, _count: { _all: true } }),
    client.marketingEmailSend.count({ where: { companyId, emailCampaign: { campaignId }, status: "SENT", openedAt: { not: null } } }),
    client.marketingEmailSend.count({ where: { companyId, emailCampaign: { campaignId }, status: "SENT", clickedAt: { not: null } } }),
  ]);
  const emailSent = emailStats.find((e) => e.status === "SENT")?._count._all ?? 0;
  const spentMinor = spend._sum.amountMinor ?? 0n;
  const revenueMinor = won._sum.valueMinor ?? 0n;
  const wonCount = won._count._all;
  // Leads per day over the campaign's window (or the last 30 days).
  const start = c.startDate ?? new Date(Date.now() - 29 * 86_400_000);
  const days = Math.min(120, Math.max(1, Math.ceil((Math.min(Date.now(), (c.endDate ?? new Date()).getTime() + 86_400_000) - start.getTime()) / 86_400_000)));
  const series = Array.from({ length: days }, (_, i) => ({ day: new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10), leads: 0 }));
  for (const l of leadRows) {
    const s = series.find((x) => x.day === l.createdAt.toISOString().slice(0, 10));
    if (s) s.leads++;
  }
  return {
    campaign: c,
    spentMinor,
    budgetUsed: c.budgetMinor > 0n ? (Number(spentMinor) / Number(c.budgetMinor)) * 100 : null,
    spendByChannel: spendByChannel.map((s) => ({ channel: s.channel, amountMinor: s._sum.amountMinor ?? 0n })),
    leads,
    won: wonCount,
    revenueMinor,
    conversionRate: leads ? (wonCount / leads) * 100 : null,
    cplMinor: leads ? spentMinor / BigInt(leads) : null,
    cacMinor: wonCount ? spentMinor / BigInt(wonCount) : null,
    roi: spentMinor > 0n ? (Number(revenueMinor - spentMinor) / Number(spentMinor)) * 100 : null,
    leadProgress: c.targetLeads ? (leads / c.targetLeads) * 100 : null,
    revenueProgress: c.targetRevenueMinor && c.targetRevenueMinor > 0n ? (Number(revenueMinor) / Number(c.targetRevenueMinor)) * 100 : null,
    recentLeads: leadRows.slice(0, 10),
    submissions,
    emails: Object.fromEntries(emailStats.map((e) => [e.status, e._count._all])) as Partial<Record<string, number>>,
    emailOpened,
    emailClicked,
    /** Unique opens / delivered (provider-accepted) sends; opens are recorded by the signed tracking pixel. */
    openRate: emailSent ? (emailOpened / emailSent) * 100 : null,
    clickRate: emailSent ? (emailClicked / emailSent) * 100 : null,
    social: {
      published: posts.length,
      engagement: posts.reduce((s, p) => s + (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0), 0),
      impressions: posts.reduce((s, p) => s + (p.impressions ?? 0), 0),
    },
    content: Object.fromEntries(content.map((x) => [x.status, x._count._all])) as Partial<Record<string, number>>,
    series,
  };
}

/** A lead belongs to a campaign when its campaignCode or (legacy) source equals the campaign code. */
function leadCodeMatch(code: string): Prisma.LeadWhereInput {
  return { OR: [{ campaignCode: { equals: code, mode: "insensitive" } }, { source: { equals: code, mode: "insensitive" } }] };
}

async function campaignOf(organizationId: string, companyId: string, campaignId: string) {
  if (!isUuid(campaignId)) throw notFound("Campaign");
  const c = await db().marketingCampaign.findFirst({ where: { id: campaignId, organizationId, companyId }, select: { id: true, code: true, currency: true } });
  if (!c) throw notFound("Campaign");
  return c;
}

export const LEAD_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"] as const;

/** Leads attributed to a campaign (read-only CRM view), with search, stage filter and paging. */
export async function campaignLeads(ctx: RequestContext, organizationId: string, companyId: string, campaignId: string, f: { q?: string; stage?: (typeof LEAD_STAGES)[number]; page: number }) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const c = await campaignOf(organizationId, companyId, campaignId);
  const where: Prisma.LeadWhereInput = {
    organizationId,
    companyId,
    archivedAt: null,
    mergedIntoId: null,
    AND: [leadCodeMatch(c.code), ...(f.q ? [{ OR: [{ name: { contains: f.q, mode: "insensitive" as const } }, { email: { contains: f.q, mode: "insensitive" as const } }, { account: { contains: f.q, mode: "insensitive" as const } }] }] : [])],
    ...(f.stage ? { stage: f.stage } : {}),
  };
  const [total, data, byStage] = await Promise.all([
    db().lead.count({ where }),
    db().lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, name: true, email: true, account: true, stage: true, score: true, scoreLabel: true, valueMinor: true, currency: true, createdAt: true, owner: { select: { name: true } } },
    }),
    db().lead.groupBy({ by: ["stage"], where: { organizationId, companyId, archivedAt: null, mergedIntoId: null, ...leadCodeMatch(c.code) }, _count: { _all: true } }),
  ]);
  return { total, pageSize: PAGE_SIZE, data, byStage: Object.fromEntries(byStage.map((b) => [b.stage, b._count._all])) as Partial<Record<string, number>> };
}

/**
 * CRM deals attributed to a campaign: deals whose campaignCode/source is the code, or that were converted from a lead
 * of the campaign. Open pipeline (and stage-weighted), won and lost revenue per currency.
 */
export async function campaignPipeline(ctx: RequestContext, organizationId: string, companyId: string, campaignId: string, f: { status?: "OPEN" | "WON" | "LOST"; page: number }) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const c = await campaignOf(organizationId, companyId, campaignId);
  const match: Prisma.CrmDealWhereInput = {
    organizationId,
    companyId,
    archivedAt: null,
    OR: [{ campaignCode: { equals: c.code, mode: "insensitive" } }, { source: { equals: c.code, mode: "insensitive" } }, { lead: leadCodeMatch(c.code) }],
  };
  const where: Prisma.CrmDealWhereInput = { ...match, ...(f.status ? { status: f.status } : {}) };
  const [total, data, all] = await Promise.all([
    db().crmDeal.count({ where }),
    db().crmDeal.findMany({
      where,
      orderBy: [{ status: "asc" }, { expectedCloseDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        amountMinor: true,
        currency: true,
        status: true,
        probability: true,
        expectedCloseDate: true,
        closedAt: true,
        stage: { select: { name: true, probability: true } },
        account: { select: { id: true, name: true } },
        ownerId: true,
      },
    }),
    db().crmDeal.findMany({ where: match, select: { amountMinor: true, currency: true, status: true, probability: true, stage: { select: { probability: true } } }, take: 5000 }),
  ]);
  const totals = new Map<string, { open: bigint; weighted: bigint; won: bigint; lost: bigint; openCount: number; wonCount: number; lostCount: number }>();
  for (const d of all) {
    const t = totals.get(d.currency) ?? { open: 0n, weighted: 0n, won: 0n, lost: 0n, openCount: 0, wonCount: 0, lostCount: 0 };
    if (d.status === "OPEN") {
      t.open += d.amountMinor;
      t.weighted += (d.amountMinor * BigInt(d.probability ?? d.stage.probability)) / 100n;
      t.openCount++;
    } else if (d.status === "WON") {
      t.won += d.amountMinor;
      t.wonCount++;
    } else {
      t.lost += d.amountMinor;
      t.lostCount++;
    }
    totals.set(d.currency, t);
  }
  const closed = all.filter((d) => d.status !== "OPEN").length;
  const ownerIds = [...new Set(data.map((d) => d.ownerId).filter((x): x is string => !!x))];
  const owners = new Map((ownerIds.length ? await db().user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
  return {
    total,
    pageSize: PAGE_SIZE,
    data: data.map((d) => ({ ...d, ownerName: d.ownerId ? (owners.get(d.ownerId) ?? null) : null })),
    totals: [...totals.entries()].map(([currency, t]) => ({ currency, ...t })),
    winRate: closed ? (all.filter((d) => d.status === "WON").length / closed) * 100 : null,
  };
}
