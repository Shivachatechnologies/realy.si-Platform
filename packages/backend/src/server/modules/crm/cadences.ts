import { z } from "zod";
import { db, transaction, type Tx } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { getControls } from "@/server/core/platform-controls";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { actorId, authorize, isUuid } from "./common";
import { contactName } from "./contacts";
import { sendClaimed } from "./outreach";
import { processReply, resumeOutOfOffice } from "./replies";
import { isCompanyAiPaused } from "@/server/modules/workforce/autonomy-policy";

/**
 * Cadences (automated follow-up sequences). Each enrolled person moves through timed steps:
 * - EMAIL steps create an outreach email. Unless the cadence was approved for automatic sending when a person activated
 *   it, the email waits in the approval queue (/crm/outreach) and the cadence continues only after it is sent.
 * - TASK steps create a follow-up reminder for the owner.
 * The worker job (crm.cadences, every 15 minutes) runs due steps and stops an enrollment as soon as the person replies
 * (seen in a connected inbox), cancelling any email still waiting for approval.
 */

const DAY = 86_400_000;
const BATCH = 200;

const stepInput = z.object({
  kind: z.enum(["EMAIL", "TASK"]).default("EMAIL"),
  delayDays: z.number().int().min(0).max(90),
  subject: z.string().trim().max(200).default(""),
  body: z.string().trim().min(1).max(10_000),
});
export const cadenceInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  stopOnReply: z.boolean().default(true),
  steps: z
    .array(stepInput)
    .min(1)
    .max(10)
    .refine((s) => s.every((x) => x.kind !== "EMAIL" || x.subject.length > 0), { message: "Every email step needs a subject" }),
});
export const cadencePatch = cadenceInput.partial();
export const cadenceStatusInput = z.object({ status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]), autoSend: z.boolean().optional() });
export const enrollInput = z.object({ leadIds: z.array(z.string().uuid()).max(200).default([]), contactIds: z.array(z.string().uuid()).max(200).default([]) });

export const MERGE_FIELDS = ["firstName", "name", "company", "sender"] as const;
export function renderTemplate(text: string, vars: Record<(typeof MERGE_FIELDS)[number], string>) {
  return text.replace(/\{\{\s*(firstName|name|company|sender)\s*\}\}/g, (_, k: (typeof MERGE_FIELDS)[number]) => vars[k] ?? "");
}

export async function listCadences(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const rows = await db().crmCadence.findMany({
    where: { organizationId, companyId, status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { steps: { orderBy: { position: "asc" }, select: { kind: true, delayDays: true } }, _count: { select: { enrollments: true } } },
  });
  const counts = rows.length
    ? await db().crmCadenceEnrollment.groupBy({ by: ["cadenceId", "status"], where: { companyId, cadenceId: { in: rows.map((r) => r.id) } }, _count: { _all: true } })
    : [];
  return rows.map((r) => {
    const by = Object.fromEntries(counts.filter((c) => c.cadenceId === r.id).map((c) => [c.status, c._count._all])) as Partial<Record<string, number>>;
    return { ...r, active: by.ACTIVE ?? 0, replied: by.REPLIED ?? 0, completed: by.COMPLETED ?? 0 };
  });
}

export async function getCadence(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  if (!isUuid(id)) throw notFound("Sequence");
  const c = await db().crmCadence.findFirst({
    where: { id, organizationId, companyId },
    include: {
      steps: { orderBy: { position: "asc" } },
      enrollments: { orderBy: { createdAt: "desc" }, take: 200, include: { messages: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, stepPosition: true } } } },
    },
  });
  if (!c) throw notFound("Sequence");
  return c;
}

export async function createCadence(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof cadenceInput>) {
  const input = cadenceInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const c = await tx.crmCadence.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        description: input.description || null,
        stopOnReply: input.stopOnReply,
        createdById: actorId(ctx, organizationId),
        steps: { create: input.steps.map((s, i) => ({ organizationId, position: i, kind: s.kind, delayDays: s.delayDays, subject: s.subject, body: s.body })) },
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.cadence.created", resourceType: "crm_cadence", resourceId: c.id, newValue: { name: c.name, steps: input.steps.length } });
    return c;
  });
}

/** Edit name/steps. Editing the texts of an auto-sending cadence pauses it, so a person re-approves them. */
export async function updateCadence(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof cadencePatch>) {
  const input = cadencePatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    if (!isUuid(id)) throw notFound("Sequence");
    const c = await tx.crmCadence.findFirst({ where: { id, organizationId, companyId }, include: { steps: true } });
    if (!c || c.status === "ARCHIVED") throw notFound("Sequence");
    const reapprove = !!input.steps && c.autoSend && c.status === "ACTIVE";
    if (input.steps) {
      await tx.crmCadenceStep.deleteMany({ where: { cadenceId: id, companyId } });
      await tx.crmCadenceStep.createMany({ data: input.steps.map((s, i) => ({ organizationId, companyId, cadenceId: id, position: i, kind: s.kind, delayDays: s.delayDays, subject: s.subject, body: s.body })) });
    }
    const u = await tx.crmCadence.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.stopOnReply !== undefined ? { stopOnReply: input.stopOnReply } : {}),
        ...(reapprove ? { status: "PAUSED" as const, activatedAt: null, activatedById: null } : {}),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.cadence.updated", resourceType: "crm_cadence", resourceId: id, newValue: { steps: input.steps?.length ?? null, paused: reapprove } });
    return { ...u, needsReapproval: reapprove };
  });
}

/** Activate (a person approves the step texts; with autoSend they are then sent without per-email review), pause, archive. */
export async function setCadenceStatus(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof cadenceStatusInput>) {
  const input = cadenceStatusInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    if (!isUuid(id)) throw notFound("Sequence");
    const c = await tx.crmCadence.findFirst({ where: { id, organizationId, companyId }, include: { _count: { select: { steps: true } } } });
    if (!c || c.status === "ARCHIVED") throw notFound("Sequence");
    if (input.status === "ACTIVE" && !c._count.steps) throw invalid("Add at least one step first", { reason: "crm_cadence_no_steps" });
    const u = await tx.crmCadence.update({
      where: { id },
      data:
        input.status === "ACTIVE"
          ? { status: "ACTIVE", autoSend: input.autoSend ?? false, activatedAt: new Date(), activatedById: ctx.actor.id ?? null }
          : { status: input.status, ...(input.status === "ARCHIVED" ? { autoSend: false } : {}) },
    });
    if (input.status === "ARCHIVED") {
      await tx.crmCadenceEnrollment.updateMany({ where: { cadenceId: id, status: { in: ["ACTIVE", "PAUSED"] } }, data: { status: "STOPPED", stoppedReason: "sequence_archived", nextRunAt: null } });
      await tx.crmOutreachMessage.updateMany({ where: { companyId, enrollment: { cadenceId: id }, status: { in: ["DRAFT", "PENDING_APPROVAL"] } }, data: { status: "CANCELLED" } });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `crm.cadence.${input.status.toLowerCase()}`, resourceType: "crm_cadence", resourceId: id, newValue: { autoSend: u.autoSend } });
    return u;
  });
}

/** Enroll leads/contacts (people without an email, archived ones and people already in this sequence are skipped). */
export async function enroll(ctx: RequestContext, organizationId: string, companyId: string, cadenceId: string, raw: z.input<typeof enrollInput>) {
  const input = enrollInput.parse(raw);
  if (!input.leadIds.length && !input.contactIds.length) throw invalid("Pick at least one person", { reason: "crm_enroll_empty" });
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    if (!isUuid(cadenceId)) throw notFound("Sequence");
    const c = await tx.crmCadence.findFirst({ where: { id: cadenceId, organizationId, companyId, status: { not: "ARCHIVED" } }, include: { steps: { orderBy: { position: "asc" }, take: 1 } } });
    if (!c) throw notFound("Sequence");
    const first = c.steps[0];
    if (!first) throw invalid("Add at least one step first", { reason: "crm_cadence_no_steps" });
    const [leads, contacts] = await Promise.all([
      input.leadIds.length ? tx.lead.findMany({ where: { organizationId, companyId, id: { in: input.leadIds }, archivedAt: null, email: { not: null } }, select: { id: true, name: true, email: true, ownerId: true } }) : [],
      input.contactIds.length ? tx.contact.findMany({ where: { organizationId, companyId, id: { in: input.contactIds }, archivedAt: null, email: { not: null } }, select: { id: true, firstName: true, lastName: true, email: true, ownerId: true } }) : [],
    ]);
    const people = [
      ...leads.map((l) => ({ leadId: l.id, contactId: null, toEmail: l.email!.toLowerCase(), name: l.name, ownerId: l.ownerId })),
      ...contacts.map((x) => ({ leadId: null, contactId: x.id, toEmail: x.email!.toLowerCase(), name: contactName(x), ownerId: x.ownerId })),
    ];
    const nextRunAt = new Date(Date.now() + first.delayDays * DAY);
    const r = await tx.crmCadenceEnrollment.createMany({
      data: people.map((p) => ({ organizationId, companyId, cadenceId, ...p, ownerId: p.ownerId ?? ctx.actor.id ?? null, nextRunAt, enrolledById: actorId(ctx, organizationId) })),
      skipDuplicates: true,
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.cadence.enrolled", resourceType: "crm_cadence", resourceId: cadenceId, newValue: { requested: input.leadIds.length + input.contactIds.length, enrolled: r.count } });
    return { enrolled: r.count, skipped: input.leadIds.length + input.contactIds.length - r.count };
  });
}

export async function stopEnrollment(ctx: RequestContext, organizationId: string, companyId: string, enrollmentId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    if (!isUuid(enrollmentId)) throw notFound("Enrollment");
    const e = await tx.crmCadenceEnrollment.findFirst({ where: { id: enrollmentId, organizationId, companyId } });
    if (!e) throw notFound("Enrollment");
    if (e.status !== "ACTIVE" && e.status !== "PAUSED") throw conflict("This person is no longer in the sequence", { reason: "crm_enrollment_done" });
    await tx.crmCadenceEnrollment.update({ where: { id: enrollmentId }, data: { status: "STOPPED", stoppedReason: "manual", nextRunAt: null } });
    await tx.crmOutreachMessage.updateMany({ where: { enrollmentId, status: { in: ["DRAFT", "PENDING_APPROVAL"] } }, data: { status: "CANCELLED" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.cadence.unenrolled", resourceType: "crm_cadence_enrollment", resourceId: enrollmentId });
    return { ok: true };
  });
}

/** Active sequences a lead/contact is in (record pages). */
export async function enrollmentsFor(ctx: RequestContext, organizationId: string, companyId: string, ref: { leadId?: string; contactId?: string }) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  return db().crmCadenceEnrollment.findMany({
    where: { organizationId, companyId, ...(ref.leadId ? { leadId: ref.leadId } : { contactId: ref.contactId }) },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { cadence: { select: { id: true, name: true, status: true, _count: { select: { steps: true } } } } },
  });
}

/** After a sequence email was sent: move to the next step (or complete). */
export async function advanceAfterSend(tx: Tx, enrollmentId: string, now = new Date()) {
  const e = await tx.crmCadenceEnrollment.findUnique({ where: { id: enrollmentId }, include: { cadence: { include: { steps: { orderBy: { position: "asc" } } } } } });
  if (!e || e.status !== "ACTIVE") return;
  const nextIndex = e.nextStep + 1;
  const next = e.cadence.steps[nextIndex];
  await tx.crmCadenceEnrollment.update({
    where: { id: enrollmentId },
    data: next ? { nextStep: nextIndex, lastStepAt: now, nextRunAt: new Date(now.getTime() + next.delayDays * DAY) } : { nextStep: nextIndex, lastStepAt: now, nextRunAt: null, status: "COMPLETED" },
  });
}

/**
 * Worker job: run due cadence steps. Returns the number of steps processed. Waiting enrollments (an email pending
 * approval) are only checked for replies.
 */
export async function runCadences(now = new Date()): Promise<number> {
  // Sequences are automations: the platform-wide switch pauses them (nothing is lost; due steps run when re-enabled).
  if (!(await getControls()).automationsEnabled) return 0;
  const ctx = systemContext();
  // Sequences paused by an out-of-office reply continue once the person is back.
  await resumeOutOfOffice(now);
  const due = await db().crmCadenceEnrollment.findMany({
    where: { status: "ACTIVE", cadence: { status: "ACTIVE" }, OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }] },
    orderBy: { nextRunAt: "asc" },
    take: BATCH,
    include: { cadence: { include: { steps: { orderBy: { position: "asc" } } } } },
  });
  const { autopilotHasSendBudget, autopilotsForCadences, effectiveAutonomy, nextUtcDay, withUnsubscribe } = await import("./prospecting");
  const controls = await getControls();
  const { suppressionFor } = await import("./suppression");
  const autopilots = await autopilotsForCadences([...new Set(due.map((e) => e.cadenceId))]);
  // Company kill switch ("Pause all AI"), checked once per company per run.
  const pausedCache = new Map<string, boolean>();
  const companyPaused = async (organizationId: string, companyId: string) => {
    if (!pausedCache.has(companyId)) pausedCache.set(companyId, await isCompanyAiPaused(organizationId, companyId));
    return pausedCache.get(companyId)!;
  };
  let processed = 0;
  for (const e of due) {
    try {
      if (e.cadence.stopOnReply) {
        // A new reply (since enrolment, or since the last classified one) is classified and routed (replies.ts).
        const since = e.replyClassifiedAt && e.replyClassifiedAt > e.createdAt ? e.replyClassifiedAt : e.createdAt;
        const person = await db().crmProspectPerson.findFirst({ where: { companyId: e.companyId, enrollmentId: e.id }, select: { id: true } });
        const r = await processReply(
          { organizationId: e.organizationId, companyId: e.companyId, email: e.toEmail, name: e.name, leadId: e.leadId, ownerId: e.ownerId ?? e.enrolledById, prospectId: person?.id ?? null, enrollmentId: e.id, href: `/crm/sequences/${e.cadenceId}`, repliedNotice: "crm.sequence_replied" },
          since,
          now,
        );
        if (r) continue;
      }
      if (!e.nextRunAt || e.nextRunAt > now) continue; // waiting for an approval
      if (e.leadId) {
        const lead = await db().lead.findFirst({ where: { id: e.leadId, companyId: e.companyId }, select: { archivedAt: true, stage: true } });
        if (!lead || lead.archivedAt || lead.stage === "WON" || lead.stage === "LOST") {
          await db().crmCadenceEnrollment.update({ where: { id: e.id }, data: { status: "STOPPED", stoppedReason: lead?.archivedAt || !lead ? "archived" : "closed", nextRunAt: null } });
          continue;
        }
      }
      const step = e.cadence.steps[e.nextStep];
      if (!step) {
        await db().crmCadenceEnrollment.update({ where: { id: e.id }, data: { status: "COMPLETED", nextRunAt: null } });
        continue;
      }
      const [company, sender, contact] = await Promise.all([
        db().company.findFirst({ where: { id: e.companyId }, select: { name: true } }),
        db().user.findFirst({ where: { id: e.ownerId ?? e.enrolledById }, select: { name: true } }),
        e.contactId ? db().contact.findFirst({ where: { id: e.contactId, companyId: e.companyId }, select: { firstName: true, account: { select: { name: true } } } }) : Promise.resolve(null),
      ]);
      const lead = e.leadId ? await db().lead.findFirst({ where: { id: e.leadId, companyId: e.companyId }, select: { account: true } }) : null;
      const vars = {
        firstName: contact?.firstName ?? e.name.split(/\s+/)[0] ?? e.name,
        name: e.name,
        company: contact?.account?.name ?? lead?.account ?? "",
        sender: sender?.name ?? company?.name ?? "",
      };
      if (step.kind === "TASK") {
        await transaction(async (tx) => {
          const note = renderTemplate(step.body, vars).slice(0, 1000);
          if (e.leadId) await tx.leadFollowUp.create({ data: { organizationId: e.organizationId, companyId: e.companyId, leadId: e.leadId, dueAt: now, note, priority: "MEDIUM", createdById: e.enrolledById } });
          else await tx.crmFollowUp.create({ data: { organizationId: e.organizationId, companyId: e.companyId, contactId: e.contactId, dueAt: now, note, priority: "MEDIUM", assigneeId: e.ownerId, createdById: e.enrolledById } });
          await advanceAfterSend(tx, e.id, now);
        });
        processed++;
        continue;
      }
      // Do-not-contact (unsubscribed, bounced, blocked): stop instead of writing another email.
      const hit = await suppressionFor(db(), e.companyId, e.toEmail);
      if (hit) {
        await db().crmCadenceEnrollment.updateMany({ where: { id: e.id, status: "ACTIVE" }, data: { status: "STOPPED", stoppedReason: "do_not_contact", nextRunAt: null } });
        continue;
      }
      // Follow-ups of a prospecting autopilot respect its status and daily send cap (deferred to tomorrow when reached).
      const autopilot = autopilots.get(e.cadenceId) ?? null;
      if (autopilot && autopilot.status !== "ACTIVE") continue;
      // While the company's AI is paused the AI SDR's follow-ups wait (nothing is lost), and no sequence email is sent
      // automatically: it is queued for a person's approval instead.
      const paused = await companyPaused(e.organizationId, e.companyId);
      if (autopilot && paused) continue;
      if (autopilot && !(await autopilotHasSendBudget(autopilot, now))) {
        await db().crmCadenceEnrollment.updateMany({ where: { id: e.id, status: "ACTIVE", nextRunAt: e.nextRunAt }, data: { nextRunAt: nextUtcDay(now) } });
        continue;
      }
      let auto = e.cadence.autoSend && !!e.cadence.activatedAt && !paused;
      if (auto && autopilot) {
        // Autopilot follow-ups auto-send only within its effective autonomy and to verified addresses.
        const person = await db().crmProspectPerson.findFirst({ where: { companyId: e.companyId, enrollmentId: e.id }, select: { emailStatus: true } });
        auto = effectiveAutonomy(autopilot, controls).level === "AUTO_SEND" && person?.emailStatus === "VERIFIED";
      }
      const msg = await transaction(async (tx) => {
        const { count } = await tx.crmCadenceEnrollment.updateMany({ where: { id: e.id, status: "ACTIVE", nextStep: e.nextStep, nextRunAt: e.nextRunAt }, data: { nextRunAt: null } });
        if (!count) return null; // another run took it
        const m = await tx.crmOutreachMessage.create({
          data: {
            organizationId: e.organizationId,
            companyId: e.companyId,
            leadId: e.leadId,
            contactId: e.contactId,
            enrollmentId: e.id,
            stepPosition: step.position,
            toEmail: e.toEmail,
            toName: e.name,
            subject: renderTemplate(step.subject, vars).slice(0, 200),
            body: autopilot ? withUnsubscribe(renderTemplate(step.body, vars), autopilot, e.toEmail) : renderTemplate(step.body, vars).slice(0, 10_000),
            autopilotId: autopilot?.id ?? null,
            status: "PENDING_APPROVAL",
            ...(auto ? { approvedById: e.cadence.activatedById, approvedAt: now } : {}),
          },
        });
        if (!auto) await notifyUsers(tx, e.organizationId, [e.ownerId ?? e.enrolledById], "crm.outreach_pending", { companyId: e.companyId, title: e.name, href: "/crm/outreach" });
        return m;
      });
      if (msg && auto) {
        try {
          await sendClaimed(ctx, e.organizationId, e.companyId, msg, e.cadence.activatedById);
        } catch (err) {
          await transaction(async (tx) => {
            await tx.crmCadenceEnrollment.update({ where: { id: e.id }, data: { status: "FAILED", stoppedReason: (err instanceof Error ? err.message : "send failed").slice(0, 300) } });
            await notifyUsers(tx, e.organizationId, [e.ownerId ?? e.enrolledById], "crm.sequence_failed", { companyId: e.companyId, title: e.name, href: `/crm/sequences/${e.cadenceId}` });
          });
        }
      }
      if (msg) processed++;
    } catch (err) {
      logger.warn({ enrollmentId: e.id, error: err instanceof Error ? err.message : String(err) }, "cadence step failed");
    }
  }
  return processed;
}
