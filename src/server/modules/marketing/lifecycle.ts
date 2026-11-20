import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { authorize } from "./common";

/**
 * The autonomous marketing department as one loop: Research → Strategy → Content → Graphics → Campaign → Schedule →
 * Publish → Monitor → Analyze → Optimize. Every number is a count of real records; `attention` flags work waiting on a
 * person (reviews, failures, proposals).
 */

export const LIFECYCLE_STAGES = ["research", "strategy", "content", "graphics", "campaign", "schedule", "publish", "monitor", "analyze", "optimize"] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export interface StageState {
  key: LifecycleStage;
  /** Main count (done / live work). */
  value: number;
  /** Secondary count (in progress or waiting). */
  pending: number;
  /** Something needs a person (review, failure, proposal). */
  attention: number;
  href: string;
}

export async function departmentLifecycle(ctx: RequestContext, organizationId: string, companyId: string): Promise<StageState[]> {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 86_400_000);
  const d7 = new Date(now.getTime() - 7 * 86_400_000);
  const n14 = new Date(now.getTime() + 14 * 86_400_000);
  const w = { organizationId, companyId };
  const [
    researchReady,
    researchRunning,
    researchBlocked,
    plansLive,
    plansReview,
    contentDrafts,
    contentReview,
    assetsReady,
    assetsProcessing,
    assetsFailed,
    campaignsActive,
    campaignsPlanned,
    postsScheduled,
    contentScheduled,
    emailsScheduled,
    published,
    failed,
    engagementNew,
    metricsFresh,
    learnings,
    proposals,
    applied,
  ] = await Promise.all([
    db().marketingResearchReport.count({ where: { ...w, archivedAt: null, status: { in: ["READY", "SOURCES_ONLY"] } } }),
    db().marketingResearchReport.count({ where: { ...w, archivedAt: null, status: { in: ["RESEARCHING", "SYNTHESIZING"] } } }),
    db().marketingResearchReport.count({ where: { ...w, archivedAt: null, status: { in: ["CREDENTIAL_REQUIRED", "FAILED"] }, createdAt: { gte: d30 } } }),
    db().marketingPlan.count({ where: { ...w, status: { in: ["APPROVED", "ACTIVE"] }, periodEnd: { gte: now } } }),
    db().marketingPlan.count({ where: { ...w, status: "IN_REVIEW" } }),
    db().marketingContent.count({ where: { ...w, archivedAt: null, status: "DRAFT" } }),
    db().marketingContent.count({ where: { ...w, archivedAt: null, status: "IN_REVIEW" } }),
    db().marketingAsset.count({ where: { ...w, archivedAt: null, status: "READY", kind: { in: ["IMAGE", "VIDEO"] }, createdAt: { gte: d30 } } }),
    db().marketingAsset.count({ where: { ...w, archivedAt: null, status: "PROCESSING" } }),
    db().marketingAsset.count({ where: { ...w, archivedAt: null, status: "FAILED", createdAt: { gte: d7 } } }),
    db().marketingCampaign.count({ where: { ...w, archivedAt: null, status: "ACTIVE" } }),
    db().marketingCampaign.count({ where: { ...w, archivedAt: null, status: { in: ["DRAFT", "PLANNED"] } } }),
    db().marketingSocialPost.count({ where: { ...w, status: "SCHEDULED", scheduledAt: { lte: n14 } } }),
    db().marketingContent.count({ where: { ...w, archivedAt: null, status: "SCHEDULED", scheduledAt: { lte: n14 } } }),
    db().marketingEmailCampaign.count({ where: { ...w, status: "SCHEDULED", scheduledAt: { lte: n14 } } }),
    db().marketingSocialPostTarget.count({ where: { ...w, status: "PUBLISHED", publishedAt: { gte: d30 } } }),
    db().marketingSocialPostTarget.count({ where: { ...w, status: "FAILED", post: { updatedAt: { gte: d30 } } } }),
    db().marketingEngagement.count({ where: { ...w, status: "NEW" } }),
    db().marketingSocialPostTarget.count({ where: { ...w, status: "PUBLISHED", metricsAt: { gte: d7 } } }),
    db().marketingLearning.count({ where: { companyId, active: true } }),
    db().marketingOptimization.count({ where: { ...w, status: "PROPOSED" } }),
    db().marketingOptimization.count({ where: { ...w, status: "APPLIED", appliedAt: { gte: d30 } } }),
  ]);
  return [
    { key: "research", value: researchReady, pending: researchRunning, attention: researchBlocked, href: "/marketing/intelligence" },
    { key: "strategy", value: plansLive, pending: plansReview, attention: plansReview, href: "/marketing/strategy" },
    { key: "content", value: contentDrafts, pending: contentReview, attention: contentReview, href: "/marketing/content" },
    { key: "graphics", value: assetsReady, pending: assetsProcessing, attention: assetsFailed, href: "/marketing/studio" },
    { key: "campaign", value: campaignsActive, pending: campaignsPlanned, attention: 0, href: "/marketing/campaigns" },
    { key: "schedule", value: postsScheduled + contentScheduled + emailsScheduled, pending: 0, attention: 0, href: "/marketing/calendar" },
    { key: "publish", value: published, pending: 0, attention: failed, href: "/marketing/social" },
    { key: "monitor", value: metricsFresh, pending: engagementNew, attention: engagementNew, href: "/marketing/community" },
    { key: "analyze", value: learnings, pending: 0, attention: 0, href: "/marketing/analytics" },
    { key: "optimize", value: applied, pending: proposals, attention: proposals, href: "/marketing/optimize" },
  ];
}
