import { z } from "zod";
import type { CrmAutopilotAutonomy, CrmEmailVerification } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction, type Tx } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, isAppError, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { dispatchJob, MODULE_JOBS_QUEUE } from "@/server/core/jobs";
import { getControls, isModuleEnabled, isOrganizationSuspended, type PlatformControls } from "@/server/core/platform-controls";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { isCompanyAiPaused } from "@/server/modules/workforce/autonomy-policy";
import { webSearch } from "@/server/modules/integrations/services/research";
import {
  cleanDomain,
  connectedContactProviders,
  CONTACT_PROVIDERS,
  enrichCompany,
  findEmail,
  findPeople,
  SENIORITIES,
  verifyEmail,
  type CompanyProfile,
  type FoundPerson,
  type Seniority,
} from "@/server/modules/integrations/services/contacts";
import { unsubscribeUrl } from "@/server/modules/marketing/tracking";
import { actorId, authorize, isUuid } from "./common";
import { aiPaused } from "./channels";
import { crmModelText } from "./ai-text";
import { renderTemplate } from "./cadences";
import { addressIn, sendClaimed } from "./outreach";
import { processReply } from "./replies";
import { createLead } from "./service";
import { stopOutreachTo, suppressedDomains, suppressionFor, suppressSystem } from "./suppression";

/**
 * Prospecting autopilot — the AI SDR. Per ideal-customer profile it:
 *  1. finds companies (the founder's target list, then web research through the connected research provider),
 *  2. finds decision makers there by role / seniority (Apollo → PDL → Hunter, see integrations/services/contacts.ts),
 *  3. finds and verifies their work email (Hunter verifier; Apollo "verified"), storing status + source — nothing is
 *     guessed; unverified addresses are used only with an explicit opt-in and their own lower daily cap,
 *  4. creates leads with the lawful basis recorded, skipping the do-not-contact list and people already in the CRM,
 *  5. writes a personalized first email (connected OpenAI / Gemini, grounded in provider facts; or the founder's own
 *     template) with an unsubscribe link, and after it is sent enrols the person in the autopilot's follow-up sequence,
 *  6. stops on reply, bounce or unsubscribe, and marks meetings — the funnel counts are read from these rows.
 *
 * Autonomy is per autopilot: DRAFT_ONLY (drafts wait in /crm/outreach), REVIEW (queued for approval), AUTO_SEND (sent
 * within the daily caps; a person must approve auto-send when activating). The platform's AI autonomy ceiling lowers it
 * ("supervised" → review, "read_only" → drafts) and unverified addresses are never sent without review. There is no
 * company-level autonomy API in the workforce module yet, so the setting lives on the autopilot.
 */

const DAY = 86_400_000;
const RUN_EVERY_MS = 60 * 60_000;
const PER_RUN_FIND = 12;
const PER_RUN_DRAFT = 12;

export const AUTOPILOT_AUTONOMY = ["DRAFT_ONLY", "REVIEW", "AUTO_SEND"] as const satisfies readonly CrmAutopilotAutonomy[];
export const CONSENT_BASES = ["legitimate_interest", "consent", "existing_relationship"] as const;

const list = (max: number, len = 120) => z.array(z.string().trim().min(1).max(len)).max(max).default([]);
const followUpInput = z.object({ delayDays: z.number().int().min(1).max(30), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(5000) });

const baseInput = z.object({
  name: z.string().trim().min(1).max(120),
  audience: z.string().trim().min(3).max(300),
  pitch: z.string().trim().max(2000).default(""),
  regions: list(10, 80),
  roles: list(10, 80),
  seniorities: z.array(z.enum(SENIORITIES)).max(10).default([]),
  exclusions: list(100, 120),
  targetDomains: list(200, 253),
  dailyQuota: z.number().int().min(1).max(100).default(10),
  dailySendCap: z.number().int().min(1).max(200).default(20),
  peoplePerCompany: z.number().int().min(1).max(5).default(2),
  autonomy: z.enum(AUTOPILOT_AUTONOMY).default("REVIEW"),
  allowUnverified: z.boolean().default(false),
  unverifiedDailyCap: z.number().int().min(0).max(10).default(3),
  consentBasis: z.enum(CONSENT_BASES).default("legitimate_interest"),
  consentNote: z.string().trim().max(500).default(""),
  providerOrder: z.array(z.enum(CONTACT_PROVIDERS)).max(3).default([]),
  firstSubject: z.string().trim().max(200).default(""),
  firstBody: z.string().trim().max(5000).default(""),
  unsubscribeLine: z.string().trim().max(200).default(""),
  ownerId: z.string().uuid().optional().nullable(),
  followUps: z.array(followUpInput).max(4).optional(),
});
const capsOk = (v: { allowUnverified?: boolean; unverifiedDailyCap?: number; dailySendCap?: number }) => !v.allowUnverified || (v.unverifiedDailyCap ?? 0) < (v.dailySendCap ?? 20);
export const autopilotInput = baseInput.refine(capsOk, { message: "The daily cap for unverified addresses must be lower than the daily send cap", path: ["unverifiedDailyCap"] });
export const autopilotPatch = baseInput.partial().refine(capsOk, { message: "The daily cap for unverified addresses must be lower than the daily send cap", path: ["unverifiedDailyCap"] });
export const autopilotStatusInput = z.object({ status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]), confirmAutoSend: z.boolean().optional() });

const startOfUtcDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Directories, social networks and media sites that web research returns but which are not prospects themselves. */
const NOT_A_PROSPECT = new Set([
  "linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "youtube.com", "tiktok.com", "pinterest.com", "reddit.com", "quora.com", "medium.com",
  "wikipedia.org", "yelp.com", "tripadvisor.com", "google.com", "maps.google.com", "apple.com", "amazon.com", "ebay.com", "github.com",
  "crunchbase.com", "glassdoor.com", "indeed.com", "bloomberg.com", "forbes.com", "reuters.com", "clutch.co", "g2.com", "capterra.com", "trustpilot.com", "yellowpages.com", "bbb.org", "zoominfo.com", "apollo.io",
]);
const isDirectory = (d: string) => [...NOT_A_PROSPECT].some((x) => d === x || d.endsWith(`.${x}`));

function excludedBy(exclusions: string[], domain: string, name: string | null): string | null {
  const nm = (name ?? "").toLowerCase();
  for (const raw of exclusions) {
    const ex = raw.trim().toLowerCase();
    if (!ex) continue;
    const asDomain = cleanDomain(ex);
    if (asDomain && ex.includes(".")) {
      if (domain === asDomain || domain.endsWith(`.${asDomain}`)) return raw;
    } else if (domain.includes(ex) || nm.includes(ex)) {
      return raw;
    }
  }
  return null;
}

// ─── Effective autonomy ─────────────────────────────────────────────────────────────────────────────────────────────

export type EffectiveAutonomy = { level: CrmAutopilotAutonomy; limitedBy: "platform" | "not_approved" | null };

/** The autopilot's autonomy after the platform ceiling and the auto-send approval are applied. */
export function effectiveAutonomy(a: { autonomy: CrmAutopilotAutonomy; activatedById: string | null; activatedAt: Date | null }, controls: Pick<PlatformControls, "aiAutonomyCeiling">): EffectiveAutonomy {
  if (controls.aiAutonomyCeiling === "read_only") return { level: "DRAFT_ONLY", limitedBy: a.autonomy === "DRAFT_ONLY" ? null : "platform" };
  if (a.autonomy === "AUTO_SEND") {
    if (controls.aiAutonomyCeiling !== "full") return { level: "REVIEW", limitedBy: "platform" };
    if (!a.activatedById || !a.activatedAt) return { level: "REVIEW", limitedBy: "not_approved" };
  }
  return { level: a.autonomy, limitedBy: null };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────────────────────────────────────────────

async function loadAutopilot(client: Tx | ReturnType<typeof db>, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Autopilot");
  const a = await client.crmProspectingAutopilot.findFirst({ where: { id, organizationId, companyId, status: { not: "ARCHIVED" } } });
  if (!a) throw notFound("Autopilot");
  return a;
}

const cleanList = (v: string[] | undefined) => (v ? [...new Set(v.map((x) => x.trim()).filter(Boolean))] : undefined);
const cleanDomains = (v: string[] | undefined) => (v ? [...new Set(v.map((x) => cleanDomain(x)).filter((x): x is string => !!x))] : undefined);

async function writeFollowUps(tx: Tx, organizationId: string, companyId: string, autopilot: { id: string; name: string; cadenceId: string | null; createdById: string }, steps: z.infer<typeof followUpInput>[]) {
  if (autopilot.cadenceId) {
    const c = await tx.crmCadence.findFirst({ where: { id: autopilot.cadenceId, companyId } });
    if (c && c.status !== "ARCHIVED") {
      await tx.crmCadenceStep.deleteMany({ where: { cadenceId: c.id, companyId } });
      if (steps.length) await tx.crmCadenceStep.createMany({ data: steps.map((s, i) => ({ organizationId, companyId, cadenceId: c.id, position: i, kind: "EMAIL" as const, delayDays: s.delayDays, subject: s.subject, body: s.body })) });
      return c.id;
    }
  }
  if (!steps.length) return null;
  const c = await tx.crmCadence.create({
    data: {
      organizationId,
      companyId,
      name: `${autopilot.name} · follow-ups`.slice(0, 120),
      description: "Follow-ups of a prospecting autopilot (stops on reply).",
      stopOnReply: true,
      createdById: autopilot.createdById,
      steps: { create: steps.map((s, i) => ({ organizationId, position: i, kind: "EMAIL" as const, delayDays: s.delayDays, subject: s.subject, body: s.body })) },
    },
  });
  return c.id;
}

export async function createAutopilot(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof autopilotInput>) {
  const input = autopilotInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const a = await tx.crmProspectingAutopilot.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        audience: input.audience,
        pitch: input.pitch,
        regions: cleanList(input.regions)!,
        roles: cleanList(input.roles)!,
        seniorities: input.seniorities,
        exclusions: cleanList(input.exclusions)!,
        targetDomains: cleanDomains(input.targetDomains)!,
        dailyQuota: input.dailyQuota,
        dailySendCap: input.dailySendCap,
        peoplePerCompany: input.peoplePerCompany,
        autonomy: input.autonomy,
        allowUnverified: input.allowUnverified,
        unverifiedDailyCap: input.allowUnverified ? input.unverifiedDailyCap : 0,
        consentBasis: input.consentBasis,
        consentNote: input.consentNote,
        providerOrder: input.providerOrder,
        firstSubject: input.firstSubject,
        firstBody: input.firstBody,
        unsubscribeLine: input.unsubscribeLine,
        ownerId: input.ownerId ?? ctx.actor.id ?? null,
        createdById: actorId(ctx, organizationId),
      },
    });
    const cadenceId = input.followUps?.length ? await writeFollowUps(tx, organizationId, companyId, a, input.followUps) : null;
    if (cadenceId) await tx.crmProspectingAutopilot.update({ where: { id: a.id }, data: { cadenceId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.autopilot.created", resourceType: "crm_prospecting_autopilot", resourceId: a.id, newValue: { name: a.name, autonomy: a.autonomy, dailyQuota: a.dailyQuota, dailySendCap: a.dailySendCap, allowUnverified: a.allowUnverified } });
    return { ...a, cadenceId };
  });
}

/** Edit settings. Changing what an auto-sending autopilot does pauses it until a person re-approves auto-send. */
export async function updateAutopilot(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof autopilotPatch>) {
  const input = autopilotPatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const a = await loadAutopilot(tx, organizationId, companyId, id);
    const sensitive = ["autonomy", "allowUnverified", "unverifiedDailyCap", "dailySendCap", "firstSubject", "firstBody", "followUps", "pitch"].some((k) => (input as Record<string, unknown>)[k] !== undefined);
    const reapprove = sensitive && a.status === "ACTIVE" && a.autonomy === "AUTO_SEND" && !!a.activatedAt;
    const allowUnverified = input.allowUnverified ?? a.allowUnverified;
    const u = await tx.crmProspectingAutopilot.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.audience !== undefined ? { audience: input.audience } : {}),
        ...(input.pitch !== undefined ? { pitch: input.pitch } : {}),
        ...(input.regions ? { regions: cleanList(input.regions) } : {}),
        ...(input.roles ? { roles: cleanList(input.roles) } : {}),
        ...(input.seniorities ? { seniorities: input.seniorities } : {}),
        ...(input.exclusions ? { exclusions: cleanList(input.exclusions) } : {}),
        ...(input.targetDomains ? { targetDomains: cleanDomains(input.targetDomains) } : {}),
        ...(input.dailyQuota !== undefined ? { dailyQuota: input.dailyQuota } : {}),
        ...(input.dailySendCap !== undefined ? { dailySendCap: input.dailySendCap } : {}),
        ...(input.peoplePerCompany !== undefined ? { peoplePerCompany: input.peoplePerCompany } : {}),
        ...(input.autonomy !== undefined ? { autonomy: input.autonomy } : {}),
        allowUnverified,
        ...(input.unverifiedDailyCap !== undefined || input.allowUnverified !== undefined ? { unverifiedDailyCap: allowUnverified ? (input.unverifiedDailyCap ?? a.unverifiedDailyCap) : 0 } : {}),
        ...(input.consentBasis !== undefined ? { consentBasis: input.consentBasis } : {}),
        ...(input.consentNote !== undefined ? { consentNote: input.consentNote } : {}),
        ...(input.providerOrder ? { providerOrder: input.providerOrder } : {}),
        ...(input.firstSubject !== undefined ? { firstSubject: input.firstSubject } : {}),
        ...(input.firstBody !== undefined ? { firstBody: input.firstBody } : {}),
        ...(input.unsubscribeLine !== undefined ? { unsubscribeLine: input.unsubscribeLine } : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        ...(reapprove ? { status: "PAUSED" as const, activatedAt: null, activatedById: null } : {}),
      },
    });
    if (input.followUps) {
      const cadenceId = await writeFollowUps(tx, organizationId, companyId, u, input.followUps);
      if (cadenceId !== u.cadenceId) await tx.crmProspectingAutopilot.update({ where: { id }, data: { cadenceId } });
    }
    if (reapprove && u.cadenceId) await tx.crmCadence.updateMany({ where: { id: u.cadenceId, companyId, status: "ACTIVE" }, data: { status: "PAUSED" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.autopilot.updated", resourceType: "crm_prospecting_autopilot", resourceId: id, newValue: { fields: Object.keys(input), paused: reapprove } });
    return { ...u, needsReapproval: reapprove };
  });
}

/**
 * Turn on (ACTIVE), pause or archive. Activating AUTO_SEND requires `confirmAutoSend` — the person approves that the
 * autopilot may send within its caps; their id is recorded as the approver of every automatic email.
 */
export async function setAutopilotStatus(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof autopilotStatusInput>) {
  const input = autopilotStatusInput.parse(raw);
  if (input.status === "ACTIVE") {
    // Checked before the transaction: it reads the integrations tables.
    const a0 = await loadAutopilot(db(), organizationId, companyId, id);
    if (!(await connectedContactProviders(organizationId, a0.companyId)).length) {
      throw new AppError("not_configured", "Connect a contact-data provider (Apollo.io, Hunter.io or People Data Labs) first; nothing was started.", { reason: "crm_contacts_not_connected" });
    }
    if (a0.autonomy === "AUTO_SEND" && !input.confirmAutoSend) throw invalid("Please confirm that the autopilot may send emails on its own within its daily caps.", { reason: "crm_autopilot_confirm_auto_send" });
  }
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const a = await loadAutopilot(tx, organizationId, companyId, id);
    const now = new Date();
    const u = await tx.crmProspectingAutopilot.update({
      where: { id },
      data:
        input.status === "ACTIVE"
          ? { status: "ACTIVE", activatedById: ctx.actor.id ?? null, activatedAt: a.autonomy === "AUTO_SEND" ? now : a.activatedAt ?? now, nextRunAt: now, lastError: null }
          : { status: input.status, nextRunAt: null, ...(input.status === "ARCHIVED" ? { activatedAt: null } : {}) },
    });
    if (a.cadenceId) {
      if (input.status === "ACTIVE") {
        await tx.crmCadence.updateMany({ where: { id: a.cadenceId, companyId, status: { not: "ARCHIVED" } }, data: { status: "ACTIVE", autoSend: a.autonomy === "AUTO_SEND", activatedAt: now, activatedById: ctx.actor.id ?? null } });
      } else if (input.status === "PAUSED") {
        await tx.crmCadence.updateMany({ where: { id: a.cadenceId, companyId, status: "ACTIVE" }, data: { status: "PAUSED" } });
      } else {
        await tx.crmCadence.updateMany({ where: { id: a.cadenceId, companyId }, data: { status: "ARCHIVED", autoSend: false } });
        await tx.crmCadenceEnrollment.updateMany({ where: { cadenceId: a.cadenceId, status: { in: ["ACTIVE", "PAUSED"] } }, data: { status: "STOPPED", stoppedReason: "autopilot_archived", nextRunAt: null } });
      }
    }
    if (input.status === "ARCHIVED") {
      await tx.crmOutreachMessage.updateMany({ where: { companyId, autopilotId: id, status: { in: ["DRAFT", "PENDING_APPROVAL"] } }, data: { status: "CANCELLED" } });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `crm.autopilot.${input.status.toLowerCase()}`, resourceType: "crm_prospecting_autopilot", resourceId: id, newValue: { autonomy: a.autonomy, autoSendApproved: input.status === "ACTIVE" && a.autonomy === "AUTO_SEND" } });
    return u;
  });
}

/** "Run now": queue a run on the worker (or run it here when no queue is configured). */
export async function runAutopilotNow(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "sales.manage");
  const a = await loadAutopilot(db(), organizationId, companyId, id);
  if (a.status !== "ACTIVE") throw conflict("Turn the autopilot on first.", { reason: "crm_autopilot_not_active" });
  if (await isCompanyAiPaused(organizationId, companyId)) throw conflict("All AI in this company is paused (Autonomy → Pause all AI). The autopilot did not run.", { reason: "company_ai_paused" });
  await db().crmProspectingAutopilot.update({ where: { id }, data: { nextRunAt: new Date() } });
  const queued = await dispatchJob(MODULE_JOBS_QUEUE, "crm.autopilot_run", { autopilotId: id }, { jobId: `autopilot_${id}_${Math.floor(Date.now() / 60_000)}`, organizationId });
  if (queued) return { queued: true, run: null };
  const run = await runAutopilot(id, { force: true });
  return { queued: false, run };
}

// ─── Reads: funnel, people, runs ─────────────────────────────────────────────────────────────────────────────────────

export interface Funnel {
  companies: number;
  found: number;
  verified: number;
  contacted: number;
  replied: number;
  meetings: number;
  skipped: number;
  bounced: number;
  unsubscribed: number;
  awaitingApproval: number;
  drafts: number;
  sentToday: number;
}

export async function funnelOf(companyId: string, autopilotIds: string[] | null): Promise<Funnel> {
  const ap = autopilotIds ? { autopilotId: { in: autopilotIds } } : {};
  const where = { companyId, ...ap };
  const [companies, found, verified, contacted, replied, meetings, skipped, bounced, unsubscribed, awaitingApproval, drafts, sentToday] = await Promise.all([
    db().crmAutopilotCompany.count({ where: { ...where, status: { not: "PENDING" } } }),
    db().crmProspectPerson.count({ where }),
    db().crmProspectPerson.count({ where: { ...where, emailStatus: "VERIFIED" } }),
    db().crmProspectPerson.count({ where: { ...where, contactedAt: { not: null } } }),
    db().crmProspectPerson.count({ where: { ...where, repliedAt: { not: null } } }),
    db().crmProspectPerson.count({ where: { ...where, meetingAt: { not: null } } }),
    db().crmProspectPerson.count({ where: { ...where, status: "SKIPPED" } }),
    db().crmProspectPerson.count({ where: { ...where, bouncedAt: { not: null } } }),
    db().crmProspectPerson.count({ where: { ...where, unsubscribedAt: { not: null } } }),
    db().crmOutreachMessage.count({ where: { companyId, autopilotId: autopilotIds ? { in: autopilotIds } : { not: null }, status: "PENDING_APPROVAL" } }),
    db().crmOutreachMessage.count({ where: { companyId, autopilotId: autopilotIds ? { in: autopilotIds } : { not: null }, status: "DRAFT" } }),
    db().crmOutreachMessage.count({ where: { companyId, autopilotId: autopilotIds ? { in: autopilotIds } : { not: null }, status: "SENT", sentAt: { gte: startOfUtcDay() } } }),
  ]);
  return { companies, found, verified, contacted, replied, meetings, skipped, bounced, unsubscribed, awaitingApproval, drafts, sentToday };
}

export async function listAutopilots(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const [rows, controls] = await Promise.all([
    db().crmProspectingAutopilot.findMany({ where: { organizationId, companyId, status: { not: "ARCHIVED" } }, orderBy: { createdAt: "desc" }, take: 50 }),
    getControls(),
  ]);
  return Promise.all(rows.map(async (a) => ({ ...a, effective: effectiveAutonomy(a, controls), funnel: await funnelOf(companyId, [a.id]) })));
}

export async function getAutopilot(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const a = await loadAutopilot(db(), organizationId, companyId, id);
  const [controls, funnel, people, runs, cadence] = await Promise.all([
    getControls(),
    funnelOf(companyId, [a.id]),
    db().crmProspectPerson.findMany({ where: { companyId, autopilotId: a.id }, orderBy: { updatedAt: "desc" }, take: 60 }),
    db().crmAutopilotRun.findMany({ where: { companyId, autopilotId: a.id }, orderBy: { startedAt: "desc" }, take: 10 }),
    a.cadenceId ? db().crmCadence.findFirst({ where: { id: a.cadenceId, companyId }, include: { steps: { orderBy: { position: "asc" } } } }) : Promise.resolve(null),
  ]);
  return { ...a, effective: effectiveAutonomy(a, controls), funnel, people, runs, cadence };
}

export async function companyFunnel(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  return funnelOf(companyId, null);
}

// ─── Outcomes: reply / bounce / unsubscribe / meeting ───────────────────────────────────────────────────────────────

const BOUNCE_FROM = ["mailer-daemon", "postmaster", "mail delivery"];

/** Update contacted people from what happened since (mailbox replies and bounce reports, unsubscribes, meetings). */
export async function syncOutcomes(a: { id: string; organizationId: string; companyId: string; ownerId: string | null; createdById: string }, now = new Date()): Promise<number> {
  const people = await db().crmProspectPerson.findMany({
    where: { autopilotId: a.id, companyId: a.companyId, status: { in: ["CONTACTED", "REPLIED"] }, contactedAt: { not: null } },
    orderBy: { contactedAt: "asc" },
    take: 300,
    select: { id: true, status: true, emailNormalized: true, leadId: true, contactedAt: true, enrollmentId: true, fullName: true, replyClassifiedAt: true },
  });
  if (!people.length) return 0;
  const oldest = people[0]!.contactedAt!;
  const bounces = await db().commsEmailMessage.findMany({
    where: { companyId: a.companyId, direction: "INBOUND", sentAt: { gte: oldest }, thread: { organizationId: a.organizationId }, OR: BOUNCE_FROM.map((f) => ({ fromAddress: { contains: f, mode: "insensitive" as const } })) },
    select: { bodyText: true, subject: true, sentAt: true },
    orderBy: { sentAt: "desc" },
    take: 300,
  });
  let changed = 0;
  for (const p of people) {
    try {
      const email = p.emailNormalized;
      if (!email) continue;
      const since = p.contactedAt!;
      // Bounce report from the mailbox (DSN) naming this address after it was contacted.
      if (p.status === "CONTACTED" && bounces.some((b) => b.sentAt >= since && `${b.subject}\n${b.bodyText}`.toLowerCase().includes(email))) {
        await transaction(async (tx) => {
          await tx.crmProspectPerson.update({ where: { id: p.id }, data: { status: "BOUNCED", bouncedAt: now } });
          await suppressSystem(tx, a.organizationId, a.companyId, "EMAIL", email, "bounced", "bounce", "Bounce report received after a prospecting email");
          await stopOutreachTo(tx, a.companyId, "EMAIL", email);
        });
        changed++;
        continue;
      }
      // Unsubscribed (link in the email, or added to a do-not-contact list).
      const hit = await suppressionFor(db(), a.companyId, email);
      if (hit && p.status === "CONTACTED") {
        const unsub = hit.kind === "MARKETING" || hit.reason.startsWith("unsub");
        await transaction(async (tx) => {
          await tx.crmProspectPerson.update({ where: { id: p.id }, data: unsub ? { status: "UNSUBSCRIBED", unsubscribedAt: now } : { status: "STOPPED", skipReason: "do_not_contact" } });
          await stopOutreachTo(tx, a.companyId, "EMAIL", email);
        });
        changed++;
        continue;
      }
      // A reply: classified and routed (replies.ts) — unsubscribe, out of office, interested, referral, …
      if (p.status === "CONTACTED") {
        const after = p.replyClassifiedAt && p.replyClassifiedAt > since ? p.replyClassifiedAt : since;
        const r = await processReply(
          { organizationId: a.organizationId, companyId: a.companyId, email, name: p.fullName, leadId: p.leadId, ownerId: a.ownerId ?? a.createdById, prospectId: p.id, enrollmentId: p.enrollmentId, href: p.leadId ? `/crm/${p.leadId}` : "/crm/prospecting", repliedNotice: "crm.autopilot_replied" },
          after,
          now,
        );
        if (r) {
          changed++;
          continue;
        }
      }
      if (p.leadId) {
        const m = await db().crmMeeting.findFirst({ where: { companyId: a.companyId, leadId: p.leadId, createdAt: { gte: since }, status: { not: "CANCELLED" } }, select: { id: true } });
        if (m) {
          await db().crmProspectPerson.update({ where: { id: p.id }, data: { status: "MEETING", meetingAt: now, ...(p.status === "CONTACTED" ? { repliedAt: now } : {}) } });
          changed++;
        }
      }
    } catch (err) {
      logger.warn({ personId: p.id, err: err instanceof Error ? err.message : String(err) }, "autopilot outcome sync failed");
    }
  }
  return changed;
}

// ─── The run ────────────────────────────────────────────────────────────────────────────────────────────────────────

type Note = { code: string; detail?: string };
type Autopilot = Prisma.CrmProspectingAutopilotGetPayload<object>;

/** Seed companies to work on: the founder's target list first, then one web-research query per run. */
async function seedCompanies(a: Autopilot, notes: Note[], runIndex: number): Promise<number> {
  const known = new Set((await db().crmAutopilotCompany.findMany({ where: { autopilotId: a.id }, select: { domain: true }, take: 5000 })).map((c) => c.domain));
  const fresh = a.targetDomains.filter((d) => !known.has(d)).slice(0, 50);
  if (fresh.length) {
    const r = await db().crmAutopilotCompany.createMany({ data: fresh.map((d) => ({ organizationId: a.organizationId, companyId: a.companyId, autopilotId: a.id, domain: d, name: d, sourceUrl: "manual" })), skipDuplicates: true });
    return r.count;
  }
  const region = a.regions.length ? a.regions[runIndex % a.regions.length] : null;
  const query = [a.audience, region ? `in ${region}` : ""].filter(Boolean).join(" ").slice(0, 400);
  const r = await webSearch(a.organizationId, a.companyId, query, { maxResults: 15 });
  if (!r.ok) {
    notes.push({ code: r.code === "not_connected" ? "no_research_provider" : "research_failed", detail: r.code === "not_connected" ? undefined : r.error.slice(0, 200) });
    return 0;
  }
  const rows = new Map<string, { name: string; url: string }>();
  for (const x of r.data.results) {
    const d = cleanDomain(x.url);
    if (!d || isDirectory(d) || known.has(d) || rows.has(d)) continue;
    const name = (x.title.split(/\s[|\-–—:·]\s/)[0]?.trim() || d).slice(0, 200);
    rows.set(d, { name, url: x.url.slice(0, 2000) });
  }
  if (!rows.size) {
    notes.push({ code: "no_new_companies", detail: query });
    return 0;
  }
  const created = await db().crmAutopilotCompany.createMany({ data: [...rows].map(([d, v]) => ({ organizationId: a.organizationId, companyId: a.companyId, autopilotId: a.id, domain: d, name: v.name, sourceUrl: v.url })), skipDuplicates: true });
  return created.count;
}

interface RunCounters {
  companies: number;
  found: number;
  verified: number;
  leads: number;
  drafted: number;
  sent: number;
  stopped: number;
}

/** Find decision makers and their (verified) emails at pending companies, up to `need` new people. */
async function findPeopleStep(a: Autopilot, need: number, hunterConnected: boolean, notes: Note[], c: RunCounters) {
  const pending = await db().crmAutopilotCompany.findMany({ where: { autopilotId: a.id, status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 15 });
  const suppressed = await suppressedDomains(db(), a.companyId, pending.map((p) => p.domain));
  for (const co of pending) {
    if (need <= 0) break;
    const ex = suppressed.has(co.domain) ? "do_not_contact" : excludedBy(a.exclusions, co.domain, co.name);
    if (ex) {
      await db().crmAutopilotCompany.update({ where: { id: co.id }, data: { status: "EXCLUDED", error: ex.slice(0, 200) } });
      c.companies++;
      continue;
    }
    const r = await findPeople(a.organizationId, a.companyId, { domain: co.domain, titles: a.roles, seniorities: a.seniorities as Seniority[], limit: Math.min(a.peoplePerCompany, need), providers: a.providerOrder });
    if (!r.ok) {
      if (r.code === "rate_limited") {
        notes.push({ code: "provider_rate_limited", detail: r.providerId ?? undefined });
        break;
      }
      if (r.code === "not_connected") {
        notes.push({ code: "no_contact_provider" });
        break;
      }
      await db().crmAutopilotCompany.update({ where: { id: co.id }, data: { status: "FAILED", error: r.error.slice(0, 300) } });
      notes.push({ code: "provider_error", detail: `${r.providerId ?? ""}: ${r.error}`.slice(0, 200) });
      c.companies++;
      continue;
    }
    let added = 0;
    for (const p of r.data.people) {
      if (need <= 0) break;
      const person = await resolveEmail(a, p, hunterConnected);
      try {
        const status = initialStatus(a, person.emailStatus);
        await transaction(async (tx) => {
          const row = await tx.crmProspectPerson.create({
            data: {
              organizationId: a.organizationId,
              companyId: a.companyId,
              autopilotId: a.id,
              domain: co.domain,
              companyName: (person.companyName ?? co.name).slice(0, 200),
              firstName: person.firstName,
              lastName: person.lastName,
              fullName: person.fullName.slice(0, 160),
              title: person.title,
              seniority: person.seniority,
              linkedinUrl: person.linkedinUrl,
              location: person.location,
              sourceProvider: person.sourceProvider,
              externalId: person.externalId,
              email: person.email,
              emailNormalized: person.email,
              emailStatus: person.emailStatus as CrmEmailVerification,
              emailSource: person.emailSource,
              verifiedBy: person.verifiedBy,
              verifiedAt: person.emailStatus === "VERIFIED" ? new Date() : null,
              verification: person.verification as Prisma.InputJsonValue,
              status: status.status,
              skipReason: status.skipReason,
            },
          });
          await emitDomainEvent(tx, systemContext(), "crm.prospect_found", {
            organizationId: a.organizationId,
            companyId: a.companyId,
            entityType: "crm_prospect_person",
            entityId: row.id,
            data: { autopilotId: a.id, domain: co.domain, title: person.title, seniority: person.seniority, emailStatus: person.emailStatus, status: status.status, sourceProvider: person.sourceProvider },
          });
        });
        added++;
        need--;
        c.found++;
        if (person.emailStatus === "VERIFIED") c.verified++;
      } catch (err) {
        // Unique (autopilot, domain, name): already found earlier — not a new person.
        if (!(err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002")) throw err;
      }
    }
    await db().crmAutopilotCompany.update({ where: { id: co.id }, data: { status: added || r.data.people.length ? "DONE" : "NO_PEOPLE", peopleFound: added } });
    c.companies++;
  }
}

/** Fill in a missing email (finder) and verify an unverified one (Hunter) — results exactly as the providers answer. */
async function resolveEmail(a: Autopilot, p: FoundPerson, hunterConnected: boolean): Promise<FoundPerson & { verifiedBy: string | null }> {
  const out: FoundPerson & { verifiedBy: string | null } = { ...p, verification: { ...p.verification }, verifiedBy: p.emailStatus === "VERIFIED" ? p.emailSource : null };
  if (!out.email && out.firstName && (out.lastName || (out.sourceProvider === "apollo" && out.externalId))) {
    const f = await findEmail(a.organizationId, a.companyId, { firstName: out.firstName, lastName: out.lastName ?? "", domain: p.domain, apolloId: out.sourceProvider === "apollo" ? out.externalId : null, providers: a.providerOrder });
    if (f.ok && f.data.email) {
      out.email = f.data.email;
      out.emailStatus = f.data.status;
      out.emailSource = f.data.source;
      out.verification = { ...out.verification, finder: f.data.detail };
      if (f.data.status === "VERIFIED") out.verifiedBy = f.data.source;
      const d = f.data.detail as { last_name?: string | null; name?: string | null };
      // Apollo's match reveals the real last name hidden by its search: use what it returned.
      if (!out.lastName && d.last_name) {
        out.lastName = d.last_name;
        out.fullName = d.name ?? `${out.firstName} ${d.last_name}`;
      }
    }
  }
  if (out.email && out.emailStatus !== "VERIFIED" && out.emailStatus !== "INVALID" && hunterConnected) {
    const v = await verifyEmail(a.organizationId, a.companyId, out.email);
    if (v.ok) {
      out.emailStatus = v.data.status;
      out.verification = { ...out.verification, verifier: v.data.detail };
      if (v.data.status === "VERIFIED") out.verifiedBy = v.data.verifier;
    }
  }
  return out;
}

function initialStatus(a: Pick<Autopilot, "allowUnverified">, s: string): { status: "FOUND" | "SKIPPED"; skipReason: string | null } {
  if (s === "VERIFIED") return { status: "FOUND", skipReason: null };
  if (s === "NONE") return { status: "SKIPPED", skipReason: "no_email" };
  if (s === "INVALID") return { status: "SKIPPED", skipReason: "invalid_email" };
  return a.allowUnverified ? { status: "FOUND", skipReason: null } : { status: "SKIPPED", skipReason: "unverified_email" };
}

/** Turn found people into leads (consent basis recorded), skipping do-not-contact and people already in the CRM. */
async function leadsStep(a: Autopilot, c: RunCounters) {
  const ctx = systemContext();
  const people = await db().crmProspectPerson.findMany({ where: { autopilotId: a.id, status: "FOUND", leadId: null, email: { not: null } }, orderBy: { createdAt: "asc" }, take: 25 });
  for (const p of people) {
    const email = p.emailNormalized!;
    const hit = await suppressionFor(db(), a.companyId, email);
    if (hit) {
      await db().crmProspectPerson.update({ where: { id: p.id }, data: { status: "SKIPPED", skipReason: "do_not_contact" } });
      continue;
    }
    const existing = await db().lead.findFirst({ where: { companyId: a.companyId, emailNormalized: email, mergedIntoId: null }, select: { id: true } });
    const existingContact = existing ? null : await db().contact.findFirst({ where: { companyId: a.companyId, emailNormalized: email }, select: { id: true } }).catch(() => null);
    const elsewhere = await db().crmProspectPerson.findFirst({ where: { companyId: a.companyId, emailNormalized: email, id: { not: p.id }, OR: [{ contactedAt: { not: null } }, { leadId: { not: null } }] }, select: { id: true } });
    if (existing || existingContact || elsewhere) {
      await db().crmProspectPerson.update({ where: { id: p.id }, data: { status: "SKIPPED", skipReason: "already_in_crm", leadId: existing?.id ?? null } });
      continue;
    }
    const notes = [
      `Found by the prospecting autopilot "${a.name}" (${p.sourceProvider}).`,
      p.title ? `Role: ${p.title}` : "",
      p.linkedinUrl ? `LinkedIn: ${p.linkedinUrl}` : "",
      `Email: ${p.emailStatus.toLowerCase()}${p.verifiedBy ? ` (checked by ${p.verifiedBy})` : ""}; source: ${p.emailSource ?? "—"}.`,
      `Lawful basis for contact: ${a.consentBasis.replace(/_/g, " ")}${a.consentNote ? ` — ${a.consentNote}` : ""}.`,
    ].filter(Boolean);
    try {
      const leadInput = {
        name: p.fullName,
        email,
        account: p.companyName ?? p.domain,
        source: "Prospecting autopilot",
        tags: ["autopilot", ...(p.emailStatus === "VERIFIED" ? [] : ["unverified-email"])],
        notes: notes.join("\n").slice(0, 5000),
        ownerId: a.ownerId ?? undefined,
        territory: p.location?.slice(0, 100) ?? undefined,
        allowDuplicate: false,
      };
      // An owner who can no longer own records must not stop the autopilot: the lead then goes through intake rules.
      const lead = await createLead(ctx, a.organizationId, a.companyId, leadInput).catch((err: unknown) => {
        if (isAppError(err) && err.details?.reason === "lead_owner_ineligible") return createLead(ctx, a.organizationId, a.companyId, { ...leadInput, ownerId: undefined });
        throw err;
      });
      await db().crmProspectPerson.update({ where: { id: p.id }, data: { status: "READY", leadId: lead.id, consentBasis: a.consentBasis, consentNote: a.consentNote || null } });
      c.leads++;
    } catch (err) {
      const reason = isAppError(err) ? String(err.details?.reason ?? err.code) : "lead_failed";
      await db().crmProspectPerson.update({ where: { id: p.id }, data: { status: "SKIPPED", skipReason: reason.slice(0, 60) } });
    }
  }
}

const unsubFooter = (line: string, url: string) => `\n\n—\n${line || "If you'd rather not hear from us, unsubscribe here:"} ${url}`;

/** The email body with this autopilot's unsubscribe line + signed one-click link (added once). */
export function withUnsubscribe(body: string, a: { organizationId: string; companyId: string; unsubscribeLine: string }, email: string) {
  if (body.includes("/api/public/unsubscribe?token=")) return body;
  return `${body.trimEnd()}${unsubFooter(a.unsubscribeLine, unsubscribeUrl({ o: a.organizationId, c: a.companyId, e: email }))}`.slice(0, 10_000);
}

const EMAIL_SCHEMA = { type: "object", properties: { subject: { type: "string" }, body: { type: "string" } }, required: ["subject", "body"], additionalProperties: false };

function parseEmailJson(text: string): { subject: string; body: string } | null {
  try {
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { subject?: unknown; body?: unknown };
    const subject = typeof j.subject === "string" ? j.subject.trim() : "";
    const body = typeof j.body === "string" ? j.body.trim() : "";
    return subject && body ? { subject, body } : null;
  } catch {
    return null;
  }
}

/** Write first emails for leads that are ready, within the daily caps, and queue / send them per the autonomy. */
async function outreachStep(a: Autopilot, controls: PlatformControls, notes: Note[], c: RunCounters) {
  const today = startOfUtcDay();
  const [createdToday, sentToday] = await Promise.all([
    db().crmOutreachMessage.findMany({ where: { companyId: a.companyId, autopilotId: a.id, enrollmentId: null, createdAt: { gte: today } }, select: { id: true } }),
    db().crmOutreachMessage.count({ where: { companyId: a.companyId, autopilotId: a.id, status: "SENT", sentAt: { gte: today } } }),
  ]);
  let budget = Math.min(a.dailySendCap - createdToday.length, a.dailySendCap - sentToday, PER_RUN_DRAFT);
  if (budget <= 0) {
    notes.push({ code: "send_cap_reached" });
    return;
  }
  const unverifiedToday = createdToday.length ? await db().crmProspectPerson.count({ where: { autopilotId: a.id, firstMessageId: { in: createdToday.map((m) => m.id) }, emailStatus: { not: "VERIFIED" } } }) : 0;
  let unverifiedBudget = a.allowUnverified ? a.unverifiedDailyCap - unverifiedToday : 0;
  const people = await db().crmProspectPerson.findMany({ where: { autopilotId: a.id, status: "READY", firstMessageId: null, leadId: { not: null } }, orderBy: { createdAt: "asc" }, take: 40 });
  if (!people.length) return;
  const eff = effectiveAutonomy(a, controls);
  const useAi = !(await aiPaused(a.organizationId, a.companyId));
  const [company, sender] = await Promise.all([
    db().company.findFirst({ where: { id: a.companyId }, select: { name: true, defaultLocale: true } }),
    db().user.findFirst({ where: { id: a.ownerId ?? a.activatedById ?? a.createdById }, select: { name: true } }),
  ]);
  const profiles = new Map<string, CompanyProfile | null>();
  let aiMissing = false;
  for (const p of people) {
    if (budget <= 0) break;
    const verified = p.emailStatus === "VERIFIED";
    if (!verified && unverifiedBudget <= 0) continue;
    const email = p.emailNormalized!;
    if (await suppressionFor(db(), a.companyId, email)) {
      await db().crmProspectPerson.update({ where: { id: p.id }, data: { status: "STOPPED", skipReason: "do_not_contact" } });
      continue;
    }
    const firstName = p.firstName ?? p.fullName.split(/\s+/)[0] ?? p.fullName;
    let draft: { subject: string; body: string; ai: string | null } | null = null;
    if (useAi && !aiMissing) {
      if (!profiles.has(p.domain)) {
        const e = await enrichCompany(a.organizationId, a.companyId, p.domain, { providers: a.providerOrder });
        profiles.set(p.domain, e.ok ? e.data : null);
      }
      const prof = profiles.get(p.domain);
      const facts = [
        `Person: ${p.fullName}${p.title ? `, ${p.title}` : ""} at ${p.companyName ?? p.domain} (${p.domain})`,
        prof?.industry ? `Industry: ${prof.industry}` : "",
        prof?.employees ? `Employees: about ${prof.employees}` : "",
        prof?.location ? `Location: ${prof.location}` : "",
        prof?.description ? `About them: ${prof.description.slice(0, 600)}` : "",
      ].filter(Boolean);
      const ai = await crmModelText(a.organizationId, a.companyId, {
        profileKey: "sdr",
        operation: "crm.prospecting_first_email",
        sourceType: "crm_prospect_person",
        sourceId: p.id,
        jsonSchema: EMAIL_SCHEMA,
        system:
          "You write short, honest first sales emails (cold outreach) for a small business. Use ONLY the facts given; never invent results, customers, prices, mutual contacts or meetings. Plain text, no markdown, no placeholders in brackets, under 120 words, one clear easy question at the end. Do not add an unsubscribe line (it is added automatically). Reply with JSON only.",
        prompt: `We are ${company?.name ?? "our company"}; the sender is ${sender?.name ?? "the owner"}.\nWhat we offer and why it matters: ${a.pitch || a.audience}\nWho we help: ${a.audience}\nFacts about the recipient (from a contact-data provider):\n${facts.join("\n")}\nWrite the email in the language of this locale: ${company?.defaultLocale ?? "en-US"}.\n\nReturn JSON: {"subject": "<short subject>", "body": "<plain-text email, greeting with first name ${firstName}, signed by ${sender?.name ?? "the sender"}>"}`,
        maxTokens: 600,
        temperature: 0.5,
      });
      if (ai.ok) {
        const parsed = parseEmailJson(ai.text);
        if (parsed) draft = { subject: parsed.subject.slice(0, 200), body: parsed.body, ai: ai.via };
      } else if (ai.code === "not_configured" || ai.code === "paused") {
        aiMissing = true;
      } else {
        notes.push({ code: "ai_failed", detail: ai.error.slice(0, 200) });
      }
    }
    if (!draft && a.firstSubject && a.firstBody) {
      const vars = { firstName, name: p.fullName, company: p.companyName ?? p.domain, sender: sender?.name ?? company?.name ?? "" };
      draft = { subject: renderTemplate(a.firstSubject, vars).slice(0, 200), body: renderTemplate(a.firstBody, vars), ai: null };
    }
    if (!draft) {
      notes.push({ code: aiMissing || !useAi ? "no_ai_no_template" : "draft_failed" });
      break;
    }
    // Unverified addresses are never sent without a person's review.
    const level = !verified && eff.level === "AUTO_SEND" ? "REVIEW" : eff.level;
    const body = withUnsubscribe(draft.body, a, email);
    const auto = level === "AUTO_SEND";
    const msg = await transaction(async (tx) => {
      const { count } = await tx.crmProspectPerson.updateMany({ where: { id: p.id, firstMessageId: null, status: "READY" }, data: { status: "READY" } });
      if (!count) return null;
      const m = await tx.crmOutreachMessage.create({
        data: {
          organizationId: a.organizationId,
          companyId: a.companyId,
          leadId: p.leadId,
          toEmail: email,
          toName: p.fullName,
          subject: draft!.subject,
          body,
          status: level === "DRAFT_ONLY" ? "DRAFT" : "PENDING_APPROVAL",
          aiProvider: draft!.ai,
          autopilotId: a.id,
          ...(auto ? { approvedById: a.activatedById, approvedAt: new Date() } : {}),
        },
      });
      await tx.crmProspectPerson.update({ where: { id: p.id }, data: { firstMessageId: m.id } });
      return m;
    });
    if (!msg) continue;
    budget--;
    if (!verified) unverifiedBudget--;
    c.drafted++;
    if (auto) {
      try {
        await sendClaimed(systemContext(), a.organizationId, a.companyId, msg, a.activatedById);
        c.sent++;
      } catch (err) {
        notes.push({ code: "send_failed", detail: (err instanceof Error ? err.message : "send failed").slice(0, 200) });
        if (isAppError(err) && err.code === "not_configured") break;
      }
    }
  }
  if (aiMissing && !a.firstBody) notes.push({ code: "no_ai_no_template" });
}

/**
 * One run of an autopilot (worker job, or "Run now" with force). Skips silently when it is not due, not active, or the
 * platform/organization switches are off. Returns the run record (null when skipped).
 */
export async function runAutopilot(id: string, opts: { force?: boolean } = {}) {
  const now = new Date();
  const a = await db().crmProspectingAutopilot.findUnique({ where: { id } });
  if (!a || a.status !== "ACTIVE") return null;
  const controls = await getControls();
  if (!controls.automationsEnabled || !(await isModuleEnabled(a.organizationId, "crm")) || (await isOrganizationSuspended(a.organizationId))) return null;
  // Company kill switch ("Pause all AI"): the AI SDR does nothing — no search, drafts or sends — until it is resumed.
  if (await isCompanyAiPaused(a.organizationId, a.companyId)) {
    if (a.lastError !== "company_ai_paused") await db().crmProspectingAutopilot.update({ where: { id }, data: { lastError: "company_ai_paused" } });
    return null;
  }
  // Claim the slot so overlapping ticks / "Run now" cannot run the same autopilot twice.
  const { count } = await db().crmProspectingAutopilot.updateMany({
    where: {
      id,
      status: "ACTIVE",
      AND: [...(opts.force ? [] : [{ OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] }]), { OR: [{ lastRunAt: null }, { lastRunAt: { lt: new Date(now.getTime() - 60_000) } }] }],
    },
    data: { lastRunAt: now, nextRunAt: new Date(now.getTime() + RUN_EVERY_MS) },
  });
  if (!count) return null;
  const run = await db().crmAutopilotRun.create({ data: { organizationId: a.organizationId, companyId: a.companyId, autopilotId: a.id } });
  const notes: Note[] = [];
  const c: RunCounters = { companies: 0, found: 0, verified: 0, leads: 0, drafted: 0, sent: 0, stopped: 0 };
  let outcome = "ok";
  let lastError: string | null = null;
  try {
    c.stopped = await syncOutcomes(a, now);
    const providers = await connectedContactProviders(a.organizationId, a.companyId);
    if (!providers.length) notes.push({ code: "no_contact_provider" });
    const foundToday = await db().crmProspectPerson.count({ where: { autopilotId: a.id, createdAt: { gte: startOfUtcDay(now) } } });
    const need = Math.min(a.dailyQuota - foundToday, PER_RUN_FIND);
    if (providers.length && need > 0) {
      const pending = await db().crmAutopilotCompany.count({ where: { autopilotId: a.id, status: "PENDING" } });
      if (pending < 5) await seedCompanies(a, notes, await db().crmAutopilotRun.count({ where: { autopilotId: a.id } }));
      await findPeopleStep(a, need, providers.includes("hunter"), notes, c);
    } else if (need <= 0) {
      notes.push({ code: "daily_quota_reached" });
    }
    await leadsStep(a, c);
    await outreachStep(a, controls, notes, c);
    if (notes.some((n) => ["no_contact_provider", "provider_error", "send_failed", "no_ai_no_template", "research_failed", "provider_rate_limited", "ai_failed"].includes(n.code))) outcome = "partial";
  } catch (err) {
    outcome = "failed";
    lastError = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    logger.warn({ autopilotId: a.id, err: lastError }, "prospecting autopilot run failed");
  }
  const dedup = notes.filter((n, i) => notes.findIndex((m) => m.code === n.code && m.detail === n.detail) === i).slice(0, 20);
  const finished = await db().crmAutopilotRun.update({ where: { id: run.id }, data: { ...c, outcome, notes: dedup as unknown as Prisma.InputJsonValue, finishedAt: new Date() } });
  await db().crmProspectingAutopilot.update({ where: { id: a.id }, data: { lastError: lastError ?? (outcome === "partial" ? (dedup.find((n) => n.code !== "daily_quota_reached")?.code ?? null) : null) } });
  if (c.drafted && effectiveAutonomy(a, controls).level !== "AUTO_SEND") {
    await transaction(async (tx) => {
      const ids = (await usersWithPermission(tx, a.organizationId, a.companyId, "sales.manage")).slice(0, 20);
      await notifyUsers(tx, a.organizationId, a.ownerId ? [a.ownerId] : ids, "crm.autopilot_drafts", { companyId: a.companyId, title: String(c.drafted), href: "/crm/outreach" });
    }).catch((err) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "autopilot notification failed"));
  }
  return finished;
}

/** Worker tick: run every due active autopilot (bounded batch). */
export async function runDueAutopilots(now = new Date()): Promise<number> {
  if (!(await getControls()).automationsEnabled) return 0;
  const due = await db().crmProspectingAutopilot.findMany({ where: { status: "ACTIVE", OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] }, orderBy: { nextRunAt: { sort: "asc", nulls: "first" } }, take: 20, select: { id: true } });
  let n = 0;
  for (const a of due) {
    try {
      if (await runAutopilot(a.id)) n++;
    } catch (err) {
      logger.warn({ autopilotId: a.id, err: err instanceof Error ? err.message : String(err) }, "autopilot tick failed");
    }
  }
  return n;
}

// ─── Hooks used by outreach / cadences ──────────────────────────────────────────────────────────────────────────────

/**
 * After an autopilot email was sent: the person is CONTACTED; after the first email they are enrolled in the
 * autopilot's follow-up sequence (which stops on reply). Runs inside the send transaction.
 */
export async function afterAutopilotSend(tx: Tx, m: { id: string; companyId: string; organizationId: string; autopilotId: string | null; enrollmentId: string | null; leadId: string | null; toEmail: string; toName: string | null }, now = new Date()) {
  if (!m.autopilotId) return;
  const p = await tx.crmProspectPerson.findFirst({ where: { companyId: m.companyId, autopilotId: m.autopilotId, OR: [{ firstMessageId: m.id }, ...(m.leadId ? [{ leadId: m.leadId }] : [])] } });
  if (!p) return;
  if (!p.contactedAt) await tx.crmProspectPerson.update({ where: { id: p.id }, data: { status: "CONTACTED", contactedAt: now } });
  if (m.enrollmentId || p.enrollmentId) return;
  const a = await tx.crmProspectingAutopilot.findFirst({ where: { id: m.autopilotId, companyId: m.companyId } });
  if (!a?.cadenceId) return;
  const cadence = await tx.crmCadence.findFirst({ where: { id: a.cadenceId, companyId: m.companyId, status: { not: "ARCHIVED" } }, include: { steps: { orderBy: { position: "asc" }, take: 1 } } });
  const first = cadence?.steps[0];
  if (!cadence || !first) return;
  const e = await tx.crmCadenceEnrollment.upsert({
    where: { cadenceId_toEmail: { cadenceId: cadence.id, toEmail: addressIn(m.toEmail) } },
    create: { organizationId: m.organizationId, companyId: m.companyId, cadenceId: cadence.id, leadId: m.leadId, toEmail: addressIn(m.toEmail), name: m.toName ?? p.fullName, ownerId: a.ownerId, nextRunAt: new Date(now.getTime() + first.delayDays * DAY), enrolledById: a.activatedById ?? a.createdById },
    update: {},
  });
  await tx.crmProspectPerson.update({ where: { id: p.id }, data: { enrollmentId: e.id } });
}

/** Autopilot of a cadence (for follow-ups): its caps, unsubscribe line and status. */
export async function autopilotsForCadences(cadenceIds: string[]) {
  if (!cadenceIds.length) return new Map<string, Autopilot>();
  const rows = await db().crmProspectingAutopilot.findMany({ where: { cadenceId: { in: cadenceIds } } });
  return new Map(rows.map((r) => [r.cadenceId!, r]));
}

/** Whether an autopilot may send one more email today (its daily send cap). */
export async function autopilotHasSendBudget(a: { id: string; companyId: string; dailySendCap: number }, now = new Date()) {
  const sent = await db().crmOutreachMessage.count({ where: { companyId: a.companyId, autopilotId: a.id, status: "SENT", sentAt: { gte: startOfUtcDay(now) } } });
  return sent < a.dailySendCap;
}

export const nextUtcDay = (now = new Date()) => new Date(startOfUtcDay(now).getTime() + DAY + 60 * 60_000);

// ─── Try-it lookup (wizard) ─────────────────────────────────────────────────────────────────────────────────────────

export const lookupInput = z.object({ domain: z.string().trim().min(3).max(253), roles: list(10, 80), seniorities: z.array(z.enum(SENIORITIES)).max(10).default([]) });

/** One live lookup (no storage) so a founder can see what the provider returns before turning the autopilot on. */
export async function lookupPeople(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof lookupInput>) {
  const input = lookupInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "sales.manage");
  if (!cleanDomain(input.domain)) throw invalid("Enter a company website domain like acme.com", { reason: "crm_lookup_domain" });
  const r = await findPeople(organizationId, companyId, { domain: input.domain, titles: input.roles, seniorities: input.seniorities as Seniority[], limit: 5 });
  if (!r.ok) {
    if (r.code === "not_connected") throw new AppError("not_configured", "No contact-data provider is connected; nothing was looked up.", { reason: "crm_contacts_not_connected" });
    throw new AppError("not_available", `The contact-data provider could not answer: ${r.error}`, { reason: "crm_contacts_failed" });
  }
  return {
    provider: r.providerId,
    people: r.data.people.map((p) => ({ fullName: p.fullName, title: p.title, email: p.email, emailStatus: p.emailStatus, emailSource: p.emailSource, linkedinUrl: p.linkedinUrl, sourceProvider: p.sourceProvider })),
  };
}
