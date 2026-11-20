import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emailConfigured } from "@/server/modules/email/service";
import { actorId, authorize, isUuid, normalizeEmail, requireOwned, uuid } from "./common";
import { segmentRecipients, suppressedEmails } from "./segments";
import { sendMarketingEmail } from "./mailer";
import { assertFeature, checkLimit, recordUsage } from "@/server/modules/entitlements/service";
import { upsertRecommendation } from "./recommendations";

export const SEQUENCE_TRIGGERS = ["manual", "form.submitted", "lead.created"] as const;
export const ENROLLMENT_STATUSES = ["ACTIVE", "COMPLETED", "STOPPED", "UNSUBSCRIBED"] as const;

export const sequenceInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  trigger: z.enum(SEQUENCE_TRIGGERS).default("manual"),
  triggerFormId: uuid.or(z.literal("")).nullable().optional(),
});
export const updateSequenceInput = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  trigger: z.enum(SEQUENCE_TRIGGERS).optional(),
  triggerFormId: uuid.or(z.literal("")).nullable().optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
});
export const stepInput = z.object({
  delayHours: z.number().int().min(0).max(24 * 365),
  subject: z.string().trim().min(1).max(250),
  body: z.string().trim().min(1).max(50_000),
});
export const enrollInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("segment"), segmentId: uuid }),
  z.object({ kind: z.literal("contacts"), contactIds: z.array(uuid).min(1).max(500) }),
]);

export async function listSequences(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const rows = await db().marketingSequence.findMany({
    where: { organizationId, companyId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { triggerForm: { select: { id: true, name: true } }, _count: { select: { steps: true } } },
  });
  const stats = rows.length
    ? await db().marketingSequenceEnrollment.groupBy({ by: ["sequenceId", "status"], where: { companyId, sequenceId: { in: rows.map((r) => r.id) } }, _count: { _all: true } })
    : [];
  return rows.map((r) => ({
    ...r,
    active: stats.find((s) => s.sequenceId === r.id && s.status === "ACTIVE")?._count._all ?? 0,
    total: stats.filter((s) => s.sequenceId === r.id).reduce((n, s) => n + s._count._all, 0),
  }));
}

export async function getSequence(ctx: RequestContext, organizationId: string, companyId: string, id: string, status?: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  if (!isUuid(id)) throw notFound("Sequence");
  const s = await db().marketingSequence.findFirst({
    where: { id, organizationId, companyId },
    include: { steps: { orderBy: { position: "asc" } }, triggerForm: { select: { id: true, name: true } } },
  });
  if (!s) throw notFound("Sequence");
  const st = (ENROLLMENT_STATUSES as readonly string[]).includes(status ?? "") ? (status as (typeof ENROLLMENT_STATUSES)[number]) : undefined;
  const [enrollments, counts, sends] = await Promise.all([
    db().marketingSequenceEnrollment.findMany({ where: { companyId, sequenceId: id, ...(st ? { status: st } : {}) }, orderBy: { createdAt: "desc" }, take: 200 }),
    db().marketingSequenceEnrollment.groupBy({ by: ["status"], where: { companyId, sequenceId: id }, _count: { _all: true } }),
    db().marketingEmailSend.groupBy({ by: ["stepId", "status"], where: { companyId, enrollment: { sequenceId: id } }, _count: { _all: true } }),
  ]);
  return { sequence: s, enrollments, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<Record<string, number>>, sends };
}

export async function createSequence(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof sequenceInput>) {
  const input = sequenceInput.parse(raw);
  await assertFeature(ctx, organizationId, "feature.email_automation");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const s = await tx.marketingSequence.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        description: input.description || null,
        trigger: input.trigger,
        triggerFormId: input.trigger === "form.submitted" ? await requireOwned(tx, "marketingForm", companyId, input.triggerFormId || null, "Form") : null,
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.sequence.created", resourceType: "marketing_sequence", resourceId: s.id, newValue: { name: s.name, trigger: s.trigger } });
    return s;
  });
}

export async function updateSequence(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateSequenceInput>) {
  const input = updateSequenceInput.parse(raw);
  if (!isUuid(id)) throw notFound("Sequence");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const s = await tx.marketingSequence.findFirst({ where: { id, organizationId, companyId, archivedAt: null }, include: { _count: { select: { steps: true } } } });
    if (!s) throw notFound("Sequence");
    if (input.status === "ACTIVE" && s._count.steps === 0) throw invalid("Add at least one step first", { reason: "marketing_sequence_empty" });
    const data: Prisma.MarketingSequenceUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description || null;
    if (input.status !== undefined) data.status = input.status;
    const trigger = input.trigger ?? s.trigger;
    if (input.trigger !== undefined) data.trigger = input.trigger;
    if (input.triggerFormId !== undefined || input.trigger !== undefined) {
      data.triggerFormId = trigger === "form.submitted" ? await requireOwned(tx, "marketingForm", companyId, (input.triggerFormId ?? s.triggerFormId) || null, "Form") : null;
    }
    const updated = await tx.marketingSequence.update({ where: { id }, data });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.sequence.updated", resourceType: "marketing_sequence", resourceId: id, newValue: input });
    return updated;
  });
}

export async function archiveSequence(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Sequence");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingSequence.updateMany({ where: { id, organizationId, companyId, archivedAt: null }, data: { archivedAt: new Date(), status: "PAUSED" } });
    if (!count) throw notFound("Sequence");
    await tx.marketingSequenceEnrollment.updateMany({ where: { companyId, sequenceId: id, status: "ACTIVE" }, data: { status: "STOPPED", nextRunAt: null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.sequence.archived", resourceType: "marketing_sequence", resourceId: id });
    return { ok: true };
  });
}

async function loadSequence(tx: Tx, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Sequence");
  const s = await tx.marketingSequence.findFirst({ where: { id, organizationId, companyId, archivedAt: null } });
  if (!s) throw notFound("Sequence");
  return s;
}

export async function addStep(ctx: RequestContext, organizationId: string, companyId: string, sequenceId: string, raw: z.input<typeof stepInput>) {
  const input = stepInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    await loadSequence(tx, organizationId, companyId, sequenceId);
    const last = await tx.marketingSequenceStep.findFirst({ where: { sequenceId }, orderBy: { position: "desc" }, select: { position: true } });
    const step = await tx.marketingSequenceStep.create({ data: { organizationId, companyId, sequenceId, position: (last?.position ?? -1) + 1, ...input } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.sequence.step_added", resourceType: "marketing_sequence", resourceId: sequenceId, newValue: { stepId: step.id } });
    return step;
  });
}

export async function updateStep(ctx: RequestContext, organizationId: string, companyId: string, sequenceId: string, stepId: string, raw: z.input<typeof stepInput>) {
  const input = stepInput.parse(raw);
  if (!isUuid(stepId)) throw notFound("Step");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    await loadSequence(tx, organizationId, companyId, sequenceId);
    const { count } = await tx.marketingSequenceStep.updateMany({ where: { id: stepId, sequenceId, companyId }, data: input });
    if (!count) throw notFound("Step");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.sequence.step_updated", resourceType: "marketing_sequence", resourceId: sequenceId, newValue: { stepId } });
    return { ok: true };
  });
}

/** Removing a step keeps enrollments pointing at the same next message (indexes after it shift down). */
export async function deleteStep(ctx: RequestContext, organizationId: string, companyId: string, sequenceId: string, stepId: string) {
  if (!isUuid(stepId)) throw notFound("Step");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    await loadSequence(tx, organizationId, companyId, sequenceId);
    const steps = await tx.marketingSequenceStep.findMany({ where: { sequenceId, companyId }, orderBy: { position: "asc" }, select: { id: true } });
    const index = steps.findIndex((s) => s.id === stepId);
    if (index < 0) throw notFound("Step");
    await tx.marketingSequenceStep.delete({ where: { id: stepId } });
    await tx.marketingSequenceEnrollment.updateMany({ where: { sequenceId, status: "ACTIVE", nextStep: { gt: index } }, data: { nextStep: { decrement: 1 } } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.sequence.step_deleted", resourceType: "marketing_sequence", resourceId: sequenceId, oldValue: { stepId } });
    return { ok: true };
  });
}

interface EnrollTarget {
  email: string;
  firstName?: string | null;
  contactId?: string | null;
  leadId?: string | null;
}

/** Enroll addresses (skips suppressed and already enrolled). Returns the number enrolled. */
export async function enrollTargets(tx: Tx, seq: { id: string; organizationId: string; companyId: string }, targets: EnrollTarget[], sourceEventId?: string) {
  const first = await tx.marketingSequenceStep.findFirst({ where: { sequenceId: seq.id }, orderBy: { position: "asc" }, select: { delayHours: true } });
  const nextRunAt = new Date(Date.now() + (first?.delayHours ?? 0) * 3_600_000);
  const clean = targets.map((t) => ({ ...t, emailNormalized: normalizeEmail(t.email) })).filter((t): t is EnrollTarget & { emailNormalized: string } => !!t.emailNormalized);
  const suppressed = await suppressedEmails(tx, seq.companyId, clean.map((t) => t.emailNormalized));
  const data = clean
    .filter((t) => !suppressed.has(t.emailNormalized))
    .map((t) => ({
      organizationId: seq.organizationId,
      companyId: seq.companyId,
      sequenceId: seq.id,
      email: t.email.trim(),
      emailNormalized: t.emailNormalized,
      firstName: t.firstName ?? null,
      contactId: t.contactId ?? null,
      leadId: t.leadId ?? null,
      nextRunAt,
      sourceEventId: sourceEventId ?? null,
    }));
  if (!data.length) return 0;
  return (await tx.marketingSequenceEnrollment.createMany({ data, skipDuplicates: true })).count;
}

export async function enroll(ctx: RequestContext, organizationId: string, companyId: string, sequenceId: string, raw: z.input<typeof enrollInput>) {
  const input = enrollInput.parse(raw);
  await assertFeature(ctx, organizationId, "feature.email_automation");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const seq = await loadSequence(tx, organizationId, companyId, sequenceId);
    let targets: EnrollTarget[];
    if (input.kind === "segment") {
      const segment = await tx.marketingSegment.findFirst({ where: { id: input.segmentId, organizationId, companyId, archivedAt: null } });
      if (!segment) throw notFound("Segment");
      targets = (await segmentRecipients(tx, segment, 5000)).map((c) => ({ email: c.email!, firstName: c.firstName, contactId: c.id }));
    } else {
      const contacts = await tx.contact.findMany({
        where: { companyId, id: { in: input.contactIds }, archivedAt: null, marketingConsent: true, unsubscribedAt: null, email: { not: null } },
        select: { id: true, email: true, firstName: true },
      });
      targets = contacts.map((c) => ({ email: c.email!, firstName: c.firstName, contactId: c.id }));
    }
    const count = await enrollTargets(tx, seq, targets);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.sequence.enrolled", resourceType: "marketing_sequence", resourceId: sequenceId, newValue: { count, kind: input.kind } });
    return { enrolled: count, skipped: targets.length - count };
  });
}

export async function stopEnrollment(ctx: RequestContext, organizationId: string, companyId: string, sequenceId: string, enrollmentId: string) {
  if (!isUuid(enrollmentId)) throw notFound("Enrollment");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingSequenceEnrollment.updateMany({ where: { id: enrollmentId, sequenceId, organizationId, companyId, status: "ACTIVE" }, data: { status: "STOPPED", nextRunAt: null } });
    if (!count) throw conflict("Enrollment is not active", { reason: "marketing_enrollment_inactive" });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.sequence.enrollment_stopped", resourceType: "marketing_sequence", resourceId: sequenceId, newValue: { enrollmentId } });
    return { ok: true };
  });
}

/** Worker: send due sequence steps. Waits (sends nothing) while no email provider is configured. */
export async function processDueEnrollments(limit = 100): Promise<number> {
  if (!emailConfigured()) return 0;
  const due = await db().marketingSequenceEnrollment.findMany({
    where: { status: "ACTIVE", nextRunAt: { lte: new Date() }, sequence: { status: "ACTIVE", archivedAt: null } },
    orderBy: { nextRunAt: "asc" },
    take: limit,
    include: { sequence: { include: { steps: { orderBy: { position: "asc" } }, company: { select: { name: true, defaultLocale: true } } } } },
  });
  let sent = 0;
  // Plan email sends per organization for this batch (background: skip, never throw).
  const room = new Map<string, number>();
  for (const e of due) {
    const steps = e.sequence.steps;
    const step = steps[e.nextStep];
    if (!step) {
      await db().marketingSequenceEnrollment.updateMany({ where: { id: e.id, status: "ACTIVE" }, data: { status: "COMPLETED", completedAt: new Date(), nextRunAt: null } });
      continue;
    }
    const suppressed = (await suppressedEmails(db(), e.companyId, [e.emailNormalized])).size > 0;
    const contactOptedOut = e.contactId ? !(await db().contact.findFirst({ where: { id: e.contactId, marketingConsent: true, unsubscribedAt: null }, select: { id: true } })) : false;
    if (suppressed || contactOptedOut) {
      await db().marketingSequenceEnrollment.updateMany({ where: { id: e.id, status: "ACTIVE" }, data: { status: "UNSUBSCRIBED", nextRunAt: null } });
      continue;
    }
    if (!room.has(e.organizationId)) {
      const c = await checkLimit(e.organizationId, "email.sends.month", 1);
      room.set(e.organizationId, !c.allowed ? 0 : c.limit === null ? Number.POSITIVE_INFINITY : Math.max(0, c.limit - c.used));
    }
    if ((room.get(e.organizationId) ?? 0) <= 0) {
      // Leave the enrollment due: it continues when the allowance resets or the plan is upgraded.
      await upsertRecommendation(e.organizationId, e.companyId, {
        dedupeKey: `plan:email.sends:${new Date().toISOString().slice(0, 10)}`,
        title: "Email sequences paused: plan limit reached for email sends",
        priority: "high",
        href: "/settings/billing",
      }).catch(() => false);
      continue;
    }
    room.set(e.organizationId, room.get(e.organizationId)! - 1);
    const status = await sendMarketingEmail(
      { organizationId: e.organizationId, companyId: e.companyId, companyName: e.sequence.company.name, locale: e.sequence.company.defaultLocale, subject: step.subject, body: step.body, enrollmentId: e.id, stepId: step.id, userId: e.sequence.createdById },
      { email: e.email, firstName: e.firstName, contactId: e.contactId },
    );
    if (status === "SENT") {
      sent++;
      await recordUsage(e.organizationId, "email.sends", 1, { companyId: e.companyId, idempotencyKey: `${e.id}:${step.id}` });
    }
    if (status === "NOT_CONFIGURED") break; // provider went away: leave the rest waiting
    const following = steps[e.nextStep + 1];
    await db().marketingSequenceEnrollment.updateMany({
      where: { id: e.id, status: "ACTIVE", nextStep: e.nextStep },
      data: following
        ? { nextStep: e.nextStep + 1, nextRunAt: new Date(Date.now() + following.delayHours * 3_600_000) }
        : { nextStep: e.nextStep + 1, status: "COMPLETED", completedAt: new Date(), nextRunAt: null },
    });
  }
  return sent;
}
