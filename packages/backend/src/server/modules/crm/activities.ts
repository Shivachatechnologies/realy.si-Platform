import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers } from "@/server/modules/notifications/service";
import { actorId, authorize, day, isUuid, toInstant, userNames, uuid } from "./common";

/** Generalized sales activities, follow-ups and attachments on contacts, accounts and deals (and attachments on leads). */

export const CRM_ACTIVITY_TYPES = ["CALL", "EMAIL", "MEETING", "NOTE", "TASK"] as const;
export const SUBJECT_TYPES = ["contact", "account", "deal"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
export const ATTACHMENT_SUBJECTS = ["lead", "contact", "account", "deal"] as const;
export type AttachmentSubject = (typeof ATTACHMENT_SUBJECTS)[number];
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const subject = z.object({ subjectType: z.enum(SUBJECT_TYPES), subjectId: uuid });

export const crmActivityInput = subject.extend({
  type: z.enum(CRM_ACTIVITY_TYPES),
  subject: z.string().trim().max(200).optional(),
  summary: z.string().trim().min(1).max(5000),
  occurredAt: z.string().datetime({ offset: true }).or(day).optional(),
  durationMin: z.number().int().min(0).max(1440).optional(),
});
export const crmFollowUpInput = subject.extend({
  dueAt: z.string().datetime({ offset: true }).or(day),
  note: z.string().trim().min(1).max(1000),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  assigneeId: uuid.optional().or(z.literal("").transform(() => undefined)),
});
export const crmFollowUpPatch = z.object({
  completed: z.boolean().optional(),
  dueAt: z.string().datetime({ offset: true }).or(day).optional(),
  note: z.string().trim().min(1).max(1000).optional(),
});
export const attachmentInput = z.object({
  subjectType: z.enum(ATTACHMENT_SUBJECTS),
  subjectId: uuid,
  name: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).max(150).regex(/^[\w.+-]+\/[\w.+-]+$/),
  /** Base64 file content. */
  data: z.string().min(1).max(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8),
});

const FK: Record<AttachmentSubject, "leadId" | "contactId" | "accountId" | "dealId"> = { lead: "leadId", contact: "contactId", account: "accountId", deal: "dealId" };

/** Verify the subject exists in the company; returns its denormalized links (deal → account/contact, contact → account). */
async function resolveSubject(tx: Tx, organizationId: string, companyId: string, type: AttachmentSubject, id: string) {
  const where = { id, organizationId, companyId, archivedAt: null };
  if (type === "deal") {
    const d = await tx.crmDeal.findFirst({ where, select: { id: true, accountId: true, contactId: true, ownerId: true, name: true } });
    if (!d) throw notFound("Deal");
    return { dealId: d.id, accountId: d.accountId, contactId: d.contactId, ownerId: d.ownerId, label: d.name };
  }
  if (type === "contact") {
    const c = await tx.contact.findFirst({ where, select: { id: true, accountId: true, ownerId: true, firstName: true, lastName: true } });
    if (!c) throw notFound("Contact");
    return { contactId: c.id, accountId: c.accountId, ownerId: c.ownerId, label: [c.firstName, c.lastName].filter(Boolean).join(" ") };
  }
  if (type === "account") {
    const a = await tx.account.findFirst({ where, select: { id: true, ownerId: true, name: true } });
    if (!a) throw notFound("Account");
    return { accountId: a.id, ownerId: a.ownerId, label: a.name };
  }
  const l = await tx.lead.findFirst({ where, select: { id: true, ownerId: true, name: true } });
  if (!l) throw notFound("Lead");
  return { leadId: l.id, ownerId: l.ownerId, label: l.name };
}

/** Activity filter for a subject's timeline: an account includes its contacts' and deals' activity; a contact its deals'. */
async function timelineWhere(organizationId: string, companyId: string, type: SubjectType, id: string): Promise<Prisma.CrmActivityWhereInput> {
  const base = { organizationId, companyId };
  if (type === "deal") return { ...base, dealId: id };
  if (type === "contact") {
    const deals = await db().crmDeal.findMany({ where: { companyId, contactId: id }, select: { id: true }, take: 500 });
    return { ...base, OR: [{ contactId: id }, { dealId: { in: deals.map((d) => d.id) } }] };
  }
  const [contacts, deals] = await Promise.all([
    db().contact.findMany({ where: { companyId, accountId: id }, select: { id: true }, take: 1000 }),
    db().crmDeal.findMany({ where: { companyId, accountId: id }, select: { id: true }, take: 1000 }),
  ]);
  return { ...base, OR: [{ accountId: id }, { contactId: { in: contacts.map((c) => c.id) } }, { dealId: { in: deals.map((d) => d.id) } }] };
}

/** Timeline, open/closed follow-ups and attachments of a contact, account or deal. */
export async function subjectWorkspace(ctx: RequestContext, organizationId: string, companyId: string, type: SubjectType, id: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  if (!isUuid(id)) throw notFound("Record");
  const where = await timelineWhere(organizationId, companyId, type, id);
  const fuWhere: Prisma.CrmFollowUpWhereInput = { organizationId, companyId, ...(type === "deal" ? { dealId: id } : type === "contact" ? { contactId: id } : { OR: [{ accountId: id }, { deal: { accountId: id } }] }) };
  const [activities, followUps, attachments] = await Promise.all([
    db().crmActivity.findMany({ where, orderBy: { occurredAt: "desc" }, take: 200, include: { deal: { select: { id: true, name: true } }, contact: { select: { id: true, firstName: true, lastName: true } } } }),
    db().crmFollowUp.findMany({ where: fuWhere, orderBy: [{ completedAt: { sort: "asc", nulls: "first" } }, { dueAt: "asc" }], take: 100 }),
    listAttachments(organizationId, companyId, type, id),
  ]);
  const names = await userNames(db(), [...activities.map((a) => a.createdById), ...followUps.map((f) => f.assigneeId)]);
  return {
    activities: activities.map((a) => ({ ...a, author: names.get(a.createdById) ?? null })),
    followUps: followUps.map((f) => ({ ...f, assigneeName: f.assigneeId ? (names.get(f.assigneeId) ?? null) : null })),
    attachments,
  };
}

export async function addCrmActivity(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof crmActivityInput>, opts: { tx?: Tx } = {}) {
  const input = crmActivityInput.parse(raw);
  const run = async (tx: Tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const s = await resolveSubject(tx, organizationId, companyId, input.subjectType, input.subjectId);
    const a = await tx.crmActivity.create({
      data: {
        organizationId,
        companyId,
        type: input.type,
        subject: input.subject || null,
        summary: input.summary,
        occurredAt: input.occurredAt ? toInstant(input.occurredAt) : new Date(),
        durationMin: input.durationMin ?? null,
        dealId: s.dealId ?? null,
        contactId: s.contactId ?? null,
        accountId: s.accountId ?? null,
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.activity.logged", resourceType: input.subjectType, resourceId: input.subjectId, newValue: { type: a.type, activityId: a.id } });
    return a;
  };
  return opts.tx ? run(opts.tx) : transaction(run);
}

export async function deleteCrmActivity(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    if (!isUuid(id)) throw notFound("Activity");
    const a = await tx.crmActivity.findFirst({ where: { id, organizationId, companyId } });
    if (!a) throw notFound("Activity");
    await tx.crmActivity.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.activity.deleted", resourceType: "crm_activity", resourceId: id, oldValue: { type: a.type, summary: a.summary } });
    return { ok: true };
  });
}

export async function addCrmFollowUp(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof crmFollowUpInput>, opts: { tx?: Tx } = {}) {
  const input = crmFollowUpInput.parse(raw);
  const run = async (tx: Tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const s = await resolveSubject(tx, organizationId, companyId, input.subjectType, input.subjectId);
    const assigneeId = input.assigneeId ?? s.ownerId ?? ctx.actor.id ?? null;
    if (input.assigneeId && !(await tx.membership.findFirst({ where: { organizationId, userId: input.assigneeId, status: "ACTIVE" }, select: { userId: true } }))) {
      throw invalid("This person isn't a member of the organization", { reason: "lead_owner_ineligible" });
    }
    const f = await tx.crmFollowUp.create({
      data: {
        organizationId,
        companyId,
        dueAt: toInstant(input.dueAt),
        note: input.note,
        priority: input.priority,
        assigneeId,
        dealId: s.dealId ?? null,
        contactId: s.contactId ?? null,
        accountId: s.dealId ? null : (s.accountId ?? null),
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.follow_up.created", resourceType: input.subjectType, resourceId: input.subjectId, newValue: { dueAt: f.dueAt, note: f.note } });
    if (assigneeId && assigneeId !== ctx.actor.id) {
      await notifyUsers(tx, organizationId, [assigneeId], "crm.follow_up_assigned", { companyId, title: `${s.label}: ${f.note}`.slice(0, 200), href: `/crm/${input.subjectType === "deal" ? "deals" : input.subjectType === "contact" ? "contacts" : "accounts"}/${input.subjectId}` });
    }
    return f;
  };
  return opts.tx ? run(opts.tx) : transaction(run);
}

export async function updateCrmFollowUp(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof crmFollowUpPatch>) {
  const input = crmFollowUpPatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    if (!isUuid(id)) throw notFound("Follow-up");
    const f = await tx.crmFollowUp.findFirst({ where: { id, organizationId, companyId } });
    if (!f) throw notFound("Follow-up");
    const updated = await tx.crmFollowUp.update({
      where: { id },
      data: {
        ...(input.completed !== undefined ? { completedAt: input.completed ? (f.completedAt ?? new Date()) : null } : {}),
        ...(input.dueAt ? { dueAt: toInstant(input.dueAt), remindedAt: null } : {}),
        note: input.note,
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: input.completed ? "crm.follow_up.completed" : "crm.follow_up.updated", resourceType: "crm_follow_up", resourceId: id, newValue: input });
    return updated;
  });
}

export async function deleteCrmFollowUp(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    if (!isUuid(id) || !(await tx.crmFollowUp.findFirst({ where: { id, organizationId, companyId }, select: { id: true } }))) throw notFound("Follow-up");
    await tx.crmFollowUp.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.follow_up.deleted", resourceType: "crm_follow_up", resourceId: id });
    return { ok: true };
  });
}

// ───────────── Attachments ─────────────

async function listAttachments(organizationId: string, companyId: string, type: AttachmentSubject, id: string) {
  const rows = await db().crmAttachment.findMany({
    where: { organizationId, companyId, [FK[type]]: id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, name: true, mimeType: true, size: true, createdAt: true, createdById: true },
  });
  const names = await userNames(db(), rows.map((r) => r.createdById));
  return rows.map((r) => ({ ...r, author: names.get(r.createdById) ?? null }));
}

export async function leadAttachments(ctx: RequestContext, organizationId: string, companyId: string, leadId: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  if (!isUuid(leadId)) throw notFound("Lead");
  return listAttachments(organizationId, companyId, "lead", leadId);
}

export async function uploadAttachment(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof attachmentInput>) {
  const input = attachmentInput.parse(raw);
  const bytes = Buffer.from(input.data, "base64");
  if (!bytes.length) throw invalid("The file is empty", { reason: "crm_attachment_empty" });
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new AppError("payload_too_large", "Attachments are limited to 5 MB", { reason: "crm_attachment_too_large" });
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    await resolveSubject(tx, organizationId, companyId, input.subjectType, input.subjectId);
    if ((await tx.crmAttachment.count({ where: { companyId, [FK[input.subjectType]]: input.subjectId } })) >= 100) throw invalid("Too many attachments on this record", { reason: "crm_limit" });
    const a = await tx.crmAttachment.create({
      data: {
        organizationId,
        companyId,
        name: input.name.replace(/[\\/\r\n"]/g, "_"),
        mimeType: input.mimeType.toLowerCase(),
        size: bytes.length,
        data: bytes,
        [FK[input.subjectType]]: input.subjectId,
        createdById: actorId(ctx, organizationId),
      },
      select: { id: true, name: true, size: true, mimeType: true, createdAt: true },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.attachment.uploaded", resourceType: input.subjectType, resourceId: input.subjectId, newValue: { attachmentId: a.id, name: a.name, size: a.size } });
    return a;
  });
}

/** The file of an attachment (sales.read at its company). */
export async function downloadAttachment(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  if (!isUuid(id)) throw notFound("Attachment");
  const a = await db().crmAttachment.findFirst({ where: { id, organizationId, companyId }, select: { name: true, mimeType: true, size: true, data: true } });
  if (!a) throw notFound("Attachment");
  return a;
}

export async function deleteAttachment(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const a = isUuid(id) ? await tx.crmAttachment.findFirst({ where: { id, organizationId, companyId }, select: { id: true, name: true } }) : null;
    if (!a) throw notFound("Attachment");
    await tx.crmAttachment.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.attachment.deleted", resourceType: "crm_attachment", resourceId: id, oldValue: { name: a.name } });
    return { ok: true };
  });
}

// ───────────── Calendar ─────────────

/** Month grid items: open follow-ups (lead and CRM), meetings and expected deal closes, for `month` "YYYY-MM". */
export async function crmCalendar(ctx: RequestContext, organizationId: string, companyId: string, month: string, opts: { owner?: string } = {}) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  const now = new Date();
  const year = m ? Number(m[1]) : now.getUTCFullYear();
  const mon = m ? Number(m[2]) - 1 : now.getUTCMonth();
  const from = new Date(Date.UTC(year, mon, 1));
  const to = new Date(Date.UTC(year, mon + 1, 1));
  const ownerId = opts.owner === "me" ? (ctx.actor.id ?? undefined) : isUuid(opts.owner) ? opts.owner : undefined;
  const [leadFu, crmFu, meetings, closes] = await Promise.all([
    db().leadFollowUp.findMany({
      where: { organizationId, companyId, dueAt: { gte: from, lt: to }, lead: { archivedAt: null, ...(ownerId ? { ownerId } : {}) } },
      include: { lead: { select: { id: true, name: true } } },
      take: 1000,
    }),
    db().crmFollowUp.findMany({
      where: { organizationId, companyId, dueAt: { gte: from, lt: to }, ...(ownerId ? { assigneeId: ownerId } : {}) },
      include: { deal: { select: { id: true, name: true } }, contact: { select: { id: true, firstName: true, lastName: true } }, account: { select: { id: true, name: true } } },
      take: 1000,
    }),
    db().crmActivity.findMany({
      where: { organizationId, companyId, type: "MEETING", occurredAt: { gte: from, lt: to }, ...(ownerId ? { createdById: ownerId } : {}) },
      include: { deal: { select: { id: true, name: true } }, contact: { select: { id: true, firstName: true, lastName: true } }, account: { select: { id: true, name: true } } },
      take: 1000,
    }),
    db().crmDeal.findMany({
      where: { organizationId, companyId, archivedAt: null, status: "OPEN", expectedCloseDate: { gte: from, lt: to }, ...(ownerId ? { ownerId } : {}) },
      select: { id: true, name: true, expectedCloseDate: true, amountMinor: true, currency: true },
      take: 1000,
    }),
  ]);
  type Item = { id: string; kind: "follow_up" | "meeting" | "close"; date: Date; title: string; href: string; done: boolean };
  const items: Item[] = [
    ...leadFu.map((f) => ({ id: f.id, kind: "follow_up" as const, date: f.dueAt, title: `${f.lead.name}: ${f.note}`, href: `/crm/${f.lead.id}`, done: !!f.completedAt })),
    ...crmFu.map((f) => {
      const label = f.deal?.name ?? f.account?.name ?? (f.contact ? [f.contact.firstName, f.contact.lastName].filter(Boolean).join(" ") : "");
      const href = f.deal ? `/crm/deals/${f.deal.id}` : f.contact ? `/crm/contacts/${f.contact.id}` : f.account ? `/crm/accounts/${f.account.id}` : "/crm/calendar";
      return { id: f.id, kind: "follow_up" as const, date: f.dueAt, title: `${label}: ${f.note}`, href, done: !!f.completedAt };
    }),
    ...meetings.map((a) => {
      const href = a.deal ? `/crm/deals/${a.deal.id}` : a.contact ? `/crm/contacts/${a.contact.id}` : a.account ? `/crm/accounts/${a.account.id}` : "/crm/calendar";
      return { id: a.id, kind: "meeting" as const, date: a.occurredAt, title: a.subject || a.summary.slice(0, 80), href, done: a.occurredAt < now };
    }),
    ...closes.map((d) => ({ id: d.id, kind: "close" as const, date: d.expectedCloseDate!, title: d.name, href: `/crm/deals/${d.id}`, done: false })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  return { year, month: mon + 1, from, to, items };
}
