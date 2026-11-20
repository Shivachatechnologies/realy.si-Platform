import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { can } from "@/server/modules/rbac/service";
import { actorId, authorize, instant, isUuid, userNames } from "./common";

export const CALENDAR_LAYERS = ["meetings", "events", "leave", "holidays", "crm"] as const;
export type CalendarLayer = (typeof CALENDAR_LAYERS)[number];

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

const NO_USER = "00000000-0000-0000-0000-000000000000";

/**
 * Everything on the calendar overlapping [from, to): meetings and company events, plus read-only layers from other
 * modules — approved HR leave (everyone's with hr.read, otherwise only the viewer's own), company holidays, and for
 * sales users CRM follow-ups and open deals' expected close dates (their own; everyone's with sales.manage).
 */
export async function calendarRange(ctx: RequestContext, organizationId: string, companyId: string, from: Date, to: Date, opts: { mine?: boolean; layers?: CalendarLayer[] } = {}) {
  const chain = await authorize(ctx, organizationId, companyId, "communication.read");
  if (to.getTime() - from.getTime() > 62 * 86_400_000) throw invalid("Range too long");
  const me = ctx.actor.id ?? NO_USER;
  const want = new Set(opts.layers ?? CALENDAR_LAYERS);
  const [canManage, hrRead, salesRead, salesManage] = await Promise.all([
    can(ctx, "communication.manage", chain),
    can(ctx, "hr.read", chain),
    can(ctx, "sales.read", chain),
    can(ctx, "sales.manage", chain),
  ]);
  const fromDay = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()) - 86_400_000);
  const toDay = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) + 86_400_000);
  const none = Promise.resolve([] as never[]);
  const [meetings, events, leave, holidays, crmFollowUps, leadFollowUps, deals] = await Promise.all([
    want.has("meetings")
      ? db().commsMeeting.findMany({
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
          select: { id: true, title: true, startsAt: true, endsAt: true, status: true, location: true, organizerId: true, recurrence: true },
        })
      : none,
    want.has("events") ? db().commsCalendarEvent.findMany({ where: { organizationId, companyId, startsAt: { lt: to }, endsAt: { gte: from } }, orderBy: { startsAt: "asc" }, take: 1000 }) : none,
    want.has("leave")
      ? db().hrLeaveRequest.findMany({
          where: {
            organizationId,
            companyId,
            status: "APPROVED",
            startDate: { lt: toDay },
            endDate: { gte: fromDay },
            ...(hrRead && !opts.mine ? {} : { employee: { userId: me } }),
          },
          orderBy: { startDate: "asc" },
          take: 1000,
          select: { id: true, startDate: true, endDate: true, days: true, employee: { select: { id: true, firstName: true, lastName: true, userId: true } }, leaveType: { select: { name: true, color: true } } },
        })
      : none,
    want.has("holidays") ? db().hrHoliday.findMany({ where: { organizationId, companyId, date: { gte: fromDay, lt: toDay } }, orderBy: { date: "asc" }, select: { id: true, name: true, date: true } }) : none,
    want.has("crm") && salesRead
      ? db().crmFollowUp.findMany({
          where: { organizationId, companyId, completedAt: null, dueAt: { gte: from, lt: to }, ...(salesManage && !opts.mine ? {} : { assigneeId: me }) },
          orderBy: { dueAt: "asc" },
          take: 500,
          select: { id: true, dueAt: true, note: true, priority: true, dealId: true, contactId: true, accountId: true },
        })
      : none,
    want.has("crm") && salesRead
      ? db().leadFollowUp.findMany({
          where: { organizationId, companyId, completedAt: null, dueAt: { gte: from, lt: to }, lead: { archivedAt: null, ...(salesManage && !opts.mine ? {} : { ownerId: me }) } },
          orderBy: { dueAt: "asc" },
          take: 500,
          select: { id: true, dueAt: true, note: true, priority: true, leadId: true, lead: { select: { name: true } } },
        })
      : none,
    want.has("crm") && salesRead
      ? db().crmDeal.findMany({
          where: { organizationId, companyId, archivedAt: null, status: "OPEN", expectedCloseDate: { gte: fromDay, lt: toDay }, ...(salesManage && !opts.mine ? {} : { ownerId: me }) },
          orderBy: { expectedCloseDate: "asc" },
          take: 500,
          select: { id: true, name: true, amountMinor: true, currency: true, expectedCloseDate: true },
        })
      : none,
  ]);
  const names = await userNames(db(), meetings.map((m) => m.organizerId));
  return {
    meetings: meetings.map((m) => ({ ...m, organizerName: names.get(m.organizerId) ?? null })),
    events,
    leave: leave.map((l) => ({ id: l.id, startDate: l.startDate, endDate: l.endDate, days: l.days, type: l.leaveType.name, color: l.leaveType.color, employeeId: l.employee.id, name: [l.employee.firstName, l.employee.lastName].filter(Boolean).join(" "), own: l.employee.userId === me })),
    holidays,
    followUps: [
      ...crmFollowUps.map((f) => ({
        id: f.id,
        dueAt: f.dueAt,
        note: f.note,
        priority: f.priority,
        href: f.dealId ? `/crm/deals/${f.dealId}` : f.contactId ? `/crm/contacts/${f.contactId}` : f.accountId ? `/crm/accounts/${f.accountId}` : "/crm",
        label: null as string | null,
      })),
      ...leadFollowUps.map((f) => ({ id: f.id, dueAt: f.dueAt, note: f.note, priority: f.priority, href: `/crm/${f.leadId}`, label: f.lead.name })),
    ].sort((a, b) => +a.dueAt - +b.dueAt),
    deals,
    canManage,
    layers: { leave: true, holidays: true, crm: salesRead, leaveScope: hrRead ? ("all" as const) : ("own" as const) },
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
