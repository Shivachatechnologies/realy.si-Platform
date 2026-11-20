import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { logger } from "@/server/core/logger";
import { authorize } from "./common";
import { upsertRecommendation } from "./recommendations";

const WINDOW_DAYS = 28;
const MIN_SAMPLES = 2;

/** Learnings injected into generation prompts (top performers from real data). */
export async function learningsContext(companyId: string): Promise<string> {
  const rows = await db().marketingLearning.findMany({ where: { companyId, active: true }, orderBy: [{ score: "desc" }], take: 12, select: { insight: true } });
  if (!rows.length) return "";
  return `What has worked for this company recently (from real engagement data — prefer these patterns):\n${rows.map((r) => `- ${r.insight}`).join("\n")}`;
}

export async function listLearnings(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  return db().marketingLearning.findMany({ where: { organizationId, companyId, active: true }, orderBy: [{ kind: "asc" }, { score: "desc" }], take: 100 });
}

interface Sample {
  platform: string;
  hour: string;
  er: number;
  engagement: number;
  pillar: string | null;
  format: string | null;
  cta: string | null;
  hashtags: string[];
}

function hourIn(at: Date, timeZone: string) {
  try {
    return `${new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(at).padStart(2, "0")}:00`;
  } catch {
    return `${String(at.getUTCHours()).padStart(2, "0")}:00`;
  }
}

function winners(samples: Sample[], key: (s: Sample) => string | null | undefined, top = 3) {
  const groups = new Map<string, number[]>();
  for (const s of samples) {
    const k = key(s);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), s.er]);
  }
  return [...groups.entries()]
    .filter(([, v]) => v.length >= MIN_SAMPLES)
    .map(([k, v]) => ({ key: k, score: v.reduce((a, b) => a + b, 0) / v.length, n: v.length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, top);
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Self-optimizing loop for one company: compute winners from real performance and write learnings + recommendations. */
export async function computeLearnings(organizationId: string, companyId: string): Promise<number> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const company = await db().company.findUnique({ where: { id: companyId }, select: { timezone: true } });
  const tz = company?.timezone ?? "UTC";
  const targets = await db().marketingSocialPostTarget.findMany({
    where: { organizationId, companyId, status: "PUBLISHED", publishedAt: { gte: since }, metricsAt: { not: null } },
    select: { postId: true, publishedAt: true, impressions: true, likes: true, comments: true, shares: true, clicks: true, account: { select: { provider: true } }, post: { select: { hashtags: true } } },
    take: 2000,
  });
  if (!targets.length) return 0;
  const items = await db().marketingAutopilotItem.findMany({ where: { companyId, postId: { in: targets.map((t) => t.postId) } }, select: { postId: true, pillar: true, format: true, cta: true } });
  const byPost = new Map(items.map((i) => [i.postId!, i]));
  const samples: Sample[] = targets.map((t) => {
    const engagement = (t.likes ?? 0) + (t.comments ?? 0) + (t.shares ?? 0) + (t.clicks ?? 0);
    const item = byPost.get(t.postId);
    return {
      platform: t.account.provider,
      hour: hourIn(t.publishedAt!, tz),
      // Without impressions, engagement per post is the comparable unit (scaled down so it never dominates ER-based rows).
      er: t.impressions ? engagement / t.impressions : engagement / 1000,
      engagement,
      pillar: item?.pillar ?? null,
      format: item?.format ?? null,
      cta: item?.cta ? item.cta.toLowerCase().split(/\s+/).slice(0, 3).join(" ") : null,
      hashtags: t.post.hashtags,
    };
  });
  const periodEnd = new Date();
  const rows: { kind: string; platform: string | null; key: string; insight: string; score: number; sampleSize: number }[] = [];
  for (const w of winners(samples, (s) => s.platform, 8)) rows.push({ kind: "platform", platform: w.key, key: w.key, insight: `${w.key} posts average ${pct(w.score)} engagement (${w.n} posts).`, score: w.score, sampleSize: w.n });
  const platforms = [...new Set(samples.map((s) => s.platform))];
  for (const p of platforms) {
    for (const w of winners(samples.filter((s) => s.platform === p), (s) => s.hour, 3)) rows.push({ kind: "time", platform: p, key: w.key, insight: `On ${p}, posts at ${w.key} (${tz}) perform best: ${pct(w.score)} engagement (${w.n} posts).`, score: w.score, sampleSize: w.n });
  }
  for (const w of winners(samples, (s) => s.pillar)) rows.push({ kind: "topic", platform: null, key: w.key, insight: `The pillar "${w.key}" drives the most engagement (${pct(w.score)}, ${w.n} posts).`, score: w.score, sampleSize: w.n });
  for (const w of winners(samples, (s) => s.format)) rows.push({ kind: "format", platform: null, key: w.key, insight: `The ${w.key} format performs best (${pct(w.score)}, ${w.n} posts).`, score: w.score, sampleSize: w.n });
  for (const w of winners(samples, (s) => s.cta)) rows.push({ kind: "cta", platform: null, key: w.key, insight: `Calls to action starting "${w.key}…" work best (${pct(w.score)}, ${w.n} posts).`, score: w.score, sampleSize: w.n });
  const tagSamples = samples.flatMap((s) => s.hashtags.map((h) => ({ ...s, tag: h.toLowerCase() })));
  for (const w of winners(tagSamples as (Sample & { tag: string })[], (s) => (s as Sample & { tag: string }).tag, 5)) rows.push({ kind: "hashtag", platform: null, key: w.key, insight: `Hashtag ${w.key} is associated with higher engagement (${pct(w.score)}, ${w.n} posts).`, score: w.score, sampleSize: w.n });

  await db().$transaction([
    db().marketingLearning.updateMany({ where: { companyId, active: true }, data: { active: false } }),
    db().marketingLearning.createMany({ data: rows.map((r) => ({ ...r, organizationId, companyId, periodStart: since, periodEnd })) }),
  ]);

  // "What to do next" from the same data.
  const platformRows = rows.filter((r) => r.kind === "platform");
  if (platformRows.length >= 2) {
    const best = platformRows[0]!;
    const worst = platformRows[platformRows.length - 1]!;
    if (best.score > worst.score * 2) {
      await upsertRecommendation(organizationId, companyId, {
        dedupeKey: `loop:shift:${best.key}:${worst.key}:${periodEnd.toISOString().slice(0, 10)}`,
        title: `Shift cadence from ${worst.key} to ${best.key}`,
        detail: `${best.key} engagement is ${pct(best.score)} vs ${pct(worst.score)} on ${worst.key} over the last ${WINDOW_DAYS} days. Consider moving one daily slot in your autopilot plan.`,
        priority: "medium",
        href: "/marketing/autopilot",
      });
    }
  }
  const failed = await db().marketingSocialPostTarget.count({ where: { companyId, status: "FAILED", post: { updatedAt: { gte: since } } } });
  if (failed) {
    await upsertRecommendation(organizationId, companyId, { dedupeKey: `loop:failed:${periodEnd.toISOString().slice(0, 10)}`, title: `${failed} social deliveries failed in the last ${WINDOW_DAYS} days`, detail: "Open the publishing queue, filter by Failed and fix connections or content, then retry.", priority: "high", href: "/marketing/social?status=FAILED" });
  }
  const unanswered = await db().marketingEngagement.count({ where: { companyId, status: "NEW", sentiment: "negative" } });
  if (unanswered) {
    await upsertRecommendation(organizationId, companyId, { dedupeKey: `loop:negative:${periodEnd.toISOString().slice(0, 10)}`, title: `${unanswered} negative comments need a reply`, priority: "high", href: "/marketing/community?status=NEW" });
  }
  return rows.length;
}

/** Worker: weekly learning loop for companies with recent published posts. */
export async function runLearningLoop(): Promise<number> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const companies = await db().marketingSocialPostTarget.groupBy({ by: ["organizationId", "companyId"], where: { status: "PUBLISHED", publishedAt: { gte: since } } });
  let n = 0;
  for (const c of companies) {
    const last = await db().marketingLearning.findFirst({ where: { companyId: c.companyId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (last && Date.now() - last.createdAt.getTime() < 7 * 86_400_000) continue;
    try {
      n += await computeLearnings(c.organizationId, c.companyId);
    } catch (err) {
      logger.warn({ companyId: c.companyId, err: String(err) }, "marketing learning loop failed");
    }
  }
  return n;
}
