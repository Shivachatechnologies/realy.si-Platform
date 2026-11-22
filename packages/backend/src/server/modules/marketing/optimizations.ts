import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { MarketingOptimizationStatus, MarketingSocialProvider } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask } from "@/server/modules/agents/service";
import { pausedCompanyIds } from "./ai-pause";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { authorize, isUuid } from "./common";
import { extractJson } from "./ai";
import { adPerformanceText, changeAdBudget, changeAdStatus } from "./ads";
import { postAction } from "./social";
import { updateAutopilot } from "./autopilot";
import { unifiedAnalytics } from "./intelligence";
import { learningsContext } from "./learning";

/**
 * Optimize: proposals computed from real performance (rules) or suggested by the AI analyst. A proposal changes nothing
 * until a person approves it; then its exact `action` is applied through the owning service (ads at the provider, the
 * publishing queue, the autopilot plan) and the provider's outcome — success or the real error — is stored.
 */

export const OPTIMIZATION_KINDS = ["retry_failed_post", "pause_ad", "ad_budget", "autopilot_windows", "shift_cadence"] as const;
export type OptimizationKind = (typeof OPTIMIZATION_KINDS)[number];
export const OPTIMIZATION_STATUSES = ["PROPOSED", "APPLIED", "REJECTED", "FAILED", "EXPIRED"] as const satisfies readonly MarketingOptimizationStatus[];
export const OPTIMIZATION_REVIEW_SUBJECT = "marketing_optimization_review";

const PLATFORMS = ["LINKEDIN", "X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK", "THREADS", "PINTEREST"] as const;
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const majorMoney = z.string().regex(/^\d{1,9}(\.\d{1,2})?$/);

export const ACTION_SCHEMAS = {
  retry_failed_post: z.object({ postId: z.string().uuid() }).strict(),
  pause_ad: z.object({ adCampaignId: z.string().uuid() }).strict(),
  ad_budget: z.object({ adCampaignId: z.string().uuid(), dailyBudget: majorMoney }).strict(),
  autopilot_windows: z.object({ autopilotId: z.string().uuid(), platform: z.enum(PLATFORMS), windows: z.array(hhmm).min(1).max(12) }).strict(),
  shift_cadence: z.object({ autopilotId: z.string().uuid(), from: z.enum(PLATFORMS), to: z.enum(PLATFORMS), amount: z.number().int().min(1).max(5) }).strict(),
} satisfies Record<OptimizationKind, z.ZodType>;

export const decisionInput = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1000).optional() });

const ENTITY: Record<OptimizationKind, string> = {
  retry_failed_post: "marketing_social_post",
  pause_ad: "marketing_ad_campaign",
  ad_budget: "marketing_ad_campaign",
  autopilot_windows: "marketing_autopilot",
  shift_cadence: "marketing_autopilot",
};
const entityIdOf = (kind: OptimizationKind, action: Record<string, unknown>) => String(kind === "retry_failed_post" ? action.postId : kind === "pause_ad" || kind === "ad_budget" ? action.adCampaignId : action.autopilotId);

const week = (d = new Date()) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
};
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const major = (m: bigint | number) => (Number(m) / 100).toFixed(2);

interface Proposal {
  kind: OptimizationKind;
  title: string;
  rationale: string;
  action: Record<string, unknown>;
  evidence: Record<string, unknown>;
  dedupeKey: string;
  source?: "rules" | "ai";
  taskId?: string | null;
}

/** Insert a proposal unless one with the same dedupe key exists. Returns true when created. */
async function propose(organizationId: string, companyId: string, p: Proposal): Promise<boolean> {
  const schema = ACTION_SCHEMAS[p.kind];
  const action = schema.safeParse(p.action);
  if (!action.success) return false;
  try {
    await db().marketingOptimization.create({
      data: {
        organizationId,
        companyId,
        kind: p.kind,
        title: p.title.slice(0, 300),
        rationale: p.rationale.slice(0, 4000),
        action: action.data as Prisma.InputJsonValue,
        evidence: p.evidence as Prisma.InputJsonValue,
        source: p.source ?? "rules",
        entityType: ENTITY[p.kind],
        entityId: entityIdOf(p.kind, action.data as Record<string, unknown>),
        dedupeKey: p.dedupeKey.slice(0, 300),
        taskId: p.taskId ?? null,
      },
    });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}

const cadenceOf = (v: Prisma.JsonValue): Record<string, number> => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === "number")) : {});
const windowsOf = (v: Prisma.JsonValue): Record<string, string[]> =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, string[]] => Array.isArray(e[1])).map(([k, w]) => [k, w.filter((x) => typeof x === "string")])) : {};

/** Rule-based proposals from the company's real data. Returns how many new proposals were created. */
export async function generateOptimizations(organizationId: string, companyId: string): Promise<number> {
  let created = 0;
  const now = new Date();
  const since14 = new Date(now.getTime() - 14 * 86_400_000);
  const wk = week(now);

  // 1) Failed social deliveries that a retry can fix (not missing connections — those need a person to connect).
  const failed = await db().marketingSocialPost.findMany({
    where: { organizationId, companyId, status: { in: ["FAILED", "PARTIAL"] }, updatedAt: { gte: since14 } },
    select: { id: true, title: true, updatedAt: true, targets: { where: { status: "FAILED" }, select: { error: true, attempts: true, account: { select: { provider: true } } } } },
    take: 10,
  });
  for (const p of failed) {
    const fixable = p.targets.filter((t) => t.error && !["not_connected", "account_archived"].includes(t.error));
    if (!fixable.length) continue;
    created += Number(
      await propose(organizationId, companyId, {
        kind: "retry_failed_post",
        title: `Retry "${p.title}" on ${[...new Set(fixable.map((t) => t.account.provider))].join(", ")}`,
        rationale: `${fixable.length} platform deliveries failed with provider errors (${[...new Set(fixable.map((t) => t.error!.slice(0, 80)))].join("; ")}). Transient errors and rate limits usually succeed on a retry; if it fails again, the real error is shown.`,
        action: { postId: p.id },
        evidence: { failedTargets: fixable.length, errors: fixable.map((t) => ({ provider: t.account.provider, error: t.error, attempts: t.attempts })) },
        dedupeKey: `retry:${p.id}:${p.updatedAt.toISOString()}`,
      }),
    );
  }

  // 2) Paid ads: pause money-losing campaigns, scale profitable ones (within account caps, checked when applied).
  const ads = await db().marketingAdCampaign.findMany({ where: { organizationId, companyId, status: "ACTIVE", externalId: { not: null } }, select: { id: true, name: true, dailyBudgetMinor: true, adAccount: { select: { currency: true } } }, take: 50 });
  for (const a of ads) {
    const m = await db().marketingAdMetric.aggregate({ where: { adCampaignId: a.id, companyId, date: { gte: since14 } }, _sum: { spendMinor: true, conversions: true, revenueMinor: true, clicks: true, impressions: true }, _count: { _all: true } });
    const spend = m._sum.spendMinor ?? 0n;
    const conv = m._sum.conversions ?? 0;
    const revenue = m._sum.revenueMinor ?? 0n;
    if (m._count._all < 5 || spend <= 0n) continue;
    const daily = a.dailyBudgetMinor ?? 0n;
    const evidence = { days: m._count._all, spend: major(spend), conversions: conv, revenue: major(revenue), clicks: m._sum.clicks ?? 0, impressions: m._sum.impressions ?? 0, currency: a.adAccount.currency };
    if (conv === 0 && spend >= (daily > 0n ? daily * 5n : 5000n)) {
      created += Number(
        await propose(organizationId, companyId, {
          kind: "pause_ad",
          title: `Pause "${a.name}" — no conversions`,
          rationale: `It spent ${major(spend)} ${a.adAccount.currency} over ${m._count._all} days with ${m._sum.clicks ?? 0} clicks and no conversions. Pausing stops the spend at the provider; revise targeting or creative before reactivating.`,
          action: { adCampaignId: a.id },
          evidence,
          dedupeKey: `pause:${a.id}:${wk}`,
        }),
      );
    } else if (daily > 0n && conv >= 3 && Number(revenue) / Number(spend) >= 3) {
      const next = (daily * 120n) / 100n;
      created += Number(
        await propose(organizationId, companyId, {
          kind: "ad_budget",
          title: `Raise "${a.name}" daily budget to ${major(next)} ${a.adAccount.currency}`,
          rationale: `ROAS is ${(Number(revenue) / Number(spend)).toFixed(2)} over ${m._count._all} days (${conv} conversions). A 20% increase scales a profitable campaign; account caps are re-checked when it is applied.`,
          action: { adCampaignId: a.id, dailyBudget: major(next) },
          evidence: { ...evidence, currentDailyBudget: major(daily) },
          dedupeKey: `budget:${a.id}:${wk}`,
        }),
      );
    }
  }

  // 3) Autopilot posting windows that ignore what the data says works, and 4) cadence on a weak platform.
  const autopilots = await db().marketingAutopilot.findMany({ where: { organizationId, companyId, archivedAt: null, status: "ACTIVE" }, select: { id: true, name: true, cadence: true, postingWindows: true, timezone: true }, take: 20 });
  if (autopilots.length) {
    const learnings = await db().marketingLearning.findMany({ where: { companyId, active: true, kind: { in: ["time", "platform"] } }, orderBy: { score: "desc" }, select: { kind: true, platform: true, key: true, score: true, sampleSize: true } });
    const platformRows = learnings.filter((l) => l.kind === "platform");
    for (const ap of autopilots) {
      const cadence = cadenceOf(ap.cadence);
      const windows = windowsOf(ap.postingWindows);
      for (const platform of PLATFORMS) {
        const perDay = cadence[platform] ?? 0;
        const configured = windows[platform] ?? [];
        if (!perDay || !configured.length) continue;
        const best = learnings.filter((l) => l.kind === "time" && l.platform === platform && l.sampleSize >= 3 && /^\d{2}:\d{2}$/.test(l.key)).slice(0, Math.max(1, Math.min(configured.length, 4)));
        if (!best.length || best.every((b) => configured.includes(b.key))) continue;
        const next = [...new Set([...best.map((b) => b.key), ...configured])].slice(0, configured.length).sort();
        created += Number(
          await propose(organizationId, companyId, {
            kind: "autopilot_windows",
            title: `Post on ${platform} at ${best.map((b) => b.key).join(", ")} (${ap.timezone})`,
            rationale: `In "${ap.name}", ${platform} posts go out at ${configured.join(", ")}, but your best measured times are ${best.map((b) => `${b.key} (${pct(b.score)}, ${b.sampleSize} posts)`).join(", ")}.`,
            action: { autopilotId: ap.id, platform, windows: next },
            evidence: { current: configured, learned: best.map((b) => ({ time: b.key, engagement: b.score, posts: b.sampleSize })) },
            dedupeKey: `windows:${ap.id}:${platform}:${next.join(",")}`,
          }),
        );
      }
      // Platforms this plan posts to, ranked by measured engagement.
      const ranked = platformRows.filter((r) => (cadence[r.key] ?? 0) > 0 && r.sampleSize >= 3);
      const bestP = ranked[0];
      const worstP = ranked.length >= 2 ? ranked[ranked.length - 1] : undefined;
      if (bestP && worstP && bestP.score > worstP.score * 2) {
        created += Number(
          await propose(organizationId, companyId, {
            kind: "shift_cadence",
            title: `Move one daily ${worstP.key} slot to ${bestP.key} in "${ap.name}"`,
            rationale: `${bestP.key} averages ${pct(bestP.score)} engagement vs ${pct(worstP.score)} on ${worstP.key} (last 28 days). Shifting one post a day puts effort where it pays.`,
            action: { autopilotId: ap.id, from: worstP.key, to: bestP.key, amount: 1 },
            evidence: { best: { platform: bestP.key, engagement: bestP.score, posts: bestP.sampleSize }, worst: { platform: worstP.key, engagement: worstP.score, posts: worstP.sampleSize }, cadence },
            dedupeKey: `cadence:${ap.id}:${worstP.key}:${bestP.key}:${wk}`,
          }),
        );
      }
    }
  }

  if (created) {
    await transaction(async (tx) => {
      const users = await usersWithPermission(tx, organizationId, companyId, "marketing.manage");
      await notifyUsers(tx, organizationId, users.slice(0, 25), "marketing.optimizations_proposed", { companyId, title: String(created), href: "/marketing/optimize" });
    });
  }
  return created;
}

export async function listOptimizations(ctx: RequestContext, organizationId: string, companyId: string, status?: MarketingOptimizationStatus) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const [rows, counts] = await Promise.all([
    db().marketingOptimization.findMany({ where: { organizationId, companyId, ...(status ? { status } : {}) }, orderBy: { createdAt: "desc" }, take: 100 }),
    db().marketingOptimization.groupBy({ by: ["status"], where: { organizationId, companyId }, _count: { _all: true } }),
  ]);
  return { data: rows, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<Record<MarketingOptimizationStatus, number>> };
}

/** "Check now" from the page: run the rules for this company. */
export async function runOptimizationCheck(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  return { created: await generateOptimizations(organizationId, companyId) };
}

async function applyAction(ctx: RequestContext, organizationId: string, companyId: string, kind: OptimizationKind, raw: unknown): Promise<Record<string, unknown>> {
  switch (kind) {
    case "retry_failed_post": {
      const a = ACTION_SCHEMAS.retry_failed_post.parse(raw);
      const p = await postAction(ctx, organizationId, companyId, a.postId, { action: "retry" });
      return { postStatus: "status" in p ? p.status : null };
    }
    case "pause_ad": {
      const a = ACTION_SCHEMAS.pause_ad.parse(raw);
      await changeAdStatus(ctx, organizationId, companyId, a.adCampaignId, false);
      return { status: "PAUSED" };
    }
    case "ad_budget": {
      const a = ACTION_SCHEMAS.ad_budget.parse(raw);
      await changeAdBudget(ctx, organizationId, companyId, a.adCampaignId, a.dailyBudget);
      return { dailyBudget: a.dailyBudget };
    }
    case "autopilot_windows": {
      const a = ACTION_SCHEMAS.autopilot_windows.parse(raw);
      const ap = await db().marketingAutopilot.findFirst({ where: { id: a.autopilotId, organizationId, companyId, archivedAt: null }, select: { postingWindows: true } });
      if (!ap) throw notFound("Autopilot");
      const windows = { ...windowsOf(ap.postingWindows), [a.platform]: a.windows } as Partial<Record<MarketingSocialProvider, string[]>>;
      await updateAutopilot(ctx, organizationId, companyId, a.autopilotId, { postingWindows: windows });
      return { platform: a.platform, windows: a.windows };
    }
    case "shift_cadence": {
      const a = ACTION_SCHEMAS.shift_cadence.parse(raw);
      const ap = await db().marketingAutopilot.findFirst({ where: { id: a.autopilotId, organizationId, companyId, archivedAt: null }, select: { cadence: true } });
      if (!ap) throw notFound("Autopilot");
      const cadence = cadenceOf(ap.cadence);
      const fromN = cadence[a.from] ?? 0;
      if (fromN < a.amount) throw conflict(`The plan no longer posts ${a.amount}× a day on ${a.from}`, { reason: "marketing_optimization_stale" });
      const next = { ...cadence, [a.from]: fromN - a.amount, [a.to]: Math.min(20, (cadence[a.to] ?? 0) + a.amount) };
      await updateAutopilot(ctx, organizationId, companyId, a.autopilotId, { cadence: next });
      return { cadence: next };
    }
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 500);

/** Approve (apply now, recording the real outcome) or reject a proposal. FAILED proposals can be approved again. */
export async function decideOptimization(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof decisionInput>) {
  const input = decisionInput.parse(raw);
  if (!isUuid(id)) throw notFound("Optimization");
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const o = await db().marketingOptimization.findFirst({ where: { id, organizationId, companyId } });
  if (!o) throw notFound("Optimization");
  if (o.status !== "PROPOSED" && o.status !== "FAILED") throw conflict(`This proposal is already ${o.status.toLowerCase()}`, { reason: "marketing_invalid_transition" });
  // Claim it so a double click cannot apply twice.
  const claimed = await db().marketingOptimization.updateMany({ where: { id, status: o.status }, data: { decidedById: ctx.actor.id ?? null, decidedAt: new Date(), ...(input.decision === "reject" ? { status: "REJECTED", error: input.note ?? null } : { error: null }) } });
  if (!claimed.count) throw conflict("The proposal changed — reload", { reason: "marketing_invalid_transition" });
  if (input.decision === "reject") {
    await transaction((tx) => writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.optimization.rejected", resourceType: "marketing_optimization", resourceId: id, newValue: { kind: o.kind, note: input.note } }));
    return db().marketingOptimization.findUniqueOrThrow({ where: { id } });
  }
  const kind = o.kind as OptimizationKind;
  let result: Record<string, unknown> | null = null;
  let error: string | null = null;
  try {
    if (!(OPTIMIZATION_KINDS as readonly string[]).includes(kind)) throw conflict("Unknown optimization kind");
    result = await applyAction(ctx, organizationId, companyId, kind, o.action);
  } catch (err) {
    error = errorText(err);
  }
  return transaction(async (tx) => {
    const updated = await tx.marketingOptimization.update({
      where: { id },
      data: error ? { status: "FAILED", error } : { status: "APPLIED", appliedAt: new Date(), result: (result ?? {}) as Prisma.InputJsonValue, error: null },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: error ? "marketing.optimization.failed" : "marketing.optimization.applied", resourceType: "marketing_optimization", resourceId: id, newValue: { kind, action: o.action, result, error } });
    return updated;
  });
}

/** Ask the AI analyst to review real performance and propose optimizations (each still needs approval here). */
export async function requestAiOptimizationReview(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const now = new Date();
  const [a, adsText, learnings, autopilots, failedPosts] = await Promise.all([
    unifiedAnalytics(organizationId, companyId, { from: new Date(now.getTime() - 30 * 86_400_000), to: now }),
    adPerformanceText(organizationId, companyId),
    learningsContext(companyId),
    db().marketingAutopilot.findMany({ where: { organizationId, companyId, archivedAt: null }, select: { id: true, name: true, status: true, cadence: true, postingWindows: true, timezone: true }, take: 10 }),
    db().marketingSocialPost.findMany({ where: { organizationId, companyId, status: { in: ["FAILED", "PARTIAL"] } }, select: { id: true, title: true, targets: { where: { status: "FAILED" }, select: { error: true } } }, orderBy: { updatedAt: "desc" }, take: 10 }),
  ]);
  const data = [
    `Last 30 days: ${a.social.posts} posts, ${a.social.impressions} impressions, engagement rate ${a.social.engagementRate == null ? "n/a" : pct(a.social.engagementRate)}; platforms: ${a.platforms.map((p) => `${p.provider} ${p.posts} posts ER ${p.engagementRate == null ? "n/a" : pct(p.engagementRate)}`).join("; ") || "none"}. Email: ${a.email.sent} sent, open ${a.email.openRate == null ? "n/a" : pct(a.email.openRate)}. Ads spend ${major(a.ads.spendMinor)}, ${a.ads.conversions} conversions, ROAS ${a.ads.roas?.toFixed(2) ?? "n/a"}. Leads ${a.kpis.leadsCreated}.`,
    `Ad campaigns:\n${adsText}`,
    `Autopilots:\n${autopilots.map((p) => `- id ${p.id} "${p.name}" [${p.status}] tz ${p.timezone} cadence ${JSON.stringify(p.cadence)} windows ${JSON.stringify(p.postingWindows)}`).join("\n") || "none"}`,
    `Failed posts:\n${failedPosts.map((p) => `- id ${p.id} "${p.title}": ${p.targets.map((t) => t.error).join("; ")}`).join("\n") || "none"}`,
    learnings,
  ].join("\n\n");
  return createTask(ctx, organizationId, companyId, {
    profile: "marketing_analyst",
    title: "Optimization review",
    instructions: `Review the company's real marketing performance below and propose up to 6 concrete optimizations. Each must be one of these kinds with exactly this action shape:
- retry_failed_post: { "postId": uuid } — only for failed posts listed below with provider errors (not missing connections)
- pause_ad: { "adCampaignId": uuid } — for ACTIVE campaigns losing money
- ad_budget: { "adCampaignId": uuid, "dailyBudget": "12.50" } — new daily budget in major units
- autopilot_windows: { "autopilotId": uuid, "platform": "LINKEDIN"|"X"|..., "windows": ["09:00", ...] }
- shift_cadence: { "autopilotId": uuid, "from": platform, "to": platform, "amount": 1 }
Use only ids that appear in the data. Justify each with the numbers (put them in "evidence"). Nothing is applied until a person approves it.
Return ONLY valid JSON: [{ "kind": string, "title": string, "rationale": string, "action": object, "evidence": object }]

${data}`.slice(0, 20_000),
    subject: { type: OPTIMIZATION_REVIEW_SUBJECT, id: companyId },
  });
}

/** Worker: turn a finished AI review into proposals (validated kinds, actions and company-owned ids only). */
export async function ingestOptimizationReview(companyId: string, taskId: string): Promise<number> {
  const task = await db().agentTask.findFirst({ where: { id: taskId, companyId, subjectType: OPTIMIZATION_REVIEW_SUBJECT }, select: { organizationId: true, status: true, output: true } });
  if (!task || task.status !== "COMPLETED" || !task.output) return 0;
  const parsed = z.array(z.object({ kind: z.enum(OPTIMIZATION_KINDS), title: z.string().min(3).max(300), rationale: z.string().max(4000).default(""), action: z.record(z.string(), z.unknown()), evidence: z.record(z.string(), z.unknown()).default({}) })).max(10).safeParse(extractJson(task.output));
  if (!parsed.success) return 0;
  const orgId = task.organizationId;
  let n = 0;
  for (const [i, p] of parsed.data.entries()) {
    const action = ACTION_SCHEMAS[p.kind].safeParse(p.action);
    if (!action.success) continue;
    const entityId = entityIdOf(p.kind, action.data as Record<string, unknown>);
    const owned =
      p.kind === "retry_failed_post"
        ? await db().marketingSocialPost.count({ where: { id: entityId, companyId, status: { in: ["FAILED", "PARTIAL"] } } })
        : p.kind === "pause_ad" || p.kind === "ad_budget"
          ? await db().marketingAdCampaign.count({ where: { id: entityId, companyId, externalId: { not: null } } })
          : await db().marketingAutopilot.count({ where: { id: entityId, companyId, archivedAt: null } });
    if (!owned) continue;
    n += Number(await propose(orgId, companyId, { kind: p.kind, title: p.title, rationale: p.rationale, action: action.data as Record<string, unknown>, evidence: p.evidence, dedupeKey: `ai:${taskId}:${i}`, source: "ai", taskId }));
  }
  return n;
}

/** Worker: daily rules for companies with marketing activity; expire stale proposals. */
export async function runOptimizationLoop(): Promise<number> {
  await db().marketingOptimization.updateMany({ where: { status: "PROPOSED", createdAt: { lt: new Date(Date.now() - 21 * 86_400_000) } }, data: { status: "EXPIRED" } });
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [social, ads, aps] = await Promise.all([
    db().marketingSocialPost.groupBy({ by: ["organizationId", "companyId"], where: { updatedAt: { gte: since } } }),
    db().marketingAdCampaign.groupBy({ by: ["organizationId", "companyId"], where: { status: "ACTIVE" } }),
    db().marketingAutopilot.groupBy({ by: ["organizationId", "companyId"], where: { status: "ACTIVE", archivedAt: null } }),
  ]);
  const companies = new Map([...social, ...ads, ...aps].map((c) => [c.companyId, c.organizationId]));
  // "Pause all AI": no new proposals (and no AI review tasks) for paused companies.
  const paused = await pausedCompanyIds();
  let n = 0;
  for (const [companyId, organizationId] of companies) {
    if (paused.has(companyId)) continue;
    try {
      n += await generateOptimizations(organizationId, companyId);
    } catch (err) {
      logger.warn({ companyId, err: String(err) }, "marketing optimization loop failed");
    }
  }
  return n;
}
