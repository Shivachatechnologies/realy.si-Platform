import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { CommsMeetingStatus } from "@/generated/prisma/enums";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { forbidden, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers } from "@/server/modules/notifications/service";
import { createTask, getTask } from "@/server/modules/agents/service";
import { can } from "@/server/modules/rbac/service";
import type { ScopeChain } from "@/server/modules/rbac/scope";
import { actorId, authorize, clip, instant, isUuid, membersWith, userNames, uuid } from "./common";
import { pushMeetingToCalendar } from "./calendar-sync";
import { safeTimeZone, zonedParts, zonedTime } from "./time";

export const MEETING_STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED"] as const;

export const meetingInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    agenda: z.string().trim().max(10_000).optional(),
    location: z.string().trim().max(300).optional(),
    startsAt: instant,
    endsAt: instant,
    attendeeIds: z.array(uuid).max(100).default([]),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), { path: ["endsAt"], message: "Must be after the start" });
export const updateMeetingInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  agenda: z.string().trim().max(10_000).optional(),
  location: z.string().trim().max(300).optional(),
  startsAt: instant.optional(),
  endsAt: instant.optional(),
  attendeeIds: z.array(uuid).max(100).optional(),
  notes: z.string().max(50_000).optional(),
  decisions: z.array(z.string().trim().min(1).max(1000)).max(100).optional(),
  status: z.enum(["SCHEDULED", "CANCELLED"]).optional(),
});
export const actionItemsInput = z.object({
  items: z
    .array(z.object({ title: z.string().trim().min(1).max(300), assigneeId: uuid.nullable().optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal("").transform(() => null)) }))
    .min(1)
    .max(50),
});
export const actionItemStatusInput = z.object({ done: z.boolean() });
export const meetingAiInput = z.object({ mode: z.enum(["summarize"]), guidance: z.string().trim().max(1000).optional() });
export const suggestInput = z.object({
  attendeeIds: z.array(uuid).min(1).max(50),
  durationMinutes: z.number().int().min(15).max(480).default(30),
  fromDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days: z.number().int().min(1).max(14).default(5),
  workStartHour: z.number().int().min(0).max(23).default(9),
  workEndHour: z.number().int().min(1).max(24).default(17),
});

export interface MeetingFilters {
  q?: string;
  status?: CommsMeetingStatus;
  scope?: "mine" | "upcoming" | "past";
  cursor?: string;
}

export function parseMeetingFilters(raw: Record<string, string | string[] | undefined>): MeetingFilters {
  const one = (k: string) => (Array.isArray(raw[k]) ? raw[k][0] : raw[k])?.trim() || undefined;
  const status = one("status");
  const scope = one("scope");
  const cursor = one("cursor");
  return {
    q: one("q")?.slice(0, 200),
    status: (MEETING_STATUSES as readonly string[]).includes(status ?? "") ? (status as CommsMeetingStatus) : undefined,
    scope: scope === "mine" || scope === "upcoming" || scope === "past" ? scope : undefined,
    cursor: isUuid(cursor) ? cursor : undefined,
  };
}

const PAGE = 25;

export async function listMeetings(ctx: RequestContext, organizationId: string, companyId: string, f: MeetingFilters = {}) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const now = new Date();
  const me = ctx.actor.id ?? "00000000-0000-0000-0000-000000000000";
  const where: Prisma.CommsMeetingWhereInput = {
    organizationId,
    companyId,
    ...(f.status ? { status: f.status } : {}),
    ...(f.scope === "upcoming" ? { endsAt: { gte: now }, status: f.status ?? "SCHEDULED" } : f.scope === "past" ? { startsAt: { lt: now } } : {}),
    ...(f.scope === "mine" ? { OR: [{ organizerId: me }, { attendees: { some: { userId: me } } }] } : {}),
    ...(f.q ? { AND: [{ OR: [{ title: { contains: f.q, mode: "insensitive" } }, { agenda: { contains: f.q, mode: "insensitive" } }] }] } : {}),
  };
  const rows = await db().commsMeeting.findMany({
    where,
    orderBy: f.scope === "upcoming" ? [{ startsAt: "asc" }, { id: "asc" }] : [{ startsAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    include: { attendees: { select: { userId: true } } },
  });
  const page = rows.slice(0, PAGE);
  const names = await userNames(db(), page.flatMap((m) => [m.organizerId, ...m.attendees.map((a) => a.userId)]));
  return {
    data: page.map((m) => ({ ...m, organizerName: names.get(m.organizerId) ?? null, attendeeNames: m.attendees.map((a) => names.get(a.userId) ?? "?") })),
    nextCursor: rows.length > PAGE ? page[page.length - 1]!.id : null,
  };
}

async function loadMeeting(client: Tx | Db, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Meeting");
  const m = await client.commsMeeting.findFirst({ where: { id, organizationId, companyId }, include: { attendees: { select: { userId: true } } } });
  if (!m) throw notFound("Meeting");
  return m;
}

/** Organizer, attendees and communication managers may edit a meeting. */
async function requireParticipant(tx: Tx, ctx: RequestContext, chain: ScopeChain, m: { organizerId: string; attendees: { userId: string }[] }) {
  const me = ctx.actor.id;
  if (ctx.actor.type === "SYSTEM") return;
  if (me && (m.organizerId === me || m.attendees.some((a) => a.userId === me))) return;
  if (await can(ctx, "communication.manage", chain, tx)) return;
  throw forbidden("Only the organizer, attendees or a communication manager can change this meeting", { permission: "communication.manage" });
}

export async function getMeeting(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  const chain = await authorize(ctx, organizationId, companyId, "communication.read");
  const m = await loadMeeting(db(), organizationId, companyId, id);
  const actionItems = await db().workTask.findMany({
    where: { organizationId, companyId, sourceType: "meeting", sourceId: m.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, status: true, assigneeId: true, dueDate: true, completedAt: true },
  });
  const names = await userNames(db(), [m.organizerId, ...m.attendees.map((a) => a.userId), ...actionItems.map((a) => a.assigneeId)]);
  const me = ctx.actor.id;
  const participant = !!me && (m.organizerId === me || m.attendees.some((a) => a.userId === me));
  return {
    ...m,
    organizerName: names.get(m.organizerId) ?? null,
    attendees: m.attendees.map((a) => ({ userId: a.userId, name: names.get(a.userId) ?? null })),
    actionItems: actionItems.map((a) => ({ ...a, assigneeName: a.assigneeId ? (names.get(a.assigneeId) ?? null) : null })),
    canEdit: participant || (await can(ctx, "communication.manage", chain)),
  };
}

async function validAttendees(tx: Tx, organizationId: string, chain: ScopeChain, ids: string[]) {
  if (!ids.length) return [];
  const ok = await membersWith(tx, organizationId, chain, "communication.read", [...new Set(ids)]);
  if (ok.length !== new Set(ids).size) throw invalid("Some attendees can't be invited", { reason: "comms_person_ineligible" });
  return ok;
}

function pushLater(organizationId: string, companyId: string, meetingId: string) {
  void pushMeetingToCalendar(organizationId, companyId, meetingId).catch((err) => logger.warn({ err, meetingId }, "calendar push failed"));
}

export async function createMeeting(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof meetingInput>) {
  const input = meetingInput.parse(raw);
  const m = await transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const organizerId = actorId(ctx, organizationId);
    const attendees = (await validAttendees(tx, organizationId, chain, input.attendeeIds)).filter((u) => u !== organizerId);
    const m = await tx.commsMeeting.create({
      data: {
        organizationId,
        companyId,
        title: input.title,
        agenda: input.agenda || null,
        location: input.location || null,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        organizerId,
        attendees: { create: [organizerId, ...attendees].map((userId) => ({ userId, companyId })) },
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "meeting.created", resourceType: "meeting", resourceId: m.id, newValue: { title: m.title, startsAt: m.startsAt, attendees: attendees.length } });
    await notifyUsers(tx, organizationId, attendees, "comms.meeting_invite", { companyId, title: m.title, href: `/communication/meetings/${m.id}` });
    return m;
  });
  pushLater(organizationId, companyId, m.id);
  return m;
}

export async function updateMeeting(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateMeetingInput>) {
  const input = updateMeetingInput.parse(raw);
  const m = await transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const before = await loadMeeting(tx, organizationId, companyId, id);
    await requireParticipant(tx, ctx, chain, before);
    const startsAt = input.startsAt ? new Date(input.startsAt) : before.startsAt;
    const endsAt = input.endsAt ? new Date(input.endsAt) : before.endsAt;
    if (endsAt <= startsAt) throw invalid("End must be after start", { reason: "comms_meeting_time" });
    let added: string[] = [];
    if (input.attendeeIds) {
      const ids = (await validAttendees(tx, organizationId, chain, input.attendeeIds)).filter((u) => u !== before.organizerId);
      const keep = new Set([before.organizerId, ...ids]);
      added = ids.filter((u) => !before.attendees.some((a) => a.userId === u));
      await tx.commsMeetingAttendee.deleteMany({ where: { meetingId: id, userId: { notIn: [...keep] } } });
      if (added.length) await tx.commsMeetingAttendee.createMany({ data: added.map((userId) => ({ meetingId: id, companyId, userId })) });
    }
    const m = await tx.commsMeeting.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.agenda !== undefined ? { agenda: input.agenda || null } : {}),
        ...(input.location !== undefined ? { location: input.location || null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        ...(input.decisions !== undefined ? { decisions: input.decisions } : {}),
        ...(input.status && before.status !== "COMPLETED" ? { status: input.status } : {}),
        startsAt,
        endsAt,
      },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: input.status === "CANCELLED" ? "meeting.cancelled" : "meeting.updated",
      resourceType: "meeting",
      resourceId: id,
      oldValue: { title: before.title, startsAt: before.startsAt, status: before.status },
      newValue: { title: m.title, startsAt: m.startsAt, status: m.status },
    });
    await notifyUsers(tx, organizationId, added, "comms.meeting_invite", { companyId, title: m.title, href: `/communication/meetings/${id}` });
    if (input.status === "CANCELLED" && before.status !== "CANCELLED") {
      await notifyUsers(tx, organizationId, before.attendees.map((a) => a.userId).filter((u) => u !== ctx.actor.id), "comms.meeting_cancelled", { companyId, title: m.title, href: `/communication/meetings/${id}` });
    }
    return m;
  });
  if (input.startsAt || input.endsAt || input.title || input.attendeeIds || input.location !== undefined) pushLater(organizationId, companyId, m.id);
  return m;
}

export async function deleteMeeting(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const m = await loadMeeting(tx, organizationId, companyId, id);
    if (m.organizerId !== ctx.actor.id && !(await can(ctx, "communication.manage", chain, tx))) throw forbidden("Only the organizer can delete this meeting", { permission: "communication.manage" });
    await tx.commsComment.deleteMany({ where: { companyId, subjectType: "meeting", subjectId: id } });
    await tx.commsMeeting.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "meeting.deleted", resourceType: "meeting", resourceId: id, oldValue: { title: m.title } });
    return { ok: true };
  });
}

/** Mark held: emits meeting.completed (automations, AI follow-ups) and tells attendees. */
export async function completeMeeting(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const m = await loadMeeting(tx, organizationId, companyId, id);
    await requireParticipant(tx, ctx, chain, m);
    if (m.status === "COMPLETED") return m;
    if (m.status === "CANCELLED") throw invalid("A cancelled meeting can't be completed", { reason: "comms_meeting_cancelled" });
    const now = new Date();
    const updated = await tx.commsMeeting.update({ where: { id }, data: { status: "COMPLETED", completedAt: now } });
    await emitDomainEvent(tx, ctx, "meeting.completed", {
      organizationId,
      companyId,
      entityType: "meeting",
      entityId: id,
      data: { title: m.title, organizerId: m.organizerId, attendeeCount: m.attendees.length, decisionCount: m.decisions.length, startsAt: m.startsAt, completedAt: now },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "meeting.completed", resourceType: "meeting", resourceId: id });
    await notifyUsers(tx, organizationId, m.attendees.map((a) => a.userId).filter((u) => u !== ctx.actor.id), "comms.meeting_completed", { companyId, title: m.title, href: `/communication/meetings/${id}` });
    return updated;
  });
}

/** Turn action items into WorkTasks (sourceType "meeting") assigned to attendees. */
export async function createActionItems(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof actionItemsInput>) {
  const input = actionItemsInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const m = await loadMeeting(tx, organizationId, companyId, id);
    await requireParticipant(tx, ctx, chain, m);
    const allowed = new Set([m.organizerId, ...m.attendees.map((a) => a.userId)]);
    const created = [];
    for (const item of input.items) {
      if (item.assigneeId && !allowed.has(item.assigneeId)) throw invalid("Action items can only be assigned to attendees", { reason: "comms_assignee_not_attendee" });
      const task = await tx.workTask.create({
        data: {
          organizationId,
          companyId,
          title: item.title,
          description: `From meeting: ${m.title}`,
          assigneeId: item.assigneeId ?? null,
          dueDate: item.dueDate ? new Date(`${item.dueDate}T00:00:00Z`) : null,
          sourceType: "meeting",
          sourceId: m.id,
          labels: ["meeting"],
          createdById: actorId(ctx, organizationId),
        },
      });
      await emitDomainEvent(tx, ctx, "task.created", {
        organizationId,
        companyId,
        entityType: "work_task",
        entityId: task.id,
        data: { title: task.title, assigneeId: task.assigneeId, sourceType: "meeting", sourceId: m.id, dueDate: task.dueDate },
      });
      created.push(task);
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "meeting.action_items_created", resourceType: "meeting", resourceId: id, newValue: { count: created.length } });
    for (const t of created) {
      if (t.assigneeId && t.assigneeId !== ctx.actor.id) await notifyUsers(tx, organizationId, [t.assigneeId], "comms.action_item", { companyId, title: clip(t.title), href: `/communication/meetings/${id}` });
    }
    return { data: created };
  });
}

/** Tick an action item done / not done (assignee or meeting participants). */
export async function setActionItemStatus(ctx: RequestContext, organizationId: string, companyId: string, meetingId: string, taskId: string, raw: z.input<typeof actionItemStatusInput>) {
  const { done } = actionItemStatusInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "communication.post", tx);
    const m = await loadMeeting(tx, organizationId, companyId, meetingId);
    if (!isUuid(taskId)) throw notFound("Action item");
    const task = await tx.workTask.findFirst({ where: { id: taskId, organizationId, companyId, sourceType: "meeting", sourceId: meetingId } });
    if (!task) throw notFound("Action item");
    if (task.assigneeId !== ctx.actor.id) await requireParticipant(tx, ctx, chain, m);
    const updated = await tx.workTask.update({ where: { id: taskId }, data: done ? { status: "DONE", completedAt: new Date() } : { status: "TODO", completedAt: null } });
    if (done && task.status !== "DONE") {
      await emitDomainEvent(tx, ctx, "task.completed", { organizationId, companyId, entityType: "work_task", entityId: taskId, data: { title: task.title, assigneeId: task.assigneeId, sourceType: "meeting", sourceId: meetingId } });
    }
    return updated;
  });
}

const SUMMARY_INSTRUCTIONS = (id: string) =>
  `Call read_meeting with meetingId ${id}. Then write, using only what the meeting record contains:
## Summary
A short paragraph on what was discussed and concluded.
## Decisions
One bullet per decision.
## Action items
One bullet per action item in exactly this form: "- [Owner name] What to do (due YYYY-MM-DD)". Use an attendee's name as the owner when the notes say who owns it, otherwise omit the [..] part; omit "(due ...)" when no date is given.
If the notes are empty or too thin, say so instead of inventing content. Do not create tasks yourself.`;

/** "Summarize meeting": agent task (chief_of_staff) attached to the meeting. */
export async function summarizeMeeting(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof meetingAiInput>) {
  const input = meetingAiInput.parse(raw);
  const m = await getMeeting(ctx, organizationId, companyId, id);
  return createTask(ctx, organizationId, companyId, {
    profile: "chief_of_staff",
    title: `Meeting summary: ${m.title}`.slice(0, 200),
    instructions: [SUMMARY_INSTRUCTIONS(m.id), input.guidance ? `Additional direction from the requester: ${input.guidance}` : null].filter(Boolean).join("\n\n"),
    subject: { type: "meeting", id: m.id },
  });
}

/** Bullets under an "Action items" heading of a summary: "- [Owner] text (due YYYY-MM-DD)". */
export function parseActionItems(output: string) {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*(#{1,6}\s*|\*\*)?\s*action items\b/i.test(l));
  if (start < 0) return [];
  const out: { title: string; owner: string | null; dueDate: string | null }[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*#{1,6}\s/.test(line) || /^\s*\*\*[^*]+\*\*\s*$/.test(line)) break;
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (!bullet) continue;
    let text = bullet[1]!.replace(/\*\*/g, "").trim();
    let owner: string | null = null;
    let dueDate: string | null = null;
    const o = text.match(/^\[([^\]]{1,80})\]\s*[:\-–]?\s*/) ?? text.match(/^([^:]{1,60}):\s+/);
    if (o) {
      owner = o[1]!.trim();
      text = text.slice(o[0].length);
    }
    const d = text.match(/\(?\s*due[:\s]+(\d{4}-\d{2}-\d{2})\s*\)?/i);
    if (d) {
      dueDate = d[1]!;
      text = text.replace(d[0], "").trim();
    }
    text = text.replace(/[\s.]+$/, "");
    if (text) out.push({ title: text.slice(0, 300), owner, dueDate });
  }
  return out.slice(0, 50);
}

/** Proposed action items from a completed summary task, matched to attendees by name — confirmed by a person before creation. */
export async function proposedActionItems(ctx: RequestContext, organizationId: string, companyId: string, meetingId: string, taskId: string) {
  const m = await getMeeting(ctx, organizationId, companyId, meetingId);
  const task = await getTask(ctx, organizationId, companyId, taskId);
  if (task.subjectType !== "meeting" || task.subjectId !== m.id) throw notFound("Task");
  if (task.status !== "COMPLETED" || !task.output) throw invalid("The summary isn't finished yet", { reason: "comms_summary_not_ready" });
  const people = m.attendees.map((a) => ({ id: a.userId, name: (a.name ?? "").toLowerCase() }));
  const match = (owner: string | null) => {
    if (!owner) return null;
    const o = owner.toLowerCase();
    return people.find((p) => p.name && (p.name === o || p.name.split(/\s+/)[0] === o || p.name.includes(o)))?.id ?? null;
  };
  return { data: parseActionItems(task.output).map((i) => ({ ...i, assigneeId: match(i.owner) })) };
}

/** Free slots for all attendees, from their scheduled meetings, in the company's time zone and working hours. */
export async function suggestSlots(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof suggestInput>) {
  const input = suggestInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "communication.read");
  if (input.workEndHour <= input.workStartHour) throw invalid("Working hours end before they start", { reason: "comms_meeting_time" });
  const company = await db().company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { timezone: true } });
  const tz = safeTimeZone(company.timezone);
  const now = new Date();
  const startParts = input.fromDay ? input.fromDay.split("-").map(Number) : (() => {
    const p = zonedParts(tz, now);
    return [p.year, p.month, p.day];
  })();
  const rangeStart = zonedTime(tz, startParts[0]!, startParts[1]!, startParts[2]!, 0, 0);
  const rangeEnd = new Date(rangeStart.getTime() + (input.days + 3) * 86_400_000);
  const busy = await db().commsMeeting.findMany({
    where: {
      organizationId,
      companyId,
      status: "SCHEDULED",
      startsAt: { lt: rangeEnd },
      endsAt: { gt: rangeStart },
      OR: [{ organizerId: { in: input.attendeeIds } }, { attendees: { some: { userId: { in: input.attendeeIds } } } }],
    },
    select: { startsAt: true, endsAt: true },
  });
  const slots: { startsAt: string; endsAt: string }[] = [];
  const step = 30 * 60_000;
  const dur = input.durationMinutes * 60_000;
  let examined = 0;
  for (let d = 0; examined < input.days && d < input.days + 14 && slots.length < 12; d++) {
    const dayStart = new Date(rangeStart.getTime() + d * 86_400_000 + 12 * 3_600_000);
    const p = zonedParts(tz, dayStart);
    if (p.isoWeekday > 5) continue;
    examined++;
    const open = zonedTime(tz, p.year, p.month, p.day, input.workStartHour, 0).getTime();
    const close = zonedTime(tz, p.year, p.month, p.day, input.workEndHour % 24, 0).getTime() + (input.workEndHour === 24 ? 86_400_000 : 0);
    let perDay = 0;
    for (let t = open; t + dur <= close && perDay < 3; t += step) {
      if (t < now.getTime()) continue;
      const end = t + dur;
      if (busy.some((b) => b.startsAt.getTime() < end && b.endsAt.getTime() > t)) continue;
      slots.push({ startsAt: new Date(t).toISOString(), endsAt: new Date(end).toISOString() });
      perDay++;
      t += dur - step; // the next suggestion starts after this one
    }
  }
  return { data: slots, timeZone: tz };
}
