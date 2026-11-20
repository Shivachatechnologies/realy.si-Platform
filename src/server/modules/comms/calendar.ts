import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { can } from "@/server/modules/rbac/service";
import { actorId, authorize, instant, isUuid, userNames } from "./common";

const eventBase = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  location: z.string().trim().max(300).optional(),
  startsAt: instant,
  endsAt: instant,
  allDay: z.boolean().default(false),
});
export const eventInput = eventBase.refine((v) => new Date(v.endsAt) >= new Date(v.startsAt), { path: ["endsAt"], message: "Must not be before the start" });
export const updateEventInput = eventBase.partial();

/** Meetings and company events overlapping [from, to) — the calendar's month / week view. */
export async function calendarRange(ctx: RequestContext, organizationId: string, companyId: string, from: Date, to: Date, opts: { mine?: boolean } = {}) {
  const chain = await authorize(ctx, organizationId, companyId, "communication.read");
  if (to.getTime() - from.getTime() > 62 * 86_400_000) throw invalid("Range too long");
  const me = ctx.actor.id ?? "00000000-0000-0000-0000-000000000000";
  const [meetings, events] = await Promise.all([
    db().commsMeeting.findMany({
      where: {
        organizationId,
        companyId,
        status: { not: "CANCELLED" },
        startsAt: { lt: to },
        endsAt: { gt: from },
        ...(opts.mine ? { OR: [{ organizerId: me }, { attendees: { some: { userId: me } } }] } : {}),
      },
      orderBy: { startsAt: "asc" },
      take: 1000,
      select: { id: true, title: true, startsAt: true, endsAt: true, status: true, location: true, organizerId: true },
    }),
    db().commsCalendarEvent.findMany({ where: { organizationId, companyId, startsAt: { lt: to }, endsAt: { gte: from } }, orderBy: { startsAt: "asc" }, take: 1000 }),
  ]);
  const names = await userNames(db(), meetings.map((m) => m.organizerId));
  return {
    meetings: meetings.map((m) => ({ ...m, organizerName: names.get(m.organizerId) ?? null })),
    events,
    canManage: await can(ctx, "communication.manage", chain),
  };
}

export async function createEvent(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof eventInput>) {
  const input = eventInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.manage", tx);
    const e = await tx.commsCalendarEvent.create({
      data: {
        organizationId,
        companyId,
        title: input.title,
        description: input.description || null,
        location: input.location || null,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        allDay: input.allDay,
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.event.created", resourceType: "comms_event", resourceId: e.id, newValue: { title: e.title, startsAt: e.startsAt } });
    return e;
  });
}

export async function updateEvent(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateEventInput>) {
  const input = updateEventInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.manage", tx);
    if (!isUuid(id)) throw notFound("Event");
    const before = await tx.commsCalendarEvent.findFirst({ where: { id, organizationId, companyId } });
    if (!before) throw notFound("Event");
    const startsAt = input.startsAt ? new Date(input.startsAt) : before.startsAt;
    const endsAt = input.endsAt ? new Date(input.endsAt) : before.endsAt;
    if (endsAt < startsAt) throw invalid("End must not be before start", { reason: "comms_meeting_time" });
    const e = await tx.commsCalendarEvent.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.location !== undefined ? { location: input.location || null } : {}),
        ...(input.allDay !== undefined ? { allDay: input.allDay } : {}),
        startsAt,
        endsAt,
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.event.updated", resourceType: "comms_event", resourceId: id, oldValue: { title: before.title, startsAt: before.startsAt }, newValue: { title: e.title, startsAt: e.startsAt } });
    return e;
  });
}

export async function deleteEvent(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.manage", tx);
    if (!isUuid(id)) throw notFound("Event");
    const e = await tx.commsCalendarEvent.findFirst({ where: { id, organizationId, companyId } });
    if (!e) throw notFound("Event");
    await tx.commsCalendarEvent.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.event.deleted", resourceType: "comms_event", resourceId: id, oldValue: { title: e.title } });
    return { ok: true };
  });
}
