import type { ModuleJobs } from "@/server/core/module-jobs";
import type { OutboxEvent } from "@/server/modules/events/relay";
import { db, transaction } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { processDueEmailCampaigns } from "./email";
import { enrollTargets, processDueEnrollments } from "./sequences";
import { processDuePosts, refreshDueMetrics } from "./social";
import { analyzePublishedItems, runAutopilots } from "./autopilot";
import { processVideoJobs } from "./assets";
import { runLearningLoop } from "./learning";
import { processScheduledPublications, syncAllSearchConsole } from "./seo-autopilot";
import { syncAllAdAccounts } from "./ads";
import { syncComments } from "./community";

interface DomainPayload {
  companyId: string;
  entityId: string;
  data: Record<string, string | number | boolean | null>;
}

/**
 * Trigger-based nurture: form.submitted / lead.created → enroll in ACTIVE sequences with that trigger. Only addresses
 * that gave marketing consent (data.marketingConsent === true, set by Marketing forms) are enrolled. Deduped per event
 * id and per (sequence, email).
 */
async function nurture(event: OutboxEvent) {
  const p = event.payload as DomainPayload;
  if (!event.organizationId || !p?.companyId || !p.data) return;
  const email = typeof p.data.email === "string" ? p.data.email : null;
  if (!email || p.data.marketingConsent !== true) return;
  const formId = typeof p.data.formId === "string" ? p.data.formId : null;
  const sequences = await db().marketingSequence.findMany({
    where: {
      organizationId: event.organizationId,
      companyId: p.companyId,
      status: "ACTIVE",
      archivedAt: null,
      trigger: event.type,
      ...(event.type === "form.submitted" ? { OR: [{ triggerFormId: null }, ...(formId ? [{ triggerFormId: formId }] : [])] } : {}),
    },
    select: { id: true, organizationId: true, companyId: true },
  });
  for (const seq of sequences) {
    const seen = await db().marketingSequenceEnrollment.findFirst({ where: { sequenceId: seq.id, sourceEventId: event.id }, select: { id: true } });
    if (seen) continue;
    const n = await transaction((tx) =>
      enrollTargets(tx, seq, [{ email, firstName: typeof p.data.firstName === "string" ? p.data.firstName : null, leadId: typeof p.data.leadId === "string" ? p.data.leadId : null }], event.id),
    );
    if (n) logger.info({ sequenceId: seq.id, eventId: event.id }, "marketing nurture enrollment");
  }
}

/** Background work of the marketing module, run by the worker (src/worker/index.ts via src/worker/modules.ts). */
export const MARKETING_JOBS: ModuleJobs = {
  periodic: [
    { name: "marketing.social_publish_queue", everyMs: 60_000, run: processDuePosts },
    { name: "marketing.email_campaigns", everyMs: 60_000, run: processDueEmailCampaigns },
    { name: "marketing.sequences", everyMs: 5 * 60_000, run: () => processDueEnrollments() },
    { name: "marketing.social_metrics", everyMs: 60 * 60_000, run: refreshDueMetrics },
    { name: "marketing.autopilot", everyMs: 2 * 60_000, run: runAutopilots },
    { name: "marketing.autopilot_analysis", everyMs: 60 * 60_000, run: analyzePublishedItems },
    { name: "marketing.video_jobs", everyMs: 60_000, run: processVideoJobs },
    { name: "marketing.cms_publications", everyMs: 60_000, run: processScheduledPublications },
    { name: "marketing.search_console", everyMs: 6 * 60 * 60_000, run: syncAllSearchConsole },
    { name: "marketing.ads_sync", everyMs: 60 * 60_000, run: syncAllAdAccounts },
    { name: "marketing.comments_sync", everyMs: 30 * 60_000, run: () => syncComments() },
    { name: "marketing.learning_loop", everyMs: 6 * 60 * 60_000, run: runLearningLoop },
  ],
  onEvent: [{ name: "marketing.nurture_enrollment", types: ["form.submitted", "lead.created"], handle: nurture }],
};
